import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志系统（增强差异对比）
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };
let logLevel = 2;
function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const fullMsg = `[${time}] ${msg}`;
    if (type === 'warn') console.warn(`%c[DS Cache v6.10] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    else if (type === 'error') console.error(`[DS Cache v6.10] 🔴 ${msg}`);
    else console.log(`%c[DS Cache v6.10] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
    simpleHash: (str) => { let hash = 0; for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; } return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8); },
    estimateTokens: (text) => { if (!text) return 0; let tokens = 0; for (const ch of text) { const code = ch.charCodeAt(0); if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3040 && code <= 0x30FF) || (code >= 0xAC00 && code <= 0xD7AF)) tokens += 1; else tokens += 0.25; } return Math.ceil(tokens); },
    normalize: (text) => text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
};

// ==========================================
// 状态机 v6.10
// ==========================================
const CacheState = {
    enabled: true,
    backgroundBlock: null,
    dialogueHistory: null,
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
    blocked: false,
};

// ==========================================
// 判断是否为系统注入提示词（不依赖 originalChat）
// ==========================================
function isSystemPrompt(content) {
    const pattern = /<\w+|<\/\w+|\{\{setvar|\[SYSTEM:|\[World Loading|<lore>|<\/lore>|<context>|<\/context>|# RULE|core_rules|Absolute zero/;
    return pattern.test(content);
}

// ==========================================
// 处理请求流（基于位置和内容特征，不再依赖 originalChat）
// ==========================================
function processStream(stream) {
    // 1. 寻找预填充：尾部连续的 assistant 消息（且内容不包含 XML 标签，排除系统注入）
    let prefillStart = stream.length;
    while (prefillStart > 0 && stream[prefillStart - 1].role === 'assistant') {
        const content = stream[prefillStart - 1].content;
        if (isSystemPrompt(content)) break; // 系统注入的 assistant 不算预填充
        prefillStart--;
    }
    const prefills = stream.slice(prefillStart);
    const nonPrefill = stream.slice(0, prefillStart);

    // 2. 找到当前用户输入：最后一个 role === 'user' 且不是系统提示词的消息
    let currentUserMsg = null;
    const others = [];
    let foundCurrentUser = false;
    for (let i = nonPrefill.length - 1; i >= 0; i--) {
        const msg = nonPrefill[i];
        if (!foundCurrentUser && msg.role === 'user' && !isSystemPrompt(msg.content)) {
            currentUserMsg = { role: msg.role, content: msg.content };
            foundCurrentUser = true;
        } else {
            others.unshift({ role: msg.role, content: msg.content });
        }
    }

    // 3. 分类 others 为背景或对话历史
    const bgCandidates = [];
    const dialogue = [];
    for (const msg of others) {
        if (msg.role === 'system' || isSystemPrompt(msg.content)) {
            bgCandidates.push(msg);
        } else {
            dialogue.push(msg); // 真实对话
        }
    }

    // 背景去重（基于标准化内容）
    const seen = new Set();
    const dedupBg = [];
    for (const msg of bgCandidates) {
        const norm = Logger.normalize(msg.content);
        if (!seen.has(norm)) {
            seen.add(norm);
            dedupBg.push(msg);
        } else {
            Logger.log(`[背景去重] 跳过: ${msg.role}: ${msg.content.substring(0, 40)}...`, LogLevels.DEBUG);
        }
    }

    // 诊断日志
    if (logLevel >= LogLevels.DEBUG) {
        Logger.log('[stream 完整内容]', LogLevels.DEBUG);
        stream.forEach((m, i) => {
            Logger.log(`  [${i}] ${m.role}: ${m.content.substring(0, 50)}...`, LogLevels.DEBUG);
        });
        Logger.log('[背景/对话分离]', LogLevels.DEBUG);
        dedupBg.forEach(m => Logger.log(`  背景: ${m.role}: ${m.content.substring(0, 40)}...`, LogLevels.DEBUG));
        dialogue.forEach(m => Logger.log(`  对话: ${m.role}: ${m.content.substring(0, 40)}...`, LogLevels.DEBUG));
    }

    return { currentUserMsg, dedupBg, dialogue, prefills };
}

// ==========================================
// 核心拦截器（初始化逻辑简化）
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;
    if (CacheState.blocked) {
        Logger.warn('[阻塞中] 保持原始消息', LogLevels.BASIC);
        return;
    }

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`[请求 #${CacheState.stats.total}] 开始处理...`);

        if (!data?.chat?.length) return;
        const stream = data.chat;
        const { currentUserMsg, dedupBg, dialogue, prefills } = processStream(stream);

        // 初始化：背景块直接采用当前去重背景，对话历史为空
        if (!CacheState.backgroundBlock) {
            CacheState.backgroundBlock = dedupBg;
            CacheState.dialogueHistory = [];
            Logger.log(`[初始化] 背景:${dedupBg.length} 对话:0（已丢弃历史）`, LogLevels.BASIC);
            buildAndApply(stream, dedupBg, [], currentUserMsg, prefills);
            updateStats(true);
            return;
        }

        // 背景相似度检测
        const bgSim = computeSetSimilarity(
            new Set(CacheState.backgroundBlock.map(m => Logger.normalize(m.content))),
            new Set(dedupBg.map(m => Logger.normalize(m.content)))
        );
        Logger.log(`[背景相似度] ${(bgSim*100).toFixed(1)}%`, LogLevels.DEBUG);
        if (bgSim < 0.9) {
            triggerResetAlert('检测到系统提示词核心变动，建议重置缓存前缀以保证性能。');
            return;
        }

        // 对话增量
        const newDial = findNewEntries(CacheState.dialogueHistory, dialogue);
        if (newDial.length > 0) Logger.warn(`[对话增量] +${newDial.length} 条`, LogLevels.DETAILED);
        const updatedDialogue = CacheState.dialogueHistory.concat(newDial);

        if (dialogue.length < CacheState.dialogueHistory.length * 0.7) {
            triggerResetAlert('对话历史被大幅删除，建议重置。');
            return;
        }

        CacheState.dialogueHistory = updatedDialogue;
        buildAndApply(stream, CacheState.backgroundBlock, CacheState.dialogueHistory, currentUserMsg, prefills);
        updateStats(false);

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

function buildAndApply(stream, bg, dialogue, curUser, prefills) {
    const final = [];
    bg.forEach(b => final.push({ role: b.role, content: b.content }));
    dialogue.forEach(d => final.push({ role: d.role, content: d.content }));
    if (curUser) final.push({ role: curUser.role, content: curUser.content });
    prefills.forEach(p => final.push({ role: p.role, content: p.content }));

    if (logLevel >= LogLevels.DEBUG) {
        Logger.log(`[最终序列] bg:${bg.length} dl:${dialogue.length} usr:${curUser?1:0} pf:${prefills.length}`, LogLevels.DEBUG);
        final.forEach((m, i) => Logger.log(`  ${i}: [${m.role}] ${m.content.substring(0, 50)}...`, LogLevels.DEBUG));
    }
    stream.splice(0, stream.length, ...final);
}

function findNewEntries(oldSeq, newSeq) {
    const oldUids = new Set(oldSeq.map(m => `${m.role}:${Logger.simpleHash(m.content)}`));
    return newSeq.filter(m => !oldUids.has(`${m.role}:${Logger.simpleHash(m.content)}`));
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
    const dgTokens = CacheState.dialogueHistory?.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0) ?? 0;
    CacheState.stats.prefixTokens = bgTokens + dgTokens;
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
// 弹窗与阻塞（同前）
// ==========================================
function triggerResetAlert(reason) {
    if (CacheState.blocked) return;
    CacheState.blocked = true;
    Logger.warn('[阻塞] 弹窗已弹出', LogLevels.BASIC);
    const onResolve = (reset) => {
        if (reset) {
            CacheState.backgroundBlock = null;
            CacheState.dialogueHistory = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateStatsUI();
            Logger.warn('[重置] 前缀已清空', LogLevels.BASIC);
        } else Logger.warn('[取消] 不重置', LogLevels.BASIC);
        CacheState.blocked = false;
    };
    if (typeof callPopup === 'function') {
        callPopup(`<h4>缓存优化器</h4><p>${reason}</p>`, [
            { text: '重置', className: 'btn-danger', callback: () => onResolve(true) },
            { text: '取消', callback: () => onResolve(false) }
        ]);
    } else showFallbackDialog(reason, onResolve);
}
function showFallbackDialog(reason, cb) {
    const id = 'ds-reset-fallback-dialog';
    if (document.getElementById(id)) return;
    const d = document.createElement('div');
    d.id = id;
    d.innerHTML = `<div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;"><div style="background:#2b2b2b;color:#ddd;padding:24px;border-radius:8px;max-width:500px;"><h3>缓存优化器提醒</h3><p>${reason}</p><div style="display:flex;justify-content:flex-end;gap:10px;"><button id="ds-cancel" class="btn btn-secondary">取消</button><button id="ds-reset" class="btn btn-danger">重置</button></div></div></div>`;
    document.body.appendChild(d);
    document.getElementById('ds-reset').onclick = () => { cb(true); d.remove(); };
    document.getElementById('ds-cancel').onclick = () => { cb(false); d.remove(); };
}
function performReset() {
    CacheState.backgroundBlock = null;
    CacheState.dialogueHistory = null;
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    CacheState.blocked = false;
    updateStatsUI();
    Logger.warn('[强制重置] 已清空', LogLevels.BASIC);
    const fb = document.getElementById('ds-reset-fallback-dialog');
    if (fb) fb.remove();
}

// ==========================================
// 扩展菜单注册（尝试所有已知方式）
// ==========================================
function registerMenuItems() {
    const menuItem = { label: '重置DS缓存前缀', callback: performReset };
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext().addExtensionMenu) {
            SillyTavern.getContext().addExtensionMenu([menuItem]);
            Logger.log('[菜单] 已通过 SillyTavern API 注册', LogLevels.BASIC);
        } else if (typeof window['registerExtensionsMenu'] === 'function') {
            window['registerExtensionsMenu']([menuItem]);
            Logger.log('[菜单] 已通过 registerExtensionsMenu 注册', LogLevels.BASIC);
        } else {
            extension_settings['ds-cache'] = extension_settings['ds-cache'] || {};
            extension_settings['ds-cache'].menu = [menuItem];
            Logger.warn('[菜单] 采用 extension_settings 注册（需在扩展面板勾选“显示菜单”）', LogLevels.BASIC);
        }
    } catch (e) {
        Logger.error('菜单注册失败', e);
    }
}

// ==========================================
// UI 初始化
// ==========================================
async function setupUI() {
    const html = `
    <div class="inline-drawer" id="ds-v4-opt-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>🧠 DS Cache Optimizer v6.10 (内容分类)</b>
            <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="padding:10px;">
            <p>完全基于内容特征识别系统提示词，摆脱 originalChat 依赖，精确分离背景与对话。</p>
            <div id="ds-cache-stats" style="margin-bottom:8px;"></div>
            <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" checked> 启用</label>
            <div style="margin:8px 0;">
                <span>日志:</span>
                <select id="ds-cache-loglevel">
                    <option value="0">关闭</option><option value="1">简要</option>
                    <option value="2" selected>详细</option><option value="3">调试</option>
                </select>
            </div>
            <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:5px 0;">🔄 强制重置</button>
            <button id="ds-cache-clearlog" class="menu_button" style="width:100%;margin:5px 0;">🗑️ 清空日志</button>
            <textarea id="ds-cache-log" class="text_pole" readonly style="height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
        </div>
    </div>`;
    $('#extensions_settings').append(html);
    Logger._uiTextarea = document.getElementById('ds-cache-log');

    $('#ds-cache-enable').on('change', function() { CacheState.enabled = $(this).is(':checked'); Logger.log(`插件 ${CacheState.enabled?'启用':'停用'}`, LogLevels.BASIC); });
    $('#ds-cache-loglevel').on('change', function() { logLevel = parseInt($(this).val()); Logger.log(`日志等级: ${['关闭','简要','详细','调试'][logLevel]}`, LogLevels.BASIC); });
    $('#ds-cache-reset').on('click', () => performReset());
    $('#ds-cache-clearlog').on('click', () => { if (Logger._uiTextarea) Logger._uiTextarea.value = ''; });
    updateStatsUI();
}

jQuery(async () => {
    await setupUI();
    registerMenuItems();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 钩子已挂载', LogLevels.BASIC);
    } else Logger.error('无法挂载钩子');
    Logger.log('══════ v6.10 就绪，纯内容分类 + 菜单尝试 ══════', LogLevels.BASIC);
});
