import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, substituteParams } from '../../../../script.js';

// ========== 日志 ==========
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
        if (type === 'error') console.error('[DS V4 Opt v5.6]', text);
        else if (type === 'warn') console.warn('[DS V4 Opt v5.6]', text);
        else console.log('%c[DS V4 Opt v5.6]', 'color:#00ff00;font-weight:bold', text);
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

// 判断字符串是否包含世界书占位宏
function isWorldInfoMacro(content) {
    // 匹配可能的宏，例如 {{worldInfo}}, {{wiBefore}}, {{wiAfter}}, {{world}}, 等等
    return /\{\{(worldInfo|wiBefore|wiAfter|world)\b/i.test(content) ||
           /\{\{world\s*\}\}/i.test(content);
}

// 获取预设提示词（排除世界书占位符条目）
function getPresetPrompts() {
    const pw = window['power_user'];
    if (!pw || !pw.prompts) return [];
    return pw.prompts
        .filter(p => p.is_enabled && !isWorldInfoMacro(p.content)) // 过滤掉世界书占位符
        .sort((a, b) => a.order - b.order)
        .map(p => {
            try {
                const content = substituteParams(p.content);
                return content.trim().length > 0 ? { role: 'system', content } : null;
            } catch (e) { return null; }
        })
        .filter(Boolean);
}

// 获取世界书条目（已渲染）
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

// 获取完整对话历史（来自 chat，不含 system 消息）
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

// 从 data.chat 提取不属于预设和世界书的 system 消息作为“其他提示词”
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

        // 1. 预填充
        const prefills = [];
        let lastIdx = original.length - 1;
        while (lastIdx >= 0 && original[lastIdx].role === 'assistant') {
            prefills.unshift(original[lastIdx]);
            lastIdx--;
        }

        // 2. 获取世界书条目
        const currentWorlds = getWorldEntries();
        const worldSet = new Set(currentWorlds.map(w => normalize(w.content)));

        // 3. 获取预设提示词（已排除世界书占位符）
        const currentPresets = getPresetPrompts();
        const presetSet = new Set(currentPresets.map(p => normalize(p.content)));

        // 4. 历史对话
        const fullHistory = getFullChatHistory();
        if (fullHistory.length === 0) {
            Logger.warn('没有对话历史', 1);
            return;
        }
        const currentUserMsg = fullHistory[fullHistory.length - 1];
        if (currentUserMsg.role !== 'user') {
            Logger.warn('最后一条消息不是 user', 1);
            return;
        }
        const previousHistory = fullHistory.slice(0, -1);

        // 5. 其他提示词
        const currentOthers = extractOtherPrompts(original, presetSet, worldSet);

        // 6. 指纹
        const newPresetFp = currentPresets.map(m => simpleHash(normalize(m.content))).join('|');
        const newOtherFp = currentOthers.map(m => simpleHash(normalize(m.content))).join('|');
        const newWorldFp = currentWorlds.map(m => simpleHash(normalize(m.content))).join('|');
        const newHistoryFp = previousHistory.map(m => simpleHash(normalize(m.content))).join('|');

        // 7. 初始化/重置
        if (!CacheState.lockedPresetPrompts) {
            Object.assign(CacheState, {
                lockedPresetPrompts: currentPresets,
                lockedOtherPrompts: currentOthers,
                lockedWorldEntries: currentWorlds,
                lockedHistory: previousHistory,
                presetFp: newPresetFp,
                otherFp: newOtherFp,
                worldFp: newWorldFp,
                historyFp: newHistoryFp
            });
            Logger.log(`[初始化] 预设${currentPresets.length}条, 其他${currentOthers.length}条, 世界书${currentWorlds.length}条, 历史${previousHistory.length}条`, 2);
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

        if ((presetChanged && !isPresetAppend) || (otherChanged && !isOtherAppend) || (worldChanged && !isWorldAppend) || (historyChanged && !isHistoryAppend)) {
            Logger.warn('[核心重置] 提示词/世界书/历史发生非追加性变化，自动重置', 1);
            if (typeof toastr !== 'undefined') toastr.warning('提示词结构变化，缓存前缀已重置。', '缓存优化器');
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

        // 9. 追加新增
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
            appendedOthers = currentOthers.slice(oldLen);
            CacheState.lockedOtherPrompts = currentOthers;
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

        // 10. 最终序列
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

        if (logLevel >= 3) {
            const preview = finalMessages.map(m => `[${m.role}] ${m.content.substring(0, 40)}...`).join('\n');
            Logger.log('[最终消息序列]\n' + preview, 3);
        }
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
                <b>🧠 DS V4 缓存优化器 v5.6</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">严格排序：预设提示词 → 其他提示词 → 世界书条目 → 历史对话 → 当前输入 → 预填充。世界书占位符自动过滤。</p>
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
    console.log('DS V4 Optimizer v5.6 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 已挂载钩子', 2);
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v5.6 就绪，世界书占位符已彻底过滤 ══════', 2);
});
