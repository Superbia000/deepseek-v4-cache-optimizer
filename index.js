import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 模块 1：日志系统
// ==========================================
const Logger = {
    _uiTextarea: null,
    log: (msg) => {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        console.log(`%c[DS V4 Opt v3] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
        Logger._append(`[${time}] ✅ ${msg}`);
    },
    warn: (msg) => {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        console.warn(`%c[DS V4 Opt v3] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
        Logger._append(`[${time}] 🌪️ ${msg}`);
    },
    error: (msg, err) => {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        console.error(`[DS V4 Opt v3] 🔴 ${msg}`, err || '');
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
// 模块 2：缓存状态机（v3 核心）
// ==========================================
const CacheState = {
    enabled: true,
    // 绝对冻结的 system 核心（纯净文本）
    staticCore: null,
    // 已吸收的浮动指令，作为独立 user 消息永久后置
    absorbedMessages: [],
    // 已知浮动内容指纹（用于快速过滤）
    knownFloatsContent: new Set(),
    // 上一轮底部区块特征（用于跨回合浮动检测）
    lastBottomBlocks: [],
    // 统计
    stats: { total: 0, hits: 0, savedTokens: 0 }
};

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
// 模块 4：消息分类
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
// 模块 5：浮动指令检测与吸收（不破坏前缀）
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
            continue; // 已吸收，剥离
        }

        const wasInLastBottom = CacheState.lastBottomBlocks.some(b => b.content === msg.content);
        if (isBottom && long && wasInLastBottom) {
            // 新发现的浮动指令
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
// 模块 6：核心拦截重组（v3 完全重写）
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
            // 从当前 system 中移除已知浮动内容，得到纯净核心
            const staticCoreLines = currentSystemRaw.split('\n').filter(line => {
                const t = line.trim();
                return t && !CacheState.knownFloatsContent.has(t);
            });
            CacheState.staticCore = staticCoreLines.join('\n') || currentSystemRaw; // 防空白
            Logger.log(`首次冻结静态核心 (${estimateTokens(CacheState.staticCore)} tokens)`);
            // 重组并发送一次以建立基线
            const initMsgs = [];
            initMsgs.push({ role: 'system', content: CacheState.staticCore });
            initMsgs.push(...CacheState.absorbedMessages);
            initMsgs.push(...cleanedChat);
            initMsgs.push(...prefills);
            data.chat.splice(0, data.chat.length, ...initMsgs);
            CacheState.stats.hits++; // 首次也算命中自己建立的缓存
            CacheState.stats.savedTokens += estimateTokens(CacheState.staticCore);
            Logger.log(`初始化完成，消息数: ${initMsgs.length}`);
            updateStatsUI();
            return;
        }

        // ---- 相似度巨变检测（安全网） ----
        const sim = similarity(CacheState.staticCore, currentSystemRaw);
        if (sim < 0.3 && currentSystemRaw.length > 50) {
            Logger.warn(`系统核心剧变 (相似度 ${(sim*100).toFixed(1)}%)，重置所有缓存状态`);
            CacheState.staticCore = null;
            CacheState.absorbedMessages = [];
            CacheState.knownFloatsContent.clear();
            CacheState.lastBottomBlocks = [];
            // 递归重新初始化
            interceptAndRestructurePrompt(data);
            return;
        }

        // ---- 吸收新浮动指令 ----
        const { cleaned: cleanedChat, newlyAbsorbed } = detectAndAbsorbFloats(chatHistory);

        // ---- 重组最终消息 ----
        const finalMessages = [];
        // ① 绝对冻结的核心 system
        finalMessages.push({ role: 'system', content: CacheState.staticCore });
        // ② 已吸收的固定指令（内容永不改变，新吸收仅追加）
        finalMessages.push(...CacheState.absorbedMessages);
        // ③ 净化后的对话历史
        finalMessages.push(...cleanedChat);
        // ④ AI 预填充
        finalMessages.push(...prefills);

        // 缓存命中判定：前缀是否与上一轮完全一致
        const cacheHit = (newlyAbsorbed.length === 0); // 无新吸收则前缀必然不变
        if (cacheHit) {
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += estimateTokens(CacheState.staticCore) + 
                CacheState.absorbedMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
            Logger.log(`✅ 缓存命中！静态前缀完全未变，仅计算 ${finalMessages.length - finalMessages.indexOf(cleanedChat[0] || prefills[0])} 条新消息`);
        } else {
            Logger.warn('⚠️ 新增吸收指令，前缀略微延长，但整体仍可部分命中（下一轮将完全命中新前缀）');
        }

        data.chat.splice(0, data.chat.length, ...finalMessages);
        Logger.log(`重组完成：${original.length} 条 → ${finalMessages.length} 条`);

        updateStatsUI();

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

// ==========================================
// 模块 7：UI
// ==========================================
function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `
        <span>命中: ${hits}/${total} (${rate}%)</span>
        <span style="margin-left:10px;">节省 ~${savedTokens.toLocaleString()} tokens</span>
    `;
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DS V4 Cache Optimizer v3</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">冻结静态核心 + 吸收指令后置，实现 100% 缓存命中。</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;"></div>
                <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" id="ds-cache-enable" checked> 启用拦截器
                </label>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置静态核心</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:180px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
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
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0 };
            updateStatsUI();
            Logger.warn('已完全重置，下一轮将重新冻结核心');
        });
        updateStatsUI();
    } catch (e) {
        Logger.error('UI初始化失败', e);
    }
}

// ==========================================
// 模块 8：启动
// ==========================================
jQuery(async () => {
    console.log('DS V4 Optimizer v3 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('已挂载事件钩子');
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v3 就绪，策略：绝对冻结 + 吸收后置 ══════');
});
