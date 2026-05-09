import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日誌系統
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };
let logLevel = 2;

function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const fullMsg = `[${time}] ${msg}`;
    if (type === 'warn') {
        console.warn(`%c[DS Cache v6.7] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS Cache v6.7] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS Cache v6.7] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
// 狀態機
// ==========================================
const CacheState = {
    enabled: true,
    frozenBackground: [],     
    frozenTurns: [],          
    pendingCurrentTurn: null, 
};

// ==========================================
// 工具：消息分類與生成
// ==========================================
function classifyMsgLog(msg) {
    if (logLevel < LogLevels.DEBUG) return;
    let label = '';
    if (msg.role === 'system' || (msg.role !== 'user' && msg.role !== 'assistant')) label = '📋教學/系統';
    else if (msg.role === 'user') label = '👤真實用戶';
    else if (msg.role === 'assistant') label = '🤖真實AI';
    Logger.log(`[分類] ${label} | ${msg.role}: ${msg.content.substring(0, 40).replace(/\n/g, ' ')}...`, LogLevels.DEBUG);
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

// 智慧切除：防止預填充重複
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
// 核心：解析 ST 數據流
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

    return { systemMsgs, stHistoryTurns, stCurrentTurn };
}

// ==========================================
// 狀態機同步與自適應癒合
// ==========================================
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
                newFrozenTurns.push({
                    user: fTurn.user, 
                    prefills: fTurn.prefills, 
                    extraBackground: fTurn.extraBackground,
                    assistant: cleanAssistant 
                });
                matched = true;
                oldFrozenTurns.splice(j, 1);
                break;
            }
        }

        if (!matched && CacheState.pendingCurrentTurn) {
            const pTurn = CacheState.pendingCurrentTurn;
            if (pTurn.user && stTurn.user && pTurn.user.norm === stTurn.user.norm) {
                const cleanAssistant = stripPrefillFromAssistant(stTurn.assistant, pTurn.prefills);
                newFrozenTurns.push({
                    user: pTurn.user,
                    prefills: pTurn.prefills,
                    extraBackground: pTurn.extraBackground,
                    assistant: cleanAssistant
                });
                matched = true;
                pendingMatched = true;
            }
        }

        if (!matched) {
            newFrozenTurns.push({
                user: stTurn.user,
                prefills: [],
                extraBackground: [],
                assistant: stTurn.assistant
            });
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
        CacheState.pendingCurrentTurn = {
            user: stCurrentTurn.user,
            prefills: stCurrentTurn.prefills,
            extraBackground: []
        };
    } else {
        CacheState.pendingCurrentTurn = {
            user: stCurrentTurn.user,
            prefills: stCurrentTurn.prefills,
            extraBackground: newSysMsgs 
        };
    }
}

// ==========================================
// 組合輸出最終陣列
// ==========================================
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

// ==========================================
// 攔截與彈窗機制
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        Logger.log(`==============================`);
        Logger.log(`[請求] 開始處理並構建緩存前綴...`);

        if (!data?.chat?.length) return;
        const stream = data.chat;

        const { systemMsgs, stHistoryTurns, stCurrentTurn } = parseSTStream(stream);

        let requireResetConfirm = false;
        let resetReason = "";

        // 1. 檢測提示詞變動
        const currentSysNorms = new Set(systemMsgs.map(m => m.norm));
        const usedSysNorms = new Set();
        CacheState.frozenBackground.forEach(m => usedSysNorms.add(m.norm));
        CacheState.frozenTurns.forEach(t => t.extraBackground.forEach(m => usedSysNorms.add(m.norm)));
        if (CacheState.pendingCurrentTurn) CacheState.pendingCurrentTurn.extraBackground.forEach(m => usedSysNorms.add(m.norm));

        if (usedSysNorms.size > 0 || CacheState.frozenBackground.length > 0) {
            const union = new Set([...usedSysNorms, ...currentSysNorms]);
            let intersection = 0;
            for (const item of usedSysNorms) if (currentSysNorms.has(item)) intersection++;
            const similarity = union.size === 0 ? 1 : intersection / union.size;

            if (similarity < 0.9) {
                requireResetConfirm = true;
                resetReason = "檢測到系統預設、角色卡或核心提示詞發生了大幅度改變。";
            }
        }

        // 2. 檢測破壞性刪除
        if (!requireResetConfirm && CacheState.frozenTurns.length > 0) {
            const stNorms = stHistoryTurns.map(t => t.user.norm);
            let middleDeletionDetected = false;
            let tailDeletionCount = 0;

            for (let i = 0; i < CacheState.frozenTurns.length; i++) {
                const fTurn = CacheState.frozenTurns[i];
                const stIdx = stNorms.indexOf(fTurn.user.norm);

                if (stIdx === -1) {
                    let hasSubsequent = false;
                    for (let j = i + 1; j < CacheState.frozenTurns.length; j++) {
                        if (stNorms.indexOf(CacheState.frozenTurns[j].user.norm) !== -1) {
                            hasSubsequent = true;
                            break;
                        }
                    }

                    if (hasSubsequent) {
                        middleDeletionDetected = true;
                        break; 
                    } else {
                        tailDeletionCount++;
                    }
                }
            }

            const frozenCount = CacheState.frozenTurns.length;

            if (middleDeletionDetected) {
                requireResetConfirm = true;
                resetReason = "檢測到您刪除了對話歷史中間的訊息。\n根據緩存機制，這將導致斷點後方的所有已凍結緩存徹底失效並碎片化！";
            } else if (tailDeletionCount > 0) {
                if (tailDeletionCount >= frozenCount * 0.3) {
                    requireResetConfirm = true;
                    resetReason = `檢測到對話歷史被大幅度刪減（刪除了 ${tailDeletionCount} 輪歷史）。`;
                } else {
                    Logger.log(`[自適應修剪] 檢測到末端刪除 ${tailDeletionCount} 輪，自動修剪，不影響緩存！`, LogLevels.BASIC);
                    CacheState.frozenTurns = CacheState.frozenTurns.slice(0, CacheState.frozenTurns.length - tailDeletionCount);
                }
            }
        }

        // 3. 執行彈窗 (用戶點擊取消 -> 不重置前綴，繼續發送)
        if (requireResetConfirm) {
            const msg = `🚨 [Deepseek 緩存優化] 🚨\n\n${resetReason}\n\n▶ 點擊【確定】：徹底重置緩存前綴 (推薦，保持最高命中率)。\n▶ 點擊【取消】：不重置緩存，強行發送 (容忍本次緩存斷裂)。`;
            const ok = confirm(msg);
            if (ok) {
                Logger.warn('[用戶選擇重置] 狀態已強制重置，開始構建新緩存', LogLevels.BASIC);
                performReset();
                return interceptAndRestructurePrompt(data);
            } else {
                Logger.warn('[用戶選擇取消] 拒絕重置，程序將以當前殘缺狀態強行發送', LogLevels.BASIC);
                // 繼續執行 syncState，系統會自動捨棄丟失的對話，並發送提示詞
            }
        }

        // 核心同步與構建
        syncState(systemMsgs, stHistoryTurns, stCurrentTurn);
        applyFinalSequence(stream);

    } catch (err) {
        Logger.error('攔截器發生錯誤', err);
        throw err;
    }
}

// ==========================================
// 即時修改提醒機制
// ==========================================
function triggerInstantWarning() {
    if (!CacheState.enabled) return;
    if (typeof toastr !== 'undefined') {
        toastr.warning('修改或刪除歷史對話將影響 Deepseek 緩存命中率！', '⚠️ 緩存狀態變更', { timeOut: 3500 });
    }
}

// ==========================================
// 輔助 UI 與 初始化
// ==========================================
function performReset() {
    CacheState.frozenBackground = [];
    CacheState.frozenTurns = [];
    CacheState.pendingCurrentTurn = null;
    Logger.warn('[重置] 所有緩存狀態已清空', LogLevels.BASIC);
}

async function setupUI() {
    try {
        // 完全使用 ST 原生 HTML 結構，不添加額外的 flex/span 樣式
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Deepseek 缓存优化 (v6.7)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">背景/對話獨立分離，預填充絕對凍結，即時自適應刪除偵測。</p>
                <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" checked> 啟用插件</label>
                <div style="margin:8px 0; display:flex; align-items:center;">
                    <span style="font-size:0.9em; margin-right:5px;">日誌等級:</span>
                    <select id="ds-cache-loglevel" class="text_pole" style="width:auto;">
                        <option value="0">關閉</option><option value="1">簡要</option>
                        <option value="2" selected>詳細</option><option value="3">調試</option>
                    </select>
                </div>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:5px 0;">🔄 強制重置緩存前綴</button>
                <button id="ds-cache-clearlog" class="menu_button" style="width:100%;margin:5px 0;">🗑️ 清空日誌</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');

        $('#ds-cache-enable').on('change', function () { CacheState.enabled = $(this).is(':checked'); });
        $('#ds-cache-loglevel').on('change', function () { logLevel = parseInt($(this).val()); });
        $('#ds-cache-reset').on('click', () => {
            performReset();
            if (typeof toastr !== 'undefined') toastr.success("已重置 Deepseek 緩存前綴");
        });
        $('#ds-cache-clearlog').on('click', () => { if (Logger._uiTextarea) Logger._uiTextarea.value = ''; });
    } catch (e) {
        Logger.error('UI初始化失敗', e);
    }
}

function registerMenuItems() {
    const wandMenu = $('#extensionsMenu');
    if (wandMenu.length > 0 && $('#wand-ds-cache-reset').length === 0) {
        const menuItem = $('<div id="wand-ds-cache-reset" class="list-group-item extensionsMenu-item" style="cursor:pointer;"><i class="fa-solid fa-rotate-right"></i> 重置 DS 緩存前綴</div>');
        menuItem.on('click', () => {
            performReset();
            if (typeof toastr !== 'undefined') toastr.success("已重置 Deepseek 緩存狀態");
            $('#extensionsMenu').slideUp(100);
        });
        wandMenu.append(menuItem);
    }
}

// ==========================================
// 啟動
// ==========================================
jQuery(async () => {
    await setupUI();
    
    // 掛載 Wand Menu
    setTimeout(registerMenuItems, 2000); 

    if (eventSource) {
        // 掛載核心攔截器
        if (event_types?.CHAT_COMPLETION_PROMPT_READY) {
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        }
        
        // 掛載「當時當刻」的即時提醒鉤子
        if (event_types?.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, triggerInstantWarning);
        if (event_types?.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, triggerInstantWarning);
        if (event_types?.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, triggerInstantWarning);

        Logger.log('[系統] 鉤子與即時監聽已掛載', LogLevels.BASIC);
    } else {
        Logger.error('無法掛載事件鉤子');
    }
    
    Logger.log('══════ v6.7 就緒，彈窗邏輯與 UI 已修復 ══════', LogLevels.BASIC);
});
