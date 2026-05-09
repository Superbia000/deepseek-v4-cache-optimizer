import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 核心常數與全域狀態
// ==========================================
const PLUGIN_VERSION = 'v16.0 Ultimate Enterprise';
const MAX_CACHED_CHATS = 50;
let Settings = {};

const RuntimeCache = {
    tokenMap: new Map(),
    hashMap: new Map(),
    sessionSavedTokens: 0,
    sessionWastedTokens: 0
};

// ==========================================
// 初始化與資料庫遷移
// ==========================================
function initSettings() {
    if (!extension_settings.ds_cache_v16) {
        extension_settings.ds_cache_v16 = {
            enabled: true,
            sinkingMode: true,        // 動態下沉模式 (RAG 保全)
            silentThreshold: 5,       // 靜默修復閾值 (%)
            warnThreshold: 15,        // 彈窗警告閾值 (%)
            costPerMillion: 0.014,    // 每百萬 Token 節省的美金 (DeepSeek V3 均價)
            stats: {
                totalSavedTokens: 0,
                totalWastedTokens: 0,
                totalRequests: 0,
                totalBreaksPrevented: 0
            },
            logLevel: 2,
            chats: {} 
        };
    }
    Settings = extension_settings.ds_cache_v16;
    if (!Settings.stats) Settings.stats = { totalSavedTokens: 0, totalWastedTokens: 0, totalRequests: 0, totalBreaksPrevented: 0 };
    if (Settings.costPerMillion === undefined) Settings.costPerMillion = 0.014;
    runGarbageCollection();
}

function safeSave() {
    try { if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced(); } 
    catch (e) { console.warn("[DS Cache] 存檔失敗", e); }
}

function runGarbageCollection() {
    const keys = Object.keys(Settings.chats);
    if (keys.length <= MAX_CACHED_CHATS) return;
    const sorted = keys.map(k => ({ key: k, ts: Settings.chats[k].lastUpdate || 0 })).sort((a, b) => b.ts - a.ts);
    const toDelete = sorted.slice(MAX_CACHED_CHATS);
    toDelete.forEach(item => delete Settings.chats[item.key]);
    if (toDelete.length > 0) safeSave();
}

function yieldToMain() { return new Promise(resolve => setTimeout(resolve, 0)); }

// ==========================================
// 高精度哈希與經濟引擎
// ==========================================
function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909);
    h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1>>>0);
}

function getCompositeHash(str) {
    if (RuntimeCache.hashMap.has(str)) return RuntimeCache.hashMap.get(str);
    const compHash = `${cyrb53(str)}_${str.length}`;
    RuntimeCache.hashMap.set(str, compHash);
    return compHash;
}

function estimateTokens(text) {
    if (!text) return 0;
    const hash = getCompositeHash(text);
    if (RuntimeCache.tokenMap.has(hash)) return RuntimeCache.tokenMap.get(hash);
    
    const cjk = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    const latin = (text.match(/[a-zA-Z0-9]/g) || []).length;
    const punct = (text.match(/[.,!?;:()[\]{}"'<>]/g) || []).length;
    const space = (text.match(/[\s\n]/g) || []).length;
    const others = text.length - cjk - latin - punct - space;
    
    const count = Math.ceil((cjk * 1.5) + (latin * 0.3) + (punct * 0.5) + (space * 0.1) + (others * 1.0));
    RuntimeCache.tokenMap.set(hash, count);
    return count;
}

// 經濟結算
function commitEconomics(saved, wasted) {
    RuntimeCache.sessionSavedTokens += saved;
    RuntimeCache.sessionWastedTokens += wasted;
    Settings.stats.totalSavedTokens += saved;
    Settings.stats.totalWastedTokens += wasted;
    Settings.stats.totalRequests += 1;
    safeSave();
    updateDashboardUI();
}

// ==========================================
// 系統日誌與差異分析引擎
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };
const Logger = {
    log: (msg, level = LogLevels.DETAILED) => logAt(level, 'log', msg),
    warn: (msg, level = LogLevels.BASIC) => logAt(level, 'warn', msg),
    error: (msg, err, level = LogLevels.BASIC) => logAt(level, 'error', err ? `${msg} ${err.message||err}` : msg),
    map: (msg, level = LogLevels.BASIC) => logAt(level, 'map', msg),
    debug: (msg) => logAt(LogLevels.DEBUG, 'debug', msg),
    normalize: (text) => text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
    getSeqString: (seq) => seq.map(m => `[${m.tag}]`).join('➔')
};

let logQueue = [], isLogging = false;
async function processLogQueue() {
    if (isLogging || logQueue.length === 0) return;
    isLogging = true;
    const consoleEl = $('#ds-cache-log-content');
    if (consoleEl.length > 0) {
        const frag = document.createDocumentFragment();
        while (logQueue.length > 0) {
            const { time, css, icon, safeMsg } = logQueue.shift();
            const div = document.createElement('div');
            div.className = `ds-log-line ${css}`;
            div.innerHTML = `<span class="ds-c-time">[${time}]</span> ${icon} ${safeMsg}`;
            frag.appendChild(div);
        }
        consoleEl.append(frag);
        while (consoleEl.children().length > 150) consoleEl.children().first().remove();
        requestAnimationFrame(() => consoleEl.scrollTop(consoleEl[0].scrollHeight));
    } else logQueue = [];
    isLogging = false;
}

function logAt(level, type, msg) {
    if (Settings.logLevel < level) return;
    const now = new Date(), time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
    let css = 'ds-c-info', icon = '✅';
    if (type === 'warn') { css = 'ds-c-warn'; icon = '⚠️'; console.warn(`[DS Cache] ${msg}`); }
    else if (type === 'error') { css = 'ds-c-error'; icon = '🔴'; console.error(`[DS Cache] ${msg}`); }
    else if (type === 'map') { css = 'ds-c-map'; icon = '🗺️'; }
    else if (type === 'debug') { css = 'ds-c-debug'; icon = '🔍'; }
    else console.log(`[DS Cache] ${msg}`);

    logQueue.push({ time, css, icon, safeMsg: msg.replace(/</g, "&lt;").replace(/>/g, "&gt;") });
    processLogQueue();
}

// ==========================================
// 核心資料模型
// ==========================================
function createMsg(msg, tag) {
    const content = msg.content || '';
    const norm = Logger.normalize(content);
    return { role: msg.role, content: content, norm: norm, hash: getCompositeHash(norm), tag: tag };
}

function getSimilarity(item1, item2) {
    if (item1.hash === item2.hash) return 1;
    const len1 = item1.norm.length, len2 = item2.norm.length;
    if (len1 === 0 || len2 === 0 || Math.abs(len1 - len2) > Math.max(len1, len2) * 0.4 || (len1 < 15 || len2 < 15)) return 0;
    
    const s1 = len1 < len2 ? item1.norm : item2.norm, s2 = len1 < len2 ? item2.norm : item1.norm;
    const bigrams = new Set();
    for (let i = 0; i < s1.length - 1; i++) bigrams.add(s1.substring(i, i+2));
    
    let matchCount = 0;
    for (let i = 0; i < s2.length - 1; i++) if (bigrams.has(s2.substring(i, i+2))) matchCount++;
    const union = (s1.length - 1) + (s2.length - 1) - matchCount;
    return union <= 0 ? 1 : matchCount / union;
}

function stripPrefill(assistantObj, prefills) {
    if (!assistantObj || !prefills || prefills.length === 0) return assistantObj;
    let content = assistantObj.content || '', modified = false;
    for (const p of prefills) {
        if (content.startsWith(p.content)) { content = content.substring(p.content.length); modified = true; }
    }
    return modified ? createMsg({ ...assistantObj, content: content.replace(/^[\s\n]+/, '') }, assistantObj.tag) : assistantObj;
}

function getChatKey() {
    const ctx = getContext();
    const charName = (ctx.characterId !== undefined && ctx.characters && ctx.characters[ctx.characterId]) ? ctx.characters[ctx.characterId].name : (ctx.name2 || "Unknown");
    const chatId = ctx.chatId || "default_chat";
    return ctx.groupId ? { key: `group_${ctx.groupId}_${chatId}`, label: `群組: ${chatId}` } : { key: `char_${ctx.characterId}_${chatId}`, label: `角色: ${charName} | 存檔: ${chatId}` };
}

function getChatState(chatKeyInfo) {
    if (!Settings.chats[chatKeyInfo.key]) {
        Settings.chats[chatKeyInfo.key] = { label: chatKeyInfo.label, frozenSequence: [], lastSentSequence: [], lastPrefills: [], lastUpdate: Date.now() };
    }
    Settings.chats[chatKeyInfo.key].lastUpdate = Date.now();
    return Settings.chats[chatKeyInfo.key];
}

function parseSTStream(stream) {
    const sysMsgs = [], chatMsgs = [];
    for (const msg of stream) {
        if (msg.role === 'system' || (msg.role !== 'user' && msg.role !== 'assistant')) sysMsgs.push(createMsg(msg, 'SYS'));
        else chatMsgs.push(createMsg(msg, msg.role === 'user' ? 'USER' : 'AI'));
    }
    let lastUserIdx = -1;
    for (let i = chatMsgs.length - 1; i >= 0; i--) { if (chatMsgs[i].tag === 'USER') { lastUserIdx = i; break; } }

    let historyTurns = [], currentTurn = { user: null, prefills: [] };
    if (lastUserIdx === -1) currentTurn.prefills = chatMsgs.filter(m => m.tag === 'AI').map(m => createMsg(m, 'PREFILL'));
    else {
        const hMsgs = chatMsgs.slice(0, lastUserIdx), cMsgs = chatMsgs.slice(lastUserIdx);
        currentTurn.user = cMsgs[0];
        currentTurn.prefills = cMsgs.slice(1).filter(m => m.tag === 'AI').map(m => createMsg(m, 'PREFILL'));

        let curUser = null, curAiContents = [];
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
// UI 經濟彈窗與分析視圖
// ==========================================
function askUserForResetAsync(stats, lNode, pNode) {
    return new Promise(resolve => {
        const overlay = $(`<div class="ds-modal-bg"></div>`);
        const moneyLost = ((stats.wastedTokens / 1000000) * Settings.costPerMillion).toFixed(5);
        
        let diffHtml = `
            <div style="display:flex; flex-direction:column; gap:8px;">
                <div style="background:rgba(229,115,115,0.1); border-left:3px solid #e57373; padding:8px; border-radius:4px;">
                    <span style="color:#e57373; font-weight:bold; font-size:11px;">[原緩存節點]</span><br>
                    <span style="color:#aaa;">${lNode ? lNode.content.substring(0,80).replace(/</g,'&lt;') + '...' : 'EOF'}</span>
                </div>
                <div style="background:rgba(129,199,132,0.1); border-left:3px solid #81c784; padding:8px; border-radius:4px;">
                    <span style="color:#81c784; font-weight:bold; font-size:11px;">[闖入的修改]</span><br>
                    <span style="color:#eee;">${pNode ? pNode.content.substring(0,80).replace(/</g,'&lt;') + '...' : 'EOF'}</span>
                </div>
            </div>`;

        const box = $(`
        <div class="ds-modal-box">
            <h2 style="color:#ef5350; margin-top:0; font-size: 1.4em; display:flex; align-items:center; gap:8px;">
                <span class="fa-solid fa-money-bill-wave"></span> 緩存擊穿警告
            </h2>
            <p style="text-align:left; line-height:1.6; font-size:14px; color:#cfd8dc;">
                發生了嚴重拓撲斷裂 <b>(流失率: ${stats.dropPercentStr}%)</b>。<br>
                將有 <b style="color:#ef5350;">${stats.wastedTokens.toLocaleString()}</b> Tokens 被迫重算，估計浪費 <b>$${moneyLost} USD</b>。
            </p>
            <div class="ds-modal-map">${diffHtml}</div>
            <div style="margin-top:20px; display:flex; gap:15px;">
                <button id="ds-m-accept" style="flex:1; background:#43a047; color:white; padding:12px; border:none; border-radius:6px; cursor:pointer; font-weight:bold; transition:0.2s;">
                    🔄 認賠發送 (重建緩存)
                </button>
                <button id="ds-m-abort" style="flex:1; background:#e53935; color:white; padding:12px; border:none; border-radius:6px; cursor:pointer; font-weight:bold; transition:0.2s;">
                    🛑 攔截請求 (我去修復)
                </button>
            </div>
        </div>`);

        overlay.append(box); $('body').append(overlay);
        $('#ds-m-accept').hover(function(){$(this).css('filter','brightness(1.2)')}, function(){$(this).css('filter','none')}).click(() => { overlay.remove(); resolve('reset'); });
        $('#ds-m-abort').hover(function(){$(this).css('filter','brightness(1.2)')}, function(){$(this).css('filter','none')}).click(() => { overlay.remove(); resolve('abort'); });
    });
}

// ==========================================
// 核心引擎：v16 經濟管家與動態下沉
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (!Settings.enabled || data.dryRun) return;

    try {
        const chatKeyInfo = getChatKey();
        let state = getChatState(chatKeyInfo);
        if (!data?.chat?.length) return;
        const stream = data.chat;

        Logger.log(`================ 引擎啟動 ================`, LogLevels.BASIC);
        const { sysMsgs, historyTurns, currentTurn } = parseSTStream(stream);
        await yieldToMain();

        const flatHistoryPool = [];
        for(let t of historyTurns) {
            flatHistoryPool.push(t.user);
            if(t.assistant) flatHistoryPool.push(stripPrefill(t.assistant, state.lastPrefills));
        }

        let rawFrozenSequence = [];
        const sysMsgsPool = [...sysMsgs];
        const remainingHistory = [...flatHistoryPool];
        
        // --- 階段 1：原位映射 ---
        for (let i = 0; i < state.frozenSequence.length; i++) {
            if (i % 15 === 0) await yieldToMain();
            const item = state.frozenSequence[i];
            const targetPool = item.tag === 'SYS' ? sysMsgsPool : remainingHistory;
            
            let bestIdx = targetPool.findIndex(p => p.hash === item.hash && p.tag === item.tag);
            let bestScore = bestIdx !== -1 ? 1 : 0;
            
            if (bestIdx === -1) {
                for (let j = 0; j < targetPool.length; j++) {
                    if (item.tag !== 'SYS' && item.tag !== targetPool[j].tag) continue;
                    const score = getSimilarity(item, targetPool[j]);
                    if (score > bestScore) { bestScore = score; bestIdx = j; }
                }
            }

            if (bestScore === 1) { 
                rawFrozenSequence.push(targetPool[bestIdx]); 
                targetPool.splice(bestIdx, 1); 
            } else if (bestScore > 0.3) { 
                rawFrozenSequence.push(targetPool[bestIdx]); 
                Logger.debug(`[熱修復] ${item.tag} 相似度 ${(bestScore*100).toFixed(0)}%`);
                targetPool.splice(bestIdx, 1);
            }
        }

        // --- 階段 2：新生節點處理 (動態下沉技術) ---
        for (let h of remainingHistory) rawFrozenSequence.push(h);
        
        if (Settings.sinkingMode) {
            // 🧲 動態下沉：所有新闖入的系統提示詞 (通常是 RAG 或世界書) 強制掛載在最後方，保全前排數萬字 Cache
            for (let sys of sysMsgsPool) {
                rawFrozenSequence.push(sys);
                Logger.log(`[動態下沉] 已將新插入的設定推至陣列尾端，完美保全緩存。`, LogLevels.BASIC);
            }
        } else {
            // 靜態錨定：插入前端 (極易破壞緩存)
            for (let sys of sysMsgsPool) rawFrozenSequence.splice(1, 0, sys);
        }

        let dedupedSequence = [];
        const seenHash = new Set();
        for (const item of rawFrozenSequence) {
            if (item.tag === 'SYS') { if (seenHash.has(item.hash)) continue; seenHash.add(item.hash); }
            dedupedSequence.push(item);
        }

        const proposedStream = [...dedupedSequence];
        if (currentTurn.user) proposedStream.push(currentTurn.user);
        for (const p of currentTurn.prefills) proposedStream.push(p);

        Logger.map(`拓撲預覽: ${Logger.getSeqString(proposedStream)}`, LogLevels.BASIC);

        // --- 階段 3：經濟結算與滑動對齊 ---
        let L = state.lastSentSequence || [];
        let P = proposedStream;
        
        let slideOffset = 0;
        for(let i = 0; i < Math.min(L.length, 15); i++) {
            if(P.length > 0 && P[0].hash === L[i].hash) { slideOffset = i; break; }
        }
        if (slideOffset > 0) {
            Logger.debug(`[滑動對齊] 補償 ${slideOffset} 個歷史擠出`);
            L = L.slice(slideOffset);
        }

        let breakIdx = -1;
        for (let i = 0; i < Math.min(L.length, P.length); i++) {
            if (L[i].role !== P[i].role || L[i].hash !== P[i].hash) { breakIdx = i; break; }
        }
        if (breakIdx === -1) breakIdx = P.length;

        let prefixTokens = 0, newTokens = 0;
        for (let i = 0; i < P.length; i++) {
            const tCount = estimateTokens(P[i].content);
            if (i < breakIdx) prefixTokens += tCount;
            else {
                // Swipe 豁免
                if (i === P.length - 1 && P[i].tag === 'AI') continue;
                newTokens += tCount;
            }
        }

        const totalTokens = prefixTokens + newTokens;
        const dropRatio = totalTokens === 0 ? 0 : (newTokens / totalTokens);
        const dropPercent = (dropRatio * 100).toFixed(1);
        
        Logger.log(`💰 經濟探測: 總量 ${totalTokens.toLocaleString()} T | 保全 ${prefixTokens.toLocaleString()} T | 流失 ${newTokens.toLocaleString()} T (${dropPercent}%)`, LogLevels.BASIC);

        // --- 階段 4：雙軌閘門決策 ---
        let decision = 'ignore';
        
        if (dropRatio * 100 > Settings.warnThreshold) {
            const stats = { wastedTokens: newTokens, dropPercentStr: dropPercent };
            decision = await askUserForResetAsync(stats, L[breakIdx], P[breakIdx]);
        } else if (dropRatio * 100 > Settings.silentThreshold) {
            Logger.warn(`觸發靜默修復閾值 (${dropPercent}%)，自動放行並重建拓撲。`);
            decision = 'reset';
        }

        if (decision === 'abort') {
            Settings.stats.totalBreaksPrevented += 1;
            safeSave(); updateDashboardUI();
            Logger.error('[攔截生效] 守護了你的錢包', null, LogLevels.BASIC);
            if (typeof toastr !== 'undefined') toastr.error(`已攔截！避免了 ${newTokens} Tokens 的浪費。`, "守財奴系統");
            stream.splice(0, stream.length); 
            return;
        }

        // 發送授權
        commitEconomics(prefixTokens, newTokens);

        state.frozenSequence = dedupedSequence;
        state.lastPrefills = currentTurn.prefills;

        const finalStream = [...state.frozenSequence];
        if (currentTurn.user) finalStream.push(currentTurn.user);
        for (const p of currentTurn.prefills) finalStream.push(p);

        state.lastSentSequence = finalStream;
        safeSave(); renderChatsUI();

        stream.splice(0, stream.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
        Logger.log(`✅ 通關放行 (命中率: ${(totalTokens===0?0:(prefixTokens/totalTokens)*100).toFixed(1)}%)`, LogLevels.BASIC);

    } catch (err) {
        Logger.error('經濟引擎崩潰', err);
        throw err;
    }
}

// ==========================================
// 企業級 UI 注入與 CSS
// ==========================================
function injectCSS() {
    if ($('#ds-v16-styles').length === 0) {
        const css = `
        <style id="ds-v16-styles">
            .ds-dash { background: linear-gradient(145deg, #1e3c72 0%, #2a5298 100%); border-radius: 8px; padding: 15px; margin-bottom: 12px; color: white; box-shadow: 0 4px 15px rgba(0,0,0,0.3); }
            .ds-dash-title { font-size: 1.1em; font-weight: 800; margin-bottom: 10px; text-shadow: 1px 1px 2px rgba(0,0,0,0.5); display:flex; justify-content:space-between;}
            .ds-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
            .ds-stat-box { background: rgba(0,0,0,0.25); padding: 10px; border-radius: 6px; text-align: center; border: 1px solid rgba(255,255,255,0.1); }
            .ds-stat-val { font-size: 1.4em; font-weight: bold; color: #4dd0e1; margin-top: 4px; font-family: monospace;}
            .ds-stat-val.money { color: #81c784; }
            .ds-panel { background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
            .ds-title { font-size: 0.9em; font-weight: bold; color: #b0bec5; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 5px; display:flex; justify-content:space-between; align-items:center;}
            .ds-console { background: #08080a; border: 1px inset #222; border-radius: 6px; height: 160px; overflow-y: auto; padding: 8px; font-family: 'Consolas', monospace; font-size: 11px; line-height: 1.5; }
            .ds-log-line { border-bottom: 1px dashed rgba(255,255,255,0.02); padding: 3px 0; word-break: break-all; }
            .ds-c-time { color: #555; } .ds-c-info { color: #81c784; } .ds-c-warn { color: #ffb74d; } .ds-c-error{ color: #e57373; font-weight: bold; } .ds-c-map { color: #4dd0e1; } .ds-c-debug{ color: #78909c; }
            .ds-btn { background: #263238; color: #fff; border: 1px solid #37474f; padding: 6px 12px; border-radius: 4px; cursor: pointer; transition: 0.2s; font-size: 0.85em; }
            .ds-btn:hover { background: #37474f; }
            .ds-btn-danger { background: rgba(229, 115, 115, 0.15); border-color: rgba(229, 115, 115, 0.4); color: #e57373; }
            .ds-btn-danger:hover { background: rgba(229, 115, 115, 0.3); }
            .ds-modal-bg { position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); z-index:999999; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(5px); }
            .ds-modal-box { background:#121212; border:1px solid #ef5350; padding:25px; border-radius:12px; max-width:650px; width:90%; box-shadow: 0 20px 40px rgba(0,0,0,0.8); }
            .ds-modal-map { background:#0a0a0a; border: 1px inset #222; padding:12px; border-radius:6px; font-family:monospace; font-size:12px; margin:15px 0; max-height: 200px; overflow-y:auto;}
        </style>`;
        $('head').append(css);
    }
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function updateDashboardUI() {
    $('#ds-val-tokens').text(formatNumber(Settings.stats.totalSavedTokens));
    const usd = ((Settings.stats.totalSavedTokens / 1000000) * Settings.costPerMillion).toFixed(3);
    $('#ds-val-usd').text('$' + usd);
    $('#ds-val-reqs').text(Settings.stats.totalRequests);
    $('#ds-val-blocks').text(Settings.stats.totalBreaksPrevented);
}

function renderChatsUI() {
    const container = $('#ds-chat-list-container');
    if (container.length === 0) return;
    container.empty();
    const keys = Object.keys(Settings.chats).sort((a,b) => (Settings.chats[b].lastUpdate || 0) - (Settings.chats[a].lastUpdate || 0));
    $('#ds-cache-mem-usage').text(`${keys.length}/${MAX_CACHED_CHATS}`);

    if (keys.length === 0) { container.append('<div style="opacity:0.4; font-size:12px; padding:15px; text-align:center;">無資料</div>'); return; }
    keys.forEach(key => {
        container.append(`
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:6px 8px; margin-bottom:4px; border-radius:4px;">
                <span style="font-size:0.85em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:75%;">${Settings.chats[key].label}</span>
                <button class="ds-btn ds-reset-btn" style="padding:2px 6px; font-size:0.8em;" data-key="${key}">清除</button>
            </div>
        `);
    });
    container.find('.ds-reset-btn').on('click', function() { delete Settings.chats[$(this).data('key')]; safeSave(); renderChatsUI(); });
}

function exportTelemetry() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(Settings, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `ds_cache_telemetry_${Date.now()}.json`);
    dlAnchorElem.click();
}

async function setupUI() {
    try {
        injectCSS();
        const html = `
        <div class="inline-drawer" id="ds-v16-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Deepseek 經濟管家 (${PLUGIN_VERSION})</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                
                <!-- 經濟看板 -->
                <div class="ds-dash">
                    <div class="ds-dash-title"><span>💰 企業經濟看板 (ROI)</span><span style="font-size:0.8em; font-weight:normal; opacity:0.8;">費率: $${Settings.costPerMillion}/1M</span></div>
                    <div class="ds-stat-grid">
                        <div class="ds-stat-box"><div style="font-size:11px; color:#cfd8dc;">白嫖 Token 總量</div><div class="ds-stat-val" id="ds-val-tokens">0</div></div>
                        <div class="ds-stat-box"><div style="font-size:11px; color:#cfd8dc;">為您節省 (USD)</div><div class="ds-stat-val money" id="ds-val-usd">$0.00</div></div>
                        <div class="ds-stat-box"><div style="font-size:11px; color:#cfd8dc;">總發送次數</div><div class="ds-stat-val" style="color:#fff;" id="ds-val-reqs">0</div></div>
                        <div class="ds-stat-box"><div style="font-size:11px; color:#cfd8dc;">攔截斷裂次數</div><div class="ds-stat-val" style="color:#ef5350;" id="ds-val-blocks">0</div></div>
                    </div>
                </div>

                <div class="ds-panel">
                    <div class="ds-title">⚙️ 智能陣列防護核心</div>
                    <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}> 啟用時序凍結接管</label>
                    <label class="checkbox_label" title="將 RAG/世界書 等臨時設定強制推至最末端，保全 99% 的頂部緩存"><input type="checkbox" id="ds-cache-sinking" ${Settings.sinkingMode ? 'checked' : ''}> 🧲 開啟「動態上下文下沉」(強烈建議)</label>
                    
                    <div style="margin-top:10px; background:rgba(0,0,0,0.3); padding:8px; border-radius:4px;">
                        <div style="font-size:11px; color:#aaa; margin-bottom:5px;">雙軌容忍閘門設定：</div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                            <span style="font-size:12px;">靜默放行閾值 (%)</span>
                            <input type="number" id="ds-cfg-silent" value="${Settings.silentThreshold}" style="width:50px; background:#222; color:#fff; border:1px solid #444; text-align:center;">
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:12px;">嚴重彈窗閾值 (%)</span>
                            <input type="number" id="ds-cfg-warn" value="${Settings.warnThreshold}" style="width:50px; background:#222; color:#fff; border:1px solid #444; text-align:center;">
                        </div>
                    </div>
                </div>
                
                <div class="ds-panel">
                    <div class="ds-title"><span>📂 LRU 記憶體池</span><span style="font-size:0.9em; font-weight:normal;" id="ds-cache-mem-usage"></span></div>
                    <div id="ds-chat-list-container" style="max-height:100px; overflow-y:auto; background:rgba(0,0,0,0.3); border-radius:4px; padding:4px;"></div>
                </div>

                <div class="ds-panel">
                    <div class="ds-title" style="margin-bottom:5px;">
                        <span>💻 遙測與除錯終端</span>
                        <select id="ds-cache-loglevel" class="text_pole" style="width:auto; padding:2px; font-size:11px;">
                            <option value="0" ${Settings.logLevel===0?'selected':''}>0 - 關閉</option><option value="1" ${Settings.logLevel===1?'selected':''}>1 - 簡要</option>
                            <option value="2" ${Settings.logLevel===2?'selected':''}>2 - 詳細</option><option value="3" ${Settings.logLevel===3?'selected':''}>3 - 除錯</option>
                        </select>
                    </div>
                    <div id="ds-cache-log-content" class="ds-console"></div>
                    <div style="display:flex; gap:5px; margin-top:8px;">
                        <button id="ds-cache-clearlog" class="ds-btn" style="flex:1;">🗑️ 清空</button>
                        <button id="ds-cache-export" class="ds-btn" style="flex:1; background:#1976d2;">📥 匯出遙測</button>
                    </div>
                </div>
                
            </div>
        </div>`;
        
        $('#extensions_settings').append(html);

        $('#ds-cache-enable').on('change', function () { Settings.enabled = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-sinking').on('change', function () { Settings.sinkingMode = $(this).is(':checked'); safeSave(); });
        $('#ds-cfg-silent').on('change', function () { Settings.silentThreshold = parseFloat($(this).val())||0; safeSave(); });
        $('#ds-cfg-warn').on('change', function () { Settings.warnThreshold = parseFloat($(this).val())||0; safeSave(); });
        $('#ds-cache-loglevel').on('change', function () { Settings.logLevel = parseInt($(this).val()); safeSave(); });
        
        $('#ds-cache-clearlog').on('click', () => $('#ds-cache-log-content').empty());
        $('#ds-cache-export').on('click', exportTelemetry);
        
        updateDashboardUI(); renderChatsUI();
    } catch (e) { console.error('[DS Cache] UI初始化崩潰', e); }
}

jQuery(async () => {
    try {
        initSettings(); await setupUI();
        if (eventSource && event_types.CHAT_COMPLETION_PROMPT_READY) {
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        }
        Logger.log(`[系統啟動] ${PLUGIN_VERSION} 經濟管家就緒。動態下沉引擎已啟動。`, LogLevels.BASIC);
    } catch (e) { console.error('[DS Cache] 啟動失敗:', e); }
});
