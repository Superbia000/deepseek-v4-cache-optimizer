import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 1. 樣式注入 (小白友善模組化 + 動態提示詞UI)
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

        .ds-chat-container { max-height:220px; overflow-y:auto; border:1px solid rgba(255,255,255,0.1); padding:5px; border-radius:6px; background:var(--black50a, #121212); }
        .ds-chat-item { display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:8px; margin-bottom:6px; border-radius:6px; border:1px solid rgba(255,255,255,0.05); transition: 0.2s; }
        .ds-chat-item:hover { background:rgba(255,255,255,0.08); }
        .ds-chat-item.active-chat { background:rgba(0, 229, 255, 0.08); border:1px solid #00e5ff; box-shadow: inset 0 0 10px rgba(0,229,255,0.15); }
        
        .ds-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); z-index: 999999; display: flex; align-items: center; justify-content: center; animation: dsFadeIn 0.2s ease-out; }
        .ds-modal { background: var(--SmartThemeBlurTintColor, #1e1e24); border: 1px solid #56b6c2; padding: 25px; border-radius: 12px; max-width: 800px; width: 95%; color: var(--SmartThemeBody-color, #fff); font-family: sans-serif; box-shadow: 0 25px 50px rgba(0,0,0,0.9); position: relative; overflow: hidden; animation: dsSlideUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .ds-modal.danger { border-color: #e06c75; }
        .ds-modal-title { margin: 0 0 15px 0; display: flex; align-items: center; gap: 10px; font-size: 20px; }
        .ds-modal.danger .ds-modal-title { color: #e06c75; }
        .ds-progress-container { background: rgba(0,0,0,0.5); border-radius: 6px; height: 10px; margin: 15px 0; overflow: hidden; box-shadow: inset 0 2px 4px rgba(0,0,0,0.5); }
        .ds-progress-bar { height: 100%; width: 0%; transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1), background 0.3s; }
        
        .ds-map-box { background: rgba(0,0,0,0.4); padding: 12px; border-radius: 8px; font-family: Consolas, monospace; font-size: 13px; color: #abb2bf; margin: 15px 0; border: 1px solid rgba(255,255,255,0.1); max-height: 250px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
        .ds-diff-del { background: rgba(224, 108, 117, 0.15); border-left: 3px solid #e06c75; padding: 8px; margin-bottom: 8px; border-radius: 0 4px 4px 0; color: #e06c75; }
        .ds-diff-add { background: rgba(152, 195, 121, 0.15); border-left: 3px solid #98c379; padding: 8px; border-radius: 0 4px 4px 0; color: #98c379; }
        
        .ds-btn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 20px; }
        .ds-btn-grid.three-col { grid-template-columns: 1fr 1fr 1fr; }
        .ds-btn { padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 13px; transition: all 0.2s; display:flex; align-items:center; justify-content:center; gap:8px;}
        .ds-btn:hover { transform: translateY(-2px); filter: brightness(1.15); box-shadow: 0 5px 15px rgba(0,0,0,0.4); }
        .ds-btn:active { transform: translateY(0); }
        
        .ds-btn-sink { background: #61afef; color: #121212; }
        .ds-btn-accept { background: #98c379; color: #121212; }
        .ds-btn-warn { background: #e5c07b; color: #121212; }
        .ds-btn-abort { background: #e06c75; color: #fff; }
        .ds-btn-bypass { background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); }

        .ds-badge { background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-size: 0.8em; font-family: monospace; color: #56b6c2; }
        .ds-zen-icon { color: #c678dd; animation: dsPulse 2s infinite; }
        
        @keyframes dsFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes dsSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes dsPulse { 0% { opacity: 0.6; } 50% { opacity: 1; text-shadow: 0 0 5px #c678dd; } 100% { opacity: 0.6; } }
    `;
    document.head.appendChild(style);
};

// ==========================================
// 2. 狀態設定 (新增動態提示詞策略)
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
            dynPromptStrategy: oldSettings.dynPromptStrategy ?? 'ask', // ask, sink, inplace, freeze, delete
            logLevel: oldSettings.logLevel ?? 2,
            tolerance: oldSettings.tolerance ?? 1,
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
            Logger.log(`[免打扰] 已隐藏通知: ${msg}`, LogLevels.BASIC);
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
    error: (msg, err, level = LogLevels.BASIC) => logAt(level, 'error', err ? `${msg} ${err}` : msg),
    debug: (msg) => logAt(LogLevels.DEBUG, 'debug', msg),
    divider: (msg) => logAt(LogLevels.BASIC, 'divider', msg),
    normalize: (text) => (text || '').replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
};

// ==========================================
// 4. 純淨按鈕守護 (徹底移除所有輪詢監聽)
// ==========================================
function getChatKey() {
    const context = getContext();
    let charName = "未知角色";
    if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) charName = context.characters[context.characterId].name || context.characterId;
    else if (context.name2) charName = context.name2;
    let chatId = context.chatId || "默认聊天";
    let groupId = context.groupId;
    if (groupId) return { key: `group_${groupId}_${chatId}`, label: `群聊: ${chatId}` };
    return { key: `char_${context.characterId}_${chatId}`, label: `${charName} | 存档: ${chatId}` };
}

function getChatState(chatKeyInfo) {
    if (!Settings.chats[chatKeyInfo.key]) {
        Settings.chats[chatKeyInfo.key] = { label: chatKeyInfo.label, frozenSequence: [], lastSentSequence: [], lastPrefills: [], lastAccessed: Date.now() };
        safeSave(); 
    } else {
        Settings.chats[chatKeyInfo.key].lastAccessed = Date.now();
    }
    return Settings.chats[chatKeyInfo.key];
}

function resetCurrentCache() {
    if(!confirm("确定要清空当前对话的缓存吗？\n(这会让AI重新阅读整个对话，适合在觉得AI逻辑混乱时使用)")) return;
    const key = getChatKey().key;
    delete Settings.chats[key];
    safeSave(); 
    setTopBarStatus('#00ff00', '缓存: 已重置');
    if (typeof toastr !== 'undefined') toastr.success("当前聊天缓存已重置，下次发送将重新开始建档！");
    Logger.warn(`手动清空了当前对话缓存: ${key}`);
}

function ensureTopMenuButton() {
    if ($('#ds-top-reset-btn').length === 0) {
        const btn = $(`<li id="ds-top-reset-btn" class="menu_button interactable"><span class="fa-solid fa-microchip"></span><span id="ds-top-status-dot" style="font-size:0.7em; margin-left:2px; vertical-align:top;"></span></li>`);
        btn.on('click', (e) => { e.preventDefault(); Settings.enabled = !Settings.enabled; $('#ds-cache-enable').prop('checked', Settings.enabled); safeSave(); setTopBarStatus('#00ff00', Settings.enabled ? '运作中' : '已停用'); });
        btn.on('contextmenu', (e) => { e.preventDefault(); resetCurrentCache(); });
        if ($('ul#extensions_menu').length > 0) $('ul#extensions_menu').append(btn);
        else if ($('#right-nav-extensions').length > 0) $('#right-nav-extensions').append(btn);
    }
}

// 徹底摒棄輪詢！改用事件穿透綁定
function attachPureWandButtonHook() {
    $(document).off('click.dsWandHook').on('click.dsWandHook', '#extensions_button, .fa-wand-magic-sparkles', () => {
        setTimeout(() => {
            const extMenu = $('#extensions_menu');
            if (extMenu.length > 0 && $('#ds-bottom-reset-btn').length === 0) {
                const btn = $(`<li id="ds-bottom-reset-btn" class="menu_button interactable" title="清空当前聊天的缓存，让大模型完全重新阅读整个对话"><span class="fa-solid fa-broom" style="color: #e06c75;"></span> 清空当前对话缓存</li>`);
                btn.on('click', () => { resetCurrentCache(); if (extMenu.hasClass('open')) extMenu.removeClass('open').hide(); });
                extMenu.append(btn);
            }
        }, 20); // 延遲20ms等待ST渲染完菜單
    });
}

// ==========================================
// 5. 核心邏輯工具
// ==========================================
function createMsg(msg, tag) { return { role: msg.role, content: msg.content || '', norm: Logger.normalize(msg.content), len: (msg.content||'').length, tag: tag }; }
function getSimilarity(str1, str2) {
    if (str1 === str2) return 1;
    if (Math.abs(str1.length - str2.length) > Math.max(str1.length, str2.length) * 0.5) return 0;
    const s1 = str1.length < str2.length ? str1 : str2; const s2 = str1.length < str2.length ? str2 : str1;
    if (s1.length === 0) return 0;
    const bigrams = new Set(); for (let i = 0; i < s1.length - 1; i++) bigrams.add(s1.substring(i, i+2));
    let matchCount = 0; for (let i = 0; i < s2.length - 1; i++) if (bigrams.has(s2.substring(i, i+2))) matchCount++;
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
    if (modified) { content = content.replace(/^[\s\n]+/, ''); return { ...assistantObj, content: content, norm: Logger.normalize(content), len: content.length }; }
    return assistantObj;
}
function parseSTStream(stream) {
    const sysMsgs = []; const chatMsgs = [];
    for (const msg of stream) {
        if (msg.role === 'system' || (msg.role !== 'user' && msg.role !== 'assistant')) sysMsgs.push(createMsg(msg, 'SYS'));
        else chatMsgs.push(createMsg(msg, msg.role === 'user' ? 'USER' : 'AI'));
    }
    let lastUserIdx = -1;
    for (let i = chatMsgs.length - 1; i >= 0; i--) { if (chatMsgs[i].tag === 'USER') { lastUserIdx = i; break; } }
    let historyTurns = []; let currentTurn = { user: null, prefills: [] };
    if (lastUserIdx === -1) { currentTurn.prefills = chatMsgs.filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'})); } 
    else {
        const hMsgs = chatMsgs.slice(0, lastUserIdx); const cMsgs = chatMsgs.slice(lastUserIdx);
        currentTurn.user = cMsgs[0]; currentTurn.prefills = cMsgs.slice(1).filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'}));
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
// 6. 現代化攔截器 UI (雙重防線)
// ==========================================

// 防線1：動態提示詞處理專用彈窗
function askDynamicPromptAsync(oldContent, newContent) {
    return new Promise(resolve => {
        const html = `
            <div class="ds-overlay" id="ds-dyn-modal-wrapper">
                <div class="ds-modal" id="ds-dyn-modal-main">
                    <h2 class="ds-modal-title" style="color:#56b6c2;"><i class="fa-solid fa-radar"></i> 侦测到动态提示词变更</h2>
                    <p style="font-size: 13px; color: #abb2bf; margin-bottom:15px; line-height:1.5;">
                        <b>科普时间：</b>SillyTavern 有时会根据当前情况动态修改早期的提示词内容。如果在原位置更新它，会导致排在它后面的<b>所有历史缓存彻底作废！</b><br>
                        请选择您希望如何处理这个调皮的提示词：
                    </p>
                    
                    <div id="ds-dyn-view-diff">
                        <div class="ds-diff-del"><b>❌ 缓存中原有的旧内容:</b><br>${escapeHtml(oldContent)}</div>
                        <div class="ds-diff-add"><b>✅ ST试图写入的新内容:</b><br>${escapeHtml(newContent)}</div>
                    </div>
                    
                    <div id="ds-dyn-view-edit" style="display:none;">
                        <div style="margin-bottom:8px; color:#e5c07b;"><b>✏️ 请修改你想强制覆盖的文本：</b></div>
                        <textarea id="ds-dyn-edit-area" style="width:100%; height:180px; background:rgba(0,0,0,0.5); color:#fff; border:1px solid #56b6c2; border-radius:6px; padding:10px; font-family:monospace; resize:vertical;"></textarea>
                        <div class="ds-btn-grid">
                            <button class="ds-btn ds-btn-accept" id="ds-dyn-btn-save-edit"><i class="fa-solid fa-check"></i> 保存修改并原位更新</button>
                            <button class="ds-btn ds-btn-bypass" id="ds-dyn-btn-cancel-edit"><i class="fa-solid fa-xmark"></i> 取消编辑</button>
                        </div>
                    </div>
                    
                    <div class="ds-btn-grid three-col" id="ds-dyn-btn-group">
                        <button class="ds-btn ds-btn-sink" id="ds-dyn-btn-sink" title="强烈推荐！把它移动到队伍最后面。以后它再怎么变都不会影响前面的缓存了！"><i class="fa-solid fa-arrow-down"></i> 智能下沉 (推荐)</button>
                        <button class="ds-btn ds-btn-warn" id="ds-dyn-btn-inplace" title="在原位置更新。会导致这之后的聊天记录缓存全部作废，严重浪费算力！"><i class="fa-solid fa-rotate"></i> 原位同步 (掉缓存)</button>
                        <button class="ds-btn ds-btn-bypass" id="ds-dyn-btn-freeze" title="无视ST的修改，继续用旧的内容发送。完全不掉缓存，但可能影响逻辑。"><i class="fa-solid fa-snowflake"></i> 强制冻结旧版</button>
                        <button class="ds-btn ds-btn-abort" id="ds-dyn-btn-delete" title="直接把这整段提示词删掉，不发给AI。"><i class="fa-solid fa-trash"></i> 直接剔除</button>
                        <button class="ds-btn ds-btn-bypass" id="ds-dyn-btn-edit"><i class="fa-solid fa-pen-to-square"></i> 手动编辑</button>
                        <button class="ds-btn ds-btn-abort" id="ds-dyn-btn-abort" style="background:#e06c75;"><i class="fa-solid fa-hand-paper"></i> 物理切断发送</button>
                    </div>
                </div>
            </div>
        `;
        $('body').append(html);

        const cleanup = () => { $('#ds-dyn-modal-wrapper').remove(); document.removeEventListener('keydown', keyHandler, true); };
        
        $('#ds-dyn-btn-sink').click(() => { cleanup(); resolve({ action: 'sink', content: newContent }); });
        $('#ds-dyn-btn-inplace').click(() => { cleanup(); resolve({ action: 'inplace', content: newContent }); });
        $('#ds-dyn-btn-freeze').click(() => { cleanup(); resolve({ action: 'freeze', content: oldContent }); });
        $('#ds-dyn-btn-delete').click(() => { cleanup(); resolve({ action: 'delete' }); });
        $('#ds-dyn-btn-abort').click(() => { cleanup(); resolve({ action: 'abort' }); });

        $('#ds-dyn-btn-edit').click(() => {
            $('#ds-dyn-view-diff').hide(); $('#ds-dyn-btn-group').hide();
            $('#ds-dyn-edit-area').val(newContent);
            $('#ds-dyn-view-edit').show();
        });
        $('#ds-dyn-btn-cancel-edit').click(() => {
            $('#ds-dyn-view-edit').hide();
            $('#ds-dyn-view-diff').show(); $('#ds-dyn-btn-group').show();
        });
        $('#ds-dyn-btn-save-edit').click(() => {
            const val = $('#ds-dyn-edit-area').val();
            cleanup(); resolve({ action: 'edit', content: val });
        });

        const keyHandler = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cleanup(); resolve({ action: 'abort' }); } };
        document.addEventListener('keydown', keyHandler, true);
    });
}

// 防線2：歷史斷層警告 (>10% 流失)
function askUserForResetAsync(dropPercent, mapInfo) {
    return new Promise(resolve => {
        let progColor = '#98c379'; if (dropPercent >= 50) progColor = '#e06c75'; else if (dropPercent >= 20) progColor = '#e5c07b'; 
        const html = `
            <div class="ds-overlay" id="ds-modal-wrapper">
                <div class="ds-modal danger">
                    <h2 class="ds-modal-title"><span class="fa-solid fa-triangle-exclamation"></span> 严重缓存流失警告</h2>
                    <p style="line-height: 1.5; font-size:14px;">
                        检测到早期的历史对话被修改了。断点<b>之后的所有内容</b>（约 <b style="color:${progColor}">${dropPercent}%</b> 的文本）都必须重新消耗算力计算。<br>
                        您要如何处理本次发送？
                    </p>
                    <div class="ds-progress-container"><div class="ds-progress-bar" id="ds-prog-bar" style="background: ${progColor};"></div></div>
                    <div class="ds-map-box">${mapInfo}</div>
                    
                    <div class="ds-btn-grid">
                        <button class="ds-btn ds-btn-accept" id="ds-btn-accept"><i class="fa-solid fa-check"></i> 同步修复并发送 (接受损失)</button>
                        <button class="ds-btn ds-btn-abort" id="ds-btn-abort"><i class="fa-solid fa-hand-paper"></i> 物理切断发送 (让我退回去改改)</button>
                        <button class="ds-btn ds-btn-bypass" id="ds-btn-bypass"><i class="fa-solid fa-forward"></i> 临时放行 (按乱序发)</button>
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

        const keyHandler = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cleanup(); resolve('abort'); } };
        document.addEventListener('keydown', keyHandler, true);
    });
}

// ==========================================
// 7. 完美時序凍結演算法 (Dynamic Sniper)
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

        const { sysMsgs, historyTurns, currentTurn } = parseSTStream(stream);
        const flatHistoryPool = [];
        for(let t of historyTurns) {
            flatHistoryPool.push(t.user);
            if(t.assistant) flatHistoryPool.push(stripPrefillFromAssistant(t.assistant, state.lastPrefills));
        }

        let newFrozenSequence = [];
        const sysPool = [...sysMsgs];
        const remainingHistory = [...flatHistoryPool];
        const thresholds = getTolerance();
        
        let bottomQueue = []; // 用於裝載被下沉的動態提示詞
        
        // 計算最後一條歷史的索引 (判斷是否處於底部安全區)
        let lastHistoryIdx = -1;
        for (let idx = 0; idx < state.frozenSequence.length; idx++) {
            if (state.frozenSequence[idx].tag === 'USER' || state.frozenSequence[idx].tag === 'AI') lastHistoryIdx = idx;
        }

        // 1. 原位更新與動態提示詞嗅探
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
                    sysPool.splice(bestIdx, 1); 
                } else if (bestScore > thresholds.sys) {
                    const matchedItem = sysPool[bestIdx];
                    sysPool.splice(bestIdx, 1);
                    
                    if (i > lastHistoryIdx) {
                        // 已經在底部安全區，完美！直接原位更新，零干擾。
                        Logger.debug(`[安全区更新] 动态提示词已在尾部，自动原位更新 (相似度 ${(bestScore*100).toFixed(1)}%)`);
                        newFrozenSequence.push(matchedItem);
                    } else {
                        // 🚨 警報！在歷史頂端發現動態提示詞變更
                        Logger.warn(`[动态侦测] 索引[${i}] 发现动态提示词变更！`);
                        let decision = Settings.dynPromptStrategy;
                        let customContent = matchedItem.content;
                        
                        if (decision === 'ask') {
                            const result = await askDynamicPromptAsync(item.content, matchedItem.content);
                            decision = result.action;
                            if (decision === 'edit' || decision === 'sink' || decision === 'inplace') customContent = result.content;
                            if (decision === 'abort') {
                                stream.length = 0; // 物理抽空
                                throw new Error("【DS Cache 拦截】已彻底物理切断发送请求。");
                            }
                        }

                        matchedItem.content = customContent;
                        matchedItem.norm = Logger.normalize(customContent);
                        matchedItem.len = customContent.length;

                        if (decision === 'sink') {
                            Logger.map(`[策略: 下沉] 提示词已被强行抽取并排入末尾队列！`);
                            bottomQueue.push(matchedItem);
                        } else if (decision === 'inplace' || decision === 'edit') {
                            Logger.error(`[策略: 原位同步] 强行更新提示词，后方缓存将会失效。`, null, LogLevels.BASIC);
                            newFrozenSequence.push(matchedItem);
                        } else if (decision === 'freeze') {
                            Logger.log(`[策略: 冻结] 强行无视变动，维持旧文本。`);
                            newFrozenSequence.push(item);
                        } else if (decision === 'delete') {
                            Logger.log(`[策略: 剔除] 已将该提示词抹除。`);
                        }
                    }
                }
            } 
            else if (item.tag === 'USER' || item.tag === 'AI') {
                let bestIdx = -1, bestScore = 0;
                for (let j = 0; j < remainingHistory.length; j++) {
                    if (item.tag !== remainingHistory[j].tag) continue;
                    const score = getSimilarity(item.norm, remainingHistory[j].norm);
                    if (score > bestScore) { bestScore = score; bestIdx = j; }
                }
                if (bestScore >= thresholds.his) {
                    // 用戶/AI 歷史對話，嚴格遵守原位更新 (因為影響上下文理解)
                    if (bestScore < 1) Logger.debug(`[历史同步] 自动原位更新历史记录 (相似度 ${(bestScore*100).toFixed(1)}%)`);
                    newFrozenSequence.push(remainingHistory[bestIdx]);
                    remainingHistory.splice(bestIdx, 1);
                }
            }
        }

        // 2. 嚴格排序裝載 (新歷史 -> 新預設 -> 下沉的動態提示詞)
        for (let h of remainingHistory) { newFrozenSequence.push(h); Logger.debug(`[追加] 新历史对话`); }
        for (let sys of sysPool) { newFrozenSequence.push(sys); Logger.debug(`[追加] 新增设定/世界书`); }
        for (let b of bottomQueue) { newFrozenSequence.push(b); Logger.debug(`[沉底注入] 已下沉的动态提示词`); }

        // 去重
        let dedupedSequence = [];
        const seenSysNorms = new Set();
        for (const item of newFrozenSequence) {
            if (item.tag === 'SYS') { if (seenSysNorms.has(item.norm)) continue; seenSysNorms.add(item.norm); }
            dedupedSequence.push(item);
        }

        const proposedStream = [...dedupedSequence];
        if (currentTurn.user) proposedStream.push(currentTurn.user);
        for (const p of currentTurn.prefills) proposedStream.push(p);

        // ==========================================
        // 3. 嚴重流失率檢測 (>10% 彈窗防線)
        // ==========================================
        let requireResetConfirm = false;
        let dropPercentStr = "0.0";
        let mapInfoText = "无变更";

        if (state.lastSentSequence && state.lastSentSequence.length > 0) {
            const L = state.lastSentSequence; const P = proposedStream;
            let breakIndex = -1;
            for (let i = 0; i < Math.min(L.length, P.length); i++) { if (L[i].role !== P[i].role || L[i].norm !== P[i].norm) { breakIndex = i; break; } }
            if (breakIndex === -1) breakIndex = Math.min(L.length, P.length);

            let isPureContextShift = false;
            if (breakIndex > 0 && breakIndex < L.length && breakIndex < P.length) {
                let isAtHistoryStart = true;
                for (let i = 0; i < breakIndex; i++) { if (L[i].tag !== 'SYS' && L[i].role !== 'system') { isAtHistoryStart = false; break; } }
                if (isAtHistoryStart) {
                    for (let x = breakIndex + 1; x < L.length; x++) {
                        if (L[x].role === P[breakIndex].role && L[x].norm === P[breakIndex].norm) {
                            let deletedBlocks = L.slice(breakIndex, x);
                            if (!deletedBlocks.some(m => m.tag === 'SYS' || m.role === 'system')) isPureContextShift = true; break;
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
            
            if (isPureContextShift) { recomputeRatio = 0; Logger.log(`[自然推移] 旧历史自然挤出，不视为破坏。`, LogLevels.DETAILED); }

            if (recomputeRatio > 0.10 && Settings.showResetPrompt) {
                requireResetConfirm = true; dropPercentStr = (recomputeRatio * 100).toFixed(1);
                const tagHtml = `<span class="ds-tag ds-tag-${P[breakIndex]?.tag}">[${P[breakIndex]?.tag}]</span>`;
                const oldContent = escapeHtml(L[breakIndex]?.content || '∅').substring(0, 100).replace(/\n/g, ' ↵ ');
                const newContent = escapeHtml(P[breakIndex]?.content || '∅').substring(0, 100).replace(/\n/g, ' ↵ ');
                mapInfoText = `
                    <div><span style="color:#56b6c2;">📌 断裂点:</span> <b>[索引 ${breakIndex}]</b> ${tagHtml}</div>
                    <div class="ds-diff-del">❌ 原: ${oldContent}...</div>
                    <div class="ds-diff-add">✅ 新: ${newContent}...</div>
                    <div style="color:#98c379; margin-top:5px;">✅ 保持冻结: ${preservedLen} 字符 | ⚠️ 必须重算: <span style="color:#e06c75;">${recomputeLen} 字符</span></div>
                `;
            }
        }

        let decision = 'accept';
        setTopBarStatus('#00ff00', '缓存: 健康');

        if (requireResetConfirm) {
            setTopBarStatus('#ffaa00', `缓存: 修复确认中`);
            decision = await askUserForResetAsync(dropPercentStr, mapInfoText);
        }

        if (decision === 'abort') {
            Logger.error('[强制拦截] 已抛出严重错误以切断 ST 发送流。', null, LogLevels.BASIC);
            setTopBarStatus('#e06c75', '缓存: 已切断');
            if (typeof toastr !== 'undefined') toastr.error("已物理切断本次发送请求！", "优化器");
            stream.length = 0; 
            throw new Error("【DS Cache 拦截】用户主动拦截了发送请求。");
        }

        if (decision === 'bypass') {
            Logger.warn('[临时放行] 按乱序发送。');
            setTopBarStatus('#e5c07b', '缓存: 临时放行');
            return; 
        }

        // 授權發送
        state.frozenSequence = dedupedSequence;
        state.lastPrefills = currentTurn.prefills;
        state.lastSentSequence = proposedStream;
        safeSave();

        stream.splice(0, stream.length, ...proposedStream.map(i => ({ role: i.role, content: i.content })));
        Logger.log(`✅ 排序完美收官，授权发送。耗时: ${(performance.now() - startTime).toFixed(2)}ms`, LogLevels.BASIC);

    } catch (err) {
        if (err.message.includes("DS Cache")) {
            // 用戶主動攔截，非崩潰
            throw err;
        }
        setTopBarStatus('#e06c75', '缓存: 崩溃');
        Logger.error('核心运算崩溃', err);
        throw err;
    }
}

// ==========================================
// 8. UI 面板與高階事件綁定
// ==========================================
async function setupUI() {
    try {
        injectCSS();
        const html = `
        <div class="inline-drawer" id="ds-v25-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><span class="fa-solid fa-microchip"></span> DeepSeek 缓存优化器 (v25)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:15px; background: rgba(0,0,0,0.1);">
                
                <!-- 基础设置 -->
                <div class="ds-opt-group open">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-sliders"></i> 基础开关</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div class="ds-row"><label class="ds-row-left" style="color:#00e5ff; font-weight:bold;"><input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}> ✅ 开启缓存优化 (核心防线)</label></div>
                        <div class="ds-row"><label class="ds-row-left" style="color:#c678dd;"><input type="checkbox" id="ds-cache-zen" ${Settings.zenMode ? 'checked' : ''}> 🧘 免打扰模式 (隐藏所有右上角黑框通知)</label></div>
                    </div>
                </div>

                <!-- 动态提示词与缓存断层处理 -->
                <div class="ds-opt-group open">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-radar"></i> 动态提示词处理策略 (必看)</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <p style="font-size:11px; color:#abb2bf; margin:0 0 5px 0;"><b>小白科普：</b>有些设定(如包含当前时间的提示词)每次对话都会变。如果它们排在上方，每次变动都会炸毁所有缓存。请选择遇到这种"插队变动"时的自动处理策略：</p>
                        <div class="ds-row">
                            <select id="ds-cache-dyn-strategy" class="text_pole" style="width:100%; padding:5px; font-weight:bold;">
                                <option value="ask" ${Settings.dynPromptStrategy==='ask'?'selected':''}>🤚 每次弹窗让我手动决定 (推荐小白)</option>
                                <option value="sink" ${Settings.dynPromptStrategy==='sink'?'selected':''}>⬇️ 自动下沉到最尾部 (推荐老手，一劳永逸)</option>
                                <option value="inplace" ${Settings.dynPromptStrategy==='inplace'?'selected':''}>🔄 自动原位更新 (警告：严重浪费算力)</option>
                                <option value="freeze" ${Settings.dynPromptStrategy==='freeze'?'selected':''}>❄️ 自动强制冻结 (无视新变动，保持旧设定)</option>
                                <option value="delete" ${Settings.dynPromptStrategy==='delete'?'selected':''}>🗑️ 自动彻底剔除 (发现变动直接删除)</option>
                            </select>
                        </div>
                        <hr style="border:0; border-top:1px dashed rgba(255,255,255,0.1); width:100%; margin:5px 0;">
                        <div class="ds-row"><label class="ds-row-left" style="color:#e06c75;"><input type="checkbox" id="ds-toast-reset" ${Settings.showResetPrompt ? 'checked' : ''}> 🛑 当发送可能导致【巨量缓存失效 (>10%)】时，弹出严重警告窗口</label></div>
                    </div>
                </div>
                
                <!-- 高级参数 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-gears"></i> 高级参数 (如不懂勿动)</span> <i class="fa-solid fa-chevron-down"></i>
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
                            <span style="font-size:0.85em; color:#abb2bf;">日志终端详细度:</span>
                            <select id="ds-cache-loglevel" class="text_pole" style="width:110px; padding:2px;">
                                <option value="0" ${Settings.logLevel===0?'selected':''}>关闭</option>
                                <option value="1" ${Settings.logLevel===1?'selected':''}>基础</option>
                                <option value="2" ${Settings.logLevel===2?'selected':''}>详细</option>
                                <option value="3" ${Settings.logLevel===3?'selected':''}>极客(侦错)</option>
                            </select>
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
                            <div style="flex:1;"></div>
                            <span id="ds-btn-clearlog" class="ds-mini-btn" style="color:#e06c75; cursor:pointer;"><i class="fa-solid fa-trash"></i></span>
                        </div>
                        <div id="ds-cache-log-container" class="ds-log-terminal"></div>
                    </div>
                </div>
            </div>
        </div>`;
        
        $('#extensions_settings').append(html);

        // UI 事件綁定
        $('#ds-cache-enable').on('change', function () { Settings.enabled = $(this).is(':checked'); safeSave(); setTopBarStatus('#00ff00', Settings.enabled ? '运作中' : '已停用'); });
        $('#ds-cache-zen').on('change', function () { Settings.zenMode = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-dyn-strategy').on('change', function () { Settings.dynPromptStrategy = $(this).val(); safeSave(); });
        $('#ds-toast-reset').on('change', function () { Settings.showResetPrompt = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-tolerance').on('change', function () { Settings.tolerance = parseInt($(this).val()); safeSave(); });
        $('#ds-cache-loglevel').on('change', function () { Settings.logLevel = parseInt($(this).val()); safeSave(); });
        
        $('.ds-log-filter').on('click', function() {
            $('.ds-log-filter').removeClass('active'); $(this).addClass('active'); const f = $(this).data('filter');
            $('#ds-cache-log-container .ds-log-line').each(function() {
                if (f === 'all' || $(this).data('type') === f || $(this).data('type') === 'divider') $(this).removeClass('hide'); else $(this).addClass('hide');
            });
        });
        $('#ds-btn-clearlog').on('click', () => $('#ds-cache-log-container').empty());

    } catch (e) { console.error('[DS Cache] UI初始化崩潰', e); }
}

jQuery(async () => {
    try {
        initSettings(); 
        await setupUI();
        
        setTimeout(() => ensureTopMenuButton(), 2000);
        
        // 純淨魔杖事件綁定 (不使用任何 Interval/Observer)
        attachPureWandButtonHook();
        
        if (eventSource) {
            eventSource.on(event_types.CHAT_CHANGED, () => { ensureTopMenuButton(); attachPureWandButtonHook(); });
            if (event_types?.CHAT_COMPLETION_PROMPT_READY) eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        }

        Logger.log('══════ DeepSeek 缓存优化器 v25 引擎上线 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件启动失败:', e);
    }
});
