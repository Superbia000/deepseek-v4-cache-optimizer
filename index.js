import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, substituteParams } from '../../../../script.js';

// ==========================================
// 日志系统 (支持等级)
// ==========================================
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
        if (type === 'error') console.error('[DS V4 Opt v5.3]', text);
        else if (type === 'warn') console.warn('[DS V4 Opt v5.3]', text);
        else console.log('%c[DS V4 Opt v5.3]', 'color:#00ff00;font-weight:bold', text);
    }
};
function append(type, msg) { Logger._appendLine(type, msg); }

// ==========================================
// 实用工具
// ==========================================
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
    return text.replace(/\s+/g, ' ')
               .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
               .replace(/[，。！？、；：]/g, m => ({
                   '，': ',', '。': '.', '！': '!', '？': '?', '、': ',', '；': ';', '：': ':'
               })[m] || m)
               .trim();
}

// ==========================================
// 缓存状态机
// ==========================================
const CacheState = {
    enabled: true,
    lockedPromptBlocks: [],   // 提示词管理器条目 (已渲染)
    lockedOtherBlocks: [],    // 其他 system 提示词 (如插件注入)
    lockedWorldBlocks: [],    // 世界书条目 (已渲染)
    lockedHistory: [],        // 历史对话 (user/assistant) 不含当前输入
    // 指纹
    promptFp: null,
    otherFp: null,
    worldFp: null,
    historyFp: null,
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// ==========================================
// 提示词获取函数
// ==========================================
function getOrderedPrompts() {
    const pw = window['power_user'];
    if (!pw || !pw.prompts) return [];
    return pw.prompts
        .filter(p => p.is_enabled)
        .sort((a, b) => a.order - b.order)
        .map(p => {
            try {
                const content = substituteParams(p.content);
                return content.trim().length > 0 ? { role: 'system', content } : null;
            } catch (e) { return null; }
        })
        .filter(Boolean);
}

function getOrderedWorldEntries() {
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

function getRealHistory() {
    const ctx = getContext();
    if (!ctx || !ctx.chat) return [];
    return ctx.chat
        .filter(msg => !msg.is_system)  // 过滤掉系统消息
        .map(msg => ({
            role: msg.is_user ? 'user' : 'assistant',
            content: msg.mes || ''
        }))
        .filter(m => m.content.length > 0);
}

// ==========================================
// 核心重组引擎
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`====== [请求 #${CacheState.stats.total}] ======`, 2);

        const original = data.chat;
        if (!original || !original.length) return;

        // 1. 提取末尾的预填充消息和当前用户输入
        const messages = [...original];
        const prefills = [];
        while (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
            prefills.unshift(messages.pop());
        }
        let currentUserMsg = null;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
                currentUserMsg = messages.splice(i, 1)[0];
                break;
            }
        }
        if (!currentUserMsg) {
            Logger.warn('未找到当前用户输入，取消重组', 1);
            return;
        }

        // 2. 获取当前真实的提示词配置
        const currentPrompts = getOrderedPrompts();
        const currentWorlds = getOrderedWorldEntries();

        // 3. 找出 data.chat 中剩下的 system 消息，并将其分类
        //    属于 currentPrompts 或 currentWorlds 的会通过内容匹配标识，其余的就是“其他提示词”
        const promptContents = new Set(currentPrompts.map(p => normalize(p.content)));
        const worldContents = new Set(currentWorlds.map(w => normalize(w.content)));
        const currentOther = [];
        for (const msg of messages) {
            if (msg.role === 'system') {
                const n = normalize(msg.content);
                if (!promptContents.has(n) && !worldContents.has(n)) {
                    currentOther.push(msg);
                }
            }
        }

        // 4. 获取真实历史并分离出当前输入（从 ST 的完整 chat 中提取）
        const realHistory = getRealHistory();
        let currentInputIndex = -1;
        for (let i = realHistory.length - 1; i >= 0; i--) {
            if (realHistory[i].role === 'user' && normalize(realHistory[i].content) === normalize(currentUserMsg.content)) {
                currentInputIndex = i;
                break;
            }
        }
        if (currentInputIndex === -1) {
            Logger.error('无法在历史记录中找到当前用户输入', null, 1);
            return;
        }
        const previousHistory = realHistory.slice(0, currentInputIndex);  // 之前的所有对话

        // 5. 初始化或重置检测
        const newPromptFp = currentPrompts.map(m => simpleHash(normalize(m.content))).join('|');
        const newOtherFp = currentOther.map(m => simpleHash(normalize(m.content))).join('|');
        const newWorldFp = currentWorlds.map(m => simpleHash(normalize(m.content))).join('|');
        const newHistoryFp = previousHistory.map(m => simpleHash(normalize(m.content))).join('|');

        if (!CacheState.lockedPromptBlocks) {
            // 第一次请求，锁定所有内容
            CacheState.lockedPromptBlocks = currentPrompts;
            CacheState.lockedOtherBlocks = currentOther;
            CacheState.lockedWorldBlocks = currentWorlds;
            CacheState.lockedHistory = previousHistory;
            CacheState.promptFp = newPromptFp;
            CacheState.otherFp = newOtherFp;
            CacheState.worldFp = newWorldFp;
            CacheState.historyFp = newHistoryFp;
            Logger.log('[初始化] 提示词/世界书/历史已锁定', 2);
            // 构建最终消息
            const finalMessages = [
                ...CacheState.lockedPromptBlocks,
                ...CacheState.lockedOtherBlocks,
                ...CacheState.lockedWorldBlocks,
                ...CacheState.lockedHistory,
                currentUserMsg,
                ...prefills
            ];
            data.chat.splice(0, data.chat.length, ...finalMessages);
            updateStats(true);
            return;
        }

        // 6. 检测核心内容是否发生非“追加”性变化
        const promptChanged = newPromptFp !== CacheState.promptFp;
        const otherChanged = newOtherFp !== CacheState.otherFp;
        const worldChanged = newWorldFp !== CacheState.worldFp;
        const historyChanged = newHistoryFp !== CacheState.historyFp;

        const isPromptAppend = promptChanged && newPromptFp.startsWith(CacheState.promptFp);
        const isOtherAppend = otherChanged && newOtherFp.startsWith(CacheState.otherFp);
        const isWorldAppend = worldChanged && newWorldFp.startsWith(CacheState.worldFp);
        // 历史除非是追加新轮次，否则一律重置（删除历史消息属于破坏性变化）
        const isHistoryAppend = historyChanged && newHistoryFp.startsWith(CacheState.historyFp);

        if ((promptChanged && !isPromptAppend) || (otherChanged && !isOtherAppend) || (worldChanged && !isWorldAppend) || (historyChanged && !isHistoryAppend)) {
            Logger.warn('[重置] 检测到核心内容被修改/删除/重排，将重置缓存状态', 1);
            if (typeof toastr !== 'undefined') toastr.warning('提示词或世界书结构发生变化，缓存前缀已重置。', '缓存优化器');
            CacheState.lockedPromptBlocks = null;
            CacheState.lockedOtherBlocks = null;
            CacheState.lockedWorldBlocks = null;
            CacheState.lockedHistory = null;
            CacheState.promptFp = null;
            CacheState.otherFp = null;
            CacheState.worldFp = null;
            CacheState.historyFp = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            interceptAndRestructurePrompt(data);
            return;
        }

        // 7. 收集新增的条目（将在历史之后、当前输入之前追加）
        let appendedPrompts = [];
        let appendedOthers = [];
        let appendedWorlds = [];

        if (isPromptAppend) {
            const oldLen = CacheState.lockedPromptBlocks.length;
            appendedPrompts = currentPrompts.slice(oldLen);
            CacheState.lockedPromptBlocks = currentPrompts;
            CacheState.promptFp = newPromptFp;
            Logger.warn(`[追加] 新增 ${appendedPrompts.length} 个预设提示词`, 2);
        }
        if (isOtherAppend) {
            const oldLen = CacheState.lockedOtherBlocks.length;
            appendedOthers = currentOther.slice(oldLen);
            CacheState.lockedOtherBlocks = currentOther;
            CacheState.otherFp = newOtherFp;
            Logger.warn(`[追加] 新增 ${appendedOthers.length} 个其他提示词`, 2);
        }
        if (isWorldAppend) {
            const oldLen = CacheState.lockedWorldBlocks.length;
            appendedWorlds = currentWorlds.slice(oldLen);
            CacheState.lockedWorldBlocks = currentWorlds;
            CacheState.worldFp = newWorldFp;
            Logger.warn(`[追加] 新增 ${appendedWorlds.length} 个世界书条目`, 2);
        }
        if (isHistoryAppend) {
            // 历史只会增加新轮次，直接更新
            CacheState.lockedHistory = previousHistory;
            CacheState.historyFp = newHistoryFp;
        }

        // 8. 组装最终消息
        const finalMessages = [
            ...CacheState.lockedPromptBlocks,
            ...CacheState.lockedOtherBlocks,
            ...CacheState.lockedWorldBlocks,
            ...CacheState.lockedHistory,
            ...appendedPrompts,
            ...appendedOthers,
            ...appendedWorlds,
            currentUserMsg,
            ...prefills
        ];

        data.chat.splice(0, data.chat.length, ...finalMessages);

        // 统计缓存命中（静态前缀 token 数）
        const prefixTokens = estimateTokens(
            CacheState.lockedPromptBlocks.concat(CacheState.lockedOtherBlocks)
                .concat(CacheState.lockedWorldBlocks).concat(CacheState.lockedHistory)
                .map(m => m.content).join('')
        );
        CacheState.stats.prefixTokens = prefixTokens;
        CacheState.stats.hits++;
        CacheState.stats.savedTokens += prefixTokens;
        Logger.log(`✅ 缓存命中！静态前缀 ~${prefixTokens} tokens 完全复用`, 2);
        updateStats();

    } catch (err) {
        Logger.error('拦截器致命错误', err, 1);
    }
}

// ==========================================
// UI 更新
// ==========================================
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
                <b>🧠 DS V4 缓存优化器 v5.3 (严格排序版)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">严格按 预设提示词 → 其他提示词 → 世界书 → 历史 排序，新增条目自动追加到历史之后，确保缓存极限命中。</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;"></div>
                <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" id="ds-cache-enable" checked> 启用自动化缓存优化
                </label>
                <div style="display:flex;align-items:center;gap:8px;margin:8px 0;">
                    <span style="font-size:0.9em;">日志等级:</span>
                    <select id="ds-cache-loglevel">
                        <option value="0">关闭</option>
                        <option value="1">简要</option>
                        <option value="2" selected>详细</option>
                        <option value="3">调试</option>
                    </select>
                </div>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置 (下次请求自动重建)</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');
        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`插件状态: ${CacheState.enabled ? '启用' : '停用'}`, 2);
        });
        $('#ds-cache-loglevel').on('change', function() {
            logLevel = parseInt($(this).val());
            Logger.log(`日志等级设为: ${['关闭','简要','详细','调试'][logLevel]}`, 2);
        });
        $('#ds-cache-reset').on('click', () => {
            CacheState.lockedPromptBlocks = null;
            CacheState.lockedOtherBlocks = null;
            CacheState.lockedWorldBlocks = null;
            CacheState.lockedHistory = null;
            CacheState.promptFp = null;
            CacheState.otherFp = null;
            CacheState.worldFp = null;
            CacheState.historyFp = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateStats();
            Logger.warn('已强制重置，下一轮将重新锁定', 1);
        });
        updateStats();
    } catch (e) {
        Logger.error('UI初始化失败', e);
    }
}

// ==========================================
// 启动
// ==========================================
jQuery(async () => {
    console.log('DS V4 Optimizer v5.3 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 已挂载 CHAT_COMPLETION_PROMPT_READY 钩子', 2);
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v5.3 就绪，严格排序 + 完全自动化 ══════', 2);
});
