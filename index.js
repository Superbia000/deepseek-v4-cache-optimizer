import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ========== 日志 ==========
let logLevel = 2;
const Logger = {
    _uiTextarea: null,
    log: (msg, level = 2) => { if (logLevel >= level) append('log', msg); },
    warn: (msg, level = 1) => { if (logLevel >= level) append('warn', msg); },
    error: (msg, err, level = 1) => { if (logLevel >= level) append('error', err ? msg + ' ' + err : msg); },
    _appendLine(type, text) {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const prefix = type === 'error' ? '🔴' : (type === 'warn' ? '🌪️' : '✅');
        const line = `[${time}] ${prefix} ${text}`;
        if (Logger._uiTextarea) {
            Logger._uiTextarea.value += line + '\n';
            Logger._uiTextarea.scrollTop = Logger._uiTextarea.scrollHeight;
        }
        if (type === 'error') console.error('[DS V4 Opt v7.0]', text);
        else if (type === 'warn') console.warn('[DS V4 Opt v7.0]', text);
        else console.log('%c[DS V4 Opt v7.0]', 'color:#00ff00;font-weight:bold', text);
    }
};
function append(type, msg) { Logger._appendLine(type, msg); }

// ========== 工具 ==========
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
function estimateTokens(text) {
    if (!text) return 0;
    let t = 0;
    for (const ch of text) {
        const code = ch.charCodeAt(0);
        if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3040 && code <= 0x30FF) || (code >= 0xAC00 && code <= 0xD7AF)) t += 1;
        else t += 0.25;
    }
    return Math.ceil(t);
}
function normalize(text) {
    return text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
        .replace(/[，。！？、；：]/g, m => ({
            '，': ',', '。': '.', '！': '!', '？': '?', '、': ',', '；': ';', '：': ':'
        })[m] || m).trim();
}

// ========== 状态机 ==========
const CacheState = {
    enabled: true,
    // 永久锁定的提示词序列 (按顺序)
    lockedPresetPrompts: [],    // 预设提示词 + 角色信息等 (system)
    lockedOtherPrompts: [],     // 插件注入等不可分类的提示词 (system)
    lockedWorldEntries: [],     // 世界书条目 (逐条, system)
    lockedHistory: [],          // 历史对话 (user/assistant, 不含当前输入)
    // 指纹
    presetFp: null,
    otherFp: null,
    worldFp: null,
    historyFp: null,
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// ========== 世界书条目识别 (核心突破) ==========
function buildWorldUIDSet() {
    const ctx = getContext();
    if (!ctx || !ctx.worldInfo || !ctx.worldInfo.entries) return new Set();
    const uids = new Set();
    for (const entry of ctx.worldInfo.entries) {
        if (!entry.disable && entry.uid !== undefined) {
            uids.add(String(entry.uid));
        }
    }
    return uids;
}

// 判断一条 system 消息是否为世界书条目
// 通过检测内容中是否包含世界书条目的 UID (ST 渲染时会添加)
function isWorldEntryByUID(content, worldUIDSet) {
    // 匹配可能的 UID 标记: [World Info: 123] 或 [WI: 123] 或 (WI:123) 等
    const uidMatch = content.match(/\[(?:World Info|WI)\s*:\s*([^\]]+)\]/i);
    if (uidMatch) {
        const uid = uidMatch[1].trim();
        return worldUIDSet.has(uid);
    }
    return false;
}

// 判断一条 system 消息是否包含世界书内容（通过关键词）
function isWorldEntryByContent(content) {
    // 世界书条目通常包裹在特定容器中
    return content.includes('<Lore>') || content.includes('</Lore>') ||
           content.includes('World Info') || content.includes('World Loading') ||
           content.includes('Loading complete');
}

// ========== 从 data.chat 精准分类 ==========
function classifyDataChat(dataChat) {
    const worldUIDSet = buildWorldUIDSet();
    
    const presetPrompts = [];    // 预设提示词
    const worldEntries = [];     // 世界书条目
    const otherPrompts = [];     // 其他提示词
    const prefills = [];         // 预填充
    let currentUserMsg = null;   // 当前用户输入
    
    // 倒序查找预填充
    const messages = [...dataChat];
    while (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
        prefills.unshift(messages.pop());
    }
    
    // 找到当前用户输入 (最后一条 user)
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
            currentUserMsg = messages.splice(i, 1)[0];
            break;
        }
    }
    
    // 分类剩余的 system 消息
    for (const msg of messages) {
        if (msg.role !== 'system') {
            // user/assistant 消息保留到 other 中作为历史
            otherPrompts.push(msg);
            continue;
        }
        
        const content = msg.content || '';
        
        // 1. 先检查是否是世界书相关 (UID 匹配 或 容器标记)
        if (isWorldEntryByUID(content, worldUIDSet) || isWorldEntryByContent(content)) {
            // 如果是包裹容器，尝试提取内部条目
            if (content.includes('<Lore>') && content.includes('</Lore>')) {
                // 提取容器内的每条世界书条目 (以系统消息形式逐条输出)
                const loreMatch = content.match(/<Lore>\s*([\s\S]*?)\s*<\/Lore>/);
                if (loreMatch) {
                    const innerContent = loreMatch[1].trim();
                    // 按条目分隔符拆分 (可能是 [WI:uid]content 格式)
                    const entryParts = innerContent.split(/\[(?:WI|World Info)\s*:\s*[^\]]+\]/i).filter(s => s.trim());
                    if (entryParts.length > 0) {
                        for (const part of entryParts) {
                            const trimmed = part.trim();
                            if (trimmed) {
                                worldEntries.push({ role: 'system', content: trimmed });
                            }
                        }
                    } else {
                        // 无法拆分，将内部内容作为整体
                        worldEntries.push({ role: 'system', content: innerContent.trim() });
                    }
                }
            } else {
                worldEntries.push(msg);
            }
        }
        // 2. 检查是否是不相关的容器/标记 (World Loading 等)
        else if (content.includes('[World Loading ...]') || content.includes('[SYSTEM:Loading complete.]') ||
                 content.includes('World Loading') || content.includes('Loading complete')) {
            // 这些是 ST 内部标记，直接丢弃
            continue;
        }
        // 3. 剩下的是预设提示词或其他
        else {
            presetPrompts.push(msg);
        }
    }
    
    return {
        presetPrompts,
        worldEntries,
        otherPrompts,
        currentUserMsg,
        prefills
    };
}

// ========== 从 ST 内部获取数据 (备用/补充) ==========
function getFullChatHistory() {
    const ctx = getContext();
    if (!ctx || !ctx.chat) return [];
    return ctx.chat
        .filter(msg => !msg.is_system)
        .map(msg => ({
            role: msg.is_user ? 'user' : 'assistant',
            content: msg.mes || ''
        }))
        .filter(m => m.content.length > 0);
}

// ========== 核心重组 ==========
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`====== [请求 #${CacheState.stats.total}] ======`, 2);

        const original = data.chat;
        if (!original || !original.length) return;

        // 1. 精准分类 data.chat
        const classified = classifyDataChat(original);
        
        if (logLevel >= 3) {
            Logger.log(`分类结果: 预设${classified.presetPrompts.length}条, 世界书${classified.worldEntries.length}条, 其他${classified.otherPrompts.length}条, 预填充${classified.prefills.length}条`, 3);
        }

        // 2. 检查当前用户输入
        if (!classified.currentUserMsg) {
            Logger.warn('未找到当前用户输入，取消重组', 1);
            return;
        }

        // 3. 补全历史对话 (从 ST 内部获取完整历史)
        const fullHistory = getFullChatHistory();
        const currentInputContent = normalize(classified.currentUserMsg.content);
        let currentInputIndex = -1;
        for (let i = fullHistory.length - 1; i >= 0; i--) {
            if (fullHistory[i].role === 'user' && normalize(fullHistory[i].content) === currentInputContent) {
                currentInputIndex = i;
                break;
            }
        }
        const previousHistory = currentInputIndex > 0 ? fullHistory.slice(0, currentInputIndex) : [];

        // 4. 指纹计算
        const newPresetFp = classified.presetPrompts.map(m => simpleHash(normalize(m.content))).join('|');
        const newOtherFp = classified.otherPrompts.map(m => simpleHash(normalize(m.content))).join('|');
        const newWorldFp = classified.worldEntries.map(m => simpleHash(normalize(m.content))).join('|');
        const newHistoryFp = previousHistory.map(m => simpleHash(normalize(m.content))).join('|');

        // 5. 初始化或变化检测
        if (!CacheState.lockedPresetPrompts) {
            Object.assign(CacheState, {
                lockedPresetPrompts: classified.presetPrompts,
                lockedOtherPrompts: classified.otherPrompts,
                lockedWorldEntries: classified.worldEntries,
                lockedHistory: previousHistory,
                presetFp: newPresetFp,
                otherFp: newOtherFp,
                worldFp: newWorldFp,
                historyFp: newHistoryFp
            });
            Logger.log(`[初始化] 预设${classified.presetPrompts.length}条, 其他${classified.otherPrompts.length}条, 世界书${classified.worldEntries.length}条, 历史${previousHistory.length}条`, 2);
            const finalMessages = [
                ...CacheState.lockedPresetPrompts,
                ...CacheState.lockedOtherPrompts,
                ...CacheState.lockedWorldEntries,
                ...CacheState.lockedHistory,
                classified.currentUserMsg,
                ...classified.prefills
            ];
            data.chat.splice(0, data.chat.length, ...finalMessages);
            updateStats();
            return;
        }

        // 6. 变化检测
        const presetChanged = newPresetFp !== CacheState.presetFp;
        const otherChanged = newOtherFp !== CacheState.otherFp;
        const worldChanged = newWorldFp !== CacheState.worldFp;
        const historyChanged = newHistoryFp !== CacheState.historyFp;

        const isPresetAppend = presetChanged && newPresetFp.startsWith(CacheState.presetFp);
        const isOtherAppend = otherChanged && newOtherFp.startsWith(CacheState.otherFp);
        const isWorldAppend = worldChanged && newWorldFp.startsWith(CacheState.worldFp);
        const isHistoryAppend = historyChanged && newHistoryFp.startsWith(CacheState.historyFp);

        if ((presetChanged && !isPresetAppend) || (otherChanged && !isOtherAppend) || 
            (worldChanged && !isWorldAppend) || (historyChanged && !isHistoryAppend)) {
            Logger.warn('[核心重置] 检测到非追加性变化，自动重置', 1);
            if (typeof toastr !== 'undefined') toastr.warning('提示词结构变化，缓存前缀已重置。', '缓存优化器');
            CacheState.lockedPresetPrompts = null;
            CacheState.lockedOtherPrompts = null;
            CacheState.lockedWorldEntries = null;
            CacheState.lockedHistory = null;
            CacheState.presetFp = null;
            CacheState.otherFp = null;
            CacheState.worldFp = null;
            CacheState.historyFp = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            interceptAndRestructurePrompt(data);
            return;
        }

        // 7. 收集新增条目
        let appendedPresets = [];
        let appendedOthers = [];
        let appendedWorlds = [];

        if (isPresetAppend) {
            appendedPresets = classified.presetPrompts.slice(CacheState.lockedPresetPrompts.length);
            CacheState.lockedPresetPrompts = classified.presetPrompts;
            CacheState.presetFp = newPresetFp;
            Logger.warn(`[追加] ${appendedPresets.length} 条新预设提示词`, 2);
        }
        if (isOtherAppend) {
            appendedOthers = classified.otherPrompts.slice(CacheState.lockedOtherPrompts.length);
            CacheState.lockedOtherPrompts = classified.otherPrompts;
            CacheState.otherFp = newOtherFp;
            Logger.warn(`[追加] ${appendedOthers.length} 条其他提示词`, 2);
        }
        if (isWorldAppend) {
            appendedWorlds = classified.worldEntries.slice(CacheState.lockedWorldEntries.length);
            CacheState.lockedWorldEntries = classified.worldEntries;
            CacheState.worldFp = newWorldFp;
            Logger.warn(`[追加] ${appendedWorlds.length} 条世界书条目`, 2);
        }
        if (isHistoryAppend) {
            CacheState.lockedHistory = previousHistory;
            CacheState.historyFp = newHistoryFp;
        }

        // 8. 构建最终消息序列
        const finalMessages = [
            ...CacheState.lockedPresetPrompts,
            ...CacheState.lockedOtherPrompts,
            ...CacheState.lockedWorldEntries,
            ...CacheState.lockedHistory,
            ...appendedPresets,
            ...appendedOthers,
            ...appendedWorlds,
            classified.currentUserMsg,
            ...classified.prefills
        ];

        data.chat.splice(0, data.chat.length, ...finalMessages);

        // 9. 统计缓存命中
        const prefixTokens = estimateTokens(
            CacheState.lockedPresetPrompts.concat(CacheState.lockedOtherPrompts, CacheState.lockedWorldEntries, CacheState.lockedHistory)
                .map(m => m.content).join('')
        );
        CacheState.stats.prefixTokens = prefixTokens;
        CacheState.stats.hits++;
        CacheState.stats.savedTokens += prefixTokens;
        Logger.log(`✅ 缓存命中！静态前缀 ${prefixTokens} tokens`, 2);

        updateStats();

    } catch (err) {
        Logger.error('拦截器致命错误', err, 1);
    }
}

// ========== UI ==========
function updateStats() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `命中: ${hits}/${total} (${rate}%) | 前缀: ~${prefixTokens.toLocaleString()}t | 节省: ~${savedTokens.toLocaleString()}t`;
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DS V4 缓存优化器 v7.0 (UID精准分类版)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">通过 World Info UID 精准识别世界书条目。排序：预设提示词 → 其他提示词 → 世界书条目 → 历史对话 → 当前输入 → 预填充。</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;"></div>
                <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" checked> 启用自动化缓存优化</label>
                <div style="display:flex;align-items:center;gap:8px;margin:8px 0;">
                    <span>日志等级:</span>
                    <select id="ds-cache-loglevel">
                        <option value="0">关闭</option>
                        <option value="1">简要</option>
                        <option value="2" selected>详细</option>
                        <option value="3">调试</option>
                    </select>
                </div>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');
        $('#ds-cache-enable').on('change', function() { CacheState.enabled = $(this).is(':checked'); });
        $('#ds-cache-loglevel').on('change', function() { logLevel = parseInt($(this).val()); });
        $('#ds-cache-reset').on('click', () => {
            CacheState.lockedPresetPrompts = null;
            CacheState.lockedOtherPrompts = null;
            CacheState.lockedWorldEntries = null;
            CacheState.lockedHistory = null;
            CacheState.presetFp = null;
            CacheState.otherFp = null;
            CacheState.worldFp = null;
            CacheState.historyFp = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateStats();
            Logger.warn('已强制重置', 1);
        });
        updateStats();
    } catch (e) {
        Logger.error('UI初始化失败', e);
    }
}

jQuery(async () => {
    console.log('DS V4 Optimizer v7.0 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 已挂载钩子', 2);
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v7.0 就绪，UID 精准分类世界书 ══════', 2);
});
