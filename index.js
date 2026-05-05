import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志 (保持简洁)
// ==========================================
let logLevel = 2;
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };
// ... Logger 组件与之前相同，省略以节省篇幅 ...

// ==========================================
// 哈希 & Token
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
        } else tokens += 0.25;
    }
    return Math.ceil(tokens);
}

// ==========================================
// 状态机
// ==========================================
const CacheState = {
    enabled: true,
    lockedPrefixHash: null,
    lockedTokenCount: 0,
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// ==========================================
// 分类器 — 基于 identifier + 实时内容匹配
// ==========================================
function classifyAndSortMessages(chatArray) {
    const ctx = getContext();
    const realChat = ctx.chat;                     // 实时对话数组
    const lastUserIdx = realChat.length - 1;
    for (let i = lastUserIdx; i >= 0; i--) if (realChat[i].role === 'user') { lastUserIdx = i; break; }
    const lastUserMsg = realChat[lastUserIdx];
    const lastAssistantMsg = realChat[realChat.length - 1]?.role === 'assistant' ? realChat[realChat.length - 1] : null;

    // 预设提示词的 identifier 集合
    const presetIds = new Set([
        'main', 'jailbreak', 'nsfw', 'impersonation_prompt',
        'description', 'personality', 'scenario', 'mes_example', 'system_prompt'
    ]);

    const presetPrompts = [];
    const otherPrompts = [];
    const worldInfoEntries = [];
    const allChatMessages = [];      // 所有 chat-message-* 及可能的当前/预填充

    for (const msg of chatArray) {
        const id = msg.identifier || '';
        const role = msg.role;

        // 世界书
        if (id.startsWith('worldInfoEntry_')) {
            worldInfoEntries.push(msg);
            continue;
        }
        // 扩展/插件
        if (id.startsWith('extension:')) {
            otherPrompts.push(msg);
            continue;
        }
        // 预设提示词
        if (presetIds.has(id)) {
            presetPrompts.push(msg);
            continue;
        }
        // 聊天消息 (包含历史和当前)
        if (id.startsWith('chat-message-') || (role === 'user' || role === 'assistant') && id === '') {
            allChatMessages.push(msg);
            continue;
        }
        // 剩下所有 system 或其他 role 的归入 otherPrompts
        otherPrompts.push(msg);
    }

    // 在 allChatMessages 中区分历史、当前输入、预填充
    let currentUserMessage = null;
    let prefillMessage = null;
    const historyConversation = [];

    for (const msg of allChatMessages) {
        if (msg.role === 'user' && msg.content === lastUserMsg.mes) {
            currentUserMessage = msg;        // 精确匹配当前用户输入
        } else if (lastAssistantMsg && msg.role === 'assistant' && msg.content === lastAssistantMsg.mes) {
            prefillMessage = msg;            // 匹配预填充
        } else {
            historyConversation.push(msg);  // 其余全部是历史对话
        }
    }

    // 如果因为某些原因没匹配到，退回简单顺序查找 (从后向前)
    if (!currentUserMessage || !prefillMessage) {
        const reversed = [...chatArray].reverse();
        for (const msg of reversed) {
            if (!currentUserMessage && msg.role === 'user') {
                currentUserMessage = msg;
            } else if (currentUserMessage && !prefillMessage && msg.role === 'assistant') {
                prefillMessage = msg;
                break;
            }
        }
    }

    return { presetPrompts, otherPrompts, worldInfoEntries, historyConversation, currentUserMessage, prefillMessage };
}

// ==========================================
// 核心拦截
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;
    try {
        CacheState.stats.total++;

        // 1. 精确分类
        const {
            presetPrompts, otherPrompts, worldInfoEntries,
            historyConversation, currentUserMessage, prefillMessage
        } = classifyAndSortMessages(data.chat);

        // 2. 组装最终序列 (严格遵守排序规则)
        const orderedMessages = [
            ...presetPrompts,
            ...otherPrompts,
            ...worldInfoEntries,
            ...historyConversation,
        ];
        if (currentUserMessage) orderedMessages.push(currentUserMessage);
        if (prefillMessage) orderedMessages.push(prefillMessage);

        // 3. 计算前缀哈希 (不含当前输入和预填充)
        const prefixMessages = orderedMessages.filter(m => m !== currentUserMessage && m !== prefillMessage);
        const prefixHash = simpleHash(prefixMessages.map(m => m.content).join(''));
        const prefixTokens = estimateTokens(prefixMessages.map(m => m.content).join(''));

        // 4. 缓存命中判断
        const cacheHit = (CacheState.lockedPrefixHash === prefixHash);

        if (cacheHit) {
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += prefixTokens;
            Logger.log(`✅ 缓存命中！前缀完全锁定，仅需计算新用户输入 ~${estimateTokens(currentUserMessage?.content||'')}t`, LogLevels.BASIC);
        } else {
            // 检测是否发生大范围删减（超过 50% 前缀 tokens 消失）
            if (CacheState.lockedTokenCount > 0 && prefixTokens < CacheState.lockedTokenCount * 0.5) {
                toastr.warning('检测到前缀大幅缩减（可能删除了大量预设/世界书），已自动重置锁定。', 'DS Cache Optimizer');
                Logger.warn('⚠️ 前缀 tokens 骤减，可能因用户手动删除提示词，已重建锁定。', LogLevels.BASIC);
            }
            CacheState.lockedPrefixHash = prefixHash;
            CacheState.lockedTokenCount = prefixTokens;
            Logger.warn('🔄 前缀已更新，下一轮请求将完全命中。', LogLevels.BASIC);
        }

        CacheState.stats.prefixTokens = prefixTokens;

        // 5. 替换原数组
        data.chat.splice(0, data.chat.length, ...orderedMessages);
        Logger.log(`重组完成：${orderedMessages.length} 条消息`, LogLevels.DETAILED);

    } catch (err) {
        Logger.error('拦截器错误', err);
    }
}

// ==========================================
// UI 与挂载 (同前，略)
// ==========================================
jQuery(async () => {
    console.log('DS V4 Optimizer v7.0 loading...');
    await setupUI();
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
    Logger.log('✅ 已挂载 CHAT_COMPLETION_PROMPT_READY 事件');
});
