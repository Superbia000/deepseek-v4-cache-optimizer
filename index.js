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
        console.warn(`%c[DS Cache v7.1] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS Cache v7.1] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS Cache v7.1] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
    normalize: (text) => text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
};

// ==========================================
// 狀態機 (單一平鋪序列架構)
// ==========================================
const CacheState = {
    enabled: true,
    toastSys: true,       
    toastLore: true,      
    toastHistory: true,   
    showResetPrompt: true,
    
    frozenSequence: [],   
    pendingCurrentTurn: null, 
    lastPrefills: [],
    lastSentSequence: null // 用於 10% 緩存流失對比
};

// ==========================================
// 工具：相似度與消息分類
// ==========================================
function getSimilarity(str1, str2) {
    if (str1 === str2) return 1;
    if (Math.abs(str1.length - str2.length) > Math.max(str1.length, str2.length) * 0.5) return 0;
    const s1 = str1.length < str2.length ? str1 : str2;
    const s2 = str1.length < str2.length ? str2 : str1;
    if (s1.length === 0) return 0;
    
    const bigrams = new Set();
    for (let i = 0; i < s1.length - 1; i++) bigrams.add(s1.substring(i, i+2));
    
    let matchCount = 0;
    for (let i = 0; i < s2.length - 1; i++) {
        if (bigrams.has(s2.substring(i, i+2))) matchCount++;
    }
    const union = (s1.length - 1) + (s2.length - 1) - matchCount;
    return union <= 0 ? 1 : matchCount / union;
}

function classifyMsgLog(msg) {
    if (logLevel < LogLevels.DEBUG) return;
    let label = '';
    if (msg.role === 'system' || (msg.role !== 'user' && msg.role !== 'assistant')) label = '📋教學/系統';
    else if (msg.role === 'user') label = '👤真實用戶';
    else if (msg.role === 'assistant') label = '🤖真實AI';
    
    let snippet = msg.content.replace(/\n/g, ' ');
    if (snippet.length > 45) snippet = snippet.substring(0, 45) + '...';
    Logger.log(`[分類] ${label} | ${msg.role}: ${snippet}`, LogLevels.DEBUG);
}

function createMsg(msg, type) {
    return {
        role: msg.role,
        content: msg.content,
        norm: Logger.normalize(msg.content),
        type: type
    };
}

function stripPrefillFromAssistant(assistantObj, prefills) {
    if (!assistantObj || !prefills || prefills.length === 0) return assistantObj;
    let content = assistantObj.content || '';
    let modified = false;
    for (const p of prefills) {
        const pContent = p.content || '';
        if (content.startsWith(pContent)) {
            content = content.substring(pContent.length);
            modified = true;
        }
    }
    if (modified) {
        content = content.replace(/^[\s\n]+/, ''); 
        return { ...assistantObj, content: content, norm: Logger.normalize(content) };
    }
    return assistantObj;
}

// ==========================================
// 核心：平鋪同步演算法
// ==========================================
function parseSTStream(stream) {
    const sysMsgs = [];
    const chatMsgs = [];

    for (const msg of stream) {
        classifyMsgLog(msg);
        const isSys = (msg.role === 'system' || (msg.role !== 'user' && msg.role !== 'assistant'));
        if (isSys) sysMsgs.push(createMsg(msg, 'sys'));
        else chatMsgs.push(createMsg(msg, msg.role === 'user' ? 'user' : 'ai'));
    }

    let lastUserIdx = -1;
    for (let i = chatMsgs.length - 1; i >= 0; i--) {
        if (chatMsgs[i].role === 'user') { lastUserIdx = i; break; }
    }

    let stHistoryTurns = [];
    let stCurrentTurn = { user: null, prefills: [] };

    if (lastUserIdx === -1) {
        stCurrentTurn.prefills = chatMsgs.filter(m => m.type === 'ai');
    } else {
        const historyMsgs = chatMsgs.slice(0, lastUserIdx);
        const currentMsgs = chatMsgs.slice(lastUserIdx);

        stCurrentTurn.user = currentMsgs[0];
        stCurrentTurn.prefills = currentMsgs.slice(1).filter(m => m.type === 'ai');

        let curUser = null;
        let curAiContents = [];
        for (const msg of historyMsgs) {
            if (msg.type === 'user') {
                if (curUser) {
                    stHistoryTurns.push({ 
                        user: curUser, 
                        assistant: curAiContents.length ? { role: 'assistant', content: curAiContents.join('\n') } : null 
                    });
                }
                curUser = msg;
                curAiContents = [];
            } else if (msg.type === 'ai') {
                curAiContents.push(msg.content);
            }
        }
        if (curUser) {
            stHistoryTurns.push({ 
                user: curUser, 
                assistant: curAiContents.length ? { role: 'assistant', content: curAiContents.join('\n') } : null 
            });
        }
    }
    return { sysMsgs, stHistoryTurns, stCurrentTurn };
}

function syncSequence(sysMsgs, stHistoryTurns, stCurrentTurn) {
    const sysMsgsPool = [...sysMsgs];
    const newFrozen = [];

    // 1. 原位更新或移除已凍結的訊息
    for (let i = 0; i < CacheState.frozenSequence.length; i++) {
        const item = CacheState.frozenSequence[i];
        
        if (item.type === 'sys') {
            let bestIdx = -1;
            let bestScore = 0;
            for (let j = 0; j < sysMsgsPool.length; j++) {
                const score = getSimilarity(item.norm, sysMsgsPool[j].norm);
                if (score > bestScore) { bestScore = score; bestIdx = j; }
            }
            
            if (bestScore === 1) {
                newFrozen.push(item);
                sysMsgsPool.splice(bestIdx, 1);
                Logger.log(`[不變] 原位凍結提示詞保留: ${item.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DEBUG);
            } else if (bestScore > 0.6) { 
                const matchedItem = sysMsgsPool[bestIdx];
                newFrozen.push(matchedItem);
                sysMsgsPool.splice(bestIdx, 1);
                Logger.log(`[修改] 原位提示詞內容更新 (相似度 ${(bestScore*100).toFixed(1)}%): ${matchedItem.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DETAILED);
            } else {
                Logger.log(`[刪除] 檢測到提示詞被刪除，自動抽出上移補位: ${item.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DETAILED);
            }
        } else {
            newFrozen.push(item);
        }
    }

    // 2. 處理歷史對話的追加與 AI 補全
    let lastFrozenUserNorm = null;
    for (let i = newFrozen.length - 1; i >= 0; i--) {
        if (newFrozen[i].type === 'user') { lastFrozenUserNorm = newFrozen[i].norm; break; }
    }

    let startIdx = 0;
    if (lastFrozenUserNorm) {
        for (let i = 0; i < stHistoryTurns.length; i++) {
            if (stHistoryTurns[i].user.norm === lastFrozenUserNorm) {
                startIdx = i + 1;
                if (stHistoryTurns[i].assistant) {
                    const cleanAssistant = stripPrefillFromAssistant(stHistoryTurns[i].assistant, CacheState.lastPrefills || []);
                    let aiUpdated = false;
                    for (let k = newFrozen.length - 1; k >= 0; k--) {
                        if (newFrozen[k].type === 'sys') break;
                        if (newFrozen[k].type === 'user') {
                            if (!aiUpdated) {
                                newFrozen.splice(k + 1, 0, createMsg(cleanAssistant, 'ai'));
                                Logger.log(`[補全] 歷史AI回覆已徹底凍結: ${cleanAssistant.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DETAILED);
                            }
                            break;
                        }
                        if (newFrozen[k].type === 'ai') {
                            newFrozen[k] = createMsg(cleanAssistant, 'ai');
                            aiUpdated = true;
                            break;
                        }
                    }
                }
                break;
            }
        }
    }

    // 追加全新的歷史對話
    for (let i = startIdx; i < stHistoryTurns.length; i++) {
        const turn = stHistoryTurns[i];
        newFrozen.push(createMsg(turn.user, 'user'));
        Logger.log(`[追加] 新一輪 User 已凍結: ${turn.user.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DETAILED);
        if (turn.assistant) {
            const cleanAssistant = stripPrefillFromAssistant(turn.assistant, CacheState.lastPrefills || []);
            newFrozen.push(createMsg(cleanAssistant, 'ai'));
            Logger.log(`[追加] 新一輪 AI 已徹底凍結: ${cleanAssistant.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DETAILED);
        }
    }

    // 3. 將新增的提示詞附加於尾部
    for (let sys of sysMsgsPool) {
        newFrozen.push(sys);
        Logger.log(`[新增] 全新提示詞已附加於序列尾部: ${sys.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DETAILED);
    }

    CacheState.frozenSequence = newFrozen;
    CacheState.pendingCurrentTurn = stCurrentTurn;
    CacheState.lastPrefills = stCurrentTurn.prefills;
}

// ==========================================
// 嚴格去重機制 (僅限系統提示詞)
// ==========================================
function deduplicateAndAssemble(frozenSeq, pendingTurn) {
    const final = [];
    const seenSysNorms = new Set();

    const addItems = (items) => {
        for (const item of items) {
            if (item.type === 'sys' || item.role === 'system') {
                const norm = item.norm || Logger.normalize(item.content);
                if (seenSysNorms.has(norm)) {
                    Logger.log(`[去重] 移除了完全重複的系統提示詞/世界書`, LogLevels.DEBUG);
                    continue; 
                }
                seenSysNorms.add(norm);
            }
            final.push(item);
        }
    };

    addItems(frozenSeq);
    if (pendingTurn) {
        if (pendingTurn.user) addItems([{...pendingTurn.user, type: 'user'}]);
        if (pendingTurn.prefills) addItems(pendingTurn.prefills.map(p => ({...p, type: 'ai'})));
    }
    return final;
}

// ==========================================
// 攔截主入口與 10% 緩存防護機制
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        Logger.log(`==============================`);
        Logger.log(`[請求] 開始處理並構建緩存前綴...`);

        if (!data?.chat?.length) return;
        const stream = data.chat;

        const { sysMsgs, stHistoryTurns, stCurrentTurn } = parseSTStream(stream);

        // 核心同步
        syncSequence(sysMsgs, stHistoryTurns, stCurrentTurn);
        
        // 組裝與去重
        const candidateFinal = deduplicateAndAssemble(CacheState.frozenSequence, CacheState.pendingCurrentTurn);

        // ==========================================
        // 10% 緩存流失檢測 (Prefix Match Algorithm)
        // ==========================================
        if (CacheState.lastSentSequence && CacheState.lastSentSequence.length > 0) {
            let commonLen = 0;
            let totalPrevLen = 0;
            let match = true;

            for (let i = 0; i < Math.max(CacheState.lastSentSequence.length, candidateFinal.length); i++) {
                const prev = CacheState.lastSentSequence[i] ? CacheState.lastSentSequence[i].norm : null;
                const curr = candidateFinal[i] ? (candidateFinal[i].norm || Logger.normalize(candidateFinal[i].content)) : null;

                if (prev) totalPrevLen += prev.length;

                if (match && prev === curr && prev !== null) {
                    commonLen += prev.length;
                } else {
                    match = false; // KV Cache 從這裡開始斷裂
                }
            }

            if (totalPrevLen > 0) {
                const lossRatio = 1 - (commonLen / totalPrevLen);
                if (lossRatio >= 0.10) { 
                    if (CacheState.showResetPrompt) {
                        const ok = confirm(`🚨 [Deepseek 緩存優化] 🚨\n\n檢測到變動將導致 Deepseek 緩存流失 ${(lossRatio * 100).toFixed(1)}% (已達10%閾值)！\n這通常是因為修改了頂層預設、大幅刪改了世界書，或破壞了歷史對話順序。\n\n▶ 點擊【確定】：重置緩存前綴，將當前狀態作為新對話重新處理 (推薦，保持高命中率)。\n▶ 點擊【取消】：不重置，強行發送 (容忍本次變動與重算延遲)。`);
                        
                        if (ok) {
                            Logger.warn(`[重置] 用戶確認重置。緩存流失率: ${(lossRatio * 100).toFixed(1)}%`, LogLevels.BASIC);
                            performReset(); // 會清空 lastSentSequence
                            return interceptAndRestructurePrompt(data); // 當作全新對話重新處理
                        } else {
                            Logger.warn(`[取消] 用戶容忍了 ${(lossRatio * 100).toFixed(1)}% 的緩存流失，強行發送。`, LogLevels.BASIC);
                        }
                    } else {
                        Logger.warn(`[緩存檢測] 預估緩存流失 ${(lossRatio * 100).toFixed(1)}%，但阻斷彈窗已關閉。`, LogLevels.BASIC);
                    }
                } else if (lossRatio > 0) {
                    Logger.log(`[緩存檢測] 預估緩存流失 ${(lossRatio * 100).toFixed(1)}%，未達 10% 彈窗閾值，平滑放行。`, LogLevels.DETAILED);
                } else {
                    Logger.log(`[緩存檢測] 序列與前次 100% 完美銜接，緩存命中率極大化！`, LogLevels.DETAILED);
                }
            }
        }

        // 保存供下次檢測
        CacheState.lastSentSequence = candidateFinal.map(m => ({ norm: m.norm || Logger.normalize(m.content) }));
        
        // 替換 ST 的發送陣列
        stream.splice(0, stream.length, ...candidateFinal.map(m => ({ role: m.role, content: m.content })));

    } catch (err) {
        Logger.error('攔截器發生錯誤', err);
        throw err;
    }
}

// ==========================================
// 即時修改提醒機制 (Debounce + 廣泛 DOM Delegation)
// ==========================================
let warningTimeout = null;
function triggerWarning(msg, toggle) {
    if (!CacheState.enabled || !toggle) return;
    if (warningTimeout) clearTimeout(warningTimeout);
    warningTimeout = setTimeout(() => {
        if (typeof toastr !== 'undefined') toastr.warning(msg, '⚠️ 緩存狀態變更', { timeOut: 3000 });
    }, 800);
}

// ==========================================
// 輔助 UI 與 初始化
// ==========================================
function performReset() {
    CacheState.frozenSequence = [];
    CacheState.pendingCurrentTurn = null;
    CacheState.lastPrefills = [];
    CacheState.lastSentSequence = null; 
    Logger.warn('[重置] 所有緩存狀態已清空', LogLevels.BASIC);
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Deepseek 缓存优化 (v7.1 嚴格去重防護版)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">嚴格限制系統提示詞唯一，具備 10% 緩存流失自適應阻斷防護。</p>
                <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" checked> 啟用插件總開關</label>
                <div style="margin:5px 0 10px 15px; border-left: 2px solid #555; padding-left: 10px;">
                    <label class="checkbox_label" style="font-size:0.9em;"><input type="checkbox" id="ds-toast-sys" checked> 預設/提示詞修改即時彈窗</label>
                    <label class="checkbox_label" style="font-size:0.9em;"><input type="checkbox" id="ds-toast-lore" checked> 世界書修改即時彈窗</label>
                    <label class="checkbox_label" style="font-size:0.9em;"><input type="checkbox" id="ds-toast-his" checked> 歷史對話修改即時彈窗</label>
                    <label class="checkbox_label" style="font-size:0.9em;"><input type="checkbox" id="ds-toast-reset" checked> >10% 緩存流失重置阻斷彈窗</label>
                </div>
                
                <div style="margin:8px 0; display:flex; align-items:center;">
                    <span style="font-size:0.9em; margin-right:5px;">日誌等級:</span>
                    <select id="ds-cache-loglevel" class="text_pole" style="width:auto;">
                        <option value="0">關閉</option><option value="1">簡要</option>
                        <option value="2">詳細</option><option value="3" selected>深度解析(推薦)</option>
                    </select>
                </div>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:5px 0;">🔄 強制重置緩存前綴</button>
                <button id="ds-cache-clearlog" class="menu_button" style="width:100%;margin:5px 0;">🗑️ 清空日誌</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:250px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;white-space:pre-wrap;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');

        $('#ds-cache-enable').on('change', function () { CacheState.enabled = $(this).is(':checked'); });
        $('#ds-toast-sys').on('change', function () { CacheState.toastSys = $(this).is(':checked'); });
        $('#ds-toast-lore').on('change', function () { CacheState.toastLore = $(this).is(':checked'); });
        $('#ds-toast-his').on('change', function () { CacheState.toastHistory = $(this).is(':checked'); });
        $('#ds-toast-reset').on('change', function () { CacheState.showResetPrompt = $(this).is(':checked'); });
        
        $('#ds-cache-loglevel').on('change', function () { logLevel = parseInt($(this).val()); });
        $('#ds-cache-reset').on('click', () => { performReset(); if (typeof toastr !== 'undefined') toastr.success("已重置緩存"); });
        $('#ds-cache-clearlog').on('click', () => { if (Logger._uiTextarea) Logger._uiTextarea.value = ''; });
        
        logLevel = 3; 
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
// 啟動與全局事件綁定
// ==========================================
jQuery(async () => {
    await setupUI();
    setTimeout(registerMenuItems, 2000); 

    if (eventSource) {
        if (event_types?.CHAT_COMPLETION_PROMPT_READY) {
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        }
        if (event_types?.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, () => triggerWarning('刪除歷史對話將引發緩存陣列重組！', CacheState.toastHistory));
        if (event_types?.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, () => triggerWarning('修改歷史對話將引發緩存陣列重組！', CacheState.toastHistory));
        if (event_types?.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, () => triggerWarning('切換歷史對話將引發緩存陣列重組！', CacheState.toastHistory));
    }

    // 廣泛 DOM 委託監聽：精準捕獲預設與世界書
    $(document).on('input', 'textarea, input[type="text"]', function(e) {
        if (!CacheState.enabled) return;
        const $el = $(e.target);
        const id = e.target.id || '';
        const className = e.target.className || '';
        
        // Chat Completion Presets, Advanced Formatting 等
        if (id.includes('prompt') || id.includes('system') || id.includes('jailbreak') || $el.closest('#advanced-formatting-popup').length || $el.closest('#chat_completion_settings').length) {
            triggerWarning('修改預設或系統提示詞將更新緩存陣列！', CacheState.toastSys);
        }
        // 世界書 (Lorebook / World Info)
        else if (id.includes('wi_') || className.includes('wi-') || $el.closest('#wi-popup').length || $el.closest('.world_info').length) {
            triggerWarning('修改世界書將更新緩存陣列！', CacheState.toastLore);
        }
    });
    
    Logger.log('══════ v7.1 極致去重防護版 就緒 ══════', LogLevels.BASIC);
});
