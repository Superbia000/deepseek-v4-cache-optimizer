// 定义预设提示词的特征 identifier
const PRESET_IDENTIFIERS = new Set([
    'main', 'jailbreak', 'nsfw', 'impersonation_prompt',
    'description', 'personality', 'scenario', 'mes_example', 'story_string'
]);

function classifyMessages(chat) {
    const preset = [];       // 预设提示词
    const worldInfo = [];   // 世界书条目
    const extensions = [];  // 插件/扩展提示词
    const history = [];     // 历史对话 (chat-message-*)
    let currentUser = null;
    let prefill = null;

    // 1. 先遍历找出明确的当前用户输入和预填充
    for (let i = chat.length - 1; i >= 0; i--) {
        if (!prefill && chat[i].role === 'assistant' && !chat[i].identifier?.startsWith('chat-message-')) {
            prefill = chat[i];
        }
        if (!currentUser && chat[i].role === 'user' && !chat[i].identifier?.startsWith('chat-message-')) {
            currentUser = chat[i];
        }
        if (currentUser && prefill) break;
    }

    // 2. 遍历所有消息，根据角色和标识符分类
    for (const msg of chat) {
        // 跳过已识别的当前用户输入和预填充
        if (msg === currentUser || msg === prefill) {
            continue;
        }

        const id = msg.identifier || '';

        // 世界书条目 (基于角色或标识符)
        if (msg.role === 'world_info' || id.startsWith('worldInfoEntry_')) {
            worldInfo.push(msg);
            continue;
        }

        // 扩展提示词 (基于角色或标识符)
        if (msg.role === 'extension' || id.startsWith('extension:')) {
            extensions.push(msg);
            continue;
        }

        // 预设提示词 (基于标识符关键词)
        if (PRESET_IDENTIFIERS.has(id) || (msg.role === 'system' && (id.includes('main') || id.includes('jailbreak')))) {
            preset.push(msg);
            continue;
        }

        // 历史对话 (带 chat-message- 标识符)
        if (id.startsWith('chat-message-')) {
            history.push(msg);
            continue;
        }

        // 剩下的用户消息理论上不存在，但以防万一
        if (msg.role === 'user') {
            history.push(msg); // 归入历史
        }
    }

    // 3. 按严格要求组装最终序列
    const finalMessages = [
        ...preset,      // 1. 预设提示词
        ...worldInfo,   // 2. 世界书条目
        ...extensions,  // 3. 其他扩展提示词
        ...history,     // 4. 历史对话
    ];
    if (currentUser) finalMessages.push(currentUser); // 5. 当前用户输入
    if (prefill) finalMessages.push(prefill);          // 6. 预填充

    return finalMessages;
}
