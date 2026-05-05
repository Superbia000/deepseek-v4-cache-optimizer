import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 模块 1：日志系统（增强）
// ==========================================
const Logger = {
    _uiTextarea: null,
    log: (msg) => {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        console.log(`%c[DS V4 Opt v3.1] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
        Logger._append(`[${time}] ✅ ${msg}`);
    },
    warn: (msg) => {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        console.warn(`%c[DS V4 Opt v3.1] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
        Logger._append(`[${time}] 🌪️ ${msg}`);
    },
    error: (msg, err) => {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        console.error(`[DS V4 Opt v3.1] 🔴 ${msg}`, err || '');
        Logger._append(`[${time}] 🔴 ${msg}`);
    },
    _append(text) {
        if (Logger._uiTextarea) {
            Logger._uiTextarea.value += text + '\n';
            Logger._uiTextarea.scrollTop = Logger._uiTextarea.scrollHeight;
        }
    }
};

// ==========================================
// 模块 2：简单 hash 函数（用于内容指纹）
// ==========================================
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32bit integer
    }
    return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}

// ==========================================
// 模块 3：Token 估算（CJK 感知）
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
// 模块 4：缓存状态机（v3.1 增加前缀快照）
// ==========================================
const CacheState = {
    enabled: true,
    staticCore: null,               // 绝对冻结的 system 核心文本
    absorbedMessages: [],           // 已吸收的固定 user 消息列表
    knownFloatsContent: new Set(),
    lastBottomBlocks: [],
    // 新增：上一轮前缀快照，用于差异对比
    lastPrefixSnapshot: null,      // { systemHash, absorbedHashes: [], absorbedLengths: [] }
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// ==========================================
// 模块 5：消息分类与合并
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

function similarity(oldText, newText) {
    if (!oldText || !newText) return 0;
    const oldLines = new Set(oldText.split('\n').map(l => l.trim()).filter(Boolean));
    const newLines = newText.split('\n').map(l => l.trim()).filter(Boolean);
    if (newLines.length === 0) return 1;
    let common = 0;
    for (const l of newLines) if (oldLines.has(l)) common++;
    return common / newLines.length;
}

// ==========================================
// 模块 6：浮动指令检测与吸收（不变）
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

        if (CacheState.knownFloatsContent.has(msg.content)) {
            continue;
        }

        const wasInLastBottom = CacheState.lastBottomBlocks.some(b => b.content === msg.content);
        if (isBottom && long && wasInLastBottom) {
            CacheState.knownFloatsContent.add(msg.content);
            const entry = { role: 'user', content: msg.content };
            CacheState.absorbedMessages.push(entry);
            newlyAbsorbed.push(entry);
            Logger.warn(`吸收新浮动指令 (${msg.role}, ${msg.content.length}字)，已作为固定 user 消息后置`);
            continue;
        }
        cleaned.push(msg);
    }

    CacheState.lastBottomBlocks = cleaned.slice(-3).map(m => ({ role: m.role, content: m.content }));
    return { cleaned, newlyAbsorbed };
}

// ==========================================
// 模块 7：前缀快照与差异报告
// ==========================================
function capturePrefixSnapshot(systemText, absorbedList) {
    return {
        systemHash: simpleHash(systemText),
        systemLen: systemText.length,
        systemTokens: estimateTokens(systemText),
        absorbedHashes: absorbedList.map(m => simpleHash(m.content)),
        absorbedLengths: absorbedList.map(m => m.content.length),
        absorbedTokens: absorbedList.map(m => estimateTokens(m.content)),
        totalPrefixTokens: estimateTokens(systemText) + absorbedList.reduce((sum, m) => sum + estimateTokens(m.content), 0)
    };
}

function comparePrefixSnapshots(prev, curr) {
    if (!prev) return '首次建立前缀，无历史对比';
    const diffs = [];
    if (prev.systemHash !== curr.systemHash) {
        diffs.push(`❌ System 核心变化 | 旧hash:${prev.systemHash} (${prev.systemLen}字) → 新hash:${curr.systemHash} (${curr.systemLen}字)`);
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
            diffs.push(`🔸 吸收指令 #${i+1} 变化 | 旧hash:${prevHash} (${prev.absorbedLengths[i] || 0}字) → 新hash:${currHash} (${curr.absorbedLengths[i] || 0}字)`);
        } else {
            diffs.push(`✅ 吸收指令 #${i+1} 无变化 (${curr.absorbedLengths[i]}字)`);
        }
    }
    return diffs.join('\n');
}

// ==========================================
// 模块 8：核心拦截重组（增强日志版）
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

        // ---- 初始化或重置静态核心 ----
        if (!CacheState.staticCore) {
            const { cleaned: cleanedChat, newlyAbsorbed } = detectAndAbsorbFloats(chatHistory);
            const staticCoreLines = currentSystemRaw.split('\n').filter(line => {
                const t = line.trim();
                return t && !CacheState.knownFloatsContent.has(t);
            });
            CacheState.staticCore = staticCoreLines.join('\n') || currentSystemRaw;
            Logger.log(`首次冻结静态核心 (${estimateTokens(CacheState.staticCore)} tokens)`);
            
            const initMsgs = [];
            initMsgs.push({ role: 'system', content: CacheState.staticCore });
            initMsgs.push(...CacheState.absorbedMessages);
            initMsgs.push(...cleanedChat);
            initMsgs.push(...prefills);
            data.chat.splice(0, data.chat.length, ...initMsgs);
            
            // 记录前缀快照
            CacheState.lastPrefixSnapshot = capturePrefixSnapshot(CacheState.staticCore, CacheState.absorbedMessages);
            CacheState.stats.prefixTokens = CacheState.lastPrefixSnapshot.totalPrefixTokens;
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
            Logger.log(`初始化完成，消息数: ${initMsgs.length}`);
            updateStatsUI();
            return;
        }

        // ---- 相似度巨变检测 ----
        const sim = similarity(CacheState.staticCore, currentSystemRaw);
        if (sim < 0.3 && currentSystemRaw.length > 50) {
            Logger.warn(`系统核心剧变 (相似度 ${(sim*100).toFixed(1)}%)，重置所有缓存状态`);
            CacheState.staticCore = null;
            CacheState.absorbedMessages = [];
            CacheState.knownFloatsContent.clear();
            CacheState.lastBottomBlocks = [];
            CacheState.lastPrefixSnapshot = null;
            interceptAndRestructurePrompt(data);
            return;
        }

        // ---- 吸收新浮动指令 ----
        const { cleaned: cleanedChat, newlyAbsorbed } = detectAndAbsorbFloats(chatHistory);

        // ---- 重组最终消息 ----
        const finalMessages = [];
        finalMessages.push({ role: 'system', content: CacheState.staticCore });
        finalMessages.push(...CacheState.absorbedMessages);
        finalMessages.push(...cleanedChat);
        finalMessages.push(...prefills);

        // 捕获当前前缀快照
        const currentSnapshot = capturePrefixSnapshot(CacheState.staticCore, CacheState.absorbedMessages);
        
        // 对比前缀，输出详细差异
        const diffReport = comparePrefixSnapshots(CacheState.lastPrefixSnapshot, currentSnapshot);
        Logger.log(`前缀差异对比:\n${diffReport}`);
        
        const cacheHit = (CacheState.lastPrefixSnapshot && 
                          CacheState.lastPrefixSnapshot.systemHash === currentSnapshot.systemHash &&
                          CacheState.lastPrefixSnapshot.absorbedHashes.join(',') === currentSnapshot.absorbedHashes.join(','));
        
        if (cacheHit) {
            CacheState.stats.hits++;
            const newTokens = estimateTokens(finalMessages.map(m => m.content).join('')) - currentSnapshot.totalPrefixTokens;
            CacheState.stats.savedTokens += currentSnapshot.totalPrefixTokens;
            Logger.log(`✅ 缓存命中！静态前缀完全未变，仅尾部新增约 ${newTokens} tokens 需计算`);
        } else {
            Logger.warn('⚠️ 前缀发生变化，部分缓存未命中（新前缀在下一轮将完全命中）');
        }
        
        CacheState.lastPrefixSnapshot = currentSnapshot;
        CacheState.stats.prefixTokens = currentSnapshot.totalPrefixTokens;
        
        data.chat.splice(0, data.chat.length, ...finalMessages);
        Logger.log(`重组完成：${original.length} 条 → ${finalMessages.length} 条`);
        Logger.log(`消息结构: system(${CacheState.staticCore.length}字) + ${CacheState.absorbedMessages.length}条固定指令 + ${cleanedChat.length}条对话 + ${prefills.length}条预填充`);
        
        updateStatsUI();

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

// ==========================================
// 模块 9：统计 UI 更新
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
// 模块 10：UI 界面
// ==========================================
async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DS V4 Cache Optimizer v3.1</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">冻结静态核心 + 吸收指令后置，最大化缓存命中（详情看日志）</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;"></div>
                <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" id="ds-cache-enable" checked> 启用拦截器
                </label>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置静态核心</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:220px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');
        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`状态: ${CacheState.enabled ? '启用' : '停用'}`);
        });
        $('#ds-cache-reset').on('click', () => {
            CacheState.staticCore = null;
            CacheState.absorbedMessages = [];
            CacheState.knownFloatsContent.clear();
            CacheState.lastBottomBlocks = [];
            CacheState.lastPrefixSnapshot = null;
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
    console.log('DS V4 Optimizer v3.1 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('已挂载事件钩子');
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v3.1 就绪，前缀差异报告已启用 ══════');
});
