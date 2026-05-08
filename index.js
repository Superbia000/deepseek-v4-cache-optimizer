import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

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
        console.warn(`%c[DS Cache v6.3] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS Cache v6.3] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS Cache v6.3] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
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
// 状态机 v6.3
// ==========================================
const CacheState = {
    enabled: true,
    backgroundBlock: null,      // 固定背景消息（system + 固定提示词），按首次出现顺序去重
    dialogueHistory: null,      // 对话历史（真实用户/AI消息），按对话轮次顺序
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
    pendingReset: false,
    awaitingDialog: false,
};

// ==========================================
// 消息分类（与原始聊天关联）
// ==========================================
function classifyMessage(msg, originalChat) {
    const orig = originalChat.find(m => m.mes === msg.content);
    if (orig) {
        if (orig.is_user) return { isRealUser: true, isRealAI: false, isInstructional: false };
        if (!orig.is_system) {
            if (msg.role === 'assistant') return { isRealUser: false, isRealAI: true, isInstructional: false };
            return { isRealUser: false, isRealAI: false, isInstructional: true };
        }
        return { isRealUser: false, isRealAI: false, isInstructional: true };
    }
    return { isRealUser: false, isRealAI: false, isInstructional: true };
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
// 处理当前请求流
// ==========================================
function processStream(stream, originalChat) {
    // 找预填充
    let prefillStart = stream.length;
    while (prefillStart > 0 && stream[prefillStart - 1].role === 'assistant') {
        prefillStart--;
    }
    const prefills = stream.slice(prefillStart);

    const nonPrefill = stream.slice(0, prefillStart);

    // 找出当前用户输入（非预填充部分最后一个 isRealUser 的 user 消息）
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
    // others 现在保持原始顺序，但可能混合了 system 和其他角色

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
        Logger.log(`[请求 #${CacheState.stats.total}] 开始处理...`);

        if (!data?.chat?.length) return;
        const stream = data.chat;
        const context = getContext();
        const originalChat = context?.chat ?? [];

        const { currentUserMsg, others, prefills } = processStream(stream, originalChat);

        // 1. 分离背景信息（system + 某些无对应真实用户的提示词）和对话历史
        // 我们定义背景信息：所有 isInstructional 且不在当前用户输入之前的对话历史中。
        // 简单规则：遍历 others，将 isInstructional 的消息归入背景，非 isInstructional 归入对话。
        const currentBg = others.filter(m => m.isInstructional);
        const currentDialogue = others.filter(m => !m.isInstructional);  // 真实用户/助手对话

        // 2. 背景信息去重（按归一化内容）
        const seenBgNorm = new Set();
        const dedupBg = [];
        for (const m of currentBg) {
            if (!seenBgNorm.has(m.norm)) {
                seenBgNorm.add(m.norm);
                dedupBg.push(m);
            } else {
                Logger.log(`[背景去重] 跳过重复: ${m.content.substring(0, 40)}...`, LogLevels.DEBUG);
            }
        }

        // 3. 初始化状态
        if (!CacheState.backgroundBlock || !CacheState.dialogueHistory) {
            CacheState.backgroundBlock = dedupBg;
            CacheState.dialogueHistory = currentDialogue;
            Logger.log(`[初始化] 背景块: ${dedupBg.length} 条, 对话历史: ${currentDialogue.length} 条`, LogLevels.BASIC);
            buildAndApply(stream, dedupBg, currentDialogue, currentUserMsg, prefills);
            updateStats(true);
            return;
        }

        // 4. 检测背景块是否重大变化
        const bgSimilarity = computeSetSimilarity(
            new Set(CacheState.backgroundBlock.map(m => m.norm)),
            new Set(dedupBg.map(m => m.norm))
        );
        Logger.log(`[背景块相似度] ${(bgSimilarity*100).toFixed(1)}%`, LogLevels.DEBUG);

        if (bgSimilarity < 0.9) {
            triggerResetAlert('检测到系统提示词核心变动（如更换角色卡或预设），是否需要重置缓存前缀？');
            // 本次不修改，直接发送原始消息
            return;
        }

        // 5. 对话历史增量匹配：找出新增的对话条目
        // 使用 uid 比较（对话内容可能不同，准确的 uid 能识别同一轮对话的重新生成）
        const newDialogueEntries = findNewEntries(CacheState.dialogueHistory, currentDialogue);
        if (newDialogueEntries.length > 0) {
            Logger.warn(`[对话增量] 新增 ${newDialogueEntries.length} 条对话`, LogLevels.DETAILED);
            newDialogueEntries.forEach(e => Logger.warn(`  + ${e.role}: ${e.content.substring(0, 40)}...`, LogLevels.DEBUG));
            CacheState.dialogueHistory = CacheState.dialogueHistory.concat(newDialogueEntries);
        }

        // 6. 检测对话历史是否被大幅删减
        if (currentDialogue.length < CacheState.dialogueHistory.length * 0.7) {
            triggerResetAlert('检测到对话历史被大幅删除，可能导致缓存命中率降低，是否重置前缀？');
            return;
        }

        // 7. 构建最终序列：背景块（不变） + 对话历史（锁定前缀） + 当前用户输入 + 预填充
        buildAndApply(stream, CacheState.backgroundBlock, CacheState.dialogueHistory, currentUserMsg, prefills);
        updateStats(false);

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

function buildAndApply(stream, bgBlock, dialogueHist, currentUser, prefills) {
    const final = [];
    // 背景块
    bgBlock.forEach(b => final.push({ role: b.role, content: b.content }));
    // 对话历史
    dialogueHist.forEach(d => final.push({ role: d.role, content: d.content }));
    // 当前用户输入
    if (currentUser) final.push({ role: currentUser.role, content: currentUser.content });
    // 预填充
    prefills.forEach(p => final.push({ role: p.role, content: p.content }));

    if (logLevel >= LogLevels.DEBUG) {
        Logger.log(`[最终序列] 背景:${bgBlock.length} 对话:${dialogueHist.length} 用户输入:${currentUser?1:0} 预填充:${prefills.length}`, LogLevels.DEBUG);
        final.forEach((m, i) => {
            Logger.log(`  ${i}: [${m.role}] ${m.content.substring(0, 40)}...`, LogLevels.DEBUG);
        });
    }
    stream.splice(0, stream.length, ...final);
}

// 找出 newSeq 中不在 oldSeq 中的条目（基于 uid）
function findNewEntries(oldSeq, newSeq) {
    const oldUids = new Set(oldSeq.map(m => m.uid));
    return newSeq.filter(m => !oldUids.has(m.uid));
}

function computeSetSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1;
    const union = new Set([...setA, ...setB]);
    let intersection = 0;
    for (const item of setA) if (setB.has(item)) intersection++;
    return union.size === 0 ? 1 : intersection / union.size;
}

function updateStats(isInit = false) {
    const bgTokens = CacheState.backgroundBlock?.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0) ?? 0;
    const dialogueTokens = CacheState.dialogueHistory?.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0) ?? 0;
    CacheState.stats.prefixTokens = bgTokens + dialogueTokens;
    CacheState.stats.hits++;
    CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
    updateStatsUI();
}

function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `
        <span>命中: ${hits}/${total} (${rate}%)</span>
        <span style="margin-left:10px;">前缀: ~${prefixTokens.toLocaleString()}t</span>
        <span style="margin-left:10px;">节省: ~${savedTokens.toLocaleString()}t</span>
    `;
}

// ==========================================
// 弹窗逻辑（同前）
// ==========================================
function triggerResetAlert(reason) {
    if (CacheState.pendingReset || CacheState.awaitingDialog) return;
    CacheState.awaitingDialog = true;
    showResetDialog(reason);
}
function showResetDialog(reason) {
    const dialog = document.getElementById('ds-reset-dialog');
    const text = document.getElementById('ds-reset-dialog-text');
    if (!dialog || !text) {
        if (confirm(reason + '\n确定重置？取消保持。')) performReset();
        CacheState.awaitingDialog = false;
        return;
    }
    text.textContent = reason;
    dialog.style.display = 'flex';
    CacheState.pendingReset = true;
}
function hideResetDialog() {
    const d = document.getElementById('ds-reset-dialog');
    if (d) d.style.display = 'none';
    CacheState.pendingReset = false;
    CacheState.awaitingDialog = false;
}
function performReset() {
    CacheState.backgroundBlock = null;
    CacheState.dialogueHistory = null;
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    updateStatsUI();
    Logger.warn('[重置] 前缀已清空，下次请求自动重建', LogLevels.BASIC);
    hideResetDialog();
}

// ==========================================
// UI
// ==========================================
async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DS Cache Optimizer v6.3 (背景/对话分离)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">分离固定背景与动态对话，彻底解决插入位置变动导致的序列膨胀，实现稳定前缀。</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;"></div>
                <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" checked> 启用</label>
                <div style="margin:8px 0;">
                    <span style="font-size:0.9em;">日志等级:</span>
                    <select id="ds-cache-loglevel" style="flex:1;">
                        <option value="0">关闭</option><option value="1">简要</option>
                        <option value="2" selected>详细</option><option value="3">调试</option>
                    </select>
                </div>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:5px 0;">🔄 强制重置</button>
                <button id="ds-cache-clearlog" class="menu_button" style="width:100%;margin:5px 0;">🗑️ 清空日志</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>
        <div id="ds-reset-dialog" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; align-items:center; justify-content:center;">
            <div style="background:#2b2b2b; padding:20px; border-radius:8px; max-width:500px;">
                <h3>缓存优化器提醒</h3>
                <p id="ds-reset-dialog-text"></p>
                <div style="display:flex; justify-content:flex-end; gap:8px;">
                    <button id="ds-reset-dialog-cancel" class="menu_button" style="background:#444;">取消</button>
                    <button id="ds-reset-dialog-reset" class="menu_button" style="background:#c0392b; color:white;">重置前缀</button>
                </div>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');

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
        $('#ds-reset-dialog-cancel').on('click', () => {
            Logger.warn('用户取消重置', LogLevels.BASIC);
            hideResetDialog();
        });
        $('#ds-reset-dialog-reset').on('click', () => performReset());
        updateStatsUI();
    } catch (e) {
        Logger.error('UI初始化错误', e);
    }
}

// 启动
jQuery(async () => {
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 钩子已挂载', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载关键事件钩子');
    }
    Logger.log('══════ v6.3 就绪，策略：背景锁定 + 对话增量 ══════', LogLevels.BASIC);
});
