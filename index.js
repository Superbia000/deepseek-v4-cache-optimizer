import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 1. 樣式注入
// ==========================================
const injectCSS = () => {
    if (document.getElementById('ds-cache-styles')) return;
    const style = document.createElement('style');
    style.id = 'ds-cache-styles';
    style.innerHTML = `
        .ds-opt-group { margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; background: rgba(0,0,0,0.15); overflow: hidden; }
        .ds-opt-header { padding: 10px 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #56b6c2; background: rgba(255,255,255,0.05); transition: 0.2s; }
        .ds-opt-header:hover { background: rgba(255,255,255,0.1); }
        .ds-opt-content { padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; display: none; }
        .ds-opt-group.open .ds-opt-content { display: flex; animation: dsFadeIn 0.2s ease-out; }
        .ds-opt-group.open .ds-opt-header i.fa-chevron-down { transform: rotate(180deg); }

        .ds-row { display: flex; flex-direction: row; justify-content: space-between; align-items: center; width: 100%; gap: 10px; }
        .ds-row-left { display: flex; flex-direction: row; justify-content: flex-start; align-items: center; gap: 8px; cursor: pointer; color: #abb2bf; font-size: 0.9em; white-space: nowrap; flex: 1; }
        .ds-row-left input[type="checkbox"] { margin: 0; }
        
        .ds-log-toolbar { display: flex; gap: 5px; margin-bottom: 5px; }
        .ds-log-filter { cursor: pointer; padding: 2px 8px; border-radius: 12px; font-size: 10px; background: rgba(255,255,255,0.1); color: #abb2bf; transition: 0.2s; }
        .ds-log-filter.active { background: #56b6c2; color: #121212; font-weight: bold; }
        .ds-log-filter:hover:not(.active) { background: rgba(255,255,255,0.2); }
        .ds-log-terminal { background: var(--black50a, #0a0a0a); color: var(--SmartThemeBody-color, #a9b7c6); font-family: Consolas, monospace; font-size: 11px; height: 280px; overflow-y: auto; border-radius: 6px; padding: 10px; border: 1px solid var(--SmartThemeBorder-color, #333); box-shadow: inset 0 0 10px rgba(0,0,0,0.8); scroll-behavior: smooth; }
        .ds-log-line { margin-bottom: 4px; line-height: 1.4; word-wrap: break-word; }
        .ds-log-line.hide { display: none; }
        .ds-log-time { color: #5c6370; margin-right: 5px; user-select: none; }
        .ds-log-info { color: #98c379; }
        .ds-log-warn { color: #e5c07b; font-weight: bold; }
        .ds-log-error { color: #e06c75; font-weight: bold; }
        .ds-log-map { color: #56b6c2; font-weight: bold; }
        .ds-log-debug { color: #c678dd; }
        .ds-log-divider { color: #4b5263; font-weight: bold; display: block; text-align: center; margin: 8px 0; border-top: 1px dashed #4b5263; padding-top: 4px; }
        
        .ds-tag { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; background: rgba(255,255,255,0.05); }
        .ds-tag-SYS { color: #61afef; border-left: 2px solid #61afef; }
        .ds-tag-USER { color: #98c379; border-left: 2px solid #98c379; }
        .ds-tag-AI { color: #e5c07b; border-left: 2px solid #e5c07b; }
        .ds-tag-PREFILL { color: #c678dd; border-left: 2px solid #c678dd; }

        .ds-chat-container { max-height:220px; overflow-y:auto; border:1px solid rgba(255,255,255,0.1); padding:5px; border-radius:6px; background:var(--black50a, #121212); }
        .ds-chat-item { display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:8px; margin-bottom:6px; border-radius:6px; border:1px solid rgba(255,255,255,0.05); transition: 0.2s; }
        .ds-chat-item:hover { background:rgba(255,255,255,0.08); }
        .ds-chat-item.active-chat { background:rgba(0, 229, 255, 0.08); border:1px solid #00e5ff; box-shadow: inset 0 0 10px rgba(0,229,255,0.15); }
        
        .ds-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); z-index: 999999; display: flex; align-items: center; justify-content: center; animation: dsFadeIn 0.2s ease-out; }
        .ds-modal { background: var(--SmartThemeBlurTintColor, #1e1e24); border: 1px solid #e06c75; padding: 30px; border-radius: 12px; max-width: 700px; width: 90%; color: var(--SmartThemeBody-color, #fff); font-family: sans-serif; box-shadow: 0 25px 50px rgba(0,0,0,0.9); position: relative; overflow: hidden; animation: dsSlideUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .ds-modal-title { color: #e06c75; margin: 0 0 15px 0; display: flex; align-items: center; gap: 10px; font-size: 20px; }
        .ds-progress-container { background: rgba(0,0,0,0.5); border-radius: 6px; height: 10px; margin: 15px 0; overflow: hidden; box-shadow: inset 0 2px 4px rgba(0,0,0,0.5); }
        .ds-progress-bar { height: 100%; width: 0%; transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1), background 0.3s; }
        
        .ds-map-box { background: rgba(0,0,0,0.4); padding: 12px; border-radius: 8px; font-family: Consolas, monospace; font-size: 13px; color: #abb2bf; margin: 15px 0; border: 1px solid rgba(255,255,255,0.1); max-height: 250px; overflow-y: auto; }
        .ds-diff-del { background: rgba(224, 108, 117, 0.15); border-left: 3px solid #e06c75; padding: 6px 10px; margin-bottom: 4px; border-radius: 0 4px 4px 0; color: #e06c75; word-wrap: break-word; }
        .ds-diff-add { background: rgba(152, 195, 121, 0.15); border-left: 3px solid #98c379; padding: 6px 10px; border-radius: 0 4px 4px 0; color: #98c379; word-wrap: break-word; }
        
        .ds-btn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 25px; }
        .ds-btn { padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 14px; transition: all 0.2s; position: relative; overflow: hidden; display:flex; align-items:center; justify-content:center; gap:8px;}
        .ds-btn:hover { transform: translateY(-2px); filter: brightness(1.15); box-shadow: 0 5px 15px rgba(0,0,0,0.4); }
        .ds-btn:active { transform: translateY(0); }
        .ds-btn-accept { background: #98c379; color: #121212; }
        .ds-btn-abort { background: #e06c75; color: #fff; }
        .ds-btn-bypass { background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); }
        .ds-btn-reset { background: rgba(224, 108, 117, 0.1); color: #e06c75; border: 1px solid #e06c75; }

        .ds-badge { background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-size: 0.8em; font-family: monospace; color: #56b6c2; }
        .ds-zen-icon { color: #c678dd; animation: dsPulse 2s infinite; }
        
        @keyframes dsFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes dsSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes dsPulse { 0% { opacity: 0.6; } 50% { opacity: 1; text-shadow: 0 0 5px #c678dd; } 100% { opacity: 0.6; } }
    `;
    document.head.appendChild(style);
};

// ==========================================
// 2. 狀態與基礎設定
// ==========================================
let Settings = {};

function initSettings() {
    const oldSettings = extension_settings.ds_cache_v23 || extension_settings.ds_cache_v22 || {};
    if (!extension_settings.ds_cache_v24) {
        extension_settings.ds_cache_v24 = {
            enabled: oldSettings.enabled ?? true,
            zenMode: oldSettings.zenMode ?? false,
            toastHistory: oldSettings.toastHistory ?? true,
            showResetPrompt: oldSettings.showResetPrompt ?? true,
            autoAccept: oldSettings.autoAccept ?? false,
            logLevel: oldSettings.logLevel ?? 2,
            tolerance: oldSettings.tolerance ?? 1,
            maxCacheSize: oldSettings.maxCacheSize ?? 30,
            hotkeysEnabled: oldSettings.hotkeysEnabled ?? true,
            autoPinThreshold: oldSettings.autoPinThreshold ?? 0,
            chats: oldSettings.chats || {},
            pinnedChats: oldSettings.pinnedChats || {} 
        };
    }
    Settings = extension_settings.ds_cache_v24;
    if (!Settings.pinnedChats) Settings.pinnedChats = {};
    if (!Settings.chats) Settings.chats = {}; 
}

function safeSave() {
    try { 
        if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced(); 
        if (Math.random() < 0.1) localStorage.setItem('ds_cache_v24_snapshot', JSON.stringify(Settings));
    } catch (e) {}
}

function getTolerance() {
    if (Settings.tolerance === 0) return { sys: 0.5, his: 0.6 }; 
    if (Settings.tolerance === 1) return { sys: 0.2, his: 0.3 }; 
    return { sys: 0.05, his: 0.1 }; 
}

const triggerThrottlers = {};
function triggerWarningImmediate(key, msg, isEnabled) {
    if (!Settings.enabled || !isEnabled) return;
    const now = Date.now();
    if (!triggerThrottlers[key] || now - triggerThrottlers[key] > 30000) {
        triggerThrottlers[key] = now;
        if (Settings.zenMode) {
            Logger.log(`[免打扰模式] 已隐藏通知: ${msg}`, LogLevels.BASIC);
        } else {
            if (typeof toastr !== 'undefined') toastr.warning(msg, '💡 缓存优化器', { timeOut: 3000 });
        }
    }
}

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function truncateLog(str, len = 60) {
    if (!str) return '∅';
    const s = String(str).replace(/\n/g, ' ↵ ');
    return s.length > len ? s.substring(0, len) + '...' : s;
}

function calculateExactStorage(object) {
    try {
        let bytes = 0; const stack = [object]; const seen = new Set();
        while (stack.length) {
            const value = stack.pop();
            if (typeof value === 'boolean') bytes += 4;
            else if (typeof value === 'string') bytes += value.length * 2;
            else if (typeof value === 'number') bytes += 8;
            else if (typeof value === 'object' && value !== null && !seen.has(value)) {
                seen.add(value);
                for (const key in value) { bytes += key.length * 2; stack.push(value[key]); }
            }
        }
        return bytes > 1048576 ? (bytes / 1048576).toFixed(2) + ' MB' : (bytes / 1024).toFixed(1) + ' KB';
    } catch(e) { return 'Unknown'; }
}

function performGarbageCollection() {
    const unpinnedKeys = Object.keys(Settings.chats).filter(k => !Settings.pinnedChats[k]);
    if (unpinnedKeys.length <= Settings.maxCacheSize) return;
    const sortedKeys = unpinnedKeys.sort((a, b) => (Settings.chats[a].lastAccessed || 0) - (Settings.chats[b].lastAccessed || 0));
    const toRemove = sortedKeys.slice(0, unpinnedKeys.length - Settings.maxCacheSize);
    toRemove.forEach(k => delete Settings.chats[k]);
    safeSave();
    Logger.warn(`[自动清理] 已清理 ${toRemove.length} 个很久没用的旧对话存档。`);
    renderChatsUI();
}

// ==========================================
// 3. 醫療級日誌系統 
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function updateTopBarState() {
    const dot = $('#ds-top-status-dot');
    if (!dot.length) return;
    if (!Settings.enabled) {
        dot.css('color', '#5c6370');
        $('#ds-top-reset-btn').attr('title', '缓存优化: 已停用');
        dot.html('<i class="fa-solid fa-circle"></i>');
    } else if (Settings.zenMode) {
        dot.css('color', '#c678dd');
        $('#ds-top-reset-btn').attr('title', '缓存优化: 运作中 [免打扰]');
        dot.html('<i class="fa-solid fa-yin-yang ds-zen-icon"></i>');
    } else {
        dot.css('color', '#00ff00');
        $('#ds-top-reset-btn').attr('title', '缓存优化: 运作中');
        dot.html('<i class="fa-solid fa-circle"></i>');
    }
}

function setTopBarStatus(color, title) {
    if (!Settings.enabled) return;
    const dot = $('#ds-top-status-dot');
    if (dot.length) {
        if (!Settings.zenMode || color === '#e06c75') { 
            dot.css('color', color);
            if(color === '#00ff00') dot.html('<i class="fa-solid fa-circle"></i>');
        }
        $('#ds-top-reset-btn').attr('title', title + ' (左键开关 / 右键清空)');
    }
}

function logAt(level, type, msg) {
    if (Settings.logLevel < level) return;
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
    
    if (type === 'warn') console.warn(`%c[优化器] 🌪️ ${msg}`, 'color: #ffaa00;');
    else if (type === 'error') console.error(`[优化器] 🔴 ${msg}`);
    else if (type === 'map') console.log(`%c[优化器] 🗺️ ${msg}`, 'color: #00e5ff;');
    else if (type === 'debug') console.log(`%c[优化器] 🐛 ${msg}`, 'color: #c678dd;');
    else if (type === 'divider') console.log(`%c${msg}`, 'color: #4b5263; font-weight: bold;');
    else console.log(`%c[优化器] ✅ ${msg}`, 'color: #00ff00;');
    
    const container = document.getElementById('ds-cache-log-container');
    if (container) {
        const line = document.createElement('div');
        line.className = 'ds-log-line';
        line.setAttribute('data-type', type === 'divider' ? 'info' : type);
        if (type === 'divider') line.innerHTML = `<span class="ds-log-divider">${msg}</span>`;
        else line.innerHTML = `<span class="ds-log-time">[${time}]</span> <span class="ds-log-${type}">${msg.replace(/\n/g, '<br>')}</span>`;
        
        container.appendChild(line);
        const activeFilter = $('.ds-log-filter.active').data('filter') || 'all';
        if (activeFilter !== 'all' && activeFilter !== type && type !== 'divider') line.classList.add('hide');
        while (container.childNodes.length > 500) container.removeChild(container.firstChild);
        container.scrollTop = container.scrollHeight;
    }
}

const Logger = {
    log: (msg, level = LogLevels.DETAILED) => logAt(level, 'info', msg),
    warn: (msg, level = LogLevels.BASIC) => logAt(level, 'warn', msg),
    map: (msg, level = LogLevels.BASIC) => logAt(level, 'map', msg),
    error: (msg, err, level = LogLevels.BASIC) => logAt(level, 'error', err ? `${msg} ${err}` : msg),
    debug: (msg) => logAt(LogLevels.DEBUG, 'debug', msg),
    divider: (msg) => logAt(LogLevels.BASIC, 'divider', msg),
    normalize: (text) => (text || '').replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
};

// ==========================================
// 4. 狀態管理與強制選單注入
// ==========================================
function getChatKey() {
    const context = getContext();
    let charName = "未知角色";
    if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
        charName = context.characters[context.characterId].name || context.characterId;
    } else if (context.name2) charName = context.name2;
    let chatId = context.chatId || "默认聊天";
    let groupId = context.groupId;
    if (groupId) return { key: `group_${groupId}_${chatId}`, label: `群聊: ${chatId}` };
    return { key: `char_${context.characterId}_${chatId}`, label: `${charName} | 存档: ${chatId}` };
}

function getChatState(chatKeyInfo) {
    if (!Settings.chats[chatKeyInfo.key]) {
        Settings.chats[chatKeyInfo.key] = { label: chatKeyInfo.label, frozenSequence: [], lastSentSequence: [], lastAccessed: Date.now() };
        safeSave(); renderChatsUI();
    } else {
        Settings.chats[chatKeyInfo.key].lastAccessed = Date.now();
        performGarbageCollection();
    }
    return Settings.chats[chatKeyInfo.key];
}

function ensureTopMenuButton() {
    if ($('#ds-top-reset-btn').length === 0) {
        const btn = $(`
            <li id="ds-top-reset-btn" class="menu_button interactable" title="DeepSeek 缓存优化器">
                <span class="fa-solid fa-microchip"></span>
                <span id="ds-top-status-dot" style="font-size:0.7em; margin-left:2px; vertical-align:top;"></span>
            </li>
        `);
        btn.on('click', (e) => {
            e.preventDefault();
            Settings.enabled = !Settings.enabled;
            $('#ds-cache-enable').prop('checked', Settings.enabled);
            safeSave(); updateTopBarState();
            if (!Settings.zenMode && typeof toastr !== 'undefined') toastr.info(Settings.enabled ? "缓存优化已开启" : "缓存优化已关闭", "优化器");
        });
        btn.on('contextmenu', (e) => { e.preventDefault(); resetCurrentCache(); });
        if ($('ul#extensions_menu').length > 0) $('ul#extensions_menu').append(btn);
        else if ($('#right-nav-extensions').length > 0) $('#right-nav-extensions').append(btn);
    }
    updateTopBarState();
}

function ensureBottomLeftMenuButton() {
    const menu = $('#extensions_menu');
    if (menu.length > 0 && $('#ds-bottom-reset-btn').length === 0) {
        const btn = $(`
            <li id="ds-bottom-reset-btn" class="menu_button interactable" title="如果您觉得对话逻辑乱了，点击清空当前聊天的缓存让AI重新阅读">
                <span class="fa-solid fa-broom" style="color: #e06c75;"></span> 重置当前对话缓存
            </li>
        `);
        btn.on('click', () => { resetCurrentCache(); if (menu.hasClass('open')) menu.removeClass('open').hide(); });
        menu.append(btn);
    }
}
// 高頻心跳檢測：確保按鈕不會被 ST 主題或動態刷新吃掉
setInterval(ensureBottomLeftMenuButton, 1500);

function resetCurrentCache() {
    if(!confirm("确定要清空当前对话的缓存吗？\n(这会让AI重新阅读整个对话，适合在觉得AI逻辑混乱时使用)")) return;
    const key = getChatKey().key;
    delete Settings.chats[key];
    safeSave(); renderChatsUI();
    setTopBarStatus('#00ff00', '缓存: 已重置');
    if (typeof toastr !== 'undefined') toastr.success("当前聊天缓存已重置，下次发送将重新开始！");
    Logger.warn(`手动清空了当前对话: ${key}`);
}

function setupGlobalHotkeys() {
    document.addEventListener('keydown', (e) => {
        if (!Settings.hotkeysEnabled) return;
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
        
        if (e.ctrlKey && e.altKey) {
            if (e.key.toLowerCase() === 'c') {
                e.preventDefault(); Settings.enabled = !Settings.enabled; $('#ds-cache-enable').prop('checked', Settings.enabled);
                safeSave(); updateTopBarState();
                if (!Settings.zenMode && typeof toastr !== 'undefined') toastr.info(Settings.enabled ? "已开启" : "已关闭", "快捷键");
            }
            if (e.key.toLowerCase() === 'r') { e.preventDefault(); resetCurrentCache(); }
            if (e.key.toLowerCase() === 'z') { 
                e.preventDefault(); Settings.zenMode = !Settings.zenMode; $('#ds-cache-zen').prop('checked', Settings.zenMode);
                safeSave(); updateTopBarState(); 
                if(typeof toastr !== 'undefined') toastr.info(Settings.zenMode ? "免打扰已开启" : "免打扰已关闭", "快捷键");
            }
        }
    });
}

// ==========================================
// 5. 核心邏輯工具與陣列平坦化解析
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

// 重構：將 ST 陣列完美展平，直接反映最原始的歷史對話順序 (不再分割 prefill 破壞原意)
function parseSTStream(stream) {
    const sysMsgs = []; const chatMsgs = [];
    for (const msg of stream) {
        const isSys = (msg.role === 'system' || (msg.role !== 'user' && msg.role !== 'assistant'));
        if (isSys) sysMsgs.push(createMsg(msg, 'SYS'));
        else chatMsgs.push(createMsg(msg, msg.role === 'user' ? 'USER' : 'AI'));
    }

    let lastUserIdx = -1;
    for (let i = chatMsgs.length - 1; i >= 0; i--) { if (chatMsgs[i].tag === 'USER') { lastUserIdx = i; break; } }

    let historyTurns = []; let currentTurn = { user: null, prefills: [] };

    if (lastUserIdx === -1) {
        currentTurn.prefills = chatMsgs.filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'}));
    } else {
        const hMsgs = chatMsgs.slice(0, lastUserIdx);
        const cMsgs = chatMsgs.slice(lastUserIdx);
        currentTurn.user = cMsgs[0];
        currentTurn.prefills = cMsgs.slice(1).filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'}));

        let curUser = null; let curAiContents = [];
        for (const msg of hMsgs) {
            if (msg.tag === 'USER') {
                if (curUser) {
                    historyTurns.push(curUser);
                    if (curAiContents.length) historyTurns.push(createMsg({role: 'assistant', content: curAiContents.join('\n')}, 'AI'));
                }
                curUser = msg; curAiContents = [];
            } else if (msg.tag === 'AI') curAiContents.push(msg.content);
        }
        if (curUser) {
            historyTurns.push(curUser);
            if (curAiContents.length) historyTurns.push(createMsg({role: 'assistant', content: curAiContents.join('\n')}, 'AI'));
        }
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
                    <h2 class="ds-modal-title"><span class="fa-solid fa-triangle-exclamation"></span> DeepSeek 缓存命中率警告</h2>
                    <p class="ds-modal-text" style="line-height: 1.5;">
                        检测到您修改了较早的消息内容。<br>
                        由于大模型缓存机制，修改点<b>之后的所有内容</b>（约 <b style="color:${progColor}">${dropPercent}%</b> 的文本）都必须重新消耗算力计算。<br>
                        插件已在后台修复好顺序，您要如何处理本次发送？
                    </p>
                    <div class="ds-progress-container"><div class="ds-progress-bar" id="ds-prog-bar" style="background: ${progColor};"></div></div>
                    <div class="ds-map-box">${mapInfo}</div>
                    
                    <div class="ds-btn-grid">
                        <button class="ds-btn ds-btn-accept" id="ds-btn-accept"><i class="fa-solid fa-check"></i> 同步并发送 (推荐)</button>
                        <button class="ds-btn ds-btn-abort" id="ds-btn-abort"><i class="fa-solid fa-ban"></i> 拦截发送 (让我再改改)</button>
                        <button class="ds-btn ds-btn-bypass" id="ds-btn-bypass" title="关闭本次的优化，完全按ST原样发送"><i class="fa-solid fa-forward"></i> 临时放行 (按原样发送)</button>
                        <button class="ds-btn ds-btn-reset" id="ds-btn-reset" title="清空当前缓存，完全重新开始建立缓存库"><i class="fa-solid fa-trash"></i> 清空当前缓存重来</button>
                    </div>
                </div>
            </div>
        `;
        $('body').append(html);
        setTimeout(() => { $('#ds-prog-bar').css('width', `${Math.min(dropPercent, 100)}%`); }, 50);

        const cleanup = () => { $('#ds-modal-wrapper').remove(); document.removeEventListener('keydown', keyHandler, true); };
        
        $('#ds-btn-accept').click(() => { cleanup(); resolve('accept'); });
        $('#ds-btn-abort').click(() => { cleanup(); resolve('abort'); });
        $('#ds-btn-bypass').click(() => { cleanup(); resolve('bypass'); });
        $('#ds-btn-reset').click(() => { cleanup(); resolve('force_reset'); });

        const keyHandler = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cleanup(); resolve('abort'); }
        };
        document.addEventListener('keydown', keyHandler, true);
    });
}

// ==========================================
// 7. 終極修復版時序處理器 (In-Place Sync & Strict Order)
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (!Settings.enabled || data.dryRun) return;
    const startTime = performance.now();
    const chatKeyInfo = getChatKey();

    try {
        let state = getChatState(chatKeyInfo);
        if (!data?.chat?.length) return;
        const stream = data.chat;

        Logger.divider(`===== 启动发文拦截: ${chatKeyInfo.label} =====`);

        if (Settings.logLevel >= LogLevels.DEBUG) {
            Logger.debug(`[ST 原始生成] 总节点数: ${stream.length}`);
            stream.forEach((m, idx) => Logger.debug(`  [${idx}] ${m.role} (${m.content?.length || 0}字): ${truncateLog(m.content, 40)}`));
        }

        const { sysMsgs, historyTurns, currentTurn } = parseSTStream(stream);

        let rawFrozenSequence = [];
        const sysMsgsPool = [...sysMsgs];
        const remainingHistory = [...historyTurns];
        const thresholds = getTolerance();
        
        // 核心原位比對與同步邏輯
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
                    Logger.debug(`[原位保留] 提示词: ${truncateLog(item.content)}`);
                } else if (bestScore > thresholds.sys) {
                    const matchedItem = sysMsgsPool[bestIdx];
                    rawFrozenSequence.push(matchedItem); 
                    sysMsgsPool.splice(bestIdx, 1);
                    Logger.debug(`[原位更新] 提示词 (相似度 ${(bestScore*100).toFixed(1)}%): -> ${truncateLog(matchedItem.content, 20)}`);
                } else {
                    Logger.debug(`[原位删除] 提示词已被移除: ${truncateLog(item.content)}`);
                }
            } 
            else if (item.tag === 'USER' || item.tag === 'AI' || item.tag === 'PREFILL') {
                let bestIdx = -1, bestScore = 0;
                for (let j = 0; j < remainingHistory.length; j++) {
                    const hist = remainingHistory[j];
                    if (item.tag === 'USER' && hist.tag !== 'USER') continue;
                    if ((item.tag === 'AI' || item.tag === 'PREFILL') && hist.tag !== 'AI') continue;

                    let score = 0;
                    if (item.tag === 'PREFILL' && hist.content.startsWith(item.content)) {
                        score = 1; // 完美匹配：舊的預填充變成了現在完整的 AI 回覆
                    } else if (item.tag === 'PREFILL') {
                        score = getSimilarity(item.norm, hist.norm);
                    } else {
                        score = getSimilarity(item.norm, hist.norm);
                    }

                    if (score > bestScore) { bestScore = score; bestIdx = j; }
                }

                if (bestScore === 1 || bestScore > thresholds.his) {
                    const matchedHist = remainingHistory[bestIdx];
                    rawFrozenSequence.push(matchedHist); // 原位繼承為 AI tag，完美過渡
                    remainingHistory.splice(bestIdx, 1);
                    Logger.debug(`[原位保留] 历史 ${item.tag}: ${truncateLog(matchedHist.content)}`);
                } else {
                    Logger.debug(`[原位删除] 历史已被移除: ${truncateLog(item.content)}`);
                }
            }
        }

        // 嚴格排序邏輯：1. 舊凍結 -> 2. 新增的歷史對話 (含上一輪的AI回覆) -> 3. 新增的提示詞/世界書 -> 4. 當前用戶輸入 -> 5. 當前預填充
        for (let h of remainingHistory) {
            rawFrozenSequence.push(h);
            Logger.debug(`[追加] 新历史节点: ${truncateLog(h.content)}`);
        }
        for (let sys of sysMsgsPool) {
            rawFrozenSequence.push(sys);
            Logger.debug(`[追加] 新提示词/世界书: ${truncateLog(sys.content)}`);
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

        if (Settings.logLevel >= LogLevels.DEBUG) {
            Logger.debug(`[准备发送] 严格排序后总节点数: ${proposedStream.length}`);
            proposedStream.forEach((m, idx) => Logger.debug(`  [${idx}] ${m.role} (${m.content?.length || 0}字): ${truncateLog(m.content, 40)}`));
        }

        // ==========================================
        // 精準前綴快取流失率算式
        // ==========================================
        let requireResetConfirm = false;
        let dropPercentStr = "0.0";
        let mapInfoText = "无变更";

        if (state.lastSentSequence && state.lastSentSequence.length > 0) {
            const L = state.lastSentSequence;
            const P = proposedStream;

            let breakIndex = -1;
            for (let i = 0; i < Math.min(L.length, P.length); i++) {
                if (L[i].role !== P[i].role || L[i].norm !== P[i].norm) { breakIndex = i; break; }
            }
            if (breakIndex === -1) breakIndex = Math.min(L.length, P.length);

            let isPureContextShift = false;
            if (breakIndex > 0 && breakIndex < L.length && breakIndex < P.length) {
                let isAtHistoryStart = true;
                for (let i = 0; i < breakIndex; i++) {
                    if (L[i].tag !== 'SYS' && L[i].role !== 'system') { isAtHistoryStart = false; break; }
                }
                if (isAtHistoryStart) {
                    for (let x = breakIndex + 1; x < L.length; x++) {
                        if (L[x].role === P[breakIndex].role && L[x].norm === P[breakIndex].norm) {
                            let deletedBlocks = L.slice(breakIndex, x);
                            if (!deletedBlocks.some(m => m.tag === 'SYS' || m.role === 'system')) isPureContextShift = true;
                            break;
                        }
                    }
                }
            }

            let preservedLen = 0; let recomputeLen = 0;
            for (let i = 0; i < P.length; i++) {
                let len = P[i].content?.length || 0;
                if (i < breakIndex) preservedLen += len; else recomputeLen += len;
            }

            let totalLen = preservedLen + recomputeLen;
            let recomputeRatio = totalLen === 0 ? 0 : (recomputeLen / totalLen);
            
            if (isPureContextShift) { 
                recomputeRatio = 0; 
                Logger.log(`[自然推移] 旧历史被顶出，不视为破坏缓存。`, LogLevels.DETAILED); 
            }

            if (recomputeRatio > 0.10 && Settings.showResetPrompt) {
                requireResetConfirm = true;
                dropPercentStr = (recomputeRatio * 100).toFixed(1);
                
                const tagHtml = `<span class="ds-tag ds-tag-${P[breakIndex]?.tag}">[${P[breakIndex]?.tag}]</span>`;
                const oldContent = escapeHtml(L[breakIndex]?.content || '∅').substring(0, 100).replace(/\n/g, ' ↵ ');
                const newContent = escapeHtml(P[breakIndex]?.content || '∅').substring(0, 100).replace(/\n/g, ' ↵ ');
                
                mapInfoText = `
                    <div style="margin-bottom:8px; display:flex; align-items:center; gap:8px;">
                        <span style="color:#56b6c2;"><i class="fa-solid fa-location-crosshairs"></i> 缓存断裂点索引:</span> <b>[${breakIndex}]</b> ${tagHtml}
                    </div>
                    <div class="ds-diff-del"><i class="fa-solid fa-minus"></i> 原内容: ${oldContent}...</div>
                    <div class="ds-diff-add"><i class="fa-solid fa-plus"></i> 新内容: ${newContent}...</div>
                    <div style="margin-top:8px; font-size: 11px; color:#98c379;">
                        ✅ 断点前已保留: ${preservedLen} 字符 <br>
                        ⚠️ 断点后需重算: ${recomputeLen} 字符
                    </div>
                `;
            }
        }

        let decision = 'accept';
        setTopBarStatus('#00ff00', '缓存: 健康');

        if (requireResetConfirm) {
            setTopBarStatus('#ffaa00', `缓存: 等待确认`);
            if (Settings.autoAccept) {
                Logger.warn(`[自动修复] 已放行断层重组 (需重算 ${dropPercentStr}%)`);
                if (!Settings.zenMode && typeof toastr !== 'undefined') toastr.info(`已自动修复后台顺序 (需重算 ${dropPercentStr}%)`, "优化器");
                decision = 'accept';
            } else {
                decision = await askUserForResetAsync(dropPercentStr, mapInfoText);
            }
        }

        if (decision === 'abort') {
            Logger.error('[拦截] 已拦截本次发送，您可以退回去修改。', null, LogLevels.BASIC);
            setTopBarStatus('#e06c75', '缓存: 已拦截发送');
            if (typeof toastr !== 'undefined') toastr.error("已拦截发送！请复原您刚才的修改。", "优化器");
            stream.splice(0, stream.length); 
            return;
        }

        if (decision === 'bypass') {
            Logger.warn('[临时放行] 用户选择跳过本次优化，按 ST 原样发送。');
            setTopBarStatus('#e5c07b', '缓存: 临时放行');
            return; 
        }

        if (decision === 'force_reset') {
            Logger.error('[清空重来] 用户选择清空当前缓存，一切重新开始。');
            delete Settings.chats[chatKeyInfo.key];
            safeSave();
            setTopBarStatus('#00ff00', '缓存: 已重置并发送');
            return; 
        }

        if (decision === 'accept') {
            state.frozenSequence = proposedStream;
            state.lastSentSequence = proposedStream;
            safeSave();

            if (Settings.autoPinThreshold > 0 && proposedStream.length >= Settings.autoPinThreshold) {
                if (!Settings.pinnedChats[chatKeyInfo.key]) {
                    Settings.pinnedChats[chatKeyInfo.key] = true;
                    safeSave();
                    Logger.map(`[自动保护] 节点数(${proposedStream.length})达标，已锁定当前存档。`);
                }
            }

            stream.splice(0, stream.length, ...proposedStream.map(i => ({ role: i.role, content: i.content })));
            Logger.log(`✅ 排序完成，授权发送。耗时: ${(performance.now() - startTime).toFixed(2)}ms`, LogLevels.BASIC);
        }

    } catch (err) {
        setTopBarStatus('#e06c75', '缓存: 发生崩溃');
        Logger.error('核心运算崩溃', err);
        throw err;
    }
}

// ==========================================
// 8. UI 面板與高階事件綁定
// ==========================================
function renderChatsUI() {
    const container = $('#ds-chat-list-container');
    if (container.length === 0) return;
    container.empty();
    
    $('#ds-storage-badge').text(calculateExactStorage(Settings.chats));

    const keys = Object.keys(Settings.chats);
    if (keys.length === 0) {
        container.append('<div style="font-size:0.85em; opacity:0.5; padding:10px; text-align:center;">暂无任何缓存存档</div>');
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
            if (diff < 1) timeStr = "刚刚";
            else if (diff < 60) timeStr = `${diff} 分钟前`;
            else if (diff < 1440) timeStr = `${Math.floor(diff/60)} 小时前`;
            else timeStr = `${Math.floor(diff/1440)} 天前`;
        }

        const pinColor = isPinned ? '#e5c07b' : 'rgba(255,255,255,0.3)';
        const html = `
            <div class="ds-chat-item ${isActive ? 'active-chat' : ''}" title="${isActive ? '这是您当前的对话' : ''}">
                <div style="display:flex; flex-direction:column; overflow:hidden; width:70%;">
                    <span style="font-size:0.85em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:${isActive?'#00e5ff':''};">${isActive ? '🟢 ' : ''}${escapeHtml(chat.label)}</span>
                    <div style="display:flex; gap:10px; font-size:0.7em;">
                        <span style="color:#98c379;">节点: ${count}</span>
                        <span style="color:#5c6370;"><i class="fa-regular fa-clock"></i> ${timeStr}</span>
                    </div>
                </div>
                <div class="ds-action-group">
                    <button class="menu_button interactable ds-pin-btn" data-key="${key}" style="font-size:0.8em; padding:4px 8px; border-radius:4px; color:${pinColor};" title="${isPinned ? '取消保护' : '锁定保护(免被清理)'}">
                        <span class="fa-solid fa-thumbtack"></span>
                    </button>
                    <button class="menu_button interactable ds-reset-btn" data-key="${key}" style="font-size:0.8em; padding:4px 8px; border-radius:4px; color:#e06c75;" title="删除此存档">
                        <span class="fa-solid fa-trash"></span>
                    </button>
                </div>
            </div>
        `;
        container.append(html);
    });

    container.find('.ds-reset-btn').on('click', function() {
        const key = $(this).data('key'); delete Settings.chats[key]; delete Settings.pinnedChats[key];
        safeSave(); renderChatsUI();
    });
    container.find('.ds-pin-btn').on('click', function() {
        const key = $(this).data('key');
        if (Settings.pinnedChats[key]) delete Settings.pinnedChats[key]; else Settings.pinnedChats[key] = true;
        safeSave(); renderChatsUI();
    });
}

async function setupUI() {
    try {
        injectCSS();
        const html = `
        <div class="inline-drawer" id="ds-v24-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><span class="fa-solid fa-microchip"></span> DeepSeek 缓存优化器</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:15px; background: rgba(0,0,0,0.1);">
                
                <!-- 基础设置 -->
                <div class="ds-opt-group open">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-sliders"></i> 基础设置 (必看)</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div class="ds-row">
                            <label class="ds-row-left" style="color:#00e5ff; font-weight:bold;"><input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}> ✅ 开启缓存优化 (核心功能)</label>
                        </div>
                        <div class="ds-row"><label class="ds-row-left" style="color:#c678dd;"><input type="checkbox" id="ds-cache-zen" ${Settings.zenMode ? 'checked' : ''}> 🧘 免打扰模式 (隐藏所有屏幕右上角的黑色提示框)</label></div>
                        <div class="ds-row"><label class="ds-row-left" style="color:#e5c07b;"><input type="checkbox" id="ds-cache-auto-accept" ${Settings.autoAccept ? 'checked' : ''}> ⚡ 自动修复缓存断层 (遇到冲突时，不弹窗询问直接后台修复并发送)</label></div>
                        <div class="ds-row"><label class="ds-row-left" style="color:#98c379;"><input type="checkbox" id="ds-cache-hotkeys" ${Settings.hotkeysEnabled ? 'checked' : ''}> ⌨️ 启用快捷键 (Ctrl+Alt+C 开关优化 / R 重置 / Z 免打扰)</label></div>
                    </div>
                </div>

                <!-- 提醒设置 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-satellite-dish"></i> 提醒设置</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div class="ds-row"><label class="ds-row-left" title="修改早期的对话会让大模型缓存失效"><input type="checkbox" id="ds-toast-his" ${Settings.toastHistory ? 'checked' : ''}> 💬 当我修改或删除【历史聊天记录】时提醒我</label></div>
                        <hr style="border:0; border-top:1px dashed rgba(255,255,255,0.1); width:100%; margin:2px 0;">
                        <div class="ds-row"><label class="ds-row-left" style="color:#e06c75;"><input type="checkbox" id="ds-toast-reset" ${Settings.showResetPrompt ? 'checked' : ''}> 🛑 当发送可能导致【大量缓存失效 (超过10%)】时，弹出确认警告窗口</label></div>
                    </div>
                </div>
                
                <!-- 高级参数 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-gears"></i> 高级参数 (小白无须修改)</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div class="ds-row">
                            <span style="font-size:0.85em; color:#abb2bf;" title="对比旧文本与新文本的严格程度">匹配严格度:</span>
                            <select id="ds-cache-tolerance" class="text_pole" style="width:110px; padding:2px;">
                                <option value="0" ${Settings.tolerance===0?'selected':''}>严格 (推荐)</option>
                                <option value="1" ${Settings.tolerance===1?'selected':''}>标准</option>
                                <option value="2" ${Settings.tolerance===2?'selected':''}>宽松</option>
                            </select>
                        </div>
                        <div class="ds-row">
                            <span style="font-size:0.85em; color:#abb2bf;">日志详细度:</span>
                            <select id="ds-cache-loglevel" class="text_pole" style="width:110px; padding:2px;">
                                <option value="0" ${Settings.logLevel===0?'selected':''}>0: 关闭</option>
                                <option value="1" ${Settings.logLevel===1?'selected':''}>1: 基础</option>
                                <option value="2" ${Settings.logLevel===2?'selected':''}>2: 详细</option>
                                <option value="3" ${Settings.logLevel===3?'selected':''}>3: 极客模式</option>
                            </select>
                        </div>
                        <div class="ds-row">
                            <span style="font-size:0.85em; color:#abb2bf;">历史存档保留上限:</span>
                            <input type="number" id="ds-cache-maxsize" class="text_pole" value="${Settings.maxCacheSize}" min="5" max="100" style="width:110px; text-align:center; padding:2px;">
                        </div>
                        <div class="ds-row">
                            <span style="font-size:0.85em; color:#abb2bf;">📌 对话回合达标保护:</span>
                            <input type="number" id="ds-cache-autopin" class="text_pole" value="${Settings.autoPinThreshold}" min="0" max="999" title="当某个对话的节点数超过此数字，将自动钉选保护它免被系统清理。填0关闭。" style="width:110px; text-align:center; padding:2px;">
                        </div>
                        <div class="ds-row" style="margin-top:5px;">
                            <button id="ds-btn-export" class="menu_button interactable" style="flex:1; padding:4px; font-size:0.8em;"><i class="fa-solid fa-download"></i> 备份</button>
                            <button id="ds-btn-import" class="menu_button interactable" style="flex:1; padding:4px; font-size:0.8em;"><i class="fa-solid fa-upload"></i> 恢复</button>
                            <input type="file" id="ds-file-import" style="display:none;" accept=".json">
                        </div>
                    </div>
                </div>

                <!-- 缓存存档管理 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-database"></i> 缓存存档库管理 <span id="ds-storage-badge" class="ds-badge">...</span></span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div id="ds-chat-list-container" class="ds-chat-container"></div>
                        <div class="ds-row">
                            <button id="ds-btn-deep-clean" class="menu_button" style="flex:1; font-size:0.85em; color:#e5c07b; border:1px solid #e5c07b; background:none;" title="清理所有没被锁定，且超过30天没玩过的旧存档">🧹 深度清理无效存档</button>
                            <button id="ds-cache-factory-reset" class="menu_button" style="flex:1; font-size:0.85em; color:#e06c75; border:1px solid #e06c75; background:none;" title="删掉所有记录，一切重来">💀 格式化</button>
                        </div>
                    </div>
                </div>
                
                <!-- 终端机 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-terminal"></i> 运行日志终端</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content" style="padding:5px;">
                        <div class="ds-log-toolbar">
                            <span class="ds-log-filter active" data-filter="all">全部</span>
                            <span class="ds-log-filter" data-filter="info">常规</span>
                            <span class="ds-log-filter" data-filter="warn">警告</span>
                            <span class="ds-log-filter" data-filter="debug">除错</span>
                            <span class="ds-log-filter" data-filter="error">报错</span>
                            <div style="flex:1;"></div>
                            <span id="ds-btn-clearlog" class="ds-mini-btn" title="清空日志文字" style="color:#e06c75;"><span class="fa-solid fa-trash"></span></span>
                        </div>
                        <div id="ds-cache-log-container" class="ds-log-terminal"></div>
                    </div>
                </div>
            </div>
        </div>`;
        
        $('#extensions_settings').append(html);

        // UI 事件綁定
        $('#ds-cache-enable').on('change', function () { Settings.enabled = $(this).is(':checked'); safeSave(); updateTopBarState(); });
        $('#ds-cache-zen').on('change', function () { Settings.zenMode = $(this).is(':checked'); safeSave(); updateTopBarState(); });
        $('#ds-toast-his').on('change', function () { Settings.toastHistory = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-reset').on('change', function () { Settings.showResetPrompt = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-auto-accept').on('change', function () { Settings.autoAccept = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-hotkeys').on('change', function () { Settings.hotkeysEnabled = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-tolerance').on('change', function () { Settings.tolerance = parseInt($(this).val()); safeSave(); });
        $('#ds-cache-loglevel').on('change', function () { Settings.logLevel = parseInt($(this).val()); safeSave(); });
        $('#ds-cache-maxsize').on('change', function () { Settings.maxCacheSize = parseInt($(this).val()) || 30; safeSave(); performGarbageCollection(); });
        $('#ds-cache-autopin').on('change', function () { Settings.autoPinThreshold = parseInt($(this).val()) || 0; safeSave(); });

        $('#ds-cache-factory-reset').on('click', () => { if (confirm("危险操作：确定要删除所有的缓存存档吗？")) { Settings.chats = {}; Settings.pinnedChats = {}; safeSave(); renderChatsUI(); } });
        
        $('#ds-btn-deep-clean').on('click', () => {
            if(!confirm("这会删掉所有未被锁定，且【没有节点内容】或【超过30天没聊过】的旧缓存。确定执行吗？")) return;
            let count = 0; const now = Date.now();
            for (let k in Settings.chats) {
                if (Settings.pinnedChats[k]) continue;
                const chat = Settings.chats[k];
                const isEmpty = !chat.frozenSequence || chat.frozenSequence.length === 0;
                const isOld = chat.lastAccessed && (now - chat.lastAccessed > 30 * 24 * 60 * 60 * 1000);
                if (isEmpty || isOld) { delete Settings.chats[k]; count++; }
            }
            safeSave(); renderChatsUI();
            if (typeof toastr !== 'undefined') toastr.success(`共移除了 ${count} 个无用的旧存档。`);
        });
        
        $('.ds-log-filter').on('click', function() {
            $('.ds-log-filter').removeClass('active'); $(this).addClass('active'); const f = $(this).data('filter');
            $('#ds-cache-log-container .ds-log-line').each(function() {
                if (f === 'all' || $(this).data('type') === f || $(this).data('type') === 'divider') $(this).removeClass('hide'); else $(this).addClass('hide');
            });
        });
        
        $('#ds-btn-clearlog').on('click', () => { $('#ds-cache-log-container').empty(); });

        $('#ds-btn-export').on('click', () => {
            const blob = new Blob([JSON.stringify(Settings, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob); const a = document.createElement("a");
            a.href = url; a.download = `DeepSeek_Cache_Backup_v24_${new Date().getTime()}.json`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
            if (typeof toastr !== 'undefined') toastr.success("备份文件已导出！");
        });
        $('#ds-btn-import').on('click', () => $('#ds-file-import').click());
        $('#ds-file-import').on('change', function(e) {
            const f = e.target.files[0]; if(!f) return;
            const r = new FileReader();
            r.onload = (ev) => {
                try { Object.assign(Settings, JSON.parse(ev.target.result)); safeSave(); renderChatsUI(); updateTopBarState(); alert("恢复成功！"); } 
                catch (err) { alert("文件格式错误"); }
                e.target.value = '';
            };
            r.readAsText(f);
        });

        renderChatsUI();
    } catch (e) { console.error('[DS Cache] UI初始化崩潰', e); }
}

jQuery(async () => {
    try {
        initSettings(); 
        await setupUI();
        setupGlobalHotkeys(); 
        
        setTimeout(() => { ensureTopMenuButton(); ensureBottomLeftMenuButton(); }, 2000);
        
        if (eventSource) {
            eventSource.on(event_types.CHAT_CHANGED, () => { ensureTopMenuButton(); ensureBottomLeftMenuButton(); renderChatsUI(); });
            if (event_types?.CHAT_COMPLETION_PROMPT_READY) eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
            if (event_types?.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, () => triggerWarningImmediate('his_del', '您删除了历史对话，已标记断层！下次发送将原位修补。', Settings.toastHistory));
            if (event_types?.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, () => triggerWarningImmediate('his_edit', '您修改了历史对话，已标记断层！下次发送将原位修补。', Settings.toastHistory));
        }

        Logger.log('══════ DeepSeek 缓存优化器 引擎上线 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件启动失败:', e);
    }
});
