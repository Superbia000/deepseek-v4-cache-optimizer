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
        console.warn(`%c[DS Cache v6.5] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS Cache v6.5] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS Cache v6.5] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
// 状态机（重构：新增 pendingCurrentTurn 彻底解决预填充丢失）
// ==========================================
const CacheState = {
    enabled: true,
    frozenBackground: [],     // 初始化时的系统提示词
    frozenTurns: [],          // 历史轮次: { user, prefills, extraBackground, assistant }
    pendingCurrentTurn: null, // 当前待完成轮次: { user, prefills, extraBackground }
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
};

// ==========================================
// 工具：消息分类与生成
// ==========================================
function classifyMsgLog(msg) {
    if (logLevel < LogLevels.DEBUG) return;
    let label = '';
    if (msg.role === 'system' || (msg.role !== 'user' && msg.role !== 'assistant')) label = '📋教学/系统';
    else if (msg.role === 'user') label = '👤真实用户';
    else if (msg.role === 'assistant') label = '🤖真实AI';
    Logger.log(`[分类] ${label} | ${msg.role}: ${msg.content.substring(0, 40).replace(/\n/g, ' ')}...`, LogLevels.DEBUG);
}

function createMessageObj(msg) {
    return {
        role: msg.role,
        content: msg.content,
        uid: `${msg.role}:${Logger.simpleHash(msg.content)}`,
        norm: Logger.normalize(msg.content),
    };
}

function combineAssistants(msgs) {
    if (msgs.length === 0) return null;
    const content = msgs.map(m => m.content).join('\n');
    return createMessageObj({ role: 'assistant', content: content });
}

// 智慧切除：防止 ST 把预填充和AI回复合并后，导致我们强制塞入预填充时出现文本重复
function stripPrefillFromAssistant(assistantObj, prefills) {
    if (!assistantObj || !prefills || prefills.length === 0) return assistantObj;
    let content = assistantObj.content || '';
    let modified = false;
    
    for (const p of prefills) {
        const pContent = p.content || '';
        if (content.startsWith(pContent)) {
            content = content.substring(pContent.length);
            modified = true;
        } else {
            const cleanContent = content.trimStart();
            const cleanP = pContent.trimStart();
            if (cleanContent.startsWith(cleanP) && cleanP.length > 0) {
                content = cleanContent.substring(cleanP.length);
                modified = true;
            }
        }
    }
    
    if (modified) {
        content = content.replace(/^[\s\n]+/, ''); // 移除切除后可能残留的换行
        return createMessageObj({ role: 'assistant', content: content });
    }
    return assistantObj;
}

// ==========================================
// 核心：解析 ST 数据流
// ==========================================
function parseSTStream(stream) {
    const systemMsgs = [];
    const dialogueMsgs = [];

    for (const msg of stream) {
        classifyMsgLog(msg);
        const obj = createMessageObj(msg);
        const isInstructional = (msg.role === 'system' || (msg.role !== 'user' && msg.role !== 'assistant'));
        if (isInstructional) {
            systemMsgs.push(obj);
        } else {
            dialogueMsgs.push(obj);
        }
    }

    let lastUserIdx = -1;
    for (let i = dialogueMsgs.length - 1; i >= 0; i--) {
        if (dialogueMsgs[i].role === 'user') {
            lastUserIdx = i;
            break;
        }
    }

    let stHistoryTurns = [];
    let stCurrentTurn = { user: null, prefills: [] };

    if (lastUserIdx === -1) {
        // 全是预填充 / 异常流
        stCurrentTurn.prefills = dialogueMsgs.filter(m => m.role === 'assistant');
    } else {
        const historyMsgs = dialogueMsgs.slice(0, lastUserIdx);
        const currentMsgs = dialogueMsgs.slice(lastUserIdx);

        stCurrentTurn.user = currentMsgs[0];
        stCurrentTurn.prefills = currentMsgs.slice(1).filter(m => m.role === 'assistant');

        let cur = { user: null, assistants: [] };
        for (const msg of historyMsgs) {
            if (msg.role === 'user') {
                if (cur.user) {
                    stHistoryTurns.push({ user: cur.user, assistant: combineAssistants(cur.assistants) });
                }
                cur = { user: msg, assistants: [] };
            } else if (msg.role === 'assistant') {
                cur.assistants.push(msg);
            }
        }
        if (cur.user) {
            stHistoryTurns.push({ user: cur.user, assistant: combineAssistants(cur.assistants) });
        }
    }

    if (stHistoryTurns.length > 0) {
        Logger.log(`[解析历史] 发现 ST 历史共 ${stHistoryTurns.length} 轮`, LogLevels.DEBUG);
    }
    Logger.log(`[解析当前] 用户: ${stCurrentTurn.user ? stCurrentTurn.user.content.substring(0, 15) : '无'}... 预填充数: ${stCurrentTurn.prefills.length}`, LogLevels.DEBUG);

    return { systemMsgs, stHistoryTurns, stCurrentTurn };
}

// ==========================================
// 状态机同步与去重算法
// ==========================================
function syncState(systemMsgs, stHistoryTurns, stCurrentTurn) {
    const newFrozenTurns = [];
    const oldFrozenTurns = [...CacheState.frozenTurns];
    let pendingMatched = false;

    // 1. 系统背景去重
    const uniqueSystemMsgs = [];
    const seenSys = new Set();
    for (const m of systemMsgs) {
        if (!seenSys.has(m.norm)) {
            seenSys.add(m.norm);
            uniqueSystemMsgs.push(m);
        }
    }

    // 2. 深度同步并匹配历史对话，找回丢失的预填充
    for (let i = 0; i < stHistoryTurns.length; i++) {
        const stTurn = stHistoryTurns[i];
        let matched = false;

        // A. 尝试在已冻结的历史记录中寻找
        for (let j = 0; j < oldFrozenTurns.length; j++) {
            const fTurn = oldFrozenTurns[j];
            if (fTurn.user && stTurn.user && fTurn.user.norm === stTurn.user.norm) {
                const cleanAssistant = stripPrefillFromAssistant(stTurn.assistant, fTurn.prefills);
                newFrozenTurns.push({
                    user: fTurn.user, 
                    prefills: fTurn.prefills, // 彻底保留原预填充！
                    extraBackground: fTurn.extraBackground,
                    assistant: cleanAssistant 
                });
                matched = true;
                oldFrozenTurns.splice(j, 1);
                Logger.log(`[历史同步] 命中旧缓存轮次 | 保留原有预填充`, LogLevels.DEBUG);
                break;
            }
        }

        // B. 如果未找到，尝试在刚刚处理过的 Pending 轮次中寻找
        if (!matched && CacheState.pendingCurrentTurn) {
            const pTurn = CacheState.pendingCurrentTurn;
            if (pTurn.user && stTurn.user && pTurn.user.norm === stTurn.user.norm) {
                const cleanAssistant = stripPrefillFromAssistant(stTurn.assistant, pTurn.prefills);
                newFrozenTurns.push({
                    user: pTurn.user,
                    prefills: pTurn.prefills, // 彻底保留原预填充！
                    extraBackground: pTurn.extraBackground,
                    assistant: cleanAssistant
                });
                matched = true;
                pendingMatched = true;
                Logger.log(`[历史同步] 命中刚刚结束的 Pending 轮次 | 固化为新历史`, LogLevels.DEBUG);
            }
        }

        // C. 完全未知的插入轮次
        if (!matched) {
            newFrozenTurns.push({
                user: stTurn.user,
                prefills: [],
                extraBackground: [],
                assistant: stTurn.assistant
            });
            Logger.warn(`[状态同步] 检测到游离历史插入，生成新缓存节`, LogLevels.DETAILED);
        }
    }

    CacheState.frozenTurns = newFrozenTurns;
    if (pendingMatched) CacheState.pendingCurrentTurn = null; 

    // 3. 统计已冻结使用的 System Norm，用于筛选新产生的世界书/提示词
    const usedSysNorms = new Set();
    CacheState.frozenBackground.forEach(m => usedSysNorms.add(m.norm));
    CacheState.frozenTurns.forEach(t => {
        t.extraBackground.forEach(m => usedSysNorms.add(m.norm));
    });

    const newSysMsgs = uniqueSystemMsgs.filter(m => !usedSysNorms.has(m.norm));
    Logger.log(`[背景同步] 提取旧系统背景数: ${usedSysNorms.size}, 本轮新激活(世界书等): ${newSysMsgs.length}`, LogLevels.DEBUG);

    // 4. 更新待定轮次 (Pending Current Turn)
    if (CacheState.frozenBackground.length === 0 && newFrozenTurns.length === 0) {
        CacheState.frozenBackground = newSysMsgs; // 首次对话，全部归入顶层核心
        CacheState.pendingCurrentTurn = {
            user: stCurrentTurn.user,
            prefills: stCurrentTurn.prefills,
            extraBackground: []
        };
        Logger.log(`[初始化] 完成！建立最初始背景与挂载钩子`, LogLevels.BASIC);
    } else {
        CacheState.pendingCurrentTurn = {
            user: stCurrentTurn.user,
            prefills: stCurrentTurn.prefills,
            extraBackground: newSysMsgs // 按照排序要求，新激活的置于当前回复前
        };
        if (newSysMsgs.length > 0) {
            Logger.warn(`[新增背景] +${newSysMsgs.length} 条 (已附着于当前轮次前缀)`, LogLevels.DETAILED);
        }
    }
}

// ==========================================
// 组合输出最终数组
// ==========================================
function applyFinalSequence(stream) {
    const final = [];

    // 1. 冻结背景 (首轮)
    for (const bg of CacheState.frozenBackground) final.push({ role: bg.role, content: bg.content });

    // 2. 冻结的历史轮次
    for (let i = 0; i < CacheState.frozenTurns.length; i++) {
        const turn = CacheState.frozenTurns[i];
        for (const extra of turn.extraBackground) final.push({ role: extra.role, content: extra.content });
        if (turn.user) final.push({ role: turn.user.role, content: turn.user.content });
        for (const p of turn.prefills) final.push({ role: p.role, content: p.content }); // 强制召回预填充
        if (turn.assistant) final.push({ role: turn.assistant.role, content: turn.assistant.content });
    }

    // 3. 当前轮次
    if (CacheState.pendingCurrentTurn) {
        const pTurn = CacheState.pendingCurrentTurn;
        for (const extra of pTurn.extraBackground) final.push({ role: extra.role, content: extra.content });
        if (pTurn.user) final.push({ role: pTurn.user.role, content: pTurn.user.content });
        for (const p of pTurn.prefills) final.push({ role: p.role, content: p.content });
    }

    if (logLevel >= LogLevels.DEBUG) {
        Logger.log(`[构建最终序列] 总长: ${final.length} | 冻结背景: ${CacheState.frozenBackground.length} | 历史轮次: ${CacheState.frozenTurns.length}`, LogLevels.DEBUG);
    }

    stream.splice(0, stream.length, ...final);
}

// ==========================================
// 拦截与主程序
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`[请求 #${CacheState.stats.total}] 开始处理...`);

        if (!data?.chat?.length) return;
        const stream = data.chat;

        const { systemMsgs, stHistoryTurns, stCurrentTurn } = parseSTStream(stream);

        // --- 核心防崩坏：相似度重置检测 ---
        const currentSysNorms = new Set(systemMsgs.map(m => m.norm));
        const usedSysNorms = new Set();
        CacheState.frozenBackground.forEach(m => usedSysNorms.add(m.norm));
        CacheState.frozenTurns.forEach(t => t.extraBackground.forEach(m => usedSysNorms.add(m.norm)));
        if (CacheState.pendingCurrentTurn) CacheState.pendingCurrentTurn.extraBackground.forEach(m => usedSysNorms.add(m.norm));

        if (usedSysNorms.size === 0 && CacheState.frozenBackground.length === 0) {
            // 这是彻底的第一次，直接跳过
        } else {
            const union = new Set([...usedSysNorms, ...currentSysNorms]);
            let intersection = 0;
            for (const item of usedSysNorms) if (currentSysNorms.has(item)) intersection++;
            const similarity = union.size === 0 ? 1 : intersection / union.size;

            if (similarity < 0.9) {
                Logger.log(`[背景相似度] ${(similarity * 100).toFixed(1)}%`, LogLevels.DEBUG);
                const ok = confirm('检测到系统提示词核心变动（更换角色卡/预设），建议重置缓存前缀以保证性能。\n\n按「确定」重置前缀并发送消息；按「取消」放弃本次发送。');
                if (!ok) {
                    if (typeof toastr !== 'undefined') toastr.warning('发送已取消');
                    throw new Error('User cancelled send due to cache prefix change');
                }
                Logger.warn('[用户选择重置] 因背景变动，重置所有缓存', LogLevels.BASIC);
                performReset();
                return interceptAndRestructurePrompt(data); // 递归重入重新处理
            }

            // 自适应删除防护
            const stCount = stHistoryTurns.length;
            const frozenCount = CacheState.frozenTurns.length;
            if (frozenCount > 0 && stCount < frozenCount * 0.7) {
                const ok = confirm(`对话历史被大幅删除（剩余 ${stCount}/${frozenCount} 轮），缓存命中率将严重下降。\n\n按「确定」重置前缀并发送；按「取消」放弃本次发送。`);
                if (!ok) {
                    if (typeof toastr !== 'undefined') toastr.warning('发送已取消');
                    throw new Error('User cancelled send due to heavy dialogue deletion');
                }
                Logger.warn('[用户选择重置] 因重度删除，重置所有缓存', LogLevels.BASIC);
                performReset();
                return interceptAndRestructurePrompt(data); 
            }
        }

        // 核心同步与构建
        syncState(systemMsgs, stHistoryTurns, stCurrentTurn);
        applyFinalSequence(stream);
        
        // 只在非初始化时才算做一次“命中尝试”
        updateStats(CacheState.frozenTurns.length === 0 && stHistoryTurns.length === 0);

    } catch (err) {
        Logger.error('拦截器致命错误', err);
        throw err;
    }
}

// ==========================================
// 其他辅助 UI
// ==========================================
function updateStats(isInit = false) {
    let turnTokens = 0;
    for (const m of CacheState.frozenBackground) turnTokens += Logger.estimateTokens(m.content);
    for (const t of CacheState.frozenTurns) {
        for (const m of t.extraBackground) turnTokens += Logger.estimateTokens(m.content);
        if (t.user) turnTokens += Logger.estimateTokens(t.user.content);
        for (const p of t.prefills) turnTokens += Logger.estimateTokens(p.content);
        if (t.assistant) turnTokens += Logger.estimateTokens(t.assistant.content);
    }
    if (CacheState.pendingCurrentTurn) {
        for (const m of CacheState.pendingCurrentTurn.extraBackground) turnTokens += Logger.estimateTokens(m.content);
    }

    CacheState.stats.prefixTokens = turnTokens;
    if (!isInit) {
        CacheState.stats.hits++;
        CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
    }
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
    CacheState.pendingCurrentTurn = null;
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    updateStatsUI();
    Logger.warn('[重置] 所有缓存已清空', LogLevels.BASIC);
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Deepseek 缓存命中优化 (v6.5 强化版)</b>
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

        $('#ds-cache-enable').on('change', function () { CacheState.enabled = $(this).is(':checked'); });
        $('#ds-cache-loglevel').on('change', function () { logLevel = parseInt($(this).val()); });
        $('#ds-cache-reset').on('click', () => performReset());
        $('#ds-cache-clearlog').on('click', () => { if (Logger._uiTextarea) Logger._uiTextarea.value = ''; });
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
            extension_settings['ds-cache'].extensionsMenu.push({ label: '重置DS缓存前缀', action: () => performReset() });
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
    Logger.log('══════ v6.5 就绪，预填充彻底独立冻结 + 强化状态自适应 ══════', LogLevels.BASIC);
});
