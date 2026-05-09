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
// 状态机 (预填充独立冻结)
// ==========================================
const CacheState = {
    enabled: true,
    frozenBackground: [],
    frozenTurns: [],          // { user, prefills[], assistant }
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
// 处理请求流 (保留完整消息)
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

    // 找到当前用户消息的索引（最后一个真实 user）
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
// 构建对话轮次 (预填充独立)
// ==========================================
function buildTurns(dialogueParts, currentUserIndex) {
    const turns = [];
    let cur = { user: null, assistants: [] };

    for (let i = 0; i < dialogueParts.length; i++) {
        const obj = dialogueParts[i];

        if (obj.isRealUser && obj.role === 'user') {
            // 结束前一轮
            if (cur.user && cur.assistants.length > 0) {
                // 将 assistants 按序处理：最后一个为 AI 回复，之前的为预填充
                const assistantMsg = cur.assistants[cur.assistants.length - 1];
                const prefillMsgs = cur.assistants.slice(0, -1);
                turns.push({
                    user: cur.user,
                    prefills: prefillMsgs,
                    assistant: assistantMsg,
                });
            }
            cur = { user: obj, assistants: [] };
        } else if (obj.isRealAI && obj.role === 'assistant') {
            cur.assistants.push(obj);
        }

        // 如果到达当前用户消息，且其后还有 assistant，这些 assistant 将全部被视为预填充
        // 它们会被 cur.assistants 收集，并在下一个用户消息出现或循环结束时处理
    }

    // 处理最后一轮 (包含当前用户消息)
    if (cur.user) {
        if (cur.assistants.length > 0) {
            // 所有 assistants 都是预填充（因为后面没有其他用户消息了）
            turns.push({
                user: cur.user,
                prefills: cur.assistants,   // 全部作为预填充
                assistant: null,
            });
        } else {
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

        const allTurns = buildTurns(dialogueParts, currentUserIndex);
        // 分离：历史轮次 (0..len-2) 和当前轮次 (最后一个)
        const currentTurn = allTurns[allTurns.length - 1] || null;
        const historyTurns = allTurns.slice(0, -1);

        // 提取当前用户消息和当前预填充
        const currentUserMsg = currentTurn ? currentTurn.user : null;
        const currentPrefills = currentTurn ? (currentTurn.prefills || []) : [];

        // 初始化
        if (CacheState.frozenBackground.length === 0 && CacheState.frozenTurns.length === 0) {
            CacheState.frozenBackground = dedupBg;
            // 将当前轮次也加入冻结（作为未完成轮次）
            if (currentTurn) {
                CacheState.frozenTurns = [currentTurn];
            }
            Logger.log(`[初始化] 背景:${dedupBg.length} 对话轮次:${CacheState.frozenTurns.length}`, LogLevels.BASIC);
            applyFinalSequence(stream, currentUserMsg, currentPrefills, null);
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
            if (currentTurn) {
                CacheState.frozenTurns = [currentTurn];
            }
            applyFinalSequence(stream, currentUserMsg, currentPrefills, null);
            updateStats(true);
            return;
        }

        // --- 更新冻结轮次：用当前的历史轮次补全之前未完成的轮次 assistant ---
        for (const hTurn of historyTurns) {
            // 查找冻结中对应轮次（通过 user.uid 匹配）
            const existing = CacheState.frozenTurns.find(t => t.user.uid === hTurn.user.uid);
            if (existing) {
                // 如果现有轮次没有 assistant，但历史轮次有，则补全
                if (!existing.assistant && hTurn.assistant) {
                    existing.assistant = hTurn.assistant;
                    Logger.warn(`[补全轮次] 用户:${hTurn.user.content.substring(0,20)} 已补充 assistant`, LogLevels.DETAILED);
                }
                // 如果历史轮次还有预填充而我们没有，也可以补充（但通常预填充只在当前请求）
                // 通常历史轮次中的 prefills 为空，因为预填充只在最后一轮出现
            } else {
                // 冻结中不存在，直接加入
                CacheState.frozenTurns.push(hTurn);
            }
        }

        // 移除冻结中但当前历史轮次中不存在的轮次（自適應删除）
        const currentTurnUids = new Set(historyTurns.map(t => t.user.uid));
        const removedTurns = CacheState.frozenTurns.filter(t => !currentTurnUids.has(t.user.uid) && t.assistant); // 只考虑已完成轮次？
        // 实际上我们应该考虑所有轮次，但当前轮次（未完成）可能不在 historyTurns 中，它应该保留
        // 我们先将当前轮次加入到 currentTurnUids 中，避免被删除
        if (currentUserMsg) {
            currentTurnUids.add(currentUserMsg.uid);
        }

        const toRemove = CacheState.frozenTurns.filter(t => !currentTurnUids.has(t.user.uid));
        if (toRemove.length > 0) {
            Logger.warn(`[检测到删除轮次] -${toRemove.length} 轮`, LogLevels.DETAILED);
            const remaining = CacheState.frozenTurns.length - toRemove.length;
            if (remaining < CacheState.frozenTurns.length * 0.7) {
                const ok = confirm(
                    `对话历史被大幅删除（剩余 ${remaining}/${CacheState.frozenTurns.length} 轮），缓存命中率将严重下降。\n\n` +
                    '按「确定」重置前缀并发送；按「取消」放弃本次发送。'
                );
                if (!ok) {
                    if (typeof toastr !== 'undefined') toastr.warning('发送已取消');
                    throw new Error('User cancelled send due to heavy dialogue deletion');
                }
                Logger.warn('[用户选择重置] 因重度删除，重置所有缓存', LogLevels.BASIC);
                performReset();
                CacheState.frozenBackground = dedupBg;
                if (currentTurn) {
                    CacheState.frozenTurns = [currentTurn];
                }
                applyFinalSequence(stream, currentUserMsg, currentPrefills, null);
                updateStats(true);
                return;
            } else {
                CacheState.frozenTurns = CacheState.frozenTurns.filter(t => currentTurnUids.has(t.user.uid));
                if (typeof toastr !== 'undefined') toastr.info(`已自动适配：移除 ${toRemove.length} 个被删除的对话轮次，缓存命中率可能轻微下降。`);
            }
        }

        // 处理当前轮次：如果当前轮次在冻结中已存在，则合并（通常不存在，因为是新轮次）
        const existingCurrent = CacheState.frozenTurns.find(t => t.user.uid === currentUserMsg.uid);
        if (existingCurrent) {
            // 更新其预填充（如果有新的）
            if (currentPrefills.length > 0) {
                existingCurrent.prefills = currentPrefills;
            }
            if (!existingCurrent.assistant && currentTurn.assistant) {
                existingCurrent.assistant = currentTurn.assistant;
            }
        } else {
            // 否则添加
            if (currentTurn) {
                CacheState.frozenTurns.push(currentTurn);
            }
        }

        // --- 新增背景 ---
        const newBg = dedupBg.filter(m => !frozenBgNorms.has(m.norm));
        for (const m of newBg) {
            if (!CacheState.extraBackground.some(ex => ex.norm === m.norm)) {
                CacheState.extraBackground.push(m);
            }
        }
        if (newBg.length > 0) Logger.warn(`[新增背景] +${newBg.length} 条`, LogLevels.DETAILED);

        applyFinalSequence(stream, currentUserMsg, currentPrefills, null);
        updateStats(false);

    } catch (err) {
        Logger.error('拦截器致命错误', err);
        throw err;
    }
}

// ==========================================
// 最终序列应用 (预填充独立输出)
// ==========================================
function applyFinalSequence(stream, currentUserMsg, currentPrefills, _unused) {
    const final = [];

    // 1. 冻结背景
    for (const bg of CacheState.frozenBackground) {
        final.push({ role: bg.role, content: bg.content });
    }

    // 2. 冻结对话轮次
    for (const turn of CacheState.frozenTurns) {
        final.push({ role: turn.user.role, content: turn.user.content });
        // 输出该轮的预填充（独立消息）
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

    // 5. 当前预填充 (这些已经在 frozenTurns 处理过了? 不，当前轮次可能已经在 frozenTurns 中，但当前请求的预填充是这一次要发送的，应该输出)
    // 但是当前轮次如果已经在 frozenTurns 中，我们已经输出了它的 prefills，会重复吗？
    // 关键：对于当前轮次，我们不应该预先将其预填充放入 frozenTurns 然后再输出一次，因为当前请求的输出应该只包含当前预填充一次。
    // 解决方案：在构建最终序列时，我们只输出 frozenTurns 中**已完成**的轮次（有 assistant 的），而当前轮次（未完成）单独处理。
    // 但我们上面的 frozenTurns 已经包含了未完成轮次，这会导致重复。
    // 重新思考：我们应该在输出时，排除掉与当前用户消息 uid 相同的轮次，因为那部分将由后面的 currentUserMsg + currentPrefills 提供。
    // 修改：在遍历 frozenTurns 时，跳过 turn.user.uid === currentUserMsg?.uid 的轮次。
}

// 修正 applyFinalSequence，避免当前轮次重复输出
function applyFinalSequence(stream, currentUserMsg, currentPrefills, _unused) {
    const final = [];

    // 冻结背景
    for (const bg of CacheState.frozenBackground) {
        final.push({ role: bg.role, content: bg.content });
    }

    // 冻结对话轮次 (跳过当前轮次，因为当前轮次由后面的 currentUserMsg 和 currentPrefills 负责)
    for (const turn of CacheState.frozenTurns) {
        if (currentUserMsg && turn.user.uid === currentUserMsg.uid) {
            continue; // 当前轮次留在最后输出
        }
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

    // 新增背景
    for (const extra of CacheState.extraBackground) {
        final.push({ role: extra.role, content: extra.content });
    }

    // 当前用户输入
    if (currentUserMsg) {
        final.push({ role: currentUserMsg.role, content: currentUserMsg.content });
    }

    // 当前预填充
    for (const p of currentPrefills) {
        final.push({ role: p.role, content: p.content });
    }

    // 注意：如果当前轮次已经有 assistant（不可能，因为 assistant 是在响应中），忽略

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
    Logger.log('══════ v6.4 就绪，预填充独立冻结 + 自適應删除 ══════', LogLevels.BASIC);
});
