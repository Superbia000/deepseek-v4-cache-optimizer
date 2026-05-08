import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';
import { callPopup } from '../../../popup.js';

// ==========================================
// 日志系统
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };
let logLevel = 2;

function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const fullMsg = `[${time}] ${msg}`;
    if (type === 'warn') {
        console.warn(`%c[DS Cache v6.4] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS Cache v6.4] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS Cache v6.4] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
    }
    if (Logger._uiTextarea) {
        Logger._uiTextarea.value += fullMsg + '\n';
        Logger._uiTextarea.scrollTop = Logger._uiTextarea.scrollHeight;
    }
}

const Logger = {
    _uiTextarea: null,
    log: (msg, level = LogLevels.DETAILED) => logAt(level, 'log', msg),
    warn: (msg, level = LogLevels.BASIC) => logAt(level, 'warn', msg),
    error: (msg, err, level = LogLevels.BASIC) => logAt(level, 'error', err ? `${msg} ${err}` : msg),
    simpleHash: (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
    },
    estimateTokens: (text) => {
        if (!text) return 0;
        let tokens = 0;
        for (const ch of text) {
            const code = ch.charCodeAt(0);
            if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3040 && code <= 0x30FF) || (code >= 0xAC00 && code <= 0xD7AF)) {
                tokens += 1;
            } else {
                tokens += 0.25;
            }
        }
        return Math.ceil(tokens);
    },
    normalize: (text) => text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
};

// ==========================================
// 状态机
// ==========================================
const CacheState = {
    enabled: true,
    backgroundBlock: null,
    dialogueHistory: null,
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
    pendingReset: false,
};

// ==========================================
// 消息分类
// ==========================================
function classifyMessage(msg, originalChat) {
    // 1. 先尝试精确匹配原始消息
    const orig = originalChat.find(m => m.mes === msg.content);
    if (orig) {
        if (orig.is_user) return { isRealUser: true, isRealAI: false, isInstructional: false };
        if (!orig.is_system) {
            if (msg.role === 'assistant') return { isRealUser: false, isRealAI: true, isInstructional: false };
            return { isRealUser: false, isRealAI: false, isInstructional: true };
        }
        return { isRealUser: false, isRealAI: false, isInstructional: true };
    }

    // 2. 未匹配到原始消息：根据角色和内容启发式判断
    // 若角色是 system，必然是提示词
    if (msg.role === 'system') return { isRealUser: false, isRealAI: false, isInstructional: true };
    // 若角色是 user 且内容极短且含有特殊符号，可能是世界书注入，否则视为真实用户（保守）
    if (msg.role === 'user') {
        // 简单启发：如果内容被包裹在 {{ }} 或含有 setvar 等标记，大概率是提示词
        if (/^\s*\{.*\}\s*$/.test(msg.content) || msg.content.includes('{{setvar')) {
            return { isRealUser: false, isRealAI: false, isInstructional: true };
        }
        return { isRealUser: true, isRealAI: false, isInstructional: false };
    }
    // assistant 且未匹配，默认为真实 AI
    return { isRealUser: false, isRealAI: true, isInstructional: false };
}

function createMessageObj(msg, cls, uid) {
    return {
        role: msg.role,
        content: msg.content,
        isRealUser: cls.isRealUser,
        isRealAI: cls.isRealAI,
        isInstructional: cls.isInstructional,
        uid: uid || `${msg.role}:${Logger.simpleHash(msg.content)}`,
        norm: Logger.normalize(msg.content),
    };
}

// ==========================================
// 处理流
// ==========================================
function processStream(stream, originalChat) {
    let prefillStart = stream.length;
    while (prefillStart > 0 && stream[prefillStart - 1].role === 'assistant') {
        prefillStart--;
    }
    const prefills = stream.slice(prefillStart);
    const nonPrefill = stream.slice(0, prefillStart);

    let currentUserMsg = null;
    const others = [];
    for (let i = nonPrefill.length - 1; i >= 0; i--) {
        const msg = nonPrefill[i];
        const cls = classifyMessage(msg, originalChat);
        const obj = createMessageObj(msg, cls);
        if (!currentUserMsg && cls.isRealUser && msg.role === 'user') {
            currentUserMsg = obj;
        } else {
            others.unshift(obj);
        }
    }
    return { currentUserMsg, others, prefills };
}

// ==========================================
// 核心拦截器
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`[请求 #${CacheState.stats.total}] 开始...`);

        if (!data?.chat?.length) return;
        const stream = data.chat;
        const context = getContext();
        const originalChat = context?.chat ?? [];

        const { currentUserMsg, others, prefills } = processStream(stream, originalChat);

        const currentBg = others.filter(m => m.isInstructional);
        const currentDialogue = others.filter(m => !m.isInstructional);

        // 背景去重
        const seenBgNorm = new Set();
        const dedupBg = [];
        for (const m of currentBg) {
            if (!seenBgNorm.has(m.norm)) {
                seenBgNorm.add(m.norm);
                dedupBg.push(m);
            }
        }

        // 初始化
        if (!CacheState.backgroundBlock || !CacheState.dialogueHistory) {
            CacheState.backgroundBlock = dedupBg;
            CacheState.dialogueHistory = currentDialogue;
            Logger.log(`[初始化] 背景:${dedupBg.length}条, 对话历史:${currentDialogue.length}条`, LogLevels.BASIC);
            buildAndApply(stream, dedupBg, currentDialogue, currentUserMsg, prefills);
            updateStats();
            return;
        }

        // 检测背景变化
        const bgSetOld = new Set(CacheState.backgroundBlock.map(m => m.norm));
        const bgSetNew = new Set(dedupBg.map(m => m.norm));
        const bgSim = computeSetSimilarity(bgSetOld, bgSetNew);
        Logger.log(`[背景相似度] ${(bgSim*100).toFixed(1)}%`, LogLevels.DEBUG);

        if (bgSim < 0.9) {
            Logger.warn('[重大变动] 背景提示词相似度不足，建议重置', LogLevels.BASIC);
            triggerResetAlert('检测到角色卡/预设变更，为保障缓存命中率，建议重置前缀。');
            return;
        }

        // 对话增量
        const oldUids = new Set(CacheState.dialogueHistory.map(m => m.uid));
        const newDialogue = currentDialogue.filter(m => !oldUids.has(m.uid));
        if (newDialogue.length > 0) {
            Logger.warn(`[对话增量] +${newDialogue.length}条`, LogLevels.DETAILED);
            CacheState.dialogueHistory = CacheState.dialogueHistory.concat(newDialogue);
        }

        // 大幅度删减检测
        if (currentDialogue.length < CacheState.dialogueHistory.length * 0.6) {
            Logger.warn('[大幅删减] 对话历史被大量删除', LogLevels.BASIC);
            triggerResetAlert('对话历史被大幅度删减，可能会影响缓存命中，建议重置。');
            return;
        }

        buildAndApply(stream, CacheState.backgroundBlock, CacheState.dialogueHistory, currentUserMsg, prefills);
        updateStats();
    } catch (err) {
        Logger.error('拦截器错误', err);
    }
}

function buildAndApply(stream, bg, dialogue, user, prefills) {
    const final = [];
    bg.forEach(b => final.push({ role: b.role, content: b.content }));
    dialogue.forEach(d => final.push({ role: d.role, content: d.content }));
    if (user) final.push({ role: user.role, content: user.content });
    prefills.forEach(p => final.push({ role: p.role, content: p.content }));

    if (logLevel >= LogLevels.DEBUG) {
        Logger.log(`[最终序列] 背景:${bg.length} 对话:${dialogue.length} 用户:${user?1:0} 预填充:${prefills.length}`, LogLevels.DEBUG);
    }
    stream.splice(0, stream.length, ...final);
}

function computeSetSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1;
    const union = new Set([...setA, ...setB]);
    let intersection = 0;
    for (const item of setA) if (setB.has(item)) intersection++;
    return union.size === 0 ? 1 : intersection / union.size;
}

function updateStats() {
    const bgTokens = CacheState.backgroundBlock?.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0) ?? 0;
    const dlTokens = CacheState.dialogueHistory?.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0) ?? 0;
    CacheState.stats.prefixTokens = bgTokens + dlTokens;
    CacheState.stats.hits++;
    CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
    updateStatsUI();
}

function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `<span>命中: ${hits}/${total} (${rate}%)</span> <span style="margin-left:10px;">前缀: ~${prefixTokens.toLocaleString()}t</span> <span style="margin-left:10px;">节省: ~${savedTokens.toLocaleString()}t</span>`;
}

// ==========================================
// 弹窗系统（完全自定义，确保显示）
// ==========================================
let currentDialog = null;

function triggerResetAlert(reason) {
    if (CacheState.pendingReset) return;
    Logger.warn(`[弹窗触发] ${reason}`, LogLevels.BASIC);
    CacheState.pendingReset = true;
    showResetDialog(reason);
}

function showResetDialog(reason) {
    // 移除可能残留的旧弹窗
    if (currentDialog) {
        currentDialog.remove();
        currentDialog = null;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7); z-index:100000; display:flex; align-items:center; justify-content:center;';
    overlay.id = 'ds-reset-overlay';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#2b2b2b; color:#ddd; padding:24px; border-radius:12px; box-shadow:0 0 30px black; max-width:480px; width:90%; font-family:sans-serif;';
    dialog.innerHTML = `
        <h3 style="margin-top:0; color:#ffaa00;">⚠️ 缓存优化器提醒</h3>
        <p style="margin:16px 0;">${reason}</p>
        <div style="display:flex; justify-content:flex-end; gap:10px;">
            <button id="ds-dialog-cancel" style="padding:8px 20px; background:#555; color:white; border:none; border-radius:6px; cursor:pointer;">取消</button>
            <button id="ds-dialog-reset" style="padding:8px 20px; background:#c0392b; color:white; border:none; border-radius:6px; cursor:pointer;">重置前缀</button>
        </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    currentDialog = overlay;

    document.getElementById('ds-dialog-cancel').onclick = () => {
        Logger.warn('用户选择不重置', LogLevels.BASIC);
        hideResetDialog();
    };
    document.getElementById('ds-dialog-reset').onclick = () => {
        performReset();
    };

    // 点击遮罩外部也可取消（可选）
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            hideResetDialog();
        }
    });
}

function hideResetDialog() {
    if (currentDialog) {
        currentDialog.remove();
        currentDialog = null;
    }
    CacheState.pendingReset = false;
}

function performReset() {
    CacheState.backgroundBlock = null;
    CacheState.dialogueHistory = null;
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    updateStatsUI();
    Logger.warn('[重置] 前缀已清空，下次请求重建', LogLevels.BASIC);
    hideResetDialog();
}

// ==========================================
// UI 初始化
// ==========================================
async function setupUI() {
    try {
        // 扩展面板
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DS Cache Optimizer v6.4</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.7;">分离固定背景与动态对话，完美命中前缀缓存。</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;"></div>
                <label class="checkbox_label">
                    <input type="checkbox" id="ds-cache-enable" checked> 启用优化
                </label>
                <div style="margin:10px 0;">
                    <span>日志等级:</span>
                    <select id="ds-cache-loglevel" style="margin-left:8px;">
                        <option value="0">关闭</option><option value="1">简要</option>
                        <option value="2" selected>详细</option><option value="3">调试</option>
                    </select>
                </div>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;">🔄 强制重置缓存前缀</button>
                <button id="ds-cache-clearlog" class="menu_button" style="width:100%; margin-top:5px;">🗑️ 清空日志</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%; height:180px; background:#121212; color:#4af626; font-family:Consolas,monospace; font-size:11px; margin-top:8px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);

        Logger._uiTextarea = document.getElementById('ds-cache-log');

        // 事件绑定
        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`插件 ${CacheState.enabled?'启用':'停用'}`, LogLevels.BASIC);
        });
        $('#ds-cache-loglevel').on('change', function() {
            logLevel = parseInt($(this).val());
            Logger.log(`日志等级: ${['关闭','简要','详细','调试'][logLevel]}`, LogLevels.BASIC);
        });
        $('#ds-cache-reset').on('click', () => performReset());
        $('#ds-cache-clearlog').on('click', () => {
            if (Logger._uiTextarea) Logger._uiTextarea.value = '';
        });

        // 添加右上角菜单按钮（集成到SillyTavern的功能菜单）
        if (window.PowerUser?.addToolbarButton) {
            window.PowerUser.addToolbarButton('🧠 重置DS缓存', performReset, '重置DeepSeek缓存前缀');
            Logger.log('[菜单] 已添加快捷重置按钮', LogLevels.BASIC);
        } else {
            // fallback: 如果SillyTavern版本不支持，我们手动添加一个浮动按钮
            const btn = document.createElement('div');
            btn.style.cssText = 'position:fixed; bottom:20px; right:20px; z-index:9999; background:#c0392b; color:white; padding:10px 15px; border-radius:8px; cursor:pointer; font-weight:bold; box-shadow:0 0 10px black;';
            btn.textContent = '🧠 重置DS前缀';
            btn.onclick = performReset;
            document.body.appendChild(btn);
            Logger.log('[菜单] 已添加浮动重置按钮', LogLevels.BASIC);
        }

        updateStatsUI();
    } catch (e) {
        Logger.error('UI初始化错误', e);
    }
}

// ==========================================
// 启动
// ==========================================
jQuery(async () => {
    console.log('DS Cache Optimizer v6.4 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 钩子已挂载', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v6.4 就绪，背景锁定+对话增量+全新弹窗 ══════', LogLevels.BASIC);
});
