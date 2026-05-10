import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 1. 樣式注入 (全強制水平排版與小白友善模組化)
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
        .ds-row-left { display: flex; flex-direction: row; justify-content: flex-start; align-items: center; gap: 8px; cursor: pointer; color: #abb2bf; font-size: 0.9em; flex: 1; }
        .ds-row-left input[type="checkbox"], .ds-row-left input[type="radio"] { margin: 0; cursor: pointer; }
        
        .ds-lab-box { background: rgba(0,229,255,0.05); border: 1px solid rgba(0,229,255,0.2); padding: 10px; border-radius: 6px; }
        .ds-lab-title { color: #00e5ff; font-weight: bold; margin-bottom: 8px; display: flex; align-items: center; gap: 5px; font-size: 14px; }
        .ds-radio-group { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
        .ds-radio-item { display: flex; align-items: flex-start; gap: 8px; padding: 6px; background: rgba(0,0,0,0.2); border-radius: 4px; border: 1px solid rgba(255,255,255,0.05); transition: 0.2s; }
        .ds-radio-item:hover { background: rgba(255,255,255,0.1); }
        .ds-radio-text { display: flex; flex-direction: column; }
        .ds-radio-text strong { color: #e5c07b; font-size: 13px; margin-bottom: 2px; }
        .ds-radio-text span { color: #abb2bf; font-size: 11px; line-height: 1.3; }

        .ds-log-toolbar { display: flex; gap: 5px; margin-bottom: 5px; flex-wrap: wrap; }
        .ds-log-filter { cursor: pointer; padding: 2px 8px; border-radius: 12px; font-size: 10px; background: rgba(255,255,255,0.1); color: #abb2bf; transition: 0.2s; }
        .ds-log-filter.active { background: #56b6c2; color: #121212; font-weight: bold; }
        .ds-log-filter:hover:not(.active) { background: rgba(255,255,255,0.2); }
        .ds-log-terminal { background: var(--black50a, #0a0a0a); color: var(--SmartThemeBody-color, #a9b7c6); font-family: Consolas, monospace; font-size: 11px; height: 320px; overflow-y: auto; border-radius: 6px; padding: 10px; border: 1px solid var(--SmartThemeBorder-color, #333); box-shadow: inset 0 0 10px rgba(0,0,0,0.8); scroll-behavior: smooth; }
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
// 2. 狀態設定 (加入動態策略)
// ==========================================
let Settings = {};

function initSettings() {
    const oldSettings = extension_settings.ds_cache_v24 || extension_settings.ds_cache_v23 || {};
    if (!extension_settings.ds_cache_v25) {
        extension_settings.ds_cache_v25 = {
            enabled: oldSettings.enabled ?? true,
            zenMode: oldSettings.zenMode ?? false,
            toastHistory: oldSettings.toastHistory ?? true,
            showResetPrompt: oldSettings.showResetPrompt ?? true,
            autoAccept: oldSettings.autoAccept ?? false,
            logLevel: oldSettings.logLevel ?? 2,
            tolerance: oldSettings.tolerance ?? 1,
            dynamicStrategy: oldSettings.dynamicStrategy ?? 'sink', // 新增：動態提示詞修復策略
            maxCacheSize: oldSettings.maxCacheSize ?? 30,
            hotkeysEnabled: oldSettings.hotkeysEnabled ?? true,
            autoPinThreshold: oldSettings.autoPinThreshold ?? 0,
            chats: oldSettings.chats || {},
            pinnedChats: oldSettings.pinnedChats || {} 
        };
    }
    Settings = extension_settings.ds_cache_v25;
    if (!Settings.pinnedChats) Settings.pinnedChats = {};
    if (!Settings.chats) Settings.chats = {}; 
}

function safeSave() {
    try { 
        if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced(); 
        if (Math.random() < 0.1) localStorage.setItem('ds_cache_v25_snapshot', JSON.stringify(Settings));
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

function truncateLog(str, len = 50) {
    if (!str) return '∅';
    const s = String(str).replace(/\n/g, ' ↵ ');
    return s.length > len ? s.substring(0, len) + '...' : s;
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
// 4. 擴充選單原生註冊 (修復魔法棒)
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
        Settings.chats[chatKeyInfo.key] = { label: chatKeyInfo.label, frozenSequence: [], lastSentSequence: [], lastPrefills: [], lastAccessed: Date.now() };
        safeSave(); renderChatsUI();
    } else {
        Settings.chats[chatKeyInfo.key].lastAccessed = Date.now();
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
            if (!Settings.zenMode && typeof toastr !== 'undefined') toastr.info(Settings.enabled ? "缓存优化已开启" : "缓存优化已关闭", "DeepSeek");
        });
        btn.on('contextmenu', (e) => { e.preventDefault(); resetCurrentCache(); });
        if ($('ul#extensions_menu').length > 0) $('ul#extensions_menu').append(btn);
        else if ($('#right-nav-extensions').length > 0) $('#right-nav-extensions').append(btn);
    }
    updateTopBarState();
}

function registerMagicWandButton() {
    // 徹底拋棄定時器，採用原生單次註冊
    const extMenu = $('#extensions_menu');
    if (extMenu.length > 0 && $('#ds-bottom-reset-btn').length === 0) {
        const btn = $(`
            <li id="ds-bottom-reset-btn" class="menu_button interactable" title="清空当前聊天的缓存，让大模型完全重新阅读整个对话">
                <span class="fa-solid fa-broom" style="color: #e06c75;"></span> 重置当前对话缓存
            </li>
        `);
        btn.on('click', () => { 
            resetCurrentCache(); 
            if (extMenu.hasClass('open')) extMenu.removeClass('open').hide(); 
        });
        extMenu.append(btn);
    }
}

function resetCurrentCache() {
    if(!confirm("确定要清空当前对话的缓存吗？\n(这会让AI重新阅读整个对话，适合在觉得AI逻辑混乱时使用)")) return;
    const key = getChatKey().key;
    delete Settings.chats[key];
    safeSave(); renderChatsUI();
    setTopBarStatus('#00ff00', '缓存: 已重置');
    if (typeof toastr !== 'undefined') toastr.success("当前聊天缓存已重置，下次发送将重新开始建档！");
    Logger.warn(`手动清空了当前对话缓存: ${key}`);
}

// ==========================================
// 5. 核心邏輯工具
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
                if (curUser) historyTurns.push({ user: curUser, assistant: curAiContents.length ? createMsg({role: 'assistant', content: curAiContents.join('\n')}, 'AI') : null });
                curUser = msg; curAiContents = [];
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
                    <h2 class="ds-modal-title"><span class="fa-solid fa-triangle-exclamation"></span> DeepSeek 缓存命中率警告</h2>
                    <p class="ds-modal-text" style="line-height: 1.5;">
                        检测到您修改或删除了较早的文本内容。<br>
                        由于大模型的严格缓存机制，发生断点<b>之后的所有内容</b>（约 <b style="color:${progColor}">${dropPercent}%</b> 的文本）都必须重新消耗算力计算。<br>
                        系统已在后台帮您完成了无缝修补，请问要如何处理本次发送？
                    </p>
                    <div class="ds-progress-container"><div class="ds-progress-bar" id="ds-prog-bar" style="background: ${progColor};"></div></div>
                    <div class="ds-map-box">${mapInfo}</div>
                    
                    <div class="ds-btn-grid">
                        <button class="ds-btn ds-btn-accept" id="ds-btn-accept"><i class="fa-solid fa-check"></i> 同步修复并发送 (接受算力损耗)</button>
                        <button class="ds-btn ds-btn-abort" id="ds-btn-abort"><i class="fa-solid fa-ban"></i> 强制拦截发送 (让我退回去改改)</button>
                        <button class="ds-btn ds-btn-bypass" id="ds-btn-bypass" title="关闭本次的优化，完全按ST原本的乱序发送"><i class="fa-solid fa-forward"></i> 临时放行 (按原样发送)</button>
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
// 7. 完美時序與動態下沉演算法 (Dynamic Shield Algorithm)
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (!Settings.enabled || data.dryRun) return;
    const startTime = performance.now();
    const chatKeyInfo = getChatKey();

    try {
        let state = getChatState(chatKeyInfo);
        if (!data?.chat?.length) return;
        const stream = data.chat;

        const nowD = new Date();
        const timeStr = `${nowD.getFullYear()}-${String(nowD.getMonth()+1).padStart(2,'0')}-${String(nowD.getDate()).padStart(2,'0')}@${nowD.getHours()}h${nowD.getMinutes()}m${nowD.getSeconds()}s${nowD.getMilliseconds()}ms`;
        Logger.divider(`===== 启动发文拦截: ${chatKeyInfo.label.split('|')[0].trim()} | 存档: ${chatKeyInfo.label.split(':')[1]?.trim() || ''} - ${timeStr} =====`);

        if (Settings.logLevel >= LogLevels.DEBUG) {
            Logger.debug(`[ST 原始发送阵列] 总节点数: ${stream.length}`);
            stream.forEach((m, idx) => Logger.debug(`  [${idx}] ${m.role} (${m.content?.length || 0}字): ${truncateLog(m.content, 40)}`));
        }

        const { sysMsgs, historyTurns, currentTurn } = parseSTStream(stream);
        const flatHistoryPool = [];
        for(let t of historyTurns) {
            flatHistoryPool.push(t.user);
            if(t.assistant) flatHistoryPool.push(stripPrefillFromAssistant(t.assistant, state.lastPrefills));
        }

        let newFrozenSequence = [];
        let dynamicSysQueue = []; // 用於存放需要下沉的動態提示詞
        const sysPool = [...sysMsgs];
        const remainingHistory = [...flatHistoryPool];
        const thresholds = getTolerance();
        
        // 1. 原位更新與動態策略執行
        for (let i = 0; i < state.frozenSequence.length; i++) {
            const item = state.frozenSequence[i];
            if (item.tag === 'SYS') {
                let bestIdx = -1, bestScore = 0;
                for (let j = 0; j < sysPool.length; j++) {
                    const score = getSimilarity(item.norm, sysPool[j].norm);
                    if (score > bestScore) { bestScore = score; bestIdx = j; }
                }
                if (bestScore === 1) { 
                    newFrozenSequence.push(sysPool[bestIdx]); 
                    Logger.debug(`[绝对冻结] 提示词: ${truncateLog(sysPool[bestIdx].content)}`);
                    sysPool.splice(bestIdx, 1); 
                } else if (bestScore > thresholds.sys) {
                    // 偵測到動態提示詞！依據實驗室策略處理
                    const matchedItem = sysPool[bestIdx];
                    if (Settings.dynamicStrategy === 'sink') {
                        dynamicSysQueue.push(matchedItem);
                        sysPool.splice(bestIdx, 1);
                        Logger.warn(`[动态下沉] 侦测到动态变化，已抽出至底部: -> ${truncateLog(matchedItem.content, 20)}`);
                    } else if (Settings.dynamicStrategy === 'inplace') {
                        newFrozenSequence.push(matchedItem);
                        sysPool.splice(bestIdx, 1);
                        Logger.warn(`[原位同步] 侦测到动态变化，执行原位修改: -> ${truncateLog(matchedItem.content, 20)}`);
                    } else if (Settings.dynamicStrategy === 'freeze') {
                        newFrozenSequence.push(item);
                        sysPool.splice(bestIdx, 1);
                        Logger.warn(`[彻底冻结] 侦测到动态变化，已无视新文本并保持旧文本: ${truncateLog(item.content, 20)}`);
                    } else if (Settings.dynamicStrategy === 'delete') {
                        sysPool.splice(bestIdx, 1);
                        Logger.warn(`[直接删除] 侦测到动态变化，已直接移除该节点。`);
                    }
                } else {
                    Logger.debug(`[原位删除] 找不到旧提示词，已移除: ${truncateLog(item.content)}`);
                }
            } 
            else if (item.tag === 'USER' || item.tag === 'AI') {
                let bestIdx = -1, bestScore = 0;
                for (let j = 0; j < remainingHistory.length; j++) {
                    if (item.tag !== remainingHistory[j].tag) continue;
                    const score = getSimilarity(item.norm, remainingHistory[j].norm);
                    if (score > bestScore) { bestScore = score; bestIdx = j; }
                }
                // 歷史紀錄必須原位同步
                if (bestScore > thresholds.his) {
                    newFrozenSequence.push(remainingHistory[bestIdx]);
                    Logger.debug(`[原位同步/冻结] 历史对话: ${truncateLog(remainingHistory[bestIdx].content)}`);
                    remainingHistory.splice(bestIdx, 1);
                } else {
                    Logger.debug(`[原位删除] 找不到旧对话，已移除: ${truncateLog(item.content)}`);
                }
            }
        }

        // 2. 嚴格排序邏輯構建
        // 順序：原位歷史 -> 新增的提示詞 -> 歷史紀錄末端 -> 動態提示詞(下沉)
        // 注意：為了不打斷歷史對話的連續性，新增的提示詞排在新的歷史對話前面
        for (let sys of sysPool) {
            newFrozenSequence.push(sys);
            Logger.debug(`[追加至尾部] 新增设定/世界书: ${truncateLog(sys.content)}`);
        }
        for (let h of remainingHistory) {
            newFrozenSequence.push(h);
            Logger.debug(`[追加至尾部] 新历史对话: ${truncateLog(h.content)}`);
        }
        for (let dyn of dynamicSysQueue) {
            newFrozenSequence.push(dyn);
            Logger.debug(`[自动下沉垫底] 动态提示词(每次动态更新): ${truncateLog(dyn.content)}`);
        }

        // 3. 去重與組裝
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
            proposedStream.forEach((m, idx) => Logger.debug(`  [${idx}] ${m.role} (${m.content?.length || 0}字): ${truncateLog(m.content, 40)}`));
        }

        // ==========================================
        // 4. 精準流失率演算法 (True Prefix Penalty)
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

            let preservedLen = 0;
            let recomputeLen = 0;
            for (let i = 0; i < P.length; i++) {
                let len = P[i].content?.length || 0;
                if (i < breakIndex) preservedLen += len;
                else recomputeLen += len;
            }

            let totalLen = preservedLen + recomputeLen;
            let recomputeRatio = totalLen === 0 ? 0 : (recomputeLen / totalLen);
            
            if (isPureContextShift) { 
                recomputeRatio = 0; 
                Logger.log(`[自然推移] 顶部的旧历史被自然挤出，不视为破坏缓存。`, LogLevels.DETAILED); 
            }

            if (recomputeRatio > 0.10 && Settings.showResetPrompt) {
                requireResetConfirm = true;
                dropPercentStr = (recomputeRatio * 100).toFixed(1);
                
                const tagHtml = `<span class="ds-tag ds-tag-${P[breakIndex]?.tag}">[${P[breakIndex]?.tag}]</span>`;
                const oldContent = escapeHtml(L[breakIndex]?.content || '∅').substring(0, 100).replace(/\n/g, ' ↵ ');
                const newContent = escapeHtml(P[breakIndex]?.content || '∅').substring(0, 100).replace(/\n/g, ' ↵ ');
                
                mapInfoText = `
                    <div style="margin-bottom:8px; display:flex; align-items:center; gap:8px;">
                        <span style="color:#56b6c2;"><i class="fa-solid fa-location-crosshairs"></i> 缓存断裂点位置:</span> <b>[索引 ${breakIndex}]</b> ${tagHtml}
                    </div>
                    <div class="ds-diff-del"><i class="fa-solid fa-minus"></i> 原内容: ${oldContent}...</div>
                    <div class="ds-diff-add"><i class="fa-solid fa-plus"></i> 新内容: ${newContent}...</div>
                    <div style="margin-top:8px; font-size: 11px; color:#98c379;">
                        ✅ 断点前(保持冻结): ${preservedLen} 字符 <br>
                        ⚠️ 断点后(必须重算): <span style="color:#e06c75;">${recomputeLen} 字符</span>
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
                if (!Settings.zenMode && typeof toastr !== 'undefined') toastr.info(`已自动修复后台顺序 (需重算 ${dropPercentStr}%)`, "缓存优化器");
                decision = 'accept';
            } else {
                decision = await askUserForResetAsync(dropPercentStr, mapInfoText);
            }
        }

        // 物理級絕對攔截
        if (decision === 'abort') {
            Logger.error('[物理拦截] 已强制熔断本次发送进程，AI将不会收到任何消息。', null, LogLevels.BASIC);
            setTopBarStatus('#e06c75', '缓存: 已拦截发送');
            if (typeof toastr !== 'undefined') toastr.error("已拦截发送！请复原您刚才的修改。", "缓存优化器");
            
            stream.splice(0, stream.length); // 抽空陣列阻止發送
            throw new Error("【DeepSeek Cache Optimizer】用户已手动拦截了本次发送。"); 
        }

        if (decision === 'bypass') {
            Logger.warn('[临时放行] 用户选择跳过本次优化，按 ST 原样乱序发送。');
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
            state.frozenSequence = dedupedSequence;
            state.lastPrefills = currentTurn.prefills;

            const finalStream = [...state.frozenSequence];
            if (currentTurn.user) finalStream.push(currentTurn.user);
            for (const p of currentTurn.prefills) finalStream.push(p);

            state.lastSentSequence = finalStream;
            safeSave();

            // 完美替換 ST 的發送流
            stream.splice(0, stream.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
            Logger.log(`✅ 排序完成，拦截器授权发送。耗时: ${(performance.now() - startTime).toFixed(2)}ms`, LogLevels.BASIC);
        }

    } catch (err) {
        if (err.message.includes("用户已手动拦截")) throw err; // 直接拋出給ST，中止程序
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
    
    // ... 存檔管理UI代碼不變
}

async function setupUI() {
    try {
        injectCSS();
        const html = `
        <div class="inline-drawer" id="ds-v25-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><span class="fa-solid fa-microchip"></span> DeepSeek 缓存优化器 V25</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:15px; background: rgba(0,0,0,0.1);">
                
                <!-- 基础设置 -->
                <div class="ds-opt-group open">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-sliders"></i> 基础设置</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div class="ds-row"><label class="ds-row-left" style="color:#00e5ff; font-weight:bold;"><input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}> ✅ 开启缓存优化 (核心引擎)</label></div>
                        <div class="ds-row"><label class="ds-row-left" style="color:#c678dd;"><input type="checkbox" id="ds-cache-zen" ${Settings.zenMode ? 'checked' : ''}> 🧘 免打扰模式 (隐藏所有屏幕右上角的通知框)</label></div>
                        <div class="ds-row"><label class="ds-row-left" style="color:#e5c07b;"><input type="checkbox" id="ds-cache-auto-accept" ${Settings.autoAccept ? 'checked' : ''}> ⚡ 自动修复缓存断层 (遇到冲突时，不弹窗直接后台修复并发送)</label></div>
                        <div class="ds-row"><label class="ds-row-left" style="color:#e06c75;"><input type="checkbox" id="ds-toast-reset" ${Settings.showResetPrompt ? 'checked' : ''}> 🛑 当触发【10%以上大量缓存失效】时，强制弹出拦截警告窗口</label></div>
                    </div>
                </div>

                <!-- 🕵️ 动态提示词实验室 UI -->
                <div class="ds-opt-group open">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span style="color:#00e5ff;"><i class="fa-solid fa-flask"></i> 动态提示词实验室 (自动修复方案)</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div class="ds-lab-box">
                            <div class="ds-lab-title"><i class="fa-solid fa-microscope"></i> 当引擎侦测到【随着对话在变动】的设定时，该怎么做？</div>
                            <div style="font-size:11px; color:#abb2bf; margin-bottom:10px;">例如：随对话改变的作者注(Author's Note)、动态世界书、或正则注入宏 {{lastMessage}}。这往往是频繁触发弹窗的罪魁祸首！</div>
                            
                            <div class="ds-radio-group">
                                <label class="ds-radio-item">
                                    <input type="radio" name="ds-dynamic-strat" value="sink" ${Settings.dynamicStrategy==='sink'?'checked':''}>
                                    <div class="ds-radio-text">
                                        <strong>方案A：自动下沉至底部 (最省算力 / 强烈推荐⭐)</strong>
                                        <span>引擎会自动将变动的提示词抽出，并排在【历史对话记录】的最末端。这样能完美保持上方几万字缓存彻底冻结不破裂！</span>
                                    </div>
                                </label>
                                
                                <label class="ds-radio-item">
                                    <input type="radio" name="ds-dynamic-strat" value="inplace" ${Settings.dynamicStrategy==='inplace'?'checked':''}>
                                    <div class="ds-radio-text">
                                        <strong>方案B：强制原位同步 (还原 ST 原生行为)</strong>
                                        <span>在原位置修改。⚠️警告：这会导致该设定下方的【所有历史对话】缓存全部报废，极度浪费API算力！</span>
                                    </div>
                                </label>

                                <label class="ds-radio-item">
                                    <input type="radio" name="ds-dynamic-strat" value="freeze" ${Settings.dynamicStrategy==='freeze'?'checked':''}>
                                    <div class="ds-radio-text">
                                        <strong>方案C：彻底锁定冻结 (最高命中率)</strong>
                                        <span>无视该设定的变化，永远只发第一次遇到的内容。缓存绝对完美，但AI可能感知不到你的动态设定更新。</span>
                                    </div>
                                </label>

                                <label class="ds-radio-item">
                                    <input type="radio" name="ds-dynamic-strat" value="delete" ${Settings.dynamicStrategy==='delete'?'checked':''}>
                                    <div class="ds-radio-text">
                                        <strong>方案D：直接丢弃删除</strong>
                                        <span>引擎只要侦测到变动，就直接将这个提示词从发送阵列中删掉。</span>
                                    </div>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 终端机 -->
                <div class="ds-opt-group open">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-terminal"></i> 运行日志终端</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content" style="padding:5px;">
                        <div class="ds-log-toolbar">
                            <span class="ds-log-filter active" data-filter="all">全部</span>
                            <span class="ds-log-filter" data-filter="info">常规</span>
                            <span class="ds-log-filter" data-filter="warn">动态&警告</span>
                            <span class="ds-log-filter" data-filter="debug">深层解析</span>
                            <div style="flex:1;"></div>
                            <button id="ds-btn-copylog" class="menu_button interactable" style="font-size:10px; padding:2px 6px;"><i class="fa-solid fa-copy"></i> 复制</button>
                            <button id="ds-btn-exportlog" class="menu_button interactable" style="font-size:10px; padding:2px 6px;"><i class="fa-solid fa-file-export"></i> 导出</button>
                            <span id="ds-btn-clearlog" class="ds-mini-btn" title="清空日志文字" style="color:#e06c75; cursor:pointer; padding:2px 6px;"><i class="fa-solid fa-trash"></i></span>
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
        $('#ds-cache-auto-accept').on('change', function () { Settings.autoAccept = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-reset').on('change', function () { Settings.showResetPrompt = $(this).is(':checked'); safeSave(); });
        
        // 綁定動態策略單選框
        $('input[name="ds-dynamic-strat"]').on('change', function() {
            Settings.dynamicStrategy = $(this).val();
            safeSave();
            if (typeof toastr !== 'undefined') toastr.success(`已套用策略：${$(this).next().find('strong').text().split('(')[0]}`);
        });

        // 日誌按鈕綁定
        $('#ds-btn-copylog').on('click', () => {
            const text = Array.from(document.querySelectorAll('.ds-log-line')).map(el => el.innerText).join('\n');
            navigator.clipboard.writeText(text);
            if (typeof toastr !== 'undefined') toastr.success("日志已复制到剪贴板！");
        });
        
        $('#ds-btn-exportlog').on('click', () => {
            const text = Array.from(document.querySelectorAll('.ds-log-line')).map(el => el.innerText).join('\n');
            const blob = new Blob([text], { type: "text/plain" });
            const url = URL.createObjectURL(blob); const a = document.createElement("a");
            a.href = url; a.download = `DeepSeek_Cache_Logs_${new Date().getTime()}.txt`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        });

        $('#ds-btn-clearlog').on('click', () => { $('#ds-cache-log-container').empty(); });
        
        $('.ds-log-filter').on('click', function() {
            $('.ds-log-filter').removeClass('active'); $(this).addClass('active'); const f = $(this).data('filter');
            $('#ds-cache-log-container .ds-log-line').each(function() {
                if (f === 'all' || $(this).data('type') === f || $(this).data('type') === 'divider') $(this).removeClass('hide'); else $(this).addClass('hide');
            });
        });

    } catch (e) { console.error('[DS Cache] UI初始化崩潰', e); }
}

jQuery(async () => {
    try {
        initSettings(); 
        await setupUI();
        
        // 延遲單次注入原生菜單按鈕
        setTimeout(() => { ensureTopMenuButton(); registerMagicWandButton(); }, 2000);
        
        if (eventSource) {
            // 掛載攔截器：利用 ST 的 await emit 特性，實現真正意義上的發送前物理攔截
            if (event_types?.CHAT_COMPLETION_PROMPT_READY) {
                eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
            }
        }

        Logger.log('══════ DeepSeek 缓存优化器 v25 引擎上线 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件启动失败:', e);
    }
});
