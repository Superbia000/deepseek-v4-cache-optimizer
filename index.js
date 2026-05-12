import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 狀態與設定 (Settings & State)
// ==========================================
let Settings = {};

function initSettings() {
    const defaultSettings = {
        enabled: true,
        vectorQuarantine: true, prefixAnchor: true, semanticNorm: true, deduplication: true, warpFilter: true,
        entropyShield: true, timeSpacePatch: true, flashback: true, voidBridging: true, amnesia: true, retconMode: true,
        diaryMode: true, floatingAnchor: true, memoryImprint: true, nanoPatching: true, hotReload: true, summarySink: true, chronos: true,
        logLevel: 3, chats: {} 
    };

    if (!extension_settings.ds_cache_v13_ultimate) {
        extension_settings.ds_cache_v13_ultimate = defaultSettings;
    }
    Settings = Object.assign(defaultSettings, extension_settings.ds_cache_v13_ultimate);
    if (!Settings.chats) Settings.chats = {}; 
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
    
    normalize: (text) => Settings.semanticNorm ? text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim() : text.trim(),
    hash: (text) => {
        let hash = 0, str = Logger.normalize(text);
        for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i);
        return hash.toString(16);
    },
    truncate: (text) => {
        if (!text) return '';
        const clean = text.replace(/\n/g, ' ');
        return clean.length > 30 ? clean.substring(0, 30) + '...' : clean;
    },
    getTime: () => {
        const now = new Date();
        return `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
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
        
        let html = newEntry
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
            .replace(/^- (.*)/gm, '<li>$1</li>');
            
        if (html.includes('|')) {
            const lines = html.split('\n');
            let tableHtml = '<div class="ds-log-container"><table class="ds-log-table">';
            let inTable = false;
            let isFirstRow = true;
            for (let line of lines) {
                if (line.trim().startsWith('|')) {
                    if (!inTable) inTable = true;
                    const cells = line.split('|').filter(c => c.trim() !== '');
                    const isSeparator = line.includes('---');
                    if (isSeparator) continue;
                    
                    if (isFirstRow) {
                        tableHtml += '<tr>' + cells.map(c => `<th>${c.trim()}</th>`).join('') + '</tr>';
                        isFirstRow = false;
                    } else {
                        tableHtml += '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>';
                    }
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

    clear: () => {
        rawMarkdownLogs = [];
        if (Logger._uiViewer) Logger._uiViewer.innerHTML = '';
    },

    copy: () => {
        navigator.clipboard.writeText(rawMarkdownLogs.join('\n')).then(() => {
            if (typeof toastr !== 'undefined') toastr.success("日誌已複製到剪貼簿");
        });
    },

    export: () => {
        const blob = new Blob([rawMarkdownLogs.join('\n')], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `DSCache_Log_${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
        a.click();
        URL.revokeObjectURL(url);
    }
};

// ==========================================
// 📂 存檔與角色卡分組系統 (Archive System)
// ==========================================
function getChatKey() {
    const context = getContext();
    let chatId = context.chatId || "default_chat";
    let character = context.name2 || "未分類/群聊";
    if (context.groupId) character = "群聊: " + (context.groupName || context.groupId);
    
    return { key: `chat_${chatId}`, label: `${chatId}`, character: character };
}

function getChatState(chatKeyInfo) {
    if (!Settings.chats[chatKeyInfo.key]) {
        Settings.chats[chatKeyInfo.key] = { label: chatKeyInfo.label, character: chatKeyInfo.character, frozenSequence: [] };
        safeSave();
    } else if (!Settings.chats[chatKeyInfo.key].character) {
        Settings.chats[chatKeyInfo.key].character = chatKeyInfo.character;
        safeSave();
    }
    return Settings.chats[chatKeyInfo.key];
}

function getSimilarity(str1, str2) {
    if (str1 === str2) return 1;
    const s1 = str1.length < str2.length ? str1 : str2;
    const s2 = str1.length < str2.length ? str2 : str1;
    if (s1.length === 0) return 0;
    let matchCount = 0;
    for (let i = 0; i < s1.length - 1; i++) {
        if (s2.includes(s1.substring(i, i+2))) matchCount++;
    }
    return matchCount / (s1.length - 1);
}

// ==========================================
// 🛡️ 核心防禦矩陣判定器 & 來源偵測器
// ==========================================
const Detectors = {
    isZeroEntropy: (text) => text.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').length === 0,
    isEphemeral: (text) => {
        const lower = text.toLowerCase();
        const isRag = ['retrieved context', 'search results', 'vector database', '相关记忆', '检索到的内容'].some(k => lower.includes(k));
        const isSum = ['summary', 'previously on', '前情提要', '总结', '回顾'].some(k => lower.includes(k));
        return (Settings.vectorQuarantine && isRag) || (Settings.summarySink && isSum);
    },
    isChronos: (text) => {
        if (text.length > 150) return false;
        return ['later', 'next day', '第二天', '几个小时后', '一段时间后', 'meanwhile'].some(k => text.toLowerCase().includes(k));
    },
    isDynamicPrompt: (text) => /\{\{.*?\}\}/.test(text) || text.includes('Current Time:') || text.includes('当前时间：'),
    isDefaultPrompt: (msg) => {
        if (!msg.name) return false;
        const n = msg.name.toLowerCase();
        return n.includes('system') || n.includes('main') || n.includes('nsfw') || n.includes('jailbreak') || n.includes('persona') || n.includes('character');
    },
    isLorebook: (msg) => {
        if (!msg.name) return false;
        const n = msg.name.toLowerCase();
        return n.includes('lorebook') || n.includes('world') || n.includes('wi-');
    },
    
    // 🌟 終極精準來源辨識器
    getOriginInfo: (msg, isLastUser, isPrefill) => {
        if (msg.isDSPatch) return { source: '本插件', creator: 'DS Cache', category: 'PATCH' };
        
        if (msg.role === 'user') {
            return isLastUser ? { source: '用戶輸入', creator: '用戶', category: 'USER' } 
                              : { source: '用戶歷史輸入', creator: '用戶', category: 'USER' };
        }
        if (msg.role === 'assistant') {
            return isPrefill ? { source: '預填充', creator: '大模型', category: 'PREFILL' } 
                             : { source: 'AI歷史回覆', creator: '大模型', category: 'AI' };
        }
        
        if (msg.name) {
            const n = msg.name.toLowerCase();
            if (Detectors.isLorebook(msg)) return { source: '世界書', creator: msg.name, category: 'SYS' };
            if (n.includes('author')) return { source: '預設', creator: '用戶(Author Note)', category: 'SYS' };
            if (!Detectors.isDefaultPrompt(msg)) return { source: `其他插件(${msg.name})`, creator: msg.name, category: 'SYS' };
        }
        return { source: '預設', creator: 'ST核心', category: 'SYS' };
    }
};

// ==========================================
// 🌌 核心處理器 (The Absolute Engine)
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (!Settings.enabled || data.dryRun || !data?.chat?.length) return;

    try {
        const state = getChatState(getChatKey());
        const incomingStream = data.chat;
        
        let ledger = [];
        let otherPluginActions = [];

        // --- 階段 1：拆解 ST 傳入的原始陣列 (精準定位) ---
        let lastUserIdx = -1;
        let prefillIdxs = [];
        
        // 預掃描：找出真正的最後一次用戶輸入與預填充
        for (let i = incomingStream.length - 1; i >= 0; i--) {
            if (incomingStream[i].role === 'user' && lastUserIdx === -1) lastUserIdx = i;
            else if (incomingStream[i].role === 'assistant' && lastUserIdx === -1) prefillIdxs.push(i);
        }

        let currentUserMsg = null;
        let prefills = [];
        let incomingPool = [];

        for (let i = incomingStream.length - 1; i >= 0; i--) {
            const msg = incomingStream[i];
            const isLastUser = (i === lastUserIdx);
            const isPrefill = prefillIdxs.includes(i);
            
            const origin = Detectors.getOriginInfo(msg, isLastUser, isPrefill);
            
            if (origin.source.startsWith('其他插件')) {
                otherPluginActions.push(`- 偵測到其他插件 (**${origin.creator}**) 注入了提示詞，長度: ${msg.content.length}`);
            }

            if (isLastUser) {
                currentUserMsg = msg;
                ledger.push({ ref: msg, origIdx: i, ...origin, gen: '新增', action: '置底發送', proto: '-', status: '未凍結' });
            } else if (isPrefill) {
                prefills.unshift(msg);
                ledger.push({ ref: msg, origIdx: i, ...origin, gen: '新增', action: '置底發送', proto: '-', status: '未凍結' });
            } else {
                incomingPool.unshift({
                    ...msg, norm: Logger.normalize(msg.content), hash: Logger.hash(msg.content), originalIndex: i, ...origin
                });
            }
        }

        if (Settings.warpFilter) {
            incomingPool = incomingPool.filter(msg => {
                if (Detectors.isZeroEntropy(msg.norm)) {
                    ledger.push({ ref: msg, origIdx: msg.originalIndex, source: msg.source, creator: msg.creator, category: msg.category, gen: '捨棄', action: '剔除', proto: '協議6', status: '已刪除', content: msg.content });
                    return false;
                }
                return true;
            });
        }

        // --- 階段 3：絕對秩序矩陣 (比對凍結池) ---
        const nextFrozenSequence = [];
        const seenHashes = new Set();
        let missingHistoryCount = 0;
        let patches = [];
        let maxMatchedHistoryIdx = -1;

        const createPatch = (content, proto) => {
            const p = { role: 'system', content, isDSPatch: true };
            patches.push(p);
            ledger.push({ ref: p, origIdx: '-', source: '本插件', creator: 'DS Cache', category: 'PATCH', gen: '補丁', action: '追加凍結', proto: proto, status: '將凍結' });
        };

        for (let i = 0; i < state.frozenSequence.length; i++) {
            const frozenMsg = state.frozenSequence[i];
            nextFrozenSequence.push(frozenMsg); 
            seenHashes.add(frozenMsg.hash);
            
            // 凍結池內的來源還原
            const origin = Detectors.getOriginInfo(frozenMsg, false, false);

            let bestMatchIdx = -1;
            let bestSim = 0;
            for (let j = 0; j < incomingPool.length; j++) {
                if (incomingPool[j].role !== frozenMsg.role) continue;
                const sim = getSimilarity(frozenMsg.norm, incomingPool[j].norm);
                if (sim > bestSim) { bestSim = sim; bestMatchIdx = j; }
            }

            if (bestSim === 1) {
                const matched = incomingPool.splice(bestMatchIdx, 1)[0];
                ledger.push({ ref: frozenMsg, origIdx: matched.originalIndex, ...origin, gen: '繼承', action: '原位凍結', proto: '協議1', status: '已凍結' });
                missingHistoryCount = 0;
                if (frozenMsg.role === 'user' || frozenMsg.role === 'assistant') maxMatchedHistoryIdx = Math.max(maxMatchedHistoryIdx, matched.originalIndex);
            } 
            else if (Settings.entropyShield && bestSim > 0.99) {
                const matched = incomingPool.splice(bestMatchIdx, 1)[0];
                ledger.push({ ref: frozenMsg, origIdx: matched.originalIndex, ...origin, gen: '修改', action: '原位凍結', proto: '協議8', status: '已凍結' });
                createPatch(`[系統微調] 之前的對話已修正微小細節。`, '協議8');
                missingHistoryCount = 0;
                if (frozenMsg.role === 'user' || frozenMsg.role === 'assistant') maxMatchedHistoryIdx = Math.max(maxMatchedHistoryIdx, matched.originalIndex);
            }
            else if (bestSim > 0.85 && frozenMsg.role === 'system') {
                const matched = incomingPool.splice(bestMatchIdx, 1)[0];
                ledger.push({ ref: frozenMsg, origIdx: matched.originalIndex, ...origin, gen: '修改', action: '原位凍結', proto: '協議17/18', status: '已凍結' });
                if (Settings.nanoPatching && matched.norm.length > frozenMsg.norm.length && (matched.norm.length - frozenMsg.norm.length) < 300) {
                    createPatch(`[設定微調補充] 新增細節：${matched.content.substring(0, 150)}...`, '協議17');
                } else if (Settings.hotReload) {
                    createPatch(`[設定熱更新] 最新特徵如下：\n${matched.content}`, '協議18');
                }
                missingHistoryCount = 0;
            }
            else if (Settings.timeSpacePatch && bestSim > 0.5 && frozenMsg.role !== 'system') {
                const matched = incomingPool.splice(bestMatchIdx, 1)[0];
                ledger.push({ ref: frozenMsg, origIdx: matched.originalIndex, ...origin, gen: '修改', action: '原位凍結', proto: '協議9', status: '已凍結' });
                createPatch(`[時空修正] 之前的事件已發生改變，最新情況為：\n${matched.content}`, '協議9');
                missingHistoryCount = 0;
                maxMatchedHistoryIdx = Math.max(maxMatchedHistoryIdx, matched.originalIndex);
            }
            else {
                ledger.push({ ref: frozenMsg, origIdx: '-', ...origin, gen: '消失', action: '強制保留', proto: '協議3/16', status: '已凍結' });
                if (frozenMsg.role !== 'system') {
                    missingHistoryCount++;
                    if (Settings.amnesia && missingHistoryCount > 5) {
                        if (missingHistoryCount === 6) createPatch(`[系統提示] 早期的記憶已歸檔，請根據當前上下文繼續。`, '協議12');
                    } else if (Settings.retconMode && missingHistoryCount <= 3) {
                        createPatch(`[世界意志] 之前的某個事件已被抹除，請當作從未發生過。`, '協議13');
                    } else if (Settings.voidBridging) {
                        createPatch(`[上下文微小跳躍]`, '協議11');
                    }
                }
            }
        }

        // --- 階段 4：精準分類新生代數據 ---
        let newDefaultPrompts = [], newLorebooks = [], newOtherPrompts = [], newHistory = [], dynamicPrompts = [];

        for (const msg of incomingPool) {
            if (Settings.deduplication && seenHashes.has(msg.hash)) {
                ledger.push({ ref: msg, origIdx: msg.originalIndex, source: msg.source, creator: msg.creator, category: msg.category, gen: '重複', action: '抹除', proto: '協議5', status: '已刪除', content: msg.content });
                continue;
            }

            if (msg.role === 'system') {
                if (Detectors.isEphemeral(msg.norm) || (Settings.floatingAnchor && msg.name === "Author's Note")) {
                    dynamicPrompts.push(msg);
                    ledger.push({ ref: msg, origIdx: msg.originalIndex, source: msg.source, creator: msg.creator, category: msg.category, gen: '新增', action: '追加凍結', proto: '協議2/15/19', status: '將凍結' });
                } else if (Settings.diaryMode && Detectors.isDynamicPrompt(msg.content)) {
                    const p = { role: 'system', content: `[狀態更新] ${msg.content}`, isDSPatch: true };
                    dynamicPrompts.push(p);
                    ledger.push({ ref: p, origIdx: msg.originalIndex, source: '本插件', creator: 'DS Cache', category: 'SYS', gen: '轉換', action: '追加凍結', proto: '協議14', status: '將凍結' });
                } else if (Detectors.isLorebook(msg)) {
                    newLorebooks.push(msg);
                    ledger.push({ ref: msg, origIdx: msg.originalIndex, source: msg.source, creator: msg.creator, category: msg.category, gen: '新增', action: '追加凍結', proto: '-', status: '將凍結' });
                } else if (Detectors.isDefaultPrompt(msg)) {
                    newDefaultPrompts.push(msg);
                    ledger.push({ ref: msg, origIdx: msg.originalIndex, source: msg.source, creator: msg.creator, category: msg.category, gen: '新增', action: '追加凍結', proto: '-', status: '將凍結' });
                } else {
                    newOtherPrompts.push(msg);
                    ledger.push({ ref: msg, origIdx: msg.originalIndex, source: msg.source, creator: msg.creator, category: msg.category, gen: '新增', action: '追加凍結', proto: '-', status: '將凍結' });
                }
            } 
            else {
                if (Settings.chronos && Detectors.isChronos(msg.norm)) {
                    createPatch(`[敘事過渡] ${msg.content}`, '協議20');
                }
                else if (Settings.flashback && maxMatchedHistoryIdx !== -1 && msg.originalIndex < maxMatchedHistoryIdx) {
                    createPatch(`[閃回補充] 在之前的事件中，還發生了以下細節：\n${msg.role}: ${msg.content}`, '協議10');
                }
                else {
                    newHistory.push(msg);
                    ledger.push({ ref: msg, origIdx: msg.originalIndex, source: msg.source, creator: msg.creator, category: msg.category, gen: '新增', action: '追加凍結', proto: '-', status: '將凍結' });
                }
            }
        }

        // --- 階段 5：雙軌排序引擎 ---
        let rawNewItems = [];
        if (state.frozenSequence.length === 0) {
            rawNewItems = [...newDefaultPrompts, ...newLorebooks, ...newOtherPrompts, ...newHistory, ...dynamicPrompts, ...patches];
        } else {
            rawNewItems = [...newHistory, ...newDefaultPrompts, ...newLorebooks, ...newOtherPrompts, ...dynamicPrompts, ...patches];
        }

        const newItemsToFreeze = rawNewItems.map(item => ({
            role: item.role, content: item.content, norm: Logger.normalize(item.content), hash: Logger.hash(item.content)
        }));

        state.frozenSequence = [...nextFrozenSequence, ...newItemsToFreeze];
        safeSave();

        const finalStream = [...state.frozenSequence];
        if (currentUserMsg) finalStream.push(currentUserMsg);
        prefills.forEach(p => finalStream.push(p));

        // 寫入最終索引到帳本
        ledger.forEach(entry => {
            if (entry.status === '已刪除' || entry.action === '剔除' || entry.action === '抹除') {
                entry.finalIdx = '-';
            } else {
                let idx = finalStream.indexOf(entry.ref);
                if (idx === -1) idx = finalStream.findIndex(m => m.content === (entry.ref.content || entry.content) && m.role === entry.ref.role);
                entry.finalIdx = idx !== -1 ? idx : '-';
            }
        });

        data.chat.splice(0, data.chat.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
        
        // --- 階段 6：生成 Markdown 日誌 ---
        if (Settings.logLevel >= LogLevels.DETAILED) {
            let mdLog = `### 🛡️ 絕對防禦矩陣處理報告\n\n`;
            if (otherPluginActions.length > 0) {
                mdLog += `**🔌 其他插件動態：**\n${otherPluginActions.join('\n')}\n\n`;
            }
            
            mdLog += `| 最終排序 | 原始排序 | 分類 | 原始來源 | 生成方式 | 創造者 | 處理方式 | 觸發協議 | 狀態 | 提示詞內容摘要 |\n`;
            mdLog += `|---|---|---|---|---|---|---|---|---|---|\n`;
            
            // 嚴格按照最終排序輸出，被刪除的沉底
            ledger.sort((a, b) => {
                if (a.finalIdx === '-' && b.finalIdx === '-') return (a.origIdx === '-' ? 999 : a.origIdx) - (b.origIdx === '-' ? 999 : b.origIdx);
                if (a.finalIdx === '-') return 1;
                if (b.finalIdx === '-') return -1;
                return a.finalIdx - b.finalIdx;
            });

            ledger.forEach(l => {
                mdLog += `| ${l.finalIdx} | ${l.origIdx} | ${l.category} | ${l.source} | ${l.gen} | ${l.creator} | ${l.action} | ${l.proto} | ${l.status} | ${Logger.truncate(l.ref?.content || l.content)} |\n`;
            });

            Logger.write(mdLog, LogLevels.DETAILED);
        } else if (Settings.logLevel >= LogLevels.STANDARD) {
            Logger.write(`✅ 處理完成。凍結池: ${state.frozenSequence.length} | 補丁生成: ${patches.length}`, LogLevels.STANDARD);
        }

    } catch (err) {
        Logger.error('攔截器發生錯誤', err);
    }
}

// ==========================================
// UI 與初始化 (UI & Initialization)
// ==========================================
function renderChatsUI() {
    const container = $('#ds-chat-list-container');
    if (container.length === 0) return;
    container.empty();
    
    const keys = Object.keys(Settings.chats);
    if (keys.length === 0) {
        container.append('<p style="font-size:0.85em; opacity:0.6; padding: 10px;">尚無接管的存檔數據。</p>');
        return;
    }

    const groups = {};
    keys.forEach(key => {
        const chat = Settings.chats[key];
        const charName = chat.character || "未分類存檔";
        if (!groups[charName]) groups[charName] = [];
        groups[charName].push({ key, ...chat });
    });

    for (const [charName, chats] of Object.entries(groups)) {
        const groupHtml = $(`
            <div style="margin-bottom: 6px; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; overflow: hidden;">
                <div class="ds-char-header" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(255,255,255,0.05); cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">
                    <b style="font-size: 13px; color: #00e5ff;">👤 ${charName} <span style="color:#aaa; font-size:11px;">(${chats.length} 個存檔)</span></b>
                    <span class="fa-solid fa-chevron-down" style="font-size: 12px; color: #aaa; transition: transform 0.3s; transform: rotate(-90deg);"></span>
                </div>
                <div class="ds-char-content" style="display: none; padding: 8px; background: rgba(0,0,0,0.2);"></div>
            </div>
        `);

        const contentDiv = groupHtml.find('.ds-char-content');
        chats.forEach(chat => {
            const cleanLabel = chat.label.replace('.jsonl', '');
            const chatHtml = $(`
                <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.3); padding:6px 10px; margin-bottom:4px; border-radius:4px; border: 1px solid rgba(255,255,255,0.02);">
                    <span style="font-size:0.8em; color:#ccc; max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${chat.label}">${cleanLabel} <span style="color:#00e5ff;">(${chat.frozenSequence.length} 節點)</span></span>
                    <button class="menu_button interactable ds-reset-btn" data-key="${chat.key}" style="font-size:0.75em; padding:2px 6px; margin:0;">清空</button>
                </div>
            `);
            contentDiv.append(chatHtml);
        });

        groupHtml.find('.ds-char-header').on('click', function() {
            const $content = $(this).next('.ds-char-content');
            const $icon = $(this).find('.fa-chevron-down');
            $content.slideToggle(200);
            if ($content.is(':visible')) $icon.css('transform', 'rotate(0deg)');
            else $icon.css('transform', 'rotate(-90deg)');
        });

        container.append(groupHtml);
    }

    container.find('.ds-reset-btn').on('click', function(e) {
        e.stopPropagation();
        delete Settings.chats[$(this).data('key')];
        safeSave(); renderChatsUI();
    });
}

function setupMagicWandButton() {
    if ($('#ds_reset_current_chat').length === 0) {
        const btn = $(`<div id="ds_reset_current_chat" class="list-group-item interactable"><span class="fa-solid fa-broom" style="margin-right: 8px; color: #00e5ff;"></span>重置當前 DS 快取</div>`);
        btn.on('click', () => {
            const keyInfo = getChatKey();
            if (Settings.chats[keyInfo.key]) {
                delete Settings.chats[keyInfo.key];
                safeSave();
                renderChatsUI();
                if (typeof toastr !== 'undefined') toastr.success("已清空當前聊天的 DS 快取鏈");
                Logger.write(`🧹 已手動清空當前聊天 (${keyInfo.label}) 的快取鏈`, LogLevels.BASIC);
            } else {
                if (typeof toastr !== 'undefined') toastr.info("當前聊天無 DS 快取數據");
            }
        });
        $('#extension_menu').append(btn);
    }
}

function createToggle(id, title, desc, checked) {
    return `
    <div style="display: flex; align-items: flex-start; margin-bottom: 8px; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; transition: 0.2s;" onmouseover="this.style.background='rgba(0,0,0,0.4)'" onmouseout="this.style.background='rgba(0,0,0,0.2)'">
        <div style="flex-shrink: 0; margin-right: 12px; padding-top: 2px;">
            <input type="checkbox" id="ds-opt-${id}" ${checked ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px;">
        </div>
        <div style="flex-grow: 1;">
            <label for="ds-opt-${id}" style="font-weight: bold; cursor: pointer; display: block; color: #e0e0e0; font-size: 14px; margin-bottom: 4px;">${title}</label>
            <span style="font-size: 12px; color: #888; display: block; line-height: 1.4;">${desc}</span>
        </div>
    </div>`;
}

function createCategory(id, icon, title, contentHtml) {
    return `
    <div style="margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; overflow: hidden;">
        <div class="ds-category-header" data-target="ds-cat-${id}" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background: rgba(255,255,255,0.05); cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">
            <b style="font-size: 14px; color: #fff;">${icon} ${title}</b>
            <span class="fa-solid fa-chevron-down" style="font-size: 12px; color: #aaa; transition: transform 0.3s;"></span>
        </div>
        <div id="ds-cat-${id}" style="display: none; padding: 10px; background: rgba(0,0,0,0.15);">
            ${contentHtml}
        </div>
    </div>`;
}

async function setupUI() {
    // 🌟 注入極致優化的 Markdown 表格與圖示按鈕 CSS
    if (!$('#ds-log-style').length) {
        $('head').append(`
            <style id="ds-log-style">
                .ds-log-container { width: 100%; overflow-x: auto; max-height: 400px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; background: #111; margin-top: 8px; }
                .ds-log-table { width: 100%; border-collapse: collapse; font-size: 12px; color: #ddd; }
                .ds-log-table th, .ds-log-table td { white-space: nowrap; } /* 強制橫向排列不換行 */
                .ds-log-table th { position: sticky; top: 0; background: #222; color: #00e5ff; padding: 8px 10px; border-bottom: 2px solid #00e5ff; z-index: 10; font-weight: bold; text-align: left; }
                .ds-log-table td { border-bottom: 1px solid rgba(255,255,255,0.05); padding: 6px 10px; text-align: left; }
                .ds-log-table tr:nth-child(even) { background: rgba(255,255,255,0.02); }
                .ds-log-table tr:hover { background: rgba(0, 229, 255, 0.15); }
                
                .ds-icon-btn { background: transparent; border: none; color: #aaa; cursor: pointer; font-size: 14px; padding: 4px 8px; transition: 0.2s; border-radius: 4px; }
                .ds-icon-btn:hover { color: #00e5ff; background: rgba(0, 229, 255, 0.1); }
            </style>
        `);
    }

    const html = `
    <div class="inline-drawer" id="ds-v13-opt-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>DeepSeek V4 Pro 絕對防禦矩陣 (v13.0 旗艦版)</b>
            <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="padding:15px 10px;">
            
            <div style="margin-bottom: 15px; padding: 12px; background: rgba(0, 229, 255, 0.1); border: 1px solid rgba(0, 229, 255, 0.3); border-radius: 8px; display: flex; align-items: center;">
                <input type="checkbox" id="ds-opt-enabled" ${Settings.enabled ? 'checked' : ''} style="width: 18px; height: 18px; margin-right: 12px; cursor: pointer;">
                <label for="ds-opt-enabled" style="font-size: 16px; font-weight: bold; color: #00e5ff; cursor: pointer; margin: 0;">🛡️ 啟用絕對不可變序列 (總開關)</label>
            </div>

            ${createCategory('core', '🧱', '核心架構與防禦矩陣', 
                createToggle('vectorQuarantine', '2. 向量隔離區 (Vector Quarantine)', '將 RAG 檢索的隨機記憶轉化為動態提示詞追加於底部並徹底凍結，確保主體快取絕對連續。', Settings.vectorQuarantine) +
                createToggle('prefixAnchor', '3. 絕對前綴錨點 (Absolute Prefix Anchor)', '攔截 ST 的頭部截斷刪除，強制保留最舊的第一句話，完美保住前綴快取。', Settings.prefixAnchor) +
                createToggle('semanticNorm', '4. 語義正規化引擎 (Semantic Normalization)', '在底層統一空格與引號排版，只要語義沒變，系統就會視為相同並繼續使用快取。', Settings.semanticNorm) +
                createToggle('deduplication', '5. 絕對去重協議 (Absolute Deduplication)', '計算提示詞的量子哈希值，遇到完全相同的內容直接在底層抹除，節省 Token。', Settings.deduplication) +
                createToggle('warpFilter', '6. 曲率引擎過濾 (Warp Drive Filter)', '過濾掉 ST 偶爾發送的完全空白或無意義符號的消息，防止切斷快取連續性。', Settings.warpFilter)
            )}

            ${createCategory('history', '🌌', '時空與歷史修正協議', 
                createToggle('entropyShield', '8. 熵減護盾協議 (Entropy Shield)', '攔截錯字等微小修改，保持舊對話不變，並在底部生成隱形補丁修正語義。', Settings.entropyShield) +
                createToggle('timeSpacePatch', '9. 時空補丁 (Time-Space Patch)', '針對較大幅度的歷史修改，凍結舊歷史並在底部遞送時空修正紙條。', Settings.timeSpacePatch) +
                createToggle('flashback', '10. 閃回插入協議 (Flashback Insertion)', '將在舊對話中間強行插入的新對話抽出來移到最底部，並加上閃回前綴。', Settings.flashback) +
                createToggle('voidBridging', '11. 虛空架橋協議 (Void Bridging)', '在刪除 1~5 句話的位置生成極小的隱形補丁，將斷層的兩端重新橋接起來。', Settings.voidBridging) +
                createToggle('amnesia', '12. 失憶症協議 (Amnesia Protocol)', '當大量歷史記錄被截斷時，在底部生成歸檔補丁，引導 AI 接受記憶缺失。', Settings.amnesia) +
                createToggle('retconMode', '13. 吃書協議 (Retcon Protocol)', '刪除關鍵對話時，保留快取並在底部告訴 AI 世界意志發動了記憶抹除。', Settings.retconMode)
            )}

            ${createCategory('dynamic', '📜', '動態提示詞與設定管理', 
                createToggle('diaryMode', '14. 寫日記模式 (Diary Mode)', '將動態變化的時間當作新的日記條目追加在最底部，大模型會感受到時間流逝且快取 100%。', Settings.diaryMode) +
                createToggle('floatingAnchor', '15. 浮動錨點穩定協議 (Floating Anchor)', '剝奪 Author\'s Note 的浮動權，強制將其鎖死在底部並徹底凍結。', Settings.floatingAnchor) +
                createToggle('memoryImprint', '16. 永久記憶烙印 (Memory Imprint)', '無視 ST 移除不再觸發的世界書指令，讓其幽靈永久烙印在凍結序列中。', Settings.memoryImprint) +
                createToggle('nanoPatching', '17. 量子微創手術 (Nano-Patching)', '微調角色卡時，精準提取新增的字做成納米補丁放在底部，不重讀整張卡。', Settings.nanoPatching) +
                createToggle('hotReload', '18. 提示詞熱更新 (Persona Hot-Reload)', '大幅度重寫提示詞時，凍結舊設定並在底部追加熱更新聲明。', Settings.hotReload) +
                createToggle('summarySink', '19. 摘要沉底錨點 (Summary Sink Anchor)', '識別 ST 的自動總結，並強制將其作為動態節點沉入底部凍結。', Settings.summarySink) +
                createToggle('chronos', '20. 克羅諾斯協議 (Chronos Protocol)', '將簡短的時間跳躍旁白轉化為底部的敘事過渡補丁，不打斷歷史快取。', Settings.chronos)
            )}

            ${createCategory('system', '⚙️', '系統與全景日誌管理', `
                <div style="margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 6px;">
                    <span style="font-size: 14px; font-weight: bold; color: #e0e0e0;">日誌輸出等級</span>
                    <select id="ds-opt-logLevel" class="text_pole" style="width: 120px; padding: 4px;">
                        <option value="0" ${Settings.logLevel===0?'selected':''}>0: 關閉</option>
                        <option value="1" ${Settings.logLevel===1?'selected':''}>1: 基礎警告</option>
                        <option value="2" ${Settings.logLevel===2?'selected':''}>2: 標準摘要</option>
                        <option value="3" ${Settings.logLevel===3?'selected':''}>3: 全景 Markdown 表格</option>
                        <option value="4" ${Settings.logLevel===4?'selected':''}>4: 極限除錯</option>
                    </select>
                </div>
                
                <b style="font-size: 13px; color: #aaa; display: block; margin-bottom: 5px;">📂 存檔凍結池管理 (按角色分類)：</b>
                <div id="ds-chat-list-container" style="max-height: 200px; overflow-y: auto; margin-bottom: 10px; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 5px; background: rgba(0,0,0,0.2);"></div>
                <button id="ds-cache-factory-reset" class="menu_button" style="width: 100%; margin-bottom: 15px; background: #8b0000; color: white; border-radius: 6px; padding: 8px;">⚠️ 廠級清空所有凍結池 (還原 ST 默認)</button>
                
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                    <b style="font-size: 13px; color: #aaa;">📝 全景 Markdown 日誌：</b>
                    <div>
                        <button id="ds-log-copy" class="ds-icon-btn" title="複製日誌"><i class="fa-solid fa-copy"></i></button>
                        <button id="ds-log-export" class="ds-icon-btn" title="導出 .md"><i class="fa-solid fa-download"></i></button>
                        <button id="ds-log-clear" class="ds-icon-btn" title="清空日誌"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <div id="ds-cache-log-viewer" style="width: 100%; height: 350px; background: #0d0d0d; color: #e0e0e0; font-family: Consolas, monospace; font-size: 12px; overflow-y: auto; border-radius: 6px; padding: 10px; border: 1px solid rgba(255,255,255,0.1);"></div>
            `)}
        </div>
    </div>`;
    
    $('#extensions_settings').append(html);
    Logger._uiViewer = document.getElementById('ds-cache-log-viewer');

    $('.ds-category-header').on('click', function() {
        const targetId = $(this).data('target');
        const $content = $('#' + targetId);
        const $icon = $(this).find('.fa-chevron-down');
        
        $content.slideToggle(200);
        if ($content.is(':visible')) {
            $icon.css('transform', 'rotate(0deg)');
        } else {
            $icon.css('transform', 'rotate(-90deg)');
        }
    });
    $('.ds-category-header .fa-chevron-down').css('transform', 'rotate(-90deg)');

    const keys = Object.keys(Settings).filter(k => typeof Settings[k] === 'boolean');
    keys.forEach(key => {
        $(`#ds-opt-${key}`).on('change', function() {
            Settings[key] = $(this).is(':checked');
            safeSave();
        });
    });

    $('#ds-opt-logLevel').on('change', function () { Settings.logLevel = parseInt($(this).val()); safeSave(); });
    $('#ds-cache-factory-reset').on('click', () => { if (confirm("這將摧毀所有存檔的快取連續性！確定要清除嗎？")) { Settings.chats = {}; safeSave(); renderChatsUI(); } });
    
    $('#ds-log-copy').on('click', Logger.copy);
    $('#ds-log-export').on('click', Logger.export);
    $('#ds-log-clear').on('click', Logger.clear);
    
    renderChatsUI();
    setupMagicWandButton(); 
}

jQuery(async () => {
    try {
        initSettings(); 
        await setupUI();
        
        if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        }
        if (eventSource && event_types?.CHAT_CHANGED) {
            eventSource.on(event_types.CHAT_CHANGED, renderChatsUI);
        }

        Logger.write('══════ 🛡️ V13 終極全景日誌旗艦版 (UI 視覺與追蹤重構版) 就緒 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件啟動崩潰:', e);
    }
});
