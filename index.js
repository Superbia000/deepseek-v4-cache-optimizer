import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志系统 (与原来一致，略作调整)
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };
let logLevel = 2;

function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const prefix = `[${time}]`;
    const fullMsg = `${prefix} ${msg}`;
    if (type === 'warn') {
        console.warn(`%c[DS V4 Opt v6] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS V4 Opt v6] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS V4 Opt v6] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
// 缓存状态机 v6 (智能前缀 + 用户确认弹窗)
// ==========================================
const CacheState = {
    enabled: true,
    // 锁定前缀序列：包含所有固定提示词 + 历史真实对话（AI回覆和用户输入）
    // 每个条目格式：{ role, content, isInstructional, uid (唯一标识，用于快速匹配) }
    pinnedSequence: null,
    // 指纹快照
    cachedFingerprint: null,
    // 上一轮发送的序列指纹，用于统计
    lastSentSequence: null,
    // 统计
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
    // 等待用户确认的重置请求
    pendingReset: false,
    // 是否需要显示大幅删减弹窗（与更换预设独立）
    pendingDeleteAlert: false,
    pendingChangeAlert: false,
};

// ==========================================
// 辅助：根据原始聊天对象标记消息是否为“提示词”
// ==========================================
function classifyMessage(msgFromChat, originalChat) {
    // originalChat 来自 getContext().chat，每个元素有 is_user, is_system, mes 等
    // 先尝试匹配原始消息
    const originalMsg = originalChat.find(m => m.mes === msgFromChat.content);
    if (originalMsg) {
        if (originalMsg.is_user) {
            return { isInstructional: false, isRealUser: true, isRealAI: false };
        }
        // 不是用户发送，也不是系统提示词，可能是AI回复
        if (!originalMsg.is_system) {
            // assistant 角色且没有系统标记 => 真实AI回复
            if (msgFromChat.role === 'assistant') {
                return { isInstructional: false, isRealUser: false, isRealAI: true };
            }
            // user角色但不是用户发送，可能是世界书注入等，视为提示词
            return { isInstructional: true, isRealUser: false, isRealAI: false };
        }
        // 系统标记的消息肯定是指示词
        return { isInstructional: true, isRealUser: false, isRealAI: false };
    }
    // 未能在原始聊天中找到对应，大概率是系统注入的提示词
    return { isInstructional: true, isRealUser: false, isRealAI: false };
}

// 生成消息的唯一标识（用于快速去重和匹配）
function messageUID(msg) {
    return `${msg.role}::${Logger.simpleHash(Logger.normalizeForFingerprint(msg.content))}`;
}

// ==========================================
// 核心拦截与重组 (v6 完全重写)
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`[请求 #${CacheState.stats.total}] 开始处理...`);

        if (!data?.chat?.length) return;
        const stream = data.chat;

        // 获取原始聊天对象（用于分类）
        const context = getContext();
        const originalChat = context?.chat ?? [];

        // --- 第1步：解析当前消息并分类 ---
        const currentMessages = [];

        // 找出尾部连续的 assistant 消息作为预填充
        let prefillStartIndex = stream.length;
        while (prefillStartIndex > 0 && stream[prefillStartIndex - 1].role === 'assistant') {
            prefillStartIndex--;
        }

        for (let i = 0; i < stream.length; i++) {
            const msg = stream[i];
            const isPrefill = (i >= prefillStartIndex && msg.role === 'assistant');
            const classification = classifyMessage(msg, originalChat);
            currentMessages.push({
                role: msg.role,
                content: msg.content || '',
                isPrefill,
                uid: messageUID(msg),
                ...classification,
            });
        }

        // 提取当前真实用户输入（位于最后一个 assistant 预填充之前最后一个 user 消息）
        const nonPrefillMessages = currentMessages.filter(m => !m.isPrefill);
        const lastUserMsg = [...nonPrefillMessages].reverse().find(m => m.role === 'user');
        const currentUserInput = lastUserMsg && lastUserMsg.isRealUser ? lastUserMsg : null;
        // 其他非预填充且非当前用户输入的部分
        const otherNonPrefill = nonPrefillMessages.filter(m => m !== currentUserInput);

        // --- 第2步：初始化或恢复 ---
        if (!CacheState.pinnedSequence) {
            // 首次：锁定所有非预填充消息（去重提示词，保留对话历史）
            const toPin = [];
            const seenInstructional = new Set();
            for (const m of otherNonPrefill) {
                if (m.isInstructional) {
                    const norm = Logger.normalizeForFingerprint(m.content);
                    if (seenInstructional.has(norm)) {
                        Logger.log(`[去重] 跳过重复提示词: ${m.content.substring(0, 50)}...`, LogLevels.DEBUG);
                        continue;
                    }
                    seenInstructional.add(norm);
                }
                toPin.push({
                    role: m.role,
                    content: m.content,
                    isInstructional: m.isInstructional,
                    uid: m.uid,
                });
            }

            CacheState.pinnedSequence = toPin;
            CacheState.cachedFingerprint = generateFingerprint(toPin);
            Logger.log(`[初始化] 锁定前缀序列 (${toPin.length} 条消息，提示词去重后)`, LogLevels.BASIC);

            // 构建并发送（当前用户输入 + 预填充）
            const finalMessages = buildFinalMessages(toPin, currentUserInput, currentMessages.filter(m => m.isPrefill));
            applyToStream(stream, finalMessages);
            updateStats(true);
            return;
        }

        // --- 第3步：常规运行，新旧对比 ---
        // 构建当前“非预填充且非当前用户输入”的序列（与pinned对比用）
        const currentNonPrefillSeq = otherNonPrefill.map(m => ({
            role: m.role,
            content: m.content,
            isInstructional: m.isInstructional,
            uid: m.uid,
        }));

        // 3.1 检查是否发生大规模变化（如角色卡、预设彻底更换）
        if (isMajorChange(CacheState.pinnedSequence, currentNonPrefillSeq)) {
            triggerResetAlert('majorChange');
            return; // 不处理本次请求，弹出确认框
        }

        // 3.2 检查是否有大幅删减
        const removals = findRemovals(CacheState.pinnedSequence, currentNonPrefillSeq);
        if (removals.length > 0) {
            const removedTokens = removals.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0);
            const totalTokens = CacheState.pinnedSequence.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0);
            const ratio = totalTokens > 0 ? removedTokens / totalTokens : 0;
            Logger.warn(`[检测删减] 发现 ${removals.length} 条被移除，占比 ${(ratio*100).toFixed(1)}%`, LogLevels.BASIC);
            if (ratio > 0.2) { // 阈值20%
                triggerResetAlert('majorDelete');
                return;
            }
        }

        // 3.3 找出新增条目（提示词去重处理，真实对话直接追加）
        const { newItems, updatedPinned } = findAdditionsAndMerge(CacheState.pinnedSequence, currentNonPrefillSeq);
        if (newItems.length > 0) {
            Logger.warn(`[增量追加] 新增 ${newItems.length} 个条目`, LogLevels.DETAILED);
            newItems.forEach(item => {
                Logger.warn(`  + ${item.role}: ${item.content.substring(0, 50)}...`, LogLevels.DEBUG);
            });
        }
        CacheState.pinnedSequence = updatedPinned;
        CacheState.cachedFingerprint = generateFingerprint(updatedPinned);

        // --- 第4步：构建最终消息序列 ---
        const finalMessages = buildFinalMessages(updatedPinned, currentUserInput, currentMessages.filter(m => m.isPrefill));
        applyToStream(stream, finalMessages);

        // 统计
        updateStats(false);

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

// 构建最终发送的消息序列：锁定前缀 + 当前用户输入 + 预填充
function buildFinalMessages(pinned, currentUser, prefills) {
    const final = pinned.map(m => ({ role: m.role, content: m.content }));
    if (currentUser) {
        final.push({ role: currentUser.role, content: currentUser.content });
    }
    prefills.forEach(p => final.push({ role: p.role, content: p.content }));
    return final;
}

// 应用重组结果到 data.chat
function applyToStream(stream, finalMessages) {
    stream.splice(0, stream.length);
    finalMessages.forEach(msg => stream.push({ role: msg.role, content: msg.content }));
}

// 找出新增并合并至pinned，同时对提示词去重
function findAdditionsAndMerge(oldPinned, newSeq) {
    const newItems = [];
    const merged = [...oldPinned];
    const seenInstructional = new Set(oldPinned.filter(m => m.isInstructional).map(m => Logger.normalizeForFingerprint(m.content)));
    const oldUids = new Set(oldPinned.map(m => m.uid));

    for (const item of newSeq) {
        if (!oldUids.has(item.uid)) {
            if (item.isInstructional) {
                const norm = Logger.normalizeForFingerprint(item.content);
                if (seenInstructional.has(norm)) {
                    Logger.log(`[去重] 忽略重复提示词: ${item.content.substring(0, 50)}...`, LogLevels.DEBUG);
                    continue;
                }
                seenInstructional.add(norm);
            }
            newItems.push(item);
            merged.push(item);
        }
    }
    return { newItems, updatedPinned: merged };
}

// 找出旧序列中有，新序列中没有的条目
function findRemovals(oldPinned, newSeq) {
    const newUids = new Set(newSeq.map(m => m.uid));
    return oldPinned.filter(m => !newUids.has(m.uid));
}

// 判断是否发生大型变化（基于系统提示词相似度）
function isMajorChange(oldPinned, newSeq) {
    if (!oldPinned || !newSeq) return true;
    const oldSystem = oldPinned.filter(m => m.role === 'system').map(m => m.content).join('\n');
    const newSystem = newSeq.filter(m => m.role === 'system').map(m => m.content).join('\n');
    if (oldSystem || newSystem) {
        const sim = similarity(oldSystem, newSystem);
        Logger.log(`[系统提示词相似度] ${(sim * 100).toFixed(1)}%`, LogLevels.DEBUG);
        return sim < 0.5;
    }
    return false;
}

// 生成序列指纹
function generateFingerprint(sequence) {
    return sequence.map(m => `${m.role}:${m.uid}`).join('|');
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

// 更新统计UI
function updateStats(isInit = false) {
    const { total, hits, savedTokens } = CacheState.stats;
    if (isInit) {
        CacheState.stats.total++;
        CacheState.stats.hits++;
        CacheState.stats.savedTokens += Logger.estimateTokens(
            CacheState.pinnedSequence.map(m => m.content).join('')
        );
    } else {
        CacheState.stats.total++;
        CacheState.stats.hits++; // 简化：只要有前缀就视为命中
        CacheState.stats.savedTokens += Logger.estimateTokens(
            CacheState.pinnedSequence.map(m => m.content).join('')
        );
    }
    CacheState.stats.prefixTokens = Logger.estimateTokens(
        CacheState.pinnedSequence?.map(m => m.content).join('') || ''
    );
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
// 重置确认弹窗
// ==========================================
function triggerResetAlert(type) {
    if (CacheState.pendingReset) return; // 已有未处理弹窗
    CacheState.pendingReset = true;
    const msg = type === 'majorDelete'
        ? '检测到对话历史被大幅删减，会导致 DeepSeek 缓存命中率大幅降低。建议重置缓存前缀以继续获得最佳性能。是否重置？'
        : '检测到提示词核心变动（如更换角色卡或预设），需要重置缓存前缀以继续获得最佳性能。是否重置？';
    showResetDialog(msg);
}

function showResetDialog(message) {
    const dialog = document.getElementById('ds-reset-dialog');
    const textEl = document.getElementById('ds-reset-dialog-text');
    if (!dialog || !textEl) {
        // 降级：直接用confirm（可能阻塞）
        const confirmReset = confirm(message + '\n点击“确定”重置，“取消”保持当前状态。');
        if (confirmReset) {
            performReset();
        } else {
            CacheState.pendingReset = false;
        }
        return;
    }
    textEl.textContent = message;
    dialog.style.display = 'flex';
}

function hideResetDialog() {
    const dialog = document.getElementById('ds-reset-dialog');
    if (dialog) dialog.style.display = 'none';
}

function performReset() {
    CacheState.pinnedSequence = null;
    CacheState.cachedFingerprint = null;
    CacheState.lastSentSequence = null;
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    CacheState.pendingReset = false;
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
                <b>🧠 DS V4 Cache Optimizer v6.0 (智能前缀 + 提示词去重)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">自动锁定固定前缀，识别并去重提示词，增量追加对话历史，自适应检测变动并提醒重置。</p>
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

        <!-- 自定义重置确认弹窗 -->
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

        // 事件绑定
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
            CacheState.pendingReset = false;
            hideResetDialog();
            Logger.warn('[用户操作] 选择不重置，继续使用当前前缀（可能缓存不命中）', LogLevels.BASIC);
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
    console.log('DS V4 Optimizer v6 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 已挂载 CHAT_COMPLETION_PROMPT_READY 事件钩子', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载关键事件钩子，扩展无法运行。');
    }
    Logger.log('══════ v6.0 就绪，策略：智能分类 + 提示词去重 + 增量历史 ══════', LogLevels.BASIC);
});
