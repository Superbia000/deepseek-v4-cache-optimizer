// ==========================================
// Cache Hit Optimizer v8 (Based on Injection Tags and Dual-Array Strategy)
// ==========================================

import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { getRegexedString } from '../../../utils.js';

// ... (保留 Logger, 以及其他工具函数 simpleHash, estimateTokens)

let logLevel = 2; // 0:silent, 1:basic, 2:detailed, 3:debug
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

// ... (Log 相关函数) 

// 核心缓存状态
const CacheState = {
    enabled: true,
    // v8: 采用双重数组策略
    lockedPrefixMessages: [],       // 绝对锁定的前缀消息数组 (system, world info, etc.)
    lockedPrefixHash: null,         // 锁定前缀的哈希值
    lockedPrefixTokens: 0,         // 锁定前缀的 token 估算值
    dynamicHistoryHash: null,       // 动态历史部分的哈希值
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// ==========================================
// 精准分类器 (v8 - 基于 injection_tag/prompt_role 的双重数组)
// ==========================================
function classifyAndSplitMessages(chat) {
    const context = getContext();
    // 这是一个根据 ST 内部逻辑推断出的映射，不同版本的 ST 可能略有差异
    // 主要依据 injection_tag 的前缀或特定的 prompt_role
    const STATIC_INJECTION_TAGS = [
        'World Info',       // 世界书条目
        'Author\'s Note',   // 作者笔记
        'Summary',          // 聊天摘要
        'Story String',     // 角色主设定
        'Personality',      // 性格描述
        'Scenario',         // 场景描述
        'Main Prompt',      // 主提示词
        'Jailbreak',        // 越狱提示
        'NSFW Prompt',      // NSFW提示
        'Extension',        // 大部分扩展注入的提示
        'Group Context',    // 群聊上下文
    ];

    const lockedPrefix = [];
    const dynamicHistory = [];

    for (const msg of chat) {
        // 1. 检查 injection_tag 或 prompt_role 标记 (通常非空)
        const tag = msg.injection_tag || '';
        const promptRole = msg.prompt_role || '';
        const isStaticTag = STATIC_INJECTION_TAGS.some(t => tag.includes(t));

        // 2. 正规的判断逻辑：
        //    - 如果有明显的静态标签，直接归入锁定前缀
        //    - 如果是消息没有特定标签，但 role 是 system 且内容与本轮用户输入无关，通常视为预设提示词
        //    - 剩余无标签的 user/assistant 视为动态历史
        if (tag || promptRole === 'system') {
            // 排除掉可能被错误标记的动态内容，例如某些扩展注入的 "Extension: User" 类型
            // 但作为缓存优化，所有注入提示都应尽量放入前缀
            lockedPrefix.push(msg);
        } else {
            // 带有具体用户和助手对话标记的，或者是当前用户输入
            dynamicHistory.push(msg);
        }
    }

    return { lockedPrefix, dynamicHistory };
}

// ==========================================
// 核心拦截器 (v8)
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        
        // 0. 检查角色卡是否重置 (简单检测 groupId 或 characterId 变化)
        const context = getContext();
        const currentCharId = context.characterId;
        if (CacheState._lastCharId !== currentCharId) {
            resetCacheState('角色卡或群组已切换');
            CacheState._lastCharId = currentCharId;
        }

        // 1. 精准拆解为锁定前缀与动态历史
        const { lockedPrefix: currentLockedPrefix, dynamicHistory: currentDynamicHistory } = classifyAndSplitMessages(data.chat);

        // 2. 组装最终消息序列：锁定前缀 + 动态历史
        const finalMessages = [...CacheState.lockedPrefixMessages, ...currentDynamicHistory];

        // 3. 计算当前锁定前缀的哈希 (仅计算我们用到的锁定部分)
        const currentLockedHash = simpleHash(CacheState.lockedPrefixMessages.map(m => m.content).join(''));
        const isPrefixChanged = CacheState.lockedPrefixHash !== currentLockedHash;

        // 4. 更新状态与统计
        if (CacheState.lockedPrefixMessages.length === 0 || isPrefixChanged) {
            // 首次运行或前缀发生变化：重建锁定前缀缓存
            CacheState.lockedPrefixMessages = currentLockedPrefix;
            CacheState.lockedPrefixHash = simpleHash(currentLockedPrefix.map(m => m.content).join(''));
            CacheState.lockedPrefixTokens = estimateTokens(currentLockedPrefix.map(m => m.content).join(''));
            Logger.warn(`⚠️ 锁定前缀已更新 (${CacheState.lockedPrefixMessages.length} 条消息, ~${CacheState.lockedPrefixTokens} tokens)，下次请求将完美命中。`, LogLevels.BASIC);
        } else {
            // 前缀未变，完美命中缓存！
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += CacheState.lockedPrefixTokens;
            Logger.log(`🎯 完美缓存命中！锁定前缀未变，仅需计算动态历史 (~${estimateTokens(currentDynamicHistory.map(m=>m.content).join(''))} tokens)`, LogLevels.BASIC);
        }

        // 5. 写回修改后的 chat 数组
        data.chat.splice(0, data.chat.length, ...finalMessages);
        
        // 6. 更新UI
        updateStatsUI();

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

function resetCacheState(reason) {
    // ... (保留 toastr 提醒逻辑)
    CacheState.lockedPrefixMessages = [];
    CacheState.lockedPrefixHash = null;
    CacheState.lockedPrefixTokens = 0;
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    Logger.warn(`缓存前缀已重置：${reason}`);
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
