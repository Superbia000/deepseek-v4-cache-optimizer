import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 1. 樣式注入 (CSS Injection) - 現代化 UI
// ==========================================
const injectCSS = () => {
    if (document.getElementById('ds-cache-styles')) return;
    const style = document.createElement('style');
    style.id = 'ds-cache-styles';
    style.innerHTML = `
        /* 終端機日誌樣式 */
        .ds-log-terminal { background: #0d0d0d; color: #a9b7c6; font-family: Consolas, monospace; font-size: 11px; height: 180px; overflow-y: auto; border-radius: 6px; padding: 8px; border: 1px solid #333; box-shadow: inset 0 0 10px rgba(0,0,0,0.5); }
        .ds-log-line { margin-bottom: 3px; line-height: 1.3; word-wrap: break-word; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 2px; }
        .ds-log-time { color: #5c6370; margin-right: 5px; }
        .ds-log-info { color: #98c379; }
        .ds-log-warn { color: #e5c07b; font-weight: bold; }
        .ds-log-error { color: #e06c75; font-weight: bold; }
        .ds-log-map { color: #56b6c2; }
        
        /* 攔截器彈窗樣式 */
        .ds-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); z-index: 999999; display: flex; align-items: center; justify-content: center; animation: dsFadeIn 0.2s ease-out; }
        .ds-modal { background: #1e1e24; border: 1px solid #e06c75; padding: 30px; border-radius: 16px; max-width: 600px; width: 90%; color: #fff; font-family: sans-serif; box-shadow: 0 20px 40px rgba(0,0,0,0.6); position: relative; overflow: hidden; animation: dsSlideUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .ds-modal-title { color: #e06c75; margin: 0 0 15px 0; display: flex; align-items: center; gap: 10px; font-size: 20px; }
        .ds-modal-text { font-size: 14px; line-height: 1.6; color: #abb2bf; }
        .ds-progress-container { background: #282c34; border-radius: 8px; height: 12px; margin: 15px 0; overflow: hidden; box-shadow: inset 0 2px 4px rgba(0,0,0,0.5); }
        .ds-progress-bar { background: linear-gradient(90deg, #e5c07b, #e06c75); height: 100%; width: 0%; transition: width 0.8s ease-out; }
        .ds-map-box { background: #000; padding: 12px; border-radius: 8px; font-family: Consolas, monospace; font-size: 12px; color: #56b6c2; margin: 15px 0; max-height: 150px; overflow-y: auto; border: 1px solid #333; }
        .ds-btn-group { display: flex; gap: 12px; margin-top: 25px; }
        .ds-btn { flex: 1; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 14px; display: flex; flex-direction: column; align-items: center; gap: 4px; transition: all 0.2s; }
        .ds-btn:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
        .ds-btn:active { transform: translateY(0); }
        .ds-btn-accept { background: #98c379; color: #1e1e24; }
        .ds-btn-abort { background: #e06c75; color: #fff; }
        .ds-btn-sub { font-size: 10px; font-weight: normal; opacity: 0.8; }
        
        @keyframes dsFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes dsSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    `;
    document.head.appendChild(style);
};

// ==========================================
// 2. 狀態與設定 (新增容錯率控制)
// ==========================================
let Settings = {};

function initSettings() {
    if (!extension_settings.ds_cache_v13) {
        extension_settings.ds_cache_v13 = {
            enabled: true,
            toastSys: true,
            toastLore: true,
            toastHistory: true,
            showResetPrompt: true,
            logLevel: 3,
            tolerance: 1, // 0:嚴格, 1:標準, 2:寬鬆
            chats: {} 
        };
    }
    Settings = extension_settings.ds_cache_v13;
    if (Settings.tolerance === undefined) Settings.tolerance = 1;
    if (!Settings.chats) Settings.chats = {}; 
}

function safeSave() {
    try {
        if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
    } catch (e) { console.warn("[DS Cache] 存檔失敗", e); }
}

function getTolerance() {
    // 根據設定返回 (SYS寬容度, HIS寬容度)
    if (Settings.tolerance === 0) return { sys: 0.5, his: 0.6 }; // 嚴格 (相似度需很高)
    if (Settings.tolerance === 1) return { sys: 0.2, his: 0.3 }; // 標準 (v12 默認)
    return { sys: 0.05, his: 0.1 }; // 寬鬆 (幾乎只要角色對上就當作原位修改)
}

// ==========================================
// 3. 軍用級可視化日誌系統 (防止記憶體洩漏)
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function logAt(level, type, msg) {
    if (Settings.logLevel < level) return;
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
    
    // 輸出到開發者工具
    if (type === 'warn') console.warn(`%c[DS Cache v13] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    else if (type === 'error') console.error(`[DS Cache v13] 🔴 ${msg}`);
    else if (type === 'map') console.log(`%c[DS Cache v13] 🗺️ ${msg}`, 'color: #00e5ff; font-weight: bold;');
    else console.log(`%c[DS Cache v13] ✅ ${msg}`, 'color: #00ff00;');
    
    // 輸出到 UI 終端機
    const container = document.getElementById('ds-cache-log-container');
    if (container) {
        const line = document.createElement('div');
        line.className = 'ds-log-line';
        line.innerHTML = `<span class="ds-log-time">[${time}]</span> <span class="ds-log-${type}">${msg.replace(/\n/g, '<br>')}</span>`;
        container.appendChild(line);
        
        // 記憶體保護：限制最多 200 條記錄
        while (container.childNodes.length > 200) container.removeChild(container.firstChild);
        container.scrollTop = container.scrollHeight;
    }
}

const Logger = {
    log: (msg, level = LogLevels.DETAILED) => logAt(level, 'info', msg),
    warn: (msg, level = LogLevels.BASIC) => logAt(level, 'warn', msg),
    map: (msg, level = LogLevels.BASIC) => logAt(level, 'map', msg),
    error: (msg, err, level = LogLevels.BASIC) => logAt(level, 'error', err ? `${msg} ${err}` : msg),
    normalize: (text) => text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
    getSeqString: (seq) => seq.map(m => `[${m.tag}]`).join(' ➔ ')
};

function exportLogs() {
    const container = document.getElementById('ds-cache-log-container');
    if (!container) return;
    const text = Array.from(container.childNodes).map(n => n.innerText).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `DS_Cache_Log_${new Date().getTime()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
}

// ==========================================
// 4. 狀態管理與擴展菜單
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
        const btn = $(`<li id="ds-top-reset-btn" class="menu_button interactable" title="清空當前 DS 緩存排序"><span class="fa-solid fa-broom"></span> 清空 DS 緩存</li>`);
        btn.on('click', () => {
            if(!confirm("確定要完全清空當前聊天的緩存排序狀態嗎？(回到 ST 預設頂部排序)")) return;
            const key = getChatKey().key;
            delete Settings.chats[key];
            safeSave(); renderChatsUI();
            if (typeof toastr !== 'undefined') toastr.success("當前聊天的緩存排序已清空！");
            Logger.warn(`用戶手動清空了當前存檔: ${key}`);
        });
        if ($('ul#extensions_menu').length > 0) $('ul#extensions_menu').append(btn);
        else if ($('#right-nav-extensions').length > 0) $('#right-nav-extensions').append(btn);
    }
}

// ==========================================
// 5. 核心工具與數據流解析 (不改動邏輯)
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
// 6. 現代化異步攔截 UI 引擎
// ==========================================
function askUserForResetAsync(dropPercent, mapInfo) {
    return new Promise(resolve => {
        const html = `
            <div class="ds-overlay" id="ds-modal-wrapper">
                <div class="ds-modal">
                    <h2 class="ds-modal-title"><span class="fa-solid fa-triangle-exclamation"></span> 緩存斷裂預警 (原位同步中)</h2>
                    <p class="ds-modal-text">檢測到陣列前排發生了變更。這將導致 KV 緩存鏈條斷裂，預計 <b>${dropPercent}%</b> 的歷史對話緩存將失效並重新運算。<br><br><b>插件已自動完成時序陣列的原位更新與補位。</b>請問要接受本次修改嗎？</p>
                    
                    <div class="ds-progress-container">
                        <div class="ds-progress-bar" id="ds-prog-bar"></div>
                    </div>
                    
                    <div class="ds-map-box">斷裂詳情：<br>${mapInfo.replace(/\n/g, '<br>')}</div>
                    
                    <div class="ds-btn-group">
                        <button class="ds-btn ds-btn-accept" id="ds-btn-accept">
                            <span class="fa-solid fa-check-double"></span> 確認同步
                            <span class="ds-btn-sub">接受原位修改並發送</span>
                        </button>
                        <button class="ds-btn ds-btn-abort" id="ds-btn-abort">
                            <span class="fa-solid fa-ban"></span> 攔截發送
                            <span class="ds-btn-sub">中止生成並復原</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
        $('body').append(html);
        
        // 進度條動畫
        setTimeout(() => { $('#ds-prog-bar').css('width', `${Math.min(dropPercent, 100)}%`); }, 50);

        $('#ds-btn-accept').click(() => { $('#ds-modal-wrapper').remove(); resolve('reset'); });
        $('#ds-btn-abort').click(() => { $('#ds-modal-wrapper').remove(); resolve('abort'); });
    });
}

// ==========================================
// 7. 核心處理器 (v13 統一對象池映射引擎 - 邏輯鎖死)
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (!Settings.enabled || data.dryRun) return;

    try {
        const chatKeyInfo = getChatKey();
        let state = getChatState(chatKeyInfo);
        if (!data?.chat?.length) return;
        const stream = data.chat;

        const { sysMsgs, historyTurns, currentTurn } = parseSTStream(stream);
        Logger.log(`[流程啟動] 處理存檔: ${chatKeyInfo.label}`, LogLevels.BASIC);

        const flatHistoryPool = [];
        for(let t of historyTurns) {
            flatHistoryPool.push(t.user);
            if(t.assistant) flatHistoryPool.push(stripPrefillFromAssistant(t.assistant, state.lastPrefills));
        }

        let rawFrozenSequence = [];
        const sysMsgsPool = [...sysMsgs];
        const remainingHistory = [...flatHistoryPool];
        const thresholds = getTolerance();
        
        // ---------------------------------------------------------
        // 階段 1：遍歷凍結陣列，進行原位同步
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
                } else if (bestScore > thresholds.sys) {
                    const matchedItem = sysMsgsPool[bestIdx];
                    rawFrozenSequence.push(matchedItem); 
                    sysMsgsPool.splice(bestIdx, 1);
                    Logger.warn(`[SYS 同步] 原位修改: ${matchedItem.content.substring(0,15).replace(/\n/g, '')}...`, LogLevels.DEBUG);
                } else {
                    Logger.warn(`[SYS 同步] 原位刪除: 提示詞被移除，後方自動補位。`, LogLevels.DEBUG);
                }
            } 
            else if (item.tag === 'USER' || item.tag === 'AI') {
                let bestIdx = -1, bestScore = 0;
                for (let j = 0; j < remainingHistory.length; j++) {
                    if (item.tag !== remainingHistory[j].tag) continue;
                    const score = getSimilarity(item.norm, remainingHistory[j].norm);
                    if (score > bestScore) { bestScore = score; bestIdx = j; }
                }
                if (bestScore > thresholds.his) {
                    rawFrozenSequence.push(remainingHistory[bestIdx]);
                    remainingHistory.splice(bestIdx, 1);
                } else {
                    Logger.warn(`[歷史同步] 歷史對話被刪除，自動抽出上移補位。`, LogLevels.DEBUG);
                }
            }
        }

        // ---------------------------------------------------------
        // 階段 2：附加新生代數據 (保持交錯排序)
        // ---------------------------------------------------------
        for (let h of remainingHistory) rawFrozenSequence.push(h);
        
        for (let sys of sysMsgsPool) {
            rawFrozenSequence.push(sys);
            Logger.log(`[SYS 同步] 新增提示詞完美置尾: ${sys.content.substring(0,15).replace(/\n/g, '')}...`, LogLevels.DEBUG);
        }

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

        Logger.map(`擬態排序: ${Logger.getSeqString(proposedStream)}`, LogLevels.DEBUG);

        // ---------------------------------------------------------
        // 階段 3：KV 緩存斷裂計算器
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
                Logger.log(`[分析] 自然上下文推移 (Context Shift)，抑制彈窗。`, LogLevels.DEBUG);
            }

            let dropRatio = proposedTotalLen === 0 ? 0 : (wastedTokensLen / proposedTotalLen);
            
            if (dropRatio > 0.10 && Settings.showResetPrompt) {
                requireResetConfirm = true;
                dropPercentStr = (dropRatio * 100).toFixed(1);
                mapInfoText = `> 斷裂點索引: [${breakIndex}] (${P[breakIndex]?.tag})\n> 原文: ${L[breakIndex]?.content?.substring(0,35)}...\n> 現狀: ${P[breakIndex]?.content?.substring(0,35)}...`;
            }
        }

        // ---------------------------------------------------------
        // 階段 4：決策與覆蓋
        // ---------------------------------------------------------
        let decision = 'ignore';
        if (requireResetConfirm) {
            Logger.warn(`緩存流失 ${dropPercentStr}%，掛起等待確認...`, LogLevels.BASIC);
            decision = await askUserForResetAsync(dropPercentStr, mapInfoText);
        }

        if (decision === 'abort') {
            Logger.error('[攔截] 已強制中止生成', null, LogLevels.BASIC);
            if (typeof toastr !== 'undefined') toastr.error("已強制攔截本次請求！請復原提示詞。", "DS Cache");
            stream.splice(0, stream.length); 
            return;
        }

        if (decision === 'reset') Logger.log('[同步] 接受原位修改，數據鏈更新。', LogLevels.BASIC);

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
        Logger.error('攔截器崩潰', err);
        throw err;
    }
}

// ==========================================
// 8. 控制面板 UI 與交互綁定
// ==========================================
let warningTimeout = null;
function triggerWarning(msg, toggle) {
    if (!Settings.enabled || !toggle) return;
    if (warningTimeout) clearTimeout(warningTimeout);
    warningTimeout = setTimeout(() => {
        if (typeof toastr !== 'undefined') toastr.warning(msg, '⚙️ DS 狀態變更', { timeOut: 3000 });
    }, 300); 
}

function renderChatsUI() {
    const container = $('#ds-chat-list-container');
    if (container.length === 0) return;
    container.empty();
    
    const keys = Object.keys(Settings.chats);
    if (keys.length === 0) {
        container.append('<div style="font-size:0.85em; opacity:0.5; padding:10px; text-align:center;">無存檔數據</div>');
        return;
    }

    keys.forEach(key => {
        const chat = Settings.chats[key];
        const count = chat.frozenSequence?.length || 0;
        const html = `
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:8px; margin-bottom:6px; border-radius:6px; border:1px solid rgba(255,255,255,0.1);">
                <div style="display:flex; flex-direction:column; overflow:hidden;">
                    <span style="font-size:0.85em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%;" title="${chat.label}">${chat.label}</span>
                    <span style="font-size:0.7em; color:#98c379;">凍結節點: ${count}</span>
                </div>
                <button class="menu_button interactable ds-reset-btn" data-key="${key}" style="font-size:0.8em; padding:4px 8px; border-radius:4px;"><span class="fa-solid fa-trash"></span></button>
            </div>
        `;
        container.append(html);
    });

    container.find('.ds-reset-btn').on('click', function() {
        const key = $(this).data('key');
        delete Settings.chats[key];
        safeSave(); renderChatsUI();
        if (typeof toastr !== 'undefined') toastr.success("已清空該存檔");
    });
}

function showTopology() {
    const chatKeyInfo = getChatKey();
    const state = Settings.chats[chatKeyInfo.key];
    if (!state || !state.frozenSequence || state.frozenSequence.length === 0) {
        if (typeof toastr !== 'undefined') toastr.info("當前對話尚無快取數據");
        return;
    }
    const mapStr = Logger.getSeqString(state.frozenSequence).replace(/ ➔ /g, '<br> ➔ ');
    const html = `
        <div class="ds-overlay" id="ds-topo-wrapper">
            <div class="ds-modal" style="max-width: 400px;">
                <h2 class="ds-modal-title" style="color:#56b6c2;"><span class="fa-solid fa-network-wired"></span> 凍結拓撲結構</h2>
                <div class="ds-map-box" style="max-height:300px; font-size:13px; line-height:1.5;">${mapStr}</div>
                <button class="ds-btn ds-btn-accept" style="width:100%; margin-top:15px;" onclick="$('#ds-topo-wrapper').remove()">關閉預覽</button>
            </div>
        </div>
    `;
    $('body').append(html);
}

async function setupUI() {
    try {
        injectCSS();
        const html = `
        <div class="inline-drawer" id="ds-v13-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><span class="fa-solid fa-microchip"></span> Deepseek Cache 引擎 (v13 典藏版)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:15px; background: rgba(0,0,0,0.2);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <label class="checkbox_label" style="font-weight:bold; color:#00e5ff;"><input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}> 啟用時序引擎</label>
                    <button id="ds-btn-topo" class="menu_button interactable" style="font-size:0.8em; padding:3px 8px;"><span class="fa-solid fa-eye"></span> 檢視拓撲</button>
                </div>
                
                <div style="margin:5px 0 15px 15px; border-left: 3px solid #00e5ff; padding-left: 12px;">
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-sys" ${Settings.toastSys ? 'checked' : ''}> 提示詞熱更新通知</label>
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-lore" ${Settings.toastLore ? 'checked' : ''}> 世界書熱更新通知</label>
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-his" ${Settings.toastHistory ? 'checked' : ''}> 歷史對話熱更新通知</label>
                    <label class="checkbox_label" style="font-size:0.85em; color:#e06c75;"><input type="checkbox" id="ds-toast-reset" ${Settings.showResetPrompt ? 'checked' : ''}> 啟用 10% 攔截阻斷器</label>
                </div>
                
                <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:15px; background:rgba(255,255,255,0.02); padding:10px; border-radius:6px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.85em; color:#abb2bf;">判定容錯率 (Tolerance):</span>
                        <select id="ds-cache-tolerance" class="text_pole" style="width:120px; font-size:0.8em; padding:2px;">
                            <option value="0" ${Settings.tolerance===0?'selected':''}>嚴格 (匹配度高)</option>
                            <option value="1" ${Settings.tolerance===1?'selected':''}>標準 (推薦)</option>
                            <option value="2" ${Settings.tolerance===2?'selected':''}>寬鬆 (易觸發原位)</option>
                        </select>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.85em; color:#abb2bf;">終端日誌級別:</span>
                        <select id="ds-cache-loglevel" class="text_pole" style="width:120px; font-size:0.8em; padding:2px;">
                            <option value="0" ${Settings.logLevel===0?'selected':''}>安靜模式</option>
                            <option value="1" ${Settings.logLevel===1?'selected':''}>基礎警告</option>
                            <option value="2" ${Settings.logLevel===2?'selected':''}>詳細追蹤</option>
                            <option value="3" ${Settings.logLevel===3?'selected':''}>極限除錯</option>
                        </select>
                    </div>
                </div>

                <b style="font-size:0.85em; color:#e5c07b;"><span class="fa-solid fa-database"></span> 存檔快取池管理：</b>
                <div id="ds-chat-list-container" style="max-height:160px; overflow-y:auto; margin:8px 0; border:1px solid rgba(255,255,255,0.1); padding:5px; border-radius:6px; background:#121212;"></div>
                <button id="ds-cache-factory-reset" class="menu_button" style="width:100%; margin-bottom:15px; background:rgba(224, 108, 117, 0.2); color:#e06c75; border:1px solid #e06c75;"><span class="fa-solid fa-skull"></span> 格式化所有快取數據</button>
                
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                    <b style="font-size:0.85em; color:#98c379;"><span class="fa-solid fa-terminal"></span> 執行緒終端機：</b>
                    <div style="display:flex; gap:5px;">
                        <span id="ds-btn-export" title="匯出日誌" style="cursor:pointer; color:#61afef;"><span class="fa-solid fa-download"></span></span>
                        <span id="ds-btn-clearlog" title="清空日誌" style="cursor:pointer; color:#e06c75;"><span class="fa-solid fa-trash"></span></span>
                    </div>
                </div>
                <div id="ds-cache-log-container" class="ds-log-terminal"></div>
            </div>
        </div>`;
        
        $('#extensions_settings').append(html);

        $('#ds-cache-enable').on('change', function () { Settings.enabled = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-sys').on('change', function () { Settings.toastSys = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-lore').on('change', function () { Settings.toastLore = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-his').on('change', function () { Settings.toastHistory = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-reset').on('change', function () { Settings.showResetPrompt = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-loglevel').on('change', function () { Settings.logLevel = parseInt($(this).val()); safeSave(); });
        $('#ds-cache-tolerance').on('change', function () { Settings.tolerance = parseInt($(this).val()); safeSave(); Logger.log(`容錯率已切換為: ${$(this).find("option:selected").text()}`); });
        
        $('#ds-cache-factory-reset').on('click', () => {
            if (confirm("這將使所有提示詞回到 ST 預設的頂部排序！確定要格式化嗎？")) { Settings.chats = {}; safeSave(); renderChatsUI(); }
        });
        
        $('#ds-btn-clearlog').on('click', () => { $('#ds-cache-log-container').empty(); });
        $('#ds-btn-export').on('click', exportLogs);
        $('#ds-btn-topo').on('click', showTopology);
        
        renderChatsUI();
    } catch (e) { console.error('[DS Cache] UI初始化崩潰', e); }
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
            if (event_types?.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, () => triggerWarning('歷史被刪除！準備原位補位', Settings.toastHistory));
            if (event_types?.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, () => triggerWarning('歷史被修改！準備原位更新', Settings.toastHistory));
        }

        $(document).on('change select2:select input focusout', '#chat_completion_preset, .preset_select, select[id*="preset"], #main_prompt_textarea, #nsfw_prompt_textarea, #jailbreak_prompt_textarea, #rm_ch_sys_prompt', function() {
            triggerWarning('提示詞變更！準備原位更新/附加', Settings.toastSys);
        });

        $(document).on('input change focusout', '.world_info_entry textarea, .world_info_entry input, #world_info_entries_list textarea, .lorebook_entry textarea, .drawer-content textarea', function() {
            triggerWarning('世界書變更！準備原位更新/附加', Settings.toastLore);
        });

        Logger.log('══════ v13.0 典藏版 就緒 (Engine Online) ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件啟動失敗:', e);
    }
});
