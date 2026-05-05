import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 简易 hash（用于内容指纹）
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

// ==========================================
// Token 估算（CJK 感知）
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
// 日志系统（带等级过滤）
// ==========================================
const LOG_LEVELS = { QUIET: 0, NORMAL: 1, DEBUG: 2 };
const Logger = (() => {
    let uiTextarea = null;
    let currentLevel = LOG_LEVELS.DEBUG; // 默认详细模式

    function log(msg, level = LOG_LEVELS.NORMAL) {
        if (level > currentLevel) return;
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const logStr = `[${time}] ✅ ${msg}`;
        console.log(`%c[DS V4 Opt v4] ${msg}`, 'color: #00ff00; font-weight: bold;');
        append(logStr);
    }
    function warn(msg, level = LOG_LEVELS.NORMAL) {
        if (level > currentLevel) return;
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const logStr = `[${time}] 🌪️ ${msg}`;
        console.warn(`%c[DS V4 Opt v4] ${msg}`, 'color: #ffaa00; font-weight: bold;');
        append(logStr);
    }
    function error(msg, err) {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const logStr = `[${time}] 🔴 ${msg}`;
        console.error(`[DS V4 Opt v4] ${msg}`, err || '');
        append(logStr);
    }
    function append(text) {
        if (uiTextarea) {
            uiTextarea.value += text + '\n';
            uiTextarea.scrollTop = uiTextarea.scrollHeight;
        }
    }
    function setUI(ta) { uiTextarea = ta; }
    function setLevel(lvl) { currentLevel = lvl; }
    function getLevel() { return currentLevel; }
    return { log, warn, error, setUI, setLevel, getLevel, LOG_LEVELS };
})();

// ==========================================
// 缓存状态机
// ==========================================
const CacheState = {
    enabled: true,
    staticCore: null,               // 冻结的 system 核心
    absorbedMessages: [],           // 已吸收的固定 user 消息列表
    knownFloatsContent: new Set(),  // 内容完全匹配的吸收池
    lastBottomBlocks: [],           // 底部特征
    lastPrefixSnapshot: null,
    // 新增：强制固化模式（开启后，后续浮动指令使用首次锁定的版本，不更新）
    lockMode: false,
    lockedUserInstructions: new Map(), // role@index 映射到首次内容
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// ==========================================
// 消息分类与合并
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
// 浮动指令检测与固化吸收
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
        const key = msg.role + '|' + i; // 用角色+索引作为固化键（简单方式）

        // 强制固化模式：如果该位置已有锁定内容，直接使用锁定值，跳过当前消息
        if (CacheState.lockMode && CacheState.lockedUserInstructions.has(key)) {
            continue; // 被锁定的消息完全剔除出对话历史，并忽略
        }

        // 已完全匹配的吸收池
        if (CacheState.knownFloatsContent.has(msg.content)) {
            continue;
        }

        const wasInLastBottom = CacheState.lastBottomBlocks.some(b => b.content === msg.content);
        if (isBottom && long && wasInLastBottom) {
            // 吸收为固定指令
            CacheState.knownFloatsContent.add(msg.content);
            const entry = { role: 'user', content: msg.content };
            CacheState.absorbedMessages.push(entry);
            newlyAbsorbed.push(entry);
            // 如果开启了强制固化，记录该位置的锁定内容
            if (CacheState.lockMode) {
                CacheState.lockedUserInstructions.set(key, msg.content);
            }
            Logger.warn(`吸收新浮动指令 (${msg.role}, ${msg.content.length}字)，已作为固定 user 消息后置`);
            continue;
        }

        cleaned.push(msg);
    }

    CacheState.lastBottomBlocks = cleaned.slice(-3).map(m => ({ role: m.role, content: m.content }));
    return { cleaned, newlyAbsorbed };
}

// ==========================================
// 前缀快照与差异报告
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
// 核心拦截重组（完整版，含固化逻辑和详细日志）
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`, Logger.LOG_LEVELS.NORMAL);
        Logger.log(`拦截器 #${CacheState.stats.total}`, Logger.LOG_LEVELS.NORMAL);

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
            Logger.log(`首次冻结静态核心 (${estimateTokens(CacheState.staticCore)} tokens)`, Logger.LOG_LEVELS.NORMAL);

            // 如果开启了强制固化，将当前 cleanedChat 中的 user/assistant 的位置记录下来
            if (CacheState.lockMode) {
                // 遍历 cleanedChat 的索引，记录 user 和 assistant 的位置
                for (let i = 0; i < cleanedChat.length; i++) {
                    const msg = cleanedChat[i];
                    const key = msg.role + '|' + i;
                    // 只锁定 user 或 assistant 消息（避免 system）
                    if (msg.role === 'user' || msg.role === 'assistant') {
                        CacheState.lockedUserInstructions.set(key, msg.content);
                    }
                }
                Logger.log(`强制固化模式已记录 ${CacheState.lockedUserInstructions.size} 个位置的消息`, Logger.LOG_LEVELS.DEBUG);
            }

            const initMsgs = [];
            initMsgs.push({ role: 'system', content: CacheState.staticCore });
            initMsgs.push(...CacheState.absorbedMessages);
            initMsgs.push(...cleanedChat);
            initMsgs.push(...prefills);
            data.chat.splice(0, data.chat.length, ...initMsgs);

            CacheState.lastPrefixSnapshot = capturePrefixSnapshot(CacheState.staticCore, CacheState.absorbedMessages);
            CacheState.stats.prefixTokens = CacheState.lastPrefixSnapshot.totalPrefixTokens;
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
            Logger.log(`初始化完成，消息数: ${initMsgs.length}`, Logger.LOG_LEVELS.NORMAL);
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
            CacheState.lockedUserInstructions.clear();
            interceptAndRestructurePrompt(data);
            return;
        }

        // ---- 吸收新浮动指令（含固化逻辑） ----
        const { cleaned: cleanedChat, newlyAbsorbed } = detectAndAbsorbFloats(chatHistory);

        // 如果开启了强制固化，用锁定值替换 cleanedChat 中对应位置的消息
        if (CacheState.lockMode) {
            for (let i = 0; i < cleanedChat.length; i++) {
                const key = cleanedChat[i].role + '|' + i;
                if (CacheState.lockedUserInstructions.has(key)) {
                    const originalContent = cleanedChat[i].content;
                    const lockedContent = CacheState.lockedUserInstructions.get(key);
                    cleanedChat[i].content = lockedContent;
                    if (originalContent !== lockedContent) {
                        Logger.log(`固化替换: ${key} 内容已还原为首次锁定版本`, Logger.LOG_LEVELS.DEBUG);
                    }
                }
            }
        }

        // ---- 重组最终消息 ----
        const finalMessages = [];
        finalMessages.push({ role: 'system', content: CacheState.staticCore });
        finalMessages.push(...CacheState.absorbedMessages);
        finalMessages.push(...cleanedChat);
        finalMessages.push(...prefills);

        const currentSnapshot = capturePrefixSnapshot(CacheState.staticCore, CacheState.absorbedMessages);
        const diffReport = comparePrefixSnapshots(CacheState.lastPrefixSnapshot, currentSnapshot);
        Logger.log(`前缀差异对比:\n${diffReport}`, Logger.LOG_LEVELS.NORMAL);

        const cacheHit = (CacheState.lastPrefixSnapshot &&
            CacheState.lastPrefixSnapshot.systemHash === currentSnapshot.systemHash &&
            CacheState.lastPrefixSnapshot.absorbedHashes.join(',') === currentSnapshot.absorbedHashes.join(','));

        if (cacheHit) {
            CacheState.stats.hits++;
            const totalTokens = finalMessages.reduce((s, m) => s + estimateTokens(m.content), 0);
            const newTokens = totalTokens - currentSnapshot.totalPrefixTokens;
            CacheState.stats.savedTokens += currentSnapshot.totalPrefixTokens;
            Logger.log(`✅ 缓存命中！静态前缀完全未变，仅尾部新增约 ${newTokens} tokens 需计算`, Logger.LOG_LEVELS.NORMAL);
        } else {
            Logger.warn('⚠️ 前缀发生变化，部分缓存未命中（新前缀在下一轮将完全命中）', Logger.LOG_LEVELS.NORMAL);
        }

        CacheState.lastPrefixSnapshot = currentSnapshot;
        CacheState.stats.prefixTokens = currentSnapshot.totalPrefixTokens;

        data.chat.splice(0, data.chat.length, ...finalMessages);
        Logger.log(`重组完成：${original.length} 条 → ${finalMessages.length} 条`, Logger.LOG_LEVELS.NORMAL);
        Logger.log(`消息结构: system(${CacheState.staticCore.length}字) + ${CacheState.absorbedMessages.length}条固定指令 + ${cleanedChat.length}条对话 + ${prefills.length}条预填充`, Logger.LOG_LEVELS.DEBUG);

        updateStatsUI();

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

// ==========================================
// UI 初始化（含日志等级选择器）
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
                <b>🧠 DS V4 Cache Optimizer v4</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">冻结前缀 + 固化可选，日志等级可调。</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;"></div>
                <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" id="ds-cache-enable" checked> 启用拦截器
                </label>
                <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;margin-top:5px;">
                    <input type="checkbox" id="ds-cache-lock" unchecked> 强制固化浮动指令（锁定首次版本）
                </label>
                <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
                    <span style="font-size:0.9em;">日志等级:</span>
                    <select id="ds-cache-loglevel">
                        <option value="0">简洁</option>
                        <option value="1">正常</option>
                        <option value="2" selected>详细调试</option>
                    </select>
                </div>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置静态核心</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:220px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);

        const logTextarea = document.getElementById('ds-cache-log');
        Logger.setUI(logTextarea);

        // 日志等级
        const logLevelSelect = document.getElementById('ds-cache-loglevel');
        logLevelSelect.addEventListener('change', function() {
            Logger.setLevel(parseInt(this.value));
            Logger.log(`日志等级切换为: ${this.options[this.selectedIndex].text}`, Logger.LOG_LEVELS.NORMAL);
        });

        // 启用开关
        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`插件状态: ${CacheState.enabled ? '启用' : '停用'}`, Logger.LOG_LEVELS.NORMAL);
        });

        // 强制固化开关
        $('#ds-cache-lock').on('change', function() {
            CacheState.lockMode = $(this).is(':checked');
            if (CacheState.lockMode) {
                // 如果当前已有 staticCore，则按当前状态锁定位置；若尚未初始化，静默开启
                Logger.warn('强制固化模式已开启，后续浮动指令将使用首次锁定版本（需重置后生效）', Logger.LOG_LEVELS.NORMAL);
            } else {
                CacheState.lockedUserInstructions.clear();
                Logger.log('强制固化模式已关闭，位置锁定池已清空', Logger.LOG_LEVELS.NORMAL);
            }
        });

        // 重置按钮
        $('#ds-cache-reset').on('click', () => {
            CacheState.staticCore = null;
            CacheState.absorbedMessages = [];
            CacheState.knownFloatsContent.clear();
            CacheState.lastBottomBlocks = [];
            CacheState.lastPrefixSnapshot = null;
            CacheState.lockedUserInstructions.clear();
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateStatsUI();
            Logger.warn('已完全重置，下一轮将重新冻结核心');
        });

        updateStatsUI();
        Logger.log('UI 初始化完成', Logger.LOG_LEVELS.DEBUG);
    } catch (e) {
        Logger.error('UI 初始化失败', e);
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
        Logger.log('已挂载事件钩子');
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v4.0 就绪，可调日志等级与固化模式 ══════');
});
