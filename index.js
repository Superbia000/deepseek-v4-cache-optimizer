import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 1. 樣式注入 (Quantum UI - 次世代全息美學)
// ==========================================
const injectCSS = () => {
    if (document.getElementById('ds-cache-styles')) return;
    const style = document.createElement('style');
    style.id = 'ds-cache-styles';
    style.innerHTML = `
        :root { --ds-cyan: #00e5ff; --ds-purple: #c678dd; --ds-green: #98c379; --ds-red: #e06c75; --ds-yellow: #e5c07b; --ds-bg: rgba(15, 20, 25, 0.6); --ds-border: rgba(0, 229, 255, 0.15); }
        .ds-scroll::-webkit-scrollbar { width: 6px; }
        .ds-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 4px; }
        .ds-scroll::-webkit-scrollbar-thumb { background: rgba(0, 229, 255, 0.3); border-radius: 4px; }
        .ds-scroll::-webkit-scrollbar-thumb:hover { background: rgba(0, 229, 255, 0.6); }

        .ds-opt-group { margin-bottom: 15px; border: 1px solid var(--ds-border); border-radius: 10px; background: var(--ds-bg); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); overflow: hidden; box-shadow: 0 8px 20px rgba(0,0,0,0.2); transition: all 0.3s ease; }
        .ds-opt-group:hover { border-color: rgba(0, 229, 255, 0.3); box-shadow: 0 8px 25px rgba(0, 229, 255, 0.05); }
        .ds-opt-header { padding: 14px 18px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: var(--ds-cyan); background: linear-gradient(90deg, rgba(0,229,255,0.05) 0%, rgba(0,0,0,0) 100%); transition: 0.2s; font-size: 14px; text-shadow: 0 0 10px rgba(0,229,255,0.2); }
        .ds-opt-header:hover { background: linear-gradient(90deg, rgba(0,229,255,0.1) 0%, rgba(0,0,0,0) 100%); color: #fff; }
        .ds-opt-content { padding: 18px; display: flex; flex-direction: column; gap: 14px; display: none; background: rgba(0,0,0,0.2); border-top: 1px solid rgba(255,255,255,0.02); }
        .ds-opt-group.open .ds-opt-content { display: flex; animation: dsFadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .ds-opt-group.open .ds-opt-header i.fa-chevron-down { transform: rotate(180deg); }

        .ds-row { display: flex; flex-direction: row; justify-content: space-between; align-items: center; width: 100%; gap: 12px; }
        .ds-row-left { display: flex; flex-direction: row; justify-content: flex-start; align-items: flex-start; gap: 12px; cursor: pointer; color: #abb2bf; font-size: 13px; flex: 1; line-height: 1.6; word-break: break-word; white-space: normal; transition: color 0.2s; }
        .ds-row-left:hover { color: #fff; }
        .ds-row-left input[type="checkbox"] { margin-top: 4px; flex-shrink: 0; transform: scale(1.15); cursor: pointer; accent-color: var(--ds-cyan); }
        .ds-row-left b { color: var(--ds-yellow); font-weight: 600; letter-spacing: 0.5px; }
        
        .ds-select-styled { background: rgba(0,0,0,0.4); color: var(--ds-cyan); border: 1px solid var(--ds-border); padding: 8px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; outline: none; transition: all 0.2s; font-family: inherit; }
        .ds-select-styled:hover, .ds-select-styled:focus { border-color: var(--ds-cyan); box-shadow: 0 0 10px rgba(0,229,255,0.2); }
        .ds-select-styled option { background: #1e1e24; color: #fff; }

        .ds-log-toolbar { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; background: rgba(0,0,0,0.3); padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); }
        .ds-log-filter { cursor: pointer; padding: 4px 12px; border-radius: 12px; font-size: 11px; background: rgba(255,255,255,0.05); color: #abb2bf; transition: all 0.2s; font-weight: 600; }
        .ds-log-filter.active { background: var(--ds-cyan); color: #000; box-shadow: 0 0 10px rgba(0,229,255,0.4); }
        .ds-log-filter:hover:not(.active) { background: rgba(255,255,255,0.15); color: #fff; }
        .ds-log-terminal { background: #0a0c10; color: #a9b7c6; font-family: 'Fira Code', Consolas, monospace; font-size: 12px; height: 320px; overflow-y: auto; border-radius: 8px; padding: 15px; border: 1px solid rgba(0,229,255,0.2); box-shadow: inset 0 0 20px rgba(0,0,0,0.8); line-height: 1.6; }
        .ds-log-line { margin-bottom: 6px; word-wrap: break-word; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 6px; }
        .ds-log-line.hide { display: none; }
        .ds-log-time { color: #5c6370; margin-right: 10px; user-select: none; font-size: 10px; }
        .ds-log-info { color: var(--ds-green); }
        .ds-log-warn { color: var(--ds-yellow); font-weight: bold; }
        .ds-log-error { color: var(--ds-red); font-weight: bold; text-shadow: 0 0 5px rgba(224,108,117,0.4); }
        .ds-log-map { color: var(--ds-cyan); font-weight: bold; }
        .ds-log-debug { color: var(--ds-purple); }
        .ds-log-divider { color: #4b5263; font-weight: bold; display: block; text-align: center; margin: 15px 0; border-top: 1px solid #2c313a; padding-top: 8px; letter-spacing: 1px; }
        
        .ds-tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; background: rgba(255,255,255,0.05); margin-right: 6px; letter-spacing: 0.5px; }
        .ds-tag-SYS { color: #61afef; border-left: 3px solid #61afef; background: rgba(97,175,239,0.1); }
        .ds-tag-USER { color: var(--ds-green); border-left: 3px solid var(--ds-green); background: rgba(152,195,121,0.1); }
        .ds-tag-AI { color: var(--ds-yellow); border-left: 3px solid var(--ds-yellow); background: rgba(229,192,123,0.1); }
        .ds-tag-PREFILL { color: var(--ds-purple); border-left: 3px solid var(--ds-purple); background: rgba(198,120,221,0.1); }
        .ds-badge { background: rgba(0,229,255,0.1); padding: 4px 10px; border-radius: 6px; font-size: 0.8em; font-family: monospace; color: var(--ds-cyan); border: 1px solid rgba(0,229,255,0.3); box-shadow: 0 0 8px rgba(0,229,255,0.2); }

        .ds-chat-container { max-height:280px; overflow-y:auto; border:1px solid rgba(255,255,255,0.05); padding:10px; border-radius:8px; background: rgba(0,0,0,0.3); }
        .ds-chat-item { display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:12px; margin-bottom:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.05); transition: all 0.2s; }
        .ds-chat-item:hover { background:rgba(255,255,255,0.08); transform: translateX(4px); border-color: rgba(255,255,255,0.1); }
        .ds-chat-item.active-chat { background: linear-gradient(90deg, rgba(0,229,255,0.1) 0%, rgba(0,0,0,0) 100%); border-left: 4px solid var(--ds-cyan); border-top: 1px solid var(--ds-border); border-bottom: 1px solid var(--ds-border); border-right: 1px solid var(--ds-border); box-shadow: inset 0 0 15px rgba(0,229,255,0.05); }
        
        .ds-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); z-index: 999999; display: flex; align-items: center; justify-content: center; animation: dsFadeIn 0.2s ease-out; }
        .ds-modal { background: linear-gradient(180deg, #1e1e24 0%, #15151a 100%); border: 1px solid var(--ds-red); padding: 35px; border-radius: 16px; max-width: 800px; width: 90%; max-height: 90vh; overflow-y: auto; color: #fff; font-family: sans-serif; box-shadow: 0 30px 60px rgba(0,0,0,0.9), 0 0 30px rgba(224,108,117,0.2); position: relative; animation: dsSlideUp 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .ds-modal.ds-modal-blue { border-color: var(--ds-cyan); box-shadow: 0 30px 60px rgba(0,0,0,0.9), 0 0 30px rgba(0,229,255,0.15); }
        .ds-modal-title { color: var(--ds-red); margin: 0 0 20px 0; display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 800; letter-spacing: 1px; text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
        .ds-modal-title.ds-blue { color: var(--ds-cyan); }
        .ds-progress-container { background: rgba(0,0,0,0.6); border-radius: 8px; height: 14px; margin: 25px 0; overflow: hidden; box-shadow: inset 0 2px 6px rgba(0,0,0,0.8); border: 1px solid rgba(255,255,255,0.05); }
        .ds-progress-bar { height: 100%; width: 0%; transition: width 1s cubic-bezier(0.22, 1, 0.36, 1), background 0.3s; position: relative; overflow: hidden; }
        .ds-progress-bar::after { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0) 100%); animation: dsShimmer 2s infinite; }
        
        .ds-map-box { background: rgba(0,0,0,0.5); padding: 18px; border-radius: 10px; font-family: 'Fira Code', Consolas, monospace; font-size: 13px; color: #abb2bf; margin: 20px 0; border: 1px solid rgba(255,255,255,0.08); max-height: 350px; overflow-y: auto; line-height: 1.7; box-shadow: inset 0 0 15px rgba(0,0,0,0.5); }
        .ds-diff-del { background: rgba(224, 108, 117, 0.1); border-left: 4px solid var(--ds-red); padding: 10px 15px; margin-bottom: 8px; border-radius: 0 6px 6px 0; color: #ff8c94; word-wrap: break-word; }
        .ds-diff-add { background: rgba(152, 195, 121, 0.1); border-left: 4px solid var(--ds-green); padding: 10px 15px; border-radius: 0 6px 6px 0; color: #b5e890; word-wrap: break-word; }
        
        .ds-btn-col { display: flex; flex-direction: column; gap: 14px; margin-top: 30px; }
        .ds-btn { padding: 16px 20px; border: 1px solid transparent; border-radius: 10px; cursor: pointer; font-weight: bold; font-size: 15px; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); position: relative; overflow: hidden; display:flex; align-items:center; justify-content:flex-start; gap:15px; text-align:left; line-height: 1.5; background: rgba(255,255,255,0.05); color: #fff; }
        .ds-btn:hover { transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0,0,0,0.4); border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.1); }
        .ds-btn:active { transform: translateY(0); }
        .ds-btn i { font-size: 18px; width: 24px; text-align: center; }
        
        .ds-btn-accept { border-color: rgba(152,195,121,0.4); background: linear-gradient(90deg, rgba(152,195,121,0.15) 0%, rgba(0,0,0,0) 100%); }
        .ds-btn-accept:hover { border-color: var(--ds-green); box-shadow: 0 0 15px rgba(152,195,121,0.3); }
        .ds-btn-accept i { color: var(--ds-green); }
        
        .ds-btn-revert { border-color: rgba(198,120,221,0.4); background: linear-gradient(90deg, rgba(198,120,221,0.15) 0%, rgba(0,0,0,0) 100%); }
        .ds-btn-revert:hover { border-color: var(--ds-purple); box-shadow: 0 0 15px rgba(198,120,221,0.3); }
        .ds-btn-revert i { color: var(--ds-purple); }
        
        .ds-btn-abort { border-color: rgba(224,108,117,0.4); background: linear-gradient(90deg, rgba(224,108,117,0.15) 0%, rgba(0,0,0,0) 100%); }
        .ds-btn-abort:hover { border-color: var(--ds-red); box-shadow: 0 0 15px rgba(224,108,117,0.3); }
        .ds-btn-abort i { color: var(--ds-red); }
        
        .ds-btn-blue { border-color: rgba(0,229,255,0.4); background: linear-gradient(90deg, rgba(0,229,255,0.15) 0%, rgba(0,0,0,0) 100%); }
        .ds-btn-blue:hover { border-color: var(--ds-cyan); box-shadow: 0 0 15px rgba(0,229,255,0.3); }
        .ds-btn-blue i { color: var(--ds-cyan); }

        .ds-btn-reset { border-color: rgba(224,108,117,0.2); background: rgba(224,108,117,0.05); }
        .ds-btn-reset:hover { border-color: var(--ds-red); background: rgba(224,108,117,0.15); }
        .ds-btn-reset i { color: var(--ds-red); }

        .ds-guide-box { background: rgba(0,0,0,0.3); padding: 20px; border-radius: 10px; margin-top: 20px; font-size: 14px; line-height: 1.7; border-left: 4px solid var(--ds-purple); box-shadow: inset 0 0 10px rgba(0,0,0,0.2); }
        .ds-guide-title { color: var(--ds-purple); font-weight: bold; margin-bottom: 12px; font-size: 16px; letter-spacing: 0.5px; }
        .ds-guide-list { margin: 0; padding-left: 22px; }
        .ds-guide-list li { margin-bottom: 10px; }

        @keyframes dsFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes dsSlideUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes dsPulse { 0% { opacity: 0.6; } 50% { opacity: 1; text-shadow: 0 0 8px var(--ds-purple); } 100% { opacity: 0.6; } }
        @keyframes dsShimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
    `;
    document.head.appendChild(style);
};

// ==========================================
// 2. 狀態設定 (新增平行宇宙與納米微創)
// ==========================================
let Settings = {};

function initSettings() {
    const oldSettings = extension_settings.ds_cache_v35 || extension_settings.ds_cache_v34 || {};
    if (!extension_settings.ds_cache_v36) {
        extension_settings.ds_cache_v36 = {
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
            dynamicMode: oldSettings.dynamicMode ?? 1, 
            historyEditMode: oldSettings.historyEditMode ?? 1, 
            lorebookSink: oldSettings.lorebookSink ?? true, 
            retconProtocol: oldSettings.retconProtocol ?? true, 
            hotReloadPersona: oldSettings.hotReloadPersona ?? true, 
            flashbackInsertion: oldSettings.flashbackInsertion ?? true, 
            multiverseProtocol: oldSettings.multiverseProtocol ?? true, // 新增：平行宇宙協議
            nanoPatching: oldSettings.nanoPatching ?? true, // 新增：納米微創手術
            chats: oldSettings.chats || {},
            pinnedChats: oldSettings.pinnedChats || {} 
        };
    }
    Settings = extension_settings.ds_cache_v36;
    if (!Settings.pinnedChats) Settings.pinnedChats = {};
    if (!Settings.chats) Settings.chats = {}; 
}

function safeSave() {
    try { 
        if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced(); 
        if (Math.random() < 0.1) localStorage.setItem('ds_cache_v36_snapshot', JSON.stringify(Settings));
    } 
    catch (e) {}
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
            if (typeof toastr !== 'undefined') toastr.warning(msg, '💡 平行宇宙优化器', { timeOut: 3000 });
        }
    }
}

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function truncateLog(str, len = 50) {
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
    Logger.warn(`[自动清理] 垃圾车出动！已清理 ${toRemove.length} 个很久没碰过的旧存档，释放空间。`);
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
        $('#ds-top-reset-btn').attr('title', '平行宇宙缓存: 已停用 (大模型每次都会重读所有内容)');
        dot.html('<i class="fa-solid fa-circle"></i>');
    } else if (Settings.zenMode) {
        dot.css('color', '#c678dd');
        $('#ds-top-reset-btn').attr('title', '平行宇宙缓存: 运作中 [沉浸免打扰模式]');
        dot.html('<i class="fa-solid fa-yin-yang ds-zen-icon"></i>');
    } else {
        dot.css('color', '#00e5ff');
        $('#ds-top-reset-btn').attr('title', '平行宇宙缓存: 运作中 (正在为您省钱省算力)');
        dot.html('<i class="fa-solid fa-circle" style="text-shadow: 0 0 5px #00e5ff;"></i>');
    }
}

function setTopBarStatus(color, title) {
    if (!Settings.enabled) return;
    const dot = $('#ds-top-status-dot');
    if (dot.length) {
        if (!Settings.zenMode || color === '#e06c75') { 
            dot.css('color', color);
            if(color === '#00e5ff' || color === '#00ff00') dot.html('<i class="fa-solid fa-circle" style="text-shadow: 0 0 5px '+color+';"></i>');
        }
        $('#ds-top-reset-btn').attr('title', title + ' (左键开关 / 右键清空)');
    }
}

function logAt(level, type, msg) {
    if (Settings.logLevel < level) return;
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
    
    if (type === 'warn') console.warn(`%c[平行宇宙] 🌪️ ${msg}`, 'color: #e5c07b;');
    else if (type === 'error') console.error(`[平行宇宙] 🔴 ${msg}`);
    else if (type === 'map') console.log(`%c[平行宇宙] 🗺️ ${msg}`, 'color: #00e5ff;');
    else if (type === 'debug') console.log(`%c[平行宇宙] 🐛 ${msg}`, 'color: #c678dd;');
    else if (type === 'divider') console.log(`%c${msg}`, 'color: #4b5263; font-weight: bold;');
    else console.log(`%c[平行宇宙] ✅ ${msg}`, 'color: #98c379;');
    
    const container = document.getElementById('ds-cache-log-container');
    if (container) {
        const line = document.createElement('div');
        line.className = 'ds-log-line';
        line.setAttribute('data-type', type === 'divider' ? 'info' : type);
        
        if (type === 'divider') {
            line.innerHTML = `<span class="ds-log-divider">${msg}</span>`;
        } else {
            line.innerHTML = `<span class="ds-log-time">[${time}]</span> <span class="ds-log-${type}">${msg.replace(/\n/g, '<br>')}</span>`;
        }
        
        container.appendChild(line);
        const activeFilter = $('.ds-log-filter.active').data('filter') || 'all';
        if (activeFilter !== 'all' && activeFilter !== type && type !== 'divider') line.classList.add('hide');
        while (container.childNodes.length > 800) container.removeChild(container.firstChild);
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
// 4. 狀態管理與擴充選單
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
        Settings.chats[chatKeyInfo.key] = { label: chatKeyInfo.label, frozenSequence: [], multiverse: [], lastSentSequence: [], lastPrefills: [], lastAccessed: Date.now(), dynamicAnomalies: [] };
        safeSave(); renderChatsUI();
    } else {
        Settings.chats[chatKeyInfo.key].lastAccessed = Date.now();
        if (!Settings.chats[chatKeyInfo.key].dynamicAnomalies) Settings.chats[chatKeyInfo.key].dynamicAnomalies = [];
        if (!Settings.chats[chatKeyInfo.key].multiverse) Settings.chats[chatKeyInfo.key].multiverse = [];
        performGarbageCollection();
    }
    return Settings.chats[chatKeyInfo.key];
}

function ensureTopMenuButton() {
    if ($('#ds-top-reset-btn').length === 0) {
        const btn = $(`
            <li id="ds-top-reset-btn" class="menu_button interactable" title="DeepSeek 平行宇宙缓存优化器">
                <span class="fa-solid fa-microchip"></span>
                <span id="ds-top-status-dot" style="font-size:0.7em; margin-left:2px; vertical-align:top;"></span>
            </li>
        `);
        btn.on('click', (e) => {
            e.preventDefault();
            Settings.enabled = !Settings.enabled;
            $('#ds-cache-enable').prop('checked', Settings.enabled);
            safeSave(); updateTopBarState();
            if (!Settings.zenMode && typeof toastr !== 'undefined') toastr.info(Settings.enabled ? "🚀 平行宇宙缓存已启动！" : "💤 平行宇宙缓存已关闭。", "DeepSeek");
        });
        btn.on('contextmenu', (e) => { e.preventDefault(); resetCurrentCache(); });
        if ($('ul#extensions_menu').length > 0) $('ul#extensions_menu').append(btn);
        else if ($('#right-nav-extensions').length > 0) $('#right-nav-extensions').append(btn);
    }
    updateTopBarState();
}

function addResetMenuEntry() {
    const menu = document.getElementById('extensionsMenu') || document.getElementById('extensions_menu');
    if (!menu) {
        setTimeout(addResetMenuEntry, 300);
        return;
    }
    if (document.getElementById('ds-bottom-reset-btn')) return;

    const toggleBtn = document.createElement('div');
    toggleBtn.id = 'ds-bottom-reset-btn';
    toggleBtn.className = 'list-group-item'; 
    toggleBtn.title = '撕掉整本书，让大模型从头开始重新阅读整个对话（适合AI逻辑混乱时使用）';
    toggleBtn.innerHTML = '<i class="fa-solid fa-broom" style="color: #e06c75;"></i> 撕书重来 (清空当前缓存)';
    toggleBtn.addEventListener('click', () => {
        resetCurrentCache();
        const menuJq = $('#extensions_menu');
        if(menuJq.hasClass('open')) menuJq.removeClass('open').hide();
    });
    menu.appendChild(toggleBtn);
}

function resetCurrentCache() {
    if(!confirm("⚠️ 确定要「撕书重来」吗？\n\n这会清空当前对话的所有缓存，大模型下次回复时会把整个故事从头到尾重新看一遍。\n(这会消耗较多算力和时间，通常只在 AI 逻辑严重混乱，或者你大改了设定时才使用)")) return;
    const key = getChatKey().key;
    delete Settings.chats[key];
    safeSave(); renderChatsUI();
    setTopBarStatus('#00e5ff', '缓存: 已撕书重来');
    if (typeof toastr !== 'undefined') toastr.success("📚 撕书成功！下次发送时，AI 将重新阅读整个故事。");
    Logger.warn(`手动清空了当前对话缓存: ${key}`);
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
                if (!Settings.zenMode && typeof toastr !== 'undefined') toastr.info(Settings.enabled ? "🚀 平行宇宙缓存已启动" : "💤 平行宇宙缓存已关闭", "快捷键");
            }
            if (e.key.toLowerCase() === 'r') { e.preventDefault(); resetCurrentCache(); }
            if (e.key.toLowerCase() === 'z') { 
                e.preventDefault(); 
                Settings.zenMode = !Settings.zenMode; 
                $('#ds-cache-zen').prop('checked', Settings.zenMode);
                safeSave(); updateTopBarState(); 
                if(typeof toastr !== 'undefined') toastr.info(Settings.zenMode ? "🧘 沉浸免打扰已开启" : "🔔 沉浸免打扰已关闭", "快捷键");
            }
        }
    });
}

// ==========================================
// 5. 核心邏輯工具與 Diff 演算法 (納米微創版)
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
    
    if (s2.includes(s1) && s1.length > 10) return 0.95;

    const bigrams = new Set();
    for (let i = 0; i < s1.length - 1; i++) bigrams.add(s1.substring(i, i+2));
    let matchCount = 0;
    for (let i = 0; i < s2.length - 1; i++) if (bigrams.has(s2.substring(i, i+2))) matchCount++;
    const union = (s1.length - 1) + (s2.length - 1) - matchCount;
    return union <= 0 ? 1 : matchCount / union;
}

// 納米微創：提取新增或修改的句子
function extractAddedText(oldStr, newStr) {
    const oldSentences = oldStr.split(/([。！？.!?\n]+)/);
    const newSentences = newStr.split(/([。！？.!?\n]+)/);
    const oldSet = new Set(oldSentences.map(s => s.trim()).filter(s => s.length > 2));
    let added = [];
    for (let s of newSentences) {
        let t = s.trim();
        if (t.length > 2 && !oldSet.has(t)) added.push(t);
    }
    return added.join(' ');
}

function simpleDiffHighlight(oldStr, newStr) {
    let start = 0;
    while(start < oldStr.length && start < newStr.length && oldStr[start] === newStr[start]) start++;
    let endOld = oldStr.length - 1;
    let endNew = newStr.length - 1;
    while(endOld >= start && endNew >= start && oldStr[endOld] === newStr[endNew]) { endOld--; endNew--; }
    
    const prefix = escapeHtml(oldStr.substring(0, start));
    const suffix = escapeHtml(oldStr.substring(endOld + 1));
    const delText = escapeHtml(oldStr.substring(start, endOld + 1));
    const insText = escapeHtml(newStr.substring(start, endNew + 1));
    
    let result = prefix;
    if (delText) result += `<del style="color:#e06c75; background:rgba(224,108,117,0.2); text-decoration:line-through; font-weight:bold; padding:0 2px;">${delText}</del>`;
    if (insText) result += `<ins style="color:#98c379; background:rgba(152,195,121,0.2); text-decoration:none; font-weight:bold; padding:0 2px;">${insText}</ins>`;
    result += suffix;
    
    return result.replace(/\n/g, '<br>');
}

function stripPrefillFromAssistant(assistantObj, prefills) {
    if (!assistantObj || !prefills || prefills.length === 0) return assistantObj;
    let content = assistantObj.content || '';
    let modified = false;
    for (const p of prefills) {
        const pContent = p.content || '';
        const trimmedContent = content.trimStart();
        const trimmedPContent = pContent.trimStart();
        if (trimmedContent.startsWith(trimmedPContent)) { 
            content = trimmedContent.substring(trimmedPContent.length); 
            modified = true; 
        }
    }
    if (modified) {
        content = content.replace(/^[\s\n]+/, ''); 
        return { ...assistantObj, content: content, norm: Logger.normalize(content), len: content.length };
    }
    return assistantObj;
}

function parseSTStream(stream) {
    const sysMsgs = []; const chatMsgs = [];
    for (const msg of stream) {
        if (!msg.content || msg.content.trim() === '') continue;
        const isSys = (msg.role === 'system' || (msg.role !== 'user' && msg.role !== 'assistant'));
        if (isSys) sysMsgs.push(createMsg(msg, 'SYS'));
        else chatMsgs.push(createMsg(msg, msg.role === 'user' ? 'USER' : 'AI'));
    }

    // 絕對排序：修復 Hash 碰撞，改用 localeCompare 確保 100% 穩定
    sysMsgs.sort((a, b) => a.norm.localeCompare(b.norm));

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
                if (curUser) historyTurns.push({ user: curUser, assistant: curAiContents.length ? createMsg({role: 'assistant', content: curAiContents.join('\n')}, 'AI') : null });
                curUser = msg; curAiContents = [];
            } else if (msg.tag === 'AI') curAiContents.push(msg.content);
        }
        if (curUser) historyTurns.push({ user: curUser, assistant: curAiContents.length ? createMsg({role: 'assistant', content: curAiContents.join('\n')}, 'AI') : null });
    }
    return { sysMsgs, historyTurns, currentTurn };
}

// ==========================================
// 6. 診斷中心與自適應攔截器 UI
// ==========================================
function showDiagnosticCenter() {
    const chatKeyInfo = getChatKey();
    const state = Settings.chats[chatKeyInfo.key];
    
    let contentHtml = '';
    if (!state || !state.dynamicAnomalies || state.dynamicAnomalies.length === 0) {
        contentHtml = `<div style="text-align:center; padding: 30px; color:var(--ds-green);"><i class="fa-solid fa-shield-heart" style="font-size:50px; margin-bottom:20px; text-shadow: 0 0 20px rgba(152,195,121,0.5);"></i><br><b style="font-size:18px;">太棒了！您的缓存处于量子纠缠态 (完美健康)！</b><br><br><span style="color:#abb2bf; font-size:14px;">当前对话没有检测到任何会破坏缓存的「捣蛋鬼」(动态提示词)。<br>大模型可以完美记住你们的每一句对话！</span></div>`;
    } else {
        const anomaly = state.dynamicAnomalies[state.dynamicAnomalies.length - 1]; 
        const diffHtml = simpleDiffHighlight(anomaly.oldText, anomaly.newText);
        
        contentHtml = `
            <p style="color:#abb2bf; font-size:14px; line-height:1.6;">
                <b>大模型就像在看一本长篇小说。</b><br>
                如果小说中间有一句话每次都在变（比如时间、天气、最新对话总结），它每次都要把那句话后面的所有内容<b style="color:var(--ds-red);">全部重新读一遍</b>！这会浪费大量的时间和算力。<br><br>
                系统抓到了这个捣蛋鬼（如下方的红绿高亮处）。请在设置中选择一个一劳永逸的解决方案。
            </p>
            
            <div class="ds-map-box">
                ${diffHtml}
            </div>

            <div class="ds-guide-box">
                <div class="ds-guide-title"><i class="fa-solid fa-wrench"></i> 治本方法 (手动去 ST 里改)</div>
                <ul class="ds-guide-list">
                    <li><b>方法 1：删掉它</b> - 去 ST 的「高级格式化」或「系统提示词」中，删掉包含 <code>{{time}}</code> 或 <code>{{date}}</code> 的句子。</li>
                    <li><b>方法 2：关掉注入</b> - 检查是否有开启「注入最新聊天记录到系统提示词」的插件，把它关掉。</li>
                    <li><b>方法 3：移到最下面</b> - 如果你一定要用动态变量，请在 ST 设置中，将该提示词的插入位置改为 <b>"在用户输入之前 (Before User Input)"</b>。</li>
                </ul>
            </div>

            <div class="ds-guide-box" style="border-left-color: var(--ds-cyan);">
                <div class="ds-guide-title" style="color: var(--ds-cyan);"><i class="fa-solid fa-robot"></i> 治标方法 (让本插件帮你自动处理)</div>
                <ul class="ds-guide-list">
                    <li><b style="color:var(--ds-cyan);">【方案 1】写日记模式 (强烈推荐，100%缓存)</b>：把它当做日记的日期存下来，新的写在最后面。大模型能感受到时间流逝，且完全不破坏缓存！</li>
                    <li><b>【方案 2】垫底模式 (99%缓存)</b>：把它抽出来，强行塞到对话的最下面。</li>
                    <li><b>【方案 3】假装没看见 (100%缓存)</b>：如果只是时间变了，直接无视，永远用第一次的时间。</li>
                    <li><b style="color:var(--ds-red);">【方案 4】原位替换 (极度不推荐)</b>：让它在中间变。警告：每次都会烧掉大量 Token！</li>
                    <li><b>【方案 5】直接删掉 (100%缓存)</b>：直接把这句话删掉，AI 永远看不到它。</li>
                </ul>
            </div>
        `;
    }

    const html = `
        <div class="ds-overlay" id="ds-modal-diagnostic">
            <div class="ds-modal ds-modal-blue ds-scroll">
                <h2 class="ds-modal-title ds-blue"><span class="fa-solid fa-stethoscope"></span> 🏥 缓存杀手体检中心</h2>
                ${contentHtml}
                <button class="ds-btn ds-btn-blue" style="width:100%; margin-top:25px; justify-content:center;" onclick="$('#ds-modal-diagnostic').remove();">我了解了，关闭视窗</button>
            </div>
        </div>
    `;
    $('body').append(html);
}

function askDynamicPromptStrategyAsync() {
    return new Promise(resolve => {
        const html = `
            <div class="ds-overlay" id="ds-modal-dynamic">
                <div class="ds-modal ds-modal-blue ds-scroll">
                    <h2 class="ds-modal-title ds-blue"><span class="fa-solid fa-wand-magic-sparkles"></span> ⚠️ 发现「会自己变的文字」(动态提示词)</h2>
                    <p class="ds-modal-text" style="line-height: 1.6; font-size: 14px; color:#abb2bf;">
                        <b>大模型就像在看一本长篇小说。</b><br>
                        如果小说中间有一句话每次都在变（比如时间、天气），它每次都要把那句话后面的所有内容<b style="color:var(--ds-red);">全部重新读一遍</b>！<br>
                        系统检测到了这种文字。请选择一个一劳永逸的解决方案（选择后将永久自动处理，不再弹窗）：
                    </p>
                    
                    <div class="ds-btn-col">
                        <button class="ds-btn ds-btn-blue" id="ds-btn-dyn-1">
                            <i class="fa-solid fa-book-journal-whills"></i>
                            <div style="flex:1;">
                                <b>方案 1：写日记模式 (强烈推荐！100%保住缓存)</b><br>
                                <span style="font-size:12px; font-weight:normal; color:rgba(255,255,255,0.7);">把它当做日记的日期存下来，新的写在最后面。大模型能感受到时间流逝，且完全不破坏缓存！</span>
                            </div>
                        </button>
                        <button class="ds-btn ds-btn-bypass" id="ds-btn-dyn-2">
                            <i class="fa-solid fa-anchor"></i>
                            <div style="flex:1;">
                                <b>方案 2：垫底模式 (保住99%缓存)</b><br>
                                <span style="font-size:12px; font-weight:normal; color:rgba(255,255,255,0.5);">把它抽出来，强行塞到对话的最下面。只会稍微影响一点点缓存。</span>
                            </div>
                        </button>
                        <button class="ds-btn ds-btn-bypass" id="ds-btn-dyn-3">
                            <i class="fa-solid fa-eye-slash"></i>
                            <div style="flex:1;">
                                <b>方案 3：假装没看见 (100%缓存)</b><br>
                                <span style="font-size:12px; font-weight:normal; color:rgba(255,255,255,0.5);">如果只是时间变了，直接无视，永远用第一次的时间。</span>
                            </div>
                        </button>
                        <button class="ds-btn ds-btn-bypass" id="ds-btn-dyn-4">
                            <i class="fa-solid fa-fire"></i>
                            <div style="flex:1;">
                                <b style="color:var(--ds-red);">方案 4：原位替换 (极度不推荐！烧钱烧算力)</b><br>
                                <span style="font-size:12px; font-weight:normal; color:rgba(224,108,117,0.8);">让它在中间变。警告：每次都会破坏大量缓存！</span>
                            </div>
                        </button>
                        <button class="ds-btn ds-btn-reset" id="ds-btn-dyn-5">
                            <i class="fa-solid fa-trash"></i>
                            <div style="flex:1;">
                                <b>方案 5：直接删掉 (100%缓存)</b><br>
                                <span style="font-size:12px; font-weight:normal; color:rgba(224,108,117,0.8);">直接把这句话删掉，AI 永远看不到它。</span>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        `;
        $('body').append(html);

        const cleanup = () => { $('#ds-modal-dynamic').remove(); };
        
        $('#ds-btn-dyn-1').click(() => { cleanup(); resolve(1); });
        $('#ds-btn-dyn-2').click(() => { cleanup(); resolve(2); });
        $('#ds-btn-dyn-3').click(() => { cleanup(); resolve(3); });
        $('#ds-btn-dyn-4').click(() => { cleanup(); resolve(4); });
        $('#ds-btn-dyn-5').click(() => { cleanup(); resolve(5); });
    });
}

function askUserForResetAsync(dropPercent, mapInfo, causeText) {
    return new Promise(resolve => {
        let progColor = 'var(--ds-green)'; 
        if (dropPercent >= 50) progColor = 'var(--ds-red)'; 
        else if (dropPercent >= 20) progColor = 'var(--ds-yellow)'; 

        const html = `
            <div class="ds-overlay" id="ds-modal-wrapper">
                <div class="ds-modal ds-scroll">
                    <h2 class="ds-modal-title"><span class="fa-solid fa-heart-crack"></span> 💔 糟糕！缓存断裂了</h2>
                    <p class="ds-modal-text" style="line-height: 1.6; font-size: 14px; color:#abb2bf;">
                        <b>大模型就像在看书，如果中间有一页被修改了，它就要把那一页到结尾全部重新看一遍！</b><br>
                        系统检测到您 <b>${causeText}</b>，导致约 <b style="color:${progColor}; font-size:18px; text-shadow: 0 0 10px ${progColor};">${dropPercent}%</b> 的内容需要重新阅读。<br>
                        请问要如何处理本次发送？
                    </p>
                    <div class="ds-progress-container"><div class="ds-progress-bar" id="ds-prog-bar" style="background: ${progColor};"></div></div>
                    <div class="ds-map-box ds-scroll">${mapInfo}</div>
                    
                    <div class="ds-btn-col">
                        <button class="ds-btn ds-btn-accept" id="ds-btn-accept">
                            <i class="fa-solid fa-check"></i>
                            <div style="flex:1;">
                                <b>没关系，帮我无缝修补并发送 (推荐)</b><br>
                                <span style="font-size:12px; font-weight:normal; color:rgba(255,255,255,0.7);">我确实要改这些内容。消耗算力重新建立缓存。</span>
                            </div>
                        </button>
                        <button class="ds-btn ds-btn-revert" id="ds-btn-revert">
                            <i class="fa-solid fa-clock-rotate-left"></i>
                            <div style="flex:1;">
                                <b>时空回溯：假装我没改过，用旧版发送</b><br>
                                <span style="font-size:12px; font-weight:normal; color:rgba(255,255,255,0.7);">我不想浪费算力。无视我刚才的修改，强行用旧版内容发送 (保住100%缓存)。</span>
                            </div>
                        </button>
                        <button class="ds-btn ds-btn-abort" id="ds-btn-abort">
                            <i class="fa-solid fa-ban"></i>
                            <div style="flex:1;">
                                <b>物理拔管！立刻停止发送</b><br>
                                <span style="font-size:12px; font-weight:normal; color:rgba(255,255,255,0.7);">等一下，我改错了！立刻中止对话，让我退回去修改。</span>
                            </div>
                        </button>
                        <button class="ds-btn ds-btn-bypass" id="ds-btn-bypass">
                            <i class="fa-solid fa-forward"></i>
                            <div style="flex:1;">
                                <b>不管缓存，按原样硬发</b><br>
                                <span style="font-size:12px; font-weight:normal; color:rgba(255,255,255,0.5);">关闭本次优化，完全按 ST 原本的乱序发送。</span>
                            </div>
                        </button>
                        <button class="ds-btn ds-btn-reset" id="ds-btn-reset">
                            <i class="fa-solid fa-book-skull"></i>
                            <div style="flex:1;">
                                <b>撕掉整本书，从头重读</b><br>
                                <span style="font-size:12px; font-weight:normal; color:rgba(224,108,117,0.8);">清空当前所有缓存，让大模型完全重新开始阅读。</span>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        `;
        $('body').append(html);
        setTimeout(() => { $('#ds-prog-bar').css('width', `${Math.min(dropPercent, 100)}%`); }, 50);

        const cleanup = () => { $('#ds-modal-wrapper').remove(); document.removeEventListener('keydown', keyHandler, true); };
        
        $('#ds-btn-accept').click(() => { cleanup(); resolve('accept'); });
        $('#ds-btn-revert').click(() => { cleanup(); resolve('revert'); });
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
// 7. 完美時序凍結演算法 (Multiverse v36)
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (!Settings.enabled || data.dryRun) return;
    const startTime = performance.now();
    const chatKeyInfo = getChatKey();

    try {
        let state = getChatState(chatKeyInfo);
        if (!data?.chat?.length) return;
        const stream = data.chat;

        Logger.divider(`===== 🚀 启动平行宇宙拦截: ${chatKeyInfo.label} =====`);

        const { sysMsgs, historyTurns, currentTurn } = parseSTStream(stream);
        const flatHistoryPool = [];
        for(let t of historyTurns) {
            flatHistoryPool.push(t.user);
            if(t.assistant) flatHistoryPool.push(stripPrefillFromAssistant(t.assistant, state.lastPrefills));
        }

        // 🌌 平行宇宙協議：尋找最匹配的時間線
        if (Settings.multiverseProtocol && state.multiverse && state.multiverse.length > 0) {
            let bestUniverse = state.frozenSequence;
            let bestMatchCount = -1;
            
            const currentStreamNorms = [...sysMsgs, ...flatHistoryPool].map(m => m.norm);
            
            for (let i = 0; i < state.multiverse.length; i++) {
                const universe = state.multiverse[i];
                let matchCount = 0;
                for (let j = 0; j < Math.min(universe.length, currentStreamNorms.length); j++) {
                    if (universe[j].norm === currentStreamNorms[j]) matchCount++;
                    else break;
                }
                if (matchCount > bestMatchCount) {
                    bestMatchCount = matchCount;
                    bestUniverse = universe;
                }
            }
            
            if (bestUniverse !== state.frozenSequence) {
                Logger.map(`[🌌 平行宇宙跳跃] 检测到分支切换或撤销操作！已自动跳跃至匹配度最高的平行宇宙 (匹配节点: ${bestMatchCount})，保住最大缓存！`);
                state.frozenSequence = bestUniverse;
            }
        }

        let newFrozenSequence = [];
        const sysPool = [...sysMsgs];
        const remainingHistory = [...flatHistoryPool];
        const thresholds = getTolerance();
        
        // ---------------------------------------------------------
        // 階段 1：動態提示詞偵測與詢問
        // ---------------------------------------------------------
        let needsAsk = false;
        let detectedAnomalies = [];
        
        for (let i = 0; i < state.frozenSequence.length; i++) {
            const item = state.frozenSequence[i];
            if (item.tag === 'SYS') {
                let bestIdx = -1, bestScore = 0;
                for (let j = 0; j < sysPool.length; j++) {
                    const score = getSimilarity(item.norm, sysPool[j].norm);
                    if (score > bestScore) { bestScore = score; bestIdx = j; }
                }
                if (bestScore > thresholds.sys && bestScore < 1) {
                    detectedAnomalies.push({ oldText: item.content, newText: sysPool[bestIdx].content, score: bestScore });
                    if (Settings.dynamicMode === 0) needsAsk = true;
                }
            }
        }

        if (detectedAnomalies.length > 0) {
            state.dynamicAnomalies = detectedAnomalies; 
        }

        if (needsAsk) {
            Settings.dynamicMode = await askDynamicPromptStrategyAsync();
            safeSave();
            $('#ds-cache-dynamic-mode').val(Settings.dynamicMode);
            Logger.warn(`[动态提示词] 用户已选择处理模式: ${Settings.dynamicMode}`);
        }

        // ---------------------------------------------------------
        // 階段 2：原位更新與同步邏輯 (支援快照、時空補丁、吃書協議、熱更新、納米微創)
        // ---------------------------------------------------------
        let dynamicPromptsToSink = [];
        let oldSnapshotsToMove = [];
        let timeSpacePatches = []; 
        let hasSeenHistory = false;

        // 🐍 銜尾蛇協議：檢測上下文是否因超出長度而滾動
        let oldestFrozenHistory = state.frozenSequence.find(m => m.tag === 'USER' || m.tag === 'AI');
        let isContextShift = false;
        if (oldestFrozenHistory) {
            let stillExists = remainingHistory.some(m => m.norm === oldestFrozenHistory.norm);
            if (!stillExists) isContextShift = true;
        }

        for (let i = 0; i < state.frozenSequence.length; i++) {
            const item = state.frozenSequence[i];
            if (item.tag === 'USER' || item.tag === 'AI') {
                hasSeenHistory = true;
                let bestIdx = -1, bestScore = 0;
                for (let j = 0; j < remainingHistory.length; j++) {
                    if (item.tag !== remainingHistory[j].tag) continue;
                    const score = getSimilarity(item.norm, remainingHistory[j].norm);
                    if (score > bestScore) { bestScore = score; bestIdx = j; }
                }
                
                if (bestScore === 1) {
                    newFrozenSequence.push(remainingHistory[bestIdx]);
                    remainingHistory.splice(bestIdx, 1);
                } else if (bestScore > thresholds.his) {
                    const matchedItem = remainingHistory[bestIdx];
                    
                    if (Settings.historyEditMode === 1) {
                        newFrozenSequence.push(item); 
                        timeSpacePatches.push(createMsg({role: 'system', content: `[系统提示：时空修正。之前的对话中，"${truncateLog(item.content, 20)}" 实际上已发生改变，最新情况为："${matchedItem.content}"]`}, 'SYS'));
                        remainingHistory.splice(bestIdx, 1);
                        Logger.debug(`[🛡️ 时空补丁] 拦截了历史修改，已生成底部修正补丁以保住 100% 缓存。`);
                    } else if (Settings.historyEditMode === 2) {
                        newFrozenSequence.push(item); 
                        remainingHistory.splice(bestIdx, 1);
                        Logger.debug(`[🛡️ 幻象隐藏] 拦截了历史修改，强行使用旧版以保住 100% 缓存。`);
                    } else {
                        newFrozenSequence.push(matchedItem); 
                        remainingHistory.splice(bestIdx, 1);
                        Logger.debug(`[历史记录-原位同步] -> ${truncateLog(matchedItem.content)}`);
                    }
                } else {
                    const isLastAiMessage = (i === state.frozenSequence.length - 1 && item.tag === 'AI');
                    
                    if (isLastAiMessage) {
                        Logger.debug(`[🚀 Swipe 识别] 检测到用户重新生成了最后一句回复，完美截断，保住 100% 缓存！`);
                    } else if (isContextShift && i < state.frozenSequence.length / 2) {
                        // 🐍 銜尾蛇協議：這是因為上下文太長被 ST 刪除的舊訊息，直接忽略，不觸發吃書協議
                        Logger.debug(`[🐍 衔尾蛇协议] 历史记录因超出上下文长度而自然滚动，已平滑截断: ${truncateLog(item.content)}`);
                    } else if (Settings.retconProtocol) {
                        newFrozenSequence.push(item);
                        timeSpacePatches.push(createMsg({role: 'system', content: `[系统提示：世界意志发动了记忆抹除。之前的事件 "${truncateLog(item.content, 20)}" 已被抹除，请当作从未发生过。]`}, 'SYS'));
                        Logger.debug(`[🗑️ 吃书协议] 拦截了历史删除，已生成底部抹除声明以保住 100% 缓存。`);
                    } else {
                        Logger.debug(`[原位删除] 找不到旧对话，已移除: ${truncateLog(item.content)}`);
                    }
                }
            } 
            else if (item.tag === 'SYS') {
                let bestIdx = -1, bestScore = 0;
                for (let j = 0; j < sysPool.length; j++) {
                    const score = getSimilarity(item.norm, sysPool[j].norm);
                    if (score > bestScore) { bestScore = score; bestIdx = j; }
                }
                if (bestScore === 1) { 
                    newFrozenSequence.push(sysPool[bestIdx]); 
                    sysPool.splice(bestIdx, 1); 
                } else if (bestScore > thresholds.sys) {
                    const matchedItem = sysPool[bestIdx];

                    // 🔬 納米微創手術：如果相似度極高(>0.85)，說明只是改了幾個字，提取差異作為補丁
                    if (Settings.nanoPatching && bestScore > 0.85) {
                        let addedText = extractAddedText(item.content, matchedItem.content);
                        if (addedText) {
                            newFrozenSequence.push(item); // 保留舊的龐大節點
                            timeSpacePatches.push(createMsg({role: 'system', content: `[系统提示：设定微调补充。新增细节：${addedText}]`}, 'SYS'));
                            sysPool.splice(bestIdx, 1);
                            Logger.debug(`[🔬 纳米微创] 拦截了大型设定的微小修改，已提取差异生成纳米补丁以保住 100% 缓存。`);
                            continue;
                        }
                    }

                    // 🔥 角色卡熱更新
                    if (Settings.hotReloadPersona && i === 0 && !hasSeenHistory) {
                        newFrozenSequence.push(item); 
                        timeSpacePatches.push(createMsg({role: 'system', content: `[系统提示：角色设定已热更新，最新特征如下：\n${matchedItem.content}]`}, 'SYS'));
                        sysPool.splice(bestIdx, 1);
                        Logger.debug(`[🔥 设定热更新] 拦截了主提示词/角色卡修改，已生成底部热更新补丁以保住 100% 缓存。`);
                    }
                    else if (Settings.dynamicMode === 1) { 
                        if (!hasSeenHistory) {
                            oldSnapshotsToMove.push(item);
                            Logger.debug(`[动态提示词-写日记模式] 发现置顶快照，准备下沉至旧历史尾部: ${truncateLog(item.content)}`);
                        } else {
                            newFrozenSequence.push(item);
                            Logger.debug(`[动态提示词-写日记模式] 冻结历史快照: ${truncateLog(item.content)}`);
                        }
                    } else {
                        sysPool.splice(bestIdx, 1);

                        if (Settings.dynamicMode === 2) { 
                            dynamicPromptsToSink.push(matchedItem);
                            Logger.debug(`[动态提示词-垫底模式] 已抽离并准备移至尾部: ${truncateLog(matchedItem.content)}`);
                        } else if (Settings.dynamicMode === 3) { 
                            if (!hasSeenHistory) {
                                oldSnapshotsToMove.push(item);
                                Logger.debug(`[动态提示词-假装没看见] 发现置顶旧版，准备下沉至旧历史尾部: ${truncateLog(item.content)}`);
                            } else {
                                newFrozenSequence.push(item);
                                Logger.debug(`[动态提示词-假装没看见] 强制冻结旧版: ${truncateLog(item.content)}`);
                            }
                        } else if (Settings.dynamicMode === 4) { 
                            newFrozenSequence.push(matchedItem);
                            Logger.debug(`[动态提示词-原位替换] -> ${truncateLog(matchedItem.content)}`);
                        } else if (Settings.dynamicMode === 5) { 
                            Logger.debug(`[动态提示词-直接删掉] 已移除: ${truncateLog(item.content)}`);
                        }
                    }
                } else {
                    // 👻 世界書幽靈錨點
                    if (Settings.lorebookSink && hasSeenHistory) {
                        newFrozenSequence.push(item);
                        Logger.debug(`[👻 世界书幽灵锚点] 发现不再触发的旧设定，已将其永久冻结在历史中以保住 100% 缓存: ${truncateLog(item.content)}`);
                    } else {
                        Logger.debug(`[原位删除] 已移除旧提示词: ${truncateLog(item.content)}`);
                    }
                }
            }
        }

        // 將置頂的舊快照下沉到舊歷史的尾部
        for (let snap of oldSnapshotsToMove) {
            newFrozenSequence.push(snap);
            Logger.debug(`[动态提示词-时序修正] 已将置顶旧提示词下沉至旧历史尾部: ${truncateLog(snap.content)}`);
        }

        // ---------------------------------------------------------
        // 階段 3：嚴格排序追加 (包含閃回插入協議)
        // ---------------------------------------------------------
        if (state.frozenSequence.length === 0) {
            for (let sys of sysPool) {
                newFrozenSequence.push(sys);
                Logger.debug(`[首次建档] 提示词/设定: ${truncateLog(sys.content)}`);
            }
            for (let h of remainingHistory) {
                newFrozenSequence.push(h);
                Logger.debug(`[首次建档] 历史对话: ${truncateLog(h.content)}`);
            }
        } else {
            for (let h of remainingHistory) {
                // ⏪ 閃回插入協議
                if (Settings.flashbackInsertion && hasSeenHistory && remainingHistory.length > 1) {
                    timeSpacePatches.push(createMsg({role: 'system', content: `[系统提示：闪回补充。在之前的事件中，还发生了以下细节：\n${h.content}]`}, 'SYS'));
                    Logger.debug(`[⏪ 闪回插入] 拦截了中途插入的对话，已生成底部闪回补丁以保住 100% 缓存: ${truncateLog(h.content)}`);
                } else {
                    newFrozenSequence.push(h);
                    Logger.debug(`[追加至尾部] 新历史对话: ${truncateLog(h.content)}`);
                }
            }
            
            for (let sys of sysPool) {
                if (Settings.lorebookSink) {
                    dynamicPromptsToSink.push(sys);
                    Logger.debug(`[🛡️ 设定绝对沉底] 发现新设定/世界书/作者备注，强制移至最底部以保住缓存: ${truncateLog(sys.content)}`);
                } else {
                    newFrozenSequence.push(sys);
                    Logger.debug(`[追加至尾部] 新增设定/世界书/动态快照: ${truncateLog(sys.content)}`);
                }
            }
        }

        // 追加所有需要沉底的內容 (修復：不再合併補丁，確保補丁本身的快取不被破壞)
        for (let dp of dynamicPromptsToSink) {
            newFrozenSequence.push(dp);
            Logger.debug(`[追加至尾部] 垫底内容: ${truncateLog(dp.content)}`);
        }
        for (let patch of timeSpacePatches) {
            newFrozenSequence.push(patch);
            Logger.debug(`[追加至尾部] 时空修正/吃书补丁: ${truncateLog(patch.content)}`);
        }

        // ---------------------------------------------------------
        // 階段 4：去重與組裝
        // ---------------------------------------------------------
        let dedupedSequence = [];
        const seenSysNorms = new Set();
        for (const item of newFrozenSequence) {
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
            Logger.debug(`[最终排序发送阵列] 总节点数: ${proposedStream.length}`);
            proposedStream.forEach((m, idx) => Logger.debug(`  [${idx}] ${m.role} (${m.content?.length || 0}字): ${truncateLog(m.content, 30)}`));
        }

        // ==========================================
        // 5. 精準流失率演算法與自適應大幅度修改偵測
        // ==========================================
        let requireResetConfirm = false;
        let dropPercentStr = "0.0";
        let mapInfoText = "无变更";
        let causeText = "修改了内容";
        let justSetDynamicMode = (needsAsk === true); 

        if (state.lastSentSequence && state.lastSentSequence.length > 0) {
            const L = state.lastSentSequence;
            const P = proposedStream;

            let breakIndex = -1;
            for (let i = 0; i < Math.min(L.length, P.length); i++) {
                if (L[i].role !== P[i].role || L[i].norm !== P[i].norm) { breakIndex = i; break; }
            }
            if (breakIndex === -1) breakIndex = Math.min(L.length, P.length);

            let preservedLen = 0;
            let recomputeLen = 0;
            for (let i = 0; i < P.length; i++) {
                let len = P[i].content?.length || 0;
                if (i < breakIndex) preservedLen += len;
                else recomputeLen += len;
            }

            let totalLen = preservedLen + recomputeLen;
            let recomputeRatio = 0;
            
            if (breakIndex === L.length) {
                recomputeRatio = 0; 
            } else {
                recomputeRatio = totalLen === 0 ? 0 : (recomputeLen / totalLen);
            }
            
            // 🐍 銜尾蛇協議：如果是上下文滾動導致的斷裂，不彈出警告
            if (recomputeRatio >= 0.10 && Settings.showResetPrompt && !justSetDynamicMode && !isContextShift) {
                requireResetConfirm = true;
                dropPercentStr = (recomputeRatio * 100).toFixed(1);
                
                if (P[breakIndex]?.tag === 'SYS' || L[breakIndex]?.tag === 'SYS') {
                    causeText = "大幅修改或删除了【设定 / 世界书 / 预设提示词】";
                } else {
                    causeText = "修改或删除了【历史聊天记录】";
                }
                
                const tagHtml = `<span class="ds-tag ds-tag-${P[breakIndex]?.tag || L[breakIndex]?.tag}">[${P[breakIndex]?.tag || L[breakIndex]?.tag}]</span>`;
                const oldContent = escapeHtml(L[breakIndex]?.content || '∅').substring(0, 100).replace(/\n/g, ' ↵ ');
                const newContent = escapeHtml(P[breakIndex]?.content || '∅').substring(0, 100).replace(/\n/g, ' ↵ ');
                
                // 引入 Token 估算 (字元數 / 3.5) 讓 UI 更專業
                const preservedTokens = Math.floor(preservedLen / 3.5);
                const recomputeTokens = Math.floor(recomputeLen / 3.5);

                mapInfoText = `
                    <div style="margin-bottom:10px; display:flex; align-items:center; gap:8px;">
                        <span style="color:var(--ds-cyan);"><i class="fa-solid fa-location-crosshairs"></i> 缓存断裂点位置:</span> <b>[索引 ${breakIndex}]</b> ${tagHtml}
                    </div>
                    <div class="ds-diff-del"><i class="fa-solid fa-minus"></i> 原内容: ${oldContent}...</div>
                    <div class="ds-diff-add"><i class="fa-solid fa-plus"></i> 新内容: ${newContent}...</div>
                    <div style="margin-top:12px; font-size: 12px; color:var(--ds-green); background:rgba(0,0,0,0.3); padding:8px; border-radius:6px;">
                        ✅ 断点前(保持冻结): 约 ${preservedTokens} Tokens <br>
                        ⚠️ 断点后(必须重算): <span style="color:var(--ds-red); font-weight:bold;">约 ${recomputeTokens} Tokens</span>
                    </div>
                `;
            } else if (isContextShift) {
                Logger.warn(`[🐍 衔尾蛇协议] 上下文已达上限，最旧的记忆被抹除。缓存将自然重组，不打扰用户。`);
                if (typeof toastr !== 'undefined' && !Settings.zenMode) toastr.info("上下文已达上限，最旧的记忆已滚动，缓存将自然重组。", "量子缓存");
            }
        }

        let decision = 'accept';
        setTopBarStatus('#00ff00', '缓存: 健康');

        if (requireResetConfirm) {
            setTopBarStatus('#e5c07b', `缓存: 等待确认`);
            if (Settings.autoAccept) {
                Logger.warn(`[自动修复] 已放行断层重组 (需重算 ${dropPercentStr}%)`);
                if (!Settings.zenMode && typeof toastr !== 'undefined') toastr.info(`已自动修复后台顺序 (需重算 ${dropPercentStr}%)`, "量子缓存");
                decision = 'accept';
            } else {
                decision = await askUserForResetAsync(dropPercentStr, mapInfoText, causeText);
            }
        }

        // 雙重物理級絕對攔截
        if (decision === 'abort') {
            Logger.error('[物理拦截] 已拦截本次发送，强制中止生成。', null, LogLevels.BASIC);
            setTopBarStatus('#e06c75', '缓存: 已拦截发送');
            if (typeof toastr !== 'undefined') toastr.error("已拦截发送！对话已中止。", "量子缓存");
            
            data.chat.length = 0; 
            data.chat.push({ role: "invalid_abort_role", content: "ABORT_GENERATION" });
            
            setTimeout(() => {
                if (typeof StopGenerating === 'function') StopGenerating();
                const stopBtn = document.getElementById('stop_generating_button') || document.getElementById('send_but');
                if (stopBtn) stopBtn.click();
            }, 10);
            
            throw new Error("Generation aborted by DeepSeek Cache Optimizer."); 
        }

        if (decision === 'revert') {
            Logger.warn('[时空回溯] 用户选择无视本次修改，强行使用旧版缓存。');
            setTopBarStatus('#c678dd', '缓存: 强行冻结旧版');
            
            const finalStream = [...state.frozenSequence];
            if (currentTurn.user) finalStream.push(currentTurn.user);
            for (const p of currentTurn.prefills) finalStream.push(p);

            state.lastSentSequence = finalStream;
            safeSave();

            stream.splice(0, stream.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
            if (typeof toastr !== 'undefined') toastr.success("已强行使用旧版内容发送，保住100%缓存！", "量子缓存");
            return;
        }

        if (decision === 'bypass') {
            Logger.warn('[临时放行] 用户选择跳过本次优化，按 ST 原样乱序发送。');
            setTopBarStatus('#e5c07b', '缓存: 临时放行');
            return; 
        }

        if (decision === 'force_reset') {
            Logger.error('[撕书重来] 用户选择清空当前缓存，一切重新开始。');
            delete Settings.chats[chatKeyInfo.key];
            safeSave();
            setTopBarStatus('#00e5ff', '缓存: 已撕书重来');
            return; 
        }

        if (decision === 'accept') {
            state.frozenSequence = dedupedSequence;
            state.lastPrefills = currentTurn.prefills;

            const finalStream = [...state.frozenSequence];
            if (currentTurn.user) finalStream.push(currentTurn.user);
            for (const p of currentTurn.prefills) finalStream.push(p);

            state.lastSentSequence = finalStream;
            
            // 🌌 平行宇宙協議：儲存當前時間線到多重宇宙樹中 (最多保留 5 個分支)
            if (Settings.multiverseProtocol) {
                if (!state.multiverse) state.multiverse = [];
                state.multiverse.unshift([...state.frozenSequence]);
                if (state.multiverse.length > 5) state.multiverse.pop();
            }

            safeSave();

            if (Settings.autoPinThreshold > 0 && finalStream.length >= Settings.autoPinThreshold) {
                if (!Settings.pinnedChats[chatKeyInfo.key]) {
                    Settings.pinnedChats[chatKeyInfo.key] = true;
                    safeSave();
                    Logger.map(`[自动保护] 节点数(${finalStream.length})达标，已锁定当前存档。`);
                }
            }

            stream.splice(0, stream.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
            Logger.log(`✅ 排序完成，拦截器授权发送。耗时: ${(performance.now() - startTime).toFixed(2)}ms`, LogLevels.BASIC);
        }

    } catch (err) {
        if (err.message === "Generation aborted by DeepSeek Cache Optimizer.") throw err; 
        setTopBarStatus('#e06c75', '缓存: 发生崩溃');
        Logger.error('核心运算崩溃', err);
        throw err;
    }
}

// ==========================================
// 8. UI 面板與高階事件綁定 (Quantum UI)
// ==========================================
function renderChatsUI() {
    const container = $('#ds-chat-list-container');
    if (container.length === 0) return;
    container.empty();
    
    $('#ds-storage-badge').text(calculateExactStorage(Settings.chats));

    const keys = Object.keys(Settings.chats);
    if (keys.length === 0) {
        container.append('<div style="font-size:13px; opacity:0.5; padding:20px; text-align:center; font-style:italic;">记忆矩阵为空</div>');
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

        const pinColor = isPinned ? 'var(--ds-yellow)' : 'rgba(255,255,255,0.2)';
        const html = `
            <div class="ds-chat-item ${isActive ? 'active-chat' : ''}" title="${isActive ? '这是您当前的对话' : ''}">
                <div style="display:flex; flex-direction:column; overflow:hidden; width:70%;">
                    <span style="font-size:13px; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:${isActive?'var(--ds-cyan)':'#e5e5e5'}; text-shadow:${isActive?'0 0 8px rgba(0,229,255,0.4)':'none'};">${isActive ? '🟢 ' : ''}${escapeHtml(chat.label)}</span>
                    <div style="display:flex; gap:12px; font-size:11px; margin-top:6px;">
                        <span style="color:var(--ds-green); background:rgba(152,195,121,0.1); padding:2px 6px; border-radius:4px;">节点: ${count}</span>
                        <span style="color:#5c6370; display:flex; align-items:center; gap:4px;"><i class="fa-regular fa-clock"></i> ${timeStr}</span>
                    </div>
                </div>
                <div class="ds-action-group" style="display:flex; gap:6px;">
                    <button class="menu_button interactable ds-pin-btn" data-key="${key}" style="font-size:13px; padding:6px 10px; border-radius:6px; color:${pinColor}; background:rgba(255,255,255,0.05);" title="${isPinned ? '取消保护' : '锁定保护(免被系统当垃圾清理)'}">
                        <span class="fa-solid fa-thumbtack"></span>
                    </button>
                    <button class="menu_button interactable ds-reset-btn" data-key="${key}" style="font-size:13px; padding:6px 10px; border-radius:6px; color:var(--ds-red); background:rgba(224,108,117,0.05);" title="删除此存档">
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
        <div class="inline-drawer" id="ds-v36-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header" style="background: linear-gradient(90deg, rgba(0,229,255,0.1) 0%, rgba(0,0,0,0) 100%); border-left: 3px solid var(--ds-cyan);">
                <b style="color:var(--ds-cyan); text-shadow: 0 0 8px rgba(0,229,255,0.3);"><span class="fa-solid fa-microchip"></span> DeepSeek 平行宇宙优化器 (v36)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down" style="color:var(--ds-cyan);"></div>
            </div>
            <div class="inline-drawer-content ds-scroll" style="padding:18px; background: rgba(0,0,0,0.2);">
                
                <!-- 1. 核心开关 -->
                <div class="ds-opt-group open">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-rocket"></i> 1. 核心引擎 (必看)</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div class="ds-row">
                            <label class="ds-row-left" style="color:var(--ds-cyan); font-size:14px;"><input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}> <b style="color:var(--ds-cyan); text-shadow:0 0 5px rgba(0,229,255,0.4);">启动平行宇宙引擎</b><br><span style="font-size:11px; color:#abb2bf; font-weight:normal;">(核心功能！让回复变秒回，大幅节省 Token 和 API 费用)</span></label>
                        </div>
                        <hr style="border:0; border-top:1px dashed rgba(255,255,255,0.1); width:100%; margin:4px 0;">
                        <div class="ds-row"><label class="ds-row-left" style="color:var(--ds-purple);"><input type="checkbox" id="ds-cache-zen" ${Settings.zenMode ? 'checked' : ''}> <b>沉浸免打扰模式</b><br><span style="font-size:11px; color:#abb2bf; font-weight:normal;">(隐藏所有屏幕右上角的烦人黑色提示框，专心看故事)</span></label></div>
                        <div class="ds-row"><label class="ds-row-left" style="color:var(--ds-green);"><input type="checkbox" id="ds-cache-hotkeys" ${Settings.hotkeysEnabled ? 'checked' : ''}> <b>启用键盘快捷键</b><br><span style="font-size:11px; color:#abb2bf; font-weight:normal;">(Ctrl+Alt+C 开关缓存 / R 撕书重来 / Z 免打扰)</span></label></div>
                    </div>
                </div>

                <!-- 2. 100% 缓存防御盾 -->
                <div class="ds-opt-group open">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-shield-halved"></i> 2. 绝对领域防御盾 (100% Cache)</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <p style="font-size:12px; color:#abb2bf; margin:0; line-height:1.6; background:rgba(0,0,0,0.3); padding:10px; border-radius:6px; border-left:3px solid var(--ds-cyan);">开启以下功能，即使你在聊天中途触发了世界书，或者往回修改、删除了旧对话，系统也能帮你<b style="color:var(--ds-cyan);">保住 100% 的缓存</b>！</p>
                        
                        <div class="ds-row" style="margin-top:5px;">
                            <label class="ds-row-left" style="color:var(--ds-purple);"><input type="checkbox" id="ds-cache-multiverse" ${Settings.multiverseProtocol ? 'checked' : ''}> <b>🌌 平行宇宙协议 (分支/撤销不破缓存)</b><br><span style="font-size:11px; color:#abb2bf; font-weight:normal;">(当你切换分支或疯狂撤销时，系统会自动跳跃到最匹配的平行宇宙，保住最大缓存)</span></label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left" style="color:var(--ds-green);"><input type="checkbox" id="ds-cache-nanopatch" ${Settings.nanoPatching ? 'checked' : ''}> <b>🔬 纳米微创手术 (微小修改不破缓存)</b><br><span style="font-size:11px; color:#abb2bf; font-weight:normal;">(当你只修改了超大角色卡里的几个字，系统会提取差异做成纳米补丁，不重算整个卡)</span></label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left" style="color:var(--ds-yellow);"><input type="checkbox" id="ds-cache-lorebook-sink" ${Settings.lorebookSink ? 'checked' : ''}> <b>世界书/作者备注绝对沉底</b><br><span style="font-size:11px; color:#abb2bf; font-weight:normal;">(当聊天中途触发新设定或A/N时，强制把它塞到最下面，防止破坏上方缓存)</span></label>
                        </div>
                        
                        <div class="ds-row">
                            <label class="ds-row-left" style="color:#ff8c94;"><input type="checkbox" id="ds-cache-retcon" ${Settings.retconProtocol ? 'checked' : ''}> <b>吃书协议 (删除对话不破缓存)</b><br><span style="font-size:11px; color:#abb2bf; font-weight:normal;">(当你删除了旧对话，系统会保留它，并在底部告诉AI「刚才那件事被抹除了」)</span></label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left" style="color:#ffb86c;"><input type="checkbox" id="ds-cache-hotreload" ${Settings.hotReloadPersona ? 'checked' : ''}> <b>🔥 角色卡热更新 (修改设定不破缓存)</b><br><span style="font-size:11px; color:#abb2bf; font-weight:normal;">(当你修改了角色卡，系统会冻结旧卡，并在底部告诉AI「角色设定已更新」)</span></label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left" style="color:#8be9fd;"><input type="checkbox" id="ds-cache-flashback" ${Settings.flashbackInsertion ? 'checked' : ''}> <b>⏪ 闪回插入协议 (中间插话不破缓存)</b><br><span style="font-size:11px; color:#abb2bf; font-weight:normal;">(当你在历史中间插入新对话，系统会把它抽到底部，告诉AI「这是闪回补充」)</span></label>
                        </div>
                        
                        <div class="ds-row" style="flex-direction:column; align-items:flex-start; gap:8px; background:rgba(0,0,0,0.3); padding:12px; border-radius:8px; border: 1px solid rgba(255,255,255,0.05);">
                            <span style="font-size:13px; color:var(--ds-yellow); font-weight:bold;">当我修改了以前的旧对话时，系统该怎么做？</span>
                            <select id="ds-cache-history-mode" class="ds-select-styled" style="width:100%;">
                                <option value="1" ${Settings.historyEditMode===1?'selected':''}>🛡️ 方案 A：时空补丁 (强烈推荐！保住100%缓存，且AI知道你改了)</option>
                                <option value="2" ${Settings.historyEditMode===2?'selected':''}>🙈 方案 B：幻象隐藏 (保住100%缓存，但AI不知道你改了)</option>
                                <option value="0" ${Settings.historyEditMode===0?'selected':''}>💥 方案 C：真实修改 (极度不推荐！会破坏大量缓存，烧钱重算)</option>
                            </select>
                            <span style="font-size:11px; color:#abb2bf; margin-top:2px;">*选择「时空补丁」时，系统会保留旧对话，并在最底部偷偷塞一张纸条告诉AI你修改了什么。</span>
                        </div>
                    </div>
                </div>

                <!-- 3. 动态提示词诊断中心 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-stethoscope"></i> 3. 缓存杀手体检中心</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <p style="font-size:12px; color:#abb2bf; margin:0; line-height:1.5;">如果你的缓存命中率一直很低，可能是因为预设中包含了每次都会改变的变量（如时间、天气）。点击下方按钮进行体检。</p>
                        <button id="ds-btn-diagnostic" class="ds-btn ds-btn-blue" style="padding:12px; justify-content:center; border-radius:8px;"><i class="fa-solid fa-magnifying-glass"></i> 扫描当前对话的「缓存杀手」</button>
                        <hr style="border:0; border-top:1px dashed rgba(255,255,255,0.1); width:100%; margin:4px 0;">
                        <div class="ds-row" style="flex-direction:column; align-items:flex-start; gap:8px;">
                            <span style="font-size:13px; color:#abb2bf;">当系统抓到「缓存杀手」时，自动处理方式：</span>
                            <select id="ds-cache-dynamic-mode" class="ds-select-styled" style="width:100%;">
                                <option value="0" ${Settings.dynamicMode===0?'selected':''}>0: 首次弹窗询问我</option>
                                <option value="1" ${Settings.dynamicMode===1?'selected':''}>1: 写日记模式 (强烈推荐！100%缓存)</option>
                                <option value="2" ${Settings.dynamicMode===2?'selected':''}>2: 垫底模式 (99%缓存)</option>
                                <option value="3" ${Settings.dynamicMode===3?'selected':''}>3: 假装没看见 (100%缓存)</option>
                                <option value="4" ${Settings.dynamicMode===4?'selected':''}>4: 原位替换 (极度不推荐！烧钱)</option>
                                <option value="5" ${Settings.dynamicMode===5?'selected':''}>5: 直接删掉</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- 4. 弹窗与提醒 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-bell"></i> 4. 弹窗与提醒设置</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-toast-his" ${Settings.toastHistory ? 'checked' : ''}> 当我修改或删除旧对话时，在右上角提醒我</label></div>
                        <div class="ds-row"><label class="ds-row-left" style="color:var(--ds-red);"><input type="checkbox" id="ds-toast-reset" ${Settings.showResetPrompt ? 'checked' : ''}> 当发送可能导致大量缓存失效时，弹出全屏警告窗口</label></div>
                        <div class="ds-row"><label class="ds-row-left" style="color:var(--ds-yellow);"><input type="checkbox" id="ds-cache-auto-accept" ${Settings.autoAccept ? 'checked' : ''}> <b>自动修复缓存断层</b><br><span style="font-size:11px; color:#abb2bf; font-weight:normal;">(遇到冲突时，不弹全屏警告，直接在后台默默修复并发送)</span></label></div>
                    </div>
                </div>
                
                <!-- 5. 极客高级设置 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-gears"></i> 5. 极客高级设置 (小白勿动)</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div class="ds-row">
                            <span style="font-size:13px; color:#abb2bf;" title="对比旧文本与新文本的严格程度">找茬严格度:</span>
                            <select id="ds-cache-tolerance" class="ds-select-styled" style="width:150px;">
                                <option value="0" ${Settings.tolerance===0?'selected':''}>严格 (推荐)</option>
                                <option value="1" ${Settings.tolerance===1?'selected':''}>标准</option>
                                <option value="2" ${Settings.tolerance===2?'selected':''}>宽松</option>
                            </select>
                        </div>
                        <div class="ds-row">
                            <span style="font-size:13px; color:#abb2bf;">日志详细度:</span>
                            <select id="ds-cache-loglevel" class="ds-select-styled" style="width:150px;">
                                <option value="0" ${Settings.logLevel===0?'selected':''}>0: 关闭</option>
                                <option value="1" ${Settings.logLevel===1?'selected':''}>1: 基础</option>
                                <option value="2" ${Settings.logLevel===2?'selected':''}>2: 详细</option>
                                <option value="3" ${Settings.logLevel===3?'selected':''}>3: 极客模式</option>
                            </select>
                        </div>
                        <div class="ds-row">
                            <span style="font-size:13px; color:#abb2bf;">历史存档保留上限:</span>
                            <input type="number" id="ds-cache-maxsize" class="ds-select-styled" value="${Settings.maxCacheSize}" min="5" max="100" style="width:150px; text-align:center;">
                        </div>
                        <div class="ds-row">
                            <span style="font-size:13px; color:#abb2bf;">📌 自动锁定保护阈值:</span>
                            <input type="number" id="ds-cache-autopin" class="ds-select-styled" value="${Settings.autoPinThreshold}" min="0" max="999" title="当某个对话的节点数超过此数字，将自动钉选保护它免被系统清理。填0关闭。" style="width:150px; text-align:center;">
                        </div>
                        <div class="ds-row" style="margin-top:15px;">
                            <button id="ds-btn-export" class="menu_button interactable" style="flex:1; padding:10px; font-size:12px; border-radius:6px; background:rgba(255,255,255,0.05);"><i class="fa-solid fa-download"></i> 备份设置</button>
                            <button id="ds-btn-import" class="menu_button interactable" style="flex:1; padding:10px; font-size:12px; border-radius:6px; background:rgba(255,255,255,0.05);"><i class="fa-solid fa-upload"></i> 恢复设置</button>
                            <input type="file" id="ds-file-import" style="display:none;" accept=".json">
                        </div>
                    </div>
                </div>

                <!-- 6. 存档管理与日志 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-database"></i> 6. 记忆矩阵与终端 <span id="ds-storage-badge" class="ds-badge">...</span></span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div id="ds-chat-list-container" class="ds-chat-container ds-scroll"></div>
                        <div class="ds-row">
                            <button id="ds-btn-deep-clean" class="menu_button" style="flex:1; font-size:12px; color:var(--ds-yellow); border:1px solid rgba(229,192,123,0.3); background:rgba(229,192,123,0.05); justify-content:center; padding:10px; border-radius:6px;" title="清理所有没被锁定，且超过30天没玩过的旧存档">🧹 深度清理垃圾</button>
                            <button id="ds-cache-factory-reset" class="menu_button" style="flex:1; font-size:12px; color:var(--ds-red); border:1px solid rgba(224,108,117,0.3); background:rgba(224,108,117,0.05); justify-content:center; padding:10px; border-radius:6px;" title="删掉所有记录，一切重来">💀 格式化全部</button>
                        </div>
                        
                        <hr style="border:0; border-top:1px dashed rgba(255,255,255,0.1); width:100%; margin:15px 0;">
                        
                        <div class="ds-log-toolbar">
                            <span class="ds-log-filter active" data-filter="all">全部</span>
                            <span class="ds-log-filter" data-filter="info">常规</span>
                            <span class="ds-log-filter" data-filter="warn">警告</span>
                            <span class="ds-log-filter" data-filter="debug">除错</span>
                            <span class="ds-log-filter" data-filter="error">报错</span>
                            <div style="flex:1;"></div>
                            <span id="ds-btn-copylog" class="ds-mini-btn" title="复制所有日志" style="color:var(--ds-cyan); margin-right:12px; cursor:pointer; font-size:15px; transition:0.2s;"><i class="fa-solid fa-copy"></i></span>
                            <span id="ds-btn-clearlog" class="ds-mini-btn" title="清空日志文字" style="color:var(--ds-red); cursor:pointer; font-size:15px; transition:0.2s;"><i class="fa-solid fa-trash"></i></span>
                        </div>
                        <div id="ds-cache-log-container" class="ds-log-terminal ds-scroll"></div>
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
        $('#ds-cache-dynamic-mode').on('change', function () { Settings.dynamicMode = parseInt($(this).val()); safeSave(); });
        
        // 新增事件綁定
        $('#ds-cache-history-mode').on('change', function () { Settings.historyEditMode = parseInt($(this).val()); safeSave(); });
        $('#ds-cache-lorebook-sink').on('change', function () { Settings.lorebookSink = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-retcon').on('change', function () { Settings.retconProtocol = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-hotreload').on('change', function () { Settings.hotReloadPersona = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-flashback').on('change', function () { Settings.flashbackInsertion = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-multiverse').on('change', function () { Settings.multiverseProtocol = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-nanopatch').on('change', function () { Settings.nanoPatching = $(this).is(':checked'); safeSave(); });

        $('#ds-btn-diagnostic').on('click', showDiagnosticCenter);

        $('#ds-cache-factory-reset').on('click', () => { if (confirm("💀 危险操作：确定要删除所有的缓存存档吗？一切将从零开始！")) { Settings.chats = {}; Settings.pinnedChats = {}; safeSave(); renderChatsUI(); } });
        
        $('#ds-btn-deep-clean').on('click', () => {
            if(!confirm("🧹 这会删掉所有未被锁定，且【没有节点内容】或【超过30天没聊过】的旧缓存。确定执行吗？")) return;
            let count = 0; const now = Date.now();
            for (let k in Settings.chats) {
                if (Settings.pinnedChats[k]) continue;
                const chat = Settings.chats[k];
                const isEmpty = !chat.frozenSequence || chat.frozenSequence.length === 0;
                const isOld = chat.lastAccessed && (now - chat.lastAccessed > 30 * 24 * 60 * 60 * 1000);
                if (isEmpty || isOld) { delete Settings.chats[k]; count++; }
            }
            safeSave(); renderChatsUI();
            if (typeof toastr !== 'undefined') toastr.success(`🧹 垃圾清理完毕！共移除了 ${count} 个无用的旧存档。`);
        });
        
        $('.ds-log-filter').on('click', function() {
            $('.ds-log-filter').removeClass('active'); $(this).addClass('active'); const f = $(this).data('filter');
            $('#ds-cache-log-container .ds-log-line').each(function() {
                if (f === 'all' || $(this).data('type') === f || $(this).data('type') === 'divider') $(this).removeClass('hide'); else $(this).addClass('hide');
            });
        });
        
        $('#ds-btn-clearlog').on('click', () => { $('#ds-cache-log-container').empty(); });
        
        $('#ds-btn-copylog').on('click', () => {
            const text = Array.from(document.querySelectorAll('#ds-cache-log-container .ds-log-line')).map(el => el.innerText).join('\n');
            navigator.clipboard.writeText(text).then(() => { if(typeof toastr !== 'undefined') toastr.success("📋 日志已复制到剪贴板！"); });
        });

        $('#ds-btn-exportlog').on('click', () => {
            const text = Array.from(document.querySelectorAll('#ds-cache-log-container .ds-log-line')).map(el => el.innerText).join('\n');
            const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob); const a = document.createElement("a");
            a.href = url; a.download = `DeepSeek_Cache_Log_${new Date().getTime()}.txt`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        });

        $('#ds-btn-export').on('click', () => {
            const blob = new Blob([JSON.stringify(Settings, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob); const a = document.createElement("a");
            a.href = url; a.download = `DeepSeek_Cache_Backup_v36_${new Date().getTime()}.json`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
            if (typeof toastr !== 'undefined') toastr.success("💾 备份文件已导出！");
        });
        $('#ds-btn-import').on('click', () => $('#ds-file-import').click());
        $('#ds-file-import').on('change', function(e) {
            const f = e.target.files[0]; if(!f) return;
            const r = new FileReader();
            r.onload = (ev) => {
                try { Object.assign(Settings, JSON.parse(ev.target.result)); safeSave(); renderChatsUI(); updateTopBarState(); alert("✅ 恢复成功！"); } 
                catch (err) { alert("❌ 文件格式错误"); }
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
        
        setTimeout(() => { ensureTopMenuButton(); }, 2000);
        addResetMenuEntry(); 
        
        if (eventSource) {
            eventSource.on(event_types.CHAT_CHANGED, () => { ensureTopMenuButton(); renderChatsUI(); });
            if (event_types?.CHAT_COMPLETION_PROMPT_READY) eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
            
            if (event_types?.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, () => triggerWarningImmediate('his_del', '您删除了历史对话，已标记断层！下次发送将原位修补。', Settings.toastHistory));
            if (event_types?.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, () => triggerWarningImmediate('his_edit', '您修改了历史对话，已标记断层！下次发送将原位修补。', Settings.toastHistory));
        }

        Logger.log('══════ 🚀 DeepSeek 平行宇宙优化器 v36 引擎上线 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件启动失败:', e);
    }
});
