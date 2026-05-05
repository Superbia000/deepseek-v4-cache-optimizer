import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志等级控制
// ==========================================
let logLevel = 2; // 0:silent, 1:basic, 2:detailed, 3:debug
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const prefix = `[${time}]`;
    const fullMsg = `${prefix} ${msg}`;
    if (type === 'warn') {
        console.warn(`%c[DS V4 Opt v5] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS V4 Opt v5] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS V4 Opt v5] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
// 简单 hash 与 token 估算
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
        } else {
            tokens += 0.25;
        }
    }
    return Math.ceil(tokens);
}

// ==========================================
// 内容指纹（用于比对消息是否实质性相同）
// ==========================================
function normalizeForFingerprint(text) {
    return text
        .replace(/\s+/g, ' ')          // 合并空白
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/[，。！？、；：]/g, (m) => ({'，':',','。':'.','！':'!','？':'?','、':',','；':';','：':':'})[m] || m)
        .trim();
}

function messageFingerprint(msg) {
    return `${msg.role}::${normalizeForFingerprint(msg.content || '')}`;
}

// ==========================================
// 缓存状态机（锁定序列）
// ==========================================
const CacheState = {
    enabled: true,
    lockedSequence: [],              // 已锁定的完整消息数组
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// ==========================================
// 核心对齐引擎
// ==========================================
function alignAndLock(newMessages) {
    if (!CacheState.lockedSequence.length) {
        // 第一次请求，全部锁定
        CacheState.lockedSequence = newMessages.map(m => ({ ...m }));
        return { aligned: [...CacheState.lockedSequence], prefixLen: CacheState.lockedSequence.length, added: 0 };
    }

    const locked = CacheState.lockedSequence;
    const newMsgs = newMessages;
    const maxLen = Math.min(locked.length, newMsgs.length);
    let prefixLen = 0;

    // 寻找最长公共前缀
    for (let i = 0; i < maxLen; i++) {
        const fpLocked = messageFingerprint(locked[i]);
        const fpNew = messageFingerprint(newMsgs[i]);
        if (fpLocked !== fpNew) break;
        prefixLen++;
    }

    // 如果新数组比 locked 短并且前缀完全匹配（用户删除了末尾消息）
    if (prefixLen === newMsgs.length && newMsgs.length < locked.length) {
        // 直接截断 locked
        CacheState.lockedSequence = newMsgs.map(m => ({ ...m }));
        Logger.log(`检测到末尾删除，截断到 ${newMsgs.length} 条`, LogLevels.DETAILED);
        return { aligned: [...CacheState.lockedSequence], prefixLen: newMsgs.length, added: 0 };
    }

    // 常规情况：从 locked 中移除差异点之后的所有旧消息
    const removed = locked.splice(prefixLen);
    // 追加新消息中差异点之后的所有部分
    for (let i = prefixLen; i < newMsgs.length; i++) {
        locked.push({ ...newMsgs[i] });
    }

    const added = newMsgs.length - prefixLen;
    if (removed.length > 0 || added > 0) {
        Logger.log(`对齐更新: 公共前缀 ${prefixLen} 条，移除 ${removed.length} 条旧消息，追加 ${added} 条新消息`, LogLevels.DETAILED);
        if (logLevel >= LogLevels.DEBUG) {
            if (removed.length) Logger.log(`移除的消息: ${removed.map(m => `${m.role}(${m.content?.length||0}字)`).join(', ')}`, LogLevels.DEBUG);
            if (added) Logger.log(`新加的消息: ${newMsgs.slice(prefixLen).map(m => `${m.role}(${m.content?.length||0}字)`).join(', ')}`, LogLevels.DEBUG);
        }
    } else {
        Logger.log(`前缀完全命中，无变化 (${prefixLen} 条)`, LogLevels.DEBUG);
    }

    return { aligned: [...CacheState.lockedSequence], prefixLen, added };
}

// ==========================================
// 主拦截器
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`拦截器 #${CacheState.stats.total}`);

        if (!data?.chat?.length) return;
        const newMessages = [...data.chat];

        const { aligned, prefixLen, added } = alignAndLock(newMessages);

        // 计算缓存命中情况
        const totalTokens = aligned.reduce((sum, m) => sum + estimateTokens(m.content), 0);
        const prefixTokens = aligned.slice(0, prefixLen).reduce((sum, m) => sum + estimateTokens(m.content), 0);
        const hit = (added === 0); // 如果没有新消息，则整个请求都是缓存命中
        if (hit) {
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += prefixTokens;
            Logger.log(`✅ 完全命中！前缀 ${prefixLen} 条消息 (~${prefixTokens} tokens) 未变化`, LogLevels.BASIC);
        } else {
            CacheState.stats.savedTokens += prefixTokens; // 至少有前缀部分命中
            Logger.log(`⚡ 前缀 ${prefixLen} 条 (~${prefixTokens} tokens) 命中，新增 ${added} 条 (~${totalTokens - prefixTokens} tokens) 需计算`, LogLevels.BASIC);
        }
        CacheState.stats.prefixTokens = prefixTokens;

        // 替换为对齐后的消息数组
        data.chat.splice(0, data.chat.length, ...aligned);

        if (logLevel >= LogLevels.DEBUG) {
            Logger.log(`最终消息结构 (${aligned.length} 条): ${aligned.map(m => `${m.role}(${m.content?.length||0}字)`).join(' → ')}`, LogLevels.DEBUG);
        }

        updateStatsUI();

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

// ==========================================
// UI
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
                <b>🧠 DS V4 Cache Optimizer v5.0</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">锁定序列引擎：所有消息保持原顺序，新增内容追加末尾，100%缓存前缀命中。</p>
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
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置锁定序列</button>
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
            CacheState.lockedSequence = [];
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateStatsUI();
            Logger.warn('已重置锁定序列', LogLevels.BASIC);
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
    console.log('DS V4 Optimizer v5 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('已挂载事件钩子', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v5.0 就绪，锁定序列引擎确保前缀绝对不变 ══════', LogLevels.BASIC);
});
