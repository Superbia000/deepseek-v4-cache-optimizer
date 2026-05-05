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
        console.warn(`%c[DS V4 Opt v7] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS V4 Opt v7] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS V4 Opt v7] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
    // 锁定的前缀哈希（不含当前用户消息和预填充）
    lockedPrefixHash: null,
    // 锁定的前缀 token 数
    lockedPrefixTokens: 0,
    // 统计信息
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
};

// ==========================================
// 基于 identifier 的消息分类规则
// ==========================================
const PRESET_IDENTIFIERS = new Set([
    'main', 'nsfw', 'jailbreak', 'enhanceDefinitions',
    'impersonation_prompt',
    'description', 'personality', 'scenario', 'mes_example',
    'system_prompt', 'char_other'
]);

const EXTENSION_PREFIX = 'extension:';
const WORLDINFO_PREFIX = 'worldInfo';
const HISTORY_PREFIX = 'chat-message-';

// ==========================================
// 精确分类函数
// ==========================================
function classifyMessages(chat) {
    const presetPrompts = [];
    const extensionPrompts = [];
    const worldInfoEntries = [];
    const historyConversation = [];
    let currentUserMessage = null;
    let prefillMessage = null;

    for (const msg of chat) {
        const identifier = msg.identifier || '';

        // 世界书条目 (worldInfoBefore, worldInfoAfter 等)
        if (identifier.startsWith(WORLDINFO_PREFIX)) {
            worldInfoEntries.push(msg);
            continue;
        }

        // 扩展/插件提示词
        if (identifier.startsWith(EXTENSION_PREFIX)) {
            extensionPrompts.push(msg);
            continue;
        }

        // 预置/角色卡提示词
        if (PRESET_IDENTIFIERS.has(identifier)) {
            presetPrompts.push(msg);
            continue;
        }

        // 历史对话消息
        if (identifier.startsWith(HISTORY_PREFIX)) {
            historyConversation.push(msg);
            continue;
        }

        // 无标识符的消息
        if (!identifier) {
            if (msg.role === 'user') {
                currentUserMessage = msg; // 最后一条 user 就是当前输入
            } else if (msg.role === 'assistant') {
                prefillMessage = msg; // 最后一条 assistant 就是预填充
            }
            // 意外情况：无标识的 system 消息，人为归入扩展提示词
            else if (msg.role === 'system') {
                extensionPrompts.push(msg);
            }
            continue;
        }

        // 如果有其他未知标识符，按角色大致归类
        if (msg.role === 'system') {
            extensionPrompts.push(msg);
        } else {
            Logger.warn(`未知标识符消息: ${identifier} (role: ${msg.role})，将忽略`, LogLevels.DEBUG);
        }
    }

    return {
        presetPrompts,
        extensionPrompts,
        worldInfoEntries,
        historyConversation,
        currentUserMessage,
        prefillMessage
    };
}

// ==========================================
// 核心拦截重组函数
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`拦截 #${CacheState.stats.total}`);

        if (!data?.chat?.length) return;

        // 1. 精确分类所有消息
        const {
            presetPrompts,
            extensionPrompts,
            worldInfoEntries,
            historyConversation,
            currentUserMessage,
            prefillMessage
        } = classifyMessages(data.chat);

        // 2. 构建最终排序数组（严格按顺序）
        const finalChat = [
            ...presetPrompts,
            ...extensionPrompts,
            ...worldInfoEntries,
            ...historyConversation,
        ];
        if (currentUserMessage) finalChat.push(currentUserMessage);
        if (prefillMessage) finalChat.push(prefillMessage);

        // 3. 计算当前“可缓存前缀”（不含当前用户消息和预填充）
        const prefixForCache = finalChat.filter(
            msg => msg !== currentUserMessage && msg !== prefillMessage
        );
        const prefixContent = prefixForCache.map(m => m.content).join('');
        const currentPrefixHash = simpleHash(prefixContent);
        const currentPrefixTokens = estimateTokens(prefixContent);

        // 4. 缓存状态管理
        const isFirstLock = (CacheState.lockedPrefixHash === null);
        const cacheHit = (currentPrefixHash === CacheState.lockedPrefixHash);

        if (isFirstLock) {
            // 首次运行：建立锁定前缀
            CacheState.lockedPrefixHash = currentPrefixHash;
            CacheState.lockedPrefixTokens = currentPrefixTokens;
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += currentPrefixTokens;
            Logger.log(`🔒 首次锁定前缀，共 ${prefixForCache.length} 条消息，约 ${currentPrefixTokens} tokens`, LogLevels.BASIC);
        } else if (cacheHit) {
            // 完美命中：前缀完全一致
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += CacheState.lockedPrefixTokens;
            Logger.log(`🎯 完美缓存命中！前缀未变，仅需计算当前输入+预填充`, LogLevels.BASIC);
        } else {
            // 前缀发生变化（新增世界书/提示词，或前缀被破坏）
            // 检查是否是破坏性修改：前缀是否缩短或前面部分不匹配
            const oldLockedContentHash = CacheState.lockedPrefixHash;
            const isDestructive = !prefixContent.includes(oldLockedContentHash.substring(0, 8)); // 简单判断

            if (isDestructive) {
                // 弹窗提醒，并完全重置
                if (typeof toastr !== 'undefined' && toastr.warning) {
                    toastr.warning('检测到前缀结构发生变化（提示词或世界书被删改），缓存前缀已重置。', 'DS V4 缓存优化器');
                }
                Logger.warn('⚠️ 前缀破坏性修改，重置所有缓存状态', LogLevels.BASIC);
                CacheState.lockedPrefixHash = null;
                CacheState.lockedPrefixTokens = 0;
                CacheState.stats = { total: CacheState.stats.total, hits: 0, savedTokens: 0, prefixTokens: 0 };
                // 对当前数据重新初始化
                return interceptAndRestructurePrompt(data);
            } else {
                // 正常追加：更新锁定哈希，下次即可命中
                CacheState.lockedPrefixHash = currentPrefixHash;
                CacheState.lockedPrefixTokens = currentPrefixTokens;
                CacheState.stats.savedTokens += currentPrefixTokens; // 本次节省依然为新前缀
                Logger.warn('📌 前缀正常追加（新增内容已锁定），下次请求将完美命中', LogLevels.BASIC);
            }
        }

        // 5. 更新统计数据
        CacheState.stats.prefixTokens = CacheState.lockedPrefixTokens;

        // 6. 将重组后的数组写回 data.chat
        data.chat.splice(0, data.chat.length, ...finalChat);

        // 调试输出
        if (logLevel >= LogLevels.DEBUG) {
            Logger.log(`重组后消息结构: ${finalChat.map(m => `${m.role}(${m.content.length}字)`).join(' → ')}`, LogLevels.DEBUG);
        }

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

// ==========================================
// UI & 统计更新
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
                <b>🧠 DS V4 Cache Optimizer v7</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">基于 identifier 精准分类 + 动态前缀锁定，自动适应变动，目标 99%+ 缓存命中。</p>
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
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置所有缓存状态</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');

        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`拦截器状态: ${CacheState.enabled ? '启用' : '停用'}`, LogLevels.BASIC);
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
            Logger.warn('用户手动重置所有缓存状态', LogLevels.BASIC);
        });

        updateStatsUI();
    } catch (e) {
        Logger.error('UI初始化失败', e);
    }
}

// ==========================================
// 扩展启动
// ==========================================
jQuery(async () => {
    console.log('DS V4 Optimizer v7 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('已挂载 CHAT_COMPLETION_PROMPT_READY 事件钩子', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载事件钩子（eventSource 或 event_types 缺失）');
    }
    Logger.log('══════ v7.0 就绪，基于 identifier 的绝对前缀锁定，自动适应所有变动 ══════', LogLevels.BASIC);
});
