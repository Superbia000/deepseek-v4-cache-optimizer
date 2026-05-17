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

    if (!extension_settings.ds_cache_v30_absolute) {
        extension_settings.ds_cache_v30_absolute = defaultSettings;
    }
    Settings = Object.assign({}, defaultSettings, extension_settings.ds_cache_v30_absolute);
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
    macroCache: new Set(), // 儲存由宏生成的最終純文字
    chatHistoryCache: new Map(), // 儲存真實聊天紀錄

    normalize: (text) => {
        if (!text) return '';
        return text.replace(/[\s\n\r\t]/g, '').replace(/\\n/g, '').trim();
    },

    // 🌟 攔截 ST 的宏編譯器，作為動態特徵的輔助判斷
    patchSTEngine: () => {
        try {
            const hook = (origFunc) => {
                return function(...args) {
                    const orig = args[0];
                    const res = origFunc.apply(this, args);
                    if (typeof orig === 'string' && typeof res === 'string' && orig !== res) {
                        if (orig.includes('{{') && orig.includes('}}')) {
                            CoreEngine.macroCache.add(CoreEngine.normalize(res));
                            if (CoreEngine.macroCache.size > 500) {
                                CoreEngine.macroCache.delete(CoreEngine.macroCache.keys().next().value);
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

    updateChatHistory: () => {
        CoreEngine.chatHistoryCache.clear();
        const context = getContext();
        if (context && context.chat && Array.isArray(context.chat)) {
            context.chat.forEach((msg) => {
                if (msg.mes) {
                    CoreEngine.chatHistoryCache.set(CoreEngine.normalize(msg.mes), msg);
                }
            });
        }
    },

    getRealLastUserMessage: () => {
        const context = getContext();
        if (!context || !context.chat || !Array.isArray(context.chat)) return null;
        for (let i = context.chat.length - 1; i >= 0; i--) {
            if (context.chat[i].is_user && context.chat[i].mes) return context.chat[i];
        }
        return null;
    },

    classify: (msg, index, userCurrentIdx, isDynamic) => {
        if (msg._isDSPlugin) return { cat: '本插件', source: '本插件修改的提示詞', creator: 'DS Cache', type: 'PLUGIN' };

        if (index === userCurrentIdx && msg.role === 'user') {
            return { cat: '用戶', source: '用戶當前輸入', creator: '用戶', type: 'USER_CURRENT' };
        }
        if (userCurrentIdx !== -1 && index > userCurrentIdx && msg.role === 'assistant') {
            return { cat: 'AI', source: '預填充', creator: '大模型', type: 'PREFILL' };
        }

        if (isDynamic) {
            return { cat: '動態', source: '動態提示詞', creator: 'ST核心/插件', type: 'DYNAMIC' };
        }

        let isRealChat = false;
        let isUserHistory = false;
        let normContent = CoreEngine.normalize(msg.content);
        for (let [shadowNorm, rc] of CoreEngine.chatHistoryCache.entries()) {
            if (shadowNorm.length > 5) {
                if (normContent.includes(shadowNorm) || shadowNorm.includes(normContent)) {
                    isRealChat = true; isUserHistory = rc.is_user; break;
                }
            } else if (normContent === shadowNorm) {
                isRealChat = true; isUserHistory = rc.is_user; break;
            }
        }
        if (isRealChat) {
            if (isUserHistory) return { cat: '用戶', source: '用戶歷史輸入', creator: '用戶', type: 'USER_HISTORY' };
            return { cat: 'AI', source: 'AI歷史回覆', creator: '大模型', type: 'AI_HISTORY' };
        }

        let name = msg.name ? msg.name.toLowerCase() : '';
        let contentLower = msg.content ? msg.content.toLowerCase() : '';
        if (name.includes('world info') || name.includes('lorebook') || name.includes('wi-')) {
            const match = msg.name.match(/\((.*?)\)/);
            const entryName = match ? match[1] : msg.name;
            return { cat: '世界書', source: `世界書提示詞(${entryName})`, creator: '世界書系統', type: 'LOREBOOK' };
        }
        if (contentLower.startsWith('world info:') || contentLower.startsWith('lorebook:')) {
            return { cat: '世界書', source: '世界書提示詞(內容探測)', creator: '世界書系統', type: 'LOREBOOK' };
        }

        const defaultNames = ['system', 'user', 'assistant', 'character', 'example', 'scenario', 'greeting', 'main', 'nsfw', 'jailbreak', 'description', 'personality', 'post-history', 'pre-history', 'summary', 'summarization', 'authors note', 'author\'s note'];
        if (msg.name && !defaultNames.includes(name)) {
            return { cat: '其他插件', source: `其他插件提示詞(${msg.name})`, creator: msg.name, type: 'OTHER_PLUGIN' };
        }
        if (name.includes('author') || name.includes('note')) {
            return { cat: '其他插件', source: `其他插件提示詞(Author's Note)`, creator: '用戶', type: 'OTHER_PLUGIN' };
        }
        if (name.includes('vector') || name.includes('smart context') || name.includes('rag') || contentLower.includes('retrieved context')) {
            return { cat: '其他插件', source: `其他插件提示詞(向量檢索 RAG)`, creator: 'RAG系統', type: 'OTHER_PLUGIN' };
        }

        return { cat: '預設', source: msg.name ? `預設提示詞(${msg.name})` : '預設提示詞(無名)', creator: 'ST核心', type: 'DEFAULT' };
    },

    getSimilarity: (str1, str2) => {
        if (str1 === str2) return 1;
        if (!str1 || !str2) return 0;
        const s1 = str1.length < str2.length ? str1 : str2;
        const s2 = str1.length < str2.length ? str2 : str1;
        let matchCount = 0;
        for (let i = 0; i < s1.length - 1; i++) {
            if (s2.includes(s1.substring(i, i+2))) matchCount++;
        }
        return matchCount / Math.max(1, s1.length - 1);
    }
};

// ==========================================
// 🌌 絕對防禦矩陣 (The Absolute Engine)
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (data.dryRun || !data?.chat?.length) return;

    try {
        CoreEngine.updateChatHistory();
        
        const state = getChatState(getChatKey());
        let incomingStream = data.chat;
        let incomingPool = [];
        let ledger = []; 
        const processTime = Logger.getTime();

        // 🌟 精準定位「真正的用戶當前輸入」索引
        let userCurrentIdx = -1;
        const realLastUserMsg = CoreEngine.getRealLastUserMessage();
        if (realLastUserMsg) {
            const rcNorm = CoreEngine.normalize(realLastUserMsg.mes);
            for (let i = incomingStream.length - 1; i >= 0; i--) {
                if (incomingStream[i].role === 'user') {
                    const msgNorm = CoreEngine.normalize(incomingStream[i].content);
                    if (rcNorm.length > 5 && (msgNorm.includes(rcNorm) || rcNorm.includes(msgNorm))) {
                        userCurrentIdx = i; break;
                    } else if (msgNorm === rcNorm) {
                        userCurrentIdx = i; break;
                    }
                }
            }
        }
        if (userCurrentIdx === -1) {
            for (let i = incomingStream.length - 1; i >= 0; i--) {
                if (incomingStream[i].role === 'user') { userCurrentIdx = i; break; }
            }
        }

        let userCurrentText = userCurrentIdx !== -1 ? incomingStream[userCurrentIdx].content.trim() : "";

        // 🌟 1. 分配絕對穩定的 Track ID
        let nameCounters = {};
        for (let i = 0; i < incomingStream.length; i++) {
            let msg = incomingStream[i];
            let baseName = msg.name ? `name_${msg.name}` : `role_${msg.role}`;
            if (!nameCounters[baseName]) nameCounters[baseName] = 0;
            msg._trackId = `${baseName}_${nameCounters[baseName]++}`;
            msg._norm = CoreEngine.normalize(msg.content);
        }

        // 🌟 2. 跨回合動態變數覺醒判定 (嚴格遵守：有改變才是動態)
        for (let i = 0; i < incomingStream.length; i++) {
            const msg = incomingStream[i];
            let isDynamic = false;
            
            // 判斷是否具備動態特徵 (包含 {{}}、被宏引擎攔截、或包含用戶最新輸入)
            let hasMacro = false;
            if (msg.content.includes('{{') && msg.content.includes('}}')) hasMacro = true;
            if (CoreEngine.macroCache.has(msg._norm)) hasMacro = true;
            if (userCurrentText.length > 3 && i !== userCurrentIdx && msg.content.includes(userCurrentText)) hasMacro = true;

            if (!state.promptTracker[msg._trackId]) {
                // 第一次見到，記錄下來，暫時視為靜態
                state.promptTracker[msg._trackId] = { lastContent: msg._norm, isDynamic: false, hasMacro: hasMacro };
            } else {
                // 更新動態特徵標記
                if (hasMacro) state.promptTracker[msg._trackId].hasMacro = true;

                // 🌟 核心邏輯：如果內容發生了改變，且具備動態特徵，則正式覺醒為動態提示詞！
                if (state.promptTracker[msg._trackId].lastContent !== msg._norm) {
                    if (state.promptTracker[msg._trackId].hasMacro) {
                        state.promptTracker[msg._trackId].isDynamic = true;
                    }
                    state.promptTracker[msg._trackId].lastContent = msg._norm;
                }
                isDynamic = state.promptTracker[msg._trackId].isDynamic;
            }

            msg._isDynamic = isDynamic;
            msg._attr = CoreEngine.classify(msg, i, userCurrentIdx, isDynamic);
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

            if (Settings.logLevel >= LogLevels.DETAILED) {
                let mdLog = `### 🛡️ 絕對防禦矩陣處理報告 (插件已停用)\n\n`;
                mdLog += `| 時間 | 最終排序 | 原始排序 | 角色 | 分類 | 原始來源 | 生成方式 | 創造者 | 處理方式 | 處理功能 | 狀態 | 提示詞內容 |\n`;
                mdLog += `|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
                ledger.forEach(l => {
                    mdLog += `| ${l.time} | ${l.finalIdx} | ${l.origIdx} | ${l.role} | ${l.attr.cat} | ${l.attr.source} | ${l.gen} | ${l.creator} | ${l.action} | ${l.func} | ${l.status} | ${Logger.truncate(l.ref.content)} |\n`;
                });
                Logger.write(mdLog, LogLevels.DETAILED);
            }
            return; 
        }

        let nextFrozen = [];
        let matchedIncomingIndices = new Set();
        let totalFrozenLen = state.frozenSequence.reduce((acc, m) => acc + m.content.length, 0) || 1;
        let cacheDrop = 0;
        let syncMessages = [];

        // 🌟 3. 核心匹配邏輯：完美保留舊動態提示詞 (幽靈協議)
        for (let i = 0; i < state.frozenSequence.length; i++) {
            let frozen = state.frozenSequence[i];
            let bestMatchIdx = -1;
            let bestSim = 0;

            // 同步凍結池中舊提示詞的動態覺醒狀態
            if (frozen._trackId && state.promptTracker[frozen._trackId]?.isDynamic) {
                frozen._isDynamic = true;
                if (frozen._attr.type !== 'DYNAMIC') {
                    frozen._attr.cat = '動態';
                    frozen._attr.source = '動態提示詞(舊版保留)';
                    frozen._attr.type = 'DYNAMIC';
                }
            }

            // 嘗試完美匹配
            for (let j = 0; j < incomingPool.length; j++) {
                if (matchedIncomingIndices.has(j)) continue;
                if (incomingPool[j].role !== frozen.role) continue;
                if (incomingPool[j]._norm === frozen._norm) {
                    bestMatchIdx = j; bestSim = 1; break;
                }
            }

            // 嘗試相似度匹配 (僅限靜態提示詞，動態提示詞不允許相似度匹配，必須觸發幽靈協議)
            if (bestMatchIdx === -1 && !frozen._isDynamic) {
                for (let j = 0; j < incomingPool.length; j++) {
                    if (matchedIncomingIndices.has(j)) continue;
                    if (incomingPool[j].role !== frozen.role) continue;
                    if (incomingPool[j]._isDynamic) continue; 
                    let sim = CoreEngine.getSimilarity(frozen._norm, incomingPool[j]._norm);
                    if (sim > bestSim) { bestSim = sim; bestMatchIdx = j; }
                }
            }

            const roleStr = frozen.role.charAt(0).toUpperCase() + frozen.role.slice(1);

            if (bestSim === 1 && bestMatchIdx !== -1) {
                // 完美匹配：原位凍結
                let matched = incomingPool[bestMatchIdx];
                matchedIncomingIndices.add(bestMatchIdx);
                nextFrozen.push(frozen);
                ledger.push({ time: processTime, ref: frozen, origIdx: matched._origIdx, role: roleStr, attr: frozen._attr, gen: '繼承', creator: frozen._attr.creator, action: '原位凍結', func: '量子糾纏(完美匹配)', status: '已凍結' });
            } else if (frozen._isDynamic) {
                // 🌟 幽靈協議觸發：動態提示詞發生了改變，舊版本完美保留在原地！
                nextFrozen.push(frozen);
                ledger.push({ time: processTime, ref: frozen, origIdx: '-', role: roleStr, attr: frozen._attr, gen: '繼承', creator: frozen._attr.creator, action: '保留舊動態', func: '動態幽靈(舊版保留)', status: '已凍結' });
            } else if (bestSim > 0.6 && bestMatchIdx !== -1) {
                // 用戶手動修改了靜態提示詞：鏡像同步
                let matched = incomingPool[bestMatchIdx];
                matchedIncomingIndices.add(bestMatchIdx);
                let drop = (matched.content.length / totalFrozenLen) * 100;
                cacheDrop += drop;
                syncMessages.push(`[修改] ${matched._attr.source} (-${drop.toFixed(1)}%)`);
                
                frozen.content = matched.content; 
                frozen._norm = matched._norm; 
                frozen._trackId = matched._trackId;
                nextFrozen.push(frozen);
                ledger.push({ time: processTime, ref: frozen, origIdx: matched._origIdx, role: roleStr, attr: frozen._attr, gen: '修改', creator: frozen._attr.creator, action: '鏡像同步', func: '量子糾纏(修改感知)', status: '已凍結' });
            } else {
                // 靜態提示詞被刪除
                let drop = (frozen.content.length / totalFrozenLen) * 100;
                cacheDrop += drop;
                syncMessages.push(`[刪除] ${frozen._attr.source} (-${drop.toFixed(1)}%)`);
                ledger.push({ time: processTime, ref: frozen, origIdx: '-', role: roleStr, attr: frozen._attr, gen: '消失', creator: frozen._attr.creator, action: '向上補位(刪除)', func: '量子糾纏(刪除感知)', status: '已刪除' });
            }
        }

        if (cacheDrop > 0 && Settings.instantNotify && typeof toastr !== 'undefined') {
            toastr.warning(
                `<b style="font-size:14px;">⚠️ 量子糾纏同步觸發</b><br><br>${syncMessages.join('<br>')}<br><br>預估緩存命中率下降: <b style="color:#ff4444;">${cacheDrop.toFixed(2)}%</b>`, 
                'DeepSeek 緩存優化器', {timeOut: 8000, escapeHtml: false}
            );
        }

        // 🌟 4. 處理剩餘的、需要被追加的新提示詞 (包含更新後的新動態提示詞)
        let remainingPool = incomingPool.filter((_, idx) => !matchedIncomingIndices.has(idx));
        let newHistory = [], newDefault = [], newLorebook = [], newOther = [], allDynamic = [], currentUser = [], currentPrefill = [];
        let isChat1 = state.frozenSequence.length === 0;

        remainingPool.forEach(msg => {
            if (msg._attr.type === 'USER_CURRENT') currentUser.push(msg);
            else if (msg._attr.type === 'PREFILL') currentPrefill.push(msg);
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

        // 🌟 完美實現用戶要求的絕對排序邏輯
        if (isChat1) {
            appendToFrozen(newDefault, '新增', '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(newLorebook, '新增', '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(newOther, '新增', '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(allDynamic, '新增', '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(newHistory, '新增', '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(currentUser, '新增', '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(currentPrefill, '新增', '即時凍結', '絕對凍結(對話1)');
        } else {
            // nextFrozen 裡面已經包含了對話1繼承下來的所有內容 (包含舊的動態提示詞幽靈)
            appendToFrozen(newHistory, '新增', '追加凍結', '絕對凍結(對話2+)');
            appendToFrozen(newDefault, '新增', '追加凍結', '絕對凍結(對話2+)');
            appendToFrozen(newLorebook, '新增', '追加凍結', '絕對凍結(對話2+)');
            appendToFrozen(newOther, '新增', '追加凍結', '絕對凍結(對話2+)');
            // 🌟 將更新後的動態提示詞，統一鏡像追加到這裡！
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
    <div class="inline-drawer" id="ds-v30-opt-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>DeepSeek V4 Pro 絕對防禦矩陣 (v30.0 終極完美溯源版)</b>
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

        Logger.write('══════ 🛡️ V30 終極完美溯源版 就緒 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件啟動崩潰:', e);
    }
});
