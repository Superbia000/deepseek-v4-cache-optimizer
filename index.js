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
// 状态机（预填充永久冻结）
// ==========================================
const CacheState = {
    enabled: true,
    frozenBackground: [],
    frozenTurns: [],          // { user, prefills, assistant }
    extraBackground: [],
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
};

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
        if (msg.role === 'user') cls = { isRealUser: true, isRealAI: false, isInstructional: false };
        else if (msg.role === 'assistant') cls = { isRealUser: false, isRealAI: true, isInstructional: false };
        else cls = { isRealUser: false, isRealAI: false, isInstructional: true };
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
    };
}

// ==========================================
// 处理请求流（不切割预填充）
// ==========================================
function processStream(stream, originalChat) {
    const allMessages = stream.map(msg => {
        const cls = classifyMessage(msg, originalChat);
        return createMessageObj(msg, cls);
    });

    if (logLevel >= LogLevels.DEBUG) {
        Logger.log(`[流分割] 总消息: ${allMessages.length} 条`, LogLevels.DEBUG);
    }

    const backgroundCandidates = [];
    const dialogueParts = [];

    for (const obj of allMessages) {
        if (obj.isInstructional) {
            backgroundCandidates.push(obj);
        } else {
            dialogueParts.push(obj);
        }
    }

    // 找到当前用户消息索引（最后一个真实 user）
    let currentUserIndex = -1;
    for (let i = dialogueParts.length - 1; i >= 0; i--) {
        if (dialogueParts[i].isRealUser && dialogueParts[i].role === 'user') {
            currentUserIndex = i;
            break;
        }
    }

    return { dialogueParts, backgroundCandidates, currentUserIndex };
}

// ==========================================
// 构建对话轮次（预填充独立，不合并）
// ==========================================
function buildTurns(dialogueParts, currentUserIndex) {
    const turns = [];
    let cur = { user: null, assistants: [] };

    for (let i = 0; i < dialogueParts.length; i++) {
        const obj = dialogueParts[i];

        if (obj.isRealUser && obj.role === 'user') {
            // 结束前一轮（不含当前轮次）
            if (cur.user && cur.assistants.length > 0) {
                // 历史轮次：最后一个 assistant 是 AI 回复，之前的都是预填充？
                // 但历史轮次不应该有预填充，它们应该只有一条 AI 回复（长文）
                // 实际上历史轮次中可能有多条 assistant，这可能是合并失败导致的，我们全部合并为一条 AI 回复
                turns.push({
                    user: cur.user,
                    prefills: [],  // 历史轮次无预填充
                    assistant: combineAssistants(cur.assistants),
                });
            } else if (cur.user && cur.assistants.length === 0) {
                // 有用户消息但没有助手消息，忽略（通常不会发生）
            }
            cur = { user: obj, assistants: [] };
        } else if (obj.isRealAI && obj.role === 'assistant') {
            cur.assistants.push(obj);
        }
    }

    // 处理最后一轮（当前轮次）
    if (cur.user) {
        if (cur.assistants.length > 0) {
            // 当前轮次：最后一个 assistant 为 AI 回复，之前的为预填充
            const lastAssistant = cur.assistants[cur.assistants.length - 1];
            const prefills = cur.assistants.slice(0, -1);
            turns.push({
                user: cur.user,
                prefills: prefills,
                assistant: lastAssistant,
            });
        } else {
            // 只有用户消息，没有助手（可能没有预填充）
            turns.push({
                user: cur.user,
                prefills: [],
                assistant: null,
            });
        }
    }

    if (logLevel >= LogLevels.DEBUG) {
        turns.forEach((t, idx) => {
            Logger.log(`[构建轮次 ${idx}] 用户:${t.user.content.substring(0,20)}... 预填充:${t.prefills.length} 助手:${t.assistant ? t.assistant.content.substring(0,20) : '无'}`, LogLevels.DEBUG);
        });
    }

    return turns;
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

        const { dialogueParts, backgroundCandidates, currentUserIndex } =
            processStream(stream, originalChat);

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

        // 构建所有轮次
        const allTurns = buildTurns(dialogueParts, currentUserIndex);
        const currentTurn = allTurns[allTurns.length - 1];
        const historyTurns = allTurns.slice(0, -1);

        const currentUserMsg = currentTurn.user;
        let currentPrefills = currentTurn.prefills || [];
        const currentAssistant = currentTurn.assistant || null;

        // 初始化
        if (CacheState.frozenBackground.length === 0 && CacheState.frozenTurns.length === 0) {
            CacheState.frozenBackground = dedupBg;
            CacheState.frozenTurns = historyTurns;
            Logger.log(`[初始化] 背景:${dedupBg.length} 对话轮次:${historyTurns.length}`, LogLevels.BASIC);
            applyFinalSequence(stream, currentUserMsg, currentPrefills, currentAssistant);
            updateStats(true);
            return;
        }

        // --- 背景相似度 ---
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
            CacheState.frozenTurns = historyTurns;
            applyFinalSequence(stream, currentUserMsg, currentPrefills, currentAssistant);
            updateStats(true);
            return;
        }

        // --- 新增背景 ---
        const newBg = dedupBg.filter(m => !frozenBgNorms.has(m.norm));
        for (const m of newBg) {
            if (!CacheState.extraBackground.some(ex => ex.norm === m.norm)) {
                CacheState.extraBackground.push(m);
            }
        }
        if (newBg.length > 0) Logger.warn(`[新增背景] +${newBg.length} 条`, LogLevels.DETAILED);

        // --- 对话轮次自適應更新 ---
        const frozenTurnKeys = new Set(
            CacheState.frozenTurns.map(t => `${t.user.uid}|${t.assistant ? t.assistant.uid : ''}`)
        );
        const newHistoryTurns = historyTurns.filter(t => {
            const key = `${t.user.uid}|${t.assistant ? t.assistant.uid : ''}`;
            return !frozenTurnKeys.has(key);
        });

        const removedTurns = CacheState.frozenTurns.filter(t => {
            const key = `${t.user.uid}|${t.assistant ? t.assistant.uid : ''}`;
            return !historyTurns.some(ht => `${ht.user.uid}|${ht.assistant ? ht.assistant.uid : ''}` === key);
        });

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
                CacheState.frozenTurns = historyTurns;
                applyFinalSequence(stream, currentUserMsg, currentPrefills, currentAssistant);
                updateStats(true);
                return;
            } else {
                CacheState.frozenTurns = CacheState.frozenTurns.filter(t => {
                    const key = `${t.user.uid}|${t.assistant ? t.assistant.uid : ''}`;
                    return historyTurns.some(ht => `${ht.user.uid}|${ht.assistant ? ht.assistant.uid : ''}` === key);
                });
                if (typeof toastr !== 'undefined') toastr.info(`已自动适配：移除 ${removedTurns.length} 个被删除的对话轮次，缓存命中率可能轻微下降。`);
            }
        }

        // 加入新的历史轮次
        if (newHistoryTurns.length > 0) {
            Logger.warn(`[对话增量] +${newHistoryTurns.length} 轮`, LogLevels.DETAILED);
            CacheState.frozenTurns.push(...newHistoryTurns);
        }

        applyFinalSequence(stream, currentUserMsg, currentPrefills, currentAssistant);
        updateStats(false);

    } catch (err) {
        Logger.error('拦截器致命错误', err);
        throw err;
    }
}

// ==========================================
// 最终序列应用
// ==========================================
function applyFinalSequence(stream, currentUserMsg, currentPrefills, currentAssistant) {
    const final = [];

    // 1. 冻结背景
    for (const bg of CacheState.frozenBackground) {
        final.push({ role: bg.role, content: bg.content });
    }

    // 2. 冻结的对话轮次（使用者 → 预填充 → AI 回覆）
    for (const turn of CacheState.frozenTurns) {
        final.push({ role: turn.user.role, content: turn.user.content });
        if (turn.prefills && turn.prefills.length > 0) {
            for (const p of turn.prefills) {
                final.push({ role: p.role, content: p.content });
            }
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
    for (const p of currentPrefills) {
        final.push({ role: p.role, content: p.content });
    }

    // 6. 当前 AI 回复（如果有）
    if (currentAssistant) {
        final.push({ role: currentAssistant.role, content: currentAssistant.content });
    }

    if (logLevel >= LogLevels.DEBUG) {
        Logger.log(`[最终序列] 冻结背景:${CacheState.frozenBackground.length} 冻结轮次:${CacheState.frozenTurns.length} 新增背景:${CacheState.extraBackground.length} 用户:1 预填充:${currentPrefills.length}`, LogLevels.DEBUG);
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
        for (const p of (t.prefills || [])) turnTokens += Logger.estimateTokens(p.content);
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
// UI 初始化 + ST菜单项
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
    Logger.log('══════ v6.4 就绪，预填充独立冻结 + 自适应删除 ══════', LogLevels.BASIC);
});
