import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 1. 樣式注入 (維持原生與現代化 UI)
// ==========================================
const injectCSS = () => {
    if (document.getElementById('ds-cache-styles')) return;
    const style = document.createElement('style');
    style.id = 'ds-cache-styles';
    style.innerHTML = `
        /* 終端機日誌 */
        .ds-log-terminal { background: #0d0d0d; color: #a9b7c6; font-family: Consolas, monospace; font-size: 11px; height: 180px; overflow-y: auto; border-radius: 6px; padding: 8px; border: 1px solid #333; box-shadow: inset 0 0 10px rgba(0,0,0,0.5); scroll-behavior: smooth; transition: height 0.3s; }
        .ds-log-terminal.collapsed { height: 0; padding: 0; border: none; overflow: hidden; }
        .ds-log-line { margin-bottom: 3px; line-height: 1.3; word-wrap: break-word; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 2px; }
        .ds-log-time { color: #5c6370; margin-right: 5px; }
        .ds-log-info { color: #98c379; }
        .ds-log-warn { color: #e5c07b; font-weight: bold; }
        .ds-log-error { color: #e06c75; font-weight: bold; }
        .ds-log-map { color: #56b6c2; }
        
        /* 標籤色彩 */
        .ds-tag { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; background: rgba(255,255,255,0.05); }
        .ds-tag-SYS { color: #61afef; border-left: 2px solid #61afef; }
        .ds-tag-USER { color: #98c379; border-left: 2px solid #98c379; }
        .ds-tag-AI { color: #e5c07b; border-left: 2px solid #e5c07b; }
        .ds-tag-PREFILL { color: #c678dd; border-left: 2px solid #c678dd; }

        /* 快取列表與釘選 */
        .ds-chat-container { max-height:180px; overflow-y:auto; margin:8px 0; border:1px solid rgba(255,255,255,0.1); padding:5px; border-radius:6px; background:#121212; transition: max-height 0.3s; }
        .ds-chat-container.collapsed { max-height: 0; padding: 0; border: none; overflow: hidden; margin: 0; }
        .ds-chat-item { display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:8px; margin-bottom:6px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); transition: 0.2s; }
        .ds-chat-item.active-chat { background:rgba(0, 229, 255, 0.08); border:1px solid #00e5ff; box-shadow: inset 0 0 10px rgba(0,229,255,0.15); }
        .ds-action-group { display: flex; gap: 5px; }
        
        /* 攔截器彈窗 & 差異顯示 */
        .ds-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.8); backdrop-filter: blur(8px); z-index: 999999; display: flex; align-items: center; justify-content: center; animation: dsFadeIn 0.2s ease-out; }
        .ds-modal { background: #1e1e24; border: 1px solid #e06c75; padding: 30px; border-radius: 12px; max-width: 650px; width: 90%; color: #fff; font-family: sans-serif; box-shadow: 0 25px 50px rgba(0,0,0,0.9); position: relative; overflow: hidden; animation: dsSlideUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .ds-modal-title { color: #e06c75; margin: 0 0 15px 0; display: flex; align-items: center; gap: 10px; font-size: 20px; }
        .ds-modal-text { font-size: 14px; line-height: 1.6; color: #abb2bf; }
        .ds-progress-container { background: #282c34; border-radius: 6px; height: 10px; margin: 15px 0; overflow: hidden; box-shadow: inset 0 2px 4px rgba(0,0,0,0.5); }
        .ds-progress-bar { height: 100%; width: 0%; transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1), background 0.3s; }
        .ds-map-box { background: #181a1f; padding: 12px; border-radius: 8px; font-family: Consolas, monospace; font-size: 12px; color: #abb2bf; margin: 15px 0; border: 1px solid #282c34; box-shadow: inset 0 0 10px rgba(0,0,0,0.5); }
        .ds-diff-del { background: rgba(224, 108, 117, 0.15); border-left: 3px solid #e06c75; padding: 6px 10px; margin-bottom: 4px; border-radius: 0 4px 4px 0; color: #e06c75; }
        .ds-diff-add { background: rgba(152, 195, 121, 0.15); border-left: 3px solid #98c379; padding: 6px 10px; border-radius: 0 4px 4px 0; color: #98c379; }
        
        .ds-btn-group { display: flex; gap: 12px; margin-top: 25px; }
        .ds-btn { flex: 1; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 14px; display: flex; flex-direction: column; align-items: center; gap: 4px; transition: all 0.2s; position: relative; overflow: hidden; }
        .ds-btn:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0,0,0,0.4); filter: brightness(1.15); }
        .ds-btn:active { transform: translateY(0); }
        .ds-btn-accept { background: #98c379; color: #1e1e24; }
        .ds-btn-abort { background: #e06c75; color: #fff; }
        .ds-btn-sub { font-size: 10px; font-weight: normal; opacity: 0.8; }
        .ds-key-hint { position: absolute; right: 8px; top: 8px; font-size: 10px; opacity: 0.6; background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px; }

        .ds-timeline-container { max-height: 400px; overflow-y: auto; padding-right: 5px; }
        .ds-timeline-item { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .ds-timeline-content { flex: 1; color: #abb2bf; font-size: 12px; line-height: 1.4; word-wrap: break-word; }
        .ds-timeline-index { width: 25px; text-align: right; color: #5c6370; font-size: 10px; padding-top: 3px; }

        .ds-mini-btn { cursor:pointer; opacity:0.7; transition:0.2s; font-size:12px; }
        .ds-mini-btn:hover { opacity:1; transform:scale(1.1); }
        
        @keyframes dsFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes dsSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    `;
    document.head.appendChild(style);
};

// ==========================================
// 2. 狀態設定與防抖觸發器引擎 (獨立 Key)
// ==========================================
let Settings = {};

function initSettings() {
    const oldSettings = extension_settings.ds_cache_v17 || extension_settings.ds_cache_v16 || {};
    if (!extension_settings.ds_cache_v18) {
        extension_settings.ds_cache_v18 = {
            enabled: oldSettings.enabled ?? true,
            toastSys: oldSettings.toastSys ?? true,
            toastSysToggle: oldSettings.toastSysToggle ?? true, // 新增: 預設提示詞開關
            toastLore: oldSettings.toastLore ?? true,
            toastGlobalLore: oldSettings.toastGlobalLore ?? true, // 新增: 全局世界書
            toastHistory: oldSettings.toastHistory ?? true,
            showResetPrompt: oldSettings.showResetPrompt ?? true,
            autoAccept: oldSettings.autoAccept ?? false,
            logLevel: oldSettings.logLevel ?? 3,
            tolerance: oldSettings.tolerance ?? 1,
            maxCacheSize: oldSettings.maxCacheSize ?? 30,
            chats: oldSettings.chats || {},
            pinnedChats: oldSettings.pinnedChats || {} 
        };
    }
    Settings = extension_settings.ds_cache_v18;
    if (!Settings.pinnedChats) Settings.pinnedChats = {};
    if (!Settings.chats) Settings.chats = {}; 
}

function safeSave() {
    try { if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced(); } 
    catch (e) { console.warn("[DS Cache] 存檔失敗", e); }
}

function getTolerance() {
    if (Settings.tolerance === 0) return { sys: 0.5, his: 0.6 }; 
    if (Settings.tolerance === 1) return { sys: 0.2, his: 0.3 }; 
    return { sys: 0.05, his: 0.1 }; 
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// 獨立分類防抖管理器
const triggerDebouncers = {};
function triggerWarning(key, msg, toggle) {
    if (!Settings.enabled || !toggle) return;
    if (!triggerDebouncers[key]) {
        triggerDebouncers[key] = debounce(() => {
            if (typeof toastr !== 'undefined') toastr.warning(msg, '⚙️ DS 狀態變更', { timeOut: 2000 });
        }, 1200);
    }
    triggerDebouncers[key]();
}

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function performGarbageCollection() {
    const unpinnedKeys = Object.keys(Settings.chats).filter(k => !Settings.pinnedChats[k]);
    if (unpinnedKeys.length <= Settings.maxCacheSize) return;
    const sortedKeys = unpinnedKeys.sort((a, b) => (Settings.chats[a].lastAccessed || 0) - (Settings.chats[b].lastAccessed || 0));
    const toRemove = sortedKeys.slice(0, unpinnedKeys.length - Settings.maxCacheSize);
    toRemove.forEach(k => delete Settings.chats[k]);
    safeSave();
    Logger.warn(`[GC] 已自動清理 ${toRemove.length} 個休眠存檔。`);
    renderChatsUI();
}

// ==========================================
// 3. 核心日誌與狀態指示燈
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function updateTopBarState() {
    const dot = $('#ds-top-status-dot');
    if (!dot.length) return;
    if (!Settings.enabled) {
        dot.css('color', '#5c6370');
        $('#ds-top-reset-btn').attr('title', 'DS Cache: 已停用 (左鍵開啟 / 右鍵清空)');
    } else {
        dot.css('color', '#00ff00');
        $('#ds-top-reset-btn').attr('title', 'DS Cache: 運作中 (左鍵關閉 / 右鍵清空)');
    }
}

function setTopBarStatus(color, title) {
    if (!Settings.enabled) return;
    const dot = $('#ds-top-status-dot');
    if (dot.length) {
        dot.css('color', color);
        $('#ds-top-reset-btn').attr('title', title + ' (左鍵關閉 / 右鍵清空)');
    }
}

function logAt(level, type, msg) {
    if (Settings.logLevel < level) return;
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
    if (type === 'warn') console.warn(`%c[DS v18] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    else if (type === 'error') console.error(`[DS v18] 🔴 ${msg}`);
    else if (type === 'map') console.log(`%c[DS v18] 🗺️ ${msg}`, 'color: #00e5ff; font-weight: bold;');
    else console.log(`%c[DS v18] ✅ ${msg}`, 'color: #00ff00;');
    
    const container = document.getElementById('ds-cache-log-container');
    if (container) {
        const line = document.createElement('div');
        line.className = 'ds-log-line';
        line.innerHTML = `<span class="ds-log-time">[${time}]</span> <span class="ds-log-${type}">${msg.replace(/\n/g, '<br>')}</span>`;
        container.appendChild(line);
        while (container.childNodes.length > 200) container.removeChild(container.firstChild);
        container.scrollTop = container.scrollHeight;
    }
}

const Logger = {
    log: (msg, level = LogLevels.DETAILED) => logAt(level, 'info', msg),
    warn: (msg, level = LogLevels.BASIC) => logAt(level, 'warn', msg),
    map: (msg, level = LogLevels.BASIC) => logAt(level, 'map', msg),
    error: (msg, err, level = LogLevels.BASIC) => logAt(level, 'error', err ? `${msg} ${err}` : msg),
    normalize: (text) => (text || '').replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
    getSeqString: (seq) => seq.map(m => `[${m.tag}]`).join(' ➔ ')
};

// ==========================================
// 4. 狀態管理、原生擴充選單與頂部捷徑
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
        Settings.chats[chatKeyInfo.key] = { label: chatKeyInfo.label, frozenSequence: [], lastSentSequence: [], lastPrefills: [], lastAccessed: Date.now() };
        safeSave(); renderChatsUI();
    } else {
        Settings.chats[chatKeyInfo.key].lastAccessed = Date.now();
        performGarbageCollection();
    }
    return Settings.chats[chatKeyInfo.key];
}

// 頂部導航列的晶片按鈕
function addTopMenuButton() {
    if ($('#ds-top-reset-btn').length === 0) {
        const btn = $(`
            <li id="ds-top-reset-btn" class="menu_button interactable" title="DS Cache">
                <span class="fa-solid fa-microchip"></span>
                <span id="ds-top-status-dot" style="font-size:0.7em; margin-left:2px; vertical-align:top;"><i class="fa-solid fa-circle"></i></span>
            </li>
        `);
        btn.on('click', (e) => {
            e.preventDefault();
            Settings.enabled = !Settings.enabled;
            $('#ds-cache-enable').prop('checked', Settings.enabled);
            safeSave(); updateTopBarState();
            if (typeof toastr !== 'undefined') toastr.info(Settings.enabled ? "時序引擎已啟動" : "時序引擎已關閉", "DS Cache");
        });
        btn.on('contextmenu', (e) => {
            e.preventDefault();
            if(!confirm("確定要完全清空當前聊天的緩存狀態嗎？")) return;
            const key = getChatKey().key;
            delete Settings.chats[key];
            safeSave(); renderChatsUI();
            setTopBarStatus('#00ff00', 'DS Cache: 已清空');
            if (typeof toastr !== 'undefined') toastr.success("當前聊天的快取已清空！");
        });
        if ($('ul#extensions_menu').length > 0) $('ul#extensions_menu').append(btn);
        else if ($('#right-nav-extensions').length > 0) $('#right-nav-extensions').append(btn);
        updateTopBarState();
    }
}

// 整合至 ST 原生左下角擴充選單 (Magic Wand Popup)
function addBottomLeftMenuButton() {
    // #extensions_menu 通常是魔法棒點擊後彈出的 ul 列表
    if ($('#extensions_menu').length > 0 && $('#ds-bottom-reset-btn').length === 0) {
        const btn = $(`
            <li id="ds-bottom-reset-btn" class="menu_button interactable" title="清空當前聊天的 DS 快取池">
                <span class="fa-solid fa-microchip"></span> 重置 DS 快取
            </li>
        `);
        btn.on('click', () => {
            if(!confirm("確定要完全清空當前聊天的緩存狀態嗎？(回到 ST 預設頂部排序)")) return;
            const key = getChatKey().key;
            delete Settings.chats[key];
            safeSave(); renderChatsUI();
            setTopBarStatus('#00ff00', 'DS Cache: 已清空');
            if (typeof toastr !== 'undefined') toastr.success("當前聊天快取已重置！");
            Logger.warn(`由擴充選單手動清空了存檔: ${key}`);
            
            // 點擊後自動收起選單
            if ($('#extensions_menu').hasClass('open')) {
                $('#extensions_menu').removeClass('open').hide();
            }
        });
        $('#extensions_menu').append(btn);
    }
}

function exportData() {
    const dataStr = JSON.stringify(Settings, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `DS_Cache_Backup_v18_${new Date().getTime()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    if (typeof toastr !== 'undefined') toastr.success("備份檔案已匯出！");
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            if (imported && typeof imported === 'object') {
                Object.assign(Settings, imported);
                safeSave(); renderChatsUI();
                $('#ds-cache-enable').prop('checked', Settings.enabled);
                updateTopBarState();
                if (typeof toastr !== 'undefined') toastr.success("資料還原成功！");
            }
        } catch (err) {
            Logger.error("匯入失敗", err);
            if (typeof toastr !== 'undefined') toastr.error("檔案格式錯誤");
        }
        event.target.value = '';
    };
    reader.readAsText(file);
}

// ==========================================
// 5. 核心邏輯工具 (絕對不變)
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
// 6. 現代化攔截器 UI
// ==========================================
function askUserForResetAsync(dropPercent, mapInfo) {
    return new Promise(resolve => {
        let progColor = '#98c379'; 
        if (dropPercent >= 50) progColor = '#e06c75'; 
        else if (dropPercent >= 20) progColor = '#e5c07b'; 

        const html = `
            <div class="ds-overlay" id="ds-modal-wrapper">
                <div class="ds-modal">
                    <h2 class="ds-modal-title"><span class="fa-solid fa-code-merge"></span> 緩存斷裂預警 (原位同步中)</h2>
                    <p class="ds-modal-text">檢測到陣列發生變更。這將導致預計 <b style="color:${progColor}">${dropPercent}%</b> 的歷史對話緩存失效並重新運算。<br><br><b>插件已自動完成時序陣列的原位更新與補位。</b>請問要接受本次修改嗎？</p>
                    <div class="ds-progress-container"><div class="ds-progress-bar" id="ds-prog-bar" style="background: ${progColor};"></div></div>
                    <div class="ds-map-box">${mapInfo}</div>
                    <div class="ds-btn-group">
                        <button class="ds-btn ds-btn-accept" id="ds-btn-accept">
                            <span class="fa-solid fa-check-double"></span> 確認同步
                            <span class="ds-btn-sub">接受修改並發送</span>
                            <span class="ds-key-hint">Enter ↵</span>
                        </button>
                        <button class="ds-btn ds-btn-abort" id="ds-btn-abort">
                            <span class="fa-solid fa-ban"></span> 攔截發送
                            <span class="ds-btn-sub">中止生成並復原</span>
                            <span class="ds-key-hint">Esc</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
        $('body').append(html);
        setTimeout(() => { $('#ds-prog-bar').css('width', `${Math.min(dropPercent, 100)}%`); }, 50);

        const cleanup = () => { $('#ds-modal-wrapper').remove(); document.removeEventListener('keydown', keyHandler, true); };
        const accept = () => { cleanup(); resolve('reset'); };
        const abort = () => { cleanup(); resolve('abort'); };

        $('#ds-btn-accept').click(accept);
        $('#ds-btn-abort').click(abort);

        const keyHandler = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); accept(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); abort(); }
        };
        document.addEventListener('keydown', keyHandler, true);
    });
}

// ==========================================
// 7. 核心時序處理器 (維持嚴謹原邏輯)
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
                    Logger.warn(`[SYS 同步] 原位修改。`, LogLevels.DEBUG);
                } else {
                    Logger.warn(`[SYS 同步] 原位刪除。`, LogLevels.DEBUG);
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
                    Logger.warn(`[歷史同步] 歷史對話被刪除，自動補位。`, LogLevels.DEBUG);
                }
            }
        }

        for (let h of remainingHistory) rawFrozenSequence.push(h);
        for (let sys of sysMsgsPool) rawFrozenSequence.push(sys);

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

        let requireResetConfirm = false;
        let dropPercentStr = "0.0";
        let mapInfoText = "無變更";
        let wastedLen = 0;
        let proposedLen = 0;

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

            for (let i = 0; i < P.length; i++) {
                let len = P[i].content?.length || 0;
                proposedLen += len;
                if (i >= breakIndex) {
                    let foundInL = L.some(oldM => oldM.role === P[i].role && oldM.norm === P[i].norm);
                    if (foundInL) wastedLen += len;
                }
            }

            if (isPureContextShift) { wastedLen = 0; Logger.log(`[分析] 自然上下文推移，抑制彈窗。`, LogLevels.DEBUG); }

            let dropRatio = proposedLen === 0 ? 0 : (wastedLen / proposedLen);
            
            if (dropRatio > 0.10 && Settings.showResetPrompt) {
                requireResetConfirm = true;
                dropPercentStr = (dropRatio * 100).toFixed(1);
                
                const tagHtml = `<span class="ds-tag ds-tag-${P[breakIndex]?.tag}">[${P[breakIndex]?.tag}]</span>`;
                const oldContent = escapeHtml(L[breakIndex]?.content || '∅').substring(0, 60).replace(/\n/g, ' ↵ ');
                const newContent = escapeHtml(P[breakIndex]?.content || '∅').substring(0, 60).replace(/\n/g, ' ↵ ');
                
                mapInfoText = `
                    <div style="margin-bottom:8px; display:flex; align-items:center; gap:8px;">
                        <span style="color:#56b6c2;"><i class="fa-solid fa-location-crosshairs"></i> 斷裂點索引:</span> <b>[${breakIndex}]</b> ${tagHtml}
                    </div>
                    <div class="ds-diff-del"><i class="fa-solid fa-minus"></i> ${oldContent}...</div>
                    <div class="ds-diff-add"><i class="fa-solid fa-plus"></i> ${newContent}...</div>
                `;
            }
        }

        let decision = 'ignore';
        setTopBarStatus('#00ff00', 'DS Cache: 健康');

        if (requireResetConfirm) {
            setTopBarStatus('#ffaa00', `DS Cache: 阻斷中`);
            if (Settings.autoAccept) {
                Logger.warn(`[靜默重組] 自動放行重組，流失 ${dropPercentStr}%`);
                if (typeof toastr !== 'undefined') toastr.info(`已在背景自動重組時序 (流失 ${dropPercentStr}%)`, "DS Cache");
                decision = 'reset';
            } else {
                decision = await askUserForResetAsync(dropPercentStr, mapInfoText);
            }
        }

        if (decision === 'abort') {
            Logger.error('[攔截] 已強制中止生成', null, LogLevels.BASIC);
            setTopBarStatus('#e06c75', 'DS Cache: 使用者中斷');
            if (typeof toastr !== 'undefined') toastr.error("已強制攔截！請復原提示詞。", "DS Cache");
            stream.splice(0, stream.length); 
            return;
        }

        if (decision === 'reset') {
            Logger.log('[同步] 接受原位修改，數據鏈更新。', LogLevels.BASIC);
            setTopBarStatus('#00e5ff', 'DS Cache: 時序已重構');
            setTimeout(() => setTopBarStatus('#00ff00', 'DS Cache: 健康'), 3000);
        }

        state.frozenSequence = dedupedSequence;
        state.lastPrefills = currentTurn.prefills;

        const finalStream = [...state.frozenSequence];
        if (currentTurn.user) finalStream.push(currentTurn.user);
        for (const p of currentTurn.prefills) finalStream.push(p);

        state.lastSentSequence = finalStream;
        safeSave();

        stream.splice(0, stream.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
        Logger.log('✅ 排序整理完成，授權發送。', LogLevels.BASIC);

    } catch (err) {
        setTopBarStatus('#e06c75', 'DS Cache: 核心崩潰');
        Logger.error('攔截器崩潰', err);
        throw err;
    }
}

// ==========================================
// 8. 介面面板與事件綁定 (精細化感知)
// ==========================================
function renderChatsUI() {
    const container = $('#ds-chat-list-container');
    if (container.length === 0) return;
    container.empty();
    
    const keys = Object.keys(Settings.chats);
    if (keys.length === 0) {
        container.append('<div style="font-size:0.85em; opacity:0.5; padding:10px; text-align:center;">快取池無資料</div>');
        return;
    }

    const currentKey = getChatKey().key; 
    const sortedKeys = keys.sort((a, b) => {
        if (a === currentKey) return -1;
        if (b === currentKey) return 1;
        const pinA = Settings.pinnedChats[a] ? 1 : 0;
        const pinB = Settings.pinnedChats[b] ? 1 : 0;
        if (pinA !== pinB) return pinB - pinA;
        return (Settings.chats[b].lastAccessed || 0) - (Settings.chats[a].lastAccessed || 0);
    });

    sortedKeys.forEach(key => {
        const chat = Settings.chats[key];
        const count = chat.frozenSequence?.length || 0;
        const isActive = (key === currentKey); 
        const isPinned = Settings.pinnedChats[key] === true;
        
        let timeStr = "未知";
        if (chat.lastAccessed) {
            const diff = Math.floor((Date.now() - chat.lastAccessed) / 60000);
            if (diff < 1) timeStr = "剛剛";
            else if (diff < 60) timeStr = `${diff} 分鐘前`;
            else timeStr = `${Math.floor(diff/60)} 小時前`;
        }

        const pinColor = isPinned ? '#e5c07b' : 'rgba(255,255,255,0.3)';
        const html = `
            <div class="ds-chat-item ${isActive ? 'active-chat' : ''}" title="${isActive ? '這是您目前的對話存檔' : ''}">
                <div style="display:flex; flex-direction:column; overflow:hidden; width:70%;">
                    <span style="font-size:0.85em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:${isActive?'#00e5ff':'#fff'};">${isActive ? '🟢 ' : ''}${escapeHtml(chat.label)}</span>
                    <div style="display:flex; gap:10px; font-size:0.7em;">
                        <span style="color:#98c379;">節點: ${count}</span>
                        <span style="color:#5c6370;"><i class="fa-regular fa-clock"></i> ${timeStr}</span>
                    </div>
                </div>
                <div class="ds-action-group">
                    <button class="menu_button interactable ds-pin-btn" data-key="${key}" style="font-size:0.8em; padding:4px 8px; border-radius:4px; color:${pinColor};" title="${isPinned ? '取消釘選' : '釘選保護'}">
                        <span class="fa-solid fa-thumbtack"></span>
                    </button>
                    <button class="menu_button interactable ds-reset-btn" data-key="${key}" style="font-size:0.8em; padding:4px 8px; border-radius:4px; color:#e06c75;" title="刪除快取">
                        <span class="fa-solid fa-trash"></span>
                    </button>
                </div>
            </div>
        `;
        container.append(html);
    });

    container.find('.ds-reset-btn').on('click', function() {
        const key = $(this).data('key');
        delete Settings.chats[key];
        delete Settings.pinnedChats[key];
        safeSave(); renderChatsUI();
        if (typeof toastr !== 'undefined') toastr.success("已刪除該存檔");
    });
    container.find('.ds-pin-btn').on('click', function() {
        const key = $(this).data('key');
        if (Settings.pinnedChats[key]) delete Settings.pinnedChats[key];
        else Settings.pinnedChats[key] = true;
        safeSave(); renderChatsUI();
    });
}

function showTopology() {
    const chatKeyInfo = getChatKey();
    const state = Settings.chats[chatKeyInfo.key];
    if (!state || !state.frozenSequence || state.frozenSequence.length === 0) {
        if (typeof toastr !== 'undefined') toastr.info("當前對話尚無快取數據");
        return;
    }
    let timelineHtml = '';
    state.frozenSequence.forEach((m, idx) => {
        const preview = escapeHtml(m.content || '').substring(0, 100).replace(/\n/g, ' ↵ ');
        timelineHtml += `
            <div class="ds-timeline-item">
                <div class="ds-timeline-index">[${idx}]</div>
                <div><span class="ds-tag ds-tag-${m.tag}">${m.tag}</span></div>
                <div class="ds-timeline-content">${preview}...</div>
            </div>
        `;
    });

    const html = `
        <div class="ds-overlay" id="ds-topo-wrapper">
            <div class="ds-modal" style="max-width: 550px; padding: 25px;">
                <h2 class="ds-modal-title" style="color:#56b6c2; font-size:18px;"><span class="fa-solid fa-list-ol"></span> 凍結拓撲結構 (垂直時間軸)</h2>
                <div class="ds-map-box ds-timeline-container">${timelineHtml}</div>
                <button class="ds-btn ds-btn-accept" style="width:100%; margin-top:15px;" id="ds-btn-close-topo">關閉預覽 (Esc/Enter)</button>
            </div>
        </div>
    `;
    $('body').append(html);
    const closeTopo = () => { $('#ds-topo-wrapper').remove(); document.removeEventListener('keydown', topoKeyHandler, true); };
    $('#ds-btn-close-topo').click(closeTopo);
    const topoKeyHandler = (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTopo(); } };
    document.addEventListener('keydown', topoKeyHandler, true);
}

async function setupUI() {
    try {
        injectCSS();
        const html = `
        <div class="inline-drawer" id="ds-v18-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><span class="fa-solid fa-satellite-dish"></span> Deepseek Cache (v18 完備感知版)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:15px; background: rgba(0,0,0,0.2);">
                
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <label class="checkbox_label" style="font-weight:bold; color:#00e5ff;"><input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}> 啟用時序守護引擎</label>
                    <button id="ds-btn-topo" class="menu_button interactable" style="font-size:0.8em; padding:3px 8px; background:rgba(86,182,194,0.1); color:#56b6c2; border:1px solid #56b6c2;"><span class="fa-solid fa-eye"></span> 檢視拓撲</button>
                </div>
                
                <div style="margin:5px 0 15px 15px; border-left: 3px solid #00e5ff; padding-left: 12px; display:flex; flex-direction:column; gap:4px;">
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-sys" ${Settings.toastSys ? 'checked' : ''}> 📝 提示詞 (內容) 變更通知</label>
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-sys-toggle" ${Settings.toastSysToggle ? 'checked' : ''}> 🎚️ 提示詞 (開關) 切換通知</label>
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-lore" ${Settings.toastLore ? 'checked' : ''}> 📖 角色世界書變更通知</label>
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-global-lore" ${Settings.toastGlobalLore ? 'checked' : ''}> 🌍 全局世界書變更通知</label>
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-his" ${Settings.toastHistory ? 'checked' : ''}> 💬 歷史對話編輯/刪除通知</label>
                    <hr style="border: 0; border-top: 1px dashed rgba(255,255,255,0.1); margin: 4px 0;">
                    <label class="checkbox_label" style="font-size:0.85em; color:#e06c75;"><input type="checkbox" id="ds-toast-reset" ${Settings.showResetPrompt ? 'checked' : ''}> 🛑 啟用視覺化攔截阻斷器</label>
                    <label class="checkbox_label" style="font-size:0.85em; color:#e5c07b;" title="遇到斷裂時，自動在背景放行重組，不彈視窗"><input type="checkbox" id="ds-cache-auto-accept" ${Settings.autoAccept ? 'checked' : ''}> ⚡ 啟用靜默自動修復 (Auto-Accept)</label>
                </div>
                
                <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:15px; background:rgba(255,255,255,0.02); padding:10px; border-radius:6px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.85em; color:#abb2bf;">判定容錯率:</span>
                        <select id="ds-cache-tolerance" class="text_pole" style="width:120px; font-size:0.8em; padding:2px;">
                            <option value="0" ${Settings.tolerance===0?'selected':''}>嚴格</option>
                            <option value="1" ${Settings.tolerance===1?'selected':''}>標準</option>
                            <option value="2" ${Settings.tolerance===2?'selected':''}>寬鬆</option>
                        </select>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.85em; color:#abb2bf;">GC 最大快取數:</span>
                        <input type="number" id="ds-cache-maxsize" class="text_pole" value="${Settings.maxCacheSize}" min="5" max="100" style="width:120px; font-size:0.8em; padding:2px; text-align:center;">
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:5px;">
                        <button id="ds-btn-export" class="menu_button interactable" style="flex:1; margin-right:5px; font-size:0.8em; padding:4px;"><span class="fa-solid fa-download"></span> 備份資料</button>
                        <button id="ds-btn-import" class="menu_button interactable" style="flex:1; margin-left:5px; font-size:0.8em; padding:4px;"><span class="fa-solid fa-upload"></span> 還原資料</button>
                        <input type="file" id="ds-file-import" style="display:none;" accept=".json">
                    </div>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                    <b style="font-size:0.85em; color:#e5c07b;"><span class="fa-solid fa-database"></span> 存檔防護與快取池：</b>
                    <span id="ds-toggle-chat" class="ds-mini-btn" style="color:#abb2bf;"><i class="fa-solid fa-chevron-up"></i> 收摺</span>
                </div>
                <div id="ds-chat-list-container" class="ds-chat-container"></div>
                <button id="ds-cache-factory-reset" class="menu_button" style="width:100%; margin-bottom:15px; background:rgba(224, 108, 117, 0.2); color:#e06c75; border:1px solid #e06c75;"><span class="fa-solid fa-skull"></span> 格式化所有快取數據</button>
                
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                    <b style="font-size:0.85em; color:#98c379;"><span class="fa-solid fa-terminal"></span> 執行緒終端機：</b>
                    <div style="display:flex; gap:10px;">
                        <span id="ds-btn-clearlog" class="ds-mini-btn" title="清空日誌" style="color:#e06c75;"><span class="fa-solid fa-trash"></span></span>
                        <span id="ds-toggle-log" class="ds-mini-btn" style="color:#abb2bf;"><i class="fa-solid fa-chevron-up"></i> 收摺</span>
                    </div>
                </div>
                <div id="ds-cache-log-container" class="ds-log-terminal"></div>
            </div>
        </div>`;
        
        $('#extensions_settings').append(html);

        $('#ds-cache-enable').on('change', function () { Settings.enabled = $(this).is(':checked'); safeSave(); updateTopBarState(); });
        $('#ds-toast-sys').on('change', function () { Settings.toastSys = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-sys-toggle').on('change', function () { Settings.toastSysToggle = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-lore').on('change', function () { Settings.toastLore = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-global-lore').on('change', function () { Settings.toastGlobalLore = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-his').on('change', function () { Settings.toastHistory = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-reset').on('change', function () { Settings.showResetPrompt = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-auto-accept').on('change', function () { Settings.autoAccept = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-tolerance').on('change', function () { Settings.tolerance = parseInt($(this).val()); safeSave(); Logger.log(`容錯率已切換為: ${$(this).find("option:selected").text()}`); });
        $('#ds-cache-maxsize').on('change', function () { Settings.maxCacheSize = parseInt($(this).val()) || 30; safeSave(); performGarbageCollection(); });

        $('#ds-cache-factory-reset').on('click', () => {
            if (confirm("這將使所有提示詞回到 ST 預設的頂部排序！確定要格式化嗎？")) { Settings.chats = {}; Settings.pinnedChats = {}; safeSave(); renderChatsUI(); }
        });
        
        $('#ds-btn-clearlog').on('click', () => { $('#ds-cache-log-container').empty(); });
        $('#ds-btn-topo').on('click', showTopology);

        $('#ds-btn-export').on('click', exportData);
        $('#ds-btn-import').on('click', () => $('#ds-file-import').click());
        $('#ds-file-import').on('change', importData);

        $('#ds-toggle-chat').on('click', function() {
            $('#ds-chat-list-container').toggleClass('collapsed');
            $(this).html($('#ds-chat-list-container').hasClass('collapsed') ? '<i class="fa-solid fa-chevron-down"></i> 展開' : '<i class="fa-solid fa-chevron-up"></i> 收摺');
        });
        $('#ds-toggle-log').on('click', function() {
            $('#ds-cache-log-container').toggleClass('collapsed');
            $(this).html($('#ds-cache-log-container').hasClass('collapsed') ? '<i class="fa-solid fa-chevron-down"></i> 展開' : '<i class="fa-solid fa-chevron-up"></i> 收摺');
        });
        
        renderChatsUI();
    } catch (e) { console.error('[DS Cache] UI初始化崩潰', e); }
}

jQuery(async () => {
    try {
        initSettings(); 
        await setupUI();
        
        setTimeout(() => {
            addTopMenuButton();
            addBottomLeftMenuButton(); // 注入魔法棒擴充選單
        }, 2000);
        
        if (eventSource) {
            eventSource.on(event_types.CHAT_CHANGED, () => {
                addTopMenuButton();
                addBottomLeftMenuButton();
                renderChatsUI(); 
            });

            if (event_types?.CHAT_COMPLETION_PROMPT_READY) {
                eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
            }
            if (event_types?.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, () => triggerWarning('his_del', '歷史對話被刪除！準備原位補位', Settings.toastHistory));
            if (event_types?.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, () => triggerWarning('his_edit', '歷史對話被修改！準備原位更新', Settings.toastHistory));
        }

        // 1. 提示詞(內容)監聽
        $(document).on('change select2:select input focusout', '#chat_completion_preset, .preset_select, select[id*="preset"], #main_prompt_textarea, #nsfw_prompt_textarea, #jailbreak_prompt_textarea, #rm_ch_sys_prompt', function() {
            triggerWarning('sys_text', '提示詞內容變更！準備原位更新', Settings.toastSys);
        });

        // 2. 提示詞(開關)監聽 (包含任何名帶 prompt 的 checkbox)
        $(document).on('change', 'input[type="checkbox"][id*="prompt"], input[type="checkbox"][id*="jailbreak"], input[type="checkbox"][id*="nsfw"], .prompt_toggle', function() {
            triggerWarning('sys_toggle', '預設提示詞開關切換！準備原位更新', Settings.toastSysToggle);
        });

        // 3. 世界書分離感知監聽 (文字區域與輸入框)
        $(document).on('input change focusout', '.world_info_entry textarea, .world_info_entry input, .lorebook_entry textarea, .lorebook_entry input, #world_info_settings_panel textarea', function() {
            // 利用 DOM 樹的父節點判斷是否為全局面板 (ST 的 W.I. Panel ID)
            const isGlobal = $(this).closest('#world_info_panel, .world_info_manager').length > 0;
            if (isGlobal) {
                triggerWarning('lore_global', '全局世界書變更！準備原位附加', Settings.toastGlobalLore);
            } else {
                triggerWarning('lore_char', '角色專屬世界書變更！準備原位附加', Settings.toastLore);
            }
        });

        Logger.log('══════ v18.0 完備感知版 (Omni-Sense) 引擎上線 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件啟動失敗:', e);
    }
});
