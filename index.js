import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 狀態與設定 (Settings & State)
// ==========================================
let Settings = {};

function initSettings() {
    const defaultSettings = {
        enabled: true,
        instantNotify: true,
        logLevel: 3,
        chats: {} 
    };

    if (!extension_settings.ds_cache_v36_absolute) {
        extension_settings.ds_cache_v36_absolute = defaultSettings;
    }
    Settings = Object.assign({}, defaultSettings, extension_settings.ds_cache_v36_absolute);
}

function safeSave() {
    try { if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced(); } 
    catch (e) { console.warn("[DS Cache] 存檔失敗", e); }
}

// ==========================================
// 深度日誌系統 (Markdown Logger Engine)
// ==========================================
const LogLevels = { OFF: 0, BASIC: 1, STANDARD: 2, DETAILED: 3, EXTREME: 4 };
let rawMarkdownLogs = [];

const Logger = {
    _uiViewer: null,
    getTime: () => {
        const now = new Date();
        return `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
    },
    truncate: (text) => {
        if (!text) return '';
        const clean = text.replace(/[\n\r]/g, ' ');
        return clean.length > 30 ? clean.substring(0, 30) + '...' : clean;
    },
    write: (markdownText, level = LogLevels.STANDARD) => {
        if (Settings.logLevel < level) return;
        const time = Logger.getTime();
        const entry = `**[${time}]** ${markdownText}\n`;
        rawMarkdownLogs.push(entry);
        Logger.updateUI(entry);
        if (level === LogLevels.EXTREME) console.log(`[DS Cache EXTREME]`, markdownText);
    },
    updateUI: (newEntry) => {
        if (!Logger._uiViewer) return;
        let html = newEntry.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/^- (.*)/gm, '<li>$1</li>');
        if (html.includes('|')) {
            const lines = html.split('\n');
            let tableHtml = '<div class="ds-log-container"><table class="ds-log-table">';
            let inTable = false, isFirstRow = true;
            for (let line of lines) {
                if (line.trim().startsWith('|')) {
                    if (!inTable) inTable = true;
                    const cells = line.split('|').filter(c => c.trim() !== '');
                    if (line.includes('---')) continue;
                    if (isFirstRow) { tableHtml += '<tr>' + cells.map(c => `<th>${c.trim()}</th>`).join('') + '</tr>'; isFirstRow = false; } 
                    else { tableHtml += '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>'; }
                } else {
                    if (inTable) { tableHtml += '</table></div>'; inTable = false; isFirstRow = true; }
                    tableHtml += line + '<br>';
                }
            }
            if (inTable) tableHtml += '</table></div>';
            html = tableHtml;
        }
        const div = document.createElement('div');
        div.innerHTML = html;
        div.style.marginBottom = '12px';
        div.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        div.style.paddingBottom = '12px';
        Logger._uiViewer.appendChild(div);
        Logger._uiViewer.scrollTop = Logger._uiViewer.scrollHeight;
    },
    clear: () => { rawMarkdownLogs = []; if (Logger._uiViewer) Logger._uiViewer.innerHTML = ''; if (typeof toastr !== 'undefined') toastr.success("日誌已清空"); },
    copy: () => { navigator.clipboard.writeText(rawMarkdownLogs.join('\n')).then(() => { if (typeof toastr !== 'undefined') toastr.success("日誌已複製到剪貼簿"); }); },
    export: () => {
        const blob = new Blob([rawMarkdownLogs.join('\n')], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `DSCache_Log_${new Date().toISOString().replace(/[:.]/g, '-')}.md`; a.click(); URL.revokeObjectURL(url);
        if (typeof toastr !== 'undefined') toastr.success("日誌導出成功");
    }
};

// ==========================================
// 存檔管理系統 (Archive System)
// ==========================================
function getChatKey() {
    const context = getContext();
    let chatId = context.chatId || "default_chat";
    let character = context.name2 || "未分類";
    if (context.groupId) character = "群聊: " + (context.groupName || context.groupId);
    return { key: `chat_${chatId}`, label: `${chatId}`, character: character };
}

function getChatState(chatKeyInfo) {
    let chat = Settings.chats[chatKeyInfo.key];
    if (!chat) { chat = Settings.chats[chatKeyInfo.key] = { frozenSequence: [], promptTracker: {} }; safeSave(); }
    if (!chat.promptTracker) chat.promptTracker = {};
    chat.label = chatKeyInfo.label; chat.character = chatKeyInfo.character;
    return chat;
}

function resetCurrentChatCache() {
    const chatInfo = getChatKey();
    if (Settings.chats[chatInfo.key]) {
        Settings.chats[chatInfo.key].frozenSequence = [];
        Settings.chats[chatInfo.key].promptTracker = {};
        safeSave(); renderChatsUI();
        if (typeof toastr !== 'undefined') toastr.success(`已重置當前聊天 (${chatInfo.character}) 的凍結池`);
        Logger.write(`🔄 用戶手動重置了當前聊天 (${chatInfo.character}) 的凍結池`, LogLevels.BASIC);
    }
}

// ==========================================
// 🛡️ 核心引擎：編譯器劫持與 100% 精準分類
// ==========================================
const CoreEngine = {
    macroMap: new Map(), 
    promptIndex: [], 

    normalize: (text) => {
        if (!text) return '';
        return text.replace(/[\s\n\r\t]/g, '').replace(/\\n/g, '').trim();
    },

    // 🌟 終極內存暴風掃描：無視 ST 版本與路徑，直接抓取特徵結構
    buildIndex: () => {
        CoreEngine.promptIndex = [];
        let seenNorms = new Set();

        const addToIndex = (norm, cat, source, creator, type) => {
            if (!norm || norm.length < 2 || seenNorms.has(norm)) return;
            seenNorms.add(norm);
            CoreEngine.promptIndex.push({ contentNorm: norm, cat, source, creator, type });
        };

        const deepScan = (obj, depth = 0, visited = new Set(), path = []) => {
            if (depth > 15 || !obj || typeof obj !== 'object' || visited.has(obj)) return;
            visited.add(obj);

            const currentBookName = path.includes('books') ? path[path.indexOf('books') + 1] : '全域世界書';

            // 1. 世界書 (Lorebook) 特徵攔截
            if (typeof obj.content === 'string' && (Array.isArray(obj.key) || obj.uid !== undefined || obj.comment !== undefined)) {
                if (!obj.role && obj.type !== 'prompt') {
                    let entryName = obj.comment || obj.name || obj.title || (Array.isArray(obj.key) && obj.key.length > 0 ? obj.key.join(', ') : '未命名條目');
                    addToIndex(CoreEngine.normalize(obj.content), '世界書', `世界書[${currentBookName}] - ${entryName}`, '世界書系統', 'LOREBOOK');
                }
            }
            
            // 2. 提示詞 (Prompt Manager) 特徵攔截
            if (typeof obj.content === 'string' && (obj.name || obj.identifier) && (obj.role || obj.type === 'prompt')) {
                let pName = obj.name || obj.identifier;
                addToIndex(CoreEngine.normalize(obj.content), '預設', `預設提示詞(${pName})`, obj.role || 'ST核心', 'DEFAULT');
            }

            // 3. 角色與場景 (Character / Scenario) 標準欄位攔截
            if (obj.name && obj.create_date) { // 強力角色對象啟發法
                const charName = obj.name;
                if (obj.description) addToIndex(CoreEngine.normalize(obj.description), '角色', `設定(${charName})`, '核心設定', 'DEFAULT');
                if (obj.personality) addToIndex(CoreEngine.normalize(obj.personality), '角色', `性格(${charName})`, '核心設定', 'DEFAULT');
                if (obj.scenario) addToIndex(CoreEngine.normalize(obj.scenario), '角色', `場景(${charName})`, '核心設定', 'DEFAULT');
                if (obj.first_mes) addToIndex(CoreEngine.normalize(obj.first_mes), '角色', `初次對話(${charName})`, '核心設定', 'DEFAULT');
                if (obj.mes_example) addToIndex(CoreEngine.normalize(obj.mes_example), '角色', `對話範例(${charName})`, '核心設定', 'DEFAULT');
            }

            // 4. 用戶設定 (User Persona) 特徵攔截
            if (obj.persona_description) {
                addToIndex(CoreEngine.normalize(obj.persona_description), '用戶', `用戶設定(Persona)`, '用戶', 'DEFAULT');
            }

            // 🌟 v36.7 升級：萬物歸宗掃描 (捕獲所有殘餘的匿名提示詞)
            // 此邏輯遍歷所有對象的鍵，捕獲那些作為長字符串存儲的、非標準的提示詞。
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    const value = obj[key];
                    // 規則：如果一個屬性的值是字符串，長度足夠長，且不是已知的非提示詞短字符串，我們就將其索引。
                    if (typeof value === 'string' && value.length > 40) {
                        const norm = CoreEngine.normalize(value);
                        if (!seenNorms.has(norm)) {
                            // 嘗試從路徑中獲取一個有意義的分類
                            let cat = '預設';
                            let creator = 'ST核心';
                            if (path.includes('character')) { cat = '角色'; creator = '核心設定'; }
                            if (path.includes('world_info')) { cat = '世界書'; creator = '世界書系統'; }
                            
                            // 創建一個有意義的來源名稱
                            const sourceName = `定義(${key})`;
                            addToIndex(norm, cat, sourceName, creator, 'GENERIC_STRING');
                        }
                    }
                    
                    // 遞迴深入
                    if (value && typeof value === 'object' && !(value instanceof Element)) {
                        deepScan(value, depth + 1, visited, [...path, key]);
                    }
                }
            }
        };

        // 對 ST 的所有核心記憶體根節點發動暴風掃描
        const roots = [window.world_info, window.settings, window.extension_settings, window.power_user, window.prompt_manager, window.characters, getContext()];
        roots.forEach(root => { if (root) deepScan(root, 0, new Set(), ['root']); });
    },

    // ... (getOverlapRatio, getSimilarity, findInIndex, patchSTEngine, classify 等函數保持不變) ...
    // ... (因為 classify 現在會從 findInIndex 獲得更精準的數據) ...
    
    // 截取 classify 函數以展示其如何受益
    classify: (msg, structuralTag, isDynamic) => {
        if (msg._isDSPlugin) return { cat: '本插件', source: '本插件修改的提示詞', creator: 'DS Cache', type: 'PLUGIN' };

        if (structuralTag === 'USER_CURRENT') return { cat: '用戶', source: '用戶當前輸入', creator: '用戶', type: 'USER_CURRENT' };
        if (structuralTag === 'PREFILL') return { cat: 'AI', source: '預填充', creator: '大模型', type: 'PREFILL' };
        if (structuralTag === 'AI_LAST_REPLY') return { cat: 'AI', source: 'AI上一次回覆', creator: '大模型', type: 'AI_LAST_REPLY' };
        if (structuralTag === 'USER_HISTORY') return { cat: '用戶', source: '用戶歷史輸入', creator: '用戶', type: 'USER_HISTORY' };
        if (structuralTag === 'AI_HISTORY') return { cat: 'AI', source: 'AI歷史回覆', creator: '大模型', type: 'AI_HISTORY' };

        // 🌟 核心升級：經由全域指紋庫精準攔截！
        let normContent = msg._origTemplate ? CoreEngine.normalize(msg._origTemplate) : msg._norm;
        let matchedIndex = CoreEngine.findInIndex(normContent);
        
        if (matchedIndex) {
            // v36.7 的 deepScan 提供了更豐富的來源，這裡直接使用
            let source = matchedIndex.source;
            // 如果來源是通用的 '定義(key)'，我們可以讓它更具體
            if (matchedIndex.type === 'GENERIC_STRING' && msg.name) {
                source = `預設提示詞(${msg.name})`; // 如果ST後來給它命名了，優先用ST的
            } else if (matchedIndex.type === 'GENERIC_STRING' && source.includes('定義')) {
                source = `預設提示詞${source}`; // 比如變成 預設提示詞定義(style)
            }

            if (isDynamic) {
                return { cat: '動態', source: `${source}(動態)`, creator: matchedIndex.creator, type: 'DYNAMIC' };
            }
            return { cat: matchedIndex.cat, source: source, creator: matchedIndex.creator, type: matchedIndex.type };
        }

        // ... (原有的兜底防禦邏輯保持不變) ...
        if (isDynamic) {
            return { cat: '動態', source: '動態提示詞', creator: 'ST核心/插件', type: 'DYNAMIC' };
        }
        // ...
        return { cat: '預設', source: msg.name ? `預設提示詞(${msg.name})` : '預設提示詞(無名)', creator: 'ST核心', type: 'DEFAULT' };
    }
};
// ==========================================
// 🌌 絕對防禦矩陣 (The Absolute Engine)
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (data.dryRun || !data?.chat?.length) return;

    // 🌟 在攔截數據流的當下，即時構建/刷新全局內存指紋字典
    CoreEngine.buildIndex();

    try {
        const state = getChatState(getChatKey());
        let incomingStream = data.chat;
        let incomingPool = [];
        let ledger = []; 
        const processTime = Logger.getTime();

        // 🌟 1. 純結構時序映射 & 歷史紀錄 UID 綁定
        const contextChat = getContext().chat || [];
        let structuralMap = new Array(incomingStream.length).fill(null);
        let uidMap = new Array(incomingStream.length).fill(null);
        
        for (let i = incomingStream.length - 1; i >= 0; i--) {
            if (incomingStream[i].role === 'system') continue;
            if (incomingStream[i].role === 'assistant') {
                if (contextChat.length > 0 && contextChat[contextChat.length - 1].is_user) {
                    structuralMap[i] = 'PREFILL';
                    uidMap[i] = 'chat_prefill';
                }
            }
            break;
        }

        let cIdx = contextChat.length - 1;
        for (let i = incomingStream.length - 1; i >= 0; i--) {
            if (structuralMap[i]) continue;
            let msg = incomingStream[i];
            
            if (msg.role === 'system') continue;
            let name = msg.name ? msg.name.toLowerCase() : '';
            if (name.includes('example') || name.includes('scenario') || name.includes('system')) continue;

            if (cIdx >= 0) {
                let expectedRole = contextChat[cIdx].is_user ? 'user' : 'assistant';
                if (msg.role === expectedRole) {
                    uidMap[i] = `chat_msg_${cIdx}`; 
                    if (cIdx === contextChat.length - 1) structuralMap[i] = 'USER_CURRENT';
                    else if (cIdx === contextChat.length - 2) structuralMap[i] = 'AI_LAST_REPLY';
                    else structuralMap[i] = expectedRole === 'user' ? 'USER_HISTORY' : 'AI_HISTORY';
                    cIdx--;
                }
            } else if (cIdx === -1 && contextChat.length === 0) {
                if (msg.role === 'user' && !structuralMap.includes('USER_CURRENT')) {
                    structuralMap[i] = 'USER_CURRENT';
                    uidMap[i] = `chat_msg_0`;
                }
            }
        }

        let userCurrentText = "";
        for (let i = 0; i < incomingStream.length; i++) {
            if (structuralMap[i] === 'USER_CURRENT') {
                userCurrentText = incomingStream[i].content.trim();
                break;
            }
        }

        // 🌟 2. 源碼溯源、分類與「全域結構 UID」生成
        let catCounters = {};
        for (let i = 0; i < incomingStream.length; i++) {
            const msg = incomingStream[i];
            msg._norm = CoreEngine.normalize(msg.content);
            msg._origTemplate = CoreEngine.macroMap.get(msg._norm) || msg._norm;

            let isDynamic = false;
            if (userCurrentText.length > 3 && structuralMap[i] !== 'USER_CURRENT' && msg.content.includes(userCurrentText)) {
                isDynamic = true;
            } else if (msg._origTemplate.includes('{{') && msg._origTemplate.includes('}}')) {
                if (!state.promptTracker[msg._origTemplate]) {
                    state.promptTracker[msg._origTemplate] = { lastRes: msg._norm, isDynamic: false };
                } else {
                    if (state.promptTracker[msg._origTemplate].lastRes !== msg._norm) {
                        state.promptTracker[msg._origTemplate].isDynamic = true;
                        state.promptTracker[msg._origTemplate].lastRes = msg._norm;
                    }
                    isDynamic = state.promptTracker[msg._origTemplate].isDynamic;
                }
            }

            msg._isDynamic = isDynamic;
            msg._attr = CoreEngine.classify(msg, structuralMap[i], isDynamic);
            
            // 🌟 天才構想實現：為所有非歷史提示詞生成基於「分類+角色+順序」的絕對結構 UID
            if (!uidMap[i]) {
                let key = `${msg._attr.cat}_${msg.role}`;
                catCounters[key] = (catCounters[key] || 0) + 1;
                uidMap[i] = `struct_${key}_${catCounters[key]}`;
            }
            msg._uid = uidMap[i];
            msg._origIdx = i + 1;
            incomingPool.push(msg);
        }

        if (!Settings.enabled) {
            incomingPool.forEach((msg, idx) => {
                ledger.push({
                    time: processTime, ref: msg, origIdx: msg._origIdx, finalIdx: idx + 1,
                    role: msg.role.charAt(0).toUpperCase() + msg.role.slice(1),
                    attr: msg._attr, gen: '原始載入', creator: msg._attr.creator, action: '未處理', func: '插件已停用', status: '未凍結'
                });
            });
            return; 
        }

        let nextFrozen = [];
        let matchResults = new Array(state.frozenSequence.length).fill(-1);
        let matchedIncomingIndices = new Set();
        let matchedFrozenIndices = new Set();
        
        // 🌟 3. 四重極限對齊算法 (The 4-Pass Quantum Entanglement)

        // 第一重：歷史紀錄絕對 UID 鎖定
        for (let i = 0; i < state.frozenSequence.length; i++) {
            let frozen = state.frozenSequence[i];
            if (frozen._uid && frozen._uid.startsWith('chat_')) {
                for (let j = 0; j < incomingPool.length; j++) {
                    if (matchedIncomingIndices.has(j)) continue;
                    if (incomingPool[j]._uid === frozen._uid) {
                        matchResults[i] = j; matchedIncomingIndices.add(j); matchedFrozenIndices.add(i); break;
                    }
                }
            }
        }

        // 第二重：完美文本匹配 (針對未修改的靜態提示詞)
        for (let i = 0; i < state.frozenSequence.length; i++) {
            if (matchedFrozenIndices.has(i)) continue;
            let frozen = state.frozenSequence[i];
            for (let j = 0; j < incomingPool.length; j++) {
                if (matchedIncomingIndices.has(j)) continue;
                if (incomingPool[j].role !== frozen.role) continue;
                if (incomingPool[j]._norm === frozen._norm) {
                    matchResults[i] = j; matchedIncomingIndices.add(j); matchedFrozenIndices.add(i); break;
                }
            }
        }

        // 第三重：Jaccard 語義感知 (捕捉小幅/中幅修改)
        for (let i = 0; i < state.frozenSequence.length; i++) {
            if (matchedFrozenIndices.has(i)) continue;
            let frozen = state.frozenSequence[i];
            if (frozen._isDynamic) continue;
            
            let bestMatchIdx = -1; let bestSim = 0;
            for (let j = 0; j < incomingPool.length; j++) {
                if (matchedIncomingIndices.has(j)) continue;
                if (incomingPool[j].role !== frozen.role) continue;
                if (incomingPool[j]._isDynamic) continue;
                if (incomingPool[j]._attr.cat !== frozen._attr.cat) continue;
                
                let sim = CoreEngine.getSimilarity(frozen._norm, incomingPool[j]._norm);
                if (sim > bestSim) { bestSim = sim; bestMatchIdx = j; }
            }
            if (bestSim > 0.5 && bestMatchIdx !== -1) {
                matchResults[i] = bestMatchIdx; matchedIncomingIndices.add(bestMatchIdx); matchedFrozenIndices.add(i);
            }
        }

        // 第四重：終極結構感知 (捕捉被完全重寫的預設提示詞/世界書)
        for (let i = 0; i < state.frozenSequence.length; i++) {
            if (matchedFrozenIndices.has(i)) continue;
            let frozen = state.frozenSequence[i];
            if (frozen._isDynamic) continue;
            
            for (let j = 0; j < incomingPool.length; j++) {
                if (matchedIncomingIndices.has(j)) continue;
                if (incomingPool[j]._uid === frozen._uid && incomingPool[j]._attr.cat === frozen._attr.cat) {
                    matchResults[i] = j; matchedIncomingIndices.add(j); matchedFrozenIndices.add(i); break;
                }
            }
        }

        // 🌟 4. 處理對齊結果與前綴緩存斷點計算
        let totalFrozenLen = state.frozenSequence.reduce((acc, m) => acc + m.content.length, 0) || 1;
        let currentValidLength = 0;
        let firstBreakIndex = -1; 
        let breakNodeName = "";
        let syncMessages = [];

        for (let i = 0; i < state.frozenSequence.length; i++) {
            let frozen = state.frozenSequence[i];
            let matchIdx = matchResults[i];
            const roleStr = frozen.role.charAt(0).toUpperCase() + frozen.role.slice(1);

            if (frozen._origTemplate && state.promptTracker[frozen._origTemplate]?.isDynamic) {
                frozen._isDynamic = true;
                if (frozen._attr.type !== 'DYNAMIC') {
                    frozen._attr.cat = '動態'; frozen._attr.source = '動態提示詞(舊版保留)'; frozen._attr.type = 'DYNAMIC';
                }
            }

            if (matchIdx !== -1) {
                let matched = incomingPool[matchIdx];
                if (frozen._norm === matched._norm) {
                    nextFrozen.push(frozen);
                    if (firstBreakIndex === -1) currentValidLength += frozen.content.length;
                    ledger.push({ time: processTime, ref: frozen, origIdx: matched._origIdx, role: roleStr, attr: frozen._attr, gen: '繼承', creator: frozen._attr.creator, action: '原位凍結', func: '量子糾纏(完美匹配)', status: '已凍結' });
                } else {
                    if (firstBreakIndex === -1) { firstBreakIndex = currentValidLength; breakNodeName = frozen._attr.source; }
                    syncMessages.push(`[修改] ${matched._attr.source}`);
                    
                    frozen.content = matched.content; 
                    frozen._norm = matched._norm; 
                    frozen._origTemplate = matched._origTemplate;
                    frozen._uid = matched._uid;
                    frozen._attr = matched._attr;
                    
                    nextFrozen.push(frozen);
                    let funcName = frozen._uid === matched._uid ? '量子糾纏(結構感知)' : '量子糾纏(語義感知)';
                    ledger.push({ time: processTime, ref: frozen, origIdx: matched._origIdx, role: roleStr, attr: frozen._attr, gen: '修改', creator: frozen._attr.creator, action: '鏡像同步', func: funcName, status: '已凍結' });
                }
            } else if (frozen._isDynamic) {
                nextFrozen.push(frozen);
                if (firstBreakIndex === -1) currentValidLength += frozen.content.length;
                ledger.push({ time: processTime, ref: frozen, origIdx: '-', role: roleStr, attr: frozen._attr, gen: '繼承', creator: frozen._attr.creator, action: '保留舊動態', func: '動態幽靈(舊版保留)', status: '已凍結' });
            } else {
                if (firstBreakIndex === -1) { firstBreakIndex = currentValidLength; breakNodeName = frozen._attr.source; }
                syncMessages.push(`[刪除] ${frozen._attr.source}`);
                ledger.push({ time: processTime, ref: frozen, origIdx: '-', role: roleStr, attr: frozen._attr, gen: '消失', creator: frozen._attr.creator, action: '向上補位(刪除)', func: '量子糾纏(刪除感知)', status: '已刪除' });
            }
        }

        let cacheDrop = 0;
        if (firstBreakIndex !== -1) {
            cacheDrop = ((totalFrozenLen - firstBreakIndex) / totalFrozenLen) * 100;
        }

        if (syncMessages.length > 0 && Settings.instantNotify && typeof toastr !== 'undefined') {
            let dropText = cacheDrop > 0 ? `預估緩存流失率：<b style="color:#ff4444;">${cacheDrop.toFixed(2)}%</b><br><span style="font-size:11px; color:#aaa;">(斷點後的所有提示詞緩存已失效)</span>` : `<span style="color:#00e5ff;">(修改位於末端，緩存無損)</span>`;
            
            toastr.warning(
                `<b style="font-size:14px;">⚠️ 量子糾纏同步觸發</b><br><br>
                ${syncMessages.join('<br>')}<br><br>
                <b style="color:#ff4444;">前綴緩存已斷裂！</b><br>
                斷點位置：${breakNodeName || '末端'}<br>
                ${dropText}`, 
                'DeepSeek 緩存優化器', {timeOut: 10000, escapeHtml: false}
            );
        }

        // 🌟 5. 處理剩餘的、需要被追加的新提示詞 (完美實現絕對排序邏輯)
        let remainingPool = incomingPool.filter((_, idx) => !matchedIncomingIndices.has(idx));
        let newHistory = [], newDefault = [], newLorebook = [], newOther = [], allDynamic = [], currentUser = [], currentPrefill = [], aiLastReply = [];
        let isChat1 = state.frozenSequence.length === 0;

        remainingPool.forEach(msg => {
            if (msg._attr.type === 'USER_CURRENT') currentUser.push(msg);
            else if (msg._attr.type === 'PREFILL') currentPrefill.push(msg);
            else if (msg._attr.type === 'AI_LAST_REPLY') aiLastReply.push(msg);
            else if (msg._isDynamic) allDynamic.push(msg); 
            else if (msg._attr.type === 'USER_HISTORY' || msg._attr.type === 'AI_HISTORY') newHistory.push(msg);
            else if (msg._attr.type === 'DEFAULT') newDefault.push(msg);
            else if (msg._attr.type === 'LOREBOOK') newLorebook.push(msg);
            else newOther.push(msg);
        });

        const appendToFrozen = (arr, gen, actionName, funcName) => {
            arr.forEach(msg => {
                nextFrozen.push(msg);
                const roleStr = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
                ledger.push({ time: processTime, ref: msg, origIdx: msg._origIdx, role: roleStr, attr: msg._attr, gen: gen, creator: msg._attr.creator, action: actionName, func: funcName, status: '已凍結' });
            });
        };

        if (isChat1) {
            appendToFrozen(newDefault, '新增', '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(newLorebook, '新增', '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(newOther, '新增', '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(allDynamic, '新增', '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(newHistory, '新增', '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(aiLastReply, '新增', '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(currentUser, '新增', '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(currentPrefill, '新增', '即時凍結', '絕對凍結(對話1)');
        } else {
            appendToFrozen(newHistory, '新增', '追加凍結', '絕對凍結(對話2+)');
            appendToFrozen(aiLastReply, '新增', '追加凍結', '絕對凍結(對話2+)');
            appendToFrozen(newDefault, '新增', '追加凍結', '絕對凍結(對話2+)');
            appendToFrozen(newLorebook, '新增', '追加凍結', '絕對凍結(對話2+)');
            appendToFrozen(newOther, '新增', '追加凍結', '絕對凍結(對話2+)');
            appendToFrozen(allDynamic, '新增', '鏡像追加', '絕對凍結(對話2+)');
            appendToFrozen(currentUser, '新增', '即時凍結', '絕對凍結(對話2+)');
            appendToFrozen(currentPrefill, '新增', '即時凍結', '絕對凍結(對話2+)');
        }

        state.frozenSequence = nextFrozen;
        state.updatedAt = Date.now();
        safeSave();

        data.chat.length = 0;
        data.chat.push(...nextFrozen.map(m => {
            let clean = { role: m.role, content: m.content };
            if (m.name) clean.name = m.name;
            return clean;
        }));

        if (Settings.logLevel >= LogLevels.DETAILED) {
            let mdLog = `### 🛡️ 絕對防禦矩陣處理報告 (量子糾纏)\n\n`;
            mdLog += `| 時間 | 最終排序 | 原始排序 | 角色 | 分類 | 原始來源 | 生成方式 | 創造者 | 處理方式 | 處理功能 | 狀態 | 提示詞內容 |\n`;
            mdLog += `|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
            
            ledger.forEach(entry => {
                if (entry.status === '已刪除') entry.finalIdx = '-';
                else {
                    let idx = nextFrozen.indexOf(entry.ref);
                    entry.finalIdx = idx !== -1 ? idx + 1 : '-';
                }
            });

            ledger.sort((a, b) => {
                if (a.finalIdx === '-' && b.finalIdx === '-') return 0;
                if (a.finalIdx === '-') return 1;
                if (b.finalIdx === '-') return -1;
                return a.finalIdx - b.finalIdx;
            });

            ledger.forEach(l => {
                mdLog += `| ${l.time} | ${l.finalIdx} | ${l.origIdx} | ${l.role} | ${l.attr.cat} | ${l.attr.source} | ${l.gen} | ${l.creator} | ${l.action} | ${l.func} | ${l.status} | ${Logger.truncate(l.ref.content)} |\n`;
            });

            Logger.write(mdLog, LogLevels.DETAILED);
        } else if (Settings.logLevel >= LogLevels.STANDARD) {
            Logger.write(`✅ 處理完成。凍結池: ${state.frozenSequence.length} 節點`, LogLevels.STANDARD);
        }

    } catch (err) {
        console.error('[DS Cache] 攔截器發生錯誤:', err);
        Logger.write(`❌ 攔截器發生錯誤: ${err.message}`, LogLevels.BASIC);
    }
}

// ==========================================
// 🌟 UI 渲染與設置 (重構與美化)
// ==========================================
function addMenuEntry() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('ds-cache-reset-menu-item')) return;
    
    const item = document.createElement('div');
    item.id = 'ds-cache-reset-menu-item';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.setAttribute('role', 'listitem');
    item.title = '重置當前聊天凍結池 (DeepSeek Cache)';
    item.innerHTML = `<div class="fa-fw fa-solid fa-rotate-left extensionsMenuExtensionButton"></div><span>重置當前凍結池</span>`;
    
    item.addEventListener('click', () => {
        const menuEl = document.getElementById('extensionsMenu');
        if (menuEl) menuEl.style.display = 'none';
        resetCurrentChatCache();
    });
    
    menu.appendChild(item);
}

function renderChatsUI() {
    const container = $('#ds-chat-list-container');
    if (container.length === 0) return;
    container.empty();
    
    const keys = Object.keys(Settings.chats);
    if (keys.length === 0) {
        container.append(`<div style="padding: 20px; text-align: center; color: #888; font-size: 13px;">尚無接管的存檔數據</div>`);
        return;
    }

    const groupedChats = {};
    keys.forEach(k => {
        const chat = Settings.chats[k];
        if (!groupedChats[chat.character]) groupedChats[chat.character] = [];
        groupedChats[chat.character].push({ key: k, ...chat });
    });

    const currentChatKey = getChatKey().key;
    let html = '';

    for (const [charName, chats] of Object.entries(groupedChats)) {
        html += `<div class="ds-char-group">
                    <div class="ds-char-header"><i class="fa-solid fa-user" style="margin-right: 5px;"></i>${charName}</div>`;
        
        chats.forEach(c => {
            const isCurrent = c.key === currentChatKey;
            const chatName = c.label.replace('.jsonl', '');
            html += `
            <div class="ds-chat-item ${isCurrent ? 'ds-chat-current' : ''}">
                <div class="ds-chat-info">
                    <span class="ds-chat-name">${isCurrent ? '<i class="fa-solid fa-location-dot" style="color:#00e5ff; margin-right:4px;"></i>' : ''}存檔: ${chatName}</span>
                    <span class="ds-chat-nodes">${c.frozenSequence.length} 節點</span>
                </div>
                <button class="ds-icon-btn ds-delete-chat-btn" data-key="${c.key}" title="清除此存檔的凍結池"><i class="fa-solid fa-trash-can"></i></button>
            </div>`;
        });
        html += `</div>`;
    }
    
    container.append(html);

    $('.ds-delete-chat-btn').on('click', function() {
        const key = $(this).data('key');
        if (confirm('確定要清除此存檔的凍結池嗎？\n(這不會刪除你的聊天記錄，只會重置緩存排序)')) {
            delete Settings.chats[key];
            safeSave();
            renderChatsUI();
            if (typeof toastr !== 'undefined') toastr.success("已清除該存檔的凍結池");
        }
    });
}

function createToggle(id, title, desc, checked) {
    return `
    <div style="display: flex; align-items: flex-start; margin-bottom: 12px; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px;">
        <input type="checkbox" id="ds-opt-${id}" ${checked ? 'checked' : ''} style="margin-right: 12px; margin-top: 4px; cursor: pointer;">
        <div>
            <label for="ds-opt-${id}" style="font-weight: bold; cursor: pointer; color: #00e5ff; font-size: 14px;">${title}</label>
            <span style="font-size: 12px; color: #aaa; display: block; margin-top: 4px;">${desc}</span>
        </div>
    </div>`;
}

async function setupUI() {
    if (!$('#ds-log-style').length) {
        $('head').append(`
            <style id="ds-log-style">
                .ds-log-container { width: 100%; overflow-x: auto; max-height: 400px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; background: #111; margin-top: 8px; }
                .ds-log-table { width: 100%; border-collapse: collapse; font-size: 12px; color: #ddd; margin-bottom: 15px; } 
                .ds-log-table th, .ds-log-table td { white-space: nowrap; } 
                .ds-log-table th { position: sticky; top: 0; background: #222; color: #00e5ff; padding: 8px 10px; border-bottom: 2px solid #00e5ff; z-index: 10; font-weight: bold; text-align: left; }
                .ds-log-table td { border-bottom: 1px solid rgba(255,255,255,0.05); padding: 6px 10px; text-align: left; max-width: 250px; overflow: hidden; text-overflow: ellipsis; }
                .ds-log-table tr:nth-child(even) { background: rgba(255,255,255,0.02); }
                .ds-log-table tr:hover { background: rgba(0, 229, 255, 0.15); }
                
                .ds-icon-btn { background: transparent; border: none; color: #aaa; cursor: pointer; font-size: 14px; padding: 4px 8px; transition: 0.2s; border-radius: 4px; }
                .ds-icon-btn:hover { color: #00e5ff; background: rgba(0, 229, 255, 0.1); }
                
                .ds-char-group { margin-bottom: 10px; background: rgba(0,0,0,0.2); border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.05); }
                .ds-char-header { background: rgba(0, 229, 255, 0.1); padding: 6px 10px; font-size: 13px; font-weight: bold; color: #00e5ff; border-bottom: 1px solid rgba(255,255,255,0.05); }
                .ds-chat-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.02); transition: 0.2s; }
                .ds-chat-item:last-child { border-bottom: none; }
                .ds-chat-item:hover { background: rgba(255,255,255,0.05); }
                .ds-chat-current { background: rgba(0, 229, 255, 0.05); border-left: 3px solid #00e5ff; }
                .ds-chat-info { display: flex; flex-direction: column; gap: 3px; }
                .ds-chat-name { font-size: 13px; color: #ddd; }
                .ds-chat-nodes { font-size: 11px; color: #888; }
                .ds-chat-current .ds-chat-name { color: #00e5ff; font-weight: bold; }
                .ds-delete-chat-btn:hover { color: #ff4444; background: rgba(255, 68, 68, 0.1); }
            </style>
        `);
    }

    const html = `
    <div class="inline-drawer" id="ds-v36-opt-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>DeepSeek V4 Pro 絕對防禦矩陣 (v36.6 終極暴風掃描版)</b>
            <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="padding:15px 10px;">
            
            <div style="margin-bottom: 15px;">
                ${createToggle('enabled', '🛡️ 啟用絕對不可變序列 (總開關)', '嚴格遵守「只追加不移位」的絕對規則，鎖定所有提示詞位置，實現接近 100% 的緩存命中率。', Settings.enabled)}
                ${createToggle('instantNotify', '🔔 啟用量子糾纏即時提醒', '全自動感知用戶修改或刪除歷史訊息，並即時彈窗提醒該操作對緩存命中率的影響。', Settings.instantNotify)}
            </div>

            <div style="margin-bottom: 10px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 6px; display: flex; align-items: center; justify-content: space-between;">
                <span style="font-size: 14px; font-weight: bold; color: #e0e0e0;">📝 日誌輸出等級</span>
                <select id="ds-opt-logLevel" class="text_pole" style="width: 150px; padding: 4px;">
                    <option value="0" ${Settings.logLevel===0?'selected':''}>0: 關閉</option>
                    <option value="1" ${Settings.logLevel===1?'selected':''}>1: 基礎警告</option>
                    <option value="2" ${Settings.logLevel===2?'selected':''}>2: 標準摘要</option>
                    <option value="3" ${Settings.logLevel===3?'selected':''}>3: 全景 Markdown 表格</option>
                    <option value="4" ${Settings.logLevel===4?'selected':''}>4: 極限除錯</option>
                </select>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <b style="font-size: 13px; color: #aaa;">📂 存檔凍結池狀態：</b>
                <button id="ds-cache-factory-reset" class="ds-icon-btn" style="color: #ff4444; font-size: 12px;" title="清空所有存檔"><i class="fa-solid fa-triangle-exclamation"></i> 全部清空</button>
            </div>
            <div id="ds-chat-list-container" style="max-height: 250px; overflow-y: auto; margin-bottom: 15px; padding-right: 5px;"></div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                <b style="font-size: 13px; color: #aaa;">📝 全景 Markdown 日誌：</b>
                <div>
                    <button id="ds-log-copy" class="ds-icon-btn" title="複製日誌"><i class="fa-solid fa-copy"></i></button>
                    <button id="ds-log-export" class="ds-icon-btn" title="導出 .md"><i class="fa-solid fa-download"></i></button>
                    <button id="ds-log-clear" class="ds-icon-btn" title="清空日誌"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
            <div id="ds-cache-log-viewer" style="width: 100%; height: 350px; background: #0d0d0d; color: #e0e0e0; font-family: Consolas, monospace; font-size: 12px; overflow-y: auto; border-radius: 6px; padding: 10px; border: 1px solid rgba(255,255,255,0.1); white-space: nowrap;"></div>
        </div>
    </div>`;
    
    $('#extensions_settings').append(html);
    Logger._uiViewer = document.getElementById('ds-cache-log-viewer');

    $('#ds-opt-enabled').on('change', function() { Settings.enabled = $(this).is(':checked'); safeSave(); });
    $('#ds-opt-instantNotify').on('change', function() { Settings.instantNotify = $(this).is(':checked'); safeSave(); });
    $('#ds-opt-logLevel').on('change', function () { Settings.logLevel = parseInt($(this).val()); safeSave(); });
    
    $('#ds-cache-factory-reset').on('click', () => { 
        if (confirm("⚠️ 警告：這將摧毀所有角色卡、所有存檔的快取連續性！確定要全部清除嗎？")) { 
            Settings.chats = {}; safeSave(); renderChatsUI(); 
        } 
    });

    $('#ds-log-copy').on('click', Logger.copy);
    $('#ds-log-export').on('click', Logger.export);
    $('#ds-log-clear').on('click', Logger.clear);
    
    renderChatsUI();
}

jQuery(async () => {
    try {
        initSettings(); 
        await setupUI();
        addMenuEntry();
        
        CoreEngine.patchSTEngine();
        
        if (eventSource) {
            if (event_types?.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, renderChatsUI);
            if (event_types?.CHAT_COMPLETION_PROMPT_READY) {
                eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
            }
        }

        Logger.write('══════ 🛡️ V36.6 終極暴風掃描版 就緒 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件啟動崩潰:', e);
    }
});
