import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 模块 1：日志系统（保留原风格，增强统计）
// ==========================================
const Logger = {
    _uiTextarea: null,
    _stats: { hits: 0, total: 0, tokenSaved: 0 },
    
    log: (msg) => {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const logStr = `[${time}] ✅ ${msg}`;
        console.log(`%c[DS V4 Optimizer v2] ${msg}`, 'color: #00ff00; font-weight: bold;');
        Logger._append(logStr);
    },
    warn: (msg) => {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const logStr = `[${time}] 🌪️ ${msg}`;
        console.warn(`%c[DS V4 Optimizer v2] ${msg}`, 'color: #ffaa00; font-weight: bold;');
        Logger._append(logStr);
    },
    error: (msg, err) => {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const logStr = `[${time}] 🔴 ${msg}`;
        console.error(`[DS V4 Optimizer v2] ${msg}`, err || '');
        Logger._append(logStr);
    },
    _append(text) {
        if (Logger._uiTextarea) {
            Logger._uiTextarea.value += text + '\n';
            Logger._uiTextarea.scrollTop = Logger._uiTextarea.scrollHeight;
        }
    }
};

// ==========================================
// 模块 2：缓存状态机（增强版，支持多层追踪）
// ==========================================
const CacheState = {
    enabled: true,
    // 静态前缀快照（序列化为字符串用于哈希比对）
    staticPrefixHash: null,
    staticPrefixLength: 0,
    
    // 每回合追踪（用于跨回合对比）
    previousMessagesSnapshot: null,
    
    // 黑洞系统（保留原功能，用于捕获浮动的 jailbreak / 格式指令）
    blackHoleCore: "",
    knownFloats: new Set(),
    lastBottomBlocks: [],
    
    // 统计
    stats: {
        totalRequests: 0,
        cacheHitRequests: 0,
        estimatedTokensSaved: 0
    }
};

// ==========================================
// 模块 3：快速 Token 估算器
// ==========================================
function estimateTokens(text) {
    if (!text || text.length === 0) return 0;
    // CJK 字符约 1 char ≈ 1 token，英文约 4 char ≈ 1 token
    let tokens = 0;
    for (const ch of text) {
        const code = ch.charCodeAt(0);
        if (code >= 0x4E00 && code <= 0x9FFF) {
            tokens += 1;
        } else if (code >= 0x3040 && code <= 0x30FF) {
            tokens += 1;
        } else if (code >= 0xAC00 && code <= 0xD7AF) {
            tokens += 1;
        } else {
            tokens += 0.25;
        }
    }
    return Math.ceil(tokens);
}

// ==========================================
// 模块 4：核心重组引擎（完全重写）
// ==========================================

/**
 * 对 messages 数组进行分类，返回分类结果
 */
function classifyMessages(messages) {
    const systemMessages = [];   // 所有 system 角色消息
    const chatHistory = [];      // 非 system 角色的对话历史
    const assistantPrefills = []; // 末尾的 AI 预填充（assistant 角色在数组最末尾）
    
    if (!Array.isArray(messages)) return { systemMessages, chatHistory, assistantPrefills };
    
    // 从后往前识别 AI 预填充
    const working = [...messages];
    while (working.length > 0 && working[working.length - 1].role === 'assistant') {
        assistantPrefills.unshift(working.pop());
    }
    
    // 分类剩余的消息
    for (const msg of working) {
        if (msg.role === 'system') {
            systemMessages.push(msg);
        } else {
            chatHistory.push(msg);
        }
    }
    
    return { systemMessages, chatHistory, assistantPrefills };
}

/**
 * 将 system 消息内容合并为单个字符串，去重
 */
function mergeSystemContent(systemMessages) {
    if (systemMessages.length === 0) return "";
    
    const uniqueLines = [];
    const seen = new Set();
    
    for (const msg of systemMessages) {
        const content = msg.content || "";
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed !== "" && !seen.has(trimmed)) {
                seen.add(trimmed);
                uniqueLines.push(line);
            }
        }
    }
    
    return uniqueLines.join('\n');
}

/**
 * 浮动的 jailbreak / 格式指令检测与捕获
 * 跨回合持续出现在聊天历史底部的相同内容 = 酒馆插入的浮动指令
 */
function detectAndAbsorbFloats(chatHistory) {
    if (!Array.isArray(chatHistory) || chatHistory.length === 0) return { cleaned: chatHistory, absorbed: 0 };
    
    const currentBottoms = chatHistory.slice(-3);
    let absorbed = 0;
    
    const cleaned = [];
    for (let i = 0; i < chatHistory.length; i++) {
        const msg = chatHistory[i];
        const isAtBottom = i >= chatHistory.length - 3;
        const isLongEnough = msg.content && msg.content.length > 25;
        
        // 条件 A：已经在黑洞特征库中
        if (CacheState.knownFloats.has(msg.content)) {
            continue;
        }
        
        // 条件 B：跨回合出现在底部
        const wasInLastBottom = CacheState.lastBottomBlocks.some(oldMsg => oldMsg.content === msg.content);
        if (isAtBottom && isLongEnough && wasInLastBottom) {
            CacheState.knownFloats.add(msg.content);
            CacheState.blackHoleCore += `\n\n[Persistent Formatting / ${msg.role.toUpperCase()}]:\n${msg.content}`;
            Logger.warn(`发现浮动指令 (${msg.role}, ${msg.content.length}字)，已永久吸入黑洞核心！`);
            absorbed++;
            continue;
        }
        
        cleaned.push(msg);
    }
    
    // 更新底部特征库
    CacheState.lastBottomBlocks = cleaned.slice(-3).map(m => ({ role: m.role, content: m.content }));
    
    return { cleaned, absorbed };
}

/**
 * 计算两个字符串的相似度（基于行级去重）
 */
function computeSimilarity(oldText, newText) {
    if (!oldText) return 0;
    if (!newText) return 0;
    
    const oldLines = new Set(oldText.split('\n').map(l => l.trim()).filter(l => l !== ''));
    const newLines = newText.split('\n').map(l => l.trim()).filter(l => l !== '');
    
    if (newLines.length === 0) return 1;
    
    let common = 0;
    for (const line of newLines) {
        if (oldLines.has(line)) common++;
    }
    
    return common / newLines.length;
}

/**
 * 核心拦截与重组函数
 * 
 * 核心策略：
 * 1. 将所有 system 消息合并为一个，放在 messages 数组最前面
 * 2. 对话历史保持原始顺序紧随其后
 * 3. AI 预填充放在最后
 * 
 * 这样每一回合，数组开头的 system 部分完全不变，只有末尾的 chat history 逐轮追加
 * DeepSeek 的前缀缓存将 100% 命中 system 部分
 */
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;
    
    try {
        CacheState.stats.totalRequests++;
        
        Logger.log("==========================================");
        Logger.log(`启动拦截器 #${CacheState.stats.totalRequests}：执行缓存对齐重组`);
        
        if (!data || !Array.isArray(data.chat) || data.chat.length === 0) return;
        
        const originalMessages = [...data.chat];
        const originalFirstRole = originalMessages[0]?.role || 'unknown';
        const originalLastRole = originalMessages[originalMessages.length - 1]?.role || 'unknown';
        
        // 1. 分类消息
        const { systemMessages, chatHistory, assistantPrefills } = classifyMessages(originalMessages);
        
        // 2. 检测并吸收浮动的 jailbreak / 格式指令
        const { cleaned: cleanedChatHistory, absorbed } = detectAndAbsorbFloats(chatHistory);
        
        // 3. 合并 system 内容
        const currentSystemText = mergeSystemContent(systemMessages);
        
        // 4. 冻结静态前缀（第一回合或系统发生巨变时重置）
        if (!CacheState.staticPrefixHash || absorbed > 0) {
            Logger.log("锁存静态前缀快照（首次初始化或黑洞更新触发）");
            CacheState.staticPrefixHash = currentSystemText + CacheState.blackHoleCore;
            CacheState.staticPrefixLength = estimateTokens(currentSystemText + CacheState.blackHoleCore);
        }
        
        // 5. 系统巨变检测（如切换角色）
        const similarity = computeSimilarity(CacheState.staticPrefixHash.split('\n\n[Persistent')[0], currentSystemText);
        if (similarity < 0.3 && currentSystemText.length > 50) {
            Logger.warn(`系统提示词发生巨变（相似度 ${(similarity * 100).toFixed(1)}%），已自动重置核心！`);
            CacheState.staticPrefixHash = currentSystemText + CacheState.blackHoleCore;
            CacheState.staticPrefixLength = estimateTokens(currentSystemText + CacheState.blackHoleCore);
            CacheState.blackHoleCore = "";
            CacheState.knownFloats.clear();
            CacheState.lastBottomBlocks = [];
        }
        
        // 6. 重组消息数组（关键步骤）
        const newMessages = [];
        
        // [位置 0] 静态前缀：合并后的 system 内容 + 吸入的黑洞内容
        const prefixCore = currentSystemText + CacheState.blackHoleCore;
        if (prefixCore.trim().length > 0) {
            newMessages.push({ role: 'system', content: prefixCore });
        }
        
        // [位置 1 ~ N] 纯净对话历史（保持原始顺序，只保留 user/assistant 交替）
        newMessages.push(...cleanedChatHistory);
        
        // [位置 N+1] AI 预填充
        newMessages.push(...assistantPrefills);
        
        // 7. 缓存命中判定
        const newPrefixText = newMessages[0]?.content || "";
        const cacheHit = (CacheState.staticPrefixHash === newPrefixText);
        
        if (cacheHit) {
            CacheState.stats.cacheHitRequests++;
            const estimatedSaved = CacheState.staticPrefixLength;
            CacheState.stats.estimatedTokensSaved += estimatedSaved;
            Logger.log(`✅ 缓存命中！静态前缀未变化，预估节省 ${estimatedSaved} tokens`);
        } else {
            Logger.warn("⚠️ 静态前缀已变化，本轮不在缓存中命中（下一轮将命中新前缀）");
            CacheState.staticPrefixHash = newPrefixText;
            CacheState.staticPrefixLength = estimateTokens(newPrefixText);
        }
        
        // 8. 原地覆写请求数组
        data.chat.splice(0, data.chat.length, ...newMessages);
        
        Logger.log(`重组完成！原始 ${originalMessages.length} 条消息 → 优化后 ${data.chat.length} 条`);
        Logger.log(`[首条角色: ${originalFirstRole} → ${newMessages[0]?.role}, 末条角色: ${originalLastRole} → ${newMessages[newMessages.length - 1]?.role}]`);
        
        // 更新统计 UI
        updateStatsUI();
        
    } catch (err) {
        Logger.error("致命错误！已取消优化。", err);
    }
}

// ==========================================
// 模块 5：统计 UI 更新
// ==========================================
function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    
    const total = CacheState.stats.totalRequests;
    const hits = CacheState.stats.cacheHitRequests;
    const rate = total > 0 ? ((hits / total) * 100).toFixed(1) : "0.0";
    const saved = CacheState.stats.estimatedTokensSaved;
    
    el.innerHTML = `
        <span style="color:#4af626;">命中: ${hits}/${total} (${rate}%)</span>
        <span style="margin-left:12px;">预估节省: ${saved.toLocaleString()} tokens</span>
        <span style="margin-left:12px;">静态前缀: ${CacheState.staticPrefixLength.toLocaleString()} tokens</span>
    `;
}

// ==========================================
// 模块 6：内建折叠式 UI 界面（增强版）
// ==========================================
async function setupUI() {
    try {
        Logger.log("初始化 UI...");
        
        const uiHTML = `
            <div class="inline-drawer" id="ds-v4-optimizer-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>🧠 Deepseek V4 Cache Optimizer v2</b>
                    <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="padding: 10px; background: rgba(0,0,0,0.1); border-radius: 5px;">
                    <p style="font-size: 0.9em; opacity: 0.8; margin-top: 0; margin-bottom: 8px;">
                        自动重组提示词结构，将静态内容前置以最大化 DeepSeek V4 前缀缓存命中率。
                    </p>
                    
                    <div style="margin-bottom: 8px; font-size:0.85em; background:#1a1a2e; padding:6px 10px; border-radius:4px;" id="ds-cache-stats">
                        等待首轮请求...
                    </div>
                    
                    <div style="margin-bottom: 12px;">
                        <label class="checkbox_label" style="display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="ds-cache-enable" checked> 
                            <span>启用缓存对齐拦截器</span>
                        </label>
                    </div>
                    
                    <button id="ds-cache-reset" class="menu_button" style="width: 100%; display: block; margin-bottom: 12px; padding: 10px; text-align: center;">
                        🔄 强制重置静态前缀与黑洞核心
                    </button>
                    
                    <div>
                        <div style="font-weight: bold; margin-bottom: 5px; font-size: 0.9em;">排错日志:</div>
                        <textarea id="ds-cache-log" class="text_pole" readonly style="width: 100%; height: 200px; background-color: #121212; color: #4af626; font-family: 'Consolas', monospace; font-size: 11px; padding: 8px; border: 1px solid var(--SmartThemeBorderColor, #555); border-radius: 4px; resize: vertical; box-sizing: border-box;"></textarea>
                    </div>
                </div>
            </div>
        `;
        
        $('#extensions_settings').append(uiHTML);
        Logger._uiTextarea = document.getElementById('ds-cache-log');
        
        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`插件状态已更改: ${CacheState.enabled ? "启用" : "停用"}`);
        });

        $('#ds-cache-reset').on('click', function() {
            CacheState.staticPrefixHash = null;
            CacheState.staticPrefixLength = 0;
            CacheState.blackHoleCore = "";
            CacheState.knownFloats.clear();
            CacheState.lastBottomBlocks = [];
            CacheState.stats = { totalRequests: 0, cacheHitRequests: 0, estimatedTokensSaved: 0 };
            updateStatsUI();
            Logger.warn("已清空静态前缀、黑洞核心及所有统计数据！下一回合将重新锁存！");
        });
        
        updateStatsUI();
        
    } catch (err) {
        Logger.error("UI 初始化失败！", err);
    }
}

// ==========================================
// 模块 7：扩展生命周期启动
// ==========================================
jQuery(async () => {
    try {
        console.log("Deepseek V4 Optimizer v2 is loading...");
        await setupUI();
        
        // 挂载到 CHAT_COMPLETION_PROMPT_READY 事件
        // 这是 SillyTavern 在发送请求前触发的最后一个可拦截事件
        if (eventSource && event_types && event_types.CHAT_COMPLETION_PROMPT_READY) {
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
            Logger.log("成功挂载 CHAT_COMPLETION_PROMPT_READY 钩子");
        } else {
            Logger.error("无法获取 eventSource 或 event_types，扩展无法运行！");
        }
        
        Logger.log("══════════════════════════════════════");
        Logger.log("Deepseek V4 Cache Optimizer v2 已就绪");
        Logger.log("策略: 静态前缀锁存 + 动态尾缀追加");
        Logger.log("══════════════════════════════════════");
        
    } catch (err) {
        Logger.error("扩展加载过程发生致命错误！", err);
    }
});
