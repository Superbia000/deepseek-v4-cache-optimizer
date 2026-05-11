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
const LogLevels = { OFF: 0, ERROR: 1, ACTION: 2, TABLE: 3, DEBUG: 4 };

const Logger = {
    _mdLogs: [], // 儲存原始 Markdown 文本
    
    clear: () => {
        Logger._mdLogs = [];
        if ($('#ds-cache-log-container').length) $('#ds-cache-log-container').empty();
    },
    
    export: () => {
        if (Logger._mdLogs.length === 0) return alert("日誌為空！");
        const blob = new Blob([Logger._mdLogs.join('\n\n')], { type: 'text/markdown;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `DSCache_Log_${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
        link.click();
    },

    copy: () => {
        if (Logger._mdLogs.length === 0) return alert("日誌為空！");
        navigator.clipboard.writeText(Logger._mdLogs.join('\n\n')).then(() => alert("已複製 Markdown 日誌！"));
    },

    logAction: (actionText, level = LogLevels.ACTION) => {
        if (Settings.logLevel < level) return;
        const time = new Date().toLocaleTimeString();
        const mdText = `> **[${time}] ⚡ 動作:** ${actionText}`;
        Logger._mdLogs.push(mdText);
        Logger._renderToUI(mdText);
        console.log(`%c[DS Cache] ⚡ ${actionText}`, 'color: #00e5ff;');
    },

    logError: (errText) => {
        if (Settings.logLevel < LogLevels.ERROR) return;
        const time = new Date().toLocaleTimeString();
        const mdText = `> **[${time}] 🔴 錯誤:** ${errText}`;
        Logger._mdLogs.push(mdText);
        Logger._renderToUI(mdText);
        console.error(`[DS Cache] 🔴 ${errText}`);
    },

    logTable: (trackers, level = LogLevels.TABLE) => {
        if (Settings.logLevel < level) return;
        const time = new Date().toLocaleTimeString();
        let md = `### 🛡️ 處理矩陣報告 (${time})\n\n`;
        md += `| 原序號 | 新序號 | 分類 | 來源 | 處理動作 | 觸發協議 | 狀態 | 內容摘要 |\n`;
        md += `|:---:|:---:|---|---|---|---|:---:|---|\n`;
        
        trackers.forEach(t => {
            const content = t.content.replace(/\n/g, ' ');
            const snippet = content.length > 30 ? content.substring(0, 30) + '...' : content;
            md += `| ${t.oldIdx} | ${t.newIdx} | ${t.category} | ${t.origin} | ${t.action} | ${t.protocol} | ${t.status} | ${snippet} |\n`;
        });

        Logger._mdLogs.push(md);
        Logger._renderToUI(md);
    },

    _renderToUI: (mdText) => {
        const container = $('#ds-cache-log-container');
        if (!container.length) return;
        
        // 簡易 Markdown 轉 HTML 渲染器
        let html = mdText
            .replace(/^### (.*$)/gim, '<h4 style="color:#00e5ff; margin:10px 0 5px 0;">$1</h4>')
            .replace(/^> (.*$)/gim, '<div style="border-left:3px solid #00e5ff; padding-left:8px; margin:4px 0; color:#ccc;">$1</div>')
            .replace(/\*\*(.*?)\*\*/g, '<b style="color:#fff;">$1</b>');

        // 處理表格
        if (html.includes('|---|') || html.includes('|:---:|')) {
            const rows = html.split('\n').filter(r => r.trim().startsWith('|'));
            let tableHtml = '<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; margin:10px 0; font-size:11px; text-align:left;">';
            rows.forEach((row, i) => {
                if (row.includes('|---')) return; // 跳過分隔線
                const cols = row.split('|').filter(c => c !== '').map(c => c.trim());
                tableHtml += '<tr>';
                cols.forEach(col => {
                    if (i === 0) tableHtml += `<th style="background:#222; border:1px solid #444; padding:4px; color:#00e5ff;">${col}</th>`;
                    else tableHtml += `<td style="border:1px solid #444; padding:4px; color:#ddd;">${col}</td>`;
                });
                tableHtml += '</tr>';
            });
            tableHtml += '</table></div>';
            html = html.replace(/\|.*\|\n/g, '').replace(/\|.*\|/g, '') + tableHtml; // 替換原始表格文本
        }

        container.append(`<div style="margin-bottom: 10px;">${html}</div>`);
        container.scrollTop(container[0].scrollHeight);
    },

    normalize: (text) => Settings.semanticNorm ? text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim() : text.trim(),
    hash: (text) => {
        let hash = 0, str = Logger.normalize(text);
        for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i);
        return hash.toString(16);
    }
};

// ==========================================
// 核心工具與判定器
// ==========================================
function getChatKey() {
    const context = getContext();
    let chatId = context.chatId || "default_chat";
    return { key: `chat_${chatId}`, label: `存檔: ${chatId}` };
}

function getChatState(chatKeyInfo) {
    if (!Settings.chats[chatKeyInfo.key]) {
        Settings.chats[chatKeyInfo.key] = { label: chatKeyInfo.label, frozenSequence: [] };
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
    for (let i = 0; i < s1.length - 1; i++) if (s2.includes(s1.substring(i, i+2))) matchCount++;
    return matchCount / (s1.length - 1);
}

const Detectors = {
    isZeroEntropy: (text) => text.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').length === 0,
    isEphemeral: (text) => {
        const lower = text.toLowerCase();
        const isRag = ['retrieved context', 'search results', 'vector database', '相关记忆', '检索到的内容'].some(k => lower.includes(k));
        const isSum = ['summary', 'previously on', '前情提要', '总结', '回顾'].some(k => lower.includes(k));
        return (Settings.vectorQuarantine && isRag) || (Settings.summarySink && isSum);
    },
    isChronos: (text) => text.length <= 150 && ['later', 'next day', '第二天', '几个小时后', '一段时间后', 'meanwhile'].some(k => text.toLowerCase().includes(k)),
    isDynamicPrompt: (text) => /\{\{.*?\}\}/.test(text) || text.includes('Current Time:') || text.includes('当前时间：'),
    isDefaultPrompt: (msg) => msg.name && ['system', 'main', 'nsfw', 'jailbreak', 'persona', 'character'].some(k => msg.name.toLowerCase().includes(k)),
    isLorebook: (msg) => msg.name && ['lorebook', 'world'].some(k => msg.name.toLowerCase().includes(k))
};

// ==========================================
// 🌌 核心處理器 (The Absolute Engine)
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (!Settings.enabled || data.dryRun || !data?.chat?.length) return;

    try {
        const state = getChatState(getChatKey());
        const incomingStream = data.chat;
        
        // 追蹤矩陣初始化
        let trackers = [];
        const createTracker = (msg, oldIdx, origin, category) => {
            const t = { id: Math.random().toString(36).substr(2, 9), msg, oldIdx, newIdx: '-', category, origin, action: '保留', protocol: '-', status: '處理中', content: msg.content };
            trackers.push(t);
            return t;
        };

        Logger.logAction(`開始處理 ST 傳入陣列 (長度: ${incomingStream.length})`);

        // --- 階段 1：拆解 ST 傳入的原始陣列 ---
        let currentUserMsg = null;
        let prefills = [];
        let incomingPool = [];

        for (let i = incomingStream.length - 1; i >= 0; i--) {
            const msg = incomingStream[i];
            const category = msg.name ? `${msg.role}(${msg.name})` : msg.role;
            const tracker = createTracker(msg, i, 'ST傳入', category);

            if (!currentUserMsg && msg.role === 'user') {
                currentUserMsg = { msg, tracker };
            } else if (!currentUserMsg && msg.role === 'assistant') {
                prefills.unshift({ msg, tracker });
            } else {
                incomingPool.unshift({
                    ...msg, norm: Logger.normalize(msg.content), hash: Logger.hash(msg.content), originalIndex: i, tracker
                });
            }
        }

        // 🛡️ 協議6: 曲率引擎過濾
        if (Settings.warpFilter) {
            incomingPool = incomingPool.filter(item => {
                if (Detectors.isZeroEntropy(item.norm)) {
                    item.tracker.action = '捨棄'; item.tracker.protocol = '曲率引擎過濾'; item.tracker.status = '🗑️ 捨棄';
                    Logger.logAction(`過濾零熵節點 (原序號: ${item.originalIndex})`);
                    return false;
                }
                return true;
            });
        }

        // --- 階段 2：提取臨時態 ---
        let ephemeralZone = [];
        incomingPool = incomingPool.filter(item => {
            if (Detectors.isEphemeral(item.norm) || (Settings.floatingAnchor && item.role === 'system' && item.name === "Author's Note")) {
                item.tracker.action = '沉底隔離'; item.tracker.protocol = '向量/浮動隔離區';
                ephemeralZone.push(item);
                return false;
            }
            return true;
        });

        // --- 階段 3：絕對秩序矩陣 (比對凍結池) ---
        const nextFrozenSequence = [];
        const seenHashes = new Set();
        let missingHistoryCount = 0;

        for (let i = 0; i < state.frozenSequence.length; i++) {
            const frozenMsg = state.frozenSequence[i];
            nextFrozenSequence.push(frozenMsg); 
            seenHashes.add(frozenMsg.hash);

            // 凍結池的 Tracker (僅用於日誌顯示)
            createTracker(frozenMsg, '-', '凍結池', frozenMsg.role).status = '❄️ 凍結';

            let bestMatchIdx = -1;
            let bestSim = 0;
            for (let j = 0; j < incomingPool.length; j++) {
                if (incomingPool[j].role !== frozenMsg.role) continue;
                const sim = getSimilarity(frozenMsg.norm, incomingPool[j].norm);
                if (sim > bestSim) { bestSim = sim; bestMatchIdx = j; }
            }

            if (bestSim === 1) {
                const matched = incomingPool.splice(bestMatchIdx, 1)[0];
                matched.tracker.action = '捨棄(已在凍結池)'; matched.tracker.protocol = '絕對秩序矩陣'; matched.tracker.status = '🗑️ 捨棄';
                missingHistoryCount = 0;
            } 
            else if (Settings.entropyShield && bestSim > 0.99) {
                const matched = incomingPool.splice(bestMatchIdx, 1)[0];
                matched.tracker.action = '捨棄(生成補丁)'; matched.tracker.protocol = '熵減護盾'; matched.tracker.status = '🗑️ 捨棄';
                const pMsg = { role: 'system', content: `[系統微調] 之前的對話已修正微小細節。` };
                createTracker(pMsg, '-', '插件生成', 'system').protocol = '熵減護盾';
                patches.push(pMsg);
                Logger.logAction(`觸發熵減護盾 (相似度: ${bestSim.toFixed(3)})`);
                missingHistoryCount = 0;
            }
            else if (bestSim > 0.85 && frozenMsg.role === 'system') {
                const matched = incomingPool.splice(bestMatchIdx, 1)[0];
                matched.tracker.action = '捨棄(生成補丁)'; matched.tracker.status = '🗑️ 捨棄';
                if (Settings.nanoPatching && matched.norm.length > frozenMsg.norm.length && (matched.norm.length - frozenMsg.norm.length) < 300) {
                    matched.tracker.protocol = '量子微創手術';
                    const pMsg = { role: 'system', content: `[設定微調補充] 新增細節：${matched.content.substring(0, 150)}...` };
                    createTracker(pMsg, '-', '插件生成', 'system').protocol = '量子微創手術';
                    patches.push(pMsg);
                    Logger.logAction(`觸發量子微創手術`);
                } else if (Settings.hotReload) {
                    matched.tracker.protocol = '提示詞熱更新';
                    const pMsg = { role: 'system', content: `[設定熱更新] 最新特徵如下：\n${matched.content}` };
                    createTracker(pMsg, '-', '插件生成', 'system').protocol = '提示詞熱更新';
                    patches.push(pMsg);
                    Logger.logAction(`觸發提示詞熱更新`);
                }
                missingHistoryCount = 0;
            }
            else if (Settings.timeSpacePatch && bestSim > 0.5) {
                const matched = incomingPool.splice(bestMatchIdx, 1)[0];
                matched.tracker.action = '捨棄(生成補丁)'; matched.tracker.protocol = '時空補丁'; matched.tracker.status = '🗑️ 捨棄';
                const pMsg = { role: 'system', content: `[時空修正] 之前的事件已發生改變，最新情況為：\n${matched.content}` };
                createTracker(pMsg, '-', '插件生成', 'system').protocol = '時空補丁';
                patches.push(pMsg);
                Logger.logAction(`觸發時空補丁`);
                missingHistoryCount = 0;
            }
            else {
                if (frozenMsg.role === 'system') {
                    if (Settings.memoryImprint) Logger.logAction(`保留已消失的系統提示詞 (永久記憶烙印)`);
                } else {
                    missingHistoryCount++;
                    if (Settings.prefixAnchor && i === 0) {
                        Logger.logAction(`觸發絕對前綴錨點，保留頭部記憶`);
                    } else if (Settings.amnesia && missingHistoryCount > 5) {
                        if (missingHistoryCount === 6) {
                            const pMsg = { role: 'system', content: `[系統提示] 早期的記憶已歸檔，請根據當前上下文繼續。` };
                            createTracker(pMsg, '-', '插件生成', 'system').protocol = '失憶症協議';
                            patches.push(pMsg);
                            Logger.logAction(`觸發失憶症協議`);
                        }
                    } else if (Settings.retconMode && missingHistoryCount <= 3) {
                        const pMsg = { role: 'system', content: `[世界意志] 之前的某個事件已被抹除，請當作從未發生過。` };
                        createTracker(pMsg, '-', '插件生成', 'system').protocol = '吃書協議';
                        patches.push(pMsg);
                        Logger.logAction(`觸發吃書協議`);
                    } else if (Settings.voidBridging) {
                        const pMsg = { role: 'system', content: `[上下文微小跳躍]` };
                        createTracker(pMsg, '-', '插件生成', 'system').protocol = '虛空架橋協議';
                        patches.push(pMsg);
                    }
                }
            }
        }

        // --- 階段 4：精準分類新生代數據 ---
        let newDefaultPrompts = [];
        let newLorebooks = [];
        let newOtherPrompts = [];
        let newHistory = [];
        let dynamicPrompts = [];
        let patches = []; // 這裡的 patches 是上方生成的

        for (const item of incomingPool) {
            if (Settings.deduplication && seenHashes.has(item.hash)) {
                item.tracker.action = '捨棄'; item.tracker.protocol = '絕對去重協議'; item.tracker.status = '🗑️ 捨棄';
                Logger.logAction(`觸發絕對去重協議，捨棄重複節點`);
                continue;
            }

            if (item.role === 'system') {
                if (Settings.diaryMode && Detectors.isDynamicPrompt(item.content)) {
                    item.tracker.action = '轉換為日記'; item.tracker.protocol = '寫日記模式';
                    const pMsg = { role: 'system', content: `[狀態更新] ${item.content}` };
                    const t = createTracker(pMsg, '-', '插件生成', 'system'); t.protocol = '寫日記模式'; t._ref = pMsg;
                    dynamicPrompts.push({ msg: pMsg, tracker: t });
                    Logger.logAction(`觸發寫日記模式`);
                } else if (Detectors.isLorebook(item)) {
                    item.tracker.action = '追加凍結'; newLorebooks.push(item);
                } else if (Detectors.isDefaultPrompt(item)) {
                    item.tracker.action = '追加凍結'; newDefaultPrompts.push(item);
                } else {
                    item.tracker.action = '追加凍結'; newOtherPrompts.push(item);
                }
            } 
            else {
                if (Settings.chronos && Detectors.isChronos(item.norm)) {
                    item.tracker.action = '轉換為過渡'; item.tracker.protocol = '克羅諾斯協議';
                    const pMsg = { role: 'system', content: `[敘事過渡] ${item.content}` };
                    const t = createTracker(pMsg, '-', '插件生成', 'system'); t.protocol = '克羅諾斯協議'; t._ref = pMsg;
                    patches.push({ msg: pMsg, tracker: t });
                    Logger.logAction(`觸發克羅諾斯協議`);
                }
                else if (Settings.flashback && item.originalIndex < incomingStream.length - 3) {
                    item.tracker.action = '抽出閃回'; item.tracker.protocol = '閃回插入協議';
                    const pMsg = { role: 'system', content: `[閃回補充] 在之前的事件中，還發生了以下細節：\n${item.role}: ${item.content}` };
                    const t = createTracker(pMsg, '-', '插件生成', 'system'); t.protocol = '閃回插入協議'; t._ref = pMsg;
                    patches.push({ msg: pMsg, tracker: t });
                    Logger.logAction(`觸發閃回插入協議`);
                }
                else {
                    item.tracker.action = '追加凍結'; newHistory.push(item);
                }
            }
        }

        // --- 階段 5：雙軌排序引擎 ---
        let rawNewItems = [];
        if (state.frozenSequence.length === 0) {
            rawNewItems = [...newDefaultPrompts, ...newLorebooks, ...newOtherPrompts, ...newHistory, ...dynamicPrompts, ...patches];
            Logger.logAction(`執行 對話1 初始排序邏輯`);
        } else {
            rawNewItems = [...newHistory, ...newDefaultPrompts, ...newLorebooks, ...newOtherPrompts, ...dynamicPrompts, ...patches];
            Logger.logAction(`執行 對話2+ 追加排序邏輯 (AI回覆優先凍結)`);
        }

        const newItemsToFreeze = rawNewItems.map(item => {
            const content = item.msg ? item.msg.content : item.content;
            const role = item.msg ? item.msg.role : item.role;
            if (item.tracker) item.tracker.status = '❄️ 凍結';
            return { role, content, norm: Logger.normalize(content), hash: Logger.hash(content), _tracker: item.tracker };
        });

        state.frozenSequence = [...nextFrozenSequence, ...newItemsToFreeze];
        safeSave();

        // 構建最終陣列並賦予新序號
        const finalStream = [];
        let currentIdx = 0;

        state.frozenSequence.forEach(item => {
            finalStream.push({ role: item.role, content: item.content });
            if (item._tracker) item._tracker.newIdx = currentIdx;
            currentIdx++;
        });
        
        ephemeralZone.forEach(item => {
            finalStream.push({ role: item.role, content: item.content });
            if (item.tracker) { item.tracker.newIdx = currentIdx; item.tracker.status = '🔥 臨時'; }
            currentIdx++;
        });
        
        if (currentUserMsg) {
            finalStream.push(currentUserMsg.msg);
            currentUserMsg.tracker.newIdx = currentIdx; currentUserMsg.tracker.status = '🔥 臨時';
            currentIdx++;
        }
        
        prefills.forEach(p => {
            finalStream.push(p.msg);
            p.tracker.newIdx = currentIdx; p.tracker.status = '🔥 臨時';
            currentIdx++;
        });

        data.chat.splice(0, data.chat.length, ...finalStream);
        Logger.logAction(`✅ 絕對時序重構完成。凍結池: ${state.frozenSequence.length} | 臨時區: ${ephemeralZone.length}`);
        
        // 輸出 Markdown 表格
        Logger.logTable(trackers);

    } catch (err) {
        Logger.logError(err.message);
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

    keys.forEach(key => {
        const chat = Settings.chats[key];
        const html = `
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.3); padding:8px 12px; margin-bottom:6px; border-radius:6px; border: 1px solid rgba(255,255,255,0.05);">
                <span style="font-size:0.85em; color:#ddd;">${chat.label} <span style="color:#00e5ff;">(凍結節點: ${chat.frozenSequence.length})</span></span>
                <button class="menu_button interactable ds-reset-btn" data-key="${key}" style="font-size:0.8em; padding:4px 8px; margin:0;">清空快取鏈</button>
            </div>
        `;
        container.append(html);
    });

    container.find('.ds-reset-btn').on('click', function() {
        delete Settings.chats[$(this).data('key')];
        safeSave(); renderChatsUI();
    });
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
                createToggle('vectorQuarantine', '2. 向量隔離區 (Vector Quarantine)', '將 RAG 檢索的隨機記憶關入底部隔離區，不寫入永久凍結序列，保住主體快取。', Settings.vectorQuarantine) +
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
                createToggle('floatingAnchor', '15. 浮動錨點穩定協議 (Floating Anchor)', '剝奪 Author\'s Note 的浮動權，強制將其鎖死在最底部隔離區。', Settings.floatingAnchor) +
                createToggle('memoryImprint', '16. 永久記憶烙印 (Memory Imprint)', '無視 ST 移除不再觸發的世界書指令，讓其幽靈永久烙印在凍結序列中。', Settings.memoryImprint) +
                createToggle('nanoPatching', '17. 量子微創手術 (Nano-Patching)', '微調角色卡時，精準提取新增的字做成納米補丁放在底部，不重讀整張卡。', Settings.nanoPatching) +
                createToggle('hotReload', '18. 提示詞熱更新 (Persona Hot-Reload)', '大幅度重寫提示詞時，凍結舊設定並在底部追加熱更新聲明。', Settings.hotReload) +
                createToggle('summarySink', '19. 摘要沉底錨點 (Summary Sink Anchor)', '識別 ST 的自動總結，並強制將其作為臨時態沉入對話最底部。', Settings.summarySink) +
                createToggle('chronos', '20. 克羅諾斯協議 (Chronos Protocol)', '將簡短的時間跳躍旁白轉化為底部的敘事過渡補丁，不打斷歷史快取。', Settings.chronos)
            )}

            ${createCategory('system', '⚙️', '系統與日誌管理', `
                <b style="font-size: 13px; color: #aaa; display: block; margin-bottom: 5px;">📂 存檔凍結池管理：</b>
                <div id="ds-chat-list-container" style="max-height: 150px; overflow-y: auto; margin-bottom: 10px; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 5px; background: rgba(0,0,0,0.2);"></div>
                <button id="ds-cache-factory-reset" class="menu_button" style="width: 100%; margin-bottom: 15px; background: #8b0000; color: white; border-radius: 6px; padding: 8px;">⚠️ 廠級清空所有凍結池 (還原 ST 默認)</button>
                
                <hr style="border-color: rgba(255,255,255,0.1); margin: 15px 0;">
                
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <b style="font-size: 14px; color: #00e5ff;">📊 Markdown 追蹤矩陣</b>
                    <select id="ds-opt-logLevel" class="text_pole" style="width: 130px; padding: 4px; font-size: 12px;">
                        <option value="0" ${Settings.logLevel===0?'selected':''}>0: 關閉</option>
                        <option value="1" ${Settings.logLevel===1?'selected':''}>1: 致命錯誤</option>
                        <option value="2" ${Settings.logLevel===2?'selected':''}>2: 僅動作文本</option>
                        <option value="3" ${Settings.logLevel===3?'selected':''}>3: 動作+綜合表格</option>
                        <option value="4" ${Settings.logLevel===4?'selected':''}>4: 極限除錯</option>
                    </select>
                </div>
                
                <div style="display: flex; gap: 8px; margin-bottom: 10px;">
                    <button id="ds-log-copy" class="menu_button" style="flex: 1; padding: 6px; font-size: 12px; background: #2a2a2a;">📋 複製</button>
                    <button id="ds-log-export" class="menu_button" style="flex: 1; padding: 6px; font-size: 12px; background: #2a2a2a;">💾 導出</button>
                    <button id="ds-log-clear" class="menu_button" style="flex: 1; padding: 6px; font-size: 12px; background: #4a1a1a;">🗑️ 清空</button>
                </div>
                
                <div id="ds-cache-log-container" style="width: 100%; height: 300px; overflow-y: auto; background: #0d0d0d; color: #ccc; font-family: Consolas, monospace; font-size: 12px; border-radius: 6px; padding: 10px; border: 1px solid rgba(255,255,255,0.1);"></div>
            `)}
        </div>
    </div>`;
    
    $('#extensions_settings').append(html);

    $('.ds-category-header').on('click', function() {
        const targetId = $(this).data('target');
        const $content = $('#' + targetId);
        const $icon = $(this).find('.fa-chevron-down');
        $content.slideToggle(200);
        if ($content.is(':visible')) $icon.css('transform', 'rotate(0deg)');
        else $icon.css('transform', 'rotate(-90deg)');
    });
    $('.ds-category-header .fa-chevron-down').css('transform', 'rotate(-90deg)');

    const keys = Object.keys(Settings).filter(k => typeof Settings[k] === 'boolean');
    keys.forEach(key => {
        $(`#ds-opt-${key}`).on('change', function() { Settings[key] = $(this).is(':checked'); safeSave(); });
    });

    $('#ds-opt-logLevel').on('change', function () { Settings.logLevel = parseInt($(this).val()); safeSave(); });
    
    $('#ds-cache-factory-reset').on('click', () => {
        if (confirm("這將摧毀所有存檔的快取連續性！確定要清除嗎？")) { Settings.chats = {}; safeSave(); renderChatsUI(); }
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
        
        if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        }
        if (eventSource && event_types?.CHAT_CHANGED) {
            eventSource.on(event_types.CHAT_CHANGED, renderChatsUI);
        }

        Logger.logAction('🛡️ V13 終極日誌旗艦版 就緒');
    } catch (e) {
        console.error('[DS Cache] 插件啟動崩潰:', e);
    }
});
