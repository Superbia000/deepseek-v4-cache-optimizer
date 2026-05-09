import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 核心狀態與設定
// ==========================================
let Settings = {};
const PLUGIN_VERSION = 'v13.0 Ultimate';

function initSettings() {
    if (!extension_settings.ds_cache_v13) {
        extension_settings.ds_cache_v13 = {
            enabled: true,
            toastSys: true,
            toastLore: true,
            toastHistory: true,
            showResetPrompt: true,
            logLevel: 3,
            chats: {} 
        };
    }
    Settings = extension_settings.ds_cache_v13;
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
// 樣式注入 (CSS Injection)
// ==========================================
function injectCSS() {
    if ($('#ds-cache-styles').length === 0) {
        const css = `
        <style id="ds-cache-styles">
            .ds-panel-section { background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 10px; margin-bottom: 12px; }
            .ds-panel-title { font-size: 0.9em; font-weight: bold; color: #aaa; margin-bottom: 8px; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 4px; }
            .ds-log-console { background: #0b0b0d; border: 1px solid #333; border-radius: 6px; height: 220px; overflow-y: auto; padding: 8px; font-family: 'Consolas', monospace; font-size: 11px; line-height: 1.4; }
            .ds-log-line { margin-bottom: 4px; word-wrap: break-word; border-bottom: 1px solid rgba(255,255,255,0.03); padding-bottom: 2px; }
            .ds-c-time { color: #666; }
            .ds-c-info { color: #4CAF50; }
            .ds-c-warn { color: #ffaa00; font-weight: bold; background: rgba(255,170,0,0.1); }
            .ds-c-error{ color: #ff4444; font-weight: bold; }
            .ds-c-map  { color: #00e5ff; }
            .ds-c-debug{ color: #888; }
            .ds-btn { background: #333; color: #fff; border: 1px solid #555; padding: 5px 10px; border-radius: 4px; cursor: pointer; transition: 0.2s; font-size: 0.85em; }
            .ds-btn:hover { background: #444; }
            .ds-btn-danger { background: rgba(244, 67, 54, 0.2); border-color: rgba(244, 67, 54, 0.5); color: #ff8888; }
            .ds-btn-danger:hover { background: rgba(244, 67, 54, 0.4); }
            .ds-chat-item { display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.05); padding: 6px 8px; margin-bottom: 4px; border-radius: 4px; }
            
            /* Modal Styles */
            .ds-modal-overlay { position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); z-index:999999; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(4px); }
            .ds-modal-box { background:#1e1e1e; border:1px solid #f44336; padding:25px; border-radius:12px; max-width:600px; width:90%; box-shadow: 0 15px 35px rgba(0,0,0,0.9); }
            .ds-modal-map { background:#0a0a0a; border: 1px solid #333; padding:12px; border-radius:6px; font-family:monospace; font-size:12px; color:#00e5ff; margin:15px 0; overflow-x:auto; line-height:1.5; }
        </style>`;
        $('head').append(css);
    }
}

// ==========================================
// 富文本日誌系統 (Rich-Text Console)
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function logAt(level, type, msg) {
    if (Settings.logLevel < level) return;
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
    
    // Console output for F12
    if (type === 'warn') console.warn(`[DS Cache] 🌪️ ${msg}`);
    else if (type === 'error') console.error(`[DS Cache] 🔴 ${msg}`);
    else if (type === 'map') console.log(`%c[DS Cache] 🗺️ ${msg}`, 'color: #00e5ff;');
    else console.log(`[DS Cache] ✅ ${msg}`);
    
    // UI Console output
    const consoleEl = $('#ds-cache-log-content');
    if (consoleEl.length > 0) {
        let cssClass = 'ds-c-info';
        let icon = '✅';
        if (type === 'warn') { cssClass = 'ds-c-warn'; icon = '🌪️'; }
        else if (type === 'error') { cssClass = 'ds-c-error'; icon = '🔴'; }
        else if (type === 'map') { cssClass = 'ds-c-map'; icon = '🗺️'; }
        else if (level === LogLevels.DEBUG) { cssClass = 'ds-c-debug'; icon = '🔍'; }

        const safeMsg = msg.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const line = $(`<div class="ds-log-line ${cssClass}"><span class="ds-c-time">[${time}]</span> ${icon} ${safeMsg}</div>`);
        consoleEl.append(line);

        // Keep only last 100 lines to prevent DOM bloat
        if (consoleEl.children().length > 100) consoleEl.children().first().remove();
        consoleEl.scrollTop(consoleEl[0].scrollHeight);
    }
}

const Logger = {
    log: (msg, level = LogLevels.DETAILED) => logAt(level, 'log', msg),
    warn: (msg, level = LogLevels.BASIC) => logAt(level, 'warn', msg),
    map: (msg, level = LogLevels.BASIC) => logAt(level, 'map', msg),
    error: (msg, err, level = LogLevels.BASIC) => logAt(level, 'error', err ? `${msg} ${err}` : msg),
    normalize: (text) => text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
    getSeqString: (seq) => seq.map(m => `[${m.tag}]`).join(' ➔ ')
};

// ==========================================
// 核心工具與效能優化算法
// ==========================================
function createMsg(msg, tag) {
    const content = msg.content || '';
    return { role: msg.role, content: content, norm: Logger.normalize(content), len: content.length, tag: tag };
}

// 智能 Token 估算器 (考慮 CJK 字元)
function estimateTokens(text) {
    if (!text) return 0;
    const cjkMatches = text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || [];
    const latinMatches = text.match(/[a-zA-Z0-9]/g) || [];
    const spaceMatches = text.match(/[\s\n]/g) || [];
    const others = text.length - cjkMatches.length - latinMatches.length - spaceMatches.length;
    // DeepSeek BPE 估算：中文約 1.5 token, 英文約 0.3 token, 其他符號 1 token
    return (cjkMatches.length * 1.5) + (latinMatches.length * 0.3) + (spaceMatches.length * 0.1) + (others * 1.0);
}

// 多級效能優化版相似度對比
function getSimilarity(str1, str2) {
    if (str1 === str2) return 1;
    
    const len1 = str1.length;
    const len2 = str2.length;
    if (len1 === 0 || len2 === 0) return 0;

    // 1. 長度過濾 (Length Prefiltering)
    if (Math.abs(len1 - len2) > Math.max(len1, len2) * 0.4) return 0;

    // 2. 短字串守衛 (Short-string Guard)
    if (len1 < 15 || len2 < 15) return 0; // 短字串必須完全一致 (上面已處理)

    // 3. Bigram 對比
    const s1 = len1 < len2 ? str1 : str2;
    const s2 = len1 < len2 ? str2 : str1;
    const bigrams = new Set();
    for (let i = 0; i < s1.length - 1; i++) bigrams.add(s1.substring(i, i+2));
    
    let matchCount = 0;
    for (let i = 0; i < s2.length - 1; i++) {
        if (bigrams.has(s2.substring(i, i+2))) matchCount++;
    }
    
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

// ==========================================
// 數據流解析與狀態獲取
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
// 優化版 UI 攔截器 (玻璃擬態設計)
// ==========================================
function askUserForResetAsync(dropPercent, mapInfo) {
    return new Promise(resolve => {
        const overlay = $(`<div class="ds-modal-overlay"></div>`);
        const box = $(`
        <div class="ds-modal-box">
            <h2 style="color:#f44336; margin-top:0; font-size: 1.5em; display:flex; align-items:center; gap:10px;">
                <span class="fa-solid fa-triangle-exclamation"></span> 緩存斷裂預警 (原位同步中)
            </h2>
            <p style="text-align:left; line-height:1.6; font-size:14px; color:#ddd;">
                檢測到陣列前排發生了變更。這將導致 KV 緩存鏈條斷裂，預計 <b>${dropPercent}%</b> 的歷史運算量將流失。<br><br>
                <b style="color:#4CAF50;">✅ 插件已自動完成時序陣列的「原位更新」與「自動補位」。</b>請問要接受本次修改嗎？
            </p>
            <div class="ds-modal-map"><b>斷裂詳情：</b><br>${mapInfo}</div>
            <div style="margin-top:25px; display:flex; justify-content:space-between; gap:12px;">
                <button id="ds-btn-accept" style="flex:1; background:#4CAF50; color:white; padding:12px; border:none; border-radius:6px; cursor:pointer; font-weight:bold; font-size:14px; transition:0.2s;">
                    🔄 確認同步<br><span style="font-size:11px; font-weight:normal; opacity:0.8;">(接受原位修改並發送)</span>
                </button>
                <button id="ds-btn-abort" style="flex:1; background:#f44336; color:white; padding:12px; border:none; border-radius:6px; cursor:pointer; font-weight:bold; font-size:14px; transition:0.2s;">
                    🛑 攔截發送<br><span style="font-size:11px; font-weight:normal; opacity:0.8;">(中止生成去復原)</span>
                </button>
            </div>
        </div>`);

        overlay.append(box);
        $('body').append(overlay);

        $('#ds-btn-accept').hover(function(){$(this).css('opacity','0.8')}, function(){$(this).css('opacity','1')}).click(() => { overlay.remove(); resolve('reset'); });
        $('#ds-btn-abort').hover(function(){$(this).css('opacity','0.8')}, function(){$(this).css('opacity','1')}).click(() => { overlay.remove(); resolve('abort'); });
    });
}

// ==========================================
// 核心處理器 (v13 企業級時序映射引擎)
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
        // 第一階段：遍歷凍結陣列，進行原位同步
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
                } else if (bestScore > 0.2) { 
                    const matchedItem = sysMsgsPool[bestIdx];
                    rawFrozenSequence.push(matchedItem); 
                    sysMsgsPool.splice(bestIdx, 1);
                    Logger.warn(`[SYS 原位更新] 索引 ${i} ➔ ${matchedItem.content.substring(0,15).replace(/\n/g, '')}...`, LogLevels.DEBUG);
                } else {
                    Logger.warn(`[SYS 原位刪除] 遺失索引 ${i}，觸發自動上移補位。`, LogLevels.DEBUG);
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
                    Logger.warn(`[歷史原位刪除] 歷史訊息遺失，觸發自動上移補位。`, LogLevels.DEBUG);
                }
            }
        }

        // ---------------------------------------------------------
        // 第二階段：附加新生代數據 (保持交錯排序)
        // ---------------------------------------------------------
        for (let h of remainingHistory) rawFrozenSequence.push(h);

        for (let sys of sysMsgsPool) {
            rawFrozenSequence.push(sys);
            Logger.log(`[SYS 新增附加] 插入歷史尾部: ${sys.content.substring(0,15).replace(/\n/g, '')}...`, LogLevels.DEBUG);
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

        const proposedStream = [...dedupedSequence];
        if (currentTurn.user) proposedStream.push(currentTurn.user);
        for (const p of currentTurn.prefills) proposedStream.push(p);

        Logger.map(`當前時序拓撲圖: \n${Logger.getSeqString(proposedStream)}`, LogLevels.BASIC);

        // ---------------------------------------------------------
        // 第三階段：智能緩存斷裂計算與邊緣豁免 (Edge-Case Immunity)
        // ---------------------------------------------------------
        let requireResetConfirm = false;
        let dropPercentStr = "0.0";
        let mapInfoText = "無變更";

        if (state.lastSentSequence && state.lastSentSequence.length > 0) {
            const L = state.lastSentSequence;
            const P = proposedStream;

            let breakIndex = -1;
            for (let i = 0; i < Math.min(L.length, P.length); i++) {
                if (L[i].role !== P[i].role || L[i].norm !== P[i].norm) { breakIndex = i; break; }
            }
            if (breakIndex === -1) breakIndex = P.length;

            let wastedTokensCount = 0;
            let totalTokensCount = 0;

            for (let i = 0; i < P.length; i++) {
                const tCount = estimateTokens(P[i].content);
                totalTokensCount += tCount;
                
                if (i >= breakIndex) {
                    // 【豁免 A】尾部重骰 (Swipe Regenerate) 豁免
                    if (i === P.length - 1 && P[i].tag === 'AI') {
                        Logger.log(`[智能豁免] 偵測到末尾 AI 重新生成 (Swipe)，免除流失懲罰。`, LogLevels.DEBUG);
                        continue;
                    }

                    let foundInL = L.some(oldM => oldM.role === P[i].role && oldM.norm === P[i].norm);
                    if (foundInL) wastedTokensCount += tCount;
                }
            }

            // 【豁免 B】時光倒流與分支切換 (Branch Switching)
            if (P.length < L.length - 2) {
                Logger.warn(`[智能豁免] 偵測到歷史大幅倒退(讀檔/刪除)，自動重置基準線，免除彈窗。`, LogLevels.BASIC);
                wastedTokensCount = 0; 
            }

            let dropRatio = totalTokensCount === 0 ? 0 : (wastedTokensCount / totalTokensCount);
            
            if (dropRatio > 0.10 && Settings.showResetPrompt) {
                requireResetConfirm = true;
                dropPercentStr = (dropRatio * 100).toFixed(1);
                mapInfoText = `斷裂點位於索引 [${breakIndex}] (${P[breakIndex]?.tag})\n原文: ${L[breakIndex]?.content?.substring(0,25).replace(/\n/g, ' ')}\n現狀: ${P[breakIndex]?.content?.substring(0,25).replace(/\n/g, ' ')}`;
                Logger.warn(`檢測到緩存流失 ${dropPercentStr}%，準備攔截...`, LogLevels.BASIC);
            }
        }

        // ---------------------------------------------------------
        // 第四階段：決策與覆蓋
        // ---------------------------------------------------------
        let decision = 'ignore';
        if (requireResetConfirm) decision = await askUserForResetAsync(dropPercentStr, mapInfoText);

        if (decision === 'abort') {
            Logger.error('[攔截生效] 已清空流數據以強制中止生成', null, LogLevels.BASIC);
            if (typeof toastr !== 'undefined') toastr.error("已強制攔截本次請求！請復原提示詞。", "緩存防護");
            stream.splice(0, stream.length); 
            return;
        }

        if (decision === 'reset') {
            Logger.warn('[確認同步] 用戶接受緩存流失，已寫入最新時序排序。', LogLevels.BASIC);
        }

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
        Logger.error('攔截器發生錯誤', err.message);
        throw err;
    }
}

// ==========================================
// ST 頂部擴充選單集成
// ==========================================
function addTopMenuButton() {
    if ($('#ds-top-reset-btn').length === 0) {
        const btn = $(`<li id="ds-top-reset-btn" class="menu_button interactable" title="清空當前聊天的 DeepSeek 快取排序，還原為 ST 預設"><span class="fa-solid fa-rotate-right"></span> 清空 DS 緩存</li>`);
        btn.on('click', () => {
            if(!confirm("確定要完全清空當前聊天的緩存排序狀態嗎？\n這將使所有提示詞回到 ST 預設的頂部排序！")) return;
            const key = getChatKey().key;
            delete Settings.chats[key];
            safeSave(); renderChatsUI();
            if (typeof toastr !== 'undefined') toastr.success("當前聊天的緩存排序已清空！", "DS Cache");
            Logger.warn(`[手動清空] 用戶清空了當前存檔狀態: ${key}`);
        });
        if ($('ul#extensions_menu').length > 0) $('ul#extensions_menu').append(btn);
        else if ($('#right-nav-extensions').length > 0) $('#right-nav-extensions').append(btn);
    }
}

// ==========================================
// 企業級 UI 面板構建
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
        container.append('<div style="opacity:0.5; font-size:12px; padding:10px; text-align:center;">尚無接管的存檔數據</div>');
        return;
    }

    keys.forEach(key => {
        const chat = Settings.chats[key];
        const html = `
            <div class="ds-chat-item">
                <span style="font-size:0.85em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:70%;" title="${chat.label}">${chat.label}</span>
                <button class="ds-btn ds-reset-btn" data-key="${key}">清除</button>
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
        injectCSS();
        const html = `
        <div class="inline-drawer" id="ds-v13-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Deepseek 快取防護 (${PLUGIN_VERSION})</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                
                <!-- 核心控制區 -->
                <div class="ds-panel-section">
                    <div class="ds-panel-title">🛡️ 核心控制引擎</div>
                    <label class="checkbox_label" title="開啟後將強制接管發送陣列，實現原位更新與時序凍結"><input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}> 啟用絕對時序映射引擎</label>
                    <label class="checkbox_label" title="當檢測到超過 10% 的 Tokens 發生流失斷裂時，彈出攔截視窗"><input type="checkbox" id="ds-toast-reset" ${Settings.showResetPrompt ? 'checked' : ''}> 啟用 10% 緩存斷裂防護閘 (異步攔截)</label>
                </div>
                
                <!-- 監聽器觸發區 -->
                <div class="ds-panel-section">
                    <div class="ds-panel-title">🔔 編輯監聽器彈窗 (Toast)</div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px;">
                        <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-sys" ${Settings.toastSys ? 'checked' : ''}> 系統/預設修改</label>
                        <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-lore" ${Settings.toastLore ? 'checked' : ''}> 世界書變更</label>
                        <label class="checkbox_label" style="font-size:0.85em; grid-column: 1 / span 2;"><input type="checkbox" id="ds-toast-his" ${Settings.toastHistory ? 'checked' : ''}> 歷史對話編輯/刪除</label>
                    </div>
                </div>
                
                <!-- 存檔管理區 -->
                <div class="ds-panel-section">
                    <div class="ds-panel-title">📂 存檔狀態緩存池</div>
                    <div id="ds-chat-list-container" style="max-height:140px; overflow-y:auto; background:rgba(0,0,0,0.3); border-radius:4px; padding:4px;"></div>
                    <button id="ds-cache-factory-reset" class="ds-btn ds-btn-danger" style="width:100%; margin-top:8px;" title="清除所有聊天室的時序紀錄">⚠️ 清空所有存檔數據 (重置基準線)</button>
                </div>

                <!-- 日誌終端區 -->
                <div class="ds-panel-section">
                    <div class="ds-panel-title" style="display:flex; justify-content:space-between; align-items:center;">
                        <span>💻 視覺化終端機</span>
                        <select id="ds-cache-loglevel" class="text_pole" style="width:auto; padding:2px; height:auto; font-size:11px;">
                            <option value="0" ${Settings.logLevel===0?'selected':''}>0 - 關閉</option>
                            <option value="1" ${Settings.logLevel===1?'selected':''}>1 - 簡要</option>
                            <option value="2" ${Settings.logLevel===2?'selected':''}>2 - 詳細</option>
                            <option value="3" ${Settings.logLevel===3?'selected':''}>3 - 極限除錯</option>
                        </select>
                    </div>
                    <div id="ds-cache-log-content" class="ds-log-console"></div>
                    <button id="ds-cache-clearlog" class="ds-btn" style="width:100%; margin-top:8px;">🗑️ 清空終端機畫面</button>
                </div>
                
            </div>
        </div>`;
        
        $('#extensions_settings').append(html);

        $('#ds-cache-enable').on('change', function () { Settings.enabled = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-sys').on('change', function () { Settings.toastSys = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-lore').on('change', function () { Settings.toastLore = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-his').on('change', function () { Settings.toastHistory = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-reset').on('change', function () { Settings.showResetPrompt = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-loglevel').on('change', function () { Settings.logLevel = parseInt($(this).val()); safeSave(); });
        
        $('#ds-cache-factory-reset').on('click', () => {
            if (confirm("這將使所有聊天室的提示詞回到 ST 預設的頂部排序！\n確定要清除全域快取狀態嗎？")) { 
                Settings.chats = {}; safeSave(); renderChatsUI(); 
            }
        });
        $('#ds-cache-clearlog').on('click', () => { $('#ds-cache-log-content').empty(); });
        
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
            if (event_types?.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, () => triggerWarning('歷史對話被刪除！將在發送時原位補位。', Settings.toastHistory));
            if (event_types?.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, () => triggerWarning('歷史對話已修改！將在發送時原位更新。', Settings.toastHistory));
        }

        $(document).on('change select2:select input focusout', '#chat_completion_preset, .preset_select, select[id*="preset"], #main_prompt_textarea, #nsfw_prompt_textarea, #jailbreak_prompt_textarea, #rm_ch_sys_prompt', function() {
            triggerWarning('系統提示詞變更！將在發送時原位熱更新。', Settings.toastSys);
        });

        $(document).on('input change focusout', '.world_info_entry textarea, .world_info_entry input, #world_info_entries_list textarea, .lorebook_entry textarea, .drawer-content textarea', function() {
            triggerWarning('世界書已變更！將在發送時原位熱更新或附加。', Settings.toastLore);
        });

        Logger.log(`══════ ${PLUGIN_VERSION} 引擎就緒 ══════`, LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件啟動崩潰:', e);
    }
});
