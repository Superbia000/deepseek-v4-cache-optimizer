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
// 简单 hash 与 token 估算
// ==========================================
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
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

// ==========================================
// 缓存状态机
// ==========================================
const CacheState = {
    enabled: true,
    frozenArray: [],             // 已冻结的消息序列（完整对象）
    frozenSystemFingerprints: new Set(),  // system 提示词指纹 (role::content)
    frozenChatMesIds: new Set(),         // 已有 mesId 的消息 ID 集合
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// 生成消息的唯一标识（优先使用 mesId，否则用 role::content 指纹）
function getMessageKey(msg) {
    if (msg.mesId !== undefined && msg.mesId !== null) {
        return `id:${msg.mesId}`;
    }
    return `fp:${msg.role}::${msg.content}`;
}

function isSystemMessage(msg) {
    return msg.role === 'system';
}

// 完全重置缓存状态，并用当前 chat 重新初始化
function handleReset(data, reason) {
    Logger.warn(`🔄 缓存重置：${reason}`, LogLevels.BASIC);
    CacheState.frozenArray = [];
    CacheState.frozenSystemFingerprints.clear();
    CacheState.frozenChatMesIds.clear();
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    if (typeof toastr !== 'undefined') {
        toastr.warning(`缓存已重置：${reason}`, 'DS 缓存优化器');
    }
    // 重新用当前 chat 初始化
    initializeFromChat(data);
}

// 首次或重置后从当前 chat 构建冻结状态
function initializeFromChat(data) {
    const chat = data.chat;
    CacheState.frozenArray = chat.map(msg => ({ ...msg })); // 浅拷贝足够
    for (const msg of CacheState.frozenArray) {
        const key = getMessageKey(msg);
        if (isSystemMessage(msg)) {
            CacheState.frozenSystemFingerprints.add(key);
        }
        if (msg.mesId !== undefined && msg.mesId !== null) {
            CacheState.frozenChatMesIds.add(msg.mesId);
        }
    }
    const tokens = estimateTokens(CacheState.frozenArray.map(m => m.content || '').join(''));
    CacheState.stats.prefixTokens = tokens;
    Logger.log(`初始化冻结前缀，${CacheState.frozenArray.length} 条消息，~${tokens} tokens`, LogLevels.BASIC);
}

// ==========================================
// 核心拦截重组
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`拦截器 #${CacheState.stats.total}`);

        if (!data?.chat?.length) return;

        // 首次初始化
        if (CacheState.frozenArray.length === 0) {
            initializeFromChat(data);
            return;
        }

        const currentChat = data.chat;

        // ---- 检测已冻结的系统提示词是否被删除或修改 ----
        let systemDeleted = false;
        for (const frozenMsg of CacheState.frozenArray) {
            if (!isSystemMessage(frozenMsg)) continue;
            const key = getMessageKey(frozenMsg);
            // 在 currentChat 中寻找完全相同的系统消息（用指纹匹配）
            const found = currentChat.some(msg => isSystemMessage(msg) && getMessageKey(msg) === key);
            if (!found) {
                systemDeleted = true;
                break;
            }
        }
        if (systemDeleted) {
            handleReset(data, '已冻结的系统提示词被删除或修改，缓存失效');
            return;
        }

        // ---- 检测核心对话历史的消息 ID 是否缺失（如用户删除了消息） ----
        let historyMissing = false;
        for (const frozenMsg of CacheState.frozenArray) {
            if (frozenMsg.mesId !== undefined && frozenMsg.mesId !== null) {
                if (!CacheState.frozenChatMesIds.has(frozenMsg.mesId)) continue; // 不作为历史追踪的
                const stillExists = currentChat.some(msg => msg.mesId === frozenMsg.mesId);
                if (!stillExists) {
                    historyMissing = true;
                    break;
                }
            }
        }
        if (historyMissing) {
            handleReset(data, '对话历史被修改（消息删除或重新生成），缓存失效');
            return;
        }

        // ---- 收集新增消息（保持原顺序，去重系统提示词） ----
        const newMessages = [];
        for (const msg of currentChat) {
            const key = getMessageKey(msg);
            if (isSystemMessage(msg)) {
                // 如果此系统消息指纹不在冻结集中，则为新增
                if (!CacheState.frozenSystemFingerprints.has(key)) {
                    newMessages.push(msg);
                    // 立即加入指纹防止同一轮内重复
                    CacheState.frozenSystemFingerprints.add(key);
                }
            } else {
                // 非系统消息：通过 mesId 或指纹判断是否新增
                const isNew = msg.mesId !== undefined && msg.mesId !== null
                    ? !CacheState.frozenChatMesIds.has(msg.mesId)
                    : !CacheState.frozenSystemFingerprints.has(key) && !CacheState.frozenChatMesIds.has(msg.mesId); // 兜底
                if (isNew) {
                    newMessages.push(msg);
                    if (msg.mesId !== undefined && msg.mesId !== null) {
                        CacheState.frozenChatMesIds.add(msg.mesId);
                    }
                }
            }
        }

        // ---- 组装最终消息序列 ----
        const finalMessages = [...CacheState.frozenArray, ...newMessages];

        // 计算统计
        const prefixTokens = estimateTokens(CacheState.frozenArray.map(m => m.content || '').join(''));
        CacheState.stats.prefixTokens = prefixTokens;
        CacheState.stats.hits++;
        CacheState.stats.savedTokens += prefixTokens;

        if (newMessages.length > 0) {
            Logger.log(`✅ 缓存命中！冻结前缀 ${CacheState.frozenArray.length} 条不变，新增 ${newMessages.length} 条`, LogLevels.BASIC);
        } else {
            Logger.log(`✅ 完全命中，无新增消息`, LogLevels.DETAILED);
        }

        // 更新冻结数组（扩展至包含新消息）
        CacheState.frozenArray = finalMessages.map(msg => ({ ...msg }));

        // 替换 data.chat 为新序列
        data.chat.splice(0, data.chat.length, ...finalMessages);

    } catch (err) {
        Logger.error('拦截器致命错误', err);
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
                <p style="font-size:0.9em;opacity:0.8;">绝对冻结 + mesId 追踪，自动适应变化，无需手动重置。</p>
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
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置静态核心</button>
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
            CacheState.frozenArray = [];
            CacheState.frozenSystemFingerprints.clear();
            CacheState.frozenChatMesIds.clear();
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateStatsUI();
            Logger.warn('已完全重置（手动）', LogLevels.BASIC);
            if (typeof toastr !== 'undefined') toastr.info('缓存核心已手动重置');
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
    console.log('DS V4 Optimizer v4 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('已挂载事件钩子', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v4.1 就绪，绝对前缀冻结 + 自动变更检测 ══════', LogLevels.BASIC);
});
