import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 狀態與設定 (Settings & State)
// ==========================================
let Settings = {};

function initSettings() {
    const defaultSettings = { enabled: true, instantNotify: true, logLevel: 3, chats: {} };
    if (!extension_settings.ds_cache_v36_absolute) extension_settings.ds_cache_v36_absolute = defaultSettings;
    Settings = Object.assign({}, defaultSettings, extension_settings.ds_cache_v36_absolute);
}

function safeSave() {
    try { 
        extension_settings.ds_cache_v36_absolute = Settings;
        if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced(); 
    } catch (e) { console.warn("[DS Cache] 存檔失敗", e); }
}

// ==========================================
// 深度日誌系統 (GPU 加速 & 批次渲染)
// ==========================================
const LogLevels = { OFF: 0, BASIC: 1, STANDARD: 2, DETAILED: 3, EXTREME: 4 };
let rawMarkdownLogs = [];
let logQueue = [];
let logRenderTimer = null;
const MAX_LOG_ENTRIES = 500; 

const Logger = {
    _uiViewer: null,
    getTime: () => {
        const now = new Date();
        return `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
    },
    truncate: (text) => {
        if (!text) return '';
        const clean = text.replace(/[\n\r]/g, ' ');
        return clean.length > 30 ? clean.substring(0, 30) + '...' : clean;
    },
    write: (markdownText, level = LogLevels.STANDARD) => {
        if (Settings.logLevel < level) return;
        const entry = `${markdownText}\n`;
        
        rawMarkdownLogs.push(entry);
        if (rawMarkdownLogs.length > MAX_LOG_ENTRIES) rawMarkdownLogs.shift();
        
        Logger.queueUIUpdate(entry);
        if (level === LogLevels.EXTREME) console.log(`[DS Cache EXTREME]`, markdownText);
    },
    queueUIUpdate: (newEntry) => {
        if (!Logger._uiViewer) return;
        let html = newEntry.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/^- (.*)/gm, '<li>$1</li>');
        if (html.includes('|')) {
            const lines = html.split('\n');
            let tableHtml = '<div class="ds-ui-log-container"><table class="ds-ui-log-table">';
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
        
        logQueue.push(html);
        
        if (!logRenderTimer) {
            logRenderTimer = requestAnimationFrame(() => {
                const fragment = document.createDocumentFragment();
                logQueue.forEach(h => {
                    const div = document.createElement('div');
                    div.className = 'ds-ui-log-entry';
                    div.innerHTML = h;
                    fragment.appendChild(div);
                });
                Logger._uiViewer.appendChild(fragment);
                
                while (Logger._uiViewer.childElementCount > MAX_LOG_ENTRIES) {
                    Logger._uiViewer.removeChild(Logger._uiViewer.firstChild);
                }
                
                Logger._uiViewer.scrollTop = Logger._uiViewer.scrollHeight;
                logQueue = [];
                logRenderTimer = null;
            });
        }
    },
    clear: () => { rawMarkdownLogs = []; if (Logger._uiViewer) Logger._uiViewer.innerHTML = ''; if (typeof toastr !== 'undefined') toastr.success("日誌已清空", "DeepSeek Cache"); },
    copy: () => { navigator.clipboard.writeText(rawMarkdownLogs.join('\n')).then(() => { if (typeof toastr !== 'undefined') toastr.success("日誌已複製到剪貼簿", "DeepSeek Cache"); }); },
    export: () => {
        const blob = new Blob([rawMarkdownLogs.join('\n')], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `DSCache_Log_${new Date().toISOString().replace(/[:.]/g, '-')}.md`; a.click(); URL.revokeObjectURL(url);
        if (typeof toastr !== 'undefined') toastr.success("日誌導出成功", "DeepSeek Cache");
    }
};

// ==========================================
// 存檔管理系統 (Archive System)
// ==========================================
function getChatKey() {
    const context = getContext();
    let chatId = context.chatId || "default_chat";
    let character = context.name2 || "未分類角色";
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
        if (typeof toastr !== 'undefined') toastr.success(`已重置當前聊天 (${chatInfo.character}) 的凍結池。<br>下一次對話將重新構建緩存序列。`, "DeepSeek Cache", {escapeHtml: false});
        Logger.write(`**[${Logger.getTime()}]** 🔄 用戶手動重置了當前聊天 (${chatInfo.character}) 的凍結池`, LogLevels.BASIC);
    }
}

// ==========================================
// 🛡️ 核心引擎：極速演算法與精準溯源
// ==========================================
const CoreEngine = {
    macroMap: new Map(), 
    promptIndex: [], 
    lastScanTime: 0,

    normalize: (text) => {
        if (!text) return '';
        return text.replace(/[\s\n\r\t]/g, '').replace(/\\n/g, '').trim();
    },

    getGrams: (str) => {
        let grams = new Set();
        if (typeof str !== 'string') return grams;
        let len = str.length;
        if (len < 3) { if (len > 0) grams.add(str); return grams; }
        for (let i = 0; i <= len - 3; i++) grams.add(str.substring(i, i + 3));
        return grams;
    },

    getOverlapRatioFast: (g1, g2) => {
        if (!g1 || !g2 || !(g1 instanceof Set) || !(g2 instanceof Set) || g1.size === 0 || g2.size === 0) return 0;
        let intersect = 0;
        let smaller = g1.size < g2.size ? g1 : g2;
        let larger = g1.size < g2.size ? g2 : g1;
        for (let g of smaller) { if (larger.has(g)) intersect++; }
        return intersect / smaller.size; 
    },

    getSimilarityFast: (g1, g2) => {
        if (!g1 || !g2 || !(g1 instanceof Set) || !(g2 instanceof Set) || g1.size === 0 || g2.size === 0) return 0;
        let intersect = 0;
        for (let g of g1) { if (g2.has(g)) intersect++; }
        let union = g1.size + g2.size - intersect;
        return union === 0 ? 0 : intersect / union;
    },

    buildIndex: () => {
        const now = Date.now();
        if (now - CoreEngine.lastScanTime < 2000) return; 
        CoreEngine.lastScanTime = now;

        CoreEngine.promptIndex = [];
        let seenNorms = new Set();

        const addToIndex = (norm, cat, source, creator, type, bookName, entryName) => {
            if (!norm || norm.length < 2 || seenNorms.has(norm)) return;
            seenNorms.add(norm);
            CoreEngine.promptIndex.push({ contentNorm: norm, nGrams: CoreEngine.getGrams(norm), cat, source, creator, type, bookName, entryName });
        };

        const deepScan = (obj, depth = 0, visited = new WeakSet(), bookName = "未知世界書", charName = "") => {
            if (depth > 10 || !obj || typeof obj !== 'object') return;
            if (visited.has(obj)) return;
            visited.add(obj);

            const hasEntriesArr = Array.isArray(obj.entries);

            // Detect if this object is a world book container by checking for structural signatures:
            // A world book has: a 'name' string + an 'entries' array whose first element has uid/key.
            if (typeof obj.name === 'string' && hasEntriesArr && obj.entries.length > 0) {
                const first = obj.entries[0];
                if (first && typeof first === 'object' && (first.uid !== undefined || Array.isArray(first.key))) {
                    bookName = obj.name;
                }
            }

            // Detect if this object is a character (has name + data) to feed charName into world book labeling.
            if (typeof obj.name === 'string' && typeof obj.data === 'object' && !charName) {
                charName = obj.name;
            }

            // Check if this is a world book entry (individual entry object).
            if (typeof obj.content === 'string' && (Array.isArray(obj.key) || obj.uid !== undefined || obj.comment !== undefined || obj.constant !== undefined)) {
                if (!obj.role && obj.type !== 'prompt') {
                    let effectiveBookName = bookName;
                    if (effectiveBookName === '未知世界書' && charName) effectiveBookName = `${charName}(角色內嵌世界書)`;
                    let entryName = obj.comment || obj.name || obj.title;
                    if (!entryName && Array.isArray(obj.key) && obj.key.length > 0) entryName = obj.key.join(', ');
                    if (!entryName) entryName = '未命名條目';
                    addToIndex(CoreEngine.normalize(obj.content), '世界書', `世界書(${effectiveBookName}: ${entryName})`, '世界書系統', 'LOREBOOK', effectiveBookName, entryName);
                }
            }

            // Check if this is a preset prompt template (has name/identifier + role/type).
            if (typeof obj.content === 'string' && (obj.name || obj.identifier) && (obj.role || obj.type === 'prompt')) {
                let pName = obj.name || obj.identifier;
                let pClass = obj.role === 'system' ? '系統' : (obj.role || '提示詞');
                addToIndex(CoreEngine.normalize(obj.content), '預設', `預設(${pClass}-${pName})`, obj.role || 'ST核心', 'DEFAULT');
            }

            // Character core properties — index them with the character name for traceability.
            if (typeof obj.description === 'string' && obj.name) addToIndex(CoreEngine.normalize(obj.description), '角色', `預設(角色描述-${obj.name})`, '核心設定', 'DEFAULT');
            if (typeof obj.personality === 'string' && obj.name) addToIndex(CoreEngine.normalize(obj.personality), '角色', `預設(性格描述-${obj.name})`, '核心設定', 'DEFAULT');
            if (typeof obj.scenario === 'string' && obj.scenario.length > 0) addToIndex(CoreEngine.normalize(obj.scenario), '角色', `預設(場景-${obj.name || '未知角色'})`, '核心設定', 'DEFAULT');
            if (typeof obj.first_mes === 'string' && obj.first_mes.length > 0) addToIndex(CoreEngine.normalize(obj.first_mes), '角色', `預設(初次對話-${obj.name || '未知角色'})`, '核心設定', 'DEFAULT');
            if (typeof obj.mes_example === 'string' && obj.mes_example.length > 0) addToIndex(CoreEngine.normalize(obj.mes_example), '角色', `預設(對話範例-${obj.name || '未知角色'})`, '核心設定', 'DEFAULT');
            if (typeof obj.persona_description === 'string' && obj.persona_description.length > 0) addToIndex(CoreEngine.normalize(obj.persona_description), '用戶', `預設(用戶設定)`, '用戶', 'DEFAULT');

            for (let key in obj) {
                try {
                    let val = obj[key];
                    if (val && typeof val === 'object' && !(val instanceof Element) && !(val instanceof Node)) {
                        deepScan(val, depth + 1, visited, bookName, charName);
                    }
                } catch (e) {}
            }
        };

        const roots = [window.world_info, window.settings, window.extension_settings, window.power_user, window.prompt_manager, window.characters, getContext()];
        roots.forEach(root => { if (root) deepScan(root, 0, new WeakSet(), "全域世界書"); });
    },

    findInIndex: (normContent, nGrams) => {
        if (!normContent || normContent.length < 5) return null;
        for (let i = 0; i < CoreEngine.promptIndex.length; i++) {
            if (CoreEngine.promptIndex[i].contentNorm === normContent) return CoreEngine.promptIndex[i];
        }
        let bestMatch = null;
        let bestScore = 0;
        for (let i = 0; i < CoreEngine.promptIndex.length; i++) {
            const idxItem = CoreEngine.promptIndex[i];
            if (idxItem.contentNorm.length > 10 && normContent.length > 10) {
                let overlap = CoreEngine.getOverlapRatioFast(idxItem.nGrams, nGrams);
                let lenRatio = Math.min(idxItem.contentNorm.length, normContent.length) / Math.max(idxItem.contentNorm.length, normContent.length);
                let score = overlap * 0.8 + lenRatio * 0.2;
                if (overlap > 0.85 && score > bestScore) {
                    bestScore = score;
                    bestMatch = idxItem;
                }
            }
        }
        if (bestMatch) {
            return { contentNorm: bestMatch.contentNorm, nGrams: bestMatch.nGrams, cat: bestMatch.cat, source: bestMatch.source, creator: bestMatch.creator, type: bestMatch.type, bookName: bestMatch.bookName, entryName: bestMatch.entryName };
        }
        return null;
    },

    patchSTEngine: () => {
        try {
            const hook = (origFunc) => {
                return function(...args) {
                    const orig = args[0];
                    const res = origFunc.apply(this, args);
                    if (typeof orig === 'string' && typeof res === 'string' && orig !== res) {
                        if (orig.includes('{{') && orig.includes('}}')) {
                            let cleanRes = CoreEngine.normalize(res);
                            let cleanOrig = CoreEngine.normalize(orig);
                            if (cleanRes.length > 0) {
                                CoreEngine.macroMap.set(cleanRes, cleanOrig);
                                if (CoreEngine.macroMap.size > 1000) {
                                    CoreEngine.macroMap.delete(CoreEngine.macroMap.keys().next().value);
                                }
                            }
                        }
                    }
                    return res;
                };
            };

            if (typeof window.substituteParams === 'function' && !window._ds_orig_substituteParams) {
                window._ds_orig_substituteParams = window.substituteParams;
                window.substituteParams = hook(window._ds_orig_substituteParams);
            }
            if (typeof window.substituteParamsExtended === 'function' && !window._ds_orig_substituteParamsExtended) {
                window._ds_orig_substituteParamsExtended = window.substituteParamsExtended;
                window.substituteParamsExtended = hook(window._ds_orig_substituteParamsExtended);
            }
        } catch (e) {
            console.error("[DS Cache] 劫持 ST 宏引擎失敗:", e);
        }
    },

    classify: (msg, structuralTag, isDynamic) => {
        if (msg._isDSPlugin) return { cat: '本插件', source: '本插件', creator: 'DS Cache', type: 'PLUGIN' };
        if (structuralTag === 'USER_CURRENT') return { cat: '用戶', source: '用戶輸入', creator: '用戶', type: 'USER_CURRENT' };
        if (structuralTag === 'PREFILL') return { cat: 'AI', source: '預填充', creator: '大模型', type: 'PREFILL' };
        if (structuralTag === 'AI_LAST_REPLY') return { cat: 'AI', source: 'AI回覆', creator: '大模型', type: 'AI_LAST_REPLY' };
        if (structuralTag === 'USER_HISTORY') return { cat: '用戶', source: '用戶歷史輸入', creator: '用戶', type: 'USER_HISTORY' };
        if (structuralTag === 'AI_HISTORY') return { cat: 'AI', source: 'AI歷史回覆', creator: '大模型', type: 'AI_HISTORY' };

        let name = msg.name ? msg.name.toLowerCase() : '';
        let contentTrimmed = msg.content ? msg.content.trim() : '';

        if (name.includes('summary') || name.includes('summarization') || contentTrimmed.startsWith('[Summary:')) {
            return { cat: '摘要', source: '系統摘要(Summary)', creator: 'ST核心', type: 'SUMMARY' };
        }

        let normContent = msg._origTemplate ? CoreEngine.normalize(msg._origTemplate) : msg._norm;
        let matchedIndex = CoreEngine.findInIndex(normContent, msg._nGrams);

        if (matchedIndex) {
            if (isDynamic) {
                let dynSource = matchedIndex.source + '(動態)';
                return { cat: '動態', source: dynSource, creator: matchedIndex.creator, type: 'DYNAMIC', bookName: matchedIndex.bookName, entryName: matchedIndex.entryName };
            }
            return { cat: matchedIndex.cat, source: matchedIndex.source, creator: matchedIndex.creator, type: matchedIndex.type, bookName: matchedIndex.bookName, entryName: matchedIndex.entryName };
        }

        if (isDynamic) return { cat: '動態', source: '動態提示詞', creator: 'ST核心/插件', type: 'DYNAMIC' };

        // Fallback LOREBOOK detection from msg.name — try to extract book name and entry name.
        if (name.includes('world info') || name.includes('lorebook') || name.includes('wi-') || name.includes('wi ') || name.includes('worldinfo')) {
            let bookName = '未知世界書';
            let entryName = '未知條目';
            const nameRaw = msg.name || '';
            const bracketMatch = nameRaw.match(/\((.*?)\)/);
            if (bracketMatch) entryName = bracketMatch[1];
            const colonMatch = nameRaw.match(/(?:WI|World\s*Info|Lorebook)\s*[-:]\s*([^(:]+)/i);
            if (colonMatch) bookName = colonMatch[1].trim();
            const bookSectionMatch = nameRaw.match(/\(([^)]+):\s*([^)]+)\)/);
            if (bookSectionMatch) { bookName = bookSectionMatch[1].trim(); entryName = bookSectionMatch[2].trim(); }
            return { cat: '世界書', source: `世界書(${bookName}: ${entryName})`, creator: '世界書系統', type: 'LOREBOOK', bookName, entryName };
        }

        // Fallback detection for preset prompts based on common ST naming conventions.
        const presetNameMap = {
            'main': '主提示詞', 'nsfw': 'NSFW提示詞', 'jailbreak': '越獄提示詞',
            'description': '角色描述', 'personality': '性格描述', 'scenario': '場景',
            'first message': '初次對話', 'first_mes': '初次對話', 'mes example': '對話範例',
            'world info': '世界書', 'lorebook': '世界書', 'author': '作者註釋',
            'chat history': '對話歷史', 'example': '對話範例', 'greeting': '初次對話',
            'sysprompt': '系統提示詞', 'system': '系統提示詞', 'post-history': '對話後置',
            'pre-history': '對話前置', 'authors note': '作者註釋', 'author\'s note': '作者註釋',
            'vector': '向量檢索', 'smart context': '智能上下文', 'rag': 'RAG檢索',
        };

        if (msg.name) {
            let nameLower = msg.name.toLowerCase();
            for (const [key, label] of Object.entries(presetNameMap)) {
                if (nameLower.includes(key)) {
                    return { cat: '預設', source: `預設(${label})`, creator: 'ST核心', type: 'DEFAULT' };
                }
            }
        }

        const defaultNames = ['system', 'user', 'assistant', 'character', 'example', 'scenario', 'greeting', 'main', 'nsfw', 'jailbreak', 'description', 'personality', 'post-history', 'pre-history', 'authors note', 'author\'s note'];
        if (msg.name && !defaultNames.includes(name)) {
            return { cat: '其他插件', source: `其他插件(${msg.name})`, creator: msg.name, type: 'OTHER_PLUGIN' };
        }
        if (name.includes('author') || name.includes('note')) return { cat: '其他插件', source: `其他插件(Author's Note)`, creator: '用戶', type: 'OTHER_PLUGIN' };
        if (name.includes('vector') || name.includes('smart context') || name.includes('rag') || contentTrimmed.includes('retrieved context')) return { cat: '其他插件', source: `其他插件(向量檢索 RAG)`, creator: 'RAG系統', type: 'OTHER_PLUGIN' };

        return { cat: '預設', source: msg.name ? `預設(${msg.name})` : '預設(無名)', creator: 'ST核心', type: 'DEFAULT' };
    }
};

// ==========================================
// 🌌 絕對防禦矩陣 (雙軌排序引擎 & 量子切片)
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (data.dryRun || !data?.chat?.length) return;

    CoreEngine.buildIndex();

    try {
        const state = getChatState(getChatKey());
        let incomingStream = data.chat;
        let incomingPool = [];
        let ledger = []; 
        
        const processTime = Logger.getTime();
        const chatTurn = getContext().chat ? getContext().chat.length : 0;
        let otherPluginActions = new Set();
        let detailedMods = [];

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

        let catCounters = {};
        for (let i = 0; i < incomingStream.length; i++) {
            const msg = incomingStream[i];
            msg._norm = CoreEngine.normalize(msg.content);
            msg._nGrams = CoreEngine.getGrams(msg._norm); 
            msg._origTemplate = CoreEngine.macroMap.get(msg._norm) || msg._norm;

            let isDynamic = false;
            let contentTrimmed = msg.content ? msg.content.trim() : '';
            let nameLower = msg.name ? msg.name.toLowerCase() : '';
            
            if (nameLower.includes('summary') || nameLower.includes('summarization') || contentTrimmed.startsWith('[Summary:')) {
                isDynamic = true;
            } else if (userCurrentText.length > 3 && structuralMap[i] !== 'USER_CURRENT' && msg.content.includes(userCurrentText)) {
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
            
            if (msg._attr.type === 'OTHER_PLUGIN') {
                otherPluginActions.add(`[${msg._attr.creator}] 處理/注入了提示詞節點: ${msg._attr.source}`);
            } else if (msg._attr.type === 'LOREBOOK') {
                const bn = msg._attr.bookName || '未知世界書';
                const en = msg._attr.entryName || '未知條目';
                otherPluginActions.add(`[世界書系統] 掃描並注入了世界書條目 → 世界書: **${bn}** / 條目: **${en}**`);
            }

            if (!uidMap[i]) {
                let key = `${msg._attr.cat}_${msg.role}`;
                catCounters[key] = (catCounters[key] || 0) + 1;
                uidMap[i] = `struct_${key}_${catCounters[key]}`;
            }
            msg._uid = uidMap[i];
            msg._origIdx = i + 1;
            incomingPool.push(msg);
        }

        const printLog = (isPluginDisabled) => {
            if (Settings.logLevel < LogLevels.STANDARD) return;

            let mdLog = `**[${processTime}]** ### ${isPluginDisabled ? '🛑 [插件已停止] 原始提示詞序列分析' : '🛡️ 絕對防禦矩陣處理報告 (量子糾纏)'}\n\n`;

            if (otherPluginActions.size > 0) {
                mdLog += `#### 🧩 其他插件與系統動作偵測\n`;
                otherPluginActions.forEach(act => mdLog += `- ${act}\n`);
                mdLog += `\n`;
            }

            if (detailedMods.length > 0) {
                mdLog += `#### 📝 詳細修改與操作紀錄\n`;
                detailedMods.forEach(mod => mdLog += `- ${mod}\n`);
                mdLog += `\n`;
            }

            mdLog += `| 時間 | 原始排序 | 最終排序 | 對話輪數 | 角色 | 分類 | 原始來源 | 生成/出現 | 修改/創造者 | 處理方式 | 處理功能 | 狀態 | 提示詞內容 |\n`;
            mdLog += `|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;

            ledger.forEach(entry => {
                if (entry.status === '已刪除') entry.finalIdx = '-';
                else if (!isPluginDisabled) {
                    let idx = state.frozenSequence.indexOf(entry.ref);
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
                mdLog += `| ${l.time} | ${l.origIdx} | ${l.finalIdx} | 第 ${chatTurn} 輪 | ${l.role} | ${l.attr.cat} | ${l.attr.source} | ${l.gen} | ${l.creator} | ${l.action} | ${l.func} | ${l.status} | ${Logger.truncate(l.ref.content)} |\n`;
            });

            Logger.write(mdLog, LogLevels.DETAILED);
        };

        if (!Settings.enabled) {
            incomingPool.forEach((msg, idx) => {
                ledger.push({
                    time: processTime, ref: msg, origIdx: msg._origIdx, finalIdx: idx + 1,
                    role: msg.role.charAt(0).toUpperCase() + msg.role.slice(1),
                    attr: msg._attr, gen: '原始載入', creator: msg._attr.creator, action: '未處理', func: '插件已停用', status: '未凍結'
                });
            });
            printLog(true);
            return; 
        }

        let incomingUidMap = new Map();
        let incomingNormMap = new Map();
        incomingPool.forEach((msg, j) => {
            if (!incomingUidMap.has(msg._uid)) incomingUidMap.set(msg._uid, []);
            incomingUidMap.get(msg._uid).push(j);
            
            if (!incomingNormMap.has(msg._norm)) incomingNormMap.set(msg._norm, []);
            incomingNormMap.get(msg._norm).push(j);
        });

        let nextFrozen = [];
        let matchResults = new Array(state.frozenSequence.length).fill(-1);
        let matchedIncomingIndices = new Set();
        let matchedFrozenIndices = new Set();
        
        for (let i = 0; i < state.frozenSequence.length; i++) {
            let frozen = state.frozenSequence[i];
            if (frozen._uid && frozen._uid.startsWith('chat_')) {
                let indices = incomingUidMap.get(frozen._uid);
                if (indices) {
                    for (let j of indices) {
                        if (!matchedIncomingIndices.has(j)) {
                            matchResults[i] = j; matchedIncomingIndices.add(j); matchedFrozenIndices.add(i); break;
                        }
                    }
                }
            }
        }

        for (let i = 0; i < state.frozenSequence.length; i++) {
            if (matchedFrozenIndices.has(i)) continue;
            let frozen = state.frozenSequence[i];
            let indices = incomingNormMap.get(frozen._norm);
            if (indices) {
                for (let j of indices) {
                    if (!matchedIncomingIndices.has(j) && incomingPool[j].role === frozen.role) {
                        matchResults[i] = j; matchedIncomingIndices.add(j); matchedFrozenIndices.add(i); break;
                    }
                }
            }
        }

        for (let i = 0; i < state.frozenSequence.length; i++) {
            if (matchedFrozenIndices.has(i)) continue;
            let frozen = state.frozenSequence[i];
            if (frozen._isDynamic) continue;
            
            if (!frozen._nGrams || !(frozen._nGrams instanceof Set)) {
                frozen._nGrams = CoreEngine.getGrams(frozen._norm || ''); 
            }
            
            let bestMatchIdx = -1; let bestSim = 0;
            for (let j = 0; j < incomingPool.length; j++) {
                if (matchedIncomingIndices.has(j)) continue;
                if (incomingPool[j].role !== frozen.role || incomingPool[j]._isDynamic || incomingPool[j]._attr.cat !== frozen._attr.cat) continue;
                
                let sim = CoreEngine.getSimilarityFast(frozen._nGrams, incomingPool[j]._nGrams);
                if (sim > bestSim) { bestSim = sim; bestMatchIdx = j; }
            }
            if (bestSim > 0.5 && bestMatchIdx !== -1) {
                matchResults[i] = bestMatchIdx; matchedIncomingIndices.add(bestMatchIdx); matchedFrozenIndices.add(i);
            }
        }

        for (let i = 0; i < state.frozenSequence.length; i++) {
            if (matchedFrozenIndices.has(i)) continue;
            let frozen = state.frozenSequence[i];
            if (frozen._isDynamic) continue;
            
            let indices = incomingUidMap.get(frozen._uid);
            if (indices) {
                for (let j of indices) {
                    if (!matchedIncomingIndices.has(j) && incomingPool[j]._attr.cat === frozen._attr.cat) {
                        matchResults[i] = j; matchedIncomingIndices.add(j); matchedFrozenIndices.add(i); break;
                    }
                }
            }
        }

        let totalFrozenLen = state.frozenSequence.reduce((acc, m) => acc + m.content.length, 0) || 1;
        let currentValidLength = 0;
        let firstBreakIndex = -1; 
        let breakNodeName = "";
        let syncMessages = [];
        let extractedAppends = []; // 🌟 存放切下來的尾巴

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
                    // 🌟 量子切片：偵測是否僅為尾部追加 (且不是 User/AI)
                    let isJustAppended = false;
                    let appendedContent = "";

                    if (frozen.role !== 'user' && frozen.role !== 'assistant') {
                        if (matched._norm.startsWith(frozen._norm) && matched._norm.length > frozen._norm.length) {
                            let origIdx = 0;
                            let newIdx = 0;
                            let origClean = frozen.content.replace(/[\s\n\r\t]/g, '');
                            
                            while (origIdx < origClean.length && newIdx < matched.content.length) {
                                if (matched.content[newIdx].replace(/[\s\n\r\t]/g, '') === origClean[origIdx]) {
                                    origIdx++;
                                }
                                newIdx++;
                            }
                            
                            if (origIdx === origClean.length) {
                                isJustAppended = true;
                                appendedContent = matched.content.substring(newIdx).trim();
                            }
                        }
                    }

                    if (isJustAppended && appendedContent) {
                        // 1. 保留原凍結節點不變 (救回緩存)
                        nextFrozen.push(frozen);
                        if (firstBreakIndex === -1) currentValidLength += frozen.content.length;
                        ledger.push({ time: processTime, ref: frozen, origIdx: matched._origIdx, role: roleStr, attr: frozen._attr, gen: '繼承', creator: frozen._attr.creator, action: '原位凍結', func: '量子糾纏(無損追加)', status: '已凍結' });

                        syncMessages.push(`<span style="color:#00e5ff;">[無損追加]</span> ${matched._attr.source} (尾部新增已抽取)`);
                        detailedMods.push(`[追加] 偵測到節點尾部新增，已抽取追加內容: ${matched._attr.source}`);

                        // 2. 創建切下來的追加節點
                        let appendedMsg = Object.assign({}, matched);
                        appendedMsg.content = appendedContent;
                        appendedMsg._norm = CoreEngine.normalize(appendedContent);
                        appendedMsg._nGrams = CoreEngine.getGrams(appendedMsg._norm);
                        appendedMsg._isDynamic = true; 
                        appendedMsg._attr = Object.assign({}, matched._attr);
                        appendedMsg._attr.cat = '動態';
                        appendedMsg._attr.source = `${matched._attr.source}(追加內容)`;
                        appendedMsg._attr.type = 'DYNAMIC';
                        
                        extractedAppends.push(appendedMsg);
                    } else {
                        // 正常的修改，執行鏡像同步 (會斷緩存)
                        if (firstBreakIndex === -1) { firstBreakIndex = currentValidLength; breakNodeName = frozen._attr.source; }
                        syncMessages.push(`<span style="color:#ffaa00;">[內容修改]</span> ${matched._attr.source}`);
                        detailedMods.push(`[修改] 偵測到歷史節點被修改: ${frozen._attr.source}`);
                        
                        frozen.content = matched.content; 
                        frozen._norm = matched._norm; 
                        frozen._nGrams = matched._nGrams;
                        frozen._origTemplate = matched._origTemplate;
                        frozen._uid = matched._uid;
                        frozen._attr = matched._attr;
                        
                        nextFrozen.push(frozen);
                        let funcName = frozen._uid === matched._uid ? '量子糾纏(結構感知)' : '量子糾纏(語義感知)';
                        ledger.push({ time: processTime, ref: frozen, origIdx: matched._origIdx, role: roleStr, attr: frozen._attr, gen: '修改', creator: frozen._attr.creator, action: '鏡像同步', func: funcName, status: '已凍結' });
                    }
                }
            } else if (frozen._isDynamic) {
                nextFrozen.push(frozen);
                if (firstBreakIndex === -1) currentValidLength += frozen.content.length;
                ledger.push({ time: processTime, ref: frozen, origIdx: '-', role: roleStr, attr: frozen._attr, gen: '繼承', creator: frozen._attr.creator, action: '保留舊動態', func: '動態幽靈(舊版保留)', status: '已凍結' });
            } else {
                if (firstBreakIndex === -1) { firstBreakIndex = currentValidLength; breakNodeName = frozen._attr.source; }
                syncMessages.push(`<span style="color:#ff4444;">[節點刪除]</span> ${frozen._attr.source}`);
                detailedMods.push(`[刪除] 偵測到歷史節點被移除或失效: ${frozen._attr.source}`);
                ledger.push({ time: processTime, ref: frozen, origIdx: '-', role: roleStr, attr: frozen._attr, gen: '消失', creator: frozen._attr.creator, action: '向上補位(刪除)', func: '量子糾纏(刪除感知)', status: '已刪除' });
            }
        }

        let cacheDrop = 0;
        if (firstBreakIndex !== -1) cacheDrop = ((totalFrozenLen - firstBreakIndex) / totalFrozenLen) * 100;

        if (syncMessages.length > 0 && Settings.instantNotify && typeof toastr !== 'undefined') {
            let dropText = cacheDrop > 0 
                ? `<div style="margin-top:8px; padding:6px; background:rgba(255,68,68,0.1); border-left:3px solid #ff4444; border-radius:4px;">
                     預估緩存流失率：<b style="color:#ff4444; font-size:14px;">${cacheDrop.toFixed(2)}%</b><br>
                     <span style="font-size:11px; color:#ccc;">DeepSeek 採用嚴格的順序緩存，斷點 <b>[${breakNodeName || '未知'}]</b> 之後的所有提示詞都必須重新計算 Token。</span>
                   </div>` 
                : `<div style="margin-top:8px; padding:6px; background:rgba(0,229,255,0.1); border-left:3px solid #00e5ff; border-radius:4px;">
                     <span style="color:#00e5ff; font-size:12px;">修改發生在序列最末端，<b>緩存無損 (0% 流失)</b>，完美！</span>
                   </div>`;
            
            toastr.warning(
                `<div style="font-family:sans-serif;">
                    <b style="font-size:14px; color:#fff;"><i class="fa-solid fa-bolt"></i> 量子糾纏同步觸發</b>
                    <div style="margin:8px 0; font-size:12px; color:#ddd; line-height:1.4;">
                        系統偵測到您修改或刪除了歷史提示詞，已自動為您同步緩存序列：<br>
                        <div style="background:rgba(0,0,0,0.3); padding:6px; border-radius:4px; margin-top:4px;">
                            ${syncMessages.join('<br>')}
                        </div>
                    </div>
                    ${dropText}
                </div>`, 
                'DeepSeek 緩存優化器', {timeOut: 12000, escapeHtml: false}
            );
        }

        let remainingPool = incomingPool.filter((_, idx) => !matchedIncomingIndices.has(idx));
        let newHistory = [], newDefault = [], newLorebook = [], newOther = [], allDynamic = [], currentUser = [], currentPrefill = [], aiLastReply = [];
        let chat1SystemPrompts = []; 
        let summaryPrompts = []; 
        let isChat1 = state.frozenSequence.length === 0;

        remainingPool.forEach(msg => {
            if (msg._attr.type === 'USER_CURRENT') { 
                currentUser.push(msg); 
                detailedMods.push(`[新增] 用戶發送了第 ${chatTurn} 輪的新訊息`); 
            }
            else if (msg._attr.type === 'PREFILL') { 
                currentPrefill.push(msg); 
                detailedMods.push(`[新增] 觸發了預填充 (Prefill)`); 
            }
            else if (msg._attr.type === 'AI_LAST_REPLY') {
                aiLastReply.push(msg);
                detailedMods.push(`[新增] 載入了AI回覆: ${msg._attr.source}`);
            }
            else if (msg._attr.type === 'USER_HISTORY' || msg._attr.type === 'AI_HISTORY') {
                newHistory.push(msg);
                detailedMods.push(`[新增] 載入了歷史訊息: ${msg._attr.source}`);
            }
            else if (msg._attr.type === 'SUMMARY') {
                if (isChat1) {
                    summaryPrompts.push(msg);
                    detailedMods.push(`[新增] 抽取了系統摘要: ${msg._attr.source}`);
                } else {
                    allDynamic.push(msg);
                    detailedMods.push(`[新增] 載入了系統摘要(動態追加): ${msg._attr.source}`);
                }
            }
            else {
                if (isChat1) {
                    chat1SystemPrompts.push(msg);
                    if (msg._isDynamic) detailedMods.push(`[新增] 載入了動態提示詞: ${msg._attr.source}`);
                    else if (msg._attr.type === 'DEFAULT') detailedMods.push(`[新增] 載入了預設提示詞: ${msg._attr.source}`);
                    else if (msg._attr.type === 'LOREBOOK') {
                        const bnLb1 = msg._attr.bookName || '未知世界書';
                        const enLb1 = msg._attr.entryName || '未知條目';
                        detailedMods.push(`[新增] 觸發了新的世界書條目 → 世界書: "${bnLb1}" / 條目: "${enLb1}"`);
                    }
                    else detailedMods.push(`[新增] 插件注入了新節點: ${msg._attr.source}`);
                } else {
                    if (msg._isDynamic) {
                        allDynamic.push(msg);
                        detailedMods.push(`[新增] 載入了動態提示詞: ${msg._attr.source}`);
                    } else if (msg._attr.type === 'DEFAULT') { 
                        newDefault.push(msg); 
                        detailedMods.push(`[新增] 載入了預設提示詞: ${msg._attr.source}`); 
                    }
                    else if (msg._attr.type === 'LOREBOOK') {
                        newLorebook.push(msg);
                        const bnLb = msg._attr.bookName || '未知世界書';
                        const enLb = msg._attr.entryName || '未知條目';
                        detailedMods.push(`[新增] 觸發了新的世界書條目 → 世界書: "${bnLb}" / 條目: "${enLb}"`);
                    }
                    else { 
                        newOther.push(msg); 
                        detailedMods.push(`[新增] 插件注入了新節點: ${msg._attr.source}`); 
                    }
                }
            }
        });

        // 🌟 將量子切片提取下來的尾巴，加進動態池裡排隊
        if (extractedAppends.length > 0) {
            allDynamic.push(...extractedAppends);
        }

        const appendToFrozen = (arr, gen, actionName, funcName) => {
            arr.forEach(msg => {
                nextFrozen.push(msg);
                const roleStr = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
                ledger.push({ time: processTime, ref: msg, origIdx: msg._origIdx, role: roleStr, attr: msg._attr, gen: gen, creator: msg._attr.creator, action: actionName, func: funcName, status: '已凍結' });
            });
        };

        if (isChat1) {
            appendToFrozen(chat1SystemPrompts, '新增', '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(summaryPrompts, '新增', '即時凍結', '絕對凍結(對話1)'); 
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
            appendToFrozen(allDynamic, '新增', '動態分離(底置)', '絕對凍結(對話2+)'); // 尾巴會在這裡被追加
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

        printLog(false);

    } catch (err) {
        console.error('[DS Cache] 攔截器發生錯誤:', err);
        Logger.write(`❌ 攔截器發生錯誤: ${err.message}`, LogLevels.BASIC);
    }
}

// ==========================================
// 🌟 UI 渲染與設置 (GPU 加速 & 事件代理)
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
    item.innerHTML = `<div class="fa-fw fa-solid fa-bolt extensionsMenuExtensionButton" style="color: #00e5ff; text-shadow: 0 0 5px rgba(0,229,255,0.5);"></div><span style="font-weight:bold; color:#e0e0e0;">重置 DS 緩存池</span>`;
    
    item.addEventListener('click', () => {
        const menuEl = document.getElementById('extensionsMenu');
        if (menuEl) menuEl.style.display = 'none';
        resetCurrentChatCache();
    });
    
    menu.appendChild(item);
}

function renderChatsUI() {
    const container = $('#ds-ui-chat-list-container');
    if (container.length === 0) return;
    
    const keys = Object.keys(Settings.chats);
    if (keys.length === 0) {
        container.html(`<div style="padding: 20px; text-align: center; color: #666; font-size: 13px; font-style: italic;">尚無接管的存檔數據，開始聊天以建立緩存池。</div>`);
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
        const hasCurrent = chats.some(c => c.key === currentChatKey);
        
        html += `
        <div class="ds-ui-char-folder">
            <div class="ds-ui-char-header ${hasCurrent ? 'active' : ''}">
                <div class="ds-ui-char-title">
                    <i class="fa-solid fa-folder${hasCurrent ? '-open' : ''}" style="color: ${hasCurrent ? '#00e5ff' : '#888'};"></i>
                    <span>${charName}</span>
                    <span class="ds-ui-badge">${chats.length}</span>
                </div>
                <button class="ds-ui-icon-btn ds-ui-delete-char-btn" data-char="${charName}" title="清除此角色的所有緩存池"><i class="fa-solid fa-trash-can"></i></button>
            </div>
            <div class="ds-ui-char-content" style="display: ${hasCurrent ? 'block' : 'none'};">`;
        
        chats.forEach(c => {
            const isCurrent = c.key === currentChatKey;
            const chatName = c.label.replace('.jsonl', '');
            html += `
                <div class="ds-ui-chat-item ${isCurrent ? 'ds-ui-chat-current' : ''}">
                    <div class="ds-ui-chat-info">
                        <span class="ds-ui-chat-name">${isCurrent ? '<i class="fa-solid fa-location-dot" style="color:#00e5ff; margin-right:6px; text-shadow: 0 0 5px rgba(0,229,255,0.5);"></i>' : '<i class="fa-regular fa-file-lines" style="color:#555; margin-right:6px;"></i>'}${chatName}</span>
                        <span class="ds-ui-chat-nodes">已凍結 ${c.frozenSequence.length} 個節點</span>
                    </div>
                    <button class="ds-ui-icon-btn ds-ui-delete-chat-btn" data-key="${c.key}" title="清除此聊天的緩存池"><i class="fa-solid fa-xmark"></i></button>
                </div>`;
        });
        html += `</div></div>`;
    }
    
    container.html(html);
}

function createToggle(id, title, desc, checked) {
    return `
    <div class="ds-ui-setting-row">
        <div class="ds-ui-setting-text">
            <div class="ds-ui-setting-title">${title}</div>
            <div class="ds-ui-setting-desc">${desc}</div>
        </div>
        <label class="ds-ui-switch">
            <input type="checkbox" id="ds-opt-${id}" ${checked ? 'checked' : ''}>
            <span class="ds-ui-slider"></span>
        </label>
    </div>`;
}

async function setupUI() {
    if (!$('#ds-ui-style').length) {
        $('head').append(`
            <style id="ds-ui-style">
                :root { --ds-cyan: #00e5ff; --ds-cyan-dim: rgba(0, 229, 255, 0.15); --ds-bg: rgba(15, 15, 20, 0.6); --ds-border: rgba(255, 255, 255, 0.08); }
                .ds-ui-panel { background: var(--ds-bg); backdrop-filter: blur(10px); border: 1px solid var(--ds-border); border-radius: 8px; padding: 12px; margin-bottom: 15px; transform: translateZ(0); }
                .ds-ui-header { font-size: 14px; font-weight: bold; color: #e0e0e0; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
                .ds-ui-header i { transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); will-change: transform; }
                .ds-ui-header.collapsed i { transform: rotate(-90deg); }
                .ds-ui-content { overflow: hidden; will-change: height, opacity; transform: translateZ(0); }
                
                .ds-ui-setting-row { display: flex; justify-content: space-between; align-items: center; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 6px; margin-bottom: 8px; border: 1px solid transparent; transition: background-color 0.2s, border-color 0.2s; }
                .ds-ui-setting-row:hover { border-color: var(--ds-cyan-dim); background: rgba(0,0,0,0.4); }
                .ds-ui-setting-text { flex: 1; padding-right: 15px; }
                .ds-ui-setting-title { font-size: 14px; font-weight: bold; color: var(--ds-cyan); margin-bottom: 4px; }
                .ds-ui-setting-desc { font-size: 11px; color: #999; line-height: 1.4; }
                .ds-ui-switch { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; }
                .ds-ui-switch input { opacity: 0; width: 0; height: 0; }
                .ds-ui-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #333; transition: background-color 0.3s; border-radius: 22px; border: 1px solid #555; transform: translateZ(0); }
                .ds-ui-slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 3px; bottom: 3px; background-color: #aaa; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s; border-radius: 50%; will-change: transform; }
                .ds-ui-switch input:checked + .ds-ui-slider { background-color: rgba(0, 229, 255, 0.2); border-color: var(--ds-cyan); }
                .ds-ui-switch input:checked + .ds-ui-slider:before { transform: translate3d(18px, 0, 0); background-color: var(--ds-cyan); box-shadow: 0 0 8px var(--ds-cyan); }

                .ds-ui-char-folder { margin-bottom: 8px; background: rgba(0,0,0,0.3); border-radius: 6px; border: 1px solid var(--ds-border); overflow: hidden; transform: translateZ(0); }
                .ds-ui-char-header { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(255,255,255,0.02); cursor: pointer; transition: background-color 0.2s; }
                .ds-ui-char-header:hover { background: rgba(255,255,255,0.05); }
                .ds-ui-char-header.active { border-bottom: 1px solid var(--ds-border); }
                .ds-ui-char-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: bold; color: #ddd; }
                .ds-ui-badge { background: #333; color: #aaa; font-size: 10px; padding: 2px 6px; border-radius: 10px; }
                .ds-ui-chat-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px 8px 30px; border-bottom: 1px solid rgba(255,255,255,0.02); transition: background-color 0.2s; }
                .ds-ui-chat-item:last-child { border-bottom: none; }
                .ds-ui-chat-item:hover { background: rgba(0, 229, 255, 0.05); }
                .ds-ui-chat-current { background: rgba(0, 229, 255, 0.08); border-left: 3px solid var(--ds-cyan); padding-left: 27px; }
                .ds-ui-chat-info { display: flex; flex-direction: column; gap: 2px; }
                .ds-ui-chat-name { font-size: 12px; color: #ccc; }
                .ds-ui-chat-current .ds-ui-chat-name { color: #fff; font-weight: bold; }
                .ds-ui-chat-nodes { font-size: 10px; color: #777; }
                
                .ds-ui-icon-btn { background: transparent; border: none; color: #777; cursor: pointer; font-size: 13px; padding: 4px 6px; border-radius: 4px; transition: color 0.2s, background-color 0.2s; }
                .ds-ui-icon-btn:hover { color: var(--ds-cyan); background: var(--ds-cyan-dim); }
                .ds-ui-delete-char-btn:hover, .ds-ui-delete-chat-btn:hover { color: #ff4444; background: rgba(255, 68, 68, 0.15); }
                .ds-ui-btn-danger { background: rgba(255, 68, 68, 0.1); color: #ff4444; border: 1px solid rgba(255, 68, 68, 0.3); padding: 4px 10px; border-radius: 4px; font-size: 12px; cursor: pointer; transition: background-color 0.2s, box-shadow 0.2s; }
                .ds-ui-btn-danger:hover { background: rgba(255, 68, 68, 0.2); box-shadow: 0 0 8px rgba(255, 68, 68, 0.4); }
                
                .ds-ui-log-viewer { width: 100%; height: 350px; background: #080808; color: #ccc; font-family: 'Consolas', monospace; font-size: 11px; overflow-y: auto; border-radius: 6px; padding: 10px; border: 1px inset rgba(255,255,255,0.05); transform: translateZ(0); will-change: scroll-position; }
                .ds-ui-log-entry { margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px dashed rgba(255,255,255,0.1); }
                .ds-ui-log-table { width: 100%; border-collapse: collapse; margin-top: 5px; }
                .ds-ui-log-table th { background: #1a1a1a; color: var(--ds-cyan); padding: 6px; text-align: left; border-bottom: 1px solid var(--ds-cyan); position: sticky; top: 0; }
                .ds-ui-log-table td { padding: 6px; border-bottom: 1px solid rgba(255,255,255,0.05); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .ds-ui-log-table tr:hover td { background: rgba(0, 229, 255, 0.05); color: #fff; }
                
                .ds-ui-log-viewer::-webkit-scrollbar, #ds-ui-chat-list-container::-webkit-scrollbar { width: 6px; height: 6px; }
                .ds-ui-log-viewer::-webkit-scrollbar-track, #ds-ui-chat-list-container::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
                .ds-ui-log-viewer::-webkit-scrollbar-thumb, #ds-ui-chat-list-container::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
                .ds-ui-log-viewer::-webkit-scrollbar-thumb:hover, #ds-ui-chat-list-container::-webkit-scrollbar-thumb:hover { background: var(--ds-cyan); }
            </style>
        `);
    }

    const html = `
    <div class="inline-drawer" id="ds-v36-opt-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b><i class="fa-solid fa-shield-halved" style="color:#00e5ff; margin-right:5px;"></i> DeepSeek V4 Pro 絕對防禦矩陣</b>
            <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="padding:15px 10px; background: #0d0d11;">
            
            <div class="ds-ui-panel">
                <div class="ds-ui-header collapsed" onclick="$(this).toggleClass('collapsed').next().slideToggle(200)">
                    <i class="fa-solid fa-chevron-down"></i> ⚙️ 核心防禦設定
                </div>
                <div class="ds-ui-content" style="display: none; padding-top: 10px;">
                    ${createToggle('enabled', '🛡️ 啟用絕對不可變序列 (總開關)', '嚴格遵守「只追加不移位」的絕對規則，鎖定所有提示詞位置，實現接近 100% 的緩存命中率。關閉後將恢復 ST 原生發送邏輯。', Settings.enabled)}
                    ${createToggle('instantNotify', '🔔 啟用量子糾纏即時提醒', '全自動感知用戶修改或刪除歷史訊息，並即時彈窗提醒該操作對緩存命中率的影響，幫助您理解緩存斷裂點。', Settings.instantNotify)}
                    
                    <div class="ds-ui-setting-row" style="margin-top: 10px;">
                        <div class="ds-ui-setting-text">
                            <div class="ds-ui-setting-title">📝 日誌輸出等級</div>
                            <div class="ds-ui-setting-desc">決定下方日誌面板記錄的詳細程度。建議日常使用設為「標準摘要」。</div>
                        </div>
                        <select id="ds-opt-logLevel" class="text_pole" style="width: 140px; padding: 4px; background: #111; color: #00e5ff; border: 1px solid #333; border-radius: 4px;">
                            <option value="0" ${Settings.logLevel===0?'selected':''}>0: 關閉</option>
                            <option value="1" ${Settings.logLevel===1?'selected':''}>1: 基礎警告</option>
                            <option value="2" ${Settings.logLevel===2?'selected':''}>2: 標準摘要</option>
                            <option value="3" ${Settings.logLevel===3?'selected':''}>3: 全景表格</option>
                            <option value="4" ${Settings.logLevel===4?'selected':''}>4: 極限除錯</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="ds-ui-panel">
                <div class="ds-ui-header collapsed" onclick="$(this).toggleClass('collapsed').next().slideToggle(200)">
                    <i class="fa-solid fa-chevron-down"></i> 📂 存檔與緩存管理
                </div>
                <div class="ds-ui-content" style="display: none; padding-top: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <span style="font-size: 11px; color: #888;">管理各個角色與聊天的獨立緩存池</span>
                        <button id="ds-cache-factory-reset" class="ds-ui-btn-danger"><i class="fa-solid fa-skull"></i> 摧毀所有存檔</button>
                    </div>
                    <div id="ds-ui-chat-list-container" style="max-height: 280px; overflow-y: auto; padding-right: 4px; transform: translateZ(0);"></div>
                </div>
            </div>
            
            <div class="ds-ui-panel" style="margin-bottom: 0;">
                <div class="ds-ui-header collapsed" onclick="$(this).toggleClass('collapsed').next().slideToggle(200)">
                    <i class="fa-solid fa-chevron-down"></i> 📝 深度日誌系統
                </div>
                <div class="ds-ui-content" style="display: none; padding-top: 10px;">
                    <div style="display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 8px;">
                        <button id="ds-log-copy" class="ds-ui-icon-btn" title="複製日誌"><i class="fa-solid fa-copy"></i> 複製</button>
                        <button id="ds-log-export" class="ds-ui-icon-btn" title="導出 .md"><i class="fa-solid fa-download"></i> 導出</button>
                        <button id="ds-log-clear" class="ds-ui-icon-btn" title="清空日誌"><i class="fa-solid fa-trash"></i> 清空</button>
                    </div>
                    <div id="ds-cache-log-viewer" class="ds-ui-log-viewer"></div>
                </div>
            </div>

        </div>
    </div>`;
    
    $('#extensions_settings').append(html);
    Logger._uiViewer = document.getElementById('ds-cache-log-viewer');

    $('#ds-opt-enabled').on('change', function() { Settings.enabled = $(this).is(':checked'); safeSave(); });
    $('#ds-opt-instantNotify').on('change', function() { Settings.instantNotify = $(this).is(':checked'); safeSave(); });
    $('#ds-opt-logLevel').on('change', function () { Settings.logLevel = parseInt($(this).val()); safeSave(); });
    
    $('#ds-cache-factory-reset').on('click', () => { 
        if (confirm("⚠️ 終極警告：\n這將徹底摧毀所有角色卡、所有存檔的 DeepSeek 快取連續性！\n(不會刪除聊天記錄，但下次對話將全部重新計算 Token)\n\n確定要執行核彈級清除嗎？")) { 
            Settings.chats = {}; safeSave(); renderChatsUI(); 
            if (typeof toastr !== 'undefined') toastr.success("已摧毀所有緩存存檔", "DeepSeek Cache");
        } 
    });

    $('#ds-log-copy').on('click', Logger.copy);
    $('#ds-log-export').on('click', Logger.export);
    $('#ds-log-clear').on('click', Logger.clear);
    
    const $chatContainer = $('#ds-ui-chat-list-container');
    
    $chatContainer.on('click', '.ds-ui-char-title', function() {
        const content = $(this).parent().next('.ds-ui-char-content');
        const icon = $(this).find('i.fa-solid');
        content.slideToggle(200);
        if (icon.hasClass('fa-folder')) {
            icon.removeClass('fa-folder').addClass('fa-folder-open');
        } else {
            icon.removeClass('fa-folder-open').addClass('fa-folder');
        }
    });

    $chatContainer.on('click', '.ds-ui-delete-chat-btn', function(e) {
        e.stopPropagation();
        const key = $(this).data('key');
        if (confirm('確定要清除此聊天的凍結池嗎？\n(這不會刪除您的聊天記錄，僅重置 DeepSeek 緩存排序)')) {
            delete Settings.chats[key];
            safeSave(); renderChatsUI();
            if (typeof toastr !== 'undefined') toastr.success("已清除該聊天的凍結池", "DeepSeek Cache");
        }
    });

    $chatContainer.on('click', '.ds-ui-delete-char-btn', function(e) {
        e.stopPropagation();
        const charName = $(this).data('char');
        if (confirm(`確定要清除角色「${charName}」的所有緩存池嗎？\n(這不會刪除任何聊天記錄)`)) {
            Object.keys(Settings.chats).forEach(k => {
                if (Settings.chats[k].character === charName) delete Settings.chats[k];
            });
            safeSave(); renderChatsUI();
            if (typeof toastr !== 'undefined') toastr.success(`已清除 ${charName} 的所有凍結池`, "DeepSeek Cache");
        }
    });

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

        Logger.write('══════ 🛡️ V6.0.0 絕對防禦矩陣 (全景日誌版) 就緒 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件啟動崩潰:', e);
    }
});
