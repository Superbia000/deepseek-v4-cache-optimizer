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
    staticCore: null,               // 冻结的 system 核心
    absorbedUserInstructions: '',   // 合并后的固定 user 指令
    fixedPrefillContent: null,      // 固定 AI 预填充内容
    knownFloatsContent: new Set(),  // 已捕获的浮动内容指纹
    lastBottomBlocks: [],
    lastFirstUserFingerprint: null, // 上一轮对话历史第一条 user 消息的指纹（用于重复检测）
    lastPrefixSnapshot: null,       // 前缀快照（用于差异报告）
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// ==========================================
// 消息分类
// ==========================================
function classifyMessages(chat) {
    const systems = [], chatHistory = [], prefills = [];
    const working = [...chat];
    // 末尾连续的 assistant 视为预填充
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

function similarity(oldText, newText) {
    if (!oldText || !newText) return 0;
    const oldLines = new Set(oldText.split('\n').map(l => l.trim()).filter(Boolean));
    const newLines = newText.split('\n').map(l => l.trim()).filter(Boolean);
    if (newLines.length === 0) return 1;
    let common = 0;
    for (const l of newLines) if (oldLines.has(l)) common++;
    return common / newLines.length;
}

// 标准化字符串用于指纹比对（处理多余空格、常见标点差异）
function normalizeForFingerprint(text) {
    return text
        .replace(/\s+/g, ' ')          // 合并空白
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/[，。！？、；：]/g, (m) => ({'，':',','。':'.','！':'!','？':'?','、':',','；':';','：':':'})[m] || m)
        .trim();
}

// ==========================================
// 浮动指令检测与吸收（合并到 absorbedUserInstructions）
// ==========================================
function detectAndAbsorbFloats(chatHistory) {
    if (!chatHistory.length) return { cleaned: chatHistory, newlyAbsorbed: false };
    const currentBottoms = chatHistory.slice(-3);
    const cleaned = [];
    let absorbedAny = false;

    for (let i = 0; i < chatHistory.length; i++) {
        const msg = chatHistory[i];
        const isBottom = i >= chatHistory.length - 3;
        const long = msg.content && msg.content.length > 25;

        if (CacheState.knownFloatsContent.has(msg.content)) {
            absorbedAny = true;
            continue; // 已吸收，移除
        }

        const wasInLastBottom = CacheState.lastBottomBlocks.some(b => b.content === msg.content);
        if (isBottom && long && wasInLastBottom) {
            CacheState.knownFloatsContent.add(msg.content);
            // 合并到固定 user 指令中
            CacheState.absorbedUserInstructions += (CacheState.absorbedUserInstructions ? '\n\n' : '') + msg.content;
            Logger.warn(`吸收浮动指令 (${msg.role}, ${msg.content.length}字) 并合并入固定 user 指令`, LogLevels.DETAILED);
            absorbedAny = true;
            continue;
        }
        cleaned.push(msg);
    }

    CacheState.lastBottomBlocks = cleaned.slice(-3).map(m => ({ role: m.role, content: m.content }));
    return { cleaned, newlyAbsorbed: absorbedAny };
}

// 检测并吸收对话历史开头重复的 user 消息（可能是指令）
function detectAndAbsorbRepeatedFirstUser(chatHistory) {
    if (!chatHistory.length) return { cleaned: chatHistory, absorbed: false };
    const firstMsg = chatHistory[0];
    if (firstMsg.role !== 'user' || !firstMsg.content || firstMsg.content.length < 25) {
        // 无法作为重复指令，记录指纹用于后续
        if (firstMsg.role === 'user') {
            CacheState.lastFirstUserFingerprint = normalizeForFingerprint(firstMsg.content);
        } else {
            CacheState.lastFirstUserFingerprint = null;
        }
        return { cleaned: chatHistory, absorbed: false };
    }

    const fingerprint = normalizeForFingerprint(firstMsg.content);
    if (CacheState.lastFirstUserFingerprint && fingerprint === CacheState.lastFirstUserFingerprint) {
        // 连续两轮相同，吸收
        CacheState.knownFloatsContent.add(firstMsg.content);
        CacheState.absorbedUserInstructions += (CacheState.absorbedUserInstructions ? '\n\n' : '') + firstMsg.content;
        Logger.warn(`吸收重复首条 user 指令 (${firstMsg.content.length}字) 并合并`, LogLevels.DETAILED);
        CacheState.lastFirstUserFingerprint = fingerprint; // 保持
        chatHistory.shift(); // 移除
        return { cleaned: chatHistory, absorbed: true };
    } else {
        // 记录本次指纹，为下一轮做准备
        CacheState.lastFirstUserFingerprint = fingerprint;
        return { cleaned: chatHistory, absorbed: false };
    }
}

// ==========================================
// 捕获前缀快照
// ==========================================
function capturePrefixSnapshot(systemText, absorbedUser, fixedPrefill) {
    return {
        systemHash: simpleHash(systemText),
        systemTokens: estimateTokens(systemText),
        userInstructionsHash: simpleHash(absorbedUser),
        userInstructionsTokens: estimateTokens(absorbedUser),
        prefillHash: simpleHash(fixedPrefill || ''),
        prefillTokens: estimateTokens(fixedPrefill || ''),
        totalPrefixTokens: estimateTokens(systemText) + estimateTokens(absorbedUser) + estimateTokens(fixedPrefill || '')
    };
}

function comparePrefixSnapshots(prev, curr) {
    if (!prev) return '首次建立前缀，无历史对比';
    const diffs = [];
    if (prev.systemHash !== curr.systemHash) {
        diffs.push(`❌ System 核心变化 旧hash:${prev.systemHash} -> ${curr.systemHash}`);
    } else {
        diffs.push(`✅ System 核心不变 (${curr.systemTokens} tokens)`);
    }
    if (prev.userInstructionsHash !== curr.userInstructionsHash) {
        diffs.push(`❌ 固定 user 指令变化 旧hash:${prev.userInstructionsHash} -> ${curr.userInstructionsHash}`);
    } else {
        diffs.push(`✅ 固定 user 指令不变 (${curr.userInstructionsTokens} tokens)`);
    }
    if (prev.prefillHash !== curr.prefillHash) {
        diffs.push(`❌ 固定预填充变化 旧hash:${prev.prefillHash} -> ${curr.prefillHash}`);
    } else {
        diffs.push(`✅ 固定预填充不变 (${curr.prefillTokens} tokens)`);
    }
    return diffs.join('\n');
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
        const original = [...data.chat];
        const { systems, chatHistory, prefills } = classifyMessages(original);
        const currentSystemRaw = mergeSystemText(systems);

        // ---- 初始化或重置 ----
        if (!CacheState.staticCore) {
            // 从 system 中剥离已知浮动内容
            const staticCoreLines = currentSystemRaw.split('\n').filter(line => {
                const t = line.trim();
                return t && !CacheState.knownFloatsContent.has(t);
            });
            CacheState.staticCore = staticCoreLines.join('\n') || currentSystemRaw;
            // 处理浮动指令和重复用户
            let hist = [...chatHistory];
            const { cleaned: clean1, newlyAbsorbed: f1 } = detectAndAbsorbFloats(hist);
            hist = clean1;
            const { cleaned: clean2, absorbed: f2 } = detectAndAbsorbRepeatedFirstUser(hist);
            hist = clean2;

            // 固定预填充
            if (prefills.length > 0) {
                CacheState.fixedPrefillContent = prefills[0].content;
            } else {
                CacheState.fixedPrefillContent = null;
            }

            // 组装初始消息
            const finalMessages = [];
            finalMessages.push({ role: 'system', content: CacheState.staticCore });
            if (CacheState.absorbedUserInstructions.trim().length > 0) {
                finalMessages.push({ role: 'user', content: CacheState.absorbedUserInstructions });
            }
            if (CacheState.fixedPrefillContent && CacheState.fixedPrefillContent.trim().length > 0) {
                finalMessages.push({ role: 'assistant', content: CacheState.fixedPrefillContent });
            }
            // 添加处理后的历史（已经移除了吸收的user和浮动指令） 和 剩余预填充（可能为空）
            finalMessages.push(...hist);
            // 如果原来预填充被吸收，这里 prefills 应该为空
            if (prefills.length > 0 && CacheState.fixedPrefillContent && prefills[0].content === CacheState.fixedPrefillContent) {
                prefills.shift(); // 移除已吸收的
            }
            finalMessages.push(...prefills);

            data.chat.splice(0, data.chat.length, ...finalMessages);
            CacheState.lastPrefixSnapshot = capturePrefixSnapshot(CacheState.staticCore, CacheState.absorbedUserInstructions, CacheState.fixedPrefillContent);
            CacheState.stats.prefixTokens = CacheState.lastPrefixSnapshot.totalPrefixTokens;
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
            Logger.log(`初始化完成，消息数: ${finalMessages.length}，前缀 tokens: ~${CacheState.stats.prefixTokens}`, LogLevels.BASIC);
            if (logLevel >= LogLevels.DEBUG) {
                Logger.log(`消息结构预览: ${finalMessages.map(m => `${m.role}(${m.content.length}字)`).join(' → ')}`, LogLevels.DEBUG);
            }
            return;
        }

        // ---- 相似度剧变检测 ----
        const sim = similarity(CacheState.staticCore, currentSystemRaw);
        if (sim < 0.3 && currentSystemRaw.length > 50) {
            Logger.warn(`系统核心剧变 (相似度 ${(sim*100).toFixed(1)}%)，重置所有缓存状态`, LogLevels.BASIC);
            CacheState.staticCore = null;
            CacheState.absorbedUserInstructions = '';
            CacheState.fixedPrefillContent = null;
            CacheState.knownFloatsContent.clear();
            CacheState.lastBottomBlocks = [];
            CacheState.lastFirstUserFingerprint = null;
            CacheState.lastPrefixSnapshot = null;
            interceptAndRestructurePrompt(data);
            return;
        }

        // ---- 吸收浮动指令 & 重复首条 user ----
        let hist = [...chatHistory];
        const { cleaned: clean1, newlyAbsorbed: f1 } = detectAndAbsorbFloats(hist);
        hist = clean1;
        const { cleaned: clean2, absorbed: f2 } = detectAndAbsorbRepeatedFirstUser(hist);
        hist = clean2;

        // ---- 处理预填充 ----
        let remainingPrefills = [...prefills];
        if (CacheState.fixedPrefillContent) {
            if (remainingPrefills.length > 0 && remainingPrefills[0].content === CacheState.fixedPrefillContent) {
                remainingPrefills.shift(); // 移除，因为会由前缀提供
            } else {
                // 预填充内容变化，更新并报告
                Logger.warn('固定预填充内容发生变化，前缀将更新', LogLevels.DETAILED);
                if (remainingPrefills.length > 0) {
                    CacheState.fixedPrefillContent = remainingPrefills[0].content;
                    remainingPrefills.shift();
                } else {
                    CacheState.fixedPrefillContent = null;
                }
            }
        } else {
            if (remainingPrefills.length > 0) {
                CacheState.fixedPrefillContent = remainingPrefills[0].content;
                remainingPrefills.shift();
                Logger.log(`首次捕获固定预填充 (${CacheState.fixedPrefillContent.length}字)`, LogLevels.DETAILED);
            }
        }

        // ---- 组装最终消息 ----
        const finalMessages = [];
        finalMessages.push({ role: 'system', content: CacheState.staticCore });
        if (CacheState.absorbedUserInstructions.trim().length > 0) {
            finalMessages.push({ role: 'user', content: CacheState.absorbedUserInstructions });
        }
        if (CacheState.fixedPrefillContent && CacheState.fixedPrefillContent.trim().length > 0) {
            finalMessages.push({ role: 'assistant', content: CacheState.fixedPrefillContent });
        }
        finalMessages.push(...hist);
        finalMessages.push(...remainingPrefills);

        // 快照与差异
        const currentSnapshot = capturePrefixSnapshot(CacheState.staticCore, CacheState.absorbedUserInstructions, CacheState.fixedPrefillContent);
        const diffReport = comparePrefixSnapshots(CacheState.lastPrefixSnapshot, currentSnapshot);
        Logger.log(`前缀差异对比:\n${diffReport}`, LogLevels.DETAILED);

        const cacheHit = CacheState.lastPrefixSnapshot &&
            CacheState.lastPrefixSnapshot.systemHash === currentSnapshot.systemHash &&
            CacheState.lastPrefixSnapshot.userInstructionsHash === currentSnapshot.userInstructionsHash &&
            CacheState.lastPrefixSnapshot.prefillHash === currentSnapshot.prefillHash;

        if (cacheHit) {
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += currentSnapshot.totalPrefixTokens;
            const newTokens = estimateTokens(finalMessages.map(m => m.content).join('')) - currentSnapshot.totalPrefixTokens;
            Logger.log(`✅ 缓存命中！静态前缀完全未变，仅尾部新增约 ${newTokens} tokens 需计算`, LogLevels.BASIC);
        } else {
            Logger.warn('⚠️ 前缀发生变化，部分缓存未命中（新前缀将在下一轮完全命中）', LogLevels.BASIC);
        }

        CacheState.lastPrefixSnapshot = currentSnapshot;
        CacheState.stats.prefixTokens = currentSnapshot.totalPrefixTokens;

        data.chat.splice(0, data.chat.length, ...finalMessages);
        Logger.log(`重组完成：${original.length} 条 → ${finalMessages.length} 条`, LogLevels.BASIC);
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
                <b>🧠 DS V4 Cache Optimizer v4.0</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">绝对冻结 + 合并重复指令 + 吸收预填充，最大化命中率。</p>
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
            CacheState.staticCore = null;
            CacheState.absorbedUserInstructions = '';
            CacheState.fixedPrefillContent = null;
            CacheState.knownFloatsContent.clear();
            CacheState.lastBottomBlocks = [];
            CacheState.lastFirstUserFingerprint = null;
            CacheState.lastPrefixSnapshot = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateStatsUI();
            Logger.warn('已完全重置', LogLevels.BASIC);
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
    Logger.log('══════ v4.0 就绪，前缀锁定 + 重复指令合并 + 预填充吸收 ══════', LogLevels.BASIC);
});
