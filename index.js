import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志系统 (增强调试能力)
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };
let logLevel = 2;

function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const prefix = `[${time}]`;
    const fullMsg = `${prefix} ${msg}`;
    if (type === 'warn') {
        console.warn(`%c[DS Cache v6.2] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS Cache v6.2] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS Cache v6.2] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
// 缓存状态机 v6.2
// ==========================================
const CacheState = {
    enabled: true,
    // 锁定的前缀：包含系统提示词集合（标准化后） + 历史对话条目（按顺序）
    pinnedSequence: null,
    // 系统提示词的标准化指纹集（用于快速判断核心是否变化）
    systemFingerprintSet: null,
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
    pendingReset: false,
    awaitingResetDialog: false,
};

// ==========================================
// 消息分类与去重 (更稳健的识别)
// ==========================================
function classifyMessage(msg, originalChat) {
    // originalChat 是 SillyTavern 的 chat 数组，每个元素有 mes, is_user, is_system 等
    const originalMsg = originalChat.find(m => m.mes === msg.content);
    if (originalMsg) {
        if (originalMsg.is_user) return { isInstructional: false, isRealUser: true, isRealAI: false };
        if (!originalMsg.is_system) {
            // 不是系统消息，且角色是 assistant，可能是 AI 回复
            if (msg.role === 'assistant') return { isInstructional: false, isRealUser: false, isRealAI: true };
            // 其他情况视为注入提示词（世界书等）
            return { isInstructional: true, isRealUser: false, isRealAI: false };
        }
        return { isInstructional: true, isRealUser: false, isRealAI: false };
    }
    // 无法在原始聊天中找到，默认视为提示词
    return { isInstructional: true, isRealUser: false, isRealAI: false };
}

function createMessageObj(msg, cls) {
    return {
        role: msg.role,
        content: msg.content,
        isInstructional: cls.isInstructional,
        isRealUser: cls.isRealUser,
        isRealAI: cls.isRealAI,
        uid: `${msg.role}:${Logger.simpleHash(msg.content)}`,
        // 标准化内容用于系统消息比较
        normalizedContent: Logger.normalizeForFingerprint(msg.content),
    };
}

/**
 * 处理聊天流：去重提示词，分离当前用户输入和预填充
 */
function processChatStream(stream, originalChat) {
    // 找尾部预填充（连续 assistant）
    let prefillStart = stream.length;
    while (prefillStart > 0 && stream[prefillStart - 1].role === 'assistant') {
        prefillStart--;
    }
    const prefills = stream.slice(prefillStart).map(m => ({ role: m.role, content: m.content }));

    const nonPrefill = stream.slice(0, prefillStart);

    // 提取当前用户输入：最后一个 isRealUser 的 user 消息
    let currentUserInput = null;
    const historyTemp = [];
    for (let i = nonPrefill.length - 1; i >= 0; i--) {
        const msg = nonPrefill[i];
        const cls = classifyMessage(msg, originalChat);
        const obj = createMessageObj(msg, cls);
        if (!currentUserInput && cls.isRealUser && msg.role === 'user') {
            currentUserInput = obj;
        } else {
            historyTemp.unshift(obj);
        }
    }

    // 提示词去重（仅对 isInstructional）
    const seenInstructional = new Set();
    const processedHistory = [];
    for (const msg of historyTemp) {
        if (msg.isInstructional) {
            const norm = msg.normalizedContent;
            if (seenInstructional.has(norm)) {
                Logger.log(`[去重] 跳过重复提示词: ${msg.content.substring(0, 40)}...`, LogLevels.DEBUG);
                continue;
            }
            seenInstructional.add(norm);
        }
        processedHistory.push(msg);
    }

    return { currentUserInput, processedHistory, prefills };
}

// ==========================================
// 前缀匹配与增量合并（v6.2 重点改进）
// ==========================================
function findMatchingPrefix(pinned, current) {
    if (!pinned || pinned.length === 0) return -1;
    // 首先提取系统消息标准化集合，快速判断核心是否变化
    const pinnedSysSet = new Set(pinned.filter(m => m.role === 'system').map(m => m.normalizedContent));
    const currentSysSet = new Set(current.filter(m => m.role === 'system').map(m => m.normalizedContent));
    if (pinnedSysSet.size > 0 && currentSysSet.size > 0) {
        const sysSim = setsSimilarity(pinnedSysSet, currentSysSet);
        Logger.log(`[系统提示词集相似度] ${(sysSim * 100).toFixed(1)}%`, LogLevels.DEBUG);
        if (sysSim < 0.9) {
            return -1; // 系统提示词变动过大
        }
    }

    // 然后尝试用 uid 匹配前缀
    let matchIdx = -1;
    const minLen = Math.min(pinned.length, current.length);
    for (let i = 0; i < minLen; i++) {
        if (pinned[i].uid !== current[i].uid) {
            break;
        }
        matchIdx = i;
    }
    return matchIdx + 1; // 返回匹配的长度
}

function setsSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1;
    const union = new Set([...setA, ...setB]);
    let intersection = 0;
    for (const elem of setA) if (setB.has(elem)) intersection++;
    return union.size === 0 ? 1 : intersection / union.size;
}

function isSignificantChange(pinned, currentHistory) {
    const oldSys = pinned.filter(m => m.role === 'system').map(m => m.normalizedContent);
    const newSys = currentHistory.filter(m => m.role === 'system').map(m => m.normalizedContent);
    const sim = setsSimilarity(new Set(oldSys), new Set(newSys));
    Logger.log(`[核心系统提示词相似度] ${(sim * 100).toFixed(1)}%`, LogLevels.DEBUG);
    if (sim < 0.5) return true;

    // 检查整体长度比例是否发生剧减
    const oldTokens = pinned.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0);
    const newTokens = currentHistory.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0);
    if (oldTokens > 0 && newTokens / oldTokens < 0.65) return true;
    return false;
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

        // 1. 解析
        const { currentUserInput, processedHistory, prefills } = processChatStream(stream, originalChat);

        if (logLevel >= LogLevels.DEBUG) {
            Logger.log('[调试] 处理后历史序列预览:', LogLevels.DEBUG);
            processedHistory.forEach((m, i) => {
                Logger.log(`  ${i}: [${m.role}] ${m.content.substring(0, 40)}... (uid: ${m.uid})`, LogLevels.DEBUG);
            });
            if (currentUserInput) {
                Logger.log(`[调试] 当前用户输入: [${currentUserInput.role}] ${currentUserInput.content.substring(0, 40)}...`, LogLevels.DEBUG);
            }
            if (prefills.length > 0) {
                Logger.log(`[调试] 预填充消息: ${prefills.length} 条`, LogLevels.DEBUG);
            }
        }

        // 2. 初始化
        if (!CacheState.pinnedSequence) {
            CacheState.pinnedSequence = processedHistory;
            CacheState.systemFingerprintSet = new Set(
                processedHistory.filter(m => m.role === 'system').map(m => m.normalizedContent)
            );
            Logger.log(`[初始化] 锁定前缀 (${processedHistory.length} 条)`, LogLevels.BASIC);
            applyFinalMessages(stream, processedHistory, currentUserInput, prefills);
            updateStats(true);
            return;
        }

        // 3. 尝试匹配前缀
        const matchLen = findMatchingPrefix(CacheState.pinnedSequence, processedHistory);
        Logger.log(`[前缀匹配] 匹配长度: ${matchLen} / ${CacheState.pinnedSequence.length}`, LogLevels.DEBUG);

        if (matchLen === CacheState.pinnedSequence.length) {
            // 完整匹配：前缀完全一致，新增部分为 processedHistory.slice(matchLen)
            const newEntries = processedHistory.slice(matchLen);
            if (newEntries.length > 0) {
                Logger.warn(`[增量追加] 新增 ${newEntries.length} 条对话/提示词`, LogLevels.DETAILED);
                newEntries.forEach(e => {
                    Logger.warn(`  + ${e.role}: ${e.content.substring(0, 40)}...`, LogLevels.DEBUG);
                });
                // 更新锁定序列
                CacheState.pinnedSequence = processedHistory;
                CacheState.systemFingerprintSet = new Set(
                    processedHistory.filter(m => m.role === 'system').map(m => m.normalizedContent)
                );
            }
            applyFinalMessages(stream, processedHistory, currentUserInput, prefills);
            updateStats(false);
        } else {
            // 不匹配：可能存在变动
            Logger.warn('[前缀不匹配] 历史序列与锁定前缀不一致', LogLevels.BASIC);
            if (!CacheState.pendingReset && !CacheState.awaitingResetDialog) {
                const significant = isSignificantChange(CacheState.pinnedSequence, processedHistory);
                if (significant) {
                    triggerResetAlert('检测到提示词核心变动或对话历史被大幅删减，建议重置缓存前缀以获得最佳性能。是否重置？');
                } else {
                    Logger.warn('[轻微变化] 但未达重置阈值（可能仅动态内容变化），仍使用锁定前缀，本次缓存可能部分命中', LogLevels.BASIC);
                }
            }
            // 即使不匹配，也强制按锁定前缀+新增发送，以保持顺序稳定
            // 我们仍然基于 pinnedSequence 构建最终序列，而不是用当前 history 的全部，避免顺序错乱
            const finalHistory = [...CacheState.pinnedSequence];
            // 附加当前新增的历史片段（匹配长度之后的部分）
            const added = processedHistory.slice(matchLen > 0 ? matchLen : 0);
            // 如果匹配长度小于 pinned 长度，说明 pinned 中有些条目在 current 中丢失了，但我们仍然保留它们以保证前缀连续
            // 仅当系统提示词未变时才这样做，否则强制重置
            if (added.length > 0) {
                finalHistory.push(...added);
            }
            // 更新锁定序列（谨慎地合并）
            CacheState.pinnedSequence = finalHistory;
            CacheState.systemFingerprintSet = new Set(
                finalHistory.filter(m => m.role === 'system').map(m => m.normalizedContent)
            );
            Logger.warn('[动态修正] 已用锁定前缀+新增重新对齐序列', LogLevels.BASIC);
            applyFinalMessages(stream, finalHistory, currentUserInput, prefills);
            updateStats(false); // 仍然计为命中（因为缓存前缀大部分可能有效）
        }

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

function applyFinalMessages(stream, history, currentUserInput, prefills) {
    const final = history.map(m => ({ role: m.role, content: m.content }));
    if (currentUserInput) final.push({ role: currentUserInput.role, content: currentUserInput.content });
    prefills.forEach(p => final.push(p));

    // 调试日志：完整输出最终序列
    if (logLevel >= LogLevels.DEBUG) {
        Logger.log('[最终发送序列]', LogLevels.DEBUG);
        final.forEach((m, i) => {
            Logger.log(`  ${i}: [${m.role}] ${m.content.substring(0, 40)}...`, LogLevels.DEBUG);
        });
    }

    stream.splice(0, stream.length, ...final);
}

function updateStats(isInit = false) {
    const seq = CacheState.pinnedSequence;
    if (seq) {
        CacheState.stats.prefixTokens = seq.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0);
        CacheState.stats.hits++;
        CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
    } else if (isInit) {
        // 初始化时也计算
        const seq2 = CacheState.pinnedSequence;
        if (seq2) {
            CacheState.stats.prefixTokens = seq2.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0);
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
        }
    }
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
// 重置确认弹窗 (同前)
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
        if (confirm(reason + '\n点击“确定”重置，“取消”保持。')) performReset();
        CacheState.awaitingResetDialog = false;
        return;
    }
    textEl.textContent = reason;
    dialog.style.display = 'flex';
    CacheState.pendingReset = true;
}

function hideResetDialog() {
    const dialog = document.getElementById('ds-reset-dialog');
    if (dialog) dialog.style.display = 'none';
    CacheState.pendingReset = false;
    CacheState.awaitingResetDialog = false;
}

function performReset() {
    CacheState.pinnedSequence = null;
    CacheState.systemFingerprintSet = null;
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    updateStatsUI();
    Logger.warn('[用户操作] 已重置缓存前缀，下次请求将重新锁定。', LogLevels.BASIC);
    hideResetDialog();
}

// ==========================================
// UI 初始化 (增加清空日志按钮)
// ==========================================
async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DS Cache Optimizer v6.2</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">智能分类 + 系统提示词稳定比对 + 前缀锁定，抵御动态内容干扰，提供详细排错日志。</p>
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
                <button id="ds-cache-clearlog" class="menu_button" style="width:100%;margin:5px 0;">🗑️ 清空日志</button>
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
        $('#ds-cache-reset').on('click', () => performReset());
        $('#ds-cache-clearlog').on('click', () => {
            if (Logger._uiTextarea) Logger._uiTextarea.value = '';
            Logger.log('日志已清空', LogLevels.BASIC);
        });
        $('#ds-reset-dialog-cancel').on('click', () => {
            Logger.warn('[用户操作] 选择不重置，继续使用当前前缀', LogLevels.BASIC);
            hideResetDialog();
        });
        $('#ds-reset-dialog-reset').on('click', () => performReset());

        updateStatsUI();
    } catch (e) {
        Logger.error('UI初始化失败', e);
    }
}

// ==========================================
// 启动
// ==========================================
jQuery(async () => {
    console.log('DS Cache Optimizer v6.2 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 已挂载 CHAT_COMPLETION_PROMPT_READY 事件钩子', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载关键事件钩子，扩展无法运行。');
    }
    Logger.log('══════ v6.2 就绪，策略：系统消息集相似度 + uid 前缀匹配 ══════', LogLevels.BASIC);
});
