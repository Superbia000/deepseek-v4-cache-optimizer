import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 1. 樣式注入 (Singularity UI)
// ==========================================
const injectCSS = () => {
    if (document.getElementById('ds-cache-styles')) return;
    const style = document.createElement('style');
    style.id = 'ds-cache-styles';
    style.innerHTML = `
        :root { --ds-cyan: #00e5ff; --ds-purple: #c678dd; --ds-green: #98c379; --ds-red: #e06c75; --ds-yellow: #e5c07b; --ds-bg: rgba(10, 15, 20, 0.7); --ds-border: rgba(0, 229, 255, 0.2); }
        .ds-gpu-accel { transform: translateZ(0); will-change: transform; backface-visibility: hidden; perspective: 1000px; }
        .ds-strict-contain { contain: strict; }
        .ds-virtual-list { content-visibility: auto; contain-intrinsic-size: 1px 60px; }
        .ds-scroll::-webkit-scrollbar { width: 6px; }
        .ds-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.3); border-radius: 4px; }
        .ds-scroll::-webkit-scrollbar-thumb { background: rgba(0, 229, 255, 0.4); border-radius: 4px; }
        .ds-scroll::-webkit-scrollbar-thumb:hover { background: rgba(0, 229, 255, 0.8); }
        
        .ds-engine-card { background: linear-gradient(145deg, rgba(0,0,0,0.6) 0%, rgba(15,20,25,0.8) 100%); border: 1px solid var(--ds-border); border-radius: 12px; padding: 16px; margin-bottom: 15px; transition: all 0.3s ease; position: relative; overflow: hidden; }
        .ds-engine-card:hover { border-color: var(--ds-cyan); box-shadow: 0 8px 25px rgba(0, 229, 255, 0.15); transform: translateY(-2px); }
        .ds-engine-card::before { content: ''; position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: var(--ds-cyan); box-shadow: 0 0 10px var(--ds-cyan); }
        .ds-engine-card.engine-purple::before { background: var(--ds-purple); box-shadow: 0 0 10px var(--ds-purple); }
        .ds-engine-card.engine-green::before { background: var(--ds-green); box-shadow: 0 0 10px var(--ds-green); }
        .ds-engine-card.engine-yellow::before { background: var(--ds-yellow); box-shadow: 0 0 10px var(--ds-yellow); }
        
        .ds-engine-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .ds-engine-title { font-size: 16px; font-weight: bold; color: #fff; display: flex; align-items: center; gap: 8px; }
        .ds-engine-desc { font-size: 12px; color: #abb2bf; line-height: 1.5; margin-bottom: 12px; }
        .ds-engine-tags { display: flex; flex-wrap: wrap; gap: 6px; }
        .ds-engine-tag { font-size: 10px; padding: 2px 6px; background: rgba(255,255,255,0.05); border-radius: 4px; color: #8b9eb0; border: 1px solid rgba(255,255,255,0.1); }
        
        .ds-toggle-switch { position: relative; display: inline-block; width: 44px; height: 24px; }
        .ds-toggle-switch input { opacity: 0; width: 0; height: 0; }
        .ds-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(255,255,255,0.1); transition: .4s; border-radius: 24px; border: 1px solid rgba(255,255,255,0.2); }
        .ds-slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background-color: #fff; transition: .4s; border-radius: 50%; }
        input:checked + .ds-slider { background-color: var(--ds-cyan); border-color: var(--ds-cyan); box-shadow: 0 0 10px rgba(0,229,255,0.5); }
        input:checked + .ds-slider:before { transform: translateX(20px); }
        
        .ds-opt-group { margin-bottom: 15px; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; background: rgba(0,0,0,0.4); overflow: hidden; transition: all 0.3s ease; }
        .ds-opt-header { padding: 14px 18px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #fff; background: rgba(255,255,255,0.02); font-size: 14px; }
        .ds-opt-header:hover { background: rgba(255,255,255,0.05); }
        .ds-opt-content { padding: 18px; display: flex; flex-direction: column; gap: 14px; display: none; border-top: 1px solid rgba(255,255,255,0.03); }
        .ds-opt-group.open .ds-opt-content { display: flex; animation: dsFadeIn 0.3s ease; }
        .ds-opt-group.open .ds-opt-header i.fa-chevron-down { transform: rotate(180deg); }

        .ds-row { display: flex; flex-direction: row; justify-content: space-between; align-items: center; width: 100%; gap: 12px; }
        .ds-row-left { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; color: #abb2bf; font-size: 13px; flex: 1; line-height: 1.5; }
        .ds-row-left input[type="checkbox"] { margin-top: 3px; transform: scale(1.15); accent-color: var(--ds-cyan); }
        .ds-row-text { display: flex; flex-direction: column; flex: 1; }
        .ds-row-text b { color: #fff; font-weight: 600; }
        .ds-row-text span { font-size: 11px; color: rgba(171, 178, 191, 0.8); margin-top: 2px; }

        .ds-select-styled { background: rgba(0,0,0,0.5); color: var(--ds-cyan); border: 1px solid var(--ds-border); padding: 8px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; outline: none; width: 100%; }
        .ds-input-styled { background: rgba(0,0,0,0.5); color: #fff; border: 1px solid rgba(255,255,255,0.1); padding: 6px 10px; border-radius: 6px; font-size: 12px; outline: none; width: 100%; }

        .ds-log-terminal { background: #05070a; color: #a9b7c6; font-family: 'Fira Code', monospace; font-size: 12px; height: 300px; overflow-y: auto; border-radius: 8px; padding: 15px; border: 1px solid rgba(0,229,255,0.3); box-shadow: inset 0 0 20px rgba(0,0,0,0.9); }
        .ds-log-line { margin-bottom: 6px; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 6px; display: flex; }
        .ds-log-time { color: #5c6370; margin-right: 10px; font-size: 10px; flex-shrink: 0; margin-top: 2px; }
        .ds-log-content { flex: 1; word-wrap: break-word; }
        .ds-log-info { color: var(--ds-green); }
        .ds-log-warn { color: var(--ds-yellow); }
        .ds-log-error { color: var(--ds-red); }
        .ds-log-map { color: var(--ds-cyan); }
        .ds-log-debug { color: var(--ds-purple); }
        .ds-log-divider { color: #4b5263; font-weight: bold; text-align: center; margin: 10px 0; width: 100%; }

        .ds-chat-container { max-height:250px; overflow-y:auto; border:1px solid rgba(255,255,255,0.05); padding:10px; border-radius:8px; background: rgba(0,0,0,0.4); }
        .ds-chat-item { display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:12px; margin-bottom:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.05); }
        .ds-chat-item.active-chat { border-left: 4px solid var(--ds-cyan); background: linear-gradient(90deg, rgba(0,229,255,0.1) 0%, rgba(0,0,0,0) 100%); }

        .ds-btn { padding: 12px 16px; border: 1px solid transparent; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 14px; display:flex; align-items:center; justify-content:center; gap:10px; transition: 0.2s; background: rgba(255,255,255,0.08); color: #fff; }
        .ds-btn:hover { background: rgba(255,255,255,0.15); transform: translateY(-2px); }
        .ds-btn-blue { border-color: rgba(0,229,255,0.5); color: var(--ds-cyan); }
        .ds-btn-blue:hover { background: rgba(0,229,255,0.1); box-shadow: 0 0 15px rgba(0,229,255,0.3); }

        .ds-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.9); backdrop-filter: blur(10px); z-index: 999999; display: flex; align-items: center; justify-content: center; animation: dsFadeIn 0.2s; }
        .ds-modal { background: #15181e; border: 1px solid var(--ds-cyan); padding: 30px; border-radius: 12px; max-width: 600px; width: 90%; color: #fff; box-shadow: 0 20px 50px rgba(0,0,0,0.8); }
        
        @keyframes dsFadeIn { from { opacity: 0; } to { opacity: 1; } }
    `;
    document.head.appendChild(style);
};

// ==========================================
// 2. 狀態設定與 RAM 分離架構 (防 Quota 崩潰)
// ==========================================
let Settings = {};
let RuntimeState = {}; // 🚀 純 RAM 儲存區 (存放 Multiverse 等巨量資料，不寫入硬碟)
let sessionSnoozeReset = false; 

function initSettings() {
    const old = extension_settings.ds_cache_v45 || extension_settings.ds_cache_v44 || {};
    if (!extension_settings.ds_cache_v46) {
        extension_settings.ds_cache_v46 = {
            enabled: old.enabled ?? true,
            zenMode: old.zenMode ?? false,
            // 🚀 4 大核心引擎開關
            engineStasis: true,    // 絕對靜止引擎
            enginePatching: true,  // 量子補丁矩陣
            engineSink: true,      // 流形沉澱池
            engineNavigator: true, // 時間線導航儀
            
            // 核心策略選擇
            dynamicMode: old.dynamicMode ?? 1, 
            historyEditMode: old.historyEditMode ?? 1, 
            
            // 基礎設定
            toastHistory: old.toastHistory ?? true,
            showResetPrompt: old.showResetPrompt ?? true,
            autoAccept: old.autoAccept ?? false,
            logLevel: old.logLevel ?? 2,
            maxCacheSize: 15, // 降低預設值防崩潰
            autoPinThreshold: old.autoPinThreshold ?? 0,
            
            chats: old.chats || {},
            pinnedChats: old.pinnedChats || {} 
        };
    }
    Settings = extension_settings.ds_cache_v46;
    if (!Settings.pinnedChats) Settings.pinnedChats = {};
    if (!Settings.chats) Settings.chats = {}; 
}

let saveTimeout = null;
let pendingSave = false;

function flushSaveSync() {
    if (pendingSave) {
        try { 
            if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced(); 
            // 🛡️ 防崩潰裝甲：攔截 localStorage 錯誤
            try { localStorage.setItem('ds_cache_v46_backup', JSON.stringify(Settings)); } 
            catch (e) { console.warn("[DS Cache] LocalStorage 空間不足，已跳過本地備份，但不影響主程式運行。"); }
        } catch (e) { console.error("[DS Cache] 儲存設定失敗", e); }
        pendingSave = false; saveTimeout = null;
    }
}

function safeSave() {
    pendingSave = true;
    if (saveTimeout) return;
    const saveTask = () => { flushSaveSync(); };
    if ('requestIdleCallback' in window) saveTimeout = requestIdleCallback(saveTask, { timeout: 2000 });
    else saveTimeout = setTimeout(saveTask, 1000);
}

function getChatKey() {
    const context = getContext();
    let charName = context.characters?.[context.characterId]?.name || context.name2 || "未知角色";
    let chatId = context.chatId || "默认聊天";
    return { key: context.groupId ? `group_${context.groupId}_${chatId}` : `char_${context.characterId}_${chatId}`, label: `${charName} | ${chatId}` };
}

function getChatState(chatKeyInfo) {
    const key = chatKeyInfo.key;
    if (!Settings.chats[key]) {
        Settings.chats[key] = { label: chatKeyInfo.label, frozenSequence: [], lastSentSequence: [], lastPrefills: [], lastAccessed: Date.now(), dynamicAnomalies: [] };
        safeSave(); renderChatsUI();
    } else {
        Settings.chats[key].lastAccessed = Date.now();
    }
    // 🚀 初始化 RAM 儲存區
    if (!RuntimeState[key]) RuntimeState[key] = { multiverse: [] };
    return { disk: Settings.chats[key], ram: RuntimeState[key] };
}

function performGarbageCollection() {
    const unpinnedKeys = Object.keys(Settings.chats).filter(k => !Settings.pinnedChats[k]);
    if (unpinnedKeys.length <= Settings.maxCacheSize) return;
    const sortedKeys = unpinnedKeys.sort((a, b) => (Settings.chats[a].lastAccessed || 0) - (Settings.chats[b].lastAccessed || 0));
    const toRemove = sortedKeys.slice(0, unpinnedKeys.length - Settings.maxCacheSize);
    toRemove.forEach(k => { delete Settings.chats[k]; delete RuntimeState[k]; });
    safeSave(); renderChatsUI();
}

// ==========================================
// 3. Omni-Log & 工具函數
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3, TRACE: 4 };
let logQueue = []; let isLogRendering = false;

function logAt(level, type, msg) {
    if (Settings.logLevel < level) return;
    const time = new Date().toISOString().substr(11, 12);
    logQueue.push({ time, type, msg });
    if (logQueue.length > 300) logQueue.shift();
    if (!isLogRendering) { isLogRendering = true; requestAnimationFrame(renderLogs); }
}

function renderLogs() {
    const container = document.getElementById('ds-cache-log-container');
    if (!container) { isLogRendering = false; return; }
    const fragment = document.createDocumentFragment();
    while (logQueue.length > 0) {
        const d = logQueue.shift();
        const div = document.createElement('div'); div.className = 'ds-log-line';
        if (d.type === 'divider') div.innerHTML = `<span class="ds-log-divider">${d.msg}</span>`;
        else div.innerHTML = `<span class="ds-log-time">[${d.time}]</span> <span class="ds-log-content ds-log-${d.type}">${d.msg.replace(/\n/g, '<br>')}</span>`;
        fragment.appendChild(div);
    }
    container.appendChild(fragment);
    while (container.childNodes.length > 500) container.removeChild(container.firstChild);
    container.scrollTop = container.scrollHeight;
    isLogRendering = false;
}

const Logger = {
    log: (msg, lvl = 2) => logAt(lvl, 'info', msg),
    warn: (msg, lvl = 1) => logAt(lvl, 'warn', msg),
    map: (msg, lvl = 1) => logAt(lvl, 'map', msg),
    error: (msg, err, lvl = 1) => logAt(lvl, 'error', err ? `${msg} ${err}` : msg),
    debug: (msg) => logAt(3, 'debug', msg),
    divider: (msg) => logAt(1, 'divider', msg),
    normalize: (text) => text ? text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim() : ''
};

function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function createMsg(msg, tag) {
    const content = msg.content || ''; const norm = Logger.normalize(content); const hash = cyrb53(norm);
    return { role: msg.role, content, norm, hash, originalHash: hash, tag };
}

function getSimilarity(msg1, msg2) {
    if (msg1.hash === msg2.hash || (msg1.originalHash && msg2.originalHash && msg1.originalHash === msg2.originalHash)) return 1;
    const s1 = msg1.norm; const s2 = msg2.norm;
    if (Math.abs(s1.length - s2.length) > Math.max(s1.length, s2.length) * 0.5) return 0;
    if (s1 === s2) return 1;
    if (s1.length > 10 && s2.includes(s1)) return 0.95;
    return 0; // 簡化比對邏輯，提升效能
}

function findBestMatch(targetMsg, poolArray, excludeSet) {
    let bestIdx = -1; let bestScore = 0;
    for (let i = 0; i < poolArray.length; i++) {
        if (excludeSet && excludeSet.has(i)) continue; 
        if (targetMsg.tag !== poolArray[i].tag && !(targetMsg.tag === 'SYS' && poolArray[i].tag === 'SYS')) continue;
        const score = getSimilarity(targetMsg, poolArray[i]);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
        if (score === 1) break; 
    }
    return { index: bestIdx, score: bestScore };
}

function escapeHtml(text) { return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function truncateLog(str, len = 30) { const s = String(str||'').replace(/\n/g, ' '); return s.length > len ? s.substring(0, len) + '...' : s; }

// ==========================================
// 4. 核心攔截器 (v46 Singularity Engine)
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (!Settings.enabled || data.dryRun) return;
    const startTime = performance.now();
    const chatKeyInfo = getChatKey();

    try {
        const { disk: state, ram: runtime } = getChatState(chatKeyInfo);
        if (!data?.chat?.length) return;
        const stream = data.chat;

        Logger.divider(`===== 🌌 奇点引擎启动: ${chatKeyInfo.label} =====`);

        // --- 階段 1：解析與過濾 ---
        const incomingSys = []; const incomingHis = [];
        for (const msg of stream) {
            if (!msg.content) continue;
            // 🧭 時間線導航儀：曲率過濾
            if (Settings.engineNavigator && msg.content.replace(/[\s\*\.\-]/g, '').length === 0) {
                Logger.trace(`[🧭 导航仪] 过滤零熵空白节点。`); continue;
            }
            if (msg.role === 'system' || (msg.role !== 'user' && msg.role !== 'assistant')) {
                const sysNode = createMsg(msg, 'SYS');
                if (/(later|next day|第二天|几个小时后|一段时间后)/i.test(sysNode.content)) sysNode.isTimeSkip = true;
                if (/(retrieved context|search results|vector database|相关记忆)/i.test(sysNode.content)) sysNode.isVector = true;
                if (/(summary|previously on|摘要|前情提要)/i.test(sysNode.content)) sysNode.isSummary = true;
                incomingSys.push(sysNode);
            } else {
                incomingHis.push(createMsg(msg, msg.role === 'user' ? 'USER' : 'AI'));
            }
        }

        let lastUserIdx = -1;
        for (let i = incomingHis.length - 1; i >= 0; i--) { if (incomingHis[i].tag === 'USER') { lastUserIdx = i; break; } }
        let currentTurn = { user: null, prefills: [] }; let parsedHis = [];
        if (lastUserIdx === -1) {
            currentTurn.prefills = incomingHis.filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'}));
        } else {
            parsedHis = incomingHis.slice(0, lastUserIdx);
            const cMsgs = incomingHis.slice(lastUserIdx);
            currentTurn.user = cMsgs[0];
            currentTurn.prefills = cMsgs.slice(1).filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'}));
        }

        // --- 階段 2：平行宇宙導航 (純 RAM) ---
        if (Settings.engineNavigator && runtime.multiverse.length > 0) {
            let bestUniverse = state.frozenSequence; let bestMatchCount = -1;
            const currentHistoryNorms = parsedHis.map(m => m.norm); 
            for (const universe of runtime.multiverse) {
                const uHisNorms = universe.filter(m => m.tag === 'USER' || m.tag === 'AI').map(m => m.norm);
                let matchCount = 0;
                for (let j = 0; j < Math.min(uHisNorms.length, currentHistoryNorms.length); j++) {
                    if (uHisNorms[j] === currentHistoryNorms[j]) matchCount++; else break;
                }
                if (matchCount > bestMatchCount) { bestMatchCount = matchCount; bestUniverse = universe; }
            }
            if (bestUniverse !== state.frozenSequence) {
                Logger.map(`[🧭 导航仪] 检测到分支切换，跳跃至平行宇宙。`);
                state.frozenSequence = bestUniverse;
            }
        }

        // --- 階段 3：大一統 Diffing 引擎 ---
        const frozen = state.frozenSequence || [];
        let nextFrozen = []; let patches = []; let dynamicAppends = []; let newSysAppends = []; let ephemeralBottom = []; 
        let matchedIncomingHis = new Set(); let matchedIncomingSys = new Set();
        
        let headTruncationCount = 0; let middleDeletionCount = 0;
        let hasMatchedAnyHistory = false; let maxMatchedIncomingIdx = -1;   

        for (let i = 0; i < frozen.length; i++) {
            const fNode = frozen[i]; let keepFrozen = true;

            if (fNode.tag === 'PATCH' || fNode.tag === 'DIARY') { nextFrozen.push(fNode); continue; }

            if (fNode.tag === 'USER' || fNode.tag === 'AI') {
                let match = findBestMatch(fNode, parsedHis, matchedIncomingHis); 
                if (match.score === 1) {
                    matchedIncomingHis.add(match.index); maxMatchedIncomingIdx = Math.max(maxMatchedIncomingIdx, match.index); hasMatchedAnyHistory = true;
                } else if (match.score > 0.1) {
                    matchedIncomingHis.add(match.index); maxMatchedIncomingIdx = Math.max(maxMatchedIncomingIdx, match.index); hasMatchedAnyHistory = true;
                    // 🧬 量子補丁：歷史修改
                    if (Settings.enginePatching) {
                        if (match.score > 0.95) patches.push(createMsg({role: 'system', content: `[系统提示：错字修正。"${truncateLog(fNode.content)}" -> "${truncateLog(parsedHis[match.index].content)}"]`}, 'PATCH'));
                        else if (Settings.historyEditMode === 1) patches.push(createMsg({role: 'system', content: `[系统提示：时空修正。之前的对话已改变，最新情况为："${parsedHis[match.index].content}"]`}, 'PATCH'));
                        else { keepFrozen = false; nextFrozen.push(parsedHis[match.index]); }
                    } else { keepFrozen = false; nextFrozen.push(parsedHis[match.index]); }
                } else {
                    // 🧬 量子補丁：歷史刪除
                    if (!hasMatchedAnyHistory) {
                        if (i === 0 && Settings.engineNavigator) Logger.debug(`[🧭 导航仪] 绝对前缀锚点锁定。`);
                        else { headTruncationCount++; keepFrozen = false; }
                    } else {
                        middleDeletionCount++; keepFrozen = false;
                        if (Settings.enginePatching && middleDeletionCount <= 3) patches.push(createMsg({role: 'system', content: `[系统提示：记忆抹除。事件 "${truncateLog(fNode.content)}" 已被抹除。]`}, 'PATCH'));
                    }
                }
            } else if (fNode.tag === 'SYS') {
                let match = findBestMatch(fNode, incomingSys, matchedIncomingSys); 
                if (match.score === 1) {
                    matchedIncomingSys.add(match.index);
                } else if (match.score > 0.1) {
                    matchedIncomingSys.add(match.index);
                    // 🧬 量子補丁：設定修改
                    if (Settings.enginePatching && i === 0) {
                        patches.push(createMsg({role: 'system', content: `[系统提示：角色设定热更新：\n${incomingSys[match.index].content}]`}, 'PATCH'));
                    } else if (Settings.engineSink) {
                        // 🌊 流形沉澱池：動態提示詞
                        if (Settings.dynamicMode === 1 && fNode.content.length < 300) dynamicAppends.push({...incomingSys[match.index], tag: 'DIARY'});
                        else if (Settings.dynamicMode === 2) { keepFrozen = false; dynamicAppends.push(incomingSys[match.index]); }
                        else if (Settings.dynamicMode === 4) { keepFrozen = false; nextFrozen.push(incomingSys[match.index]); }
                        else if (Settings.dynamicMode === 5) keepFrozen = false;
                    } else { keepFrozen = false; nextFrozen.push(incomingSys[match.index]); }
                } else {
                    // 🧊 絕對靜止：永久烙印
                    if (!Settings.engineStasis) keepFrozen = false;
                }
            }
            if (keepFrozen) nextFrozen.push(fNode);
        }

        if (Settings.enginePatching) {
            if (headTruncationCount > 5) patches.push(createMsg({role: 'system', content: `[系统提示：早期记忆已归档。]`}, 'PATCH'));
            if (middleDeletionCount > 3 && middleDeletionCount <= 5) patches.push(createMsg({role: 'system', content: `[系统提示：上下文发生跳跃。]`}, 'PATCH'));
        }

        // 處理未匹配的歷史 (新對話 / 閃回)
        for (let i = 0; i < parsedHis.length; i++) {
            if (!matchedIncomingHis.has(i)) {
                if (Settings.enginePatching && maxMatchedIncomingIdx !== -1 && i < maxMatchedIncomingIdx) {
                    patches.push(createMsg({role: 'system', content: `[系统提示：闪回补充。\n${parsedHis[i].content}]`}, 'PATCH'));
                } else nextFrozen.push(parsedHis[i]);
            }
        }

        // 處理未匹配的系統提示詞
        const unmatchedSys = incomingSys.filter((_, i) => !matchedIncomingSys.has(i));
        if (Settings.engineStasis) unmatchedSys.sort((a, b) => a.hash - b.hash);

        const seenSysHashes = new Set(nextFrozen.filter(n => n.tag === 'SYS').map(n => n.hash));
        for (const node of unmatchedSys) {
            if (Settings.engineStasis && seenSysHashes.has(node.hash)) continue; // 去重
            seenSysHashes.add(node.hash);

            if (Settings.enginePatching && node.isTimeSkip) {
                let cNode = { ...node, content: `[系统提示：叙事过渡。${node.content}]`, tag: 'PATCH' };
                newSysAppends.push(cNode);
            } else if (Settings.engineSink && (node.isVector || node.isSummary)) {
                ephemeralBottom.push(node);
            } else {
                newSysAppends.push(node);
            }
        }

        // --- 階段 4：統一組裝 ---
        const proposedStream = [ ...nextFrozen, ...newSysAppends, ...dynamicAppends, ...patches, ...ephemeralBottom ];
        if (currentTurn.user) proposedStream.push(currentTurn.user);
        for (const p of currentTurn.prefills) proposedStream.push(p);

        // --- 階段 5：狀態更新與 RAM 寫入 ---
        let finalFrozen = [...nextFrozen, ...newSysAppends, ...dynamicAppends, ...patches];
        
        // 垃圾回收：限制 DIARY 和 PATCH 數量
        const limitNodes = (arr, tag, limit) => {
            let count = arr.filter(n => n.tag === tag).length;
            if (count <= limit) return arr;
            let remove = count - limit;
            return arr.filter(n => { if (n.tag === tag && remove > 0) { remove--; return false; } return true; });
        };
        finalFrozen = limitNodes(finalFrozen, 'DIARY', 10);
        finalFrozen = limitNodes(finalFrozen, 'PATCH', 10);

        state.frozenSequence = finalFrozen;
        state.lastSentSequence = proposedStream;
        
        // 🚀 純 RAM 寫入平行宇宙 (不存硬碟)
        if (Settings.engineNavigator) {
            runtime.multiverse.unshift([...state.frozenSequence]);
            if (runtime.multiverse.length > 3) runtime.multiverse.pop();
        }

        safeSave();
        stream.splice(0, stream.length, ...proposedStream.map(i => ({ role: i.role, content: i.content })));
        Logger.log(`🌌 奇点引擎处理完成。节点数: ${proposedStream.length} | 耗时: ${(performance.now() - startTime).toFixed(1)}ms`, 1);

    } catch (err) {
        setTopBarStatus('#e06c75', '缓存: 发生崩溃');
        Logger.error('核心运算崩溃', err); throw err;
    }
}

// ==========================================
// 5. UI 面板 (Singularity UI)
// ==========================================
function renderChatsUI() {
    const container = $('#ds-chat-list-container'); if (container.length === 0) return;
    container.empty();
    const keys = Object.keys(Settings.chats);
    if (keys.length === 0) { container.append('<div style="text-align:center; color:#5c6370; padding:20px;">记忆矩阵为空</div>'); return; }

    const currentKey = getChatKey().key; 
    const sortedKeys = keys.sort((a, b) => {
        if (a === currentKey) return -1; if (b === currentKey) return 1;
        const pinA = Settings.pinnedChats[a] ? 1 : 0; const pinB = Settings.pinnedChats[b] ? 1 : 0;
        if (pinA !== pinB) return pinB - pinA;
        return (Settings.chats[b].lastAccessed || 0) - (Settings.chats[a].lastAccessed || 0);
    });

    const fragment = document.createDocumentFragment();
    sortedKeys.forEach(key => {
        const chat = Settings.chats[key]; const isActive = (key === currentKey); const isPinned = Settings.pinnedChats[key];
        const item = document.createElement('div');
        item.className = `ds-chat-item ${isActive ? 'active-chat' : ''}`;
        item.innerHTML = `
            <div style="flex:1; overflow:hidden;">
                <div style="font-weight:bold; color:${isActive?'var(--ds-cyan)':'#fff'}; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(chat.label)}</div>
                <div style="font-size:11px; color:#8b9eb0; margin-top:4px;">节点: ${chat.frozenSequence?.length||0}</div>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="ds-pin-btn ds-btn" data-key="${key}" style="padding:6px; background:transparent; color:${isPinned?'var(--ds-yellow)':'#5c6370'};"><i class="fa-solid fa-thumbtack"></i></button>
                <button class="ds-reset-btn ds-btn" data-key="${key}" style="padding:6px; background:transparent; color:var(--ds-red);"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        fragment.appendChild(item);
    });
    container.append(fragment);
    container.find('.ds-reset-btn').on('click', function() { const k = $(this).data('key'); delete Settings.chats[k]; delete Settings.pinnedChats[k]; safeSave(); renderChatsUI(); });
    container.find('.ds-pin-btn').on('click', function() { const k = $(this).data('key'); Settings.pinnedChats[k] = !Settings.pinnedChats[k]; safeSave(); renderChatsUI(); });
}

async function setupUI() {
    try {
        injectCSS();
        const html = `
        <div class="inline-drawer" id="ds-v46-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header" style="border-left: 3px solid var(--ds-cyan);">
                <b style="color:var(--ds-cyan);"><span class="fa-solid fa-infinity"></span> DeepSeek 奇点引擎 (v46)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down" style="color:var(--ds-cyan);"></div>
            </div>
            <div class="inline-drawer-content ds-scroll" style="padding:18px; background: rgba(0,0,0,0.2);">
                
                <div class="ds-row" style="margin-bottom: 20px; background: rgba(0,229,255,0.1); padding: 15px; border-radius: 10px; border: 1px solid var(--ds-cyan);">
                    <div style="flex:1;">
                        <b style="color:var(--ds-cyan); font-size:16px;">🚀 奇点主引擎</b>
                        <div style="font-size:12px; color:#abb2bf; margin-top:4px;">开启后，大模型回复变秒回，大幅节省 Token 费用。</div>
                    </div>
                    <label class="ds-toggle-switch">
                        <input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}>
                        <span class="ds-slider"></span>
                    </label>
                </div>

                <!-- 4 大核心引擎 -->
                <div class="ds-engine-card">
                    <div class="ds-engine-header">
                        <div class="ds-engine-title"><i class="fa-solid fa-cube"></i> 1. 绝对静止引擎</div>
                        <label class="ds-toggle-switch"><input type="checkbox" id="ds-eng-stasis" ${Settings.engineStasis ? 'checked' : ''}><span class="ds-slider"></span></label>
                    </div>
                    <div class="ds-engine-desc">强制接管 ST 乱序。将所有提示词、世界书永久冻结，新内容永远垫底。</div>
                    <div class="ds-engine-tags"><span class="ds-engine-tag">秩序矩阵</span><span class="ds-engine-tag">语义正规化</span><span class="ds-engine-tag">绝对去重</span><span class="ds-engine-tag">永久烙印</span></div>
                </div>

                <div class="ds-engine-card engine-purple">
                    <div class="ds-engine-header">
                        <div class="ds-engine-title" style="color:var(--ds-purple);"><i class="fa-solid fa-dna"></i> 2. 量子补丁矩阵</div>
                        <label class="ds-toggle-switch"><input type="checkbox" id="ds-eng-patch" ${Settings.enginePatching ? 'checked' : ''}><span class="ds-slider"></span></label>
                    </div>
                    <div class="ds-engine-desc">当你修改、删除旧对话，或大改角色卡时，自动生成隐形补丁，保住 100% 缓存。</div>
                    <div class="ds-engine-tags"><span class="ds-engine-tag">时空补丁</span><span class="ds-engine-tag">吃书协议</span><span class="ds-engine-tag">闪回插入</span><span class="ds-engine-tag">角色热更新</span></div>
                </div>

                <div class="ds-engine-card engine-yellow">
                    <div class="ds-engine-header">
                        <div class="ds-engine-title" style="color:var(--ds-yellow);"><i class="fa-solid fa-water"></i> 3. 流形沉淀池</div>
                        <label class="ds-toggle-switch"><input type="checkbox" id="ds-eng-sink" ${Settings.engineSink ? 'checked' : ''}><span class="ds-slider"></span></label>
                    </div>
                    <div class="ds-engine-desc">自动隔离每次都在变的「缓存杀手」(如时间、RAG向量、动态摘要)，强制沉底。</div>
                    <div class="ds-engine-tags"><span class="ds-engine-tag">写日记模式</span><span class="ds-engine-tag">向量隔离区</span><span class="ds-engine-tag">摘要沉底</span></div>
                    <div style="margin-top:10px; background:rgba(0,0,0,0.3); padding:8px; border-radius:6px;">
                        <span style="font-size:11px; color:#abb2bf;">动态变量(如时间)处理方式：</span>
                        <select id="ds-cache-dynamic-mode" class="ds-select-styled" style="margin-top:4px; font-size:12px; padding:4px;">
                            <option value="1" ${Settings.dynamicMode===1?'selected':''}>写日记模式 (推荐! 100%缓存)</option>
                            <option value="2" ${Settings.dynamicMode===2?'selected':''}>垫底模式 (99%缓存)</option>
                            <option value="4" ${Settings.dynamicMode===4?'selected':''}>原位替换 (烧钱重算)</option>
                        </select>
                    </div>
                </div>

                <div class="ds-engine-card engine-green">
                    <div class="ds-engine-header">
                        <div class="ds-engine-title" style="color:var(--ds-green);"><i class="fa-solid fa-compass"></i> 4. 时间线导航仪</div>
                        <label class="ds-toggle-switch"><input type="checkbox" id="ds-eng-nav" ${Settings.engineNavigator ? 'checked' : ''}><span class="ds-slider"></span></label>
                    </div>
                    <div class="ds-engine-desc">在纯 RAM 中运行平行宇宙。当你撤销或切换分支时，瞬间跳跃恢复缓存。</div>
                    <div class="ds-engine-tags"><span class="ds-engine-tag">平行宇宙</span><span class="ds-engine-tag">前缀锚点</span><span class="ds-engine-tag">曲率过滤</span></div>
                </div>

                <!-- 記憶矩陣管理 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-database"></i> 记忆矩阵管理</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div id="ds-chat-list-container" class="ds-chat-container ds-scroll ds-gpu-accel"></div>
                        <div class="ds-row">
                            <button id="ds-btn-deep-clean" class="ds-btn" style="flex:1; font-size:12px; color:var(--ds-yellow); border:1px solid rgba(229,192,123,0.3);">🧹 清理垃圾</button>
                            <button id="ds-cache-factory-reset" class="ds-btn" style="flex:1; font-size:12px; color:var(--ds-red); border:1px solid rgba(224,108,117,0.3);">💀 格式化全部</button>
                        </div>
                    </div>
                </div>

                <!-- 終端日誌 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-terminal"></i> 奇点终端日志</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div id="ds-cache-log-container" class="ds-log-terminal ds-scroll ds-gpu-accel"></div>
                    </div>
                </div>
            </div>
        </div>`;
        
        $('#extensions_settings').append(html);

        // UI 事件綁定
        $('#ds-cache-enable').on('change', function () { Settings.enabled = $(this).is(':checked'); safeSave(); updateTopBarState(); });
        $('#ds-eng-stasis').on('change', function () { Settings.engineStasis = $(this).is(':checked'); safeSave(); });
        $('#ds-eng-patch').on('change', function () { Settings.enginePatching = $(this).is(':checked'); safeSave(); });
        $('#ds-eng-sink').on('change', function () { Settings.engineSink = $(this).is(':checked'); safeSave(); });
        $('#ds-eng-nav').on('change', function () { Settings.engineNavigator = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-dynamic-mode').on('change', function () { Settings.dynamicMode = parseInt($(this).val()); safeSave(); });

        $('#ds-cache-factory-reset').on('click', () => { 
            if (confirm("💀 确定要删除所有的缓存存档吗？一切将从零开始！")) { 
                Settings.chats = {}; Settings.pinnedChats = {}; RuntimeState = {}; safeSave(); renderChatsUI(); 
            } 
        });
        
        $('#ds-btn-deep-clean').on('click', () => {
            let count = 0; const now = Date.now();
            for (let k in Settings.chats) {
                if (Settings.pinnedChats[k]) continue;
                const chat = Settings.chats[k];
                if (!chat.frozenSequence?.length || (now - chat.lastAccessed > 30 * 24 * 60 * 60 * 1000)) { 
                    delete Settings.chats[k]; delete RuntimeState[k]; count++; 
                }
            }
            safeSave(); renderChatsUI();
            if (typeof toastr !== 'undefined') toastr.success(`🧹 清理完毕！移除了 ${count} 个旧存档。`);
        });

        renderChatsUI();
    } catch (e) { console.error('[DS Cache] UI初始化崩潰', e); }
}

jQuery(async () => {
    try {
        initSettings(); await setupUI(); setupGlobalHotkeys(); 
        setTimeout(() => { ensureTopMenuButton(); }, 2000); addResetMenuEntry(); 
        
        if (eventSource) {
            eventSource.on(event_types.CHAT_CHANGED, () => { ensureTopMenuButton(); renderChatsUI(); sessionSnoozeReset = false; });
            if (event_types?.CHAT_COMPLETION_PROMPT_READY) eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        }
        Logger.log('══════ 🌌 DeepSeek 奇点引擎 v46 上线 ══════', 1);
    } catch (e) { console.error('[DS Cache] 插件启动失败:', e); }
});
