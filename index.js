import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 狀態與設定 (Settings & State)
// ==========================================
let Settings = {};
let RawChatShadow = new Set(); // 影子預讀字典：儲存絕對真實的聊天紀錄

function initSettings() {
    const defaultSettings = {
        enabled: true,
        instantNotify: true,
        logLevel: 3,
        chats: {} 
    };

    if (!extension_settings.ds_cache_v25_absolute) {
        extension_settings.ds_cache_v25_absolute = defaultSettings;
    }
    Settings = Object.assign({}, defaultSettings, extension_settings.ds_cache_v25_absolute);
}

function safeSave() {
    try { if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced(); } 
    catch (e) { console.warn("[DS Cache] 存檔失敗", e); }
}

// ==========================================
// 🌟 影子預讀引擎 (Shadow Pre-Analyzer)
// ==========================================
function updateRawChatShadow() {
    const context = getContext();
    RawChatShadow.clear();
    if (context && context.chat && Array.isArray(context.chat)) {
        context.chat.forEach(msg => {
            if (msg.mes) RawChatShadow.add(CoreEngine.normalize(msg.mes));
        });
    }
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
    if (!chat) { chat = Settings.chats[chatKeyInfo.key] = { frozenSequence: [] }; safeSave(); }
    chat.label = chatKeyInfo.label; chat.character = chatKeyInfo.character;
    return chat;
}

function resetCurrentChatCache() {
    const chatInfo = getChatKey();
    if (Settings.chats[chatInfo.key]) {
        Settings.chats[chatInfo.key].frozenSequence = [];
        safeSave(); renderChatsUI();
        if (typeof toastr !== 'undefined') toastr.success(`已重置當前聊天 (${chatInfo.character}) 的凍結池`);
        Logger.write(`🔄 用戶手動重置了當前聊天 (${chatInfo.character}) 的凍結池`, LogLevels.BASIC);
    }
}

// ==========================================
// 🛡️ 核心引擎：ST底層劫持、歸屬感知、動態探測
// ==========================================
const CoreEngine = {
    macroCache: new Map(), // 儲存 ST 宏編譯的「最終結果 -> 原始藍圖」

    normalize: (text) => {
        if (!text) return '';
        return text.replace(/[\s\n\r\t]/g, '').replace(/\\n/g, '').replace(/[.,\/#!$%\^&\*;{}=\-_`~()""''“”‘’<>\[\]]/g, '').trim();
    },

    // 🌟 終極接管：劫持 ST 的宏編譯引擎 (Monkey Patching)
    patchSTEngine: () => {
        try {
            if (typeof window.substituteParams === 'function' && !window._ds_orig_substituteParams) {
                window._ds_orig_substituteParams = window.substituteParams;
                window.substituteParams = function(...args) {
                    const orig = args[0];
                    const res = window._ds_orig_substituteParams.apply(this, args);
                    if (orig && typeof orig === 'string' && res && typeof res === 'string' && orig !== res) {
                        CoreEngine.macroCache.set(CoreEngine.normalize(res), orig);
                    }
                    return res;
                };
            }
            if (typeof window.substituteParamsExtended === 'function' && !window._ds_orig_substituteParamsExtended) {
                window._ds_orig_substituteParamsExtended = window.substituteParamsExtended;
                window.substituteParamsExtended = function(...args) {
                    const orig = args[0];
                    const res = window._ds_orig_substituteParamsExtended.apply(this, args);
                    if (orig && typeof orig === 'string' && res && typeof res === 'string' && orig !== res) {
                        CoreEngine.macroCache.set(CoreEngine.normalize(res), orig);
                    }
                    return res;
                };
            }
        } catch (e) {
            console.error("[DS Cache] 劫持 ST 宏引擎失敗:", e);
        }
    },

    getBaseAttribution: (msg, normContent) => {
        if (msg._isDSPlugin) return { cat: '本插件', source: '本插件修改的提示詞', creator: 'DS Cache', type: 'PLUGIN' };
        
        // 使用影子字典進行絕對真偽判定
        let isRealChat = RawChatShadow.has(normContent);

        if (!isRealChat) {
            let name = msg.name ? msg.name.toLowerCase() : '';
            let contentLower = msg.content ? msg.content.toLowerCase() : '';

            if (name.includes('world info') || name.includes('lorebook') || name.includes('wi-')) {
                const match = msg.name.match(/\((.*?)\)/);
                return { cat: '世界書', source: `世界書提示詞(${match ? match[1] : msg.name})`, creator: '世界書系統', type: 'LOREBOOK' };
            }
            if (contentLower.startsWith('world info:') || contentLower.startsWith('lorebook:')) {
                return { cat: '世界書', source: '世界書提示詞(內容探測)', creator: '世界書系統', type: 'LOREBOOK' };
            }
            if (name.includes('author') || name.includes('note')) {
                return { cat: '其他插件', source: `其他插件提示詞(Author's Note)`, creator: '用戶', type: 'OTHER_PLUGIN' };
            }
            if (name.includes('vector') || name.includes('smart context') || name.includes('rag') || contentLower.includes('retrieved context')) {
                return { cat: '其他插件', source: `其他插件提示詞(向量檢索 RAG)`, creator: 'RAG系統', type: 'OTHER_PLUGIN' };
            }
            
            const defaultPrompts = ['system', 'main', 'nsfw', 'jailbreak', 'description', 'personality', 'scenario', 'post-history', 'pre-history', 'example', 'greeting', 'summary', 'summarization'];
            if (name && defaultPrompts.some(k => name.includes(k))) {
                return { cat: '預設', source: `預設提示詞(${msg.name})`, creator: 'ST核心', type: 'DEFAULT' };
            }

            if (msg.content && (msg.content.startsWith('Human: 为了避免') || msg.content.includes('[Current Model Mode]') || msg.content.startsWith('你需根据') || msg.content.includes('[Played by Human]'))) {
                return { cat: '預設', source: '預設提示詞(特徵探測)', creator: 'ST核心', type: 'DEFAULT' };
            }

            return { cat: '預設', source: name ? `預設提示詞(${msg.name})` : '預設提示詞(無名)', creator: 'ST核心', type: 'DEFAULT' };
        }

        if (msg.role === 'user') return { cat: '用戶', source: '用戶聊天', creator: '用戶', type: 'USER_CHAT' };
        if (msg.role === 'assistant') return { cat: 'AI', source: 'AI聊天', creator: '大模型', type: 'AI_CHAT' };

        return { cat: '預設', source: '預設提示詞(未知)', creator: 'ST核心', type: 'DEFAULT' };
    },

    isDynamic: (msg, currentUserMsg) => {
        // 真正的聊天紀錄絕對不是動態提示詞
        if (msg._attr && (msg._attr.type === 'USER_CHAT' || msg._attr.type === 'AI_CHAT' || msg._attr.type === 'USER_CURRENT' || msg._attr.type === 'USER_HISTORY' || msg._attr.type === 'AI_HISTORY' || msg._attr.type === 'PREFILL')) {
            return false;
        }

        const normText = msg._norm || CoreEngine.normalize(msg.content);
        
        // 1. 🌟 終極降維打擊：直接查閱 ST 宏引擎的原始藍圖
        // 完全不需要正則猜測，只要原始代碼裡有動態宏，它就絕對是動態的！
        const originalBlueprint = CoreEngine.macroCache.get(normText);
        if (originalBlueprint) {
            if (/\{\{(time|date|weekday|isotime|lastusermessage|lastcharreply|random|pick|roll|getvar|setvar|addvar|incvar|decvar|idle_duration|total_messages|if|var|pipe)(::|:|}|\s)/i.test(originalBlueprint)) {
                return true;
            }
        }

        // 2. 兜底檢測未解析的原始宏 (防禦性)
        const text = msg.content;
        if (!text) return false;
        if (/\{\{(time|date|weekday|lastusermessage|lastcharreply|random|pick|roll|getvar|setvar|addvar|incvar|decvar|idle_duration|total_messages|if|var|pipe)(::|:|}|\s)/i.test(text)) return true;
        
        // 3. 兜底檢測包含當前用戶輸入的動態反射
        if (currentUserMsg && currentUserMsg.content && currentUserMsg.content.trim().length >= 3) {
            if (text.includes(currentUserMsg.content.trim())) return true;
        }
        
        // 4. 兜底檢測 RAG / 總結等動態注入
        const lower = text.toLowerCase();
        if (['retrieved context', 'search results', 'vector database', '相关记忆', '检索到的内容', 'summary', 'previously on', '前情提要', '总结', '回顾'].some(k => lower.includes(k))) return true;
        
        return false;
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
        // 確保影子字典是最新的
        updateRawChatShadow();
        
        const state = getChatState(getChatKey());
        let incomingStream = data.chat;
        let incomingPool = [];
        let chatMessages = [];
        let otherPluginActions = [];
        let ledger = []; 
        const processTime = Logger.getTime();

        for (let i = 0; i < incomingStream.length; i++) {
            const msg = incomingStream[i];
            msg._norm = CoreEngine.normalize(msg.content);
            msg._tempAttr = CoreEngine.getBaseAttribution(msg, msg._norm);
            msg._origIdx = i + 1;
            
            if (msg._tempAttr.type === 'USER_CHAT' || msg._tempAttr.type === 'AI_CHAT') {
                chatMessages.push(msg);
            }
            incomingPool.push(msg);
        }

        let lastUserChatIdx = -1;
        for (let i = chatMessages.length - 1; i >= 0; i--) {
            if (chatMessages[i]._tempAttr.type === 'USER_CHAT') {
                lastUserChatIdx = i; break;
            }
        }

        let currentUserMsg = null;
        chatMessages.forEach((msg, idx) => {
            if (msg._tempAttr.type === 'USER_CHAT') {
                if (idx === lastUserChatIdx) {
                    msg._attr = { cat: '用戶', source: '用戶當前輸入', creator: '用戶', type: 'USER_CURRENT' };
                    currentUserMsg = msg;
                } else {
                    msg._attr = { cat: '用戶', source: '用戶歷史輸入', creator: '用戶', type: 'USER_HISTORY' };
                }
            } else if (msg._tempAttr.type === 'AI_CHAT') {
                if (lastUserChatIdx !== -1 && idx > lastUserChatIdx) {
                    msg._attr = { cat: 'AI', source: '預填充', creator: '大模型', type: 'PREFILL' };
                } else {
                    msg._attr = { cat: 'AI', source: 'AI歷史回覆', creator: '大模型', type: 'AI_HISTORY' };
                }
            }
        });

        incomingPool.forEach(msg => {
            if (!msg._attr) msg._attr = msg._tempAttr;
            msg._isDynamic = CoreEngine.isDynamic(msg, currentUserMsg);
            
            if (msg._attr.type === 'OTHER_PLUGIN') {
                otherPluginActions.push(`- 偵測到其他插件 (**${msg._attr.creator}**) 注入了提示詞，長度: ${msg.content.length}`);
            }
        });

        if (!Settings.enabled) {
            incomingPool.forEach((msg, idx) => {
                ledger.push({
                    time: processTime, ref: msg, origIdx: msg._origIdx, finalIdx: idx + 1,
                    role: msg.role.charAt(0).toUpperCase() + msg.role.slice(1),
                    attr: msg._attr, gen: '原始載入', action: '未處理', func: '插件已停用', status: '未凍結'
                });
            });

            if (Settings.logLevel >= LogLevels.DETAILED) {
                let mdLog = `### 🛡️ 絕對防禦矩陣處理報告 (插件已停用)\n\n`;
                if (otherPluginActions.length > 0) mdLog += `**🔌 其他插件動態：**\n${otherPluginActions.join('\n')}\n\n`;
                mdLog += `| 時間 | 最終排序 | 原始排序 | 角色 | 分類 | 原始來源 | 生成方式 | 創造者 | 處理方式 | 處理功能 | 狀態 | 提示詞內容 |\n`;
                mdLog += `|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
                ledger.forEach(l => {
                    mdLog += `| ${l.time} | ${l.finalIdx} | ${l.origIdx} | ${l.role} | ${l.attr.cat} | ${l.attr.source} | ${l.gen} | ${l.attr.creator} | ${l.action} | ${l.func} | ${l.status} | ${Logger.truncate(l.ref.content)} |\n`;
                });
                Logger.write(mdLog, LogLevels.DETAILED);
            } else if (Settings.logLevel >= LogLevels.STANDARD) {
                Logger.write(`✅ 處理完成 (插件已停用)。共 ${incomingPool.length} 節點`, LogLevels.STANDARD);
            }
            return; 
        }

        let nextFrozen = [];
        let totalFrozenLen = state.frozenSequence.reduce((acc, m) => acc + m.content.length, 0) || 1;
        let cacheDrop = 0;
        let syncMessages = [];

        for (let i = 0; i < state.frozenSequence.length; i++) {
            let frozen = state.frozenSequence[i];
            let bestMatchIdx = -1;
            let bestSim = 0;
            let isMergedPrefill = false;
            let mergedRemainder = null;

            for (let j = 0; j < incomingPool.length; j++) {
                if (incomingPool[j].role !== frozen.role) continue;
                
                if (frozen.role === 'assistant' && incomingPool[j].content.startsWith(frozen.content) && incomingPool[j].content.length > frozen.content.length) {
                    bestSim = 1; bestMatchIdx = j; isMergedPrefill = true;
                    mergedRemainder = incomingPool[j].content.substring(frozen.content.length);
                    break;
                }

                let sim = CoreEngine.getSimilarity(frozen._norm, incomingPool[j]._norm);
                if (sim > bestSim) { bestSim = sim; bestMatchIdx = j; }
            }

            const roleStr = frozen.role.charAt(0).toUpperCase() + frozen.role.slice(1);

            if (bestSim === 1) {
                let matched = incomingPool.splice(bestMatchIdx, 1)[0];
                nextFrozen.push(frozen);
                ledger.push({ time: processTime, ref: frozen, origIdx: matched._origIdx, role: roleStr, attr: frozen._attr, gen: '繼承', action: '原位凍結', func: '量子糾纏(完美匹配)', status: '已凍結' });
                
                if (isMergedPrefill && mergedRemainder.trim().length > 0) {
                    let newAiMsg = {
                        role: 'assistant', content: mergedRemainder, name: matched.name,
                        _attr: { cat: 'AI', source: 'AI歷史回覆', creator: '大模型', type: 'AI_HISTORY' },
                        _norm: CoreEngine.normalize(mergedRemainder), _isDynamic: false, _origIdx: matched._origIdx
                    };
                    incomingPool.push(newAiMsg);
                }
            } else if (bestSim > 0.6) {
                let matched = incomingPool[bestMatchIdx];
                if (frozen._isDynamic || matched._isDynamic) {
                    nextFrozen.push(frozen);
                    ledger.push({ time: processTime, ref: frozen, origIdx: '-', role: roleStr, attr: frozen._attr, gen: '繼承', action: '保留舊動態', func: '動態探測', status: '已凍結' });
                } else {
                    incomingPool.splice(bestMatchIdx, 1);
                    let drop = (matched.content.length / totalFrozenLen) * 100;
                    cacheDrop += drop;
                    syncMessages.push(`[修改] ${matched._attr.source} (-${drop.toFixed(1)}%)`);
                    
                    frozen.content = matched.content; frozen._norm = matched._norm;
                    nextFrozen.push(frozen);
                    ledger.push({ time: processTime, ref: frozen, origIdx: matched._origIdx, role: roleStr, attr: frozen._attr, gen: '修改', action: '鏡像同步', func: '量子糾纏(修改感知)', status: '已凍結' });
                }
            } else {
                if (frozen._isDynamic) {
                    nextFrozen.push(frozen);
                    ledger.push({ time: processTime, ref: frozen, origIdx: '-', role: roleStr, attr: frozen._attr, gen: '繼承', action: '保留舊動態', func: '動態探測', status: '已凍結' });
                } else {
                    let drop = (frozen.content.length / totalFrozenLen) * 100;
                    cacheDrop += drop;
                    syncMessages.push(`[刪除] ${frozen._attr.source} (-${drop.toFixed(1)}%)`);
                    ledger.push({ time: processTime, ref: frozen, origIdx: '-', role: roleStr, attr: frozen._attr, gen: '消失', action: '向上補位(刪除)', func: '量子糾纏(刪除感知)', status: '已刪除' });
                }
            }
        }

        if (cacheDrop > 0 && Settings.instantNotify && typeof toastr !== 'undefined') {
            toastr.warning(
                `<b style="font-size:14px;">⚠️ 量子糾纏同步觸發</b><br><br>${syncMessages.join('<br>')}<br><br>預估緩存命中率下降: <b style="color:#ff4444;">${cacheDrop.toFixed(2)}%</b>`, 
                'DeepSeek 緩存優化器', {timeOut: 8000, escapeHtml: false}
            );
        }

        let newHistory = [], newDefault = [], newLorebook = [], newOther = [], newDynamic = [], newCurrent = [], newPrefill = [];
        let isChat1 = state.frozenSequence.length === 0;

        incomingPool.forEach(msg => {
            if (msg._attr.type === 'USER_CURRENT') newCurrent.push(msg);
            else if (msg._attr.type === 'PREFILL') newPrefill.push(msg);
            else if (!isChat1 && msg._isDynamic) newDynamic.push(msg); 
            else if (msg._attr.type === 'USER_HISTORY' || msg._attr.type === 'AI_HISTORY') newHistory.push(msg);
            else if (msg._attr.type === 'DEFAULT') newDefault.push(msg);
            else if (msg._attr.type === 'LOREBOOK') newLorebook.push(msg);
            else newOther.push(msg);
        });

        const appendToFrozen = (arr, actionName, funcName) => {
            arr.forEach(msg => {
                nextFrozen.push(msg);
                const roleStr = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
                ledger.push({ time: processTime, ref: msg, origIdx: msg._origIdx, role: roleStr, attr: msg._attr, gen: '新增', action: actionName, func: funcName, status: '已凍結' });
            });
        };

        if (isChat1) {
            appendToFrozen(newDefault, '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(newLorebook, '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(newOther, '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(newHistory, '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(newCurrent, '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(newPrefill, '即時凍結', '絕對凍結(對話1)');
        } else {
            appendToFrozen(newHistory, '追加凍結', '絕對凍結(對話2+)');
            appendToFrozen(newDefault, '追加凍結', '絕對凍結(對話2+)');
            appendToFrozen(newLorebook, '追加凍結', '絕對凍結(對話2+)');
            appendToFrozen(newOther, '追加凍結', '絕對凍結(對話2+)');
            appendToFrozen(newDynamic, '鏡像追加', '絕對凍結(對話2+)');
            appendToFrozen(newCurrent, '即時凍結', '絕對凍結(對話2+)');
            appendToFrozen(newPrefill, '即時凍結', '絕對凍結(對話2+)');
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
            if (otherPluginActions.length > 0) mdLog += `**🔌 其他插件動態：**\n${otherPluginActions.join('\n')}\n\n`;
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
                mdLog += `| ${l.time} | ${l.finalIdx} | ${l.origIdx} | ${l.role} | ${l.attr.cat} | ${l.attr.source} | ${l.gen} | ${l.attr.creator} | ${l.action} | ${l.func} | ${l.status} | ${Logger.truncate(l.ref.content)} |\n`;
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
    <div class="inline-drawer" id="ds-v25-opt-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>DeepSeek V4 Pro 絕對防禦矩陣 (v25.0 核心引擎劫持版)</b>
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
        
        // 🌟 啟動時立即劫持 ST 核心宏引擎
        CoreEngine.patchSTEngine();
        
        // 註冊全天候背景監聽事件，實時更新影子字典
        if (eventSource) {
            if (event_types?.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, () => { renderChatsUI(); updateRawChatShadow(); });
            if (event_types?.MESSAGE_RECEIVED) eventSource.on(event_types.MESSAGE_RECEIVED, updateRawChatShadow);
            if (event_types?.MESSAGE_SENT) eventSource.on(event_types.MESSAGE_SENT, updateRawChatShadow);
            if (event_types?.MESSAGE_UPDATED) eventSource.on(event_types.MESSAGE_UPDATED, updateRawChatShadow);
            if (event_types?.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, updateRawChatShadow);
            if (event_types?.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, updateRawChatShadow);
            if (event_types?.USER_MESSAGE_RENDERED) eventSource.on(event_types.USER_MESSAGE_RENDERED, updateRawChatShadow);
            
            if (event_types?.CHAT_COMPLETION_PROMPT_READY) {
                eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
            }
        }

        Logger.write('══════ 🛡️ V25 核心引擎劫持版 就緒 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件啟動崩潰:', e);
    }
});
