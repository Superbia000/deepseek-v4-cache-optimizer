import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 1. 樣式注入 (水平排版與摺疊模組化)
// ==========================================
const injectCSS = () => {
    if (document.getElementById('ds-cache-styles')) return;
    const style = document.createElement('style');
    style.id = 'ds-cache-styles';
    style.innerHTML = `
        /* 模組化摺疊面板 */
        .ds-opt-group { margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; background: rgba(0,0,0,0.15); overflow: hidden; }
        .ds-opt-header { padding: 10px 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #56b6c2; background: rgba(255,255,255,0.05); transition: 0.2s; }
        .ds-opt-header:hover { background: rgba(255,255,255,0.1); }
        .ds-opt-content { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; display: none; }
        .ds-opt-group.open .ds-opt-content { display: flex; animation: dsFadeIn 0.2s ease-out; }
        .ds-opt-group.open .ds-opt-header i.fa-chevron-down { transform: rotate(180deg); }

        /* 水平強制排版 */
        .ds-row { display: flex; flex-direction: row; justify-content: space-between; align-items: center; width: 100%; gap: 10px; }
        .ds-row-left { display: flex; flex-direction: row; justify-content: flex-start; align-items: center; gap: 8px; cursor: pointer; color: #abb2bf; font-size: 0.9em; white-space: nowrap; }
        .ds-row-left input[type="checkbox"] { margin: 0; }
        
        /* 終端機日誌與濾波器 */
        .ds-log-toolbar { display: flex; gap: 5px; margin-bottom: 5px; }
        .ds-log-filter { cursor: pointer; padding: 2px 8px; border-radius: 12px; font-size: 10px; background: rgba(255,255,255,0.1); color: #abb2bf; transition: 0.2s; }
        .ds-log-filter.active { background: #56b6c2; color: #121212; font-weight: bold; }
        .ds-log-filter:hover:not(.active) { background: rgba(255,255,255,0.2); }
        .ds-log-terminal { background: var(--black50a, #0d0d0d); color: var(--SmartThemeBody-color, #a9b7c6); font-family: Consolas, monospace; font-size: 11px; height: 220px; overflow-y: auto; border-radius: 6px; padding: 8px; border: 1px solid var(--SmartThemeBorder-color, #333); box-shadow: inset 0 0 10px rgba(0,0,0,0.5); scroll-behavior: smooth; }
        .ds-log-line { margin-bottom: 3px; line-height: 1.4; word-wrap: break-word; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 2px; }
        .ds-log-line.hide { display: none; }
        .ds-log-time { color: #5c6370; margin-right: 5px; }
        .ds-log-info { color: #98c379; }
        .ds-log-warn { color: #e5c07b; font-weight: bold; }
        .ds-log-error { color: #e06c75; font-weight: bold; }
        .ds-log-map { color: #56b6c2; }
        .ds-log-debug { color: #c678dd; }
        
        /* 標籤與快取列表 */
        .ds-tag { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; background: rgba(255,255,255,0.05); }
        .ds-tag-SYS { color: #61afef; border-left: 2px solid #61afef; }
        .ds-tag-USER { color: #98c379; border-left: 2px solid #98c379; }
        .ds-tag-AI { color: #e5c07b; border-left: 2px solid #e5c07b; }
        .ds-tag-PREFILL { color: #c678dd; border-left: 2px solid #c678dd; }

        .ds-chat-container { max-height:220px; overflow-y:auto; border:1px solid rgba(255,255,255,0.1); padding:5px; border-radius:6px; background:var(--black50a, #121212); }
        .ds-chat-item { display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:8px; margin-bottom:6px; border-radius:6px; border:1px solid rgba(255,255,255,0.05); transition: 0.2s; }
        .ds-chat-item:hover { background:rgba(255,255,255,0.08); }
        .ds-chat-item.active-chat { background:rgba(0, 229, 255, 0.08); border:1px solid #00e5ff; box-shadow: inset 0 0 10px rgba(0,229,255,0.15); }
        .ds-action-group { display: flex; gap: 5px; }
        
        /* 攔截器彈窗 & 差異顯示 */
        .ds-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); z-index: 999999; display: flex; align-items: center; justify-content: center; animation: dsFadeIn 0.2s ease-out; }
        .ds-modal { background: var(--SmartThemeBlurTintColor, #1e1e24); border: 1px solid #e06c75; padding: 30px; border-radius: 12px; max-width: 650px; width: 90%; color: var(--SmartThemeBody-color, #fff); font-family: sans-serif; box-shadow: 0 25px 50px rgba(0,0,0,0.9); position: relative; overflow: hidden; animation: dsSlideUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .ds-modal-title { color: #e06c75; margin: 0 0 15px 0; display: flex; align-items: center; gap: 10px; font-size: 20px; }
        .ds-progress-container { background: rgba(0,0,0,0.5); border-radius: 6px; height: 10px; margin: 15px 0; overflow: hidden; box-shadow: inset 0 2px 4px rgba(0,0,0,0.5); }
        .ds-progress-bar { height: 100%; width: 0%; transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1), background 0.3s; }
        
        .ds-map-box { background: rgba(0,0,0,0.4); padding: 12px; border-radius: 8px; font-family: Consolas, monospace; font-size: 12px; color: #abb2bf; margin: 15px 0; border: 1px solid rgba(255,255,255,0.1); max-height: 250px; overflow-y: auto; }
        .ds-diff-del { background: rgba(224, 108, 117, 0.15); border-left: 3px solid #e06c75; padding: 6px 10px; margin-bottom: 4px; border-radius: 0 4px 4px 0; color: #e06c75; word-wrap: break-word; }
        .ds-diff-add { background: rgba(152, 195, 121, 0.15); border-left: 3px solid #98c379; padding: 6px 10px; border-radius: 0 4px 4px 0; color: #98c379; word-wrap: break-word; }
        
        .ds-btn-group { display: flex; gap: 12px; margin-top: 25px; }
        .ds-btn { flex: 1; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 14px; display: flex; flex-direction: column; align-items: center; gap: 4px; transition: all 0.2s; position: relative; overflow: hidden; }
        .ds-btn:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0,0,0,0.4); filter: brightness(1.15); }
        .ds-btn:active { transform: translateY(0); }
        .ds-btn-accept { background: #98c379; color: #121212; }
        .ds-btn-abort { background: #e06c75; color: #fff; }
        
        .ds-timeline-container { max-height: 450px; overflow-y: auto; padding-right: 5px; }
        .ds-timeline-item { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; transition: 0.2s; border-radius: 6px; padding: 5px; }
        .ds-timeline-item:hover { background: rgba(255,255,255,0.05); }
        .ds-timeline-content-wrapper { flex: 1; display: flex; flex-direction: column; }
        .ds-timeline-preview { color: #abb2bf; font-size: 12px; line-height: 1.4; word-wrap: break-word; }
        .ds-timeline-full { display: none; margin-top: 8px; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 6px; color: #d7dae0; font-size: 11px; white-space: pre-wrap; border-left: 2px solid #56b6c2; }
        .ds-timeline-item.expanded .ds-timeline-full { display: block; animation: dsFadeIn 0.2s ease-out; }
        .ds-timeline-index { width: 30px; text-align: right; color: #5c6370; font-size: 10px; padding-top: 3px; font-family: monospace; }

        .ds-badge { background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-size: 0.8em; font-family: monospace; color: #56b6c2; }
        .ds-zen-icon { color: #c678dd; animation: dsPulse 2s infinite; }
        
        @keyframes dsFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes dsSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes dsPulse { 0% { opacity: 0.6; } 50% { opacity: 1; text-shadow: 0 0 5px #c678dd; } 100% { opacity: 0.6; } }
    `;
    document.head.appendChild(style);
};

// ==========================================
// 2. 狀態設定與「30秒精準冷卻」通知引擎
// ==========================================
let Settings = {};

function initSettings() {
    const oldSettings = extension_settings.ds_cache_v21 || extension_settings.ds_cache_v20 || {};
    if (!extension_settings.ds_cache_v22) {
        extension_settings.ds_cache_v22 = {
            enabled: oldSettings.enabled ?? true,
            zenMode: oldSettings.zenMode ?? false,
            toastSys: oldSettings.toastSys ?? true,
            toastSysToggle: oldSettings.toastSysToggle ?? true,
            toastLore: oldSettings.toastLore ?? true,
            toastGlobalLore: oldSettings.toastGlobalLore ?? true,
            toastHistory: oldSettings.toastHistory ?? true,
            showResetPrompt: oldSettings.showResetPrompt ?? true,
            autoAccept: oldSettings.autoAccept ?? false,
            logLevel: oldSettings.logLevel ?? 2, // 預設為 DETAILED (2)
            tolerance: oldSettings.tolerance ?? 1,
            maxCacheSize: oldSettings.maxCacheSize ?? 30,
            hotkeysEnabled: oldSettings.hotkeysEnabled ?? true,
            autoPinThreshold: oldSettings.autoPinThreshold ?? 0,
            chats: oldSettings.chats || {},
            pinnedChats: oldSettings.pinnedChats || {} 
        };
    }
    Settings = extension_settings.ds_cache_v22;
    if (!Settings.pinnedChats) Settings.pinnedChats = {};
    if (!Settings.chats) Settings.chats = {}; 
}

function safeSave() {
    try { 
        if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced(); 
        if (Math.random() < 0.1) localStorage.setItem('ds_cache_v22_snapshot', JSON.stringify(Settings));
    } 
    catch (e) { console.warn("[DS Cache] 存檔或快照失敗", e); }
}

function getTolerance() {
    if (Settings.tolerance === 0) return { sys: 0.5, his: 0.6 }; 
    if (Settings.tolerance === 1) return { sys: 0.2, his: 0.3 }; 
    return { sys: 0.05, his: 0.1 }; 
}

// 核心修正：30 秒絕對冷卻引擎，真正做到「當時當刻」且不洗頻
const notificationCooldowns = {};
function triggerWarningImmediate(key, msg, enabled) {
    if (!Settings.enabled || !enabled) return;
    const now = Date.now();
    // 設定 30,000 毫秒 (30秒) 的冷卻時間
    if (!notificationCooldowns[key] || now - notificationCooldowns[key] > 30000) {
        notificationCooldowns[key] = now; 
        if (Settings.zenMode) {
            Logger.log(`[禪模式靜默攔截] ${msg}`, LogLevels.BASIC);
        } else {
            if (typeof toastr !== 'undefined') toastr.warning(msg, '⚙️ DeepSeek 缓存', { timeOut: 3000 });
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
    Logger.warn(`[GC回收] 已清理 ${toRemove.length} 個休眠存檔。`);
    renderChatsUI();
}

// ==========================================
// 3. 日誌系統 (4 級透視)
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function updateTopBarState() {
    const dot = $('#ds-top-status-dot');
    if (!dot.length) return;
    if (!Settings.enabled) {
        dot.css('color', '#5c6370');
        $('#ds-top-reset-btn').attr('title', 'DeepSeek 优化缓存命中: 已停用');
        dot.html('<i class="fa-solid fa-circle"></i>');
    } else if (Settings.zenMode) {
        dot.css('color', '#c678dd');
        $('#ds-top-reset-btn').attr('title', 'DeepSeek 优化缓存命中: 運作中 [禪模式]');
        dot.html('<i class="fa-solid fa-yin-yang ds-zen-icon"></i>');
    } else {
        dot.css('color', '#00ff00');
        $('#ds-top-reset-btn').attr('title', 'DeepSeek 优化缓存命中: 運作中');
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
        $('#ds-top-reset-btn').attr('title', title + ' (左鍵切換 / 右鍵清空)');
    }
}

function logAt(level, type, msg) {
    if (Settings.logLevel < level) return;
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
    
    // 輸出到 Console
    if (type === 'warn') console.warn(`%c[DS v22] 🌪️ ${msg}`, 'color: #ffaa00;');
    else if (type === 'error') console.error(`[DS v22] 🔴 ${msg}`);
    else if (type === 'map') console.log(`%c[DS v22] 🗺️ ${msg}`, 'color: #00e5ff;');
    else if (type === 'debug') console.log(`%c[DS v22] 🐛 ${msg}`, 'color: #c678dd;');
    else console.log(`%c[DS v22] ✅ ${msg}`, 'color: #00ff00;');
    
    // 輸出到 UI 終端機
    const container = document.getElementById('ds-cache-log-container');
    if (container) {
        const line = document.createElement('div');
        line.className = 'ds-log-line';
        line.setAttribute('data-type', type);
        line.innerHTML = `<span class="ds-log-time">[${time}]</span> <span class="ds-log-${type}">${msg.replace(/\n/g, '<br>')}</span>`;
        container.appendChild(line);
        
        const activeFilter = $('.ds-log-filter.active').data('filter') || 'all';
        if (activeFilter !== 'all' && activeFilter !== type) line.classList.add('hide');

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
    normalize: (text) => (text || '').replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
};

// ==========================================
// 4. 狀態管理與動態選單注入
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

function ensureTopMenuButton() {
    if ($('#ds-top-reset-btn').length === 0) {
        const btn = $(`
            <li id="ds-top-reset-btn" class="menu_button interactable" title="DeepSeek 优化缓存命中">
                <span class="fa-solid fa-microchip"></span>
                <span id="ds-top-status-dot" style="font-size:0.7em; margin-left:2px; vertical-align:top;"></span>
            </li>
        `);
        btn.on('click', (e) => {
            e.preventDefault();
            Settings.enabled = !Settings.enabled;
            $('#ds-cache-enable').prop('checked', Settings.enabled);
            safeSave(); updateTopBarState();
            if (!Settings.zenMode && typeof toastr !== 'undefined') toastr.info(Settings.enabled ? "優化引擎已啟動" : "優化引擎已關閉", "DeepSeek 缓存");
        });
        btn.on('contextmenu', (e) => { e.preventDefault(); resetCurrentCache(); });
        if ($('ul#extensions_menu').length > 0) $('ul#extensions_menu').append(btn);
        else if ($('#right-nav-extensions').length > 0) $('#right-nav-extensions').append(btn);
    }
    updateTopBarState();
}

// 核心修正：動態注入左下角選單，不再依賴固定綁定
function ensureBottomLeftMenuButton() {
    const menu = $('#extensions_menu');
    if (menu.length > 0 && $('#ds-bottom-reset-btn').length === 0) {
        menu.append(`
            <li id="ds-bottom-reset-btn" class="menu_button interactable" title="清空當前聊天的 DeepSeek 快取池">
                <span class="fa-solid fa-microchip"></span> 重置 DeepSeek 缓存
            </li>
        `);
    }
}

// 全域代理 Click：不怕被 ST 刪除重建
$(document).on('click', '#ds-bottom-reset-btn', function() {
    resetCurrentCache();
    $('#extensions_menu').removeClass('open').hide();
});

// 當滑鼠靠近擴充按鈕區，瞬間檢查並補齊按鈕
$(document).on('mouseenter click', '#rm_button_panel_extension, #extensions_menu', function() {
    ensureBottomLeftMenuButton();
});

function resetCurrentCache() {
    if(!confirm("確定要完全清空當前聊天的緩存狀態嗎？(回到 ST 預設頂部排序)")) return;
    const key = getChatKey().key;
    delete Settings.chats[key];
    safeSave(); renderChatsUI();
    setTopBarStatus('#00ff00', 'DS Cache: 已清空');
    if (typeof toastr !== 'undefined') toastr.success("當前聊天快取已重置！");
    Logger.warn(`手動清空了存檔: ${key}`);
}

function setupGlobalHotkeys() {
    document.addEventListener('keydown', (e) => {
        if (!Settings.hotkeysEnabled) return;
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
        
        if (e.ctrlKey && e.altKey) {
            if (e.key.toLowerCase() === 'c') {
                e.preventDefault();
                Settings.enabled = !Settings.enabled;
                $('#ds-cache-enable').prop('checked', Settings.enabled);
                safeSave(); updateTopBarState();
                if (!Settings.zenMode && typeof toastr !== 'undefined') toastr.info(Settings.enabled ? "引擎已啟動" : "引擎已關閉", "快捷鍵");
            }
            if (e.key.toLowerCase() === 'r') { e.preventDefault(); resetCurrentCache(); }
            if (e.key.toLowerCase() === 'z') { 
                e.preventDefault(); 
                Settings.zenMode = !Settings.zenMode; 
                $('#ds-cache-zen').prop('checked', Settings.zenMode);
                safeSave(); updateTopBarState(); 
                if(typeof toastr !== 'undefined') toastr.info(Settings.zenMode ? "已進入禪模式" : "已關閉禪模式", "快捷鍵");
            }
        }
    });
}

function restoreFromLocalSnapshot() {
    try {
        const snap = localStorage.getItem('ds_cache_v22_snapshot');
        if (!snap) { alert("尚未找到有效的本地快照。"); return; }
        if (confirm("即將從本地 localStorage 快照庫還原資料。這將覆蓋當前狀態。確定嗎？")) {
            Object.assign(Settings, JSON.parse(snap));
            safeSave(); renderChatsUI();
            if (typeof toastr !== 'undefined') toastr.success("本地快照還原成功！");
            Logger.log("從 localStorage 快照還原系統狀態。");
            updateTopBarState();
        }
    } catch(e) { alert("快照損毀或無法讀取。"); }
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
                    <h2 class="ds-modal-title"><span class="fa-solid fa-code-merge"></span> DeepSeek 缓存斷裂預警</h2>
                    <p class="ds-modal-text">檢測到陣列發生變更。這將導致預計 <b style="color:${progColor}">${dropPercent}%</b> 的歷史對話緩存失效並重新運算。<br><br><b>插件已自動完成時序陣列的原位更新與補位。</b>請問要接受本次修改嗎？</p>
                    <div class="ds-progress-container"><div class="ds-progress-bar" id="ds-prog-bar" style="background: ${progColor};"></div></div>
                    <div class="ds-map-box">${mapInfo}</div>
                    <div class="ds-btn-group">
                        <button class="ds-btn ds-btn-accept" id="ds-btn-accept">
                            <span class="fa-solid fa-check-double"></span> 確認同步
                        </button>
                        <button class="ds-btn ds-btn-abort" id="ds-btn-abort">
                            <span class="fa-solid fa-ban"></span> 攔截發送
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
// 7. 核心時序處理器 (加強日誌層, 邏輯不變)
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (!Settings.enabled || data.dryRun) return;

    try {
        const chatKeyInfo = getChatKey();
        let state = getChatState(chatKeyInfo);
        if (!data?.chat?.length) return;
        const stream = data.chat;

        if (Settings.logLevel >= LogLevels.DEBUG) {
            Logger.debug(`[輸入原始陣列] 長度: ${stream.length}`);
            stream.forEach((m, idx) => Logger.debug(`  [${idx}] ${m.role}: ${truncateLog(m.content, 40)}`));
        }

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
                    Logger.debug(`[命中-不變] SYS: ${truncateLog(sysMsgsPool[bestIdx].content)}`);
                    sysMsgsPool.splice(bestIdx, 1); 
                } else if (bestScore > thresholds.sys) {
                    const matchedItem = sysMsgsPool[bestIdx];
                    rawFrozenSequence.push(matchedItem); 
                    sysMsgsPool.splice(bestIdx, 1);
                    Logger.debug(`[命中-更新] SYS (相似度: ${(bestScore*100).toFixed(1)}%): [原] ${truncateLog(item.content, 20)} -> [新] ${truncateLog(matchedItem.content, 20)}`);
                } else {
                    Logger.debug(`[遺失-刪除] 找不到對應的舊 SYS: ${truncateLog(item.content)}`);
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
                    Logger.debug(`[命中-不變/微調] 歷史對話: ${truncateLog(remainingHistory[bestIdx].content)}`);
                    remainingHistory.splice(bestIdx, 1);
                } else {
                    Logger.debug(`[遺失-刪除] 找不到舊歷史對話: ${truncateLog(item.content)}`);
                }
            }
        }

        for (let h of remainingHistory) {
            rawFrozenSequence.push(h);
            Logger.debug(`[新增] 全新歷史對話: ${truncateLog(h.content)}`);
        }
        for (let sys of sysMsgsPool) {
            rawFrozenSequence.push(sys);
            Logger.debug(`[新增] 全新 SYS: ${truncateLog(sys.content)}`);
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
            Logger.debug(`[輸出重組陣列] 長度: ${proposedStream.length}`);
            proposedStream.forEach((m, idx) => Logger.debug(`  [${idx}] ${m.role}: ${truncateLog(m.content, 40)}`));
        }

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

            if (isPureContextShift) { wastedLen = 0; Logger.log(`[分析] 自然上下文推移，抑制彈窗。`, LogLevels.DETAILED); }

            let dropRatio = proposedLen === 0 ? 0 : (wastedLen / proposedLen);
            
            if (dropRatio > 0.10 && Settings.showResetPrompt) {
                requireResetConfirm = true;
                dropPercentStr = (dropRatio * 100).toFixed(1);
                
                const tagHtml = `<span class="ds-tag ds-tag-${P[breakIndex]?.tag}">[${P[breakIndex]?.tag}]</span>`;
                const oldContent = escapeHtml(L[breakIndex]?.content || '∅').substring(0, 100).replace(/\n/g, ' ↵ ');
                const newContent = escapeHtml(P[breakIndex]?.content || '∅').substring(0, 100).replace(/\n/g, ' ↵ ');
                
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
        setTopBarStatus('#00ff00', 'DeepSeek 缓存: 健康');

        if (requireResetConfirm) {
            setTopBarStatus('#ffaa00', `DS 缓存: 阻斷中`);
            if (Settings.autoAccept) {
                Logger.warn(`[靜默重組] 自動放行，流失 ${dropPercentStr}%`);
                if (!Settings.zenMode && typeof toastr !== 'undefined') toastr.info(`已自動重組時序 (流失 ${dropPercentStr}%)`, "DeepSeek");
                decision = 'reset';
            } else {
                decision = await askUserForResetAsync(dropPercentStr, mapInfoText);
            }
        }

        if (decision === 'abort') {
            Logger.error('[攔截] 已強制中止生成', null, LogLevels.BASIC);
            setTopBarStatus('#e06c75', 'DS 缓存: 使用者中斷');
            if (typeof toastr !== 'undefined') toastr.error("已強制攔截！請復原提示詞。", "DeepSeek 缓存");
            stream.splice(0, stream.length); 
            return;
        }

        if (decision === 'reset') {
            Logger.log('[同步] 接受原位修改，數據鏈更新。', LogLevels.BASIC);
            setTopBarStatus('#00e5ff', 'DS 缓存: 時序已重構');
            setTimeout(() => setTopBarStatus('#00ff00', 'DS 缓存: 健康'), 3000);
        }

        state.frozenSequence = dedupedSequence;
        state.lastPrefills = currentTurn.prefills;

        const finalStream = [...state.frozenSequence];
        if (currentTurn.user) finalStream.push(currentTurn.user);
        for (const p of currentTurn.prefills) finalStream.push(p);

        state.lastSentSequence = finalStream;
        safeSave();

        if (Settings.autoPinThreshold > 0 && finalStream.length >= Settings.autoPinThreshold) {
            if (!Settings.pinnedChats[chatKeyInfo.key]) {
                Settings.pinnedChats[chatKeyInfo.key] = true;
                safeSave();
                Logger.map(`[智能釘選] 節點數(${finalStream.length})達標，自動保護存檔。`);
            }
        }

        stream.splice(0, stream.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
        Logger.log('✅ 排序整理完成，授權發送。', LogLevels.BASIC);

    } catch (err) {
        setTopBarStatus('#e06c75', 'DS 缓存: 核心崩潰');
        Logger.error('攔截器崩潰', err);
        throw err;
    }
}

// ==========================================
// 8. UI 面板與強效事件綁定
// ==========================================
function renderChatsUI() {
    const container = $('#ds-chat-list-container');
    if (container.length === 0) return;
    container.empty();
    
    $('#ds-storage-badge').text(calculateExactStorage(Settings.chats));

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
            else if (diff < 1440) timeStr = `${Math.floor(diff/60)} 小時前`;
            else timeStr = `${Math.floor(diff/1440)} 天前`;
        }

        const pinColor = isPinned ? '#e5c07b' : 'rgba(255,255,255,0.3)';
        const html = `
            <div class="ds-chat-item ${isActive ? 'active-chat' : ''}" title="${isActive ? '目前對話' : ''}">
                <div style="display:flex; flex-direction:column; overflow:hidden; width:70%;">
                    <span style="font-size:0.85em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:${isActive?'#00e5ff':''};">${isActive ? '🟢 ' : ''}${escapeHtml(chat.label)}</span>
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
        const key = $(this).data('key'); delete Settings.chats[key]; delete Settings.pinnedChats[key];
        safeSave(); renderChatsUI();
    });
    container.find('.ds-pin-btn').on('click', function() {
        const key = $(this).data('key');
        if (Settings.pinnedChats[key]) delete Settings.pinnedChats[key]; else Settings.pinnedChats[key] = true;
        safeSave(); renderChatsUI();
    });
}

function showTopology() {
    const chatKeyInfo = getChatKey();
    const state = Settings.chats[chatKeyInfo.key];
    if (!state || !state.frozenSequence || state.frozenSequence.length === 0) {
        if (typeof toastr !== 'undefined') toastr.info("當前對話尚無快取數據"); return;
    }
    let timelineHtml = '';
    state.frozenSequence.forEach((m, idx) => {
        const fullText = escapeHtml(m.content || '');
        const preview = fullText.substring(0, 80).replace(/\n/g, ' ↵ ');
        timelineHtml += `
            <div class="ds-timeline-item" onclick="this.classList.toggle('expanded')">
                <div class="ds-timeline-index">[${idx}]</div>
                <div><span class="ds-tag ds-tag-${m.tag}">${m.tag}</span></div>
                <div class="ds-timeline-content-wrapper">
                    <div class="ds-timeline-preview">${preview}${fullText.length > 80 ? '...' : ''}</div>
                    <div class="ds-timeline-full">${fullText}</div>
                </div>
            </div>
        `;
    });

    const html = `
        <div class="ds-overlay" id="ds-topo-wrapper">
            <div class="ds-modal" style="max-width: 600px; padding: 25px;">
                <h2 class="ds-modal-title" style="color:#56b6c2; font-size:18px;"><span class="fa-solid fa-list-ol"></span> 互動式拓撲圖 (點擊展開)</h2>
                <div class="ds-map-box ds-timeline-container">${timelineHtml}</div>
                <button class="ds-btn ds-btn-accept" style="width:100%; margin-top:15px;" id="ds-btn-close-topo">關閉預覽</button>
            </div>
        </div>
    `;
    $('body').append(html);
    const closeTopo = () => { $('#ds-topo-wrapper').remove(); document.removeEventListener('keydown', topoKeyHandler, true); };
    $('#ds-btn-close-topo').click(closeTopo);
    const topoKeyHandler = (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTopo(); } };
    document.addEventListener('keydown', topoKeyHandler, true);
}

function performDeepClean() {
    if(!confirm("這將清除所有「未被釘選」且「無節點」或「超過 30 天未活躍」的快取。確定執行嗎？")) return;
    let count = 0; const now = Date.now();
    for (let k in Settings.chats) {
        if (Settings.pinnedChats[k]) continue;
        const chat = Settings.chats[k];
        const isEmpty = !chat.frozenSequence || chat.frozenSequence.length === 0;
        const isOld = chat.lastAccessed && (now - chat.lastAccessed > 30 * 24 * 60 * 60 * 1000);
        if (isEmpty || isOld) { delete Settings.chats[k]; count++; }
    }
    safeSave(); renderChatsUI();
    if (typeof toastr !== 'undefined') toastr.success(`共移除 ${count} 個無效存檔。`);
}

async function setupUI() {
    try {
        injectCSS();
        const html = `
        <div class="inline-drawer" id="ds-v22-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><span class="fa-solid fa-microchip"></span> DeepSeek 优化缓存命中</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:15px; background: rgba(0,0,0,0.1);">
                
                <!-- 核心控制 (水平排版) -->
                <div class="ds-opt-group open">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-sliders"></i> 核心控制</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div class="ds-row">
                            <label class="ds-row-left" style="color:#00e5ff;"><input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}> 啟用時序守護引擎</label>
                            <button id="ds-btn-topo" class="menu_button interactable" style="padding:3px 8px; font-size:0.8em; color:#56b6c2; border:1px solid #56b6c2; background:none;">拓撲圖</button>
                        </div>
                        <div class="ds-row"><label class="ds-row-left" style="color:#c678dd;"><input type="checkbox" id="ds-cache-zen" ${Settings.zenMode ? 'checked' : ''}> 🧘 禪模式 (隱藏彈窗)</label></div>
                        <div class="ds-row"><label class="ds-row-left" style="color:#e5c07b;"><input type="checkbox" id="ds-cache-auto-accept" ${Settings.autoAccept ? 'checked' : ''}> ⚡ 自動放行斷裂重組</label></div>
                        <div class="ds-row"><label class="ds-row-left" style="color:#98c379;"><input type="checkbox" id="ds-cache-hotkeys" ${Settings.hotkeysEnabled ? 'checked' : ''}> ⌨️ 快捷鍵 (Ctrl+Alt+C/R/Z)</label></div>
                    </div>
                </div>

                <!-- 感知與通知 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-satellite-dish"></i> 感知與通知 (30秒冷卻防刷屏)</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-toast-sys" ${Settings.toastSys ? 'checked' : ''}> 📝 提示詞 (內容) 變更</label></div>
                        <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-toast-sys-toggle" ${Settings.toastSysToggle ? 'checked' : ''}> 🎚️ 提示詞 (開關) 切換</label></div>
                        <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-toast-lore" ${Settings.toastLore ? 'checked' : ''}> 📖 角色世界書變更</label></div>
                        <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-toast-global-lore" ${Settings.toastGlobalLore ? 'checked' : ''}> 🌍 全局世界書變更</label></div>
                        <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-toast-his" ${Settings.toastHistory ? 'checked' : ''}> 💬 歷史對話變更</label></div>
                        <hr style="border:0; border-top:1px dashed rgba(255,255,255,0.1); width:100%; margin:2px 0;">
                        <div class="ds-row"><label class="ds-row-left" style="color:#e06c75;"><input type="checkbox" id="ds-toast-reset" ${Settings.showResetPrompt ? 'checked' : ''}> 🛑 啟用視覺化攔截預警</label></div>
                    </div>
                </div>
                
                <!-- 參數與備份 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-gears"></i> 參數與維護</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div class="ds-row">
                            <span style="font-size:0.85em; color:#abb2bf;">容錯率:</span>
                            <select id="ds-cache-tolerance" class="text_pole" style="width:100px; padding:2px;">
                                <option value="0" ${Settings.tolerance===0?'selected':''}>嚴格</option>
                                <option value="1" ${Settings.tolerance===1?'selected':''}>標準</option>
                                <option value="2" ${Settings.tolerance===2?'selected':''}>寬鬆</option>
                            </select>
                        </div>
                        <div class="ds-row">
                            <span style="font-size:0.85em; color:#abb2bf;">日誌等級:</span>
                            <select id="ds-cache-loglevel" class="text_pole" style="width:100px; padding:2px;">
                                <option value="0" ${Settings.logLevel===0?'selected':''}>0:靜默</option>
                                <option value="1" ${Settings.logLevel===1?'selected':''}>1:基礎</option>
                                <option value="2" ${Settings.logLevel===2?'selected':''}>2:詳細</option>
                                <option value="3" ${Settings.logLevel===3?'selected':''}>3:偵錯</option>
                            </select>
                        </div>
                        <div class="ds-row">
                            <span style="font-size:0.85em; color:#abb2bf;">GC 上限:</span>
                            <input type="number" id="ds-cache-maxsize" class="text_pole" value="${Settings.maxCacheSize}" min="5" max="100" style="width:100px; text-align:center; padding:2px;">
                        </div>
                        <div class="ds-row">
                            <span style="font-size:0.85em; color:#abb2bf;">📌 釘選閾值:</span>
                            <input type="number" id="ds-cache-autopin" class="text_pole" value="${Settings.autoPinThreshold}" min="0" max="999" style="width:100px; text-align:center; padding:2px;">
                        </div>
                        <div class="ds-row" style="margin-top:5px;">
                            <button id="ds-btn-export" class="menu_button interactable" style="flex:1; padding:4px; font-size:0.8em;"><i class="fa-solid fa-download"></i> 匯出</button>
                            <button id="ds-btn-import" class="menu_button interactable" style="flex:1; padding:4px; font-size:0.8em;"><i class="fa-solid fa-upload"></i> 匯入</button>
                            <button id="ds-btn-restore-snap" class="menu_button interactable" style="flex:1; padding:4px; font-size:0.8em; color:#56b6c2;"><i class="fa-solid fa-clock-rotate-left"></i> 挽救</button>
                            <input type="file" id="ds-file-import" style="display:none;" accept=".json">
                        </div>
                    </div>
                </div>

                <!-- 快取管理 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-database"></i> 快取池 <span id="ds-storage-badge" class="ds-badge">...</span></span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div id="ds-chat-list-container" class="ds-chat-container"></div>
                        <div class="ds-row">
                            <button id="ds-btn-deep-clean" class="menu_button" style="flex:1; font-size:0.85em; color:#e5c07b; border:1px solid #e5c07b; background:none;">深度清理</button>
                            <button id="ds-cache-factory-reset" class="menu_button" style="flex:1; font-size:0.85em; color:#e06c75; border:1px solid #e06c75; background:none;">格式化</button>
                        </div>
                    </div>
                </div>
                
                <!-- 終端機 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-terminal"></i> 執行緒終端機</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content" style="padding:5px;">
                        <div class="ds-log-toolbar">
                            <span class="ds-log-filter active" data-filter="all">全部</span>
                            <span class="ds-log-filter" data-filter="info">資訊</span>
                            <span class="ds-log-filter" data-filter="warn">警告</span>
                            <span class="ds-log-filter" data-filter="debug">偵錯</span>
                            <span class="ds-log-filter" data-filter="error">錯誤</span>
                            <div style="flex:1;"></div>
                            <span id="ds-btn-clearlog" class="ds-mini-btn" title="清空日誌" style="color:#e06c75;"><span class="fa-solid fa-trash"></span></span>
                        </div>
                        <div id="ds-cache-log-container" class="ds-log-terminal"></div>
                    </div>
                </div>
            </div>
        </div>`;
        
        $('#extensions_settings').append(html);

        // 基礎事件綁定
        $('#ds-cache-enable').on('change', function () { Settings.enabled = $(this).is(':checked'); safeSave(); updateTopBarState(); });
        $('#ds-cache-zen').on('change', function () { Settings.zenMode = $(this).is(':checked'); safeSave(); updateTopBarState(); });
        $('#ds-toast-sys').on('change', function () { Settings.toastSys = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-sys-toggle').on('change', function () { Settings.toastSysToggle = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-lore').on('change', function () { Settings.toastLore = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-global-lore').on('change', function () { Settings.toastGlobalLore = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-his').on('change', function () { Settings.toastHistory = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-reset').on('change', function () { Settings.showResetPrompt = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-auto-accept').on('change', function () { Settings.autoAccept = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-hotkeys').on('change', function () { Settings.hotkeysEnabled = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-tolerance').on('change', function () { Settings.tolerance = parseInt($(this).val()); safeSave(); });
        $('#ds-cache-loglevel').on('change', function () { Settings.logLevel = parseInt($(this).val()); safeSave(); });
        $('#ds-cache-maxsize').on('change', function () { Settings.maxCacheSize = parseInt($(this).val()) || 30; safeSave(); performGarbageCollection(); });
        $('#ds-cache-autopin').on('change', function () { Settings.autoPinThreshold = parseInt($(this).val()) || 0; safeSave(); });

        $('#ds-cache-factory-reset').on('click', () => { if (confirm("確定要格式化所有存檔？")) { Settings.chats = {}; Settings.pinnedChats = {}; safeSave(); renderChatsUI(); } });
        $('#ds-btn-deep-clean').on('click', performDeepClean);
        
        $('.ds-log-filter').on('click', function() {
            $('.ds-log-filter').removeClass('active'); $(this).addClass('active'); const f = $(this).data('filter');
            $('#ds-cache-log-container .ds-log-line').each(function() {
                if (f === 'all' || $(this).data('type') === f) $(this).removeClass('hide'); else $(this).addClass('hide');
            });
        });
        
        $('#ds-btn-clearlog').on('click', () => { $('#ds-cache-log-container').empty(); });
        $('#ds-btn-topo').on('click', showTopology);

        $('#ds-btn-export').on('click', () => {
            const blob = new Blob([JSON.stringify(Settings, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob); const a = document.createElement("a");
            a.href = url; a.download = `DeepSeek_Cache_Backup_${new Date().getTime()}.json`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
            if (typeof toastr !== 'undefined') toastr.success("備份檔案已匯出！");
        });
        $('#ds-btn-import').on('click', () => $('#ds-file-import').click());
        $('#ds-file-import').on('change', function(e) {
            const f = e.target.files[0]; if(!f) return;
            const r = new FileReader();
            r.onload = (ev) => {
                try { Object.assign(Settings, JSON.parse(ev.target.result)); safeSave(); renderChatsUI(); updateTopBarState(); alert("匯入成功！"); } 
                catch (err) { alert("檔案格式錯誤"); }
                e.target.value = '';
            };
            r.readAsText(f);
        });
        $('#ds-btn-restore-snap').on('click', restoreFromLocalSnapshot);

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
            if (event_types?.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, () => triggerWarningImmediate('his_del', '對話被刪除！準備原位補位', Settings.toastHistory));
            if (event_types?.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, () => triggerWarningImmediate('his_edit', '對話被修改！準備原位更新', Settings.toastHistory));
        }

        // ==============================================================
        // 核心修正：全域委派 Input / Change / Click，做到「絕對即時」
        // ==============================================================

        // 1. 捕捉任何提示詞文字框的「實質」輸入變更
        $(document).on('input', 'textarea[id*="prompt"], input[id*="prompt"], .prompt-text, textarea[id*="jailbreak"], textarea[id*="nsfw"], #rm_ch_sys_prompt', function() {
            triggerWarningImmediate('sys_text', '提示詞內容變更！準備原位更新', Settings.toastSys);
        });

        // 2. 捕捉任何提示詞開關、下拉選單的切換
        $(document).on('change', 'input[type="checkbox"][id*="prompt"], input[type="checkbox"][id*="jailbreak"], input[type="checkbox"][id*="nsfw"], .prompt_toggle, select[id*="preset"]', function() {
            triggerWarningImmediate('sys_toggle', '預設提示詞或開關切換！準備原位更新', Settings.toastSysToggle);
        });

        // 3. 捕捉世界書(Lorebook)的內容輸入
        $(document).on('input', '.world_info_entry textarea, .world_info_entry input, .lorebook_entry textarea, .lorebook_entry input, #world_info_settings_panel textarea, #world_info_panel textarea, #character_popup textarea', function() {
            const isGlobal = $(this).closest('#world_info_panel, .world_info_manager, #extensions_settings').length > 0;
            if (isGlobal) {
                triggerWarningImmediate('lore_global', '全局世界書變更！準備原位附加', Settings.toastGlobalLore);
            } else {
                triggerWarningImmediate('lore_char', '角色專屬世界書變更！準備原位附加', Settings.toastLore);
            }
        });

        // 4. 捕捉點擊垃圾桶圖示或刪除按鈕 (應對整個區塊被刪除的狀況)
        $(document).on('click', '.fa-trash, .fa-trash-can, [title*="Delete"], [title*="Remove"]', function() {
            const promptContainer = $(this).closest('.prompt-box, #advanced_formatting_panel');
            const globalLoreContainer = $(this).closest('#world_info_panel, .world_info_manager');
            const charLoreContainer = $(this).closest('#character_popup, .lorebook_entry');

            if (promptContainer.length) triggerWarningImmediate('sys_text', '提示詞方塊被刪除！準備原位更新', Settings.toastSys);
            else if (globalLoreContainer.length) triggerWarningImmediate('lore_global', '全局世界書條目被刪除！準備原位附加', Settings.toastGlobalLore);
            else if (charLoreContainer.length) triggerWarningImmediate('lore_char', '角色世界書條目被刪除！準備原位附加', Settings.toastLore);
        });

        Logger.log('══════ DeepSeek 优化缓存命中 引擎上線 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件啟動失敗:', e);
    }
});
