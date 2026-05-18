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
// 🛡️ 核心引擎：全域基元真空吸取 (The Omniscient Vacuum)
// ==========================================
const CoreEngine = {
    macroMap: new Map(), 
    promptIndex: [], 

    normalize: (text) => {
        if (!text) return '';
        // 極限過濾：移除所有空白、換行、Tab 與不可見字元，實現 100% 絕對文本匹配
        return text.replace(/[\s\n\r\t\u200B\u200C\u200D\uFEFF]/g, '').trim();
    },

    // 🌟 全知吸塵器 2.0：涵蓋所有 World Book 及高精度提示詞預載
    buildIndex: () => {
        CoreEngine.promptIndex = [];
        let seenNorms = new Set();

        const addToIndex = (norm, cat, source, creator, type) => {
            // 放寬字元限制至 2 以支援極短的人設詞（例如: "綠帽奴" 歸一化後只有3個字元）
            if (!norm || norm.length < 2 || seenNorms.has(norm)) return;
            seenNorms.add(norm);
            CoreEngine.promptIndex.push({ contentNorm: norm, cat, source, creator, type });
        };

        const context = getContext() || {};
        const activeChar = context.characters?.[context.characterId] || {};
        const S = window.settings || {};

        // 🌟 核心突破 1：硬攔截 ST 隱藏變數 (解決 #28 #55 等被視為無名預設的問題)
        const explicitFields = [
            { val: S.persona_description, cat: '用戶', src: '預設提示詞(當前用戶Persona人設)', maker: 'ST核心/用戶' },
            { val: S.custom_system_prompt || S.system_prompt, cat: '預設', src: '預設提示詞(System主指令)', maker: 'ST核心' },
            { val: S.post_history_instructions || S.post_prompt, cat: '預設', src: '預設提示詞(Post-History追加規則)', maker: 'ST核心' },
            { val: S.pre_history_instructions || S.pre_prompt, cat: '預設', src: '預設提示詞(Pre-History前置指令)', maker: 'ST核心' }
        ];

        if (activeChar) {
            explicitFields.push({ val: activeChar.description, cat: '角色', src: `提示詞(角色設定-${activeChar.name})`, maker: '角色卡' });
            explicitFields.push({ val: activeChar.personality, cat: '角色', src: `提示詞(角色性格-${activeChar.name})`, maker: '角色卡' });
            explicitFields.push({ val: activeChar.scenario, cat: '角色', src: `提示詞(世界場景-${activeChar.name})`, maker: '角色卡' });
            explicitFields.push({ val: activeChar.first_mes, cat: '角色', src: `提示詞(初次對話-${activeChar.name})`, maker: '角色卡' });
        }

        explicitFields.forEach(field => {
            if (typeof field.val === 'string') {
                addToIndex(CoreEngine.normalize(field.val), field.cat, field.src, field.maker, 'DEFAULT');
            }
        });

        // 🌟 核心突破 2：三維定向擷取世界書 Lorebooks
        const extractWorldBookEntries = (bookName, bookObj, creatorStr = '世界書系統') => {
            if (!bookObj || !bookObj.entries) return;
            for (let eKey in bookObj.entries) {
                let entry = bookObj.entries[eKey];
                if (entry && typeof entry.content === 'string') {
                    let entryTitle = entry.comment || entry.name || (Array.isArray(entry.key) ? entry.key.join(', ') : entry.key) || eKey;
                    let norm = CoreEngine.normalize(entry.content);
                    addToIndex(norm, '世界書', `世界書[${bookName}]-條目(${entryTitle})`, creatorStr, 'LOREBOOK');
                }
            }
        };

        // 擷取全局啟用中的 World Info
        if (window.world_info) {
            for (let bKey in window.world_info) {
                let book = window.world_info[bKey];
                if (book && typeof book === 'object' && book.entries) {
                    extractWorldBookEntries(book.name || bKey, book);
                }
            }
        }

        // 擷取角色卡專屬世界書
        if (activeChar?.data?.character_book) {
            extractWorldBookEntries(`專屬世界書(${activeChar.name})`, activeChar.data.character_book, '角色卡(世界書)');
        }

        // 若為群聊，擷取所有參與角色的世界書
        if (context.groupId && Array.isArray(context.chat)) {
            const allChars = window.characters || context.characters || [];
            allChars.forEach(char => {
                if (char?.data?.character_book) {
                    extractWorldBookEntries(`專屬世界書(${char.name})`, char.data.character_book, '群聊角色卡(世界書)');
                }
            });
        }

        // 🌟 退源掃描器（保留用來獲取各類冷門提示詞或新增的外掛擴展模組）
        const deepCrawl = (obj, path, depth, visited, currentMeta = {}) => {
            if (depth > 12 || !obj || typeof obj !== 'object' || visited.has(obj)) return;
            visited.add(obj);

            let newMeta = { ...currentMeta };

            // 即時感知上下級世界書從屬關聯
            if ((obj.name || obj.title) && (obj.entries || obj.character_book || obj.content)) {
                newMeta.bookName = obj.name || obj.title;
            }

            for (let key in obj) {
                try {
                    if (!obj.hasOwnProperty(key)) continue;
                    let val = obj[key];
                    let currentPath = path ? `${path}.${key}` : key;

                    if (typeof val === 'string' && val.trim().length > 2) {
                        let norm = CoreEngine.normalize(val);
                        if (seenNorms.has(norm)) continue;

                        let cat = '預設', creator = 'ST核心', type = 'DEFAULT', sourceName = currentPath;

                        // 判斷遺漏的外掛模組或世界書塊
                        if (key === 'content' && (obj.uid !== undefined || obj.comment !== undefined || obj.key !== undefined || obj.keys !== undefined)) {
                            cat = '世界書'; creator = '世界書擴展'; type = 'LOREBOOK';
                            let entryName = obj.comment || obj.name || obj.uid || "未命名";
                            if (Array.isArray(obj.key) && obj.key.length > 0) entryName = obj.key.join(', ');
                            else if (Array.isArray(obj.keys) && obj.keys.length > 0) entryName = obj.keys.join(', ');

                            sourceName = newMeta.bookName ? `世界書[${newMeta.bookName}]-條目(${entryName})` : `未知分類世界書(${entryName})`;
                        } 
                        else if (currentPath.includes('authors_note')) {
                            cat = '其他插件'; creator = '用戶'; type = 'OTHER_PLUGIN'; sourceName = `作者備註(Author's Note)`;
                        } else if (currentPath.includes('jailbreak')) {
                            sourceName = `越獄指令(Jailbreak)`;
                        } else if (currentPath.includes('post_history')) {
                            sourceName = `後置指令(Post-History)`;
                        } else if (obj.name || obj.identifier) {
                            sourceName = `自定義擴充(${obj.name || obj.identifier})`;
                        } else {
                            let rootPrefix = path.split('.')[0] || '未知';
                            if (!sourceName.includes(rootPrefix) && !sourceName.includes('(')) {
                                sourceName = `${rootPrefix}(${key})`;
                            }
                        }

                        addToIndex(norm, cat, sourceName, creator, type);
                    } 
                    else if (typeof val === 'object' && val !== null && !(val instanceof Element)) {
                        deepCrawl(val, currentPath, depth + 1, visited, newMeta);
                    }
                } catch(e) {}
            }
        };

        const Roots = {
            '核心設定': S,
            '擴展設定': window.extension_settings || {},
            '全域世界書': window.world_info || {},
            '提示詞管理': window.prompt_manager || {},
            '角色卡': activeChar,
            '聊天元數據': context.chatId && window.chats ? window.chats[context.chatId] || {} : {}
        };

        for (let rootName in Roots) {
            deepCrawl(Roots[rootName], rootName, 0, new Set());
        }
    },

    getOverlapRatio: (str1, str2) => {
        if (str1 === str2) return 1;
        if (!str1 || !str2) return 0;
        const getGrams = (str) => {
            let grams = new Set();
            let len = str.length;
            if (len < 3) { grams.add(str); return grams; }
            for (let i = 0; i <= len - 3; i++) grams.add(str.substring(i, i + 3));
            return grams;
        };
        const g1 = getGrams(str1);
        const g2 = getGrams(str2);
        if (g1.size === 0 || g2.size === 0) return 0;
        
        let intersect = 0;
        let smaller = g1.size < g2.size ? g1 : g2;
        let larger = g1.size < g2.size ? g2 : g1;
        for (let g of smaller) { if (larger.has(g)) intersect++; }
        return intersect / smaller.size; 
    },

    // 🌟 升級版量子重疊演算法 (大幅度強化短句容錯與巨集解析)
    findInIndex: (normContent) => {
        if (!normContent || normContent.length < 2) return null;
        
        let bestMatch = null;
        let bestScore = 0;

        for (let i = 0; i < CoreEngine.promptIndex.length; i++) {
            const idxObj = CoreEngine.promptIndex[i];
            const idxContent = idxObj.contentNorm;

            // 1. 100% 精準捕捉 (無痛秒鎖)
            if (idxContent === normContent) return idxObj;

            // 2. ST碎片化/連鎖黏合對抗 (Containment Catching)
            // 當前載入的內容包含庫存母體 (或者反過來被包含)，直接加持權重。有效針對巨型陣列斷點切分
            if (idxContent.length >= 5 && normContent.length >= 5) {
                if (normContent.includes(idxContent) || idxContent.includes(normContent)) {
                    let overlapMin = Math.min(idxContent.length, normContent.length);
                    let ratio = overlapMin / Math.max(idxContent.length, normContent.length);
                    
                    // 防範如短詞眼("我是")等低質文本綁架世界書的亂象，規定最低有效內容包含門檻
                    if (overlapMin >= 10 || ratio >= 0.3) {
                        let score = 2.0 + ratio; // 置頂積分段 (2.0 ~ 3.0) 必定先執行這個判斷結果
                        if (score > bestScore) {
                            bestScore = score;
                            bestMatch = idxObj;
                        }
                        continue;
                    }
                }
            }
            
            // 3. 多重過濾相似感知 (針對巨集導致部分文本變異時介入運算)
            if (idxContent.length > 8 && normContent.length > 8) {
                let overlapRatio = CoreEngine.getOverlapRatio(idxContent, normContent);
                let lenRatio = Math.min(idxContent.length, normContent.length) / Math.max(idxContent.length, normContent.length);
                let score = (overlapRatio * 0.85) + (lenRatio * 0.15);

                if (overlapRatio >= 0.65 && score > bestScore && score >= 0.65 && score < 2.0) { // < 2 避免把強匹配蓋掉
                    bestScore = score;
                    bestMatch = idxObj;
                }
            }
        }
        return bestMatch;
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
                                if (CoreEngine.macroMap.size > 1500) { // 放寬 Mapping Queue 容量
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
        if (msg._isDSPlugin) return { cat: '本插件', source: '本插件修改的提示詞', creator: 'DS Cache', type: 'PLUGIN' };

        if (structuralTag === 'USER_CURRENT') return { cat: '用戶', source: '用戶當前輸入', creator: '用戶', type: 'USER_CURRENT' };
        if (structuralTag === 'PREFILL') return { cat: 'AI', source: '預填充', creator: '大模型', type: 'PREFILL' };
        if (structuralTag === 'AI_LAST_REPLY') return { cat: 'AI', source: 'AI上一次回覆', creator: '大模型', type: 'AI_LAST_REPLY' };
        if (structuralTag === 'USER_HISTORY') return { cat: '用戶', source: '用戶歷史輸入', creator: '用戶', type: 'USER_HISTORY' };
        if (structuralTag === 'AI_HISTORY') return { cat: 'AI', source: 'AI歷史回覆', creator: '大模型', type: 'AI_HISTORY' };

        // 使用更精準巨集 Mapping 結果取代原始內容作為檢索來源
        let normContent = msg._origTemplate ? CoreEngine.macroMap.get(msg._norm) || CoreEngine.normalize(msg._origTemplate) : msg._norm;
        let matchedIndex = CoreEngine.findInIndex(normContent);
        
        if (matchedIndex) {
            if (isDynamic) {
                return { cat: '動態', source: `${matchedIndex.source}(動態變量感知)`, creator: matchedIndex.creator, type: 'DYNAMIC' };
            }
            return { cat: matchedIndex.cat, source: matchedIndex.source, creator: matchedIndex.creator, type: matchedIndex.type };
        }

        if (isDynamic) {
            return { cat: '動態', source: '實時生成態提示詞(變數覆寫)', creator: 'ST模組', type: 'DYNAMIC' };
        }

        let name = msg.name ? msg.name.toLowerCase() : '';
        let contentLower = msg.content ? msg.content.toLowerCase() : '';
        if (name.includes('world info') || name.includes('lorebook') || name.includes('wi-')) {
            const match = msg.name.match(/\((.*?)\)/);
            const entryName = match ? match[1] : msg.name;
            return { cat: '世界書', source: `已覆寫世界書(${entryName})`, creator: '世界書引擎', type: 'LOREBOOK' };
        }
        if (contentLower.startsWith('world info:') || contentLower.startsWith('lorebook:')) {
            return { cat: '世界書', source: '世界書串聯生成端', creator: '世界書引擎', type: 'LOREBOOK' };
        }

        const defaultNames = ['system', 'user', 'assistant', 'character', 'example', 'scenario', 'greeting', 'main', 'nsfw', 'jailbreak', 'description', 'personality', 'post-history', 'pre-history', 'summary', 'summarization', 'authors note', 'author\'s note'];
        if (msg.name && !defaultNames.includes(name)) {
            return { cat: '其他插件', source: `自定義輔助模塊(${msg.name})`, creator: msg.name, type: 'OTHER_PLUGIN' };
        }
        if (name.includes('author') || name.includes('note')) {
            return { cat: '其他插件', source: `插件追加(Author's Note)`, creator: '用戶層', type: 'OTHER_PLUGIN' };
        }
        if (name.includes('vector') || name.includes('smart context') || name.includes('rag') || contentLower.includes('retrieved context')) {
            return { cat: '其他插件', source: `數據庫探針(向量庫/RAG)`, creator: '檢索引擎', type: 'OTHER_PLUGIN' };
        }

        return { cat: '未知節點', source: msg.name ? `遊離提示塊(${msg.name})` : '遊離/串聯提示詞塊(無名或無關)', creator: '底層併發', type: 'DEFAULT' };
    }
};

// ==========================================
// 🌌 絕對防禦矩陣 (The Absolute Engine)
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
                
                let sim = CoreEngine.getOverlapRatio(frozen._norm, incomingPool[j]._norm);
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
            
            for (let j = 0; j < incomingPool.length; j++) {
                if (matchedIncomingIndices.has(j)) continue;
                if (incomingPool[j]._uid === frozen._uid && incomingPool[j]._attr.cat === frozen._attr.cat) {
                    matchResults[i] = j; matchedIncomingIndices.add(j); matchedFrozenIndices.add(i); break;
                }
            }
        }

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
                    frozen._attr.cat = '動態'; frozen._attr.source = '動態提示詞(巨集解封)'; frozen._attr.type = 'DYNAMIC';
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
                    syncMessages.push(`[修改重定向] ${matched._attr.source}`);
                    
                    frozen.content = matched.content; 
                    frozen._norm = matched._norm; 
                    frozen._origTemplate = matched._origTemplate;
                    frozen._uid = matched._uid;
                    frozen._attr = matched._attr;
                    
                    nextFrozen.push(frozen);
                    let funcName = frozen._uid === matched._uid ? '量子糾纏(結構深潛)' : '量子糾纏(語義穿透)';
                    ledger.push({ time: processTime, ref: frozen, origIdx: matched._origIdx, role: roleStr, attr: frozen._attr, gen: '修改', creator: frozen._attr.creator, action: '鏡像同步', func: funcName, status: '已凍結' });
                }
            } else if (frozen._isDynamic) {
                nextFrozen.push(frozen);
                if (firstBreakIndex === -1) currentValidLength += frozen.content.length;
                ledger.push({ time: processTime, ref: frozen, origIdx: '-', role: roleStr, attr: frozen._attr, gen: '動態延存', creator: frozen._attr.creator, action: '保留變數節點', func: '動態幽靈補正', status: '已凍結' });
            } else {
                if (firstBreakIndex === -1) { firstBreakIndex = currentValidLength; breakNodeName = frozen._attr.source; }
                syncMessages.push(`[已銷毀移除] ${frozen._attr.source}`);
                ledger.push({ time: processTime, ref: frozen, origIdx: '-', role: roleStr, attr: frozen._attr, gen: '消失空缺', creator: frozen._attr.creator, action: '主動剔除向上補位', func: '量子退火感知', status: '已刪除' });
            }
        }

        let cacheDrop = 0;
        if (firstBreakIndex !== -1) {
            cacheDrop = ((totalFrozenLen - firstBreakIndex) / totalFrozenLen) * 100;
        }

        if (syncMessages.length > 0 && Settings.instantNotify && typeof toastr !== 'undefined') {
            let dropText = cacheDrop > 0 ? `預測前端快取流失：<b style="color:#ff4444;">${cacheDrop.toFixed(2)}%</b><br><span style="font-size:11px; color:#aaa;">(後續序列必須在服務端重新建立)</span>` : `<span style="color:#00e5ff;">(末端異動無損前綴！快取保護完好)</span>`;
            
            toastr.warning(
                `<b style="font-size:14px;">⚠️ 量子糾纏校正協議介入</b><br><br>
                ${syncMessages.join('<br>')}<br><br>
                <b style="color:#ff4444;">斷層掃描警告：</b><br>
                碎裂端起點：${breakNodeName || '無紀錄端點'}<br>
                ${dropText}`, 
                'DS Cache 絕對防禦矩陣', {timeOut: 10000, escapeHtml: false}
            );
        }

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
            appendToFrozen(newDefault, '啟動加載', '根基預熱凍結', '靜態池構建(Initial)');
            appendToFrozen(newLorebook, '引擎加載', '根基預熱凍結', '靜態池構建(Initial)');
            appendToFrozen(newOther, '插件加載', '根基預熱凍結', '靜態池構建(Initial)');
            appendToFrozen(allDynamic, '態生加載', '根基預熱凍結', '靜態池構建(Initial)');
            appendToFrozen(newHistory, '序列載入', '史序凍結', '時空建構');
            appendToFrozen(aiLastReply, '史末序列', '史序凍結', '時空建構');
            appendToFrozen(currentUser, '觸發序列', '主鎖凍結', '最後屏障');
            appendToFrozen(currentPrefill, '誘答序列', '引導凍結', '末端穿透');
        } else {
            appendToFrozen(newHistory, '進程推送', '尾置追加鎖定', '記憶堆疊擴展(Post)');
            appendToFrozen(aiLastReply, '對答入史', '尾置追加鎖定', '記憶堆疊擴展(Post)');
            appendToFrozen(newDefault, '規則注入', '順延凍結', '動態適應追加');
            appendToFrozen(newLorebook, '概念解封', '順延凍結', '世界書增殖注入');
            appendToFrozen(newOther, '擴展介入', '順延凍結', '模組額外追加');
            appendToFrozen(allDynamic, '動態演算', '彈性封存', '變數量子追加');
            appendToFrozen(currentUser, '實時流進', '最末壓實凍結', '前綴防爆護衛');
            appendToFrozen(currentPrefill, '實時誘導', '最終誘爆鎖死', '穿刺末端建構');
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
            let mdLog = `### 🛡️ 絕對防禦矩陣 V5 處理報告 (全息掃描與量子穿透)\n\n`;
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
            Logger.write(`✅ 快取護城河建立完畢。全效池容量: ${state.frozenSequence.length} 微區節點`, LogLevels.STANDARD);
        }

    } catch (err) {
        console.error('[DS Cache] 高併發引擎死鎖:', err);
        Logger.write(`❌ 量子引擎保護性斷火: ${err.message}`, LogLevels.BASIC);
    }
}

// ==========================================
// 🌟 UI 渲染與設置
// ==========================================
function addMenuEntry() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('ds-cache-reset-menu-item')) return;
    
    const item = document.createElement('div');
    item.id = 'ds-cache-reset-menu-item';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.setAttribute('role', 'listitem');
    item.title = '手動解封當前進程狀態並抹除快取記憶池';
    item.innerHTML = `<div class="fa-fw fa-solid fa-rotate-left extensionsMenuExtensionButton"></div><span>抹除當前 DS 凍結池</span>`;
    
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
        container.append(`<div style="padding: 20px; text-align: center; color: #888; font-size: 13px;">伺服矩陣待機中...無任何接管狀態</div>`);
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
                    <span class="ds-chat-name">${isCurrent ? '<i class="fa-solid fa-location-dot" style="color:#00e5ff; margin-right:4px;"></i>' : ''}全息態: ${chatName}</span>
                    <span class="ds-chat-nodes">${c.frozenSequence.length} 防護節點</span>
                </div>
                <button class="ds-icon-btn ds-delete-chat-btn" data-key="${c.key}" title="手動剝除防護節點並刷新"><i class="fa-solid fa-trash-can"></i></button>
            </div>`;
        });
        html += `</div>`;
    }
    
    container.append(html);

    $('.ds-delete-chat-btn').on('click', function() {
        const key = $(this).data('key');
        if (confirm('是否剝除該狀態的所有排列記憶節點？\n(提示詞將重新以ST格式組合)')) {
            delete Settings.chats[key];
            safeSave();
            renderChatsUI();
            if (typeof toastr !== 'undefined') toastr.success("防護記憶已從核心抹除");
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
    <div class="inline-drawer" id="ds-v5-opt-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>DeepSeek V4 Pro 絕對防禦引擎 (V5 空間穿透版)</b>
            <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="padding:15px 10px;">
            
            <div style="margin-bottom: 15px;">
                ${createToggle('enabled', '🛡️ 快取硬鎖固態防護網', '遵守「只能後插絕不移位」原理，透過解算所有巨集強制封裝緩存結構點以適應V4 Cache Hit！', Settings.enabled)}
                ${createToggle('instantNotify', '🔔 動態坍縮雷達彈窗', '前端感知有用戶改寫導致斷層流失機率變高時實時推送預警至ST！', Settings.instantNotify)}
            </div>

            <div style="margin-bottom: 10px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 6px; display: flex; align-items: center; justify-content: space-between;">
                <span style="font-size: 14px; font-weight: bold; color: #e0e0e0;">📝 觀測面板精密級別</span>
                <select id="ds-opt-logLevel" class="text_pole" style="width: 150px; padding: 4px;">
                    <option value="0" ${Settings.logLevel===0?'selected':''}>0: 全面禁默</option>
                    <option value="1" ${Settings.logLevel===1?'selected':''}>1: 失誤截取</option>
                    <option value="2" ${Settings.logLevel===2?'selected':''}>2: 成就標示</option>
                    <option value="3" ${Settings.logLevel===3?'selected':''}>3: 全息 Markdown 清單</option>
                    <option value="4" ${Settings.logLevel===4?'selected':''}>4: 核心深潛</option>
                </select>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <b style="font-size: 13px; color: #aaa;">📂 全息狀態與記憶池監視列：</b>
                <button id="ds-cache-factory-reset" class="ds-icon-btn" style="color: #ff4444; font-size: 12px;" title="實體熔斷"><i class="fa-solid fa-triangle-exclamation"></i> 矩陣重啟(核平)</button>
            </div>
            <div id="ds-chat-list-container" style="max-height: 250px; overflow-y: auto; margin-bottom: 15px; padding-right: 5px;"></div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                <b style="font-size: 13px; color: #aaa;">📝 觀測成果(MD格式支持提取)：</b>
                <div>
                    <button id="ds-log-copy" class="ds-icon-btn" title="提取複製"><i class="fa-solid fa-copy"></i></button>
                    <button id="ds-log-export" class="ds-icon-btn" title="打包文件"><i class="fa-solid fa-download"></i></button>
                    <button id="ds-log-clear" class="ds-icon-btn" title="清場"><i class="fa-solid fa-trash"></i></button>
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
        if (confirm("🚨核爆警告🚨這將讓現有建立起的所有排序化成灰燼並全毀！您確定嗎？")) { 
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

        Logger.write('══════ 🛡️ V5.0.0 量子穿透穩定版 就緒 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 模組開局引線脫落:', e);
    }
});
