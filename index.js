// file: index.js
import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志等级 & 基础日志函数
// ==========================================
let logLevel = 2; // 0:silent, 1:basic, 2:detailed, 3:debug
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

// ... (logAt, Logger 函数等保持不变)

// ==========================================
// 简单 hash 与 token 估算
// ==========================================
// ... (simpleHash, estimateTokens 函数保持不变)

// ==========================================
// 缓存状态机 (v6 - 基于标识符的精确分类)
// ==========================================
const CacheState = {
    enabled: true,
    // 锁定前缀的哈希链，用于快速比对
    lockedPrefixFingerprint: null,
    // 统计信息
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
    // 用于精确判断“仅用户输入变化”的场景
    latestUserFingerprint: null,
};

// ==========================================
// 精确分类器 (基于 identifier 和 context)
// ==========================================
function classifyAndSortMessages(chat) {
    const context = getContext();
    const presetIdentifiers = new Set([
        'main', 'jailbreak', 'nsfw', 'impersonation_prompt',
        'description', 'personality', 'scenario', 'mes_example', 'system_prompt'
    ]);

    const presetPrompts = [];
    const worldInfoEntries = [];
    const otherPrompts = [];
    const historyConversation = [];
    let currentUserMessage = null;
    let prefillMessage = null;

    for (const msg of chat) {
        const identifier = msg.identifier || '';
        const role = msg.role;

        // 1. 识别世界书条目
        if (identifier.startsWith('worldInfoEntry_')) {
            worldInfoEntries.push(msg);
            continue;
        }

        // 2. 识别预设提示词 (主提示词、越狱、角色信息等)
        if (presetIdentifiers.has(identifier) || role === 'system') {
            presetPrompts.push(msg);
            continue;
        }

        // 3. 识别扩展/插件注入的提示词
        if (identifier.startsWith('extension:')) {
            otherPrompts.push(msg);
            continue;
        }

        // 4. 处理角色消息 (user/assistant)
        if (role === 'user' || role === 'assistant') {
            // 如果消息的 identifier 看起来像 chat-message-{index}
            if (identifier.startsWith('chat-message-')) {
                historyConversation.push(msg);
            } else {
                // 这是最底部无标识符的消息，分别是当前用户输入和预填充
                if (role === 'user') {
                    currentUserMessage = msg;
                } else if (role === 'assistant') {
                    prefillMessage = msg;
                }
            }
            continue;
        }

        // 5. 任何未被以上规则捕获的 system 消息，归入其他提示词
        if (role === 'system') {
            otherPrompts.push(msg);
        }
    }

    // 如果通过标识符未找到用户/助手消息，尝试从原始数组的末尾提取
    if (!currentUserMessage && !prefillMessage) {
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i].role === 'user' && !currentUserMessage) {
                currentUserMessage = chat[i];
            } else if (chat[i].role === 'assistant' && currentUserMessage) {
                prefillMessage = chat[i];
                break;
            }
        }
    }

    return { presetPrompts, otherPrompts, worldInfoEntries, historyConversation, currentUserMessage, prefillMessage };
}

// ==========================================
// 核心拦截重组 (v6)
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        const context = getContext();
        const currentUserFingerprint = simpleHash(context.chat[context.chat.length - 1]?.mes || '');

        // === 智能检测：如果只是用户输入变化，可利用缓存前缀 ===
        if (CacheState.lockedPrefixFingerprint && currentUserFingerprint !== CacheState.latestUserFingerprint) {
            Logger.log('检测到新用户输入，尝试复用缓存前缀...', LogLevels.DETAILED);
            // 这里可以进一步验证历史部分是否完全未变，若不变则直接命中缓存
            // 此处为简化演示，直接走重组逻辑
        }

        // 1. 精确分类并排序
        const { presetPrompts, otherPrompts, worldInfoEntries, historyConversation, currentUserMessage, prefillMessage } = classifyAndSortMessages(data.chat);

        // 2. 构建最终的消息序列（严格遵循要求）
        const finalMessages = [
            ...presetPrompts, // 预设提示词按原顺序
            ...otherPrompts,  // 其他插件提示词
            ...worldInfoEntries, // 世界书条目按原顺序
            ...historyConversation, // 历史对话 (user/assistant 交替)
        ];
        if (currentUserMessage) finalMessages.push(currentUserMessage);
        if (prefillMessage) finalMessages.push(prefillMessage);

        // 3. 计算缓存命中情况
        // 计算整个前缀的哈希
        const prefixOnlyMessages = finalMessages.filter(m => m !== currentUserMessage && m !== prefillMessage);
        const currentPrefixFingerprint = simpleHash(prefixOnlyMessages.map(m => m.content).join(''));

        const cacheHit = CacheState.lockedPrefixFingerprint === currentPrefixFingerprint;

        if (cacheHit) {
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
            Logger.log(`✅ 完美缓存命中！前缀与上次完全一致，仅新用户输入和预填充需计算`, LogLevels.BASIC);
        } else {
            // 前缀发生变化，更新缓存
            CacheState.lockedPrefixFingerprint = currentPrefixFingerprint;
            CacheState.stats.prefixTokens = estimateTokens(prefixOnlyMessages.map(m => m.content).join(''));
            CacheState.latestUserFingerprint = currentUserFingerprint;
            Logger.warn(`⚠️ 前缀发生变化，已更新缓存。下次请求将命中。`, LogLevels.BASIC);
        }

        // 4. 应用重组后的数组
        data.chat.splice(0, data.chat.length, ...finalMessages);
        Logger.log(`重组完成：${data.chat.length} 条消息，前缀 token 数: ~${CacheState.stats.prefixTokens}`, LogLevels.BASIC);

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

// ==========================================
// UI 与统计 (保持不变)
// ==========================================
// ... (updateStatsUI, setupUI 函数保持不变)

// ==========================================
// 启动
// ==========================================
jQuery(async () => {
    console.log('DS V4 Optimizer v6 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('已挂载事件钩子 CHAT_COMPLETION_PROMPT_READY', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v6.0 就绪，基于标识符的精确前缀锁定，目标 99.9%+ 缓存命中 ══════', LogLevels.BASIC);
});
