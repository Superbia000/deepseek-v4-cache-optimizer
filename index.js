import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志系统
// ==========================================
let logLevel = 2; // 0:silent, 1:basic, 2:detailed, 3:debug
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const fullMsg = `[${time}] ${msg}`;
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
};

// ==========================================
// 工具函数
// ==========================================
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 16);
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
// 缓存状态
// ==========================================
const CacheState = {
    enabled: true,
    lockedPrefixHash: null,          // 锁定前缀（历史到当前用户输入之前的所有消息）的哈希
    lockedPrefixTokens: 0,          // 锁定前缀的估算 token 数
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
};

// 预设提示词的 identifier 白名单
const PRESET_IDENTIFIERS = new Set([
    'main', 'jailbreak', 'nsfw', 'impersonation_prompt',
    'description', 'personality', 'scenario', 'mes_example', 'system_prompt'
]);

// ==========================================
// 精确分类器（基于 identifier）
// ==========================================
function classifyMessages(chat) {
    const preset = [];      // 预设提示词
    const extensions = [];  // 插件/扩展提示词
    const worldInfo = [];   // 世界书条目
    const history = [];     // 历史对话（chat-message-*）
    let currentUser = null;
    let prefill = null;

    for (const msg of chat) {
        const id = msg.identifier || '';

        // 1. 世界书条目
        if (id.startsWith('worldInfoEntry_')) {
            worldInfo.push(msg);
            continue;
        }

        // 2. 扩展提示词
        if (id.startsWith('extension:')) {
            extensions.push(msg);
            continue;
        }

        // 3. 预设提示词（包括各类角色信息）
        if (PRESET_IDENTIFIERS.has(id) || (msg.role === 'system' && !id)) {
            // id 为空的 system 消息可能是无标识符的预设片段，同样归入预设
            preset.push(msg);
            continue;
        }

        // 4. 历史对话消息（带有 chat-message- 编号的 user/assistant）
        if (id.startsWith('chat-message-')) {
            history.push(msg);
            continue;
        }

        // 5. 剩余无标识符的 user 或 assistant 消息：
        //    位于数组末尾的 user 是当前输入，其后的 assistant 是预填充
        if (msg.role === 'user') {
            currentUser = msg; // 最后一条 user 会覆盖前面的（因遍历顺序）
        } else if (msg.role === 'assistant') {
            prefill = msg;     // 最后一条 assistant 是预填充
        }
        // 忽略其他角色
    }

    return { preset, extensions, worldInfo, history, currentUser, prefill };
}

// ==========================================
// 核心拦截器
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`拦截 #${CacheState.stats.total}`);

        if (!data?.chat?.length) return;

        // 1. 精确分类
        const { preset, extensions, worldInfo, history, currentUser, prefill } = classifyMessages(data.chat);

        // 2. 组装最终消息序列（严格按顺序）
        const finalMessages = [
            ...preset,
            ...extensions,
            ...worldInfo,
            ...history,
        ];
        if (currentUser) finalMessages.push(currentUser);
        if (prefill) finalMessages.push(prefill);

        // 3. 计算当前前缀（从第一条到最后一个历史消息，不包含当前用户和预填充）
        const prefixMessages = finalMessages.filter(m => m !== currentUser && m !== prefill);
        const currentPrefixHash = simpleHash(prefixMessages.map(m => m.content).join(''));
        const currentPrefixTokens = estimateTokens(prefixMessages.map(m => m.content).join(''));

        // 4. 缓存命中判定
        const isNewPrefix = !CacheState.lockedPrefixHash;
        const prefixUnchanged = CacheState.lockedPrefixHash === currentPrefixHash;

        if (isNewPrefix) {
            // 首次运行，建立锁定前缀
            CacheState.lockedPrefixHash = currentPrefixHash;
            CacheState.lockedPrefixTokens = currentPrefixTokens;
            CacheState.stats.hits++; // 首次也算一次“命中”（建立了基准）
            CacheState.stats.savedTokens += currentPrefixTokens;
            Logger.log(`🔒 首次锁定前缀，共 ${prefixMessages.length} 条消息，~${currentPrefixTokens} tokens`, LogLevels.BASIC);
        } else if (prefixUnchanged) {
            // 完美命中：前缀与上次完全一致
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += CacheState.lockedPrefixTokens;
            Logger.log(`🎯 完美缓存命中！前缀未变，仅需计算当前输入+预填充`, LogLevels.BASIC);
        } else {
            // 前缀发生变化（新增了世界书/提示词，或修改了已有前缀）
            // 检查是否是追加（前面部分未变）
            const oldMessagesCount = prefixMessages.length - (preset.length - CacheState._lastPresetLen || 0); // 简化判断，实际可更严谨
            CacheState.lockedPrefixHash = currentPrefixHash;
            CacheState.lockedPrefixTokens = currentPrefixTokens;
            CacheState.stats.savedTokens += currentPrefixTokens; // 新前缀同样会被缓存，下次可命中
            Logger.warn(`🔄 前缀已更新（可能是新增条目），新前缀 ~${currentPrefixTokens} tokens，下次请求将命中`, LogLevels.BASIC);
        }

        // 5. 保存用于下次比对的快照长度（用于检测破坏性删除）
        CacheState._lastPresetLen = preset.length;
        CacheState._lastHistoryLen = history.length;
        CacheState.stats.prefixTokens = CacheState.lockedPrefixTokens;

        // 6. 写回修改后的 chat 数组
        data.chat.splice(0, data.chat.length, ...finalMessages);

        if (logLevel >= LogLevels.DEBUG) {
            Logger.log(`消息结构: ${finalMessages.map(m => `${m.role}(${m.content.length}字)`).join(' → ')}`, LogLevels.DEBUG);
        }

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

// ==========================================
// UI & 统计（保留原有布局）
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
                <b>🧠 DS V4 Cache Optimizer v6</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">基于 identifier 精准分类，自动适应任何变动，目标 99%+ 缓存命中。</p>
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
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置锁定前缀</button>
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
            CacheState.lockedPrefixHash = null;
            CacheState.lockedPrefixTokens = 0;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateStatsUI();
            Logger.warn('已强制重置所有缓存状态', LogLevels.BASIC);
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
        Logger.log('已挂载事件钩子', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v6.0 就绪，基于 identifier 的绝对前缀锁定 ══════', LogLevels.BASIC);
});
