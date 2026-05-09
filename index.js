import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日誌系統 (強化版)
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };
let logLevel = 2;

function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const fullMsg = `[${time}] ${msg}`;
    if (type === 'warn') {
        console.warn(`%c[DS Cache v7.0] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS Cache v7.0] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS Cache v7.0] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
    toastSys: true,       // 預設提示詞修改彈窗
    toastLore: true,      // 世界書修改彈窗
    toastHistory: true,   // 歷史對話修改彈窗
    showResetPrompt: true,// 破壞性重置確認彈窗
    
    frozenSequence: [],   // 平鋪陣列: [{role, content, norm, type: 'sys'|'user'|'ai'}]
    pendingCurrentTurn: null, 
    lastPrefills: []      // 紀錄上一次的預填充，用於下次凍結時裁切
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
// 核心：平鋪同步演算法 (嚴格排序)
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
            } else if (bestScore > 0.6) { // 允許 60% 相似度即視為原位修改
                const matchedItem = sysMsgsPool[bestIdx];
                newFrozen.push(matchedItem);
                sysMsgsPool.splice(bestIdx, 1);
                Logger.log(`[修改] 原位提示詞內容更新 (相似度 ${(bestScore*100).toFixed(1)}%): ${matchedItem.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DETAILED);
            } else {
                Logger.log(`[刪除] 檢測到提示詞被刪除，自動抽出上移補位: ${item.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DETAILED);
            }
        } else {
            // User 和 AI 歷史對話，直接保留 (破壞性檢測已在前面處理)
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
                // 補全最後一個凍結 User 的 AI 回覆 (裁切之前的 prefill)
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

    // 3. 將新增的提示詞附加於尾部 (嚴格符合對話2後方插入邏輯)
    for (let sys of sysMsgsPool) {
        newFrozen.push(sys);
        Logger.log(`[新增] 全新提示詞已附加於序列尾部: ${sys.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DETAILED);
    }

    CacheState.frozenSequence = newFrozen;
    CacheState.pendingCurrentTurn = stCurrentTurn;
    CacheState.lastPrefills = stCurrentTurn.prefills;
}

// ==========================================
// 攔截主入口與防破壞機制
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        Logger.log(`==============================`);
        Logger.log(`[請求] 開始處理並構建緩存前綴...`);

        if (!data?.chat?.length) return;
        const stream = data.chat;

        const { sysMsgs, stHistoryTurns, stCurrentTurn } = parseSTStream(stream);

        let requireResetConfirm = false;
        let resetReason = "";

        // 歷史破壞性檢測 (Middle & Large Tail Deletion)
        const stUserNorms = stHistoryTurns.map(t => t.user.norm);
        const frozenUserNorms = CacheState.frozenSequence.filter(m => m.type === 'user').map(m => m.norm);
        
        if (frozenUserNorms.length > 0) {
            let middleDeletion = false;
            let tailDeletionCount = 0;
            
            for (let i = 0; i < frozenUserNorms.length; i++) {
                if (!stUserNorms.includes(frozenUserNorms[i])) {
                    let hasSubsequent = false;
                    for (let j = i + 1; j < frozenUserNorms.length; j++) {
                        if (stUserNorms.includes(frozenUserNorms[j])) { hasSubsequent = true; break; }
                    }
                    if (hasSubsequent) middleDeletion = true;
                    else tailDeletionCount++;
                }
            }

            if (middleDeletion && CacheState.showResetPrompt) {
                requireResetConfirm = true;
                resetReason = "檢測到您刪除了對話歷史中間的訊息！斷點後方的緩存將徹底碎片化。";
            } else if (tailDeletionCount > 0) {
                if (tailDeletionCount >= frozenUserNorms.length * 0.3 && CacheState.showResetPrompt) {
                    requireResetConfirm = true;
                    resetReason = `檢測到歷史被大幅度刪減（${tailDeletionCount} 輪）。`;
                } else {
                    Logger.log(`[自適應修剪] 末端刪除 ${tailDeletionCount} 輪，自動修剪序列尾端，維持 99.9% 命中...`, LogLevels.BASIC);
                    // 找出最後一個存活的 user，截斷陣列
                    const lastAliveUserNorm = stUserNorms[stUserNorms.length - 1];
                    let trimIdx = CacheState.frozenSequence.length;
                    for (let i = CacheState.frozenSequence.length - 1; i >= 0; i--) {
                        if (CacheState.frozenSequence[i].type === 'user') {
                            if (CacheState.frozenSequence[i].norm === lastAliveUserNorm) {
                                // 找到最後存活的對話，找到其對應的 AI 並在其後截斷
                                for(let j = i + 1; j < CacheState.frozenSequence.length; j++){
                                    if(CacheState.frozenSequence[j].type === 'ai') { trimIdx = j + 1; break; }
                                    if(CacheState.frozenSequence[j].type === 'user') { trimIdx = j; break; }
                                }
                                break;
                            }
                        }
                    }
                    if (trimIdx < CacheState.frozenSequence.length) {
                        CacheState.frozenSequence = CacheState.frozenSequence.slice(0, trimIdx);
                    }
                }
            }
        }

        if (requireResetConfirm && CacheState.showResetPrompt) {
            const ok = confirm(`🚨 [Deepseek 緩存優化] 🚨\n\n${resetReason}\n\n▶ 點擊【確定】：徹底重置緩存前綴。\n▶ 點擊【取消】：不重置，強行發送。`);
            if (ok) {
                Logger.warn('[用戶選擇重置] 狀態已強制重置，構建全新序列', LogLevels.BASIC);
                performReset();
                return interceptAndRestructurePrompt(data);
            }
        }

        // 核心同步
        syncSequence(sysMsgs, stHistoryTurns, stCurrentTurn);

        // 重構輸出陣列 (嚴格按照 frozenSequence -> currentTurn)
        const final = [];
        for (const item of CacheState.frozenSequence) {
            final.push({ role: item.role, content: item.content });
        }
        if (CacheState.pendingCurrentTurn.user) {
            final.push({ role: CacheState.pendingCurrentTurn.user.role, content: CacheState.pendingCurrentTurn.user.content });
        }
        for (const p of CacheState.pendingCurrentTurn.prefills) {
            final.push({ role: p.role, content: p.content });
        }

        stream.splice(0, stream.length, ...final);

    } catch (err) {
        Logger.error('攔截器發生錯誤', err);
        throw err;
    }
}

// ==========================================
// 即時修改提醒機制 (Debounce + DOM Delegation)
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
    Logger.warn('[重置] 所有緩存狀態已清空', LogLevels.BASIC);
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Deepseek 缓存优化 (v7.0 序列冻结版)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">嚴格原位凍結，自動辨識新增與刪除，維持 99.99% 命中。</p>
                <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" checked> 啟用插件總開關</label>
                <div style="margin:5px 0 10px 15px; border-left: 2px solid #555; padding-left: 10px;">
                    <label class="checkbox_label" style="font-size:0.9em;"><input type="checkbox" id="ds-toast-sys" checked> 預設/提示詞修改即時彈窗</label>
                    <label class="checkbox_label" style="font-size:0.9em;"><input type="checkbox" id="ds-toast-lore" checked> 世界書修改即時彈窗</label>
                    <label class="checkbox_label" style="font-size:0.9em;"><input type="checkbox" id="ds-toast-his" checked> 歷史對話修改即時彈窗</label>
                    <label class="checkbox_label" style="font-size:0.9em;"><input type="checkbox" id="ds-toast-reset" checked> 破壞性修改阻斷確認彈窗</label>
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
        
        logLevel = 3; // 默認開啟最高級日誌以驗證排序
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
        // 監聽歷史對話修改
        if (event_types?.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, () => triggerWarning('刪除歷史對話將引發緩存陣列重組！', CacheState.toastHistory));
        if (event_types?.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, () => triggerWarning('修改歷史對話將引發緩存陣列重組！', CacheState.toastHistory));
        if (event_types?.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, () => triggerWarning('切換歷史對話將引發緩存陣列重組！', CacheState.toastHistory));
    }

    // DOM 委託監聽：全局捕獲預設、角色卡與世界書打字
    $(document).on('input', '#main_prompt_textarea, #nsfw_prompt_textarea, #rm_ch_sys_prompt, #author_note_textarea', function() {
        triggerWarning('修改核心提示詞將更新對應的凍結位置！', CacheState.toastSys);
    });
    $(document).on('input', '.world_info_entry textarea, .world_info_entry input', function() {
        triggerWarning('修改世界書將更新對應的凍結位置！', CacheState.toastLore);
    });
    
    Logger.log('══════ v7.0 序列凍結版 就緒，排序邏輯已嚴格鎖死 ══════', LogLevels.BASIC);
});
