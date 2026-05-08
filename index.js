import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志等级 & 基础日志函数
// ==========================================
let logLevel = 2; // 0:silent, 1:basic, 2:detailed, 3:debug
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const prefix = `[${time}]`;
    const fullMsg = `${prefix} ${msg}`;
    if (type === 'warn') {
        console.warn(`%c[DS V4 Opt v4] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS V4 Opt v4] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS V4 Opt v4] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
};

// ==========================================
// 通用工具
// ==========================================
function msgToString(msg) {
    return `${msg.role}:${msg.name || ''}:${msg.content || ''}`;
}

function messagesEqual(a, b) {
    return a.role === b.role && a.content === b.content && (a.name || '') === (b.name || '');
}

function arraysEqual(arr1, arr2) {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i++) {
        if (!messagesEqual(arr1[i], arr2[i])) return false;
    }
    return true;
}

function isSubsequence(short, long) {
    let i = 0;
    for (const msg of long) {
        if (i < short.length && messagesEqual(short[i], msg)) i++;
    }
    return i === short.length;
}

function estimateTokens(text) {
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
}

function totalTokensOfMessages(msgs) {
    return msgs.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

// ==========================================
// 缓存状态机
// ==========================================
const CacheState = {
    enabled: true,
    frozenSystem: [],       // 冻结的系统消息（保持原始顺序，逐条未合并）
    frozenHistory: [],     // 冻结的对话历史（user / assistant）
    stats: {
        total: 0,
        hits: 0,
        savedTokens: 0,
        prefixTokens: 0
    }
};

function resetState(reason) {
    CacheState.frozenSystem = [];
    CacheState.frozenHistory = [];
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    Logger.warn(`重置所有冻结状态：${reason}`, LogLevels.BASIC);
    if (typeof toastr !== 'undefined') {
        toastr.warning(`缓存已重置：${reason}`, 'DS V4 Optimizer');
    }
}

// ==========================================
// 核心拦截重组
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;
    const chat = data.chat;
    if (!chat || !Array.isArray(chat) || chat.length === 0) return;

    CacheState.stats.total++;

    try {
        // 找到最后一个 user 消息的索引，将其之前作为前缀（历史+系统），之后作为当前轮次输入
        let lastUserIdx = -1;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i].role === 'user') {
                lastUserIdx = i;
                break;
            }
        }
        if (lastUserIdx === -1) {
            // 没有 user 消息，极罕见情况，原样返回
            return;
        }

        const prefixPart = chat.slice(0, lastUserIdx);      // 系统 + 历史
        const currentTurn = chat.slice(lastUserIdx);        // [user, (可能的assistant prefill)]
        
        // 分离系统消息与对话历史
        const newSystemMessages = [];
        const newHistory = [];
        for (const msg of prefixPart) {
            if (msg.role === 'system') {
                newSystemMessages.push(msg);
            } else {
                newHistory.push(msg);
            }
        }

        // ---------- 初始化状态 ----------
        if (CacheState.frozenSystem.length === 0 && CacheState.frozenHistory.length === 0) {
            // 首次运行，直接冻结当前前缀
            CacheState.frozenSystem = [...newSystemMessages];
            CacheState.frozenHistory = [...newHistory];
            const finalChat = [...CacheState.frozenSystem, ...CacheState.frozenHistory, ...currentTurn];
            data.chat.splice(0, data.chat.length, ...finalChat);
            CacheState.stats.hits++;
            const prefixTokens = totalTokensOfMessages([...CacheState.frozenSystem, ...CacheState.frozenHistory]);
            CacheState.stats.prefixTokens = prefixTokens;
            CacheState.stats.savedTokens += prefixTokens;
            Logger.log(`首次冻结 ${CacheState.frozenSystem.length} 条系统消息 + ${CacheState.frozenHistory.length} 条对话历史`, LogLevels.BASIC);
            return;
        }

        // ---------- 检测系统消息变化 ----------
        const systemChanged = !arraysEqual(CacheState.frozenSystem, newSystemMessages);
        const historyChanged = !arraysEqual(CacheState.frozenHistory, newHistory);

        if (!systemChanged && !historyChanged) {
            // 完美命中：前缀完全不变，直接拼接
            const finalChat = [...CacheState.frozenSystem, ...CacheState.frozenHistory, ...currentTurn];
            data.chat.splice(0, data.chat.length, ...finalChat);
            CacheState.stats.hits++;
            const prefixTokens = totalTokensOfMessages([...CacheState.frozenSystem, ...CacheState.frozenHistory]);
            CacheState.stats.savedTokens += prefixTokens;
            Logger.log('✅ 缓存完美命中', LogLevels.DETAILED);
            return;
        }

        // ---------- 变化处理 ----------
        // 1. 检查是否仅增加了系统消息（顺序保持，原有部分保留）
        if (!historyChanged && isSubsequence(CacheState.frozenSystem, newSystemMessages)) {
            // 新增系统消息
            const addedSystem = newSystemMessages.slice(CacheState.frozenSystem.length);
            Logger.log(`检测到 ${addedSystem.length} 条新增系统指令，追加至历史之后`, LogLevels.BASIC);
            // 更新冻结状态
            CacheState.frozenSystem = [...newSystemMessages];
            const finalChat = [...CacheState.frozenSystem, ...CacheState.frozenHistory, ...currentTurn];
            data.chat.splice(0, data.chat.length, ...finalChat);
            CacheState.stats.hits++;
            const prefixTokens = totalTokensOfMessages([...CacheState.frozenSystem, ...CacheState.frozenHistory]);
            CacheState.stats.savedTokens += prefixTokens;
            CacheState.stats.prefixTokens = prefixTokens;
            return;
        }

        // 2. 发生了系统消息删除或修改，或对话历史变化
        const prevSystemTokens = totalTokensOfMessages(CacheState.frozenSystem);
        const newSystemTokens = totalTokensOfMessages(newSystemMessages);
        const systemChangeRatio = prevSystemTokens > 0 ? Math.abs(newSystemTokens - prevSystemTokens) / prevSystemTokens : 1;

        const prevHistoryTokens = totalTokensOfMessages(CacheState.frozenHistory);
        const newHistoryTokens = totalTokensOfMessages(newHistory);
        const historyChangeRatio = prevHistoryTokens > 0 ? Math.abs(newHistoryTokens - prevHistoryTokens) / prevHistoryTokens : 1;

        const isDrasticChange = (systemChangeRatio > 0.3 && newSystemTokens < prevSystemTokens * 0.7) // 系统消息大幅缩减
            || (historyChangeRatio > 0.3 && newHistoryTokens < prevHistoryTokens * 0.7) // 历史大幅缩减
            || (systemChanged && !isSubsequence(CacheState.frozenSystem, newSystemMessages) && newSystemTokens < prevSystemTokens * 0.5)
            || (historyChanged && !isSubsequence(CacheState.frozenHistory, newHistory) && newHistoryTokens < prevHistoryTokens * 0.5);

        if (isDrasticChange) {
            resetState('检测到大规模删减或更换预设/角色卡');
            // 重置后重新初始化
            CacheState.frozenSystem = [...newSystemMessages];
            CacheState.frozenHistory = [...newHistory];
            const finalChat = [...CacheState.frozenSystem, ...CacheState.frozenHistory, ...currentTurn];
            data.chat.splice(0, data.chat.length, ...finalChat);
            CacheState.stats.hits++;
            const prefixTokens = totalTokensOfMessages([...CacheState.frozenSystem, ...CacheState.frozenHistory]);
            CacheState.stats.prefixTokens = prefixTokens;
            CacheState.stats.savedTokens += prefixTokens;
            Logger.warn('已重置并重建冻结状态', LogLevels.BASIC);
            return;
        }

        // 3. 非剧烈变化：更新冻结状态，部分缓存失效
        Logger.warn('提示词或对话历史发生小幅变化，缓存局部失效，冻结状态已更新', LogLevels.BASIC);
        CacheState.frozenSystem = [...newSystemMessages];
        CacheState.frozenHistory = [...newHistory];
        const finalChat = [...CacheState.frozenSystem, ...CacheState.frozenHistory, ...currentTurn];
        data.chat.splice(0, data.chat.length, ...finalChat);
        // 仍计为一次命中（因为后续会重新稳定）
        CacheState.stats.hits++;
        const prefixTokens = totalTokensOfMessages([...CacheState.frozenSystem, ...CacheState.frozenHistory]);
        CacheState.stats.savedTokens += prefixTokens;
        CacheState.stats.prefixTokens = prefixTokens;
    } catch (err) {
        Logger.error('拦截器错误', err);
    }
}

// ==========================================
// UI 与统计
// ==========================================
function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `
        <span>命中: ${hits}/${total} (${rate}%)</span>
        <span style="margin-left:10px;">前缀: ~${prefixTokens.toLocaleString()}t</span>
        <span style="margin-left:10px;">共省: ~${savedTokens.toLocaleString()}t</span>
        <span style="margin-left:10px;">冻结消息: ${CacheState.frozenSystem.length + CacheState.frozenHistory.length} 条</span>
    `;
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>DS V4 Cache Optimizer</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">逐条冻结 · 新指令后置 · 极致缓存命中率</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;"></div>
                <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" id="ds-cache-enable" checked> 启用拦截器
                </label>
                <div style="display:flex;align-items:center;gap:8px;margin:8px 0;">
                    <span style="font-size:0.9em;">日志等级:</span>
                    <select id="ds-cache-loglevel" style="flex:1;">
                        <option value="0">关闭</option>
                        <option value="1">简要</option>
                        <option value="2" selected>详细</option>
                        <option value="3">调试</option>
                    </select>
                </div>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置冻结状态</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');
        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`状态: ${CacheState.enabled ? '启用' : '停用'}`, LogLevels.BASIC);
        });
        $('#ds-cache-loglevel').on('change', function() {
            logLevel = parseInt($(this).val());
            Logger.log(`日志等级设为: ${['关闭','简要','详细','调试'][logLevel]}`, LogLevels.BASIC);
        });
        $('#ds-cache-reset').on('click', () => {
            resetState('手动重置');
            updateStatsUI();
        });
        updateStatsUI();
    } catch (e) {
        Logger.error('UI初始化失败', e);
    }
}

// ==========================================
// 启动
// ==========================================
jQuery(async () => {
    console.log('DS V4 Optimizer v4.1 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('已挂载事件钩子', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v4.1 就绪，逐条冻结 + 新增指令后置 ══════', LogLevels.BASIC);
});
