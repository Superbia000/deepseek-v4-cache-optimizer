import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';
import { POPUP_TYPE, callGenericPopup } from '../../../popup.js';

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
    // 标准化字符串用于指纹比对（消除空格和标点差异）
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
// 缓存状态机 (v5.1 核心：位置锁定与增量追加，增强去重与自适应重置)
// ==========================================
const CacheState = {
    enabled: true,
    // 核心：被“钉住”的提示词序列 (包含内容和角色的对象列表)
    pinnedSequence: null,
    // 指纹快照，用于快速判断核心内容是否发生变化
    cachedFingerprint: null,
    // 记录上一轮请求的消息指纹，用于快速比对缓存命中
    lastSentFingerprint: null,
    // 统计
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
    // 新增：待重置的原因，用于触发弹窗
    pendingResetReason: null,
    // 新增：记录当前角色ID和预设名称，用于检测变更
    currentCharacterId: null,
    currentPresetName: null
};

// ==========================================
// 核心拦截与重组 (v5.1 完全重写)
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`[请求 #${CacheState.stats.total}] 开始处理...`);

        if (!data?.chat?.length) return;
        const stream = data.chat; // 引用原始数组

        // --- 第 0 步: 检查待处理的重置请求 (弹窗交互) ---
        if (CacheState.pendingResetReason) {
            const shouldReset = await showResetConfirmationPopup(CacheState.pendingResetReason);
            if (shouldReset) {
                resetAllState();
                Logger.warn('[用户确认重置] 状态已清空，将在下次请求重新初始化。', LogLevels.BASIC);
                return; // 重置后，本次请求不修改，让后续请求重新初始化
            } else {
                Logger.warn('[用户取消重置] 将忽略重置请求，继续使用当前状态。', LogLevels.BASIC);
                CacheState.pendingResetReason = null;
            }
        }

        // --- 第 1 步: 解析当前消息数组，并应用去重逻辑 ---
        const currentMessagesRaw = [];
        let prefillStartIndex = stream.length;
        while (prefillStartIndex > 0 && stream[prefillStartIndex - 1].role === 'assistant') {
            prefillStartIndex--;
        }

        for (let i = 0; i < stream.length; i++) {
            const msg = stream[i];
            const isPrefill = (i >= prefillStartIndex && msg.role === 'assistant');
            currentMessagesRaw.push({
                role: msg.role,
                content: msg.content || '',
                isPrefill: isPrefill,
                isManualUserOrAI: false // 将在后续步骤中标记
            });
        }

        // 标记手动用户输入和 AI 主动回复 (不包含提示词注入)
        const currentNonPrefill = currentMessagesRaw.filter(m => !m.isPrefill);
        for (let i = 0; i < currentNonPrefill.length; i++) {
            const msg = currentNonPrefill[i];
            // 简单判断：如果非 system 角色，且内容不为空，则认为是手动输入或AI回复
            if (msg.role !== 'system' && msg.content.trim() !== '') {
                msg.isManualUserOrAI = true;
            }
        }

        // 应用提示词去重 (仅针对非手动/非AI部分)
        const currentMessages = applyDeduplication(currentMessagesRaw);

        // --- 第 2 步: 自适应检测角色卡/预设变更 ---
        checkForExternalChanges();

        // --- 第 3 步: 正常流程 (同原版，但增强去重) ---
        // 首次初始化
        if (!CacheState.pinnedSequence) {
            CacheState.pinnedSequence = currentMessages.filter(m => !m.isPrefill).map(m => ({ role: m.role, content: m.content, isManual: m.isManualUserOrAI }));
            CacheState.cachedFingerprint = generateFingerprint(CacheState.pinnedSequence);
            Logger.log(`[初始化] 首次锁定提示词序列 (${CacheState.pinnedSequence.length} 条消息，已应用去重)`, LogLevels.BASIC);
            buildAndSetFinalMessages(currentMessages, stream);
            CacheState.stats.hits++;
            CacheState.stats.prefixTokens = countTokenForSequence(CacheState.pinnedSequence);
            CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
            CacheState.lastSentFingerprint = generateFingerprint(currentMessages);
            return;
        }

        const currentNonPrefillMessages = currentMessages.filter(m => !m.isPrefill);

        // 检测大规模删减
        const removalRatio = calculateRemovalRatio(CacheState.pinnedSequence, currentNonPrefillMessages);
        if (removalRatio > 0.3) { // 超过30%的内容被删除则触发重置询问
            Logger.warn(`[大幅删减] 检测到约 ${(removalRatio * 100).toFixed(1)}% 的内容被移除，将请求用户确认。`, LogLevels.BASIC);
            cacheState.pendingResetReason = `检测到约 ${(removalRatio * 100).toFixed(1)}% 的提示词内容被删除`;
            return;
        }

        // 检测大规模变化 (如角色卡、预设彻底更换)
        if (isMajorChange(CacheState.pinnedSequence, currentNonPrefillMessages)) {
            Logger.warn('[核心重置] 检测到大型内容变动 (如角色切换)，将请求用户确认。', LogLevels.BASIC);
            CacheState.pendingResetReason = '检测到角色卡或预设发生重大变化';
            return;
        }

        // 常规增量追加与移除
        const { newItems } = findAdditions(CacheState.pinnedSequence, currentNonPrefillMessages);
        const removedItems = findRemovals(CacheState.pinnedSequence, currentNonPrefillMessages);

        if (removedItems.length > 0) {
            Logger.warn(`[动态削除] ${removedItems.length} 条提示词被移除，从锁定序列中删除。`, LogLevels.DETAILED);
            CacheState.pinnedSequence = CacheState.pinnedSequence.filter(pinnedItem => {
                return !removedItems.some(removedItem => 
                    removedItem.role === pinnedItem.role && removedItem.content === pinnedItem.content
                );
            });
        }

        if (newItems.length > 0) {
            Logger.warn(`[增量追加] 发现 ${newItems.length} 个新增提示词条目。`, LogLevels.DETAILED);
            CacheState.pinnedSequence = CacheState.pinnedSequence.concat(newItems.filter(item => item.role !== 'system' || !isDuplicateSystemMessage(CacheState.pinnedSequence, item)));
        }

        CacheState.cachedFingerprint = generateFingerprint(CacheState.pinnedSequence);

        const currentPrefillMessages = currentMessages.filter(m => m.isPrefill);
        const finalMessages = CacheState.pinnedSequence.map(m => ({ role: m.role, content: m.content, isPrefill: false }));
        finalMessages.push(...currentPrefillMessages);

        const sentNowFingerprint = generateFingerprint(finalMessages);
        const cacheHit = CacheState.lastSentFingerprint && CacheState.lastSentFingerprint === sentNowFingerprint;

        if (cacheHit) {
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
            Logger.log('[缓存命中] 与上一轮请求完全一致，前缀部分全部命中缓存。', LogLevels.BASIC);
        } else {
            const prefixTokens = countTokenForSequence(CacheState.pinnedSequence);
            if (CacheState.lastSentFingerprint) {
                Logger.log(`[部分命中] 前缀新增内容，上一轮旧前缀完全命中。`, LogLevels.BASIC);
            } else {
                Logger.log('[首次发送] 建立缓存基线。', LogLevels.BASIC);
            }
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += prefixTokens;
        }

        CacheState.lastSentFingerprint = sentNowFingerprint;
        CacheState.stats.prefixTokens = countTokenForSequence(CacheState.pinnedSequence);

        buildAndSetFinalMessages(finalMessages, stream);
        updateStatsUI();

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

// ==========================================
// 新增：去重与自适应检测辅助函数
// ==========================================

/**
 * 应用提示词去重：确保每条非手动/非AI的系统提示词在序列中只出现一次。
 * 手动用户输入和AI回复允许重复。
 */
function applyDeduplication(messages) {
    const deduplicated = [];
    const seenContent = new Map(); // key: "role:normalizedContent", value: index

    for (const msg of messages) {
        const key = `${msg.role}:${Logger.normalizeForFingerprint(msg.content)}`;
        
        if (msg.isManualUserOrAI) {
            // 用户输入和AI回复允许重复，直接添加
            deduplicated.push(msg);
            seenContent.set(key, deduplicated.length - 1);
        } else {
            // 系统提示词等，如果内容已存在则跳过
            if (!seenContent.has(key)) {
                deduplicated.push(msg);
                seenContent.set(key, deduplicated.length - 1);
            } else {
                Logger.log(`[去重] 忽略重复的系统提示词: ${msg.content.substring(0, 50)}...`, LogLevels.DEBUG);
            }
        }
    }
    return deduplicated;
}

/**
 * 检查是否是新系统消息（用于增量追加时的额外检查）
 */
function isDuplicateSystemMessage(sequence, message) {
    return sequence.some(m => m.role === message.role && m.content === message.content);
}

/**
 * 计算 pinnedSequence 中有多大比例的内容在当前非预填充消息中缺失
 */
function calculateRemovalRatio(pinned, current) {
    if (!pinned || pinned.length === 0) return 0;
    
    let missingCount = 0;
    for (const pinnedItem of pinned) {
        const found = current.some(curr => 
            curr.role === pinnedItem.role && 
            Logger.normalizeForFingerprint(curr.content) === Logger.normalizeForFingerprint(pinnedItem.content)
        );
        if (!found) missingCount++;
    }
    return missingCount / pinned.length;
}

/**
 * 自适应检测角色卡或预设的外部变更（通过事件和内容探查）
 */
function checkForExternalChanges() {
    const context = getContext();
    if (!context) return;

    const currentCharId = context.characterId;
    const currentPreset = context.chatCompletionPreset || "default";

    if (CacheState.currentCharacterId !== null && CacheState.currentCharacterId !== currentCharId) {
        Logger.warn(`[角色变更] 检测到角色从 ${CacheState.currentCharacterId} 切换到 ${currentCharId}`, LogLevels.BASIC);
        CacheState.pendingResetReason = '角色卡片已被更换';
    }
    
    if (CacheState.currentPresetName !== null && CacheState.currentPresetName !== currentPreset) {
        Logger.warn(`[预设变更] 检测到预设从 ${CacheState.currentPresetName} 切换到 ${currentPreset}`, LogLevels.BASIC);
        CacheState.pendingResetReason = 'Chat Completion 预设已被更换';
    }

    CacheState.currentCharacterId = currentCharId;
    CacheState.currentPresetName = currentPreset;
}

/**
 * 显示重置确认弹窗 (永久存在，直到用户点击“重置”或“取消”)
 */
async function showResetConfirmationPopup(reason) {
    return new Promise((resolve) => {
        const html = `
            <div class="flex-container flex-column" style="gap: 1rem; max-width: 450px;">
                <h3>🧠 DeepSeek 缓存优化器</h3>
                <p><strong>检测到提示词结构发生显著变化：</strong></p>
                <p style="color: var(--warning-color);">${reason}</p>
                <p>为了最大化缓存命中率，建议<strong>重置缓存前缀状态</strong>。重置后，将在下一次请求中自动重新构建缓存基线。</p>
                <p><em>提示：此弹窗将一直显示，直到您做出选择。</em></p>
            </div>
        `;

        // 使用内置的 callGenericPopup 创建模态确认框
        callGenericPopup({
            title: '缓存优化器：需要您的确认',
            message: html,
            okButton: '重置',
            cancelButton: '取消',
            isModal: true,
            allowClose: false, // 禁止点击遮罩层关闭
        }).then((result) => {
            if (result) {
                resolve(true);
            } else {
                resolve(false);
            }
        });
    });
}

// ==========================================
// 辅助函数 (保持不变，但稍作增强)
// ==========================================

// 判断是否为大型变化 (例如切换角色)
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

// 找出新增条目 (newSeq中有，但oldSeq中没有的)
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

// 找出oldSeq中存在，但newSeq中不存在的条目
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

// 生成序列的标准化指纹
function generateFingerprint(sequence) {
    return sequence.map(m => `${m.role}:${Logger.simpleHash(Logger.normalizeForFingerprint(m.content))}`).join('|');
}

// 计算一个序列的总 token 数
function countTokenForSequence(sequence) {
    return sequence.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0);
}

// 简单的行级文本相似度
function similarity(oldText, newText) {
    if (!oldText || !newText) return 0;
    const oldLines = new Set(oldText.split('\n').map(l => l.trim()).filter(Boolean));
    const newLines = newText.split('\n').map(l => l.trim()).filter(Boolean);
    if (newLines.length === 0) return 1;
    let common = 0;
    for (const l of newLines) if (oldLines.has(l)) common++;
    return common / newLines.length;
}

// 将最终消息序列设置回 data.chat
function buildAndSetFinalMessages(finalMessages, originalStream) {
    originalStream.splice(0, originalStream.length);
    finalMessages.forEach(msg => {
        originalStream.push({ role: msg.role, content: msg.content });
    });
}

// 重置所有状态
function resetAllState() {
    CacheState.pinnedSequence = null;
    CacheState.cachedFingerprint = null;
    CacheState.lastSentFingerprint = null;
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    CacheState.pendingResetReason = null;
    updateStatsUI();
    Logger.warn('[系统] 所有状态已重置，缓存前缀将在下次请求重新构建。', LogLevels.BASIC);
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
                <b>🧠 DS V4 Cache Optimizer v5.1 (智能去重与自适应重置)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">自动锁定提示词前缀，增量追加新增内容，实现近乎完美的自动化缓存命中。新增智能去重与卡/预设变更感知。</p>
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
            resetAllState();
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

    // 监听预设和角色变更事件
    eventSource.on(event_types.CHAT_CHANGED, () => {
        checkForExternalChanges();
    });
    eventSource.on(event_types.CHARACTER_SELECTED, () => {
        checkForExternalChanges();
    });

    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 已挂载 CHAT_COMPLETION_PROMPT_READY 事件钩子', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载关键事件钩子，扩展无法运行。');
    }
    Logger.log('══════ v5.1 就绪，策略：智能去重 + 自适应重置 + 增量追加 ══════', LogLevels.BASIC);
});
