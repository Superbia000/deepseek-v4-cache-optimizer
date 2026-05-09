import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';
import { SlashCommandParser } from '../../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../slash-commands/SlashCommand.js';

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
        console.warn(`%c[DS Cache v6.6] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS Cache v6.6] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS Cache v6.6] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
    normalize: (text) => text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
};

// ==========================================
// 状态机（彻底无统计功能）
// ==========================================
const CacheState = {
    enabled: true,
    frozenBackground: [],     // 初始化时的系统提示词
    frozenTurns: [],          // 历史轮次: { user, prefills, extraBackground, assistant }
    pendingCurrentTurn: null, // 当前待完成轮次: { user, prefills, extraBackground }
};

// ==========================================
// 实时监听自适应截断（核心新功能）
// ==========================================
function onHistoryChanged() {
    // 延迟100ms确保SillyTavern内部的chat数组已完成DOM和数据更新
    setTimeout(() => {
        if (!CacheState.enabled || CacheState.frozenTurns.length === 0) return;
        const context = getContext();
        const currentChat = context.chat || [];
        
        // 获取当前所有存在于聊天栏中的消息内容哈希/标准化文本
        const currentNorms = new Set(currentChat.map(m => Logger.normalize(m.mes || '')));

        let brokenIndex = -1;
        
        // 按顺序检查已冻结的轮次，发现断裂立刻记录
        for (let i = 0; i < CacheState.frozenTurns.length; i++) {
            const turn = CacheState.frozenTurns[i];
            let isBroken = false;
            
            if (turn.user && !currentNorms.has(turn.user.norm)) isBroken = true;
            if (turn.assistant && !currentNorms.has(turn.assistant.norm)) isBroken = true;
            
            if (isBroken) {
                brokenIndex = i;
                break;
            }
        }

        if (brokenIndex !== -1) {
            if (brokenIndex === 0) {
                // 第一轮对话被删，彻底失效
                CacheState.frozenTurns = [];
                CacheState.pendingCurrentTurn = null;
                if (typeof toastr !== 'undefined') toastr.warning('检测到大量历史记录变动，为了保证 Deepseek 正常运作，缓存已自适应重置！', 'DS 缓存优化');
                Logger.warn('[自适应] 全局历史被删，强制清空缓存序列。');
            } else if (brokenIndex === CacheState.frozenTurns.length - 1) {
                // 仅删除了最后一次对话（撤回重做等）
                CacheState.frozenTurns.splice(brokenIndex, 1);
                if (typeof toastr !== 'undefined') {
                    toastr.success('已自适应移除最新对话的缓存。<br/>前置提示词及历史仍保持 <b>100% 命中</b>！', 'DS 缓存优化', {timeOut: 4000, escapeHtml: false});
                }
                Logger.warn('[自适应] 检测到尾部删除，已弹出最后一次对话缓存，前缀完整保留！');
            } else {
                // 删除了中间的对话（导致断点后缓存全部错位）
                CacheState.frozenTurns = CacheState.frozenTurns.slice(0, brokenIndex);
                if (typeof toastr !== 'undefined') {
                    toastr.warning('检测到您修改或删除了历史中间的对话！<br/>系统已自适应<b>截断断点后</b>的缓存，断点前的历史仍保持 <b>100% 命中</b>。', 'DS 缓存截断', {timeOut: 8000, escapeHtml: false});
                }
                Logger.warn(`[自适应] 检测到中间对话变动(断点: ${brokenIndex})，已截断断点后的无效缓存。`);
            }
        }
    }, 100);
}

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

// 智慧切除预填充
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
        content = content.replace(/^[\s\n]+/, ''); 
        return createMessageObj({ role: 'assistant', content: content });
    }
    return assistantObj;
}

// ==========================================
// 核心：解析与状态同步
// ==========================================
function parseSTStream(stream) {
    const systemMsgs = [];
    const dialogueMsgs = [];

    for (const msg of stream) {
        classifyMsgLog(msg);
        const obj = createMessageObj(msg);
        const isInstructional = (msg.role === 'system' || (msg.role !== 'user' && msg.role !== 'assistant'));
        if (isInstructional) systemMsgs.push(obj);
        else dialogueMsgs.push(obj);
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
        stCurrentTurn.prefills = dialogueMsgs.filter(m => m.role === 'assistant');
    } else {
        const historyMsgs = dialogueMsgs.slice(0, lastUserIdx);
        const currentMsgs = dialogueMsgs.slice(lastUserIdx);

        stCurrentTurn.user = currentMsgs[0];
        stCurrentTurn.prefills = currentMsgs.slice(1).filter(m => m.role === 'assistant');

        let cur = { user: null, assistants: [] };
        for (const msg of historyMsgs) {
            if (msg.role === 'user') {
                if (cur.user) stHistoryTurns.push({ user: cur.user, assistant: combineAssistants(cur.assistants) });
                cur = { user: msg, assistants: [] };
            } else if (msg.role === 'assistant') {
                cur.assistants.push(msg);
            }
        }
        if (cur.user) stHistoryTurns.push({ user: cur.user, assistant: combineAssistants(cur.assistants) });
    }
    return { systemMsgs, stHistoryTurns, stCurrentTurn };
}

function syncState(systemMsgs, stHistoryTurns, stCurrentTurn) {
    const newFrozenTurns = [];
    const oldFrozenTurns = [...CacheState.frozenTurns];
    let pendingMatched = false;

    const uniqueSystemMsgs = [];
    const seenSys = new Set();
    for (const m of systemMsgs) {
        if (!seenSys.has(m.norm)) {
            seenSys.add(m.norm);
            uniqueSystemMsgs.push(m);
        }
    }

    for (let i = 0; i < stHistoryTurns.length; i++) {
        const stTurn = stHistoryTurns[i];
        let matched = false;

        for (let j = 0; j < oldFrozenTurns.length; j++) {
            const fTurn = oldFrozenTurns[j];
            if (fTurn.user && stTurn.user && fTurn.user.norm === stTurn.user.norm) {
                const cleanAssistant = stripPrefillFromAssistant(stTurn.assistant, fTurn.prefills);
                newFrozenTurns.push({ user: fTurn.user, prefills: fTurn.prefills, extraBackground: fTurn.extraBackground, assistant: cleanAssistant });
                matched = true;
                oldFrozenTurns.splice(j, 1);
                break;
            }
        }

        if (!matched && CacheState.pendingCurrentTurn) {
            const pTurn = CacheState.pendingCurrentTurn;
            if (pTurn.user && stTurn.user && pTurn.user.norm === stTurn.user.norm) {
                const cleanAssistant = stripPrefillFromAssistant(stTurn.assistant, pTurn.prefills);
                newFrozenTurns.push({ user: pTurn.user, prefills: pTurn.prefills, extraBackground: pTurn.extraBackground, assistant: cleanAssistant });
                matched = true;
                pendingMatched = true;
            }
        }

        if (!matched) {
            newFrozenTurns.push({ user: stTurn.user, prefills: [], extraBackground: [], assistant: stTurn.assistant });
        }
    }

    CacheState.frozenTurns = newFrozenTurns;
    if (pendingMatched) CacheState.pendingCurrentTurn = null; 

    const usedSysNorms = new Set();
    CacheState.frozenBackground.forEach(m => usedSysNorms.add(m.norm));
    CacheState.frozenTurns.forEach(t => t.extraBackground.forEach(m => usedSysNorms.add(m.norm)));

    const newSysMsgs = uniqueSystemMsgs.filter(m => !usedSysNorms.has(m.norm));

    if (CacheState.frozenBackground.length === 0 && newFrozenTurns.length === 0) {
        CacheState.frozenBackground = newSysMsgs;
        CacheState.pendingCurrentTurn = { user: stCurrentTurn.user, prefills: stCurrentTurn.prefills, extraBackground: [] };
    } else {
        CacheState.pendingCurrentTurn = { user: stCurrentTurn.user, prefills: stCurrentTurn.prefills, extraBackground: newSysMsgs };
    }
}

function applyFinalSequence(stream) {
    const final = [];
    for (const bg of CacheState.frozenBackground) final.push({ role: bg.role, content: bg.content });
    for (let i = 0; i < CacheState.frozenTurns.length; i++) {
        const turn = CacheState.frozenTurns[i];
        for (const extra of turn.extraBackground) final.push({ role: extra.role, content: extra.content });
        if (turn.user) final.push({ role: turn.user.role, content: turn.user.content });
        for (const p of turn.prefills) final.push({ role: p.role, content: p.content });
        if (turn.assistant) final.push({ role: turn.assistant.role, content: turn.assistant.content });
    }
    if (CacheState.pendingCurrentTurn) {
        const pTurn = CacheState.pendingCurrentTurn;
        for (const extra of pTurn.extraBackground) final.push({ role: extra.role, content: extra.content });
        if (pTurn.user) final.push({ role: pTurn.user.role, content: pTurn.user.content });
        for (const p of pTurn.prefills) final.push({ role: p.role, content: p.content });
    }
    stream.splice(0, stream.length, ...final);
}

function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;
    try {
        if (!data?.chat?.length) return;
        Logger.log(`==============================`);
        Logger.log(`[请求拦截] 开始重构缓存...`);

        const stream = data.chat;
        const { systemMsgs, stHistoryTurns, stCurrentTurn } = parseSTStream(stream);

        // 检测背景设定是否整体更换
        const currentSysNorms = new Set(systemMsgs.map(m => m.norm));
        const usedSysNorms = new Set();
        CacheState.frozenBackground.forEach(m => usedSysNorms.add(m.norm));
        CacheState.frozenTurns.forEach(t => t.extraBackground.forEach(m => usedSysNorms.add(m.norm)));
        if (CacheState.pendingCurrentTurn) CacheState.pendingCurrentTurn.extraBackground.forEach(m => usedSysNorms.add(m.norm));

        if (usedSysNorms.size > 0) {
            const union = new Set([...usedSysNorms, ...currentSysNorms]);
            let intersection = 0;
            for (const item of usedSysNorms) if (currentSysNorms.has(item)) intersection++;
            const similarity = union.size === 0 ? 1 : intersection / union.size;

            if (similarity < 0.9) {
                Logger.warn(`[系统背景相似度] ${(similarity * 100).toFixed(1)}% - 检测到角色卡或世界设定大改！`);
                performReset(); // 直接自适应重置
            }
        }

        syncState(systemMsgs, stHistoryTurns, stCurrentTurn);
        applyFinalSequence(stream);
    } catch (err) {
        Logger.error('拦截器致命错误', err);
        throw err;
    }
}

// ==========================================
// 辅助与 UI
// ==========================================
function performReset() {
    CacheState.frozenBackground = [];
    CacheState.frozenTurns = [];
    CacheState.pendingCurrentTurn = null;
    if (typeof toastr !== 'undefined') toastr.success('DS 缓存前缀已强制重置', 'Deepseek Cache');
    Logger.warn('[系统] 所有对话与系统缓存序列已清空');
}

async function setupUI() {
    try {
        // UI已完全同步ST原版设计，移除了破坏布局的长标题和统计面板
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>DS 缓存优化</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">自适应截断机制生效中，当删除中间对话时，确保断点前的记录完美命中。</p>
                <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" checked> 启用插件核心钩子</label>
                <div style="margin:8px 0;">
                    <span style="font-size:0.9em;">输出日志等级:</span>
                    <select id="ds-cache-loglevel">
                        <option value="0">关闭</option><option value="1">简要</option>
                        <option value="2" selected>详细</option><option value="3">调试</option>
                    </select>
                </div>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:5px 0;">🔄 强制重置缓存前缀</button>
                <button id="ds-cache-clearlog" class="menu_button" style="width:100%;margin:5px 0;">🗑️ 清空调试日志</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:150px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');

        $('#ds-cache-enable').on('change', function () { CacheState.enabled = $(this).is(':checked'); });
        $('#ds-cache-loglevel').on('change', function () { logLevel = parseInt($(this).val()); });
        $('#ds-cache-reset').on('click', () => performReset());
        $('#ds-cache-clearlog').on('click', () => { if (Logger._uiTextarea) Logger._uiTextarea.value = ''; });
    } catch (e) {
        Logger.error('UI初始化失败', e);
    }
}

// 注册重置命令到原生的魔杖菜单与斜线命令
function registerExtensionsMenu() {
    // 方法1: 注册到ST官方扩展 Wand Menu 中
    if (typeof extension_settings !== 'undefined') {
        extension_settings['ds-cache'] = extension_settings['ds-cache'] || {};
        extension_settings['ds-cache'].extensionsMenu = extension_settings['ds-cache'].extensionsMenu || [];
        if (!extension_settings['ds-cache'].extensionsMenu.find(m => m.label === '🔄 重置 DS 缓存前缀')) {
            extension_settings['ds-cache'].extensionsMenu.push({
                label: '🔄 重置 DS 缓存前缀',
                action: () => performReset()
            });
        }
    }

    // 方法2: 添加供玩家调用的斜线命令 /dsreset
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'dsreset',
            callback: () => { performReset(); return 'Deepseek 自适应缓存已重置。'; },
            helpString: '手动强制重置 Deepseek 的提示词缓存序列。',
        }));
    } catch (e) {
        Logger.log('Slash Command 注册跳过', LogLevels.DEBUG);
    }
}

// ==========================================
// 启动事件挂载
// ==========================================
jQuery(async () => {
    await setupUI();
    registerExtensionsMenu();

    if (eventSource) {
        // 挂载消息流发送拦截
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        
        // 挂载所有可能导致历史断裂的变更事件，作自适应即时响应
        eventSource.on(event_types.MESSAGE_DELETED, onHistoryChanged);
        eventSource.on(event_types.MESSAGE_UPDATED, onHistoryChanged);
        eventSource.on(event_types.MESSAGE_SWIPED, onHistoryChanged);
        
        Logger.log('[系统] v6.6 钩子全量挂载完成', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载核心事件钩子');
    }
});
