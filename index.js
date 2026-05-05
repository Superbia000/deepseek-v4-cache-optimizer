import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志等级 & 基础日志
// ==========================================
let logLevel = 2;
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

let _uiTextarea = null;
function appendLog(text) {
    if (_uiTextarea) {
        _uiTextarea.value += text + '\n';
        _uiTextarea.scrollTop = _uiTextarea.scrollHeight;
    }
}

const Logger = {
    log: (msg, level = LogLevels.DETAILED) => {
        if (logLevel < level) return;
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const full = `[${time}] ✅ ${msg}`;
        console.log(`%c[DS V4 Opt v4.1] ${full}`, 'color: #00ff00; font-weight: bold;');
        appendLog(full);
    },
    warn: (msg, level = LogLevels.BASIC) => {
        if (logLevel < level) return;
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const full = `[${time}] 🌪️ ${msg}`;
        console.warn(`%c[DS V4 Opt v4.1] ${full}`, 'color: #ffaa00; font-weight: bold;');
        appendLog(full);
    },
    error: (msg, err, level = LogLevels.BASIC) => {
        if (logLevel < level) return;
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const full = `[${time}] 🔴 ${msg}`;
        console.error(`[DS V4 Opt v4.1] ${full}`, err || '');
        appendLog(full);
    }
};

// ==========================================
// 简单工具
// ==========================================
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
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

function normalizeForFingerprint(text) {
    return text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
}

// ==========================================
// 缓存状态机
// ==========================================
const CacheState = {
    enabled: true,
    frozenCoreLines: [],           // 冻结的核心 system 行（初始建立，不再修改）
    frozenCoreText: '',            // 拼接后的冻结核心文本
    absorbedUserInstruction: '',   // 合并后的固定 user 指令
    fixedPrefillContent: null,     // 固定 AI 预填充内容
    knownFloatsContent: new Set(),
    lastBottomBlocks: [],
    lastFirstUserFingerprint: null,
    // 记录上一轮发送的 system 部分（用于比较新增行）
    lastSentCoreLines: [],         // 上一轮实际发送的 system 行（可能包含冻结核心+动态system）
    lastPrefixSnapshot: null,
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0, dynamicTokens: 0 }
};

// ==========================================
// 消息分类
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

function similarity(oldLines, newLines) {
    if (!oldLines.length || !newLines.length) return 0;
    const oldSet = new Set(oldLines);
    let common = 0;
    for (const l of newLines) if (oldSet.has(l)) common++;
    return common / newLines.length;
}

// ==========================================
// 浮动/重复指令吸收（返回清理后的对话历史）
// ==========================================
function detectAndAbsorbFloats(chatHistory) {
    if (!chatHistory.length) return { cleaned: chatHistory, absorbedAny: false };
    const currentBottoms = chatHistory.slice(-3);
    const cleaned = [];
    let absorbedAny = false;

    for (let i = 0; i < chatHistory.length; i++) {
        const msg = chatHistory[i];
        const isBottom = i >= chatHistory.length - 3;
        const long = msg.content && msg.content.length > 25;

        if (CacheState.knownFloatsContent.has(msg.content)) {
            absorbedAny = true;
            continue;
        }

        const wasInLastBottom = CacheState.lastBottomBlocks.some(b => b.content === msg.content);
        if (isBottom && long && wasInLastBottom) {
            CacheState.knownFloatsContent.add(msg.content);
            CacheState.absorbedUserInstruction += (CacheState.absorbedUserInstruction ? '\n\n' : '') + msg.content;
            Logger.warn(`吸收浮动指令并合并入固定用户指令 (${msg.role}, ${msg.content.length}字)`, LogLevels.DETAILED);
            absorbedAny = true;
            continue;
        }
        cleaned.push(msg);
    }

    CacheState.lastBottomBlocks = cleaned.slice(-3).map(m => ({ role: m.role, content: m.content }));
    return { cleaned, absorbedAny };
}

function detectAndAbsorbRepeatedFirstUser(chatHistory) {
    if (!chatHistory.length) return { cleaned: chatHistory, absorbed: false };
    const firstMsg = chatHistory[0];
    if (firstMsg.role !== 'user' || !firstMsg.content || firstMsg.content.length < 25) {
        CacheState.lastFirstUserFingerprint = firstMsg.role === 'user' ? normalizeForFingerprint(firstMsg.content) : null;
        return { cleaned: chatHistory, absorbed: false };
    }
    const fingerprint = normalizeForFingerprint(firstMsg.content);
    if (CacheState.lastFirstUserFingerprint && fingerprint === CacheState.lastFirstUserFingerprint) {
        CacheState.knownFloatsContent.add(firstMsg.content);
        CacheState.absorbedUserInstruction += (CacheState.absorbedUserInstruction ? '\n\n' : '') + firstMsg.content;
        Logger.warn(`吸收重复首条用户指令并合并 (${firstMsg.content.length}字)`, LogLevels.DETAILED);
        chatHistory.shift();
        return { cleaned: chatHistory, absorbed: true };
    } else {
        CacheState.lastFirstUserFingerprint = fingerprint;
        return { cleaned: chatHistory, absorbed: false };
    }
}

// ==========================================
// 前缀快照与差异报告
// ==========================================
function capturePrefixSnapshot(frozenCoreLines, absorbedUser, fixedPrefill) {
    return {
        coreHash: simpleHash(frozenCoreLines.join('\n')),
        coreTokens: estimateTokens(frozenCoreLines.join('\n')),
        userHash: simpleHash(absorbedUser),
        userTokens: estimateTokens(absorbedUser),
        prefillHash: simpleHash(fixedPrefill || ''),
        prefillTokens: estimateTokens(fixedPrefill || ''),
    };
}

function totalPrefixTokens(snapshot) {
    return snapshot.coreTokens + snapshot.userTokens + snapshot.prefillTokens;
}

function comparePrefixSnapshots(prev, curr) {
    if (!prev) return '首次建立前缀，无历史对比';
    const diffs = [];
    if (prev.coreHash !== curr.coreHash) diffs.push(`❌ 冻结核心变化 ${prev.coreHash} -> ${curr.coreHash}`);
    else diffs.push(`✅ 冻结核心不变 (${curr.coreTokens} tokens)`);
    if (prev.userHash !== curr.userHash) diffs.push(`❌ 固定用户指令变化 ${prev.userHash} -> ${curr.userHash}`);
    else diffs.push(`✅ 固定用户指令不变 (${curr.userTokens} tokens)`);
    if (prev.prefillHash !== curr.prefillHash) diffs.push(`❌ 固定预填充变化 ${prev.prefillHash} -> ${curr.prefillHash}`);
    else diffs.push(`✅ 固定预填充不变 (${curr.prefillTokens} tokens)`);
    return diffs.join('\n');
}

// ==========================================
// 核心拦截重组（v4.1）
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

        // 获取当前系统的所有行（去重但保持顺序）
        const currentSystemLines = [];
        const lineSet = new Set();
        for (const msg of systems) {
            const lines = (msg.content || '').split('\n');
            for (const line of lines) {
                const t = line.trim();
                if (t && !lineSet.has(t)) {
                    lineSet.add(t);
                    currentSystemLines.push(line);
                }
            }
        }

        // ---- 初始化或重置 ----
        if (!CacheState.frozenCoreLines.length) {
            // 初始冻结：直接使用当前所有系统行
            CacheState.frozenCoreLines = [...currentSystemLines];
            CacheState.frozenCoreText = CacheState.frozenCoreLines.join('\n');
            // 吸收浮动/重复
            let hist = [...chatHistory];
            const { cleaned: clean1 } = detectAndAbsorbFloats(hist); hist = clean1;
            detectAndAbsorbRepeatedFirstUser(hist); // 直接修改hist
            // 预填充
            if (prefills.length > 0) {
                CacheState.fixedPrefillContent = prefills[0].content;
            } else {
                CacheState.fixedPrefillContent = null;
            }

            const finalMessages = [];
            finalMessages.push({ role: 'system', content: CacheState.frozenCoreText });
            if (CacheState.absorbedUserInstruction.trim()) {
                finalMessages.push({ role: 'user', content: CacheState.absorbedUserInstruction });
            }
            if (CacheState.fixedPrefillContent && CacheState.fixedPrefillContent.trim()) {
                finalMessages.push({ role: 'assistant', content: CacheState.fixedPrefillContent });
            }
            finalMessages.push(...hist);
            if (prefills.length > 0 && CacheState.fixedPrefillContent && prefills[0].content === CacheState.fixedPrefillContent) {
                prefills.shift();
            }
            finalMessages.push(...prefills);

            data.chat.splice(0, data.chat.length, ...finalMessages);
            CacheState.lastSentCoreLines = [...CacheState.frozenCoreLines]; // 记录本次发送的system行
            const snap = capturePrefixSnapshot(CacheState.frozenCoreLines, CacheState.absorbedUserInstruction, CacheState.fixedPrefillContent);
            CacheState.lastPrefixSnapshot = snap;
            CacheState.stats.prefixTokens = totalPrefixTokens(snap);
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
            Logger.log(`初始化冻结核心 (${CacheState.frozenCoreLines.length}行, ~${estimateTokens(CacheState.frozenCoreText)} tokens)`, LogLevels.BASIC);
            return;
        }

        // ---- 相似度剧变检测（自动重建） ----
        const sim = similarity(CacheState.frozenCoreLines, currentSystemLines);
        if (sim < 0.3 && currentSystemLines.length > 5) {
            Logger.warn(`冻结核心剧变 (相似度${(sim*100).toFixed(1)}%)，自动重建缓存状态`, LogLevels.BASIC);
            // 完全重置
            CacheState.frozenCoreLines = [];
            CacheState.frozenCoreText = '';
            CacheState.absorbedUserInstruction = '';
            CacheState.fixedPrefillContent = null;
            CacheState.knownFloatsContent.clear();
            CacheState.lastBottomBlocks = [];
            CacheState.lastFirstUserFingerprint = null;
            CacheState.lastSentCoreLines = [];
            CacheState.lastPrefixSnapshot = null;
            interceptAndRestructurePrompt(data);
            return;
        }

        // ---- 提取新增的 system 行（与冻结核心对比） ----
        const frozenSet = new Set(CacheState.frozenCoreLines);
        const newSystemLines = currentSystemLines.filter(line => !frozenSet.has(line));
        // 同时检查是否有行被删除（相似度已处理），这里忽略

        // ---- 吸收浮动/重复 ----
        let hist = [...chatHistory];
        const { cleaned: clean1 } = detectAndAbsorbFloats(hist); hist = clean1;
        const { cleaned: clean2 } = detectAndAbsorbRepeatedFirstUser(hist); hist = clean2;

        // ---- 处理预填充 ----
        let remainingPrefills = [...prefills];
        if (CacheState.fixedPrefillContent) {
            if (remainingPrefills.length > 0 && remainingPrefills[0].content === CacheState.fixedPrefillContent) {
                remainingPrefills.shift();
            } else if (remainingPrefills.length > 0) {
                CacheState.fixedPrefillContent = remainingPrefills[0].content;
                remainingPrefills.shift();
                Logger.warn('固定预填充内容变化，已更新', LogLevels.DETAILED);
            } else {
                CacheState.fixedPrefillContent = null;
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
        // ① 冻结核心 system
        finalMessages.push({ role: 'system', content: CacheState.frozenCoreText });
        // ② 固定吸收的用户指令
        if (CacheState.absorbedUserInstruction.trim()) {
            finalMessages.push({ role: 'user', content: CacheState.absorbedUserInstruction });
        }
        // ③ 固定预填充
        if (CacheState.fixedPrefillContent && CacheState.fixedPrefillContent.trim()) {
            finalMessages.push({ role: 'assistant', content: CacheState.fixedPrefillContent });
        }
        // ④ 对话历史（清理后）
        finalMessages.push(...hist);
        // ⑤ 动态新增的 system 提示（放在对话历史之后）
        if (newSystemLines.length > 0) {
            const dynamicContent = newSystemLines.join('\n');
            finalMessages.push({ role: 'system', content: dynamicContent });
            Logger.log(`追加动态系统提示 (${newSystemLines.length}行, ~${estimateTokens(dynamicContent)} tokens) 于对话历史之后`, LogLevels.DETAILED);
        }
        // ⑥ 剩余的预填充（如果有）
        finalMessages.push(...remainingPrefills);

        // 记录本次发送的核心行（冻结核心 + 动态行，用于下一轮比较）
        CacheState.lastSentCoreLines = [...CacheState.frozenCoreLines, ...newSystemLines];

        // 快照与命中
        const snap = capturePrefixSnapshot(CacheState.frozenCoreLines, CacheState.absorbedUserInstruction, CacheState.fixedPrefillContent);
        const diffReport = comparePrefixSnapshots(CacheState.lastPrefixSnapshot, snap);
        Logger.log(`前缀差异对比:\n${diffReport}`, LogLevels.DETAILED);

        const cacheHit = CacheState.lastPrefixSnapshot &&
            CacheState.lastPrefixSnapshot.coreHash === snap.coreHash &&
            CacheState.lastPrefixSnapshot.userHash === snap.userHash &&
            CacheState.lastPrefixSnapshot.prefillHash === snap.prefillHash;

        if (cacheHit) {
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += totalPrefixTokens(snap);
            const dynamicTokens = newSystemLines.length ? estimateTokens(newSystemLines.join('\n')) : 0;
            Logger.log(`✅ 缓存命中！静态前缀完全未变，仅尾部新增约 ${dynamicTokens + estimateTokens(finalMessages.slice(finalMessages.indexOf(hist[0])).map(m=>m.content).join(''))} tokens 需计算`, LogLevels.BASIC);
        } else {
            Logger.warn('⚠️ 前缀发生变化，部分缓存未命中（新前缀在下一轮将完全命中）', LogLevels.BASIC);
        }

        CacheState.lastPrefixSnapshot = snap;
        CacheState.stats.prefixTokens = totalPrefixTokens(snap);
        CacheState.stats.dynamicTokens = newSystemLines.length ? estimateTokens(newSystemLines.join('\n')) : 0;

        data.chat.splice(0, data.chat.length, ...finalMessages);
        Logger.log(`重组：${original.length}条 -> ${finalMessages.length}条`, LogLevels.BASIC);
        if (logLevel >= LogLevels.DEBUG) {
            Logger.log(`消息结构: ${finalMessages.map(m => `${m.role}(${m.content.length}字)`).join(' → ')}`, LogLevels.DEBUG);
        }

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

// ==========================================
// UI
// ==========================================
function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens, dynamicTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `
        <span>命中: ${hits}/${total} (${rate}%)</span>
        <span style="margin-left:10px;">前缀: ~${prefixTokens.toLocaleString()}t</span>
        <span style="margin-left:10px;">动态: ~${dynamicTokens.toLocaleString()}t</span>
        <span style="margin-left:10px;">节省: ~${savedTokens.toLocaleString()}t</span>
    `;
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DS V4 Cache Optimizer v4.1</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">冻结核心 + 动态追加新提示词，无需手动重置。</p>
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
        _uiTextarea = document.getElementById('ds-cache-log');
        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`状态: ${CacheState.enabled ? '启用' : '停用'}`, LogLevels.BASIC);
        });
        $('#ds-cache-loglevel').on('change', function() {
            logLevel = parseInt($(this).val());
            Logger.log(`日志等级: ${['关闭','简要','详细','调试'][logLevel]}`, LogLevels.BASIC);
        });
        $('#ds-cache-reset').on('click', () => {
            CacheState.frozenCoreLines = [];
            CacheState.frozenCoreText = '';
            CacheState.absorbedUserInstruction = '';
            CacheState.fixedPrefillContent = null;
            CacheState.knownFloatsContent.clear();
            CacheState.lastBottomBlocks = [];
            CacheState.lastFirstUserFingerprint = null;
            CacheState.lastSentCoreLines = [];
            CacheState.lastPrefixSnapshot = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0, dynamicTokens: 0 };
            updateStatsUI();
            Logger.warn('已完全重置，下一轮将重新冻结', LogLevels.BASIC);
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
    console.log('DS V4 Optimizer v4.1 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('已挂载事件钩子', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v4.1 就绪，动态追加新提示词，自动应对预设/世界书修改 ══════', LogLevels.BASIC);
});
