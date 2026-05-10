import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 1. 樣式注入 (強制水平排版與小白友善 UI)
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
        
        .ds-row { display: flex; flex-direction: row; justify-content: space-between; align-items: center; width: 100%; gap: 10px; }
        .ds-row-left { display: flex; flex-direction: row; justify-content: flex-start; align-items: center; gap: 8px; cursor: pointer; color: #abb2bf; font-size: 0.9em; white-space: nowrap; flex: 1; }
        .ds-row-left input[type="radio"], .ds-row-left input[type="checkbox"] { margin: 0; }
        
        .ds-log-toolbar { display: flex; gap: 5px; margin-bottom: 5px; align-items: center; }
        .ds-log-filter { cursor: pointer; padding: 3px 10px; border-radius: 12px; font-size: 11px; background: rgba(255,255,255,0.1); color: #abb2bf; transition: 0.2s; }
        .ds-log-filter.active { background: #56b6c2; color: #121212; font-weight: bold; }
        .ds-log-filter:hover:not(.active) { background: rgba(255,255,255,0.2); }
        .ds-log-terminal { background: var(--black50a, #0a0a0a); color: var(--SmartThemeBody-color, #a9b7c6); font-family: Consolas, monospace; font-size: 11px; height: 350px; overflow-y: auto; border-radius: 6px; padding: 10px; border: 1px solid var(--SmartThemeBorder-color, #333); box-shadow: inset 0 0 10px rgba(0,0,0,0.8); scroll-behavior: smooth; }
        .ds-log-line { margin-bottom: 4px; line-height: 1.4; word-wrap: break-word; }
        .ds-log-line.hide { display: none; }
        .ds-log-time { color: #5c6370; margin-right: 5px; user-select: none; }
        .ds-log-info { color: #98c379; }
        .ds-log-warn { color: #e5c07b; font-weight: bold; }
        .ds-log-error { color: #e06c75; font-weight: bold; }
        .ds-log-map { color: #56b6c2; font-weight: bold; }
        .ds-log-debug { color: #c678dd; }
        .ds-log-divider { color: #4b5263; font-weight: bold; display: block; margin: 8px 0; border-top: 1px dashed #4b5263; padding-top: 4px; }
        
        .ds-tag { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; background: rgba(255,255,255,0.05); }
        .ds-chat-container { max-height:220px; overflow-y:auto; border:1px solid rgba(255,255,255,0.1); padding:5px; border-radius:6px; background:var(--black50a, #121212); }
        .ds-chat-item { display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:8px; margin-bottom:6px; border-radius:6px; border:1px solid rgba(255,255,255,0.05); transition: 0.2s; }
        .ds-chat-item:hover { background:rgba(255,255,255,0.08); }
        .ds-chat-item.active-chat { background:rgba(0, 229, 255, 0.08); border:1px solid #00e5ff; box-shadow: inset 0 0 10px rgba(0,229,255,0.15); }
        
        .ds-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); z-index: 999999; display: flex; align-items: center; justify-content: center; animation: dsFadeIn 0.2s ease-out; }
        .ds-modal { background: var(--SmartThemeBlurTintColor, #1e1e24); border: 1px solid #e06c75; padding: 30px; border-radius: 12px; max-width: 800px; width: 90%; color: var(--SmartThemeBody-color, #fff); font-family: sans-serif; box-shadow: 0 25px 50px rgba(0,0,0,0.9); position: relative; overflow: hidden; animation: dsSlideUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .ds-modal-title { color: #e06c75; margin: 0 0 15px 0; display: flex; align-items: center; gap: 10px; font-size: 20px; }
        .ds-progress-container { background: rgba(0,0,0,0.5); border-radius: 6px; height: 10px; margin: 15px 0; overflow: hidden; box-shadow: inset 0 2px 4px rgba(0,0,0,0.5); }
        .ds-progress-bar { height: 100%; width: 0%; transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1), background 0.3s; }
        .ds-map-box { background: rgba(0,0,0,0.4); padding: 15px; border-radius: 8px; font-family: Consolas, monospace; font-size: 13px; color: #abb2bf; margin: 15px 0; border: 1px solid rgba(255,255,255,0.1); max-height: 350px; overflow-y: auto; }
        
        .ds-btn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 25px; }
        .ds-btn { padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 14px; transition: all 0.2s; position: relative; overflow: hidden; display:flex; align-items:center; justify-content:center; gap:8px;}
        .ds-btn:hover { transform: translateY(-2px); filter: brightness(1.15); box-shadow: 0 5px 15px rgba(0,0,0,0.4); }
        .ds-btn:active { transform: translateY(0); }
        .ds-btn-accept { background: #98c379; color: #121212; }
        .ds-btn-abort { background: #e06c75; color: #fff; }
        .ds-btn-bypass { background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); }
        .ds-btn-reset { background: rgba(224, 108, 117, 0.1); color: #e06c75; border: 1px solid #e06c75; }

        .ds-badge { background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-size: 0.8em; font-family: monospace; color: #56b6c2; }
        
        @keyframes dsFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes dsSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    `;
    document.head.appendChild(style);
};

// ==========================================
// 2. 狀態設定與極簡化模型
// ==========================================
let Settings = {};

function initSettings() {
    const oldSettings = extension_settings.ds_cache_v24 || {};
    if (!extension_settings.ds_cache_v25) {
        extension_settings.ds_cache_v25 = {
            enabled: oldSettings.enabled ?? true,
            zenMode: oldSettings.zenMode ?? false,
            toastHistory: oldSettings.toastHistory ?? true,
            showResetPrompt: oldSettings.showResetPrompt ?? true,
            autoAccept: oldSettings.autoAccept ?? false,
            logLevel: oldSettings.logLevel ?? 3,
            tolerance: oldSettings.tolerance ?? 1,
            maxCacheSize: oldSettings.maxCacheSize ?? 30,
            dynamicPolicy: oldSettings.dynamicPolicy ?? 'sink', // 動態提示詞的 6 大策略
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
        if (!Settings.zenMode && typeof toastr !== 'undefined') toastr.warning(msg, '💡 DeepSeek 缓存提示', { timeOut: 3000 });
    }
}

function escapeHtml(text) { return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

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
    renderChatsUI();
}

// ==========================================
// 3. 醫療級日誌系統 (嚴格按照要求輸出)
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function updateTopBarState() {
    const dot = $('#ds-top-status-dot');
    if (!dot.length) return;
    if (!Settings.enabled) {
        dot.css('color', '#5c6370'); $('#ds-top-reset-btn').attr('title', 'DeepSeek 优化器: 已停用');
    } else {
        dot.css('color', '#00ff00'); $('#ds-top-reset-btn').attr('title', 'DeepSeek 优化器: 运作中');
    }
}

function setTopBarStatus(color, title) {
    if (!Settings.enabled) return;
    const dot = $('#ds-top-status-dot');
    if (dot.length) { dot.css('color', color); $('#ds-top-reset-btn').attr('title', title); }
}

function logAt(level, type, msg) {
    if (Settings.logLevel < level) return;
    
    // Console 輸出
    if (type === 'warn') console.warn(`[DS优化器] 🌪️ ${msg}`);
    else if (type === 'error') console.error(`[DS优化器] 🔴 ${msg}`);
    else if (type === 'map') console.log(`[DS优化器] 🗺️ ${msg}`);
    else if (type === 'debug') console.log(`%c${msg}`, 'color: #c678dd;');
    else if (type === 'divider') console.log(`%c${msg}`, 'color: #4b5263; font-weight: bold;');
    else console.log(`%c${msg}`, 'color: #00ff00;');
    
    // 終端機輸出
    const container = document.getElementById('ds-cache-log-container');
    if (container) {
        const line = document.createElement('div');
        line.className = 'ds-log-line';
        line.setAttribute('data-type', type === 'divider' ? 'info' : type);
        
        if (type === 'divider') line.innerHTML = `<span class="ds-log-divider">${msg}</span>`;
        else line.innerHTML = `<span class="ds-log-${type}">${msg.replace(/\n/g, '<br>')}</span>`;
        
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
    formatItem: (msg, idx) => {
        const text = msg.content || '';
        let preview = text.replace(/\n/g, ' ↵ ');
        if (preview.length > 40) preview = preview.substring(0, 40) + '...';
        return `[${idx}] ${msg.role} (${text.length}字): ${preview}`;
    }
};

// ==========================================
// 4. 狀態管理與擴充選單 (原生無污染註冊)
// ==========================================
function getChatKey() {
    const context = getContext();
    let charName = "未知角色";
    if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
        charName = context.characters[context.characterId].name || context.characterId;
    } else if (context.name2) charName = context.name2;
    let chatId = context.chatId || "默认聊天";
    return { key: `char_${context.characterId}_${chatId}`, label: `${charName} | 存档: ${chatId}` };
}

function getChatState(chatKeyInfo) {
    if (!Settings.chats[chatKeyInfo.key]) {
        Settings.chats[chatKeyInfo.key] = { label: chatKeyInfo.label, frozenSequence: [], floatingPrompts: [], topPrompts: [], lastSentSequence: [], lastPrefills: [], lastAccessed: Date.now() };
        safeSave(); renderChatsUI();
    } else {
        Settings.chats[chatKeyInfo.key].lastAccessed = Date.now();
        if (!Settings.chats[chatKeyInfo.key].floatingPrompts) Settings.chats[chatKeyInfo.key].floatingPrompts = [];
        if (!Settings.chats[chatKeyInfo.key].topPrompts) Settings.chats[chatKeyInfo.key].topPrompts = [];
    }
    return Settings.chats[chatKeyInfo.key];
}

function ensureTopMenuButton() {
    if ($('#ds-top-reset-btn').length === 0) {
        const btn = $(`
            <li id="ds-top-reset-btn" class="menu_button interactable" title="DeepSeek 优化器">
                <span class="fa-solid fa-microchip"></span>
                <span id="ds-top-status-dot" style="font-size:0.7em; margin-left:2px; vertical-align:top;"><i class="fa-solid fa-circle"></i></span>
            </li>
        `);
        btn.on('click', (e) => {
            e.preventDefault();
            Settings.enabled = !Settings.enabled; $('#ds-cache-enable').prop('checked', Settings.enabled);
            safeSave(); updateTopBarState();
        });
        if ($('ul#extensions_menu').length > 0) $('ul#extensions_menu').append(btn);
        else if ($('#right-nav-extensions').length > 0) $('#right-nav-extensions').append(btn);
    }
    updateTopBarState();
}

// 徹底使用原生 DOM 注入，不依賴任何 setInterval 或 MutationObserver
function injectNativeMagicWandButton() {
    if ($('#ds-bottom-reset-btn').length === 0) {
        $('#extensions_menu').append(`
            <li id="ds-bottom-reset-btn" class="menu_button interactable" title="如果觉得AI逻辑乱了，点击清空当前聊天的缓存让大模型重新阅读">
                <span class="fa-solid fa-broom" style="color: #e06c75;"></span> 重置当前对话的缓存
            </li>
        `);
    }
}

$(document).on('click', '#ds-bottom-reset-btn', () => { 
    if(!confirm("确定要清空当前对话的缓存吗？\n(这会让AI完全重新阅读整个对话，适合在觉得AI逻辑混乱时使用)")) return;
    const key = getChatKey().key; delete Settings.chats[key]; safeSave(); renderChatsUI();
    setTopBarStatus('#00ff00', '缓存: 已重置');
    if (typeof toastr !== 'undefined') toastr.success("当前聊天缓存已重置，下次发送将重新开始建档！");
    $('#extensions_menu').removeClass('open').hide(); 
});

function setupGlobalHotkeys() {
    document.addEventListener('keydown', (e) => {
        if (!Settings.hotkeysEnabled) return;
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
        if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'c') {
            e.preventDefault(); Settings.enabled = !Settings.enabled;
            $('#ds-cache-enable').prop('checked', Settings.enabled); safeSave(); updateTopBarState();
        }
    });
}

// ==========================================
// 5. 核心邏輯工具 (完全保留)
// ==========================================
function createMsg(msg, tag) {
    const content = msg.content || '';
    return { role: msg.role, content: content, norm: Logger.normalize(content), len: content.length, tag: tag };
}
function getSimilarity(str1, str2) {
    if (str1 === str2) return 1;
    if (Math.abs(str1.length - str2.length) > Math.max(str1.length, str2.length) * 0.5) return 0;
    const s1 = str1.length < str2.length ? str1 : str2; const s2 = str1.length < str2.length ? str2 : str1;
    if (s1.length === 0) return 0;
    const bigrams = new Set(); let matchCount = 0;
    for (let i = 0; i < s1.length - 1; i++) bigrams.add(s1.substring(i, i+2));
    for (let i = 0; i < s2.length - 1; i++) if (bigrams.has(s2.substring(i, i+2))) matchCount++;
    const union = (s1.length - 1) + (s2.length - 1) - matchCount;
    return union <= 0 ? 1 : matchCount / union;
}
function stripPrefillFromAssistant(assistantObj, prefills) {
    if (!assistantObj || !prefills || prefills.length === 0) return assistantObj;
    let content = assistantObj.content || ''; let modified = false;
    for (const p of prefills) {
        const pContent = p.content || '';
        if (content.startsWith(pContent)) { content = content.substring(pContent.length); modified = true; }
    }
    if (modified) return { ...assistantObj, content: content.replace(/^[\s\n]+/, ''), norm: Logger.normalize(content.replace(/^[\s\n]+/, '')), len: content.replace(/^[\s\n]+/, '').length };
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
        currentTurn.user = chatMsgs[lastUserIdx];
        currentTurn.prefills = chatMsgs.slice(lastUserIdx + 1).filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'}));
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
// 6. 攔截器 UI
// ==========================================
function askUserForResetAsync(dropPercent, mapInfo) {
    return new Promise(resolve => {
        let progColor = '#98c379'; if (dropPercent >= 50) progColor = '#e06c75'; else if (dropPercent >= 20) progColor = '#e5c07b'; 
        const html = `
            <div class="ds-overlay" id="ds-modal-wrapper">
                <div class="ds-modal">
                    <h2 class="ds-modal-title"><span class="fa-solid fa-triangle-exclamation"></span> DeepSeek 缓存破坏警告</h2>
                    <p class="ds-modal-text" style="line-height: 1.5;">
                        检测到您手动修改或删除了较早的文本内容。<br>
                        由于大模型缓存机制，发生断点<b>之后的所有内容</b>（约 <b style="color:${progColor}">${dropPercent}%</b> 的文本）都必须重新消耗算力计算。<br>
                        系统已在后台帮您完成了无缝修补，请问要如何处理本次发送？
                    </p>
                    <div class="ds-progress-container"><div class="ds-progress-bar" id="ds-prog-bar" style="background: ${progColor};"></div></div>
                    <div class="ds-map-box">${mapInfo}</div>
                    <div class="ds-btn-grid">
                        <button class="ds-btn ds-btn-accept" id="ds-btn-accept"><i class="fa-solid fa-check"></i> 同步修复并发送 (推荐)</button>
                        <button class="ds-btn ds-btn-abort" id="ds-btn-abort"><i class="fa-solid fa-ban"></i> 拦截发送 (让我退回去改改)</button>
                        <button class="ds-btn ds-btn-bypass" id="ds-btn-bypass" title="关闭本次的优化，按ST原样发送"><i class="fa-solid fa-forward"></i> 临时放行 (按原样乱序发送)</button>
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
        const keyHandler = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cleanup(); resolve('abort'); } };
        document.addEventListener('keydown', keyHandler, true);
    });
}

// ==========================================
// 7. 完美時序凍結演算法 (Chrono-Lock) & 絕對攔截
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (!Settings.enabled || data.dryRun) return;
    const startTime = performance.now();
    const chatKeyInfo = getChatKey();
    
    // 生成時間戳日誌
    const nowStr = new Date().toLocaleString('sv-SE').replace(' ', '@').replace(/-/g, '-').replace(/:/g, 'm') + 's' + new Date().getMilliseconds() + 'ms';

    try {
        let state = getChatState(chatKeyInfo);
        if (!data?.chat?.length) return;
        const stream = data.chat;

        Logger.divider(`===== 启动发文拦截: ${chatKeyInfo.label.split('|')[0].trim()} | 存档: ${chatKeyInfo.label.split('|')[1].trim()} - ${nowStr} =====`);

        if (Settings.logLevel >= LogLevels.DEBUG) {
            Logger.debug(` [ST 原始发送阵列] 总节点数: ${stream.length}`);
            stream.forEach((m, idx) => Logger.debug(` ${Logger.formatItem(m, idx)}`));
        }

        const { sysMsgs, historyTurns, currentTurn } = parseSTStream(stream);
        const flatHistoryPool = [];
        for(let t of historyTurns) {
            flatHistoryPool.push(t.user);
            if(t.assistant) flatHistoryPool.push(stripPrefillFromAssistant(t.assistant, state.lastPrefills));
        }

        let newFrozenSequence = [];
        let newFloatingPrompts = []; // 下沉區
        let newTopPrompts = [];      // 置頂區
        
        const sysPool = [...sysMsgs];
        const remainingHistory = [...flatHistoryPool];
        const thresholds = getTolerance();
        const policy = Settings.dynamicPolicy || 'sink';

        // 1. 處理之前已分離的動態提示詞 (Floating/Top)
        const processDynamicPool = (pool, targetArray) => {
            for (let i = 0; i < pool.length; i++) {
                const item = pool[i];
                let bestIdx = -1, bestScore = 0;
                for (let j = 0; j < sysPool.length; j++) {
                    const score = getSimilarity(item.norm, sysPool[j].norm);
                    if (score > bestScore) { bestScore = score; bestIdx = j; }
                }
                if (bestScore > thresholds.sys) {
                    targetArray.push(sysPool[bestIdx]);
                    sysPool.splice(bestIdx, 1);
                }
            }
        };
        processDynamicPool(state.topPrompts, newTopPrompts);
        processDynamicPool(state.floatingPrompts, newFloatingPrompts);

        // 2. 處理核心凍結陣列 (原位同步邏輯)
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
                    Logger.debug(` [绝对冻结] 提示词: ${truncateLog(sysPool[bestIdx].content, 30)}`);
                    sysPool.splice(bestIdx, 1); 
                } else if (bestScore > thresholds.sys) {
                    const matchedItem = sysPool[bestIdx];
                    sysPool.splice(bestIdx, 1);
                    
                    if (policy === 'sink') {
                        newFloatingPrompts.push(matchedItem);
                        Logger.debug(` [智能下沉] 发现作乱动态提示词，已拔除流放至末尾: ${truncateLog(matchedItem.content, 20)}`);
                    } else if (policy === 'top') {
                        newTopPrompts.push(matchedItem);
                        Logger.debug(` [强制置顶] 发现作乱动态提示词，已拔除流放至最顶端: ${truncateLog(matchedItem.content, 20)}`);
                    } else if (policy === 'inplace') {
                        newFrozenSequence.push(matchedItem);
                        Logger.debug(` [原位强更] 提示词 (相似度 ${(bestScore*100).toFixed(1)}%): -> ↵ ${truncateLog(matchedItem.content, 20)}`);
                    } else if (policy === 'freeze') {
                        newFrozenSequence.push(item);
                        Logger.debug(` [绝对冻结] 无视动态变化，强行保留最初版本: ${truncateLog(item.content, 20)}`);
                    } else if (policy === 'delete') {
                        Logger.debug(` [彻底删除] 剔除作乱提示词: ${truncateLog(matchedItem.content, 20)}`);
                    } else if (policy === 'warn') {
                        // 如果選警告，當作強更處理，但依賴下方的流失率彈窗
                        newFrozenSequence.push(matchedItem);
                        Logger.debug(` [警告原位] 提示词变动: -> ↵ ${truncateLog(matchedItem.content, 20)}`);
                    }
                } else {
                    Logger.debug(` [原位删除] 找不到旧提示词: ${truncateLog(item.content, 20)}`);
                }
            } 
            else if (item.tag === 'USER' || item.tag === 'AI') {
                // 用戶手動輸入及 AI 歷史對話，必須原位同步！
                let bestIdx = -1, bestScore = 0;
                for (let j = 0; j < remainingHistory.length; j++) {
                    if (item.tag !== remainingHistory[j].tag) continue;
                    const score = getSimilarity(item.norm, remainingHistory[j].norm);
                    if (score > bestScore) { bestScore = score; bestIdx = j; }
                }
                if (bestScore > thresholds.his) {
                    const matchedItem = remainingHistory[bestIdx];
                    newFrozenSequence.push(matchedItem);
                    if (bestScore === 1) Logger.debug(` [绝对冻结] 历史对话: ${truncateLog(matchedItem.content, 30)}`);
                    else Logger.debug(` [原位更新] 历史对话 (相似度 ${(bestScore*100).toFixed(1)}%): -> ↵ ${truncateLog(matchedItem.content, 30)}`);
                    remainingHistory.splice(bestIdx, 1);
                } else {
                    Logger.debug(` [原位删除] 历史对话已被移除: ${truncateLog(item.content, 20)}`);
                }
            }
        }

        // 3. 嚴格排序邏輯：新增加的歷史與提示詞墊底
        for (let h of remainingHistory) {
            newFrozenSequence.push(h);
            Logger.debug(` [追加至尾部] 新历史对话: ${truncateLog(h.content, 30)}`);
        }
        for (let sys of sysPool) {
            newFrozenSequence.push(sys);
            Logger.debug(` [追加至尾部] 新增设定/世界书: ${truncateLog(sys.content, 30)}`);
        }

        // 4. 去重與最終組裝 (Top -> Core -> Bottom(Sink) -> User Input -> Prefill)
        let dedupedSequence = [];
        const seenSysNorms = new Set();
        for (const item of newFrozenSequence) {
            if (item.tag === 'SYS') { if (seenSysNorms.has(item.norm)) continue; seenSysNorms.add(item.norm); }
            dedupedSequence.push(item);
        }

        const proposedStream = [...newTopPrompts, ...dedupedSequence, ...newFloatingPrompts];
        if (currentTurn.user) proposedStream.push(currentTurn.user);
        for (const p of currentTurn.prefills) proposedStream.push(p);

        if (Settings.logLevel >= LogLevels.DEBUG) {
            Logger.debug(` [最终排序发送阵列] 总节点数: ${proposedStream.length}`);
            proposedStream.forEach((m, idx) => Logger.debug(` ${Logger.formatItem(m, idx)}`));
        }

        // ==========================================
        // 5. 精準流失率演算法 (True Prefix Penalty)
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

            // 判斷是否為自然延續或自然頂出 (isNormalContinuation / isPureContextShift)
            let isNormalContinuation = (breakIndex === L.length);
            let isPureContextShift = false;
            
            if (!isNormalContinuation && breakIndex > 0 && breakIndex < L.length && breakIndex < P.length) {
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
            
            if (isNormalContinuation || isPureContextShift) { 
                recomputeRatio = 0; 
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
                decision = 'accept';
            } else {
                decision = await askUserForResetAsync(dropPercentStr, mapInfoText);
            }
        }

        if (decision === 'abort') {
            Logger.error('[拦截] 已彻底拦截本次发送，保护现有缓存。', null, LogLevels.BASIC);
            setTopBarStatus('#e06c75', '已强行拦截');
            if (typeof toastr !== 'undefined') toastr.error("已强制拦截发送！对话已中止。", "优化器");
            
            // 絕對中斷技術：抽空陣列並拋出 Error 徹底打斷 ST 發送鏈
            data.chat.length = 0; 
            throw new Error("【DeepSeek 缓存优化器】已成功拦截并中止本次对话发送。");
        }

        if (decision === 'bypass') {
            Logger.warn('[临时放行] 用户跳过优化，按 ST 原样乱序发送。');
            setTopBarStatus('#e5c07b', '临时放行');
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
            state.floatingPrompts = newFloatingPrompts;
            state.topPrompts = newTopPrompts;
            state.lastPrefills = currentTurn.prefills;

            const finalStream = [...state.topPrompts, ...state.frozenSequence, ...state.floatingPrompts];
            if (currentTurn.user) finalStream.push(currentTurn.user);
            for (const p of currentTurn.prefills) finalStream.push(p);

            state.lastSentSequence = finalStream;
            safeSave();

            if (Settings.autoPinThreshold > 0 && finalStream.length >= Settings.autoPinThreshold) {
                if (!Settings.pinnedChats[chatKeyInfo.key]) {
                    Settings.pinnedChats[chatKeyInfo.key] = true;
                    safeSave();
                    Logger.map(`[自动保护] 节点数(${finalStream.length})达标，已锁定当前存档。`);
                }
            }

            // 完美替換 ST 的發送流
            stream.splice(0, stream.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
            Logger.log(`✅ 排序完成，拦截器授权发送。耗时: ${(performance.now() - startTime).toFixed(2)}ms`, LogLevels.BASIC);
        }

    } catch (err) {
        if (err.message.includes("已成功拦截并中止本次对话发送")) throw err; // 允許我們的自定義中斷通過
        setTopBarStatus('#e06c75', '缓存: 发生崩溃');
        Logger.error('核心运算崩溃', err);
        throw err;
    }
}

// ==========================================
// 8. 診斷掃描器與 UI 面板
// ==========================================
function runDynamicPromptDiagnostic() {
    const chatKeyInfo = getChatKey();
    const state = Settings.chats[chatKeyInfo.key];
    if (!state || (!state.floatingPrompts.length && !state.topPrompts.length)) {
        alert("🎉 太棒了！当前对话没有检测到任何被剥离的动态提示词。您的缓存非常健康！\n\n(提示：插件会在您发信时自动检测，如果发现某些提示词每次都在变化，就会将它们捕获到这里！)");
        return;
    }
    
    let listHtml = '';
    const allDynamic = [...state.topPrompts, ...state.floatingPrompts];
    
    allDynamic.forEach((m, idx) => {
        const fullText = escapeHtml(m.content || '');
        listHtml += `
            <div style="background: rgba(255,255,255,0.05); padding: 10px; margin-bottom: 10px; border-radius: 6px; border-left: 3px solid #c678dd;">
                <div style="font-size: 11px; color: #abb2bf; margin-bottom: 5px;">🔥 作乱节点 [${idx + 1}]</div>
                <div style="font-size: 12px; color: #e5c07b; white-space: pre-wrap; font-family: monospace;">${fullText}</div>
            </div>
        `;
    });

    const html = `
        <div class="ds-overlay" id="ds-dyn-wrapper">
            <div class="ds-modal" style="max-width: 700px; padding: 25px;">
                <h2 class="ds-modal-title" style="color:#c678dd; font-size:18px;"><span class="fa-solid fa-bug"></span> 自动捕获的动态提示词</h2>
                <p style="font-size: 12px; color: #abb2bf; line-height: 1.5; margin-bottom: 10px;">
                    以下提示词被插件抓到在每次发送时都在"偷偷改变自己"。系统已经根据您的设定将它们剥离。<br><br>
                    <b>💡 3 种彻底解决问题的手动方法 (适合小白)：</b><br>
                    1. <b>关闭发送时间戳：</b> 在 ST 设置中关闭「将当前时间附加到提示词」功能。<br>
                    2. <b>检查随机变量：</b> 看看上面的内容，如果在世界书或提示词中使用了 <code>{{random}}</code>、<code>{{time}}</code> 等宏，请尽量删掉。<br>
                    3. <b>移动至作者注记 (Author's Note)：</b> 如果这是必须变动的内容，请把它写进「作者注记」，并将插入位置设为 @Depth 0 (放在最后面)。
                </p>
                <div class="ds-map-box" style="max-height: 250px; overflow-y: auto;">${listHtml}</div>
                <button class="ds-btn ds-btn-accept" style="width:100%; margin-top:15px;" onclick="$('#ds-dyn-wrapper').remove()">关闭面板</button>
            </div>
        </div>
    `;
    $('body').append(html);
}

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
        const dynCount = (chat.floatingPrompts?.length || 0) + (chat.topPrompts?.length || 0);
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
                        <span style="color:#98c379;">静态节点: ${count} / 动态节点: ${dynCount}</span>
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
        <div class="inline-drawer" id="ds-v25-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><span class="fa-solid fa-microchip"></span> DeepSeek 缓存优化器 (v24 终极时序守卫版)</b>
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
                            <label class="ds-row-left" style="color:#00e5ff; font-weight:bold;"><input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}> ✅ 开启缓存优化拦截器</label>
                        </div>
                        <div class="ds-row"><label class="ds-row-left" style="color:#c678dd;"><input type="checkbox" id="ds-cache-auto-accept" ${Settings.autoAccept ? 'checked' : ''}> ⚡ 自动修复缓存冲突 (遇到断裂时，不弹窗直接后台修复并发送)</label></div>
                        <div class="ds-row"><label class="ds-row-left" style="color:#98c379;"><input type="checkbox" id="ds-cache-hotkeys" ${Settings.hotkeysEnabled ? 'checked' : ''}> ⌨️ 启用全局快捷键 (Ctrl+Alt+C 开关优化器 / R 强行重置当前对话缓存)</label></div>
                        <div class="ds-row"><label class="ds-row-left" title="修改早期的对话会让大模型缓存失效"><input type="checkbox" id="ds-toast-his" ${Settings.toastHistory ? 'checked' : ''}> 💬 当我修改或删除【历史聊天记录】时弹窗提醒我</label></div>
                        <div class="ds-row"><label class="ds-row-left" style="color:#e06c75;"><input type="checkbox" id="ds-toast-reset" ${Settings.showResetPrompt ? 'checked' : ''}> 🛑 当发送可能导致大量缓存失效时，弹出二次确认警告窗口</label></div>
                    </div>
                </div>

                <!-- 动态提示词修复 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-bug"></i> 动态提示词修复方案 (6大策略)</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div style="font-size: 11.5px; color: #abb2bf; line-height: 1.4; margin-bottom: 5px;">
                            如果预设中包含随用户输入而每次动态改变的提示词，会导致每次都破坏缓存。请选择处理方式：
                        </div>
                        <label class="ds-row-left" style="color:#98c379;"><input type="radio" name="ds_dyn_policy" value="sink" ${Settings.dynamicPolicy==='sink'?'checked':''}> ⬇️ 智能下沉垫底 (推荐: 彻底剥离它，强行锁在当前用户输入的前1位。完美拯救缓存)</label>
                        <label class="ds-row-left" style="color:#56b6c2;"><input type="radio" name="ds_dyn_policy" value="top" ${Settings.dynamicPolicy==='top'?'checked':''}> ⬆️ 强制置顶 (将作乱项剥离，并锁定在整个对话阵列的最开端)</label>
                        <label class="ds-row-left" style="color:#e06c75;"><input type="radio" name="ds_dyn_policy" value="inplace" ${Settings.dynamicPolicy==='inplace'?'checked':''}> 🔄 原位强行更新 (ST 原版逻辑: 保持原位并每次刷新，会破坏下方所有历史缓存)</label>
                        <label class="ds-row-left" style="color:#61afef;"><input type="radio" name="ds_dyn_policy" value="freeze" ${Settings.dynamicPolicy==='freeze'?'checked':''}> ❄️ 绝对冻结 (彻底无视它的变化，强行定格在第1个回合的文字状态保缓存)</label>
                        <label class="ds-row-left" style="color:#5c6370;"><input type="radio" name="ds_dyn_policy" value="delete" ${Settings.dynamicPolicy==='delete'?'checked':''}> 🗑️ 彻底删除 (遇到会自己乱变的提示词，直接一律剔除不发送)</label>
                        <label class="ds-row-left" style="color:#e5c07b;"><input type="radio" name="ds_dyn_policy" value="warn" ${Settings.dynamicPolicy==='warn'?'checked':''}> ⚠️ 拦截警告 (原位更新，并且必定触发拦截弹窗让你处理)</label>
                        
                        <div class="ds-row" style="margin-top:5px;">
                            <button id="ds-btn-show-dyn" class="menu_button interactable" style="flex:1; padding:6px; font-size:0.85em; color:#c678dd; border:1px solid #c678dd; background:rgba(198, 120, 221, 0.1);"><i class="fa-solid fa-magnifying-glass"></i> 扫描并列出当前已被捕获的动态提示词 (附手动修复指南)</button>
                        </div>
                    </div>
                </div>
                
                <!-- 高级参数 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-gears"></i> 高级参数 (小白无须修改)</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div class="ds-row">
                            <span style="font-size:0.85em; color:#abb2bf;">匹配严格度:</span>
                            <select id="ds-cache-tolerance" class="text_pole" style="width:110px; padding:2px;">
                                <option value="0" ${Settings.tolerance===0?'selected':''}>严格 (推荐)</option>
                                <option value="1" ${Settings.tolerance===1?'selected':''}>标准</option>
                                <option value="2" ${Settings.tolerance===2?'selected':''}>宽松</option>
                            </select>
                        </div>
                        <div class="ds-row">
                            <span style="font-size:0.85em; color:#abb2bf;">历史存档保留上限:</span>
                            <input type="number" id="ds-cache-maxsize" class="text_pole" value="${Settings.maxCacheSize}" min="5" max="100" style="width:110px; text-align:center; padding:2px;">
                        </div>
                        <div class="ds-row" style="margin-top:5px;">
                            <button id="ds-btn-export" class="menu_button interactable" style="flex:1; padding:4px; font-size:0.8em;"><i class="fa-solid fa-download"></i> 导出设置与缓存备份</button>
                            <button id="ds-btn-import" class="menu_button interactable" style="flex:1; padding:4px; font-size:0.8em;"><i class="fa-solid fa-upload"></i> 导入备份</button>
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
                            <button id="ds-btn-deep-clean" class="menu_button" style="flex:1; font-size:0.85em; color:#e5c07b; border:1px solid #e5c07b; background:none;" title="清理所有没被锁定，且超过30天没玩过的旧存档">🧹 清理30天前的旧缓存</button>
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
                        <div class="ds-row" style="margin-bottom:5px;">
                            <span style="font-size:0.85em; color:#abb2bf;">日志输出等级:</span>
                            <select id="ds-cache-loglevel" class="text_pole" style="width:110px; padding:2px;">
                                <option value="0" ${Settings.logLevel===0?'selected':''}>0: 关闭</option>
                                <option value="1" ${Settings.logLevel===1?'selected':''}>1: 基础报告</option>
                                <option value="2" ${Settings.logLevel===2?'selected':''}>2: 详细追踪</option>
                                <option value="3" ${Settings.logLevel===3?'selected':''}>3: 透视调试 (最详细)</option>
                            </select>
                        </div>
                        <div class="ds-log-toolbar">
                            <span class="ds-log-filter active" data-filter="all">全部</span>
                            <span class="ds-log-filter" data-filter="info">常规</span>
                            <span class="ds-log-filter" data-filter="warn">警告</span>
                            <span class="ds-log-filter" data-filter="debug">追踪</span>
                            <span class="ds-log-filter" data-filter="error">报错</span>
                        </div>
                        <div id="ds-cache-log-container" class="ds-log-terminal"></div>
                        <div class="ds-row" style="margin-top: 5px;">
                            <button id="ds-btn-copy-log" class="menu_button interactable" style="flex:1; padding:4px; font-size:0.8em;"><i class="fa-solid fa-copy"></i> 一键复制全部日志</button>
                            <button id="ds-btn-export-log" class="menu_button interactable" style="flex:1; padding:4px; font-size:0.8em;"><i class="fa-solid fa-file-export"></i> 导出日志为 txt</button>
                            <button id="ds-btn-clearlog" class="menu_button interactable" style="width:30px; padding:4px; font-size:0.8em; color:#e06c75;"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
        
        $('#extensions_settings').append(html);

        // UI 事件綁定
        $('#ds-cache-enable').on('change', function () { Settings.enabled = $(this).is(':checked'); safeSave(); updateTopBarState(); });
        $('#ds-toast-his').on('change', function () { Settings.toastHistory = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-reset').on('change', function () { Settings.showResetPrompt = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-auto-accept').on('change', function () { Settings.autoAccept = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-hotkeys').on('change', function () { Settings.hotkeysEnabled = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-tolerance').on('change', function () { Settings.tolerance = parseInt($(this).val()); safeSave(); });
        $('#ds-cache-loglevel').on('change', function () { Settings.logLevel = parseInt($(this).val()); safeSave(); });
        $('#ds-cache-maxsize').on('change', function () { Settings.maxCacheSize = parseInt($(this).val()) || 30; safeSave(); performGarbageCollection(); });
        
        $('input[name="ds_dyn_policy"]').on('change', function() { Settings.dynamicPolicy = $(this).val(); safeSave(); });
        $('#ds-btn-show-dyn').on('click', runDynamicPromptDiagnostic);

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
        
        $('#ds-btn-copy-log').on('click', () => {
            const logs = $('#ds-cache-log-container')[0].innerText;
            navigator.clipboard.writeText(logs).then(() => { if (typeof toastr !== 'undefined') toastr.success("日志已复制到剪贴板"); });
        });
        $('#ds-btn-export-log').on('click', () => {
            const logs = $('#ds-cache-log-container')[0].innerText;
            const blob = new Blob([logs], { type: "text/plain" });
            const url = URL.createObjectURL(blob); const a = document.createElement("a");
            a.href = url; a.download = `DS_Cache_Logs_${new Date().getTime()}.txt`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        });

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
        
        setTimeout(() => { ensureTopMenuButton(); injectNativeMagicWandButton(); }, 2000);
        
        if (eventSource) {
            eventSource.on(event_types.CHAT_CHANGED, () => { ensureTopMenuButton(); injectNativeMagicWandButton(); renderChatsUI(); });
            if (event_types?.CHAT_COMPLETION_PROMPT_READY) eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
            
            // 僅保留真正對時序造成破壞的歷史對話編輯/刪除感知
            if (event_types?.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, () => triggerWarningImmediate('his_del', '您删除了历史对话，已标记断层！下次发送将原位修补。', Settings.toastHistory));
            if (event_types?.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, () => triggerWarningImmediate('his_edit', '您修改了历史对话，已标记断层！下次发送将原位修补。', Settings.toastHistory));
        }

        Logger.divider('══════ DeepSeek 缓存优化器 v24 引擎上线 ══════');
    } catch (e) {
        console.error('[DS Cache] 插件启动失败:', e);
    }
});
