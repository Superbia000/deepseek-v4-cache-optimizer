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
// 缓存状态机 (v5 核心：位置锁定与增量追加)
// ==========================================
const CacheState = {
    enabled: true,
    // 核心：被“钉住”的提示词序列 (包含内容和角色的对象列表)
    pinnedSequence: null,
    // 指纹快照，用于快速判断核心内容是否发生变化
    cachedFingerprint: null,
    // 记录上一轮请求的实际消息序列，用于计算缓存命中率
    lastSentSequence: null,
    // 统计
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// ==========================================
// 去重：对非 user/assistant 的消息保留第一次出现，其他角色可去除重复项
// ==========================================
function deduplicateNonDialog(messages) {
    const seen = new Set();
    const result = [];
    for (const msg of messages) {
        if (msg.role === 'user' || msg.role === 'assistant') {
            result.push(msg);
        } else {
            const normalized = Logger.normalizeForFingerprint(msg.content);
            if (!seen.has(normalized)) {
                seen.add(normalized);
                result.push(msg);
            } else {
                Logger.log(`[去重] 忽略重复的非对话消息: ${msg.role} ${msg.content.substring(0, 50)}...`, LogLevels.DEBUG);
            }
        }
    }
    return result;
}

// ==========================================
// 核心拦截与重组 (v5 完全重写)
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`[请求 #${CacheState.stats.total}] 开始处理...`);

        if (!data?.chat?.length) return;
        const stream = data.chat; // 引用原始数组

        // --- 第 1 步: 解析当前消息数组并去重非对话内容 ---
        let currentMessages = [];

        // 找出预填充部分：数组末尾连续的 assistant 消息
        let prefillStartIndex = stream.length;
        while (prefillStartIndex > 0 && stream[prefillStartIndex - 1].role === 'assistant') {
            prefillStartIndex--;
        }

        for (let i = 0; i < stream.length; i++) {
            const msg = stream[i];
            const isPrefill = (i >= prefillStartIndex && msg.role === 'assistant');
            currentMessages.push({
                role: msg.role,
                content: msg.content || '',
                isPrefill: isPrefill
            });
        }

        // 去重：仅对非 user/assistant 消息 (保持 user/assistant 原样)
        currentMessages = deduplicateNonDialog(currentMessages);

        // --- 第 2 步: 判断状态 (初始化、恢复或常规运行) ---
        // 首次运行，或用户手动重置后
        if (!CacheState.pinnedSequence) {
            // 初始化：将当前所有非预填充消息“钉住”
            CacheState.pinnedSequence = currentMessages.filter(m => !m.isPrefill).map(m => ({ role: m.role, content: m.content }));
            CacheState.cachedFingerprint = generateFingerprint(CacheState.pinnedSequence);
            Logger.log(`[初始化] 首次锁定提示词序列 (${CacheState.pinnedSequence.length} 条消息)`, LogLevels.BASIC);
            // 直接使用当前消息作为第一次请求，无需修改
            buildAndSetFinalMessages(currentMessages, stream);
            CacheState.stats.hits++;
            CacheState.stats.prefixTokens = countTokenForSequence(CacheState.pinnedSequence);
            CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
            return;
        }

        // 常规运行：提取当前非预填充消息
        const currentNonPrefillMessages = currentMessages.filter(m => !m.isPrefill);

        // --- 第 3 步: 核心比对与状态处理 ---
        // 3.1 检查是否发生大规模变化 (如角色卡、预设彻底更换)
        if (isMajorChange(CacheState.pinnedSequence, currentNonPrefillMessages)) {
            const reason = '检测到提示词核心内容发生变化 (角色卡/预设可能已更换)';
            resetCacheState(reason);
            interceptAndRestructurePrompt(data); // 重新以当前内容锁定
            return;
        }

        // 3.2 检测是否有消息被删除
        const removedItems = findRemovals(CacheState.pinnedSequence, currentNonPrefillMessages);
        if (removedItems.length > 0) {
            const reason = `检测到历史消息被删除或大幅修改 (${removedItems.length} 条)`;
            resetCacheState(reason);
            interceptAndRestructurePrompt(data);
            return;
        }

        // 3.3 查找新增条目
        const { newItems } = findAdditions(CacheState.pinnedSequence, currentNonPrefillMessages);

        // 3.4 若新增条目中包含非 user/assistant 消息，则视为上下文结构变化，重置
        if (newItems.some(item => item.role !== 'user' && item.role !== 'assistant')) {
            const reason = '检测到上下文结构变化 (新增了系统/工具等非对话消息)';
            resetCacheState(reason);
            interceptAndRestructurePrompt(data);
            return;
        }

        // --- 第 4 步: 常规情况 - 追加新增条目到尾部 ---
        if (newItems.length > 0) {
            Logger.warn(`[增量追加] 发现 ${newItems.length} 个新增对话条目，将追加到提示词序列末尾。`, LogLevels.DETAILED);
            newItems.forEach(item => {
                Logger.warn(`  + ${item.role}: ${item.content.substring(0, 50)}...`, LogLevels.DEBUG);
            });
            CacheState.pinnedSequence = CacheState.pinnedSequence.concat(newItems);
        }

        // 更新指纹
        CacheState.cachedFingerprint = generateFingerprint(CacheState.pinnedSequence);

        // --- 第 5 步: 重组最终消息序列 ---
        // 提取当前消息中的预填充部分
        const currentPrefillMessages = currentMessages.filter(m => m.isPrefill);

        // 构建最终发送序列：被钉住的序列 + 当前预填充
        const finalMessages = CacheState.pinnedSequence.map(m => ({ role: m.role, content: m.content, isPrefill: false }));
        finalMessages.push(...currentPrefillMessages);

        // --- 第 6 步: 计算缓存命中统计 ---
        const sentNowFingerprint = generateFingerprint(finalMessages);
        const cacheHit = CacheState.lastSentSequence && CacheState.lastSentSequence === sentNowFingerprint;

        if (cacheHit) {
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
            Logger.log('[缓存命中] 与上一轮请求完全一致，前缀部分全部命中缓存。', LogLevels.BASIC);
        } else {
            const prefixTokens = countTokenForSequence(CacheState.pinnedSequence);
            if (CacheState.lastSentSequence) {
                const newTokens = Logger.estimateTokens(finalMessages.map(m => m.content).join('')) - prefixTokens;
                Logger.log(`[部分命中] 前缀新增内容，上一轮旧前缀完全命中，仅尾部新增约 ${newTokens} tokens 需要计算。`, LogLevels.BASIC);
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
// 重置缓存状态并弹窗
// ==========================================
function resetCacheState(reason) {
    Logger.warn(`[重置] ${reason}，缓存前缀已重置。`, LogLevels.BASIC);
    CacheState.pinnedSequence = null;
    CacheState.cachedFingerprint = null;
    CacheState.lastSentSequence = null;
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    if (typeof toastr !== 'undefined') {
        toastr.warning(reason, '缓存优化器');
    }
    updateStatsUI();
}

// ==========================================
// 辅助函数
// ==========================================

// 判断是否为大型变化 (例如切换角色卡/预设)
function isMajorChange(oldSeq, newSeq) {
    if (!oldSeq || !newSeq) return true;
    if (oldSeq.length === 0 || newSeq.length === 0) return true;

    // 比较所有 system 消息的指纹拼接
    const oldSystemFingerprint = generateFingerprint(oldSeq.filter(m => m.role === 'system'));
    const newSystemFingerprint = generateFingerprint(newSeq.filter(m => m.role === 'system'));

    if (oldSystemFingerprint !== newSystemFingerprint) {
        Logger.log(`[系统消息变化] 指纹由 ${oldSystemFingerprint} 变为 ${newSystemFingerprint}`, LogLevels.DEBUG);
        return true;
    }

    // 额外检查总长度突变
    const oldTotalLen = oldSeq.reduce((sum, m) => sum + m.content.length, 0);
    const newTotalLen = newSeq.reduce((sum, m) => sum + m.content.length, 0);
    if (Math.abs(oldTotalLen - newTotalLen) > oldTotalLen * 0.4) {
        Logger.log(`[长度突变] 旧${oldTotalLen} 新${newTotalLen}`, LogLevels.DEBUG);
        return true;
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
    return { newItems: trulyNew };
}

// 找出oldSeq中存在，但newSeq中不存在的条目 (即被用户删除的)
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

// 将最终消息序列设置回 data.chat
function buildAndSetFinalMessages(finalMessages, originalStream) {
    originalStream.splice(0, originalStream.length);
    finalMessages.forEach(msg => {
        originalStream.push({ role: msg.role, content: msg.content });
    });
}

// ==========================================
// UI (v5 增强版，支持日志等级选择)
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
                <b>🧠 DS V4 Cache Optimizer v5.1 (自适应增量版)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">自动锁定提示词前缀，智能重置与去重，实现近乎完美的自动化缓存命中。</p>
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
            resetCacheState('用户手动重置');
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
    Logger.log('══════ v5.1 就绪，策略：自动锁定前缀 + 增量追加 + 智能重置 ══════', LogLevels.BASIC);
});
