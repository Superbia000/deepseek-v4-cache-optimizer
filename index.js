import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志系统
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };
let logLevel = 2;

function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const fullMsg = `[${time}] ${msg}`;
    if (type === 'warn') {
        console.warn(`%c[DS Cache v6.4] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS Cache v6.4] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS Cache v6.4] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
    simpleHash: (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
    },
    estimateTokens: (text) => {
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
    },
    normalize: (text) => text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
};

// ==========================================
// 状态机
// ==========================================
const CacheState = {
    enabled: true,
    frozenBackground: [],   // 冻结背景（逐条，去重）
    frozenTurns: [],        // 冻结对话轮次 [{ user, prefill, assistant }]
    extraBackground: [],    // 新增背景
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
};

const PREFILL_TOKEN_THRESHOLD = 150;  // 预填充最大 token 数

// ==========================================
// 消息分类
// ==========================================
function classifyMessage(msg, originalChat) {
    const normContent = Logger.normalize(msg.content);
    const orig = originalChat.find(m => {
        if (m.mes === msg.content) return true;
        return Logger.normalize(m.mes) === normContent;
    });
    let cls;
    if (orig) {
        if (orig.is_user) cls = { isRealUser: true, isRealAI: false, isInstructional: false };
        else if (!orig.is_system) {
            if (msg.role === 'assistant') cls = { isRealUser: false, isRealAI: true, isInstructional: false };
            else cls = { isRealUser: false, isRealAI: false, isInstructional: true };
        } else {
            cls = { isRealUser: false, isRealAI: false, isInstructional: true };
        }
    } else {
        if (msg.role === 'user') {
            cls = { isRealUser: true, isRealAI: false, isInstructional: false };
        } else if (msg.role === 'assistant') {
            cls = { isRealUser: false, isRealAI: true, isInstructional: false };
        } else {
            cls = { isRealUser: false, isRealAI: false, isInstructional: true };
        }
    }
    if (logLevel >= LogLevels.DEBUG) {
        const label = cls.isRealUser ? '👤真实用户' : (cls.isRealAI ? '🤖真实AI' : '📋教学/系统');
        Logger.log(`[分类] ${label} | ${msg.role}: ${msg.content.substring(0, 30)}...`, LogLevels.DEBUG);
    }
    return cls;
}

function createMessageObj(msg, cls, uid) {
    return {
        role: msg.role,
        content: msg.content,
        isRealUser: cls.isRealUser,
        isRealAI: cls.isRealAI,
        isInstructional: cls.isInstructional,
        uid: uid || `${msg.role}:${Logger.simpleHash(msg.content)}`,
        norm: Logger.normalize(msg.content),
        tokens: Logger.estimateTokens(msg.content),
    };
}

// ==========================================
// 新：解析对话轮次（区分预填充）
// ==========================================
function parseDialogue(stream, originalChat) {
    const bgCandidates = [];
    const turns = [];          // [{ user, prefill, assistant }]
    let pendingUser = null;
    let pendingPrefill = null;
    let pendingAssistants = [];

    for (const msg of stream) {
        const cls = classifyMessage(msg, originalChat);
        const obj = createMessageObj(msg, cls);
        if (obj.isInstructional) {
            bgCandidates.push(obj);
            continue;
        }

        if (obj.isRealUser && obj.role === 'user') {
            // 保存上一轮
            if (pendingUser) {
                turns.push({
                    user: pendingUser,
                    prefill: pendingPrefill,
                    assistant: pendingAssistants.length > 0
                        ? combineAssistants(pendingAssistants) : null,
                });
            }
            pendingUser = obj;
            pendingPrefill = null;
            pendingAssistants = [];
        } else if (obj.isRealAI && obj.role === 'assistant') {
            if (pendingUser && !pendingPrefill && obj.tokens <= PREFILL_TOKEN_THRESHOLD) {
                // 把这条当作预填充
                pendingPrefill = obj;
            } else {
                pendingAssistants.push(obj);
            }
        }
    }
    // 处理最后一轮（当前请求）
    if (pendingUser) {
        turns.push({
            user: pendingUser,
            prefill: pendingPrefill,
            assistant: pendingAssistants.length > 0 ? combineAssistants(pendingAssistants) : null,
        });
    }

    // 提取当前用户消息（最后一轮的用户）
    const currentTurn = turns.length > 0 ? turns[turns.length - 1] : null;
    const currentUserMsg = currentTurn ? currentTurn.user : null;
    const currentPrefill = currentTurn ? currentTurn.prefill : null;

    // 历史轮次（去掉当前轮次）
    const historyTurns = currentUserMsg ? turns.slice(0, -1) : turns;

    return {
        backgroundCandidates: bgCandidates,
        historyTurns,
        currentUserMsg,
        currentPrefill,
    };
}

function combineAssistants(msgs) {
    if (msgs.length === 0) return null;
    const combinedContent = msgs.map(m => m.content).join('\n');
    return createMessageObj(
        { role: 'assistant', content: combinedContent },
        { isRealUser: false, isRealAI: true, isInstructional: false },
        msgs[0].uid
    );
}

// ==========================================
// 核心拦截器
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`[请求 #${CacheState.stats.total}] 开始处理...`);

        if (!data?.chat?.length) return;
        const stream = data.chat;
        const context = getContext();
        const originalChat = context?.chat ?? [];

        const { backgroundCandidates, historyTurns, currentUserMsg, currentPrefill } =
            parseDialogue(stream, originalChat);

        // 背景去重
        const seenBg = new Set();
        const dedupBg = [];
        for (const m of backgroundCandidates) {
            if (!seenBg.has(m.norm)) {
                seenBg.add(m.norm);
                dedupBg.push(m);
            } else {
                Logger.log(`[背景去重] 跳过: ${m.content.substring(0, 40)}...`, LogLevels.DEBUG);
            }
        }

        // ---------- 初始化 ----------
        if (CacheState.frozenBackground.length === 0 && CacheState.frozenTurns.length === 0) {
            CacheState.frozenBackground = dedupBg;
            CacheState.frozenTurns = historyTurns.concat(currentUserMsg ? [{
                user: currentUserMsg,
                prefill: currentPrefill,
                assistant: null,
            }] : []);
            Logger.log(`[初始化] 背景:${dedupBg.length} 对话轮次:${CacheState.frozenTurns.length}`, LogLevels.BASIC);
            applyFinalSequence(stream, currentUserMsg, currentPrefill);
            updateStats(true);
            return;
        }

        // ---------- 背景相似度 ----------
        const frozenBgNorms = new Set(CacheState.frozenBackground.map(m => m.norm));
        const currentBgNorms = new Set(dedupBg.map(m => m.norm));
        const bgSimilarity = computeSetSimilarity(frozenBgNorms, currentBgNorms);
        Logger.log(`[背景相似度] ${(bgSimilarity * 100).toFixed(1)}%`, LogLevels.DEBUG);

        if (bgSimilarity < 0.9) {
            const ok = confirm(
                '检测到系统提示词核心变动（更换角色卡/预设），建议重置缓存前缀以保证性能。\n\n' +
                '按「确定」重置前缀并发送消息；按「取消」放弃本次发送。'
            );
            if (!ok) {
                if (typeof toastr !== 'undefined') toastr.warning('发送已取消');
                throw new Error('User cancelled send due to cache prefix change');
            }
            Logger.warn('[用户选择重置] 因背景变动，重置所有缓存', LogLevels.BASIC);
            performReset();
            CacheState.frozenBackground = dedupBg;
            CacheState.frozenTurns = historyTurns.concat(currentUserMsg ? [{
                user: currentUserMsg,
                prefill: currentPrefill,
                assistant: null,
            }] : []);
            applyFinalSequence(stream, currentUserMsg, currentPrefill);
            updateStats(true);
            return;
        }

        // ---------- 新增背景 ----------
        const newBg = dedupBg.filter(m => !frozenBgNorms.has(m.norm));
        for (const m of newBg) {
            if (!CacheState.extraBackground.some(ex => ex.norm === m.norm)) {
                CacheState.extraBackground.push(m);
            }
        }
        if (newBg.length > 0) Logger.warn(`[新增背景] +${newBg.length} 条`, LogLevels.DETAILED);

        // ---------- 对话轮次自適應 ----------
        const frozenTurnKeys = CacheState.frozenTurns.map(t => t.user.uid);
        const newTurns = historyTurns.filter(t => !frozenTurnKeys.includes(t.user.uid));
        const removedTurns = CacheState.frozenTurns.filter(t => !historyTurns.some(ht => ht.user.uid === t.user.uid));

        if (removedTurns.length > 0) {
            Logger.warn(`[检测到删除轮次] -${removedTurns.length} 轮`, LogLevels.DETAILED);
            if (historyTurns.length < CacheState.frozenTurns.length * 0.7) {
                const ok = confirm(
                    `对话历史被大幅删除（剩余 ${historyTurns.length}/${CacheState.frozenTurns.length} 轮），缓存命中率将严重下降。\n\n` +
                    '按「确定」重置前缀并发送；按「取消」放弃本次发送。'
                );
                if (!ok) {
                    if (typeof toastr !== 'undefined') toastr.warning('发送已取消');
                    throw new Error('User cancelled send due to heavy dialogue deletion');
                }
                Logger.warn('[用户选择重置] 因重度删除，重置所有缓存', LogLevels.BASIC);
                performReset();
                CacheState.frozenBackground = dedupBg;
                CacheState.frozenTurns = historyTurns.concat(currentUserMsg ? [{
                    user: currentUserMsg,
                    prefill: currentPrefill,
                    assistant: null,
                }] : []);
                applyFinalSequence(stream, currentUserMsg, currentPrefill);
                updateStats(true);
                return;
            } else {
                CacheState.frozenTurns = CacheState.frozenTurns.filter(t => historyTurns.some(ht => ht.user.uid === t.user.uid));
                if (typeof toastr !== 'undefined') toastr.info(`已自动适配：移除 ${removedTurns.length} 个被删除的对话轮次，缓存命中率可能轻微下降。`);
            }
        }

        if (newTurns.length > 0) {
            Logger.warn(`[对话增量] +${newTurns.length} 轮`, LogLevels.DETAILED);
            CacheState.frozenTurns.push(...newTurns);
        }

        applyFinalSequence(stream, currentUserMsg, currentPrefill);
        updateStats(false);

    } catch (err) {
        Logger.error('拦截器致命错误', err);
        throw err;
    }
}

// ==========================================
// 最终序列应用
// ==========================================
function applyFinalSequence(stream, currentUserMsg, currentPrefill) {
    const final = [];

    // 1. 冻结背景
    for (const bg of CacheState.frozenBackground) {
        final.push({ role: bg.role, content: bg.content });
    }

    // 2. 冻结对话轮次
    for (const turn of CacheState.frozenTurns) {
        final.push({ role: turn.user.role, content: turn.user.content });
        if (turn.prefill) {
            final.push({ role: turn.prefill.role, content: turn.prefill.content });
        }
        if (turn.assistant) {
            final.push({ role: turn.assistant.role, content: turn.assistant.content });
        }
    }

    // 3. 新增背景
    for (const extra of CacheState.extraBackground) {
        final.push({ role: extra.role, content: extra.content });
    }

    // 4. 当前用户输入
    if (currentUserMsg) {
        final.push({ role: currentUserMsg.role, content: currentUserMsg.content });
    }

    // 5. 当前预填充
    if (currentPrefill) {
        final.push({ role: currentPrefill.role, content: currentPrefill.content });
    }

    if (logLevel >= LogLevels.DEBUG) {
        Logger.log(`[最终序列] 冻结背景:${CacheState.frozenBackground.length} 冻结轮次:${CacheState.frozenTurns.length} 新增背景:${CacheState.extraBackground.length} 用户:${currentUserMsg?1:0} 预填充:${currentPrefill?1:0}`, LogLevels.DEBUG);
        final.forEach((m, i) => Logger.log(`  ${i}: [${m.role}] ${m.content.substring(0, 40)}...`, LogLevels.DEBUG));
    }

    stream.splice(0, stream.length, ...final);
}

// ==========================================
// 工具函数
// ==========================================
function computeSetSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1;
    const union = new Set([...setA, ...setB]);
    let intersection = 0;
    for (const item of setA) if (setB.has(item)) intersection++;
    return union.size === 0 ? 1 : intersection / union.size;
}

function updateStats(isInit = false) {
    let bgTokens = 0;
    for (const m of CacheState.frozenBackground) bgTokens += Logger.estimateTokens(m.content);
    for (const m of CacheState.extraBackground) bgTokens += Logger.estimateTokens(m.content);
    let turnTokens = 0;
    for (const t of CacheState.frozenTurns) {
        turnTokens += Logger.estimateTokens(t.user.content);
        if (t.prefill) turnTokens += Logger.estimateTokens(t.prefill.content);
        if (t.assistant) turnTokens += Logger.estimateTokens(t.assistant.content);
    }
    CacheState.stats.prefixTokens = bgTokens + turnTokens;
    CacheState.stats.hits++;
    CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
    updateStatsUI();
}

function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `
        <span>命中: ${hits}/${total} (${rate}%)</span>
        <span style="margin-left:10px;">前缀: ~${prefixTokens.toLocaleString()}t</span>
        <span style="margin-left:10px;">节省: ~${savedTokens.toLocaleString()}t</span>
    `;
}

function performReset() {
    CacheState.frozenBackground = [];
    CacheState.frozenTurns = [];
    CacheState.extraBackground = [];
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    updateStatsUI();
    Logger.warn('[重置] 所有缓存已清空', LogLevels.BASIC);
}

// ==========================================
// UI 初始化
// ==========================================
async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Deepseek 缓存命中优化</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">背景/对话分离，绝对稳定前缀，弹窗+菜单重置。</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;"></div>
                <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" checked> 启用</label>
                <div style="margin:8px 0;">
                    <span style="font-size:0.9em;">日志等级:</span>
                    <select id="ds-cache-loglevel">
                        <option value="0">关闭</option><option value="1">简要</option>
                        <option value="2" selected>详细</option><option value="3">调试</option>
                    </select>
                </div>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:5px 0;">🔄 强制重置缓存前缀</button>
                <button id="ds-cache-clearlog" class="menu_button" style="width:100%;margin:5px 0;">🗑️ 清空日志</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');

        $('#ds-cache-enable').on('change', function () {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`插件 ${CacheState.enabled ? '启用' : '停用'}`, LogLevels.BASIC);
        });
        $('#ds-cache-loglevel').on('change', function () {
            logLevel = parseInt($(this).val());
            Logger.log(`日志等级: ${['关闭', '简要', '详细', '调试'][logLevel]}`, LogLevels.BASIC);
        });
        $('#ds-cache-reset').on('click', () => performReset());
        $('#ds-cache-clearlog').on('click', () => {
            if (Logger._uiTextarea) Logger._uiTextarea.value = '';
        });

        if (typeof extension_settings !== 'undefined') {
            extension_settings['ds-cache'] = extension_settings['ds-cache'] || {};
            extension_settings['ds-cache'].extensionsMenu = [
                { label: '重置DS缓存前缀', action: () => performReset() }
            ];
        }

        updateStatsUI();
    } catch (e) {
        Logger.error('UI初始化失败', e);
    }
}

function registerMenuItems() {
    if (typeof extension_settings !== 'undefined') {
        extension_settings['ds-cache'] = extension_settings['ds-cache'] || {};
        extension_settings['ds-cache'].extensionsMenu = extension_settings['ds-cache'].extensionsMenu || [];
        if (!extension_settings['ds-cache'].extensionsMenu.find(m => m.label === '重置DS缓存前缀')) {
            extension_settings['ds-cache'].extensionsMenu.push({
                label: '重置DS缓存前缀',
                action: () => performReset(),
            });
        }
    }
}

// ==========================================
// 启动
// ==========================================
jQuery(async () => {
    await setupUI();
    registerMenuItems();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 钩子已挂载', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v6.4 就绪，预填充智能识别 + 自适应删除 ══════', LogLevels.BASIC);
});
