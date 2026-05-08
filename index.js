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
    const prefix = `[${time}]`;
    const fullMsg = `${prefix} ${msg}`;
    if (type === 'warn') {
        console.warn(`%c[DS V4 Opt v6.1] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS V4 Opt v6.1] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS V4 Opt v6.1] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
// 缓存状态机 v6.1
// ==========================================
const CacheState = {
    enabled: true,
    // 锁定的“处理后的历史序列”（去重提示词后的完整历史，不含当前用户输入和预填充）
    pinnedSequence: null,
    cachedFingerprint: null,
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
    pendingReset: false,          // 是否已有未关闭的弹窗
    awaitingResetDialog: false,   // 弹窗正在显示中
};

// ==========================================
// 消息分类与去重处理
// ==========================================
/**
 * 根据原始聊天数据分类消息
 * @param {Object} msg - data.chat 中的消息对象 {role, content}
 * @param {Array} originalChat - 原始聊天数组
 * @returns {Object} { isInstructional, isRealUser, isRealAI, uid }
 */
function classifyMessage(msg, originalChat) {
    const originalMsg = originalChat.find(m => m.mes === msg.content);
    if (originalMsg) {
        if (originalMsg.is_user) return { isInstructional: false, isRealUser: true, isRealAI: false };
        if (!originalMsg.is_system) {
            if (msg.role === 'assistant') return { isInstructional: false, isRealUser: false, isRealAI: true };
            return { isInstructional: true, isRealUser: false, isRealAI: false };
        }
        return { isInstructional: true, isRealUser: false, isRealAI: false };
    }
    return { isInstructional: true, isRealUser: false, isRealAI: false };
}

function createMessageObject(msg, classification) {
    return {
        role: msg.role,
        content: msg.content,
        isInstructional: classification.isInstructional,
        isRealUser: classification.isRealUser,
        isRealAI: classification.isRealAI,
        // 使用 content 哈希作为唯一标识（真实对话允许重复，但我们用组合键进一步区分）
        uid: `${msg.role}:${Logger.simpleHash(msg.content)}`,
    };
}

/**
 * 提取并处理一个请求中的消息序列：去重提示词，分离当前用户输入和预填充
 * @param {Array} stream - data.chat
 * @param {Array} originalChat - 原始聊天对象
 * @returns {{ currentUserInput: Object|null, processedHistory: Array, prefills: Array }}
 */
function processChatStream(stream, originalChat) {
    // 优先找到尾部连续的 assistant 作为预填充
    let prefillStart = stream.length;
    while (prefillStart > 0 && stream[prefillStart - 1].role === 'assistant') {
        prefillStart--;
    }
    const prefills = stream.slice(prefillStart).map(m => ({ role: m.role, content: m.content }));

    // 非预填充部分
    const nonPrefill = stream.slice(0, prefillStart);

    // 找出当前用户输入：非预填充部分中最后一条 role === 'user' 且 isRealUser 的消息
    let currentUserInput = null;
    const historyTemp = [];
    for (let i = nonPrefill.length - 1; i >= 0; i--) {
        const msg = nonPrefill[i];
        const cls = classifyMessage(msg, originalChat);
        if (!currentUserInput && cls.isRealUser && msg.role === 'user') {
            currentUserInput = createMessageObject(msg, cls);
        } else {
            historyTemp.unshift(createMessageObject(msg, cls)); // 保持顺序
        }
    }
    // historyTemp 现在是按原始顺序（旧的在前）的历史消息，不包括当前用户输入

    // 对历史消息进行提示词去重（真实对话不去重）
    const seenInstructional = new Set();
    const processedHistory = [];
    for (const msg of historyTemp) {
        if (msg.isInstructional) {
            const norm = Logger.normalizeForFingerprint(msg.content);
            if (seenInstructional.has(norm)) {
                Logger.log(`[去重] 跳过重复提示词: ${msg.content.substring(0, 50)}...`, LogLevels.DEBUG);
                continue;
            }
            seenInstructional.add(norm);
        }
        processedHistory.push(msg);
    }

    return { currentUserInput, processedHistory, prefills };
}

// ==========================================
// 前缀匹配检查
// ==========================================
function isPrefixMatch(pinned, currentHistory) {
    if (!pinned || currentHistory.length < pinned.length) return false;
    for (let i = 0; i < pinned.length; i++) {
        if (pinned[i].uid !== currentHistory[i].uid) return false;
    }
    return true;
}

// 检测大幅变化（基于系统提示词相似度，以及长度比例）
function isSignificantChange(pinned, currentHistory) {
    const oldSystem = pinned.filter(m => m.role === 'system').map(m => m.content).join('\n');
    const newSystem = currentHistory.filter(m => m.role === 'system').map(m => m.content).join('\n');
    const sim = similarity(oldSystem, newSystem);
    Logger.log(`[系统提示词相似度] ${(sim * 100).toFixed(1)}%`, LogLevels.DEBUG);
    if (sim < 0.5) return true;

    // 检测删减比例
    const pinnedTokens = pinned.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0);
    // 粗略估计：若 currentHistory 比 pinned 短很多，说明有大幅删除
    const currentTokens = currentHistory.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0);
    if (pinnedTokens > 0 && currentTokens / pinnedTokens < 0.7) { // 删减超过30%
        return true;
    }
    return false;
}

function similarity(a, b) {
    if (!a || !b) return 0;
    const linesA = new Set(a.split('\n').filter(l => l.trim()));
    const linesB = b.split('\n').filter(l => l.trim());
    if (linesB.length === 0) return 1;
    let common = 0;
    for (const l of linesB) if (linesA.has(l)) common++;
    return common / linesB.length;
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

        // 1. 统一解析当前消息
        const { currentUserInput, processedHistory, prefills } = processChatStream(stream, originalChat);

        // 2. 初始化或恢复
        if (!CacheState.pinnedSequence) {
            CacheState.pinnedSequence = processedHistory;
            CacheState.cachedFingerprint = processedHistory.map(m => m.uid).join('|');
            Logger.log(`[初始化] 锁定前缀序列 (${processedHistory.length} 条，提示词去重)`, LogLevels.BASIC);
            applyFinalMessages(stream, processedHistory, currentUserInput, prefills);
            updateStats(true);
            return;
        }

        // 3. 检查是否前缀匹配
        if (isPrefixMatch(CacheState.pinnedSequence, processedHistory)) {
            // 完美匹配：前缀无变化，直接使用处理后的完整历史
            const newEntries = processedHistory.slice(CacheState.pinnedSequence.length);
            if (newEntries.length > 0) {
                Logger.warn(`[增量追加] 新增 ${newEntries.length} 条对话/提示词`, LogLevels.DETAILED);
                newEntries.forEach(e => Logger.warn(`  + ${e.role}: ${e.content.substring(0, 50)}...`, LogLevels.DEBUG));
                // 更新 pinnedSequence 以包含新增部分（为下次请求准备）
                CacheState.pinnedSequence = processedHistory;
                CacheState.cachedFingerprint = processedHistory.map(m => m.uid).join('|');
            }
            applyFinalMessages(stream, processedHistory, currentUserInput, prefills);
            updateStats(false);
        } else {
            // 前缀不匹配 -> 发生了变动
            Logger.warn('[前缀不匹配] 历史序列发生变化，缓存可能无法完全命中', LogLevels.BASIC);
            // 触发重置提醒（如果尚未有弹窗）
            if (!CacheState.pendingReset && !CacheState.awaitingResetDialog) {
                const significant = isSignificantChange(CacheState.pinnedSequence, processedHistory);
                if (significant) {
                    triggerResetAlert('变动较大，推荐重置缓存前缀以获得最佳性能。');
                } else {
                    // 轻微变化，仅提醒但不强制重置
                    Logger.warn('[轻微变化] 但未达重置阈值，仍使用当前前缀，本次缓存可能部分命中', LogLevels.BASIC);
                    // 继续发送当前完整消息（不做修改）
                    // 但保持 pinned 不变，这样下次请求可能恢复匹配
                }
            }
            // 无论是否重置，本次请求直接发送当前完整消息（不做重组）
            // 因为前缀已破坏，强行重组也无法命中缓存，不如保持完整上下文
            CacheState.stats.hits--; // 本次不计入命中
            updateStatsUI();
        }
    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

function applyFinalMessages(stream, history, currentUserInput, prefills) {
    const final = history.map(m => ({ role: m.role, content: m.content }));
    if (currentUserInput) {
        final.push({ role: currentUserInput.role, content: currentUserInput.content });
    }
    prefills.forEach(p => final.push(p));
    stream.splice(0, stream.length, ...final);
}

function updateStats(isInit = false) {
    if (isInit) {
        CacheState.stats.hits++;
        CacheState.stats.savedTokens += CacheState.pinnedSequence.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0);
    } else {
        CacheState.stats.hits++;
        CacheState.stats.savedTokens += CacheState.pinnedSequence.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0);
    }
    CacheState.stats.prefixTokens = CacheState.pinnedSequence?.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0) ?? 0;
    updateStatsUI();
}

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

// ==========================================
// 重置确认弹窗（永久存在直至用户操作）
// ==========================================
function triggerResetAlert(reason) {
    if (CacheState.pendingReset || CacheState.awaitingResetDialog) return;
    CacheState.awaitingResetDialog = true;
    showResetDialog(reason);
}

function showResetDialog(reason) {
    const dialog = document.getElementById('ds-reset-dialog');
    const textEl = document.getElementById('ds-reset-dialog-text');
    if (!dialog || !textEl) {
        // 降级方案
        if (confirm(reason + '\n点击“确定”重置，“取消”保持当前前缀。')) {
            performReset();
        }
        CacheState.awaitingResetDialog = false;
        return;
    }
    textEl.textContent = reason;
    dialog.style.display = 'flex';
    CacheState.pendingReset = true; // 防止重复弹窗
    CacheState.awaitingResetDialog = true;
}

function hideResetDialog() {
    const dialog = document.getElementById('ds-reset-dialog');
    if (dialog) dialog.style.display = 'none';
    CacheState.pendingReset = false;
    CacheState.awaitingResetDialog = false;
}

function performReset() {
    CacheState.pinnedSequence = null;
    CacheState.cachedFingerprint = null;
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    updateStatsUI();
    Logger.warn('[用户操作] 已重置缓存前缀，下次请求将重新锁定。', LogLevels.BASIC);
    hideResetDialog();
}

// ==========================================
// UI 初始化
// ==========================================
async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DS V4 Cache Optimizer v6.1 (智能分类 + 前缀锁定)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">严格区分提示词与真实对话，去重提示词，保留对话历史原序，自适应检测变动并提醒重置。</p>
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
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置缓存前缀</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>

        <div id="ds-reset-dialog" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; align-items:center; justify-content:center;">
            <div style="background:#2b2b2b; padding:20px; border-radius:8px; max-width:500px; box-shadow:0 0 20px black;">
                <h3 style="margin-top:0;">缓存优化器提醒</h3>
                <p id="ds-reset-dialog-text" style="margin:16px 0;"></p>
                <div style="display:flex; justify-content:flex-end; gap:8px;">
                    <button id="ds-reset-dialog-cancel" class="menu_button" style="background:#444;">取消</button>
                    <button id="ds-reset-dialog-reset" class="menu_button" style="background:#c0392b; color:white;">重置缓存前缀</button>
                </div>
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
            performReset();
        });
        $('#ds-reset-dialog-cancel').on('click', () => {
            Logger.warn('[用户操作] 选择不重置，继续使用当前前缀（可能缓存不命中）', LogLevels.BASIC);
            hideResetDialog();
        });
        $('#ds-reset-dialog-reset').on('click', () => {
            performReset();
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
    console.log('DS V4 Optimizer v6.1 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 已挂载 CHAT_COMPLETION_PROMPT_READY 事件钩子', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载关键事件钩子，扩展无法运行。');
    }
    Logger.log('══════ v6.1 就绪，策略：分类去重 + 前缀匹配 + 变动弹窗 ══════', LogLevels.BASIC);
});
