import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志 & 工具函数
// ==========================================
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
        if (type === 'error') console.error('[DS V4 Opt v5.1]', text);
        else if (type === 'warn') console.warn('[DS V4 Opt v5.1]', text);
        else console.log('%c[DS V4 Opt v5.1]', 'color:#00ff00;font-weight:bold', text);
    }
};
function append(type, msg) { Logger._appendLine(type, msg); }

let logLevel = 2;

// 简单 hash
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

// Token 估算
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

// 标准化指纹（消除空格和标点差异）
function normalize(text) {
    return text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
        .replace(/[，。！？、；：]/g, m => ({'，':',','。':'.','！':'!','？':'?','、':',','；':';','：':':'})[m] || m).trim();
}

// ==========================================
// 缓存状态机
// ==========================================
const CacheState = {
    enabled: true,
    stableSequence: null,       // 已稳定的完整消息序列
    lastSystemSeq: null,        // 上次系统提示词组（不含世界书）
    lastWorldSeq: null,         // 上次世界书条目组
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// ==========================================
// 从上下文获取当前激活的世界书条目（标准化后的内容）
// ==========================================
function getActiveWorldEntries() {
    const ctx = getContext();
    if (!ctx || !ctx.worldInfo) return [];
    const entries = ctx.worldInfo.entries || [];
    // 只保留启用的条目，返回标准化后的内容数组
    return entries.filter(e => !e.disable).map(e => normalize(e.content || '')).filter(c => c.length > 0);
}

// 判断一条消息是否是世界书条目（与激活列表中的任一匹配）
function isWorldEntry(content, activeWorldEntries) {
    const norm = normalize(content);
    return activeWorldEntries.some(entry => entry === norm);
}

// ==========================================
// 核心拦截与重组
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`====== [请求 #${CacheState.stats.total}] ======`, 2);

        const original = data.chat;
        if (!original || !original.length) return;

        const ctx = getContext();
        const activeWorldEntries = getActiveWorldEntries(); // 标准化后的世界书内容数组

        // ---------- 1. 提取并分类消息 ----------
        // 先剥离末尾的预填充（连续 assistant）
        const messages = [...original];
        const prefills = [];
        while (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
            prefills.unshift(messages.pop());
        }

        // 找到当前用户输入（最后一条 user 消息）
        let currentUserInput = null;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
                currentUserInput = messages.splice(i, 1)[0];
                break;
            }
        }
        if (!currentUserInput) {
            // 没有当前输入（极端情况），无法处理
            return;
        }

        // 剩余 messages 分为: 系统/世界书 和 历史对话（user/assistant）
        const remaining = messages;
        const systemGroup = [];   // 预设提示词 + 其他提示词
        const worldGroup = [];    // 世界书条目
        const history = [];       // 对话历史 (user/assistant)

        for (const msg of remaining) {
            if (msg.role === 'system') {
                // 判断是世界书还是系统提示词
                if (isWorldEntry(msg.content, activeWorldEntries)) {
                    worldGroup.push(msg);
                } else {
                    systemGroup.push(msg);
                }
            } else {
                // user 或 assistant 都归为对话历史
                history.push(msg);
            }
        }

        // 世界书条目需要保持它们在原始数据中出现的顺序（与激活顺序可能不同，但这样更忠实）
        // systemGroup 已经保持了原始顺序

        // ---------- 2. 状态初始化或重置检测 ----------
        // 生成当前系统/世界书的指纹
        const currentSystemFingerprint = systemGroup.map(m => simpleHash(normalize(m.content))).join('|');
        const currentWorldFingerprint = worldGroup.map(m => simpleHash(normalize(m.content))).join('|');

        if (!CacheState.stableSequence) {
            // 首次或重置后，构建稳定序列：系统组 + 世界书组 + 当前历史对话 + 当前用户输入
            const initSeq = [...systemGroup, ...worldGroup, ...history, currentUserInput];
            CacheState.stableSequence = initSeq;
            CacheState.lastSystemSeq = { seq: systemGroup, fp: currentSystemFingerprint };
            CacheState.lastWorldSeq = { seq: worldGroup, fp: currentWorldFingerprint };
            Logger.log(`[初始化] 稳定序列已锁定，共 ${initSeq.length} 条消息`, 2);
            // 发送：稳定序列 + 预填充
            const finalMessages = [...initSeq, ...prefills];
            data.chat.splice(0, data.chat.length, ...finalMessages);
            updateStats(true, initSeq);
            return;
        }

        // 已存在 stableSequence，检查 core 是否有变化
        const lastSysFp = CacheState.lastSystemSeq.fp;
        const lastWorldFp = CacheState.lastWorldSeq.fp;

        // 如果系统提示词组或世界书条目组发生了非追加性变化（修改/删除/乱序），则重置
        if (currentSystemFingerprint !== lastSysFp || currentWorldFingerprint !== lastWorldFp) {
            // 进一步判断是否为“纯追加”（即在原有序列末尾增加新条目）
            const isSystemAppend = currentSystemFingerprint.startsWith(lastSysFp) && 
                currentSystemFingerprint.substring(lastSysFp.length).startsWith('|');
            const isWorldAppend = currentWorldFingerprint.startsWith(lastWorldFp) && 
                currentWorldFingerprint.substring(lastWorldFp.length).startsWith('|');

            if (!isSystemAppend || !isWorldAppend) {
                Logger.warn('[核心重置] 检测到预设/世界书条目被修改或删除，将重置稳定序列', 1);
                if (typeof toastr !== 'undefined') toastr.warning('检测到提示词核心内容发生变化，缓存前缀已自动重置。', '缓存优化器');
                CacheState.stableSequence = null;
                CacheState.lastSystemSeq = null;
                CacheState.lastWorldSeq = null;
                CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
                interceptAndRestructurePrompt(data); // 重新初始化
                return;
            } else {
                // 纯追加，更新系统/世界书组，并通知
                if (isSystemAppend) {
                    const newSystemEntries = systemGroup.slice(CacheState.lastSystemSeq.seq.length);
                    Logger.warn(`[增量追加] 新增 ${newSystemEntries.length} 条系统提示词，追加到序列末尾`, 2);
                }
                if (isWorldAppend) {
                    const newWorldEntries = worldGroup.slice(CacheState.lastWorldSeq.seq.length);
                    Logger.warn(`[增量追加] 新增 ${newWorldEntries.length} 条世界书条目，追加到序列末尾`, 2);
                }
                // 更新记录
                CacheState.lastSystemSeq = { seq: systemGroup, fp: currentSystemFingerprint };
                CacheState.lastWorldSeq = { seq: worldGroup, fp: currentWorldFingerprint };
            }
        }

        // ---------- 3. 构建最终发送序列 ----------
        // stableSequence 应包含所有已完成的对话（即上一轮及之前的所有消息，但不包含本次新增的历史对话）
        // 我们需要将 stableSequence 与 current history 比较，找出新增的对话轮次
        // 简单处理：将 history 中 stableSequence 未包含的部分追加到 stableSequence 中（因为 stableSequence 可能已经包含了之前的对话）
        // 实际上，stableSequence 是在上一轮发送后更新的，所以它应该等于上一轮的完整发送消息（不含预填充）。
        // 本次的 history 应包含上一轮的全部对话 + 可能新增的中间轮次（如果用户删除了某些消息又会怎样？）
        // 为了可靠，我们比较 stableSequence 最后一条消息与 history 的第一条消息，如果不匹配视为剧烈变动，触发重置。
        // 否则，找到需要追加的新增轮次。

        const lastStable = CacheState.stableSequence;
        // 查找 history 中与 stableSequence 共同的前缀长度
        let prefixLen = 0;
        for (let i = 0; i < lastStable.length && i < history.length; i++) {
            if (lastStable[i].role === history[i].role && normalize(lastStable[i].content) === normalize(history[i].content)) {
                prefixLen++;
            } else {
                break;
            }
        }

        if (prefixLen < lastStable.length) {
            // 历史前缀不匹配，说明用户删除了早期历史，触发重置
            Logger.warn('[核心重置] 检测到对话历史被修改或删除，将重置稳定序列', 1);
            if (typeof toastr !== 'undefined') toastr.warning('对话历史发生变化，缓存前缀已自动重置。', '缓存优化器');
            CacheState.stableSequence = null;
            CacheState.lastSystemSeq = null;
            CacheState.lastWorldSeq = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            interceptAndRestructurePrompt(data);
            return;
        }

        // 追加新完成的对话轮次（history 中多出的部分）
        const newHistory = history.slice(prefixLen);
        if (newHistory.length > 0) {
            CacheState.stableSequence.push(...newHistory);
        }

        // 构建最终发送数组：stableSequence（不含当前输入） + 当前用户输入 + 预填充
        // 注意 stableSequence 已经包含了上一次的用户输入和 AI 回复，所以这次我们要发送的完整序列应该是
        // [系统组, 世界书组, 历史(不含当前输入), 当前用户输入, 预填充]
        // 我们可以简单使用：stableSequence (已含所有旧对话) + [currentUserInput] + prefills
        const finalSeq = [...CacheState.stableSequence, currentUserInput];
        const finalMessages = [...finalSeq, ...prefills];

        data.chat.splice(0, data.chat.length, ...finalMessages);

        // 更新统计（计算缓存命中）
        const prefixTokens = estimateTokens(CacheState.stableSequence.map(m => m.content).join(''));
        CacheState.stats.prefixTokens = prefixTokens;
        CacheState.stats.hits++;  // 因为前缀没有变化（除新增外，而新增也会成为未来的缓存）
        CacheState.stats.savedTokens += prefixTokens;
        Logger.log(`✅ 缓存命中！稳定前缀 ~${prefixTokens} tokens 完全复用`, 2);
        updateStats(false, CacheState.stableSequence);

    } catch (err) {
        Logger.error('拦截器致命错误', err, 1);
    }
}

// ==========================================
// UI 与统计更新
// ==========================================
function updateStats(isInit, stableSeq) {
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    const el = document.getElementById('ds-cache-stats');
    if (el) {
        el.innerHTML = `命中: ${hits}/${total} (${rate}%) | 前缀: ~${prefixTokens.toLocaleString()}t | 节省: ~${savedTokens.toLocaleString()}t`;
    }
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DS V4 缓存优化器 v5.1 (全自动分类重组)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">自动识别预设/世界书/对话，按指定顺序重组，新增条目追加末尾，实现最高缓存命中。</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;"></div>
                <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" id="ds-cache-enable" checked> 启用自动化缓存优化
                </label>
                <div style="display:flex;align-items:center;gap:8px;margin:8px 0;">
                    <span style="font-size:0.9em;">日志等级:</span>
                    <select id="ds-cache-loglevel">
                        <option value="0">关闭</option>
                        <option value="1">简要</option>
                        <option value="2" selected>详细</option>
                        <option value="3">调试</option>
                    </select>
                </div>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置 (下次请求自动重建)</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');
        $('#ds-cache-enable').on('change', function() { CacheState.enabled = $(this).is(':checked'); });
        $('#ds-cache-loglevel').on('change', function() { logLevel = parseInt($(this).val()); });
        $('#ds-cache-reset').on('click', () => {
            CacheState.stableSequence = null;
            CacheState.lastSystemSeq = null;
            CacheState.lastWorldSeq = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            Logger.warn('已强制重置，下一轮将重新锁定前缀', 1);
            updateStats();
        });
        updateStats();
    } catch (e) { Logger.error('UI初始化失败', e); }
}

// ==========================================
// 启动
// ==========================================
jQuery(async () => {
    console.log('DS V4 Optimizer v5.1 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 已挂载钩子', 2);
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v5.1 就绪，全自动提示词分类 + 绝对锁定前缀 ══════', 2);
});
