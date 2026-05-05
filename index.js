import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 模块 1：日志系统（支持等级过滤）
// ==========================================
const LOG_LEVELS = { OFF: 0, BASIC: 1, DETAIL: 2, DEBUG: 3 };
let currentLogLevel = LOG_LEVELS.DETAIL; // 默认详细

const Logger = {
    _uiTextarea: null,
    _logLevel: LOG_LEVELS.DETAIL,
    setLevel(level) {
        this._logLevel = level;
        this.log(`日志等级切换为: ${Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === level)}`);
    },
    log(msg, level = LOG_LEVELS.BASIC) {
        if (level > this._logLevel) return;
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const prefix = level === LOG_LEVELS.DEBUG ? `[${time}] 🔍` : `[${time}] ✅`;
        console.log(`%c[DS V4 Opt v3.2] ${msg}`, 'color: #00ff00; font-weight: bold;');
        this._append(`${prefix} ${msg}`);
    },
    warn(msg, level = LOG_LEVELS.BASIC) {
        if (level > this._logLevel) return;
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        console.warn(`%c[DS V4 Opt v3.2] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
        this._append(`[${time}] 🌪️ ${msg}`);
    },
    error(msg, err) {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        console.error(`[DS V4 Opt v3.2] 🔴 ${msg}`, err || '');
        this._append(`[${time}] 🔴 ${msg}`);
    },
    _append(text) {
        if (Logger._uiTextarea) {
            Logger._uiTextarea.value += text + '\n';
            Logger._uiTextarea.scrollTop = Logger._uiTextarea.scrollHeight;
        }
    }
};

// ==========================================
// 模块 2：文本归一化（处理标点、空格不一致）
// ==========================================
function normalizeText(str) {
    if (!str) return '';
    // 1. 全角转半角（保留中文）
    let result = str.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    // 2. 统一引号：将中文引号 ""'' 转为 "
    result = result.replace(/[\u201C\u201D\u2018\u2019]/g, '"');
    // 3. 去除行首行尾空格，以及连续空格
    result = result.replace(/[ \t]+/g, ' ');
    result = result.replace(/\n\s+/g, '\n');
    result = result.trim();
    // 4. 标准化省略号为 ...
    result = result.replace(/…/g, '...');
    return result;
}

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}

// 基于归一化文本的哈希
function normalizedHash(str) {
    return simpleHash(normalizeText(str));
}

// ==========================================
// 模块 3：Token 估算
// ==========================================
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
// 模块 4：缓存状态机（增加归一化快照）
// ==========================================
const CacheState = {
    enabled: true,
    staticCore: null,                 // 原始冻结文本（用于发送）
    staticCoreNormalized: null,       // 归一化后文本（用于比较）
    absorbedMessages: [],             // 原始吸收指令列表
    absorbedNormalized: [],           // 对应归一化后的列表
    knownFloatsNormalized: new Set(), // 存储归一化指纹
    lastBottomBlocks: [],
    lastPrefixSnapshotNormalized: null, // 归一化后的前缀快照
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// ==========================================
// 模块 5：消息分类
// ==========================================
function classifyMessages(chat) {
    const systems = [], chatHistory = [], prefills = [];
    const working = [...chat];
    while (working.length > 0 && working[working.length - 1].role === 'assistant') {
        prefills.unshift(working.pop());
    }
    for (const msg of working) {
        if (msg.role === 'system') systems.push(msg);
        else chatHistory.push(msg);
    }
    return { systems, chatHistory, prefills };
}

function mergeSystemText(systemMsgs) {
    const seen = new Set();
    const lines = [];
    for (const msg of systemMsgs) {
        const content = msg.content || '';
        for (const line of content.split('\n')) {
            const t = line.trim();
            if (t && !seen.has(t)) {
                seen.add(t);
                lines.push(line);
            }
        }
    }
    return lines.join('\n');
}

function similarity(oldNormalized, newRaw) {
    const newNorm = normalizeText(newRaw);
    if (!oldNormalized || !newNorm) return 0;
    const oldLines = new Set(oldNormalized.split('\n').filter(Boolean));
    const newLines = newNorm.split('\n').filter(Boolean);
    if (newLines.length === 0) return 1;
    let common = 0;
    for (const l of newLines) if (oldLines.has(l)) common++;
    return common / newLines.length;
}

// ==========================================
// 模块 6：浮动指令检测与吸收（归一化版）
// ==========================================
function detectAndAbsorbFloats(chatHistory) {
    if (!chatHistory.length) return { cleaned: chatHistory, newlyAbsorbed: [] };
    const currentBottoms = chatHistory.slice(-3);
    const cleaned = [];
    const newlyAbsorbed = [];

    for (let i = 0; i < chatHistory.length; i++) {
        const msg = chatHistory[i];
        const isBottom = i >= chatHistory.length - 3;
        const long = msg.content && msg.content.length > 25;

        const normalizedContent = normalizeText(msg.content);
        if (!normalizedContent) continue; // 跳过空消息

        if (CacheState.knownFloatsNormalized.has(normalizedContent)) {
            continue; // 已吸收
        }

        const wasInLastBottom = CacheState.lastBottomBlocks.some(b => normalizeText(b.content) === normalizedContent);
        if (isBottom && long && wasInLastBottom) {
            // 新发现浮动指令
            CacheState.knownFloatsNormalized.add(normalizedContent);
            const entry = { role: 'user', content: msg.content }; // 保留原始内容用于发送
            CacheState.absorbedMessages.push(entry);
            CacheState.absorbedNormalized.push(normalizedContent);
            newlyAbsorbed.push(entry);
            Logger.warn(`吸收新浮动指令 (${msg.role}, ${msg.content.length}字)，归一化指纹: ${normalizedHash(msg.content)}`, LOG_LEVELS.DETAIL);
            continue;
        }
        cleaned.push(msg);
    }

    CacheState.lastBottomBlocks = cleaned.slice(-3).map(m => ({ role: m.role, content: m.content }));
    return { cleaned, newlyAbsorbed };
}

// ==========================================
// 模块 7：前缀快照与差异报告（归一化）
// ==========================================
function capturePrefixSnapshotNormalized() {
    return {
        systemHash: normalizedHash(CacheState.staticCore),
        systemLen: CacheState.staticCore ? CacheState.staticCore.length : 0,
        systemTokens: estimateTokens(CacheState.staticCore),
        absorbedHashes: CacheState.absorbedNormalized.map(s => simpleHash(s)),
        absorbedLengths: CacheState.absorbedMessages.map(m => m.content.length),
        absorbedTokens: CacheState.absorbedMessages.map(m => estimateTokens(m.content)),
        totalPrefixTokens: estimateTokens(CacheState.staticCore) + CacheState.absorbedMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
    };
}

function comparePrefixSnapshotsNormalized(prev, curr) {
    if (!prev) return '首次建立前缀，无历史对比';
    const diffs = [];
    if (prev.systemHash !== curr.systemHash) {
        diffs.push(`❌ System 核心变化 (归一化后) | 旧hash:${prev.systemHash} → 新hash:${curr.systemHash}`);
        Logger.log(`System 原始文本变化细节: 旧长度${prev.systemLen}, 新长度${curr.systemLen}`, LOG_LEVELS.DEBUG);
    } else {
        diffs.push(`✅ System 核心无变化 (${curr.systemLen}字)`);
    }
    if (prev.absorbedHashes.length !== curr.absorbedHashes.length) {
        diffs.push(`🔶 吸收指令数量变化: ${prev.absorbedHashes.length} → ${curr.absorbedHashes.length}`);
    }
    for (let i = 0; i < Math.max(prev.absorbedHashes.length, curr.absorbedHashes.length); i++) {
        const prevHash = prev.absorbedHashes[i] || '(无)';
        const currHash = curr.absorbedHashes[i] || '(无)';
        if (prevHash !== currHash) {
            diffs.push(`🔸 吸收指令 #${i+1} 变化 (归一化) | 旧hash:${prevHash} (${prev.absorbedLengths[i] || 0}字) → 新hash:${currHash} (${curr.absorbedLengths[i] || 0}字)`);
        } else {
            diffs.push(`✅ 吸收指令 #${i+1} 无变化 (${curr.absorbedLengths[i]}字)`);
        }
    }
    return diffs.join('\n');
}

// ==========================================
// 模块 8：核心拦截重组（归一化版 + 主动吸收固定 user 指令）
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`, LOG_LEVELS.BASIC);
        Logger.log(`拦截器 #${CacheState.stats.total}`, LOG_LEVELS.BASIC);

        if (!data?.chat?.length) return;
        const original = [...data.chat];
        const { systems, chatHistory, prefills } = classifyMessages(original);
        const currentSystemRaw = mergeSystemText(systems);

        // ---- 初始化或重置静态核心 ----
        if (!CacheState.staticCore) {
            const { cleaned: cleanedChat, newlyAbsorbed } = detectAndAbsorbFloats(chatHistory);
            // 构建纯净静态核心（去除可能已吸收内容的原始文本）
            const staticCoreLines = currentSystemRaw.split('\n').filter(line => {
                const t = normalizeText(line);
                return t && !CacheState.knownFloatsNormalized.has(t);
            });
            CacheState.staticCore = staticCoreLines.join('\n') || currentSystemRaw;
            CacheState.staticCoreNormalized = normalizeText(CacheState.staticCore);
            Logger.log(`首次冻结静态核心 (${estimateTokens(CacheState.staticCore)} tokens)`, LOG_LEVELS.DETAIL);

            const initMsgs = [];
            initMsgs.push({ role: 'system', content: CacheState.staticCore });
            initMsgs.push(...CacheState.absorbedMessages);
            initMsgs.push(...cleanedChat);
            initMsgs.push(...prefills);
            data.chat.splice(0, data.chat.length, ...initMsgs);

            CacheState.lastPrefixSnapshotNormalized = capturePrefixSnapshotNormalized();
            CacheState.stats.prefixTokens = CacheState.lastPrefixSnapshotNormalized.totalPrefixTokens;
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
            Logger.log(`初始化完成，消息数: ${initMsgs.length}`, LOG_LEVELS.BASIC);
            updateStatsUI();
            return;
        }

        // ---- 相似度巨变检测 ----
        const sim = similarity(CacheState.staticCoreNormalized, currentSystemRaw);
        if (sim < 0.3 && currentSystemRaw.length > 50) {
            Logger.warn(`系统核心剧变 (相似度 ${(sim*100).toFixed(1)}%)，重置所有缓存状态`, LOG_LEVELS.BASIC);
            CacheState.staticCore = null;
            CacheState.staticCoreNormalized = null;
            CacheState.absorbedMessages = [];
            CacheState.absorbedNormalized = [];
            CacheState.knownFloatsNormalized.clear();
            CacheState.lastBottomBlocks = [];
            CacheState.lastPrefixSnapshotNormalized = null;
            interceptAndRestructurePrompt(data);
            return;
        }

        // ---- 浮动指令吸收 ----
        const { cleaned: cleanedChat, newlyAbsorbed } = detectAndAbsorbFloats(chatHistory);

        // ---- 主动吸收：若 chatHistory 中存在以特定模式开头的 user 消息且连续出现，直接吸收
        // 这里简单处理：检测所有不含明显对话内容（长度 > 50 且无称呼、情感词）的 user 消息，如果是连续两轮出现，提前吸收
        // 考虑到安全，仅针对已知特征（如包含“输出由两个分区组成”）进行主动吸收
        const proactivePattern = /输出由两个分区组成|指令遵循和召回能力测试|根据当前和后续正文展开/;
        for (let i = 0; i < chatHistory.length; i++) {
            const msg = chatHistory[i];
            if (msg.role === 'user' && proactivePattern.test(msg.content)) {
                const norm = normalizeText(msg.content);
                if (!CacheState.knownFloatsNormalized.has(norm)) {
                    CacheState.knownFloatsNormalized.add(norm);
                    const entry = { role: 'user', content: msg.content };
                    CacheState.absorbedMessages.push(entry);
                    CacheState.absorbedNormalized.push(norm);
                    Logger.warn(`主动吸收固定 user 指令 (匹配模式)，长度 ${msg.content.length} 字`, LOG_LEVELS.DETAIL);
                    // 从 chatHistory 中移除
                    chatHistory.splice(i, 1);
                    i--; // 调整索引
                }
            }
        }

        // ---- 重组最终消息 ----
        const finalMessages = [];
        finalMessages.push({ role: 'system', content: CacheState.staticCore });
        finalMessages.push(...CacheState.absorbedMessages);
        finalMessages.push(...chatHistory); // 使用可能被主动吸收修改后的 chatHistory
        finalMessages.push(...prefills);

        const currentSnapshot = capturePrefixSnapshotNormalized();
        const diffReport = comparePrefixSnapshotsNormalized(CacheState.lastPrefixSnapshotNormalized, currentSnapshot);
        Logger.log(`前缀差异对比:\n${diffReport}`, LOG_LEVELS.DETAIL);

        const cacheHit = (CacheState.lastPrefixSnapshotNormalized &&
                          CacheState.lastPrefixSnapshotNormalized.systemHash === currentSnapshot.systemHash &&
                          CacheState.lastPrefixSnapshotNormalized.absorbedHashes.join(',') === currentSnapshot.absorbedHashes.join(','));

        if (cacheHit) {
            CacheState.stats.hits++;
            const newTokens = estimateTokens(finalMessages.map(m => m.content).join('')) - currentSnapshot.totalPrefixTokens;
            CacheState.stats.savedTokens += currentSnapshot.totalPrefixTokens;
            Logger.log(`✅ 缓存完全命中！静态前缀未变，仅新对话 ${newTokens} tokens 需计算`, LOG_LEVELS.BASIC);
        } else {
            Logger.warn('⚠️ 前缀发生变化，部分缓存未命中（下一轮将重新稳定）', LOG_LEVELS.BASIC);
        }

        CacheState.lastPrefixSnapshotNormalized = currentSnapshot;
        CacheState.stats.prefixTokens = currentSnapshot.totalPrefixTokens;

        data.chat.splice(0, data.chat.length, ...finalMessages);
        Logger.log(`重组完成：${original.length} 条 → ${finalMessages.length} 条`, LOG_LEVELS.BASIC);
        Logger.log(`消息结构: system(${CacheState.staticCore.length}字) + ${CacheState.absorbedMessages.length}条固定指令 + ${chatHistory.length}条对话 + ${prefills.length}条预填充`, LOG_LEVELS.DEBUG);

        updateStatsUI();

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

// ==========================================
// 模块 9：统计 UI
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

// ==========================================
// 模块 10：UI 界面（增加日志等级下拉）
// ==========================================
async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DS V4 Cache Optimizer v3.2</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">冻结核心 + 吸收指令 + 归一化比对，日志等级可选</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;"></div>
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                    <label class="checkbox_label" style="display:flex; align-items:center; gap:5px;">
                        <input type="checkbox" id="ds-cache-enable" checked> 启用拦截器
                    </label>
                    <select id="ds-log-level" style="height:24px;">
                        <option value="0">关闭日志</option>
                        <option value="1">简要</option>
                        <option value="2" selected>详细</option>
                        <option value="3">调试</option>
                    </select>
                </div>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin-bottom:10px;">🔄 强制重置静态核心</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:220px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');

        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`状态: ${CacheState.enabled ? '启用' : '停用'}`);
        });

        $('#ds-log-level').on('change', function() {
            const level = parseInt($(this).val());
            Logger.setLevel(level);
        });

        $('#ds-cache-reset').on('click', () => {
            CacheState.staticCore = null;
            CacheState.staticCoreNormalized = null;
            CacheState.absorbedMessages = [];
            CacheState.absorbedNormalized = [];
            CacheState.knownFloatsNormalized.clear();
            CacheState.lastBottomBlocks = [];
            CacheState.lastPrefixSnapshotNormalized = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateStatsUI();
            Logger.warn('已完全重置');
        });

        updateStatsUI();
    } catch (e) {
        Logger.error('UI初始化失败', e);
    }
}

// ==========================================
// 模块 11：启动
// ==========================================
jQuery(async () => {
    console.log('DS V4 Optimizer v3.2 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('已挂载事件钩子');
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v3.2 就绪 ══════', LOG_LEVELS.BASIC);
});
