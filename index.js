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
        console.warn(`%c[DS V4 Opt v5] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS V4 Opt v5] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS V4 Opt v5] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
// 缓存状态机（v5 重构）
// ==========================================
const CacheState = {
    enabled: true,
    lockedSystemFingerprints: [],   // 已经锁定的 system 消息指纹列表
    lockedHistoryFingerprints: [], // 已经锁定的历史对话（user/assistant）指纹列表
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// ==========================================
// 消息组件提取
// ==========================================
function extractChatComponents(chat) {
    const systems = [];
    const nonsystems = [];
    for (const msg of chat) {
        if (msg.role === 'system') {
            systems.push(msg);
        } else {
            nonsystems.push(msg);
        }
    }

    let currentUserMsg = null;
    let prefillMsg = null;

    if (nonsystems.length > 0) {
        // 从后往前找最后一个 user 消息
        for (let i = nonsystems.length - 1; i >= 0; i--) {
            if (nonsystems[i].role === 'user') {
                currentUserMsg = nonsystems[i];
                // 如果 user 后面还有 assistant，则该 assistant 为预填充
                if (i + 1 < nonsystems.length && nonsystems[i + 1].role === 'assistant') {
                    prefillMsg = nonsystems[i + 1];
                }
                break;
            }
        }
    }

    // 历史对话：除去 currentUserMsg 和 prefillMsg 的其他人-机对话
    const history = nonsystems.filter(m => m !== currentUserMsg && m !== prefillMsg);

    return { systems, history, currentUserMsg, prefillMsg };
}

// ==========================================
// 去重 system 消息（保留第一次出现的顺序）
// ==========================================
function deduplicateSystemMessages(systems) {
    const seen = new Set();
    const result = [];
    for (const msg of systems) {
        const key = msg.content;
        if (!seen.has(key)) {
            seen.add(key);
            result.push(msg);
        }
    }
    return result;
}

// ==========================================
// 计算指纹数组
// ==========================================
function fingerprintsOfSystems(systems) {
    return systems.map(m => simpleHash(m.content));
}

function fingerprintsOfHistory(history) {
    return history.map(m => simpleHash(m.role + ':' + m.content));
}

// ==========================================
// 重置状态并弹窗提醒
// ==========================================
function resetCacheState(reason) {
    if (typeof toastr !== 'undefined' && toastr.warning) {
        toastr.warning(`缓存前缀重置：${reason}`, 'DS V4 缓存优化器');
    }
    Logger.warn(`======== 重置所有缓存状态（原因：${reason}）========`, LogLevels.BASIC);
    CacheState.lockedSystemFingerprints = [];
    CacheState.lockedHistoryFingerprints = [];
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
}

// ==========================================
// 核心拦截重组（v5）
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`拦截器 #${CacheState.stats.total}`);

        if (!data?.chat?.length) return;
        const originalChat = data.chat;

        // 1. 拆解组件
        const { systems: rawSystems, history, currentUserMsg, prefillMsg } = extractChatComponents(originalChat);

        // 2. 去重 system 消息
        const cleanSystems = deduplicateSystemMessages(rawSystems);
        const sysFps = fingerprintsOfSystems(cleanSystems);
        const hisFps = fingerprintsOfHistory(history);

        // 3. 状态比较与更新
        const isFirstRun = CacheState.lockedSystemFingerprints.length === 0;

        if (isFirstRun) {
            // 首次运行：完整接受当前 system 与 history 作为锁定前缀
            CacheState.lockedSystemFingerprints = sysFps;
            CacheState.lockedHistoryFingerprints = hisFps;

            const finalMessages = [...cleanSystems, ...history];
            if (currentUserMsg) finalMessages.push(currentUserMsg);
            if (prefillMsg) finalMessages.push(prefillMsg);

            data.chat.splice(0, data.chat.length, ...finalMessages);
            const prefixTokens = estimateTokens(finalMessages.filter(m => m !== currentUserMsg && m !== prefillMsg).map(m => m.content).join(''));
            CacheState.stats.prefixTokens = prefixTokens;
            CacheState.stats.hits++; // 首次也算命中，因为建立了缓存基础
            CacheState.stats.savedTokens += prefixTokens;
            Logger.log(`初始化完成，消息数: ${finalMessages.length}，前缀 tokens: ~${prefixTokens}`, LogLevels.BASIC);
            if (logLevel >= LogLevels.DEBUG) {
                Logger.log(`消息结构: ${finalMessages.map(m => `${m.role}(${m.content.length}字)`).join(' → ')}`, LogLevels.DEBUG);
            }
            return;
        }

        // 4. 检测前缀变化
        const oldSysLen = CacheState.lockedSystemFingerprints.length;
        const oldHisLen = CacheState.lockedHistoryFingerprints.length;

        // system 前缀检测
        let systemPrefixChanged = false;
        if (sysFps.length < oldSysLen) {
            systemPrefixChanged = true;
        } else {
            for (let i = 0; i < oldSysLen; i++) {
                if (sysFps[i] !== CacheState.lockedSystemFingerprints[i]) {
                    systemPrefixChanged = true;
                    break;
                }
            }
        }

        // history 前缀检测
        let historyPrefixChanged = false;
        if (hisFps.length < oldHisLen) {
            historyPrefixChanged = true;
        } else {
            for (let i = 0; i < oldHisLen; i++) {
                if (hisFps[i] !== CacheState.lockedHistoryFingerprints[i]) {
                    historyPrefixChanged = true;
                    break;
                }
            }
        }

        if (systemPrefixChanged || historyPrefixChanged) {
            // 前缀受到破坏，完全重置并弹窗
            const reasons = [];
            if (systemPrefixChanged) reasons.push('系统提示词/世界书发生变化');
            if (historyPrefixChanged) reasons.push('对话历史被编辑');
            resetCacheState(reasons.join('；'));
            // 用重置后的新状态重新处理（递归一次，只会在 isFirstRun 分支执行）
            interceptAndRestructurePrompt(data);
            return;
        }

        // 5. 前缀稳固，提取新增部分
        const lockedSystems = cleanSystems.slice(0, oldSysLen);           // 不变的前段 system
        const extraSystems = cleanSystems.slice(oldSysLen);               // 新增的 system（世界书/新增预设）

        // history 是累积的，我们直接使用完整的 history 作为历史部分（已包含增量）
        // extraSystems 按需求放置在历史对话之后、当前用户输入之前

        // 6. 构建最终消息序列
        const finalMessages = [
            ...lockedSystems,
            ...history,
            ...extraSystems,
        ];
        if (currentUserMsg) finalMessages.push(currentUserMsg);
        if (prefillMsg) finalMessages.push(prefillMsg);

        // 7. 计算缓存命中情况
        const prefixMessages = finalMessages.filter(m => m !== currentUserMsg && m !== prefillMsg);
        const prefixTokens = estimateTokens(prefixMessages.map(m => m.content).join(''));
        const newExtraTokens = estimateTokens(extraSystems.map(m => m.content).join('')) +
                               estimateTokens(history.slice(oldHisLen).map(m => m.content).join(''));

        const cacheHit = (extraSystems.length === 0 && hisFps.length === oldHisLen); // 没有任何新增前缀内容

        if (cacheHit) {
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += prefixTokens;
            Logger.log(`✅ 完美缓存命中！前缀完全未变，仅用户输入/预填充需计算`, LogLevels.BASIC);
        } else {
            Logger.warn(`⚠️ 前缀有增量（新增 system: ${extraSystems.length}条, 历史新增: ${hisFps.length - oldHisLen}条），本次部分命中，下轮将完全锁定`, LogLevels.BASIC);
        }

        CacheState.stats.prefixTokens = prefixTokens;

        // 8. 更新锁定状态
        CacheState.lockedSystemFingerprints = sysFps;
        CacheState.lockedHistoryFingerprints = hisFps;

        // 9. 应用重组后的数组
        data.chat.splice(0, data.chat.length, ...finalMessages);
        Logger.log(`重组完成：${originalChat.length} 条 → ${finalMessages.length} 条`, LogLevels.BASIC);
        if (logLevel >= LogLevels.DEBUG) {
            Logger.log(`消息结构: ${finalMessages.map(m => `${m.role}(${m.content.length}字)`).join(' → ')}`, LogLevels.DEBUG);
        }

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
                <b>🧠 DS V4 Cache Optimizer v5.0</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">绝对冻结前缀 + 增量锁定，自动适应变动，目标 99%+ 缓存命中。</p>
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
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置所有锁定状态</button>
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
            resetCacheState('用户手动重置');
            updateStatsUI();
            Logger.warn('已强制重置', LogLevels.BASIC);
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
    console.log('DS V4 Optimizer v5 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('已挂载事件钩子 CHAT_COMPLETION_PROMPT_READY', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v5.0 就绪，智能前缀锁定，自动适应变动 ══════', LogLevels.BASIC);
});
