import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 模块 1：日志系统（支持等级控制）
// ==========================================
const LOG_LEVELS = { OFF: 0, NORMAL: 1, DEBUG: 2 };
let currentLogLevel = LOG_LEVELS.NORMAL;

const Logger = {
    _uiTextarea: null,
    _logLevel: LOG_LEVELS.NORMAL,
    setLevel(level) {
        this._logLevel = level;
    },
    debug(msg) {
        if (this._logLevel >= LOG_LEVELS.DEBUG) {
            this._emit('🐛', msg, 'color: #888;');
        }
    },
    log(msg) {
        if (this._logLevel >= LOG_LEVELS.NORMAL) {
            this._emit('✅', msg, 'color: #00ff00; font-weight: bold;');
        }
    },
    warn(msg) {
        if (this._logLevel >= LOG_LEVELS.NORMAL) {
            this._emit('🌪️', msg, 'color: #ffaa00; font-weight: bold;');
        }
    },
    error(msg, err) {
        this._emit('🔴', msg, 'color: #ff0000; font-weight: bold;');
        console.error(`[DS V4 Opt v3.2] ${msg}`, err || '');
    },
    _emit(icon, msg, style) {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const full = `[${time}] ${icon} ${msg}`;
        console.log(`%c[DS V4 Opt v3.2] ${full}`, style);
        if (Logger._uiTextarea) {
            Logger._uiTextarea.value += full + '\n';
            Logger._uiTextarea.scrollTop = Logger._uiTextarea.scrollHeight;
        }
    }
};

// ==========================================
// 模块 2：简单 hash 与 token 估算
// ==========================================
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
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
        } else {
            tokens += 0.25;
        }
    }
    return Math.ceil(tokens);
}

// ==========================================
// 模块 3：缓存状态机（v3.2）
// ==========================================
const CacheState = {
    enabled: true,
    staticCore: null,               // 纯净 system 核心文本
    absorbedMessages: [],           // [{ role, content, hash }] 吸收的固定消息
    knownFloatsContent: new Set(),  // 已吸收内容的指纹（用于快速去重）
    lastChatSnapshot: new Map(),    // 上一轮聊天历史中每条消息的 hash -> 消息内容
    lastPrefixSnapshot: null,
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

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
// 模块 5：全面吸收重复内容（增强版）
// ==========================================
function absorbRepeatedContent(chatHistory) {
    if (!chatHistory.length) return { cleaned: chatHistory, newlyAbsorbed: [] };
    
    const currentHashes = new Map();
    for (const msg of chatHistory) {
        const hash = simpleHash(msg.content);
        currentHashes.set(hash, msg.content);
    }
    
    // 与上一轮快照对比，找出重复出现的消息（不在底部也能吸收）
    const newlyAbsorbed = [];
    if (CacheState.lastChatSnapshot.size > 0) {
        for (const [hash, content] of currentHashes.entries()) {
            if (CacheState.lastChatSnapshot.has(hash) && !CacheState.knownFloatsContent.has(content)) {
                // 跨轮次重复，吸收为固定消息
                CacheState.knownFloatsContent.add(content);
                const entry = { role: 'user', content, hash };
                CacheState.absorbedMessages.push(entry);
                newlyAbsorbed.push(entry);
                Logger.debug(`吸收重复消息 (hash: ${hash}, ${content.length}字)`);
            }
        }
    }
    
    // 更新快照（只保存当前聊天历史中未被吸收的消息？为了下轮对比，我们保存所有非吸收的聊天历史消息，避免吸收已吸收的）
    CacheState.lastChatSnapshot.clear();
    for (const msg of chatHistory) {
        if (!CacheState.knownFloatsContent.has(msg.content)) {
            CacheState.lastChatSnapshot.set(simpleHash(msg.content), msg.content);
        }
    }
    
    // 清洗当前聊天历史，剥离所有已知浮动内容
    const cleaned = chatHistory.filter(msg => !CacheState.knownFloatsContent.has(msg.content));
    
    if (newlyAbsorbed.length > 0) {
        Logger.warn(`本轮吸收了 ${newlyAbsorbed.length} 条重复消息作为固定前缀 (${newlyAbsorbed.map(m=>m.hash).join(', ')})`);
    }
    
    return { cleaned, newlyAbsorbed };
}

// ==========================================
// 模块 6：前缀快照与差异报告
// ==========================================
function capturePrefixSnapshot(systemText, absorbedList) {
    return {
        systemHash: simpleHash(systemText),
        systemLen: systemText.length,
        systemTokens: estimateTokens(systemText),
        absorbedHashes: absorbedList.map(m => m.hash),
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
        diffs.push(`🔶 吸收消息数量变化: ${prev.absorbedHashes.length} → ${curr.absorbedHashes.length}`);
    }
    for (let i = 0; i < Math.max(prev.absorbedHashes.length, curr.absorbedHashes.length); i++) {
        const prevHash = prev.absorbedHashes[i] || '(无)';
        const currHash = curr.absorbedHashes[i] || '(无)';
        if (prevHash !== currHash) {
            diffs.push(`🔸 吸收消息 #${i+1} 变化 | 旧hash:${prevHash} (${prev.absorbedLengths[i] || 0}字) → 新hash:${currHash} (${curr.absorbedLengths[i] || 0}字)`);
        } else {
            diffs.push(`✅ 吸收消息 #${i+1} 无变化 (${curr.absorbedLengths[i]}字)`);
        }
    }
    return diffs.join('\n');
}

// ==========================================
// 模块 7：核心拦截重组
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

        // ---- 初始化或重置 ----
        if (!CacheState.staticCore) {
            const { cleaned, newlyAbsorbed } = absorbRepeatedContent(chatHistory); // 首次也运行吸收，但快照为空，不会吸收
            const staticCoreLines = currentSystemRaw.split('\n').filter(line => {
                const t = line.trim();
                return t && !CacheState.knownFloatsContent.has(t);
            });
            CacheState.staticCore = staticCoreLines.join('\n') || currentSystemRaw;
            Logger.log(`首次冻结静态核心 (${estimateTokens(CacheState.staticCore)} tokens, ${CacheState.staticCore.length}字)`);
            
            const initMsgs = [];
            initMsgs.push({ role: 'system', content: CacheState.staticCore });
            initMsgs.push(...CacheState.absorbedMessages);
            initMsgs.push(...cleaned);
            initMsgs.push(...prefills);
            data.chat.splice(0, data.chat.length, ...initMsgs);
            
            CacheState.lastPrefixSnapshot = capturePrefixSnapshot(CacheState.staticCore, CacheState.absorbedMessages);
            CacheState.stats.prefixTokens = CacheState.lastPrefixSnapshot.totalPrefixTokens;
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
            Logger.log(`初始化完成，消息数: ${initMsgs.length}，前缀tokens: ${CacheState.stats.prefixTokens}`);
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
            CacheState.lastChatSnapshot.clear();
            CacheState.lastPrefixSnapshot = null;
            interceptAndRestructurePrompt(data);
            return;
        }

        // ---- 吸收重复内容 ----
        const { cleaned: cleanedChat, newlyAbsorbed } = absorbRepeatedContent(chatHistory);

        // ---- 重组 ----
        const finalMessages = [];
        finalMessages.push({ role: 'system', content: CacheState.staticCore });
        finalMessages.push(...CacheState.absorbedMessages);
        finalMessages.push(...cleanedChat);
        finalMessages.push(...prefills);

        const currentSnapshot = capturePrefixSnapshot(CacheState.staticCore, CacheState.absorbedMessages);
        
        if (Logger._logLevel >= LOG_LEVELS.NORMAL) {
            const diffReport = comparePrefixSnapshots(CacheState.lastPrefixSnapshot, currentSnapshot);
            Logger.log(`前缀差异对比:\n${diffReport}`);
        }
        
        const cacheHit = (CacheState.lastPrefixSnapshot && 
                          CacheState.lastPrefixSnapshot.systemHash === currentSnapshot.systemHash &&
                          CacheState.lastPrefixSnapshot.absorbedHashes.join(',') === currentSnapshot.absorbedHashes.join(','));
        
        if (cacheHit) {
            CacheState.stats.hits++;
            const totalTokens = finalMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
            const savedThisRound = currentSnapshot.totalPrefixTokens;
            CacheState.stats.savedTokens += savedThisRound;
            const newTokens = totalTokens - savedThisRound;
            Logger.log(`✅ 缓存命中！前缀tokens: ${savedThisRound}, 新增计算: ~${newTokens} tokens`);
        } else {
            Logger.warn('⚠️ 前缀发生变化，缓存部分未命中（新前缀将在下一轮完全命中）');
        }
        
        CacheState.lastPrefixSnapshot = currentSnapshot;
        CacheState.stats.prefixTokens = currentSnapshot.totalPrefixTokens;

        data.chat.splice(0, data.chat.length, ...finalMessages);
        
        Logger.debug(`重组后消息列表: [${finalMessages.map((m,i)=>`#${i+1} ${m.role} (${estimateTokens(m.content)}t)`).join(', ')}]`);
        
        updateStatsUI();

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

// ==========================================
// 模块 8：UI 与统计
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
                <b>🧠 DS V4 Cache Optimizer v3.2</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px; display: flex; flex-direction: column; gap: 8px;">
                <p style="font-size:0.9em;opacity:0.8;margin:0;">智能吸收重复内容，最大化缓存命中</p>
                <div id="ds-cache-stats" style="font-size:0.85em;"></div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <label class="checkbox_label" style="display:flex;align-items:center;gap:4px;">
                        <input type="checkbox" id="ds-cache-enable" checked> 启用
                    </label>
                    <select id="ds-cache-log-level" style="padding:2px 5px; background: var(--SmartThemeBodyColor, #1a1a2e); color: var(--SmartThemeFontColor, #fff); border:1px solid var(--SmartThemeBorderColor, #555);">
                        <option value="2" ${currentLogLevel===2?'selected':''}>详细日志</option>
                        <option value="1" ${currentLogLevel===1?'selected':''}>简要日志</option>
                        <option value="0" ${currentLogLevel===0?'selected':''}>关闭日志</option>
                    </select>
                    <button id="ds-cache-reset" class="menu_button" style="padding:2px 10px;">🔄 强制重置</button>
                </div>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:180px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');
        
        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`状态: ${CacheState.enabled ? '启用' : '停用'}`);
        });
        $('#ds-cache-log-level').on('change', function() {
            const val = parseInt($(this).val());
            currentLogLevel = val;
            Logger.setLevel(val);
            Logger.log(`日志等级切换至: ${val===2?'详细':val===1?'简要':'关闭'}`);
        });
        $('#ds-cache-reset').on('click', () => {
            CacheState.staticCore = null;
            CacheState.absorbedMessages = [];
            CacheState.knownFloatsContent.clear();
            CacheState.lastChatSnapshot.clear();
            CacheState.lastPrefixSnapshot = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateStatsUI();
            Logger.warn('已完全重置');
        });
        
        // 初始化日志等级
        Logger.setLevel(currentLogLevel);
        updateStatsUI();
        Logger.log('v3.2 UI 就绪');
    } catch (e) {
        Logger.error('UI初始化失败', e);
    }
}

// ==========================================
// 模块 9：启动
// ==========================================
jQuery(async () => {
    console.log('DS V4 Optimizer v3.2 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('已挂载事件钩子');
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v3.2 就绪，智能吸收 + 日志分级 ══════');
});
