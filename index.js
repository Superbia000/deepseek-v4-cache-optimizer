import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志系统 (增强版，支持日志等级)
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };
let logLevel = 2;

function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const prefix = `[${time}]`;
    const fullMsg = `${prefix} ${msg}`;
    if (type === 'warn') {
        console.warn(`%c[DS V4 Opt v5.1] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS V4 Opt v5.1] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS V4 Opt v5.1] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
    normalizeForFingerprint: (text) => {
        return text
            .replace(/\s+/g, ' ')
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, "'")
            .replace(/[，。！？、；：]/g, (m) => ({'，':',','。':'.','！':'!','？':'?','、':',','；':';','：':':'})[m] || m)
            .trim();
    }
};

// ==========================================
// 缓存状态机 (v5.1 核心：位置锁定 + 增量追加 + 用户确认重置)
// ==========================================
const CacheState = {
    enabled: true,
    pinnedSequence: null,         // 被“钉住”的提示词序列
    cachedFingerprint: null,      // 指纹快照
    lastSentSequence: null,       // 上一轮请求的实际消息指纹
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
    pendingReset: false,          // 等待用户确认重置
    pendingReason: ''             // 触发原因说明
};

// 大幅度删减阈值：移除 token 数超过前缀 token 总数的 30%
const REMOVAL_THRESHOLD = 0.3;

// ==========================================
// 预填充检测
// ==========================================
function getPrefillInfo(data) {
    try {
        // 优先从 power_user 读取用户设置的 prefill 文本
        if (typeof window !== 'undefined' && window.power_user && window.power_user.prefill) {
            const prefillText = window.power_user.prefill;
            if (prefillText && data.chat.length > 0) {
                const lastMsg = data.chat[data.chat.length - 1];
                if (lastMsg.role === 'assistant' && lastMsg.content === prefillText) {
                    return { hasPrefill: true, prefillMessage: lastMsg };
                }
            }
        }
        // 兼容 data 字段
        if (data.prefill && typeof data.prefill === 'string' && data.chat.length > 0) {
            const lastMsg = data.chat[data.chat.length - 1];
            if (lastMsg.role === 'assistant' && lastMsg.content === data.prefill) {
                return { hasPrefill: true, prefillMessage: lastMsg };
            }
        }
    } catch (e) {
        Logger.warn('预填充检测异常，将按无预填充处理', LogLevels.DEBUG);
    }
    return { hasPrefill: false, prefillMessage: null };
}

// ==========================================
// 核心拦截与重组 (v5.1 改进版)
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    // 如果正在等待用户确认重置，暂停优化，直接发送原始消息
    if (CacheState.pendingReset) {
        Logger.warn(`[等待确认] 请先处理弹窗中的重置确认 (原因: ${CacheState.pendingReason})，本次请求将按原始内容发送。`, LogLevels.BASIC);
        return;
    }

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`[请求 #${CacheState.stats.total}] 开始处理...`);

        if (!data?.chat?.length) return;
        const stream = data.chat; // 引用原始数组

        // 深拷贝原始消息，用于必要时恢复
        const originalChat = stream.map(m => ({ role: m.role, content: m.content }));

        // --- 第 1 步: 解析当前消息数组，识别预填充 ---
        const prefillInfo = getPrefillInfo(data);
        const currentMessages = [];

        for (let i = 0; i < stream.length; i++) {
            const msg = stream[i];
            const isPrefill = prefillInfo.hasPrefill && prefillInfo.prefillMessage && i === stream.length - 1;
            currentMessages.push({
                role: msg.role,
                content: msg.content || '',
                isPrefill: isPrefill
            });
        }

        // --- 第 2 步: 判断状态 (初始化、恢复或常规运行) ---
        if (!CacheState.pinnedSequence) {
            // 初始化：将当前所有非预填充消息“钉住”
            CacheState.pinnedSequence = currentMessages.filter(m => !m.isPrefill).map(m => ({ role: m.role, content: m.content }));
            CacheState.cachedFingerprint = generateFingerprint(CacheState.pinnedSequence);
            Logger.log(`[初始化] 首次锁定提示词序列 (${CacheState.pinnedSequence.length} 条消息)`, LogLevels.BASIC);
            buildAndSetFinalMessages(currentMessages, stream);
            CacheState.stats.hits++;
            CacheState.stats.prefixTokens = countTokenForSequence(CacheState.pinnedSequence);
            CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
            return;
        }

        // 常规运行：提取当前非预填充消息
        const currentNonPrefillMessages = currentMessages.filter(m => !m.isPrefill);

        // --- 第 3 步: 核心比对 - 检测大规模变化 (角色卡/预设切换) ---
        if (isMajorChange(CacheState.pinnedSequence, currentNonPrefillMessages)) {
            // 不再自动重置，而是请求用户确认
            handlePotentialReset('角色卡或预设发生大幅度变化', originalChat, stream);
            return;
        }

        // --- 第 4 步: 检测大幅删减 ---
        const { toPin, newItems } = findAdditions(CacheState.pinnedSequence, currentNonPrefillMessages);
        const removedItems = findRemovals(CacheState.pinnedSequence, currentNonPrefillMessages);
        const removedTokens = countTokenForSequence(removedItems);
        const totalTokens = countTokenForSequence(CacheState.pinnedSequence);
        const removalRatio = totalTokens > 0 ? removedTokens / totalTokens : 0;

        if (removalRatio > REMOVAL_THRESHOLD) {
            handlePotentialReset(
                `检测到历史对话大幅删减 (约 ${Math.round(removalRatio * 100)}% 内容被移除)`,
                originalChat,
                stream
            );
            return;
        }

        // 小规模删减：动态更新 pinnedSequence
        if (removedItems.length > 0) {
            Logger.warn(`[动态削除] 以下提示词被移除，将从锁定序列中删除：`, LogLevels.DETAILED);
            removedItems.forEach(item => {
                Logger.warn(`  - ${item.role}: ${item.content.substring(0, 50)}...`, LogLevels.DEBUG);
            });
            CacheState.pinnedSequence = CacheState.pinnedSequence.filter(pinnedItem => {
                return !removedItems.some(removedItem =>
                    removedItem.role === pinnedItem.role && removedItem.content === pinnedItem.content
                );
            });
        }

        // --- 第 5 步: 增量追加新增条目 ---
        if (newItems.length > 0) {
            Logger.warn(`[增量追加] 发现 ${newItems.length} 个新增提示词条目，将追加到提示词序列末尾。`, LogLevels.DETAILED);
            newItems.forEach(item => {
                Logger.warn(`  + ${item.role}: ${item.content.substring(0, 50)}...`, LogLevels.DEBUG);
            });
            CacheState.pinnedSequence = CacheState.pinnedSequence.concat(newItems);
        }

        // 更新指纹
        CacheState.cachedFingerprint = generateFingerprint(CacheState.pinnedSequence);

        // --- 第 6 步: 重组最终消息序列 ---
        const currentPrefillMessages = currentMessages.filter(m => m.isPrefill);
        const finalMessages = CacheState.pinnedSequence.map(m => ({ role: m.role, content: m.content, isPrefill: false }));
        finalMessages.push(...currentPrefillMessages);

        // --- 第 7 步: 计算缓存命中统计 ---
        const sentNowFingerprint = generateFingerprint(finalMessages);
        const cacheHit = CacheState.lastSentSequence && CacheState.lastSentSequence === sentNowFingerprint;

        if (cacheHit) {
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
            Logger.log('[缓存命中] 与上一轮请求完全一致，前缀部分全部命中缓存。', LogLevels.BASIC);
        } else {
            const prefixTokens = countTokenForSequence(CacheState.pinnedSequence);
            if (CacheState.lastSentSequence) {
                Logger.log(`[部分命中] 前缀新增内容，上一轮旧前缀完全命中，仅尾部新增约 ${Math.max(0, Logger.estimateTokens(finalMessages.map(m => m.content).join('')) - prefixTokens)} tokens 需要计算。`, LogLevels.BASIC);
            } else {
                Logger.log('[首次发送] 建立缓存基线。', LogLevels.BASIC);
            }
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += prefixTokens;
        }

        CacheState.lastSentSequence = sentNowFingerprint;
        CacheState.stats.prefixTokens = countTokenForSequence(CacheState.pinnedSequence);

        // 应用重组结果
        buildAndSetFinalMessages(finalMessages, stream);

        if (logLevel >= LogLevels.DEBUG) {
            Logger.log(`[重组详情] 最终发送消息结构: ${finalMessages.map(m => `${m.role}(${m.content.length}字)`).join(' → ')}`, LogLevels.DEBUG);
        }

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

// ==========================================
// 用户确认重置处理
// ==========================================
function handlePotentialReset(reason, originalChat, stream) {
    CacheState.pendingReset = true;
    CacheState.pendingReason = reason;
    // 恢复本次请求为原始内容（跳过优化，确保对话不中断）
    stream.splice(0, stream.length, ...originalChat);
    Logger.warn(`[等待重置确认] ${reason}，已暂停缓存优化并恢复原始请求。`, LogLevels.BASIC);
    showResetPopup(reason);
}

function resetCache() {
    CacheState.pinnedSequence = null;
    CacheState.cachedFingerprint = null;
    CacheState.lastSentSequence = null;
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    CacheState.pendingReset = false;
    CacheState.pendingReason = '';
    updateStatsUI();
    Logger.warn('用户已确认重置缓存前缀。下一次请求将重新锁定。', LogLevels.BASIC);
}

function dismissReset() {
    CacheState.pendingReset = false;
    CacheState.pendingReason = '';
    Logger.warn('用户选择忽略重置，缓存优化将继续沿用原有前缀。', LogLevels.BASIC);
}

// 模态弹窗（永久存在直到用户点击）
let activePopup = null;
function showResetPopup(reason) {
    // 避免重复弹窗
    if (activePopup) {
        // 更新原因文本
        const reasonEl = document.getElementById('ds-reset-popup-reason');
        if (reasonEl) reasonEl.textContent = reason;
        return;
    }

    const popupHtml = `
    <div id="ds-reset-popup" style="position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
        background:#2b2b2b; border:1px solid #ffaa00; border-radius:8px; padding:20px; z-index:9999;
        min-width:320px; box-shadow:0 8px 24px rgba(0,0,0,0.6); color:#ddd; font-family:sans-serif;">
        <h3 style="margin-top:0; color:#ffaa00;">⚠️ 缓存前缀需要重置</h3>
        <p id="ds-reset-popup-reason" style="margin:8px 0;">${reason}</p>
        <p style="font-size:0.9em; opacity:0.8;">为保证缓存命中率，建议重置缓存前缀。重置后下一次请求将重新锁定提示词。</p>
        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
            <button id="ds-reset-ignore" class="menu_button" style="background:#444;">忽略，继续沿用</button>
            <button id="ds-reset-confirm" class="menu_button" style="background:#d9534f;">重置缓存前缀</button>
        </div>
    </div>`;

    const container = document.createElement('div');
    container.innerHTML = popupHtml;
    document.body.appendChild(container.firstElementChild);
    activePopup = document.getElementById('ds-reset-popup');

    document.getElementById('ds-reset-confirm').addEventListener('click', () => {
        resetCache();
        removePopup();
    });
    document.getElementById('ds-reset-ignore').addEventListener('click', () => {
        dismissReset();
        removePopup();
    });
}

function removePopup() {
    if (activePopup) {
        activePopup.remove();
        activePopup = null;
    }
}

// ==========================================
// 辅助函数 (保持不变，仅微调)
// ==========================================

function isMajorChange(oldSeq, newSeq) {
    if (!oldSeq || !newSeq) return true;
    if (oldSeq.length === 0 || newSeq.length === 0) return true;

    const oldSystemMsg = oldSeq.find(m => m.role === 'system');
    const newSystemMsg = newSeq.find(m => m.role === 'system');

    if (oldSystemMsg && newSystemMsg) {
        const sim = similarity(oldSystemMsg.content, newSystemMsg.content);
        Logger.log(`[系统提示词相似度] ${(sim * 100).toFixed(1)}%`, LogLevels.DEBUG);
        return sim < 0.5;
    }
    return false;
}

function findAdditions(oldSeq, newSeq) {
    const additions = [];
    const newSeqCopy = [...newSeq];

    for (const oldItem of oldSeq) {
        const matchIndex = newSeqCopy.findIndex(newItem =>
            newItem.role === oldItem.role && newItem.content === oldItem.content
        );
        if (matchIndex !== -1) {
            newSeqCopy.splice(matchIndex, 1);
        }
    }

    const trulyNew = [];
    for (const newItem of newSeqCopy) {
        const isExistInOld = oldSeq.some(oldItem =>
            oldItem.role === newItem.role &&
            Logger.normalizeForFingerprint(oldItem.content) === Logger.normalizeForFingerprint(newItem.content)
        );
        if (!isExistInOld) {
            trulyNew.push(newItem);
        } else {
            Logger.log(`[指纹匹配] 忽略因微小差异导致的新增误判: ${newItem.content.substring(0, 50)}...`, LogLevels.DEBUG);
        }
    }
    return { toPin: oldSeq, newItems: trulyNew };
}

function findRemovals(oldSeq, newSeq) {
    const removal = [];
    for (const oldItem of oldSeq) {
        const matchIndex = newSeq.findIndex(newItem =>
            newItem.role === oldItem.role &&
            Logger.normalizeForFingerprint(newItem.content) === Logger.normalizeForFingerprint(oldItem.content)
        );
        if (matchIndex === -1) {
            removal.push(oldItem);
        }
    }
    return removal;
}

function generateFingerprint(sequence) {
    return sequence.map(m => `${m.role}:${Logger.simpleHash(Logger.normalizeForFingerprint(m.content))}`).join('|');
}

function countTokenForSequence(sequence) {
    return sequence.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0);
}

function similarity(oldText, newText) {
    if (!oldText || !newText) return 0;
    const oldLines = new Set(oldText.split('\n').map(l => l.trim()).filter(Boolean));
    const newLines = newText.split('\n').map(l => l.trim()).filter(Boolean);
    if (newLines.length === 0) return 1;
    let common = 0;
    for (const l of newLines) if (oldLines.has(l)) common++;
    return common / newLines.length;
}

function buildAndSetFinalMessages(finalMessages, originalStream) {
    originalStream.splice(0, originalStream.length);
    finalMessages.forEach(msg => {
        originalStream.push({ role: msg.role, content: msg.content });
    });
}

// ==========================================
// UI (v5.1 增强版)
// ==========================================
function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `
        <span>命中: ${hits}/${total} (${rate}%)</span>
        <span style="margin-left:10px;">缓存前缀: ~${prefixTokens.toLocaleString()}t</span>
        <span style="margin-left:10px;">累计节省: ~${savedTokens.toLocaleString()}t</span>
    `;
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DS V4 Cache Optimizer v5.1 (用户确认版)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">自动锁定提示词前缀，增量追加新增内容；大幅变动时弹窗确认，避免意外重置。</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;"></div>
                <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" id="ds-cache-enable" checked> 启用自动化缓存优化
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
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置缓存前缀 (下次请求自动重建)</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');
        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`插件状态: ${CacheState.enabled ? '启用' : '停用'}`, LogLevels.BASIC);
        });
        $('#ds-cache-loglevel').on('change', function() {
            logLevel = parseInt($(this).val());
            Logger.log(`日志等级设为: ${['关闭','简要','详细','调试'][logLevel]}`, LogLevels.BASIC);
        });
        $('#ds-cache-reset').on('click', () => {
            resetCache();
            removePopup(); // 如果有未处理的弹窗也关掉
            updateStatsUI();
            Logger.warn('已强制重置所有状态。下一次请求时将自动重新锁定提示词前缀。', LogLevels.BASIC);
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
    console.log('DS V4 Optimizer v5.1 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 已挂载 CHAT_COMPLETION_PROMPT_READY 事件钩子', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载关键事件钩子，扩展无法运行。');
    }
    Logger.log('══════ v5.1 就绪，策略：自动锁定前缀 + 增量追加 + 用户确认重置 ══════', LogLevels.BASIC);
});
