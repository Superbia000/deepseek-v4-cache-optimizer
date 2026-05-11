import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 狀態與設定
// ==========================================
let Settings = {};

function initSettings() {
    if (!extension_settings.ds_cache_v12) {
        extension_settings.ds_cache_v12 = {
            enabled: true,
            toastSys: true,
            toastLore: true,
            toastHistory: true,
            showResetPrompt: true,
            logLevel: 3,
            chats: {} 
        };
    }
    Settings = extension_settings.ds_cache_v12;
    if (!Settings.chats) Settings.chats = {}; 
}

function safeSave() {
    try {
        if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
    } catch (e) {
        console.warn("[DS Cache] 存檔失敗", e);
    }
}

// ==========================================
// 深度日誌系統
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function logAt(level, type, msg) {
    if (Settings.logLevel < level) return;
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
    const fullMsg = `[${time}] ${msg}`;
    
    if (type === 'warn') console.warn(`%c[DS Cache v12] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    else if (type === 'error') console.error(`[DS Cache v12] 🔴 ${msg}`);
    else if (type === 'map') console.log(`%c[DS Cache v12] 🗺️ ${msg}`, 'color: #00e5ff; font-weight: bold;');
    else console.log(`%c[DS Cache v12] ✅ ${msg}`, 'color: #00ff00;');
    
    if (Logger._uiTextarea) {
        Logger._uiTextarea.value += fullMsg + '\n';
        Logger._uiTextarea.scrollTop = Logger._uiTextarea.scrollHeight;
    }
}

const Logger = {
    _uiTextarea: null,
    log: (msg, level = LogLevels.DETAILED) => logAt(level, 'log', msg),
    warn: (msg, level = LogLevels.BASIC) => logAt(level, 'warn', msg),
    map: (msg, level = LogLevels.BASIC) => logAt(level, 'map', msg),
    error: (msg, err, level = LogLevels.BASIC) => logAt(level, 'error', err ? `${msg} ${err}` : msg),
    normalize: (text) => text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
    getSeqString: (seq) => seq.map(m => `[${m.tag}]`).join(' ➔ ')
};

// ==========================================
// 狀態管理與擴展菜單
// ==========================================
function getChatKey() {
    const context = getContext();
    let charName = "Unknown";
    if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
        charName = context.characters[context.characterId].name || context.characterId;
    } else if (context.name2) charName = context.name2;
    let chatId = context.chatId || "default_chat";
    let groupId = context.groupId;
    if (groupId) return { key: `group_${groupId}_${chatId}`, label: `群組: ${chatId}` };
    return { key: `char_${context.characterId}_${chatId}`, label: `角色: ${charName} | 存檔: ${chatId}` };
}

function getChatState(chatKeyInfo) {
    if (!Settings.chats[chatKeyInfo.key]) {
        Settings.chats[chatKeyInfo.key] = { label: chatKeyInfo.label, frozenSequence: [], lastSentSequence: [], lastPrefills: [] };
        safeSave(); renderChatsUI();
    }
    return Settings.chats[chatKeyInfo.key];
}

function addTopMenuButton() {
    if ($('#ds-top-reset-btn').length === 0) {
        const btn = $(`<li id="ds-top-reset-btn" class="menu_button interactable" title="重置當前 DS 緩存排序"><span class="fa-solid fa-rotate-right"></span> 廠級清空 DS 緩存</li>`);
        btn.on('click', () => {
            if(!confirm("確定要完全清空當前聊天的緩存排序狀態嗎？(這將使所有提示詞回到 ST 預設的頂部排序)")) return;
            const key = getChatKey().key;
            delete Settings.chats[key];
            safeSave(); renderChatsUI();
            if (typeof toastr !== 'undefined') toastr.success("當前聊天的緩存排序已清空！", "DS Cache");
            Logger.warn(`[手動觸發] 用戶清空了當前存檔: ${key}`);
        });
        if ($('ul#extensions_menu').length > 0) $('ul#extensions_menu').append(btn);
        else if ($('#right-nav-extensions').length > 0) $('#right-nav-extensions').append(btn);
    }
}

// ==========================================
// 核心工具
// ==========================================
function createMsg(msg, tag) {
    const content = msg.content || '';
    return { role: msg.role, content: content, norm: Logger.normalize(content), len: content.length, tag: tag };
}

function getSimilarity(str1, str2) {
    if (str1 === str2) return 1;
    if (Math.abs(str1.length - str2.length) > Math.max(str1.length, str2.length) * 0.5) return 0;
    const s1 = str1.length < str2.length ? str1 : str2;
    const s2 = str1.length < str2.length ? str2 : str1;
    if (s1.length === 0) return 0;
    const bigrams = new Set();
    for (let i = 0; i < s1.length - 1; i++) bigrams.add(s1.substring(i, i+2));
    let matchCount = 0;
    for (let i = 0; i < s2.length - 1; i++) if (bigrams.has(s2.substring(i, i+2))) matchCount++;
    const union = (s1.length - 1) + (s2.length - 1) - matchCount;
    return union <= 0 ? 1 : matchCount / union;
}

function stripPrefillFromAssistant(assistantObj, prefills) {
    if (!assistantObj || !prefills || prefills.length === 0) return assistantObj;
    let content = assistantObj.content || '';
    let modified = false;
    for (const p of prefills) {
        const pContent = p.content || '';
        if (content.startsWith(pContent)) { content = content.substring(pContent.length); modified = true; }
    }
    if (modified) {
        content = content.replace(/^[\s\n]+/, ''); 
        return { ...assistantObj, content: content, norm: Logger.normalize(content), len: content.length };
    }
    return assistantObj;
}

function parseSTStream(stream) {
    const sysMsgs = [];
    const chatMsgs = [];
    for (const msg of stream) {
        const isSys = (msg.role === 'system' || (msg.role !== 'user' && msg.role !== 'assistant'));
        if (isSys) sysMsgs.push(createMsg(msg, 'SYS'));
        else chatMsgs.push(createMsg(msg, msg.role === 'user' ? 'USER' : 'AI'));
    }

    let lastUserIdx = -1;
    for (let i = chatMsgs.length - 1; i >= 0; i--) { if (chatMsgs[i].tag === 'USER') { lastUserIdx = i; break; } }

    let historyTurns = [];
    let currentTurn = { user: null, prefills: [] };

    if (lastUserIdx === -1) {
        currentTurn.prefills = chatMsgs.filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'}));
    } else {
        const hMsgs = chatMsgs.slice(0, lastUserIdx);
        const cMsgs = chatMsgs.slice(lastUserIdx);
        currentTurn.user = cMsgs[0];
        currentTurn.prefills = cMsgs.slice(1).filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'}));

        let curUser = null;
        let curAiContents = [];
        for (const msg of hMsgs) {
            if (msg.tag === 'USER') {
                if (curUser) historyTurns.push({ user: curUser, assistant: curAiContents.length ? createMsg({role: 'assistant', content: curAiContents.join('\n')}, 'AI') : null });
                curUser = msg;
                curAiContents = [];
            } else if (msg.tag === 'AI') curAiContents.push(msg.content);
        }
        if (curUser) historyTurns.push({ user: curUser, assistant: curAiContents.length ? createMsg({role: 'assistant', content: curAiContents.join('\n')}, 'AI') : null });
    }
    return { sysMsgs, historyTurns, currentTurn };
}

// ==========================================
// 異步 UI 攔截器
// ==========================================
function askUserForResetAsync(dropPercent, mapInfo) {
    return new Promise(resolve => {
        const overlay = $('<div style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);z-index:999999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px);"></div>');
        const box = $('<div style="background:#1e1e1e;border:2px solid #f44336;padding:25px;border-radius:12px;max-width:600px;text-align:center;color:#fff;font-size:15px;box-shadow: 0 10px 25px rgba(0,0,0,0.8);font-family:sans-serif;"></div>');
        
        const title = $('<h2 style="color:#f44336;margin-top:0;">🚨 緩存斷裂預警 (原位同步中) 🚨</h2>');
        const text = $(`<p style="text-align:left;line-height:1.6;font-size:14px;">檢測到陣列前排發生了變更。<br>這將導致 KV 緩存鏈條斷裂，預計 <b>${dropPercent}%</b> 的歷史對話緩存將失效並重新運算。<br><br><b>插件已自動完成時序陣列的原位更新與補位。</b>請問要接受本次修改嗎？</p>`);
        
        const mapDiv = $(`<div style="text-align:left; background:#000; padding:10px; border-radius:5px; font-family:monospace; font-size:11px; color:#00e5ff; margin:10px 0; overflow-x:auto;">斷裂詳情：<br>${mapInfo}</div>`);

        const btnContainer = $('<div style="margin-top:25px;display:flex;justify-content:space-between;gap:10px;"></div>');
        
        const btnReset = $('<button style="flex:1;background:#4CAF50;color:white;padding:12px;border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-size:14px;transition:0.2s;">🔄 確認同步<br><span style="font-size:11px;font-weight:normal;">(接受原位修改並發送)</span></button>');
        const btnAbort = $('<button style="flex:1;background:#f44336;color:white;padding:12px;border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-size:14px;transition:0.2s;">🛑 攔截發送<br><span style="font-size:11px;font-weight:normal;">(中止生成去復原)</span></button>');

        [btnReset, btnAbort].forEach(b => b.hover(function(){$(this).css('opacity','0.8')}, function(){$(this).css('opacity','1')}));

        btnReset.click(() => { overlay.remove(); resolve('reset'); });
        btnAbort.click(() => { overlay.remove(); resolve('abort'); });

        btnContainer.append(btnReset, btnAbort);
        box.append(title, text, mapDiv, btnContainer);
        overlay.append(box);
        $('body').append(overlay);
    });
}

// ==========================================
// 核心處理器 (v12 統一對象池映射引擎)
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (!Settings.enabled || data.dryRun) return;

    try {
        const chatKeyInfo = getChatKey();
        let state = getChatState(chatKeyInfo);
        if (!data?.chat?.length) return;
        const stream = data.chat;

        const { sysMsgs, historyTurns, currentTurn } = parseSTStream(stream);
        Logger.log(`=================================================`, LogLevels.BASIC);

        // 建立 ST 當前的扁平歷史池
        const flatHistoryPool = [];
        for(let t of historyTurns) {
            flatHistoryPool.push(t.user);
            if(t.assistant) flatHistoryPool.push(stripPrefillFromAssistant(t.assistant, state.lastPrefills));
        }

        let rawFrozenSequence = [];
        const sysMsgsPool = [...sysMsgs];
        const remainingHistory = [...flatHistoryPool];
        
        // ---------------------------------------------------------
        // 第一階段：遍歷凍結陣列，進行原位同步 (SYS/USER/AI)
        // ---------------------------------------------------------
        for (let i = 0; i < state.frozenSequence.length; i++) {
            const item = state.frozenSequence[i];
            
            if (item.tag === 'SYS') {
                let bestIdx = -1, bestScore = 0;
                for (let j = 0; j < sysMsgsPool.length; j++) {
                    const score = getSimilarity(item.norm, sysMsgsPool[j].norm);
                    if (score > bestScore) { bestScore = score; bestIdx = j; }
                }
                if (bestScore === 1) { 
                    rawFrozenSequence.push(sysMsgsPool[bestIdx]); 
                    sysMsgsPool.splice(bestIdx, 1); 
                } else if (bestScore > 0.2) { // 寬容度極高的原位修改檢測
                    const matchedItem = sysMsgsPool[bestIdx];
                    rawFrozenSequence.push(matchedItem); 
                    sysMsgsPool.splice(bestIdx, 1);
                    Logger.warn(`[SYS 同步] 原位修改: ${matchedItem.content.substring(0,20).replace(/\n/g, '')}...`, LogLevels.DEBUG);
                } else {
                    Logger.warn(`[SYS 同步] 原位刪除: 某提示詞被移除，後方陣列自動上移。`, LogLevels.DEBUG);
                }
            } 
            else if (item.tag === 'USER' || item.tag === 'AI') {
                let bestIdx = -1, bestScore = 0;
                for (let j = 0; j < remainingHistory.length; j++) {
                    if (item.tag !== remainingHistory[j].tag) continue;
                    const score = getSimilarity(item.norm, remainingHistory[j].norm);
                    if (score > bestScore) { bestScore = score; bestIdx = j; }
                }
                if (bestScore > 0.3) {
                    rawFrozenSequence.push(remainingHistory[bestIdx]);
                    remainingHistory.splice(bestIdx, 1);
                } else {
                    Logger.warn(`[歷史同步] 偵測到歷史對話被刪除，自動抽出上移補位。`, LogLevels.DEBUG);
                }
            }
        }

        // ---------------------------------------------------------
        // 第二階段：附加新生代數據 (保持交錯排序)
        // ---------------------------------------------------------
        // 1. 附加新產生的歷史對話 (對話1的AI回覆等)
        for (let h of remainingHistory) {
            rawFrozenSequence.push(h);
        }

        // 2. 附加新產生的 SYS 提示詞 (新增加的世界書/預設) -> 完美排在對話2的User前面
        for (let sys of sysMsgsPool) {
            rawFrozenSequence.push(sys);
            Logger.log(`[SYS 同步] 新增提示詞附加至歷史尾部: ${sys.content.substring(0,20).replace(/\n/g, '')}...`, LogLevels.DEBUG);
        }

        // 去重
        let dedupedSequence = [];
        const seenSysNorms = new Set();
        for (const item of rawFrozenSequence) {
            if (item.tag === 'SYS') {
                if (seenSysNorms.has(item.norm)) continue;
                seenSysNorms.add(item.norm);
            }
            dedupedSequence.push(item);
        }

        // 構建擬態流 (包含當前回合用戶輸入與預填充)
        const proposedStream = [...dedupedSequence];
        if (currentTurn.user) proposedStream.push(currentTurn.user);
        for (const p of currentTurn.prefills) proposedStream.push(p);

        Logger.map(`當前時序拓撲圖: \n${Logger.getSeqString(proposedStream)}`, LogLevels.BASIC);

        // ---------------------------------------------------------
        // 第三階段：智能防誤報 KV 緩存斷裂計算器
        // ---------------------------------------------------------
        let requireResetConfirm = false;
        let dropPercentStr = "0.0";
        let mapInfoText = "無變更";

        if (state.lastSentSequence && state.lastSentSequence.length > 0) {
            const L = state.lastSentSequence;
            const P = proposedStream;

            let breakIndex = -1;
            for (let i = 0; i < Math.min(L.length, P.length); i++) {
                if (L[i].role !== P[i].role || L[i].norm !== P[i].norm) {
                    breakIndex = i; break;
                }
            }
            if (breakIndex === -1) breakIndex = P.length;

            let isPureContextShift = false;
            if (breakIndex < L.length && breakIndex < P.length) {
                let isAtHistoryStart = true;
                for (let i = 0; i < breakIndex; i++) {
                    if (L[i].tag !== 'SYS' && L[i].role !== 'system') { isAtHistoryStart = false; break; }
                }
                if (isAtHistoryStart) {
                    for (let x = breakIndex + 1; x < L.length; x++) {
                        if (L[x].role === P[breakIndex].role && L[x].norm === P[breakIndex].norm) {
                            let deletedBlocks = L.slice(breakIndex, x);
                            let deletedSys = deletedBlocks.filter(m => m.tag === 'SYS' || m.role === 'system');
                            if (deletedSys.length === 0) isPureContextShift = true; 
                            break;
                        }
                    }
                }
            }

            let wastedTokensLen = 0;
            let proposedTotalLen = 0;
            for (let i = 0; i < P.length; i++) {
                proposedTotalLen += (P[i].content?.length || 0);
                if (i >= breakIndex) {
                    let foundInL = L.some(oldM => oldM.role === P[i].role && oldM.norm === P[i].norm);
                    if (foundInL) wastedTokensLen += (P[i].content?.length || 0);
                }
            }

            if (isPureContextShift) {
                wastedTokensLen = 0; 
                Logger.log(`[緩存分析] 偵測到自然對話推移，智能抑制彈窗`, LogLevels.DEBUG);
            }

            let dropRatio = proposedTotalLen === 0 ? 0 : (wastedTokensLen / proposedTotalLen);
            
            if (dropRatio > 0.10 && Settings.showResetPrompt) {
                requireResetConfirm = true;
                dropPercentStr = (dropRatio * 100).toFixed(1);
                mapInfoText = `斷裂點位於索引 [${breakIndex}] (${P[breakIndex]?.tag})\n原文: ${L[breakIndex]?.content?.substring(0,30)}\n現狀: ${P[breakIndex]?.content?.substring(0,30)}`;
                Logger.warn(`檢測到緩存流失 ${dropPercentStr}%，準備攔截...`, LogLevels.BASIC);
            }
        }

        // ---------------------------------------------------------
        // 第四階段：決策與覆蓋 (v12 核心修復區)
        // ---------------------------------------------------------
        let decision = 'ignore';
        if (requireResetConfirm) {
            decision = await askUserForResetAsync(dropPercentStr, mapInfoText);
        }

        if (decision === 'abort') {
            Logger.warn('[發送已攔截] 清空流數據以強制中止生成', LogLevels.BASIC);
            if (typeof toastr !== 'undefined') toastr.error("已強制攔截本次請求！請復原提示詞。", "緩存防護");
            stream.splice(0, stream.length); 
            return;
        }

        if (decision === 'reset') {
            // 【v12 史詩修復】：絕對不再打亂 dedupedSequence！
            // 用戶點擊了「確認同步」，代表接受緩存流失，我們直接讓已經排好序的 dedupedSequence 生效！
            Logger.warn('[確認同步] 用戶接受緩存流失，已按時序規則原位更新/增刪提示詞。', LogLevels.BASIC);
        }

        // 寫入最終狀態
        state.frozenSequence = dedupedSequence;
        state.lastPrefills = currentTurn.prefills;

        const finalStream = [...state.frozenSequence];
        if (currentTurn.user) finalStream.push(currentTurn.user);
        for (const p of currentTurn.prefills) finalStream.push(p);

        state.lastSentSequence = finalStream;
        safeSave();

        stream.splice(0, stream.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
        Logger.log('✅ 數據排序整理完成，授權發送。', LogLevels.BASIC);

    } catch (err) {
        Logger.error('攔截器發生錯誤', err);
        throw err;
    }
}

// ==========================================
// 提醒機制與 UI
// ==========================================
let warningTimeout = null;
function triggerWarning(msg, toggle) {
    if (!Settings.enabled || !toggle) return;
    if (warningTimeout) clearTimeout(warningTimeout);
    warningTimeout = setTimeout(() => {
        if (typeof toastr !== 'undefined') toastr.warning(msg, '⚠️ 提示詞狀態變更', { timeOut: 3000 });
    }, 300); 
}

function renderChatsUI() {
    const container = $('#ds-chat-list-container');
    if (container.length === 0) return;
    container.empty();
    
    const keys = Object.keys(Settings.chats);
    if (keys.length === 0) {
        container.append('<p style="font-size:0.85em; opacity:0.6;">尚無接管的存檔數據。</p>');
        return;
    }

    keys.forEach(key => {
        const chat = Settings.chats[key];
        const html = `
            <div style="display:flex; justify-content:space-between; align-items:center; background:#222; padding:5px; margin-bottom:5px; border-radius:4px;">
                <span style="font-size:0.85em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:75%;" title="${chat.label}">${chat.label}</span>
                <button class="menu_button interactable ds-reset-btn" data-key="${key}" style="font-size:0.8em; padding:2px 5px;">清空</button>
            </div>
        `;
        container.append(html);
    });

    container.find('.ds-reset-btn').on('click', function() {
        const key = $(this).data('key');
        delete Settings.chats[key];
        safeSave(); renderChatsUI();
        if (typeof toastr !== 'undefined') toastr.success("已清空該存檔排序");
    });
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Deepseek 缓存优化 (v12.0 絕對時序原位同步版)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}> 啟用時序引擎</label>
                
                <div style="margin:5px 0 10px 15px; border-left: 2px solid #555; padding-left: 10px;">
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-sys" ${Settings.toastSys ? 'checked' : ''}> 提示詞修改彈窗</label>
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-lore" ${Settings.toastLore ? 'checked' : ''}> 世界書修改彈窗</label>
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-his" ${Settings.toastHistory ? 'checked' : ''}> 歷史對話修改彈窗</label>
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-reset" ${Settings.showResetPrompt ? 'checked' : ''}> 10% 異步攔截阻斷器</label>
                </div>
                
                <div style="margin:8px 0; display:flex; align-items:center;">
                    <span style="font-size:0.85em; margin-right:5px;">日誌等級:</span>
                    <select id="ds-cache-loglevel" class="text_pole" style="width:auto;">
                        <option value="0" ${Settings.logLevel===0?'selected':''}>關閉</option>
                        <option value="1" ${Settings.logLevel===1?'selected':''}>拓撲圖與簡要</option>
                        <option value="2" ${Settings.logLevel===2?'selected':''}>詳細追蹤</option>
                        <option value="3" ${Settings.logLevel===3?'selected':''}>極限除錯</option>
                    </select>
                </div>

                <hr style="border-color:#444; margin:10px 0;">
                <b style="font-size:0.9em;">📂 存檔緩存管理區：</b>
                <div id="ds-chat-list-container" style="max-height:150px; overflow-y:auto; margin:5px 0; border:1px solid #444; padding:5px;"></div>
                
                <button id="ds-cache-factory-reset" class="menu_button" style="width:100%;margin:5px 0;background:#722;">⚠️ 清空所有存檔數據 (還原 ST 默認排序)</button>
                <button id="ds-cache-clearlog" class="menu_button" style="width:100%;margin:5px 0;">🗑️ 清空日誌面板</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:180px;background:#0d0d0d;color:#00e5ff;font-family:Consolas,monospace;font-size:10px;white-space:pre-wrap;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');

        $('#ds-cache-enable').on('change', function () { Settings.enabled = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-sys').on('change', function () { Settings.toastSys = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-lore').on('change', function () { Settings.toastLore = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-his').on('change', function () { Settings.toastHistory = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-reset').on('change', function () { Settings.showResetPrompt = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-loglevel').on('change', function () { Settings.logLevel = parseInt($(this).val()); safeSave(); });
        
        $('#ds-cache-factory-reset').on('click', () => {
            if (confirm("這將使所有提示詞回到 ST 預設的頂部排序！確定要清除嗎？")) { Settings.chats = {}; safeSave(); renderChatsUI(); }
        });
        $('#ds-cache-clearlog').on('click', () => { if (Logger._uiTextarea) Logger._uiTextarea.value = ''; });
        
        renderChatsUI();
    } catch (e) { console.error('[DS Cache] UI初始化失敗', e); }
}

jQuery(async () => {
    try {
        initSettings(); 
        await setupUI();
        
        setTimeout(addTopMenuButton, 2000);
        if (eventSource) eventSource.on(event_types.CHAT_CHANGED, addTopMenuButton);

        if (eventSource) {
            if (event_types?.CHAT_COMPLETION_PROMPT_READY) {
                eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
            }
            if (event_types?.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, () => triggerWarning('歷史對話被刪除！將在原位進行補位。', Settings.toastHistory));
            if (event_types?.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, () => triggerWarning('歷史對話已修改！將在原位進行熱更新。', Settings.toastHistory));
        }

        $(document).on('change select2:select input focusout', '#chat_completion_preset, .preset_select, select[id*="preset"], #main_prompt_textarea, #nsfw_prompt_textarea, #jailbreak_prompt_textarea, #rm_ch_sys_prompt', function() {
            triggerWarning('提示詞已變更！將在原位進行熱更新。', Settings.toastSys);
        });

        $(document).on('input change focusout', '.world_info_entry textarea, .world_info_entry input, #world_info_entries_list textarea, .lorebook_entry textarea, .drawer-content textarea', function() {
            triggerWarning('世界書已變更！將在原位進行熱更新/附加。', Settings.toastLore);
        });

        Logger.log('══════ v12.0 絕對時序原位同步版 就緒 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件啟動崩潰:', e);
    }
});
