import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, substituteParams } from '../../../../script.js';

// ========== 日志系统 ==========
let logLevel = 2;
const Logger = {
    _uiTextarea: null,
    log: (msg, level = 2) => { if (logLevel >= level) append('log', msg); },
    warn: (msg, level = 1) => { if (logLevel >= level) append('warn', msg); },
    error: (msg, err, level = 1) => { if (logLevel >= level) append('error', err ? msg + ' ' + err : msg); },
    _appendLine(type, text) {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const prefix = type === 'error' ? '🔴' : (type === 'warn' ? '🌪️' : '✅');
        const line = `[${time}] ${prefix} ${text}`;
        if (Logger._uiTextarea) {
            Logger._uiTextarea.value += line + '\n';
            Logger._uiTextarea.scrollTop = Logger._uiTextarea.scrollHeight;
        }
        if (type === 'error') console.error('[DS V4 Opt v5.7]', text);
        else if (type === 'warn') console.warn('[DS V4 Opt v5.7]', text);
        else console.log('%c[DS V4 Opt v5.7]', 'color:#00ff00;font-weight:bold', text);
    }
};
function append(type, msg) { Logger._appendLine(type, msg); }

// ========== 工具 ==========
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
function estimateTokens(text) {
    if (!text) return 0;
    let t = 0;
    for (const ch of text) {
        const code = ch.charCodeAt(0);
        if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3040 && code <= 0x30FF) || (code >= 0xAC00 && code <= 0xD7AF)) t += 1;
        else t += 0.25;
    }
    return Math.ceil(t);
}
function normalize(text) {
    return text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
        .replace(/[，。！？、；：]/g, m => ({
            '，': ',', '。': '.', '！': '!', '？': '?', '、': ',', '；': ';', '：': ':'
        })[m] || m).trim();
}

// ========== 状态机 ==========
const CacheState = {
    enabled: true,
    lockedPresetPrompts: [],
    lockedOtherPrompts: [],
    lockedWorldEntries: [],
    lockedHistory: [],
    presetFp: null,
    otherFp: null,
    worldFp: null,
    historyFp: null,
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// 判断 prompt 内容是否为世界书占位符宏
function isWorldInfoMacro(content) {
    return /\{\{(worldInfo|wiBefore|wiAfter|world)\b/i.test(content);
}

// 获取预设提示词（已过滤世界书占位符）
function getPresetPrompts() {
    const pw = window['power_user'];
    if (!pw || !pw.prompts) return [];
    return pw.prompts
        .filter(p => p.is_enabled && !isWorldInfoMacro(p.content))
        .sort((a, b) => a.order - b.order)
        .map(p => {
            try {
                const content = substituteParams(p.content);
                return content.trim().length > 0 ? { role: 'system', content } : null;
            } catch (e) { return null; }
        })
        .filter(Boolean);
}

// 获取世界书条目（逐条渲染，作为独立消息）
function getWorldEntries() {
    const ctx = getContext();
    if (!ctx || !ctx.worldInfo) return [];
    return ctx.worldInfo.entries
        .filter(e => !e.disable)
        .sort((a, b) => a.order - b.order)
        .map(e => {
            try {
                const content = substituteParams(e.content);
                return content.trim().length > 0 ? { role: 'system', content } : null;
            } catch (e) { return null; }
        })
        .filter(Boolean);
}

// 获取完整对话历史（来自 ST 的 chat 对象，不含 system 消息）
function getFullChatHistory() {
    const ctx = getContext();
    if (!ctx || !ctx.chat) return [];
    return ctx.chat
        .filter(msg => !msg.is_system)
        .map(msg => ({
            role: msg.is_user ? 'user' : 'assistant',
            content: msg.mes || ''
        }))
        .filter(m => m.content.length > 0);
}

// 从 data.chat 提取不属于预设和世界书的 system 消息，作为“其他提示词”
function extractOtherPrompts(dataChat, presetSet, worldSet) {
    const others = [];
    for (const msg of dataChat) {
        if (msg.role !== 'system') continue;
        const n = normalize(msg.content);
        if (!presetSet.has(n) && !worldSet.has(n)) {
            if (!others.some(o => normalize(o.content) === n)) {
                others.push({ role: 'system', content: msg.content });
            }
        }
    }
    return others;
}

// ========== 核心重组 ==========
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`====== [请求 #${CacheState.stats.total}] ======`, 2);

        const original = data.chat;
        if (!original || !original.length) return;

        // 1. 提取预填充和当前用户输入（需要保留原始 data.chat 中的结构以获取真实预填充）
        const messages = [...original];
        const prefills = [];
        while (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
            prefills.unshift(messages.pop());
        }
        // 当前用户输入是 messages 中最后一条 user 消息
        let currentUserMsg = null;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
                currentUserMsg = messages.splice(i, 1)[0];
                break;
            }
        }
        if (!currentUserMsg) {
            Logger.warn('未找到当前用户输入', 1);
            return;
        }

        // 2. 获取权威的世界书条目列表（我们自行渲染）
        const currentWorlds = getWorldEntries();
        const worldSet = new Set(currentWorlds.map(w => normalize(w.content)));

        // 3. 获取预设提示词（已过滤世界书占位符）
        const currentPresets = getPresetPrompts();
        const presetSet = new Set(currentPresets.map(p => normalize(p.content)));

        // 4. 获取完整对话历史（来自 ST chat，不包括 system 消息）
        const fullHistory = getFullChatHistory();
        if (fullHistory.length === 0) {
            Logger.warn('对话历史为空', 1);
            return;
        }
        const currentUserIndex = fullHistory.findIndex(
            m => m.role === 'user' && normalize(m.content) === normalize(currentUserMsg.content)
        );
        if (currentUserIndex === -1) {
            Logger.error('无法在完整历史中定位当前用户输入', null, 1);
            return;
        }
        const previousHistory = fullHistory.slice(0, currentUserIndex);

        // 5. 提取“其他提示词”：从 data.chat 的 system 消息中，排除预设和世界书条目，
        //    同时也要排除那些可能包裹了世界书内容的 system 消息（即消息中包含了任一世界书条目文本）
        const otherPromises = [];
        for (const msg of messages) {  // 注意 messages 已经移除了当前用户输入和预填充
            if (msg.role !== 'system') continue;
            const n = normalize(msg.content);
            // 如果该消息内容完全匹配某个预设条目 -> 跳过（预设已单独生成）
            if (presetSet.has(n)) continue;
            // 如果该消息内容包含任何世界书条目的文本（可能是包裹后的合并消息），则整条丢弃
            const containsWorldContent = currentWorlds.some(w => msg.content.includes(w.content));
            if (containsWorldContent) {
                Logger.log(`丢弃包含世界书内容的 system 消息: ${msg.content.substring(0, 50)}...`, 3);
                continue;
            }
            // 剩余的非重复消息作为“其他提示词”
            if (!otherPromises.some(o => normalize(o.content) === n)) {
                otherPromises.push({ role: 'system', content: msg.content });
            }
        }
        // 注意：messages 中可能还剩下一些 user/assistant 消息（极少情况），但我们不使用它们，因为历史已经由 previousHistory 提供

        // 6. 指纹计算
        const newPresetFp = currentPresets.map(m => simpleHash(normalize(m.content))).join('|');
        const newOtherFp = otherPromises.map(m => simpleHash(normalize(m.content))).join('|');
        const newWorldFp = currentWorlds.map(m => simpleHash(normalize(m.content))).join('|');
        const newHistoryFp = previousHistory.map(m => simpleHash(normalize(m.content))).join('|');

        // 7. 初始化或重置检测
        if (!CacheState.lockedPresetPrompts) {
            Object.assign(CacheState, {
                lockedPresetPrompts: currentPresets,
                lockedOtherPrompts: otherPromises,
                lockedWorldEntries: currentWorlds,
                lockedHistory: previousHistory,
                presetFp: newPresetFp,
                otherFp: newOtherFp,
                worldFp: newWorldFp,
                historyFp: newHistoryFp
            });
            Logger.log(`[初始化] 预设${currentPresets.length}条, 其他${otherPromises.length}条, 世界书${currentWorlds.length}条, 历史${previousHistory.length}条`, 2);
            const finalMessages = [
                ...CacheState.lockedPresetPrompts,
                ...CacheState.lockedOtherPrompts,
                ...CacheState.lockedWorldEntries,
                ...CacheState.lockedHistory,
                currentUserMsg,
                ...prefills
            ];
            data.chat.splice(0, data.chat.length, ...finalMessages);
            updateStats();
            return;
        }

        // 8. 变化检测
        const presetChanged = newPresetFp !== CacheState.presetFp;
        const otherChanged = newOtherFp !== CacheState.otherFp;
        const worldChanged = newWorldFp !== CacheState.worldFp;
        const historyChanged = newHistoryFp !== CacheState.historyFp;

        const isPresetAppend = presetChanged && newPresetFp.startsWith(CacheState.presetFp);
        const isOtherAppend = otherChanged && newOtherFp.startsWith(CacheState.otherFp);
        const isWorldAppend = worldChanged && newWorldFp.startsWith(CacheState.worldFp);
        const isHistoryAppend = historyChanged && newHistoryFp.startsWith(CacheState.historyFp);

        // 任何非追加性变化 -> 重置
        if ((presetChanged && !isPresetAppend) || (otherChanged && !isOtherAppend) || (worldChanged && !isWorldAppend) || (historyChanged && !isHistoryAppend)) {
            Logger.warn('[核心重置] 提示词/世界书/历史发生修改或删除，自动重置', 1);
            if (typeof toastr !== 'undefined') toastr.warning('内容结构变化，缓存前缀已重置。', '缓存优化器');
            CacheState.lockedPresetPrompts = null;
            CacheState.lockedOtherPrompts = null;
            CacheState.lockedWorldEntries = null;
            CacheState.lockedHistory = null;
            CacheState.presetFp = null;
            CacheState.otherFp = null;
            CacheState.worldFp = null;
            CacheState.historyFp = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            interceptAndRestructurePrompt(data);
            return;
        }

        // 9. 处理新增条目
        let appendedPresets = [];
        let appendedOthers = [];
        let appendedWorlds = [];

        if (isPresetAppend) {
            const oldLen = CacheState.lockedPresetPrompts.length;
            appendedPresets = currentPresets.slice(oldLen);
            CacheState.lockedPresetPrompts = currentPresets;
            CacheState.presetFp = newPresetFp;
            Logger.warn(`[追加] ${appendedPresets.length} 条新预设提示词`, 2);
        }
        if (isOtherAppend) {
            const oldLen = CacheState.lockedOtherPrompts.length;
            appendedOthers = otherPromises.slice(oldLen);
            CacheState.lockedOtherPrompts = otherPromises;
            CacheState.otherFp = newOtherFp;
            Logger.warn(`[追加] ${appendedOthers.length} 条其他提示词`, 2);
        }
        if (isWorldAppend) {
            const oldLen = CacheState.lockedWorldEntries.length;
            appendedWorlds = currentWorlds.slice(oldLen);
            CacheState.lockedWorldEntries = currentWorlds;
            CacheState.worldFp = newWorldFp;
            Logger.warn(`[追加] ${appendedWorlds.length} 条世界书条目`, 2);
        }
        if (isHistoryAppend) {
            CacheState.lockedHistory = previousHistory;
            CacheState.historyFp = newHistoryFp;
        }

        // 10. 构建最终消息序列：预设提示词 → 其他提示词 → 世界书条目 → 锁定历史 → 新增条目 → 当前输入 → 预填充
        const finalMessages = [
            ...CacheState.lockedPresetPrompts,
            ...CacheState.lockedOtherPrompts,
            ...CacheState.lockedWorldEntries,
            ...CacheState.lockedHistory,
            ...appendedPresets,
            ...appendedOthers,
            ...appendedWorlds,
            currentUserMsg,
            ...prefills
        ];

        data.chat.splice(0, data.chat.length, ...finalMessages);

        const prefixTokens = estimateTokens(
            CacheState.lockedPresetPrompts.concat(CacheState.lockedOtherPrompts, CacheState.lockedWorldEntries, CacheState.lockedHistory)
                .map(m => m.content).join('')
        );
        CacheState.stats.prefixTokens = prefixTokens;
        CacheState.stats.hits++;
        CacheState.stats.savedTokens += prefixTokens;
        Logger.log(`✅ 缓存命中！静态前缀 ${prefixTokens} tokens`, 2);

        updateStats();

    } catch (err) {
        Logger.error('拦截器致命错误', err, 1);
    }
}

// ========== UI ==========
function updateStats() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `命中: ${hits}/${total} (${rate}%) | 前缀: ~${prefixTokens.toLocaleString()}t | 节省: ~${savedTokens.toLocaleString()}t`;
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DS V4 缓存优化器 v5.7</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">严格排序：预设→其他→世界书（逐条）→历史→当前输入→预填充。所有世界书条目均独立成块，绝不混入预设。</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;"></div>
                <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" checked> 启用自动化缓存优化</label>
                <div style="display:flex;align-items:center;gap:8px;margin:8px 0;">
                    <span>日志等级:</span>
                    <select id="ds-cache-loglevel">
                        <option value="0">关闭</option>
                        <option value="1">简要</option>
                        <option value="2" selected>详细</option>
                        <option value="3">调试</option>
                    </select>
                </div>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');
        $('#ds-cache-enable').on('change', function() { CacheState.enabled = $(this).is(':checked'); });
        $('#ds-cache-loglevel').on('change', function() { logLevel = parseInt($(this).val()); });
        $('#ds-cache-reset').on('click', () => {
            CacheState.lockedPresetPrompts = null;
            CacheState.lockedOtherPrompts = null;
            CacheState.lockedWorldEntries = null;
            CacheState.lockedHistory = null;
            CacheState.presetFp = null;
            CacheState.otherFp = null;
            CacheState.worldFp = null;
            CacheState.historyFp = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateStats();
            Logger.warn('已强制重置', 1);
        });
        updateStats();
    } catch (e) {
        Logger.error('UI初始化失败', e);
    }
}

// ========== 启动 ==========
jQuery(async () => {
    console.log('DS V4 Optimizer v5.7 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 已挂载钩子', 2);
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v5.7 就绪，世界书彻底独立，绝对排序 ══════', 2);
});
