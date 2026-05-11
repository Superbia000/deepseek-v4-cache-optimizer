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
        logLevel: 2, chats: {} 
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
// 📝 終極 Markdown 日誌系統 (5級)
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3, TRACE: 4 };

const Logger = {
    rawHistory: [],
    
    log: (mdText, level = LogLevels.DETAILED) => Logger._addLog(mdText, level, '✅'),
    warn: (mdText, level = LogLevels.BASIC) => Logger._addLog(`**[警告]** ${mdText}`, level, '🌪️'),
    patch: (mdText, level = LogLevels.DEBUG) => Logger._addLog(`**[協議觸發]** ${mdText}`, level, '🩹'),
    error: (mdText, err, level = LogLevels.BASIC) => Logger._addLog(`**[錯誤]** ${mdText} \`${err}\``, level, '🔴'),
    
    _addLog: (mdText, level, icon) => {
        if (Settings.logLevel < level || Settings.logLevel === LogLevels.SILENT) return;
        const time = new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
        const entry = `**[${time}]** ${icon} ${mdText}`;
        Logger.rawHistory.push(entry);
        Logger.render();
    },

    clear: () => { Logger.rawHistory = []; Logger.render(); },
    
    export: () => {
        if (Logger.rawHistory.length === 0) return;
        const text = Logger.rawHistory.join('\n\n---\n\n');
        const blob = new Blob([text], { type: 'text/markdown;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `DS_Cache_Log_${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
        a.click();
        URL.revokeObjectURL(url);
    },

    render: () => {
        const container = $('#ds-cache-log-container');
        if (container.length === 0) return;
        
        let html = Logger.rawHistory.join('\n\n');
        
        // 輕量級 Markdown 轉 HTML 渲染器
        html = html.replace(/\*\*(.*?)\*\*/g, '<b style="color:#fff;">$1</b>'); // 粗體
        html = html.replace(/`(.*?)`/g, '<code style="background:#333;color:#00e5ff;padding:2px 4px;border-radius:3px;font-family:monospace;">$1</code>'); // 代碼
        html = html.replace(/### (.*?)\n/g, '<h4 style="color:#4CAF50;margin:10px 0 5px 0;">$1</h4>'); // 標題
        
        // 表格渲染
        const tableRegex = /((?:\|.*\|\n)+)/g;
        html = html.replace(tableRegex, (match) => {
            let rows = match.trim().split('\n');
            let tableHtml = '<table style="width:100%;border-collapse:collapse;margin:10px 0;font-size:11px;text-align:left;background:rgba(0,0,0,0.3);">';
            rows.forEach((row, i) => {
                if (row.includes('---')) return; 
                let cols = row.split('|').filter(c => c.trim() !== '');
                tableHtml += `<tr style="border-bottom:1px solid rgba(255,255,255,0.1); ${i===0 ? 'background:rgba(255,255,255,0.1);' : ''}">`;
                cols.forEach(col => {
                    let tag = i === 0 ? 'th' : 'td';
                    tableHtml += `<${tag} style="padding:6px 4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:150px;" title="${col.trim().replace(/"/g, '&quot;')}">${col.trim()}</${tag}>`;
                });
                tableHtml += '</tr>';
            });
            tableHtml += '</table>';
            return tableHtml;
        });
        
        html = html.replace(/\n/g, '<br>');
        container.html(html);
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
    for (let i = 0; i < s1.length - 1; i++) {
        if (s2.includes(s1.substring(i, i+2))) matchCount++;
    }
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
        return n.includes('lorebook') || n.includes('world');
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
        
        let currentUserMsg = null;
        let prefills = [];
        let incomingPool = [];

        // 階段 1：拆解並注入初始元數據 (Metadata)
        for (let i = incomingStream.length - 1; i >= 0; i--) {
            const msg = incomingStream[i];
            if (!currentUserMsg && msg.role === 'user') {
                currentUserMsg = msg;
            } else if (!currentUserMsg && msg.role === 'assistant') {
                prefills.unshift(msg);
            } else {
                let category = Detectors.isLorebook(msg) ? '世界書' : (Detectors.isDefaultPrompt(msg) ? '預設提示詞' : (msg.role === 'system' ? '其他提示詞' : '歷史對話'));
                let creator = msg.role === 'user' ? 'User' : (msg.role === 'assistant' ? 'AI' : 'ST');
                
                incomingPool.unshift({
                    ...msg,
                    norm: Logger.normalize(msg.content),
                    hash: Logger.hash(msg.content),
                    originalIndex: i,
                    _meta: { category, origin: 'ST 原始傳入', creator, action: '待處理', protocol: '-', frozen: false }
                });
            }
        }

        if (Settings.warpFilter) {
            incomingPool = incomingPool.filter(msg => {
                if (Detectors.isZeroEntropy(msg.norm)) {
                    Logger.patch(`剔除零熵節點: \`${msg.content.substring(0,10)}\``, LogLevels.TRACE);
                    return false;
                }
                return true;
            });
        }

        // 階段 2：提取臨時態
        let ephemeralZone = [];
        incomingPool = incomingPool.filter(msg => {
            if (Detectors.isEphemeral(msg.norm) || (Settings.floatingAnchor && msg.role === 'system' && msg.name === "Author's Note")) {
                msg._meta.action = '隔離沉底';
                msg._meta.protocol = '隔離區/浮動錨點';
                ephemeralZone.push(msg);
                return false;
            }
            return true;
        });

        // 階段 3：絕對秩序矩陣 (比對凍結池)
        const nextFrozenSequence = [];
        const seenHashes = new Set();
        let missingHistoryCount = 0;
        let patches = [];

        for (let i = 0; i < state.frozenSequence.length; i++) {
            const frozenMsg = state.frozenSequence[i];
            nextFrozenSequence.push(frozenMsg); 
            seenHashes.add(frozenMsg.hash);

            let bestMatchIdx = -1;
            let bestSim = 0;
            for (let j = 0; j < incomingPool.length; j++) {
                if (incomingPool[j].role !== frozenMsg.role) continue;
                const sim = getSimilarity(frozenMsg.norm, incomingPool[j].norm);
                if (sim > bestSim) { bestSim = sim; bestMatchIdx = j; }
            }

            if (bestSim === 1) {
                incomingPool.splice(bestMatchIdx, 1);
                missingHistoryCount = 0;
            } 
            else if (Settings.entropyShield && bestSim > 0.99) {
                incomingPool.splice(bestMatchIdx, 1);
                patches.push({ role: 'system', content: `[系統微調] 之前的對話已修正微小細節。`, _meta: { category: '系統補丁', origin: '插件生成', creator: 'Plugin', action: '底部追加', protocol: '8. 熵減護盾', frozen: true } });
                Logger.patch(`觸發熵減護盾`, LogLevels.DEBUG);
                missingHistoryCount = 0;
            }
            else if (bestSim > 0.85 && frozenMsg.role === 'system') {
                const matched = incomingPool.splice(bestMatchIdx, 1)[0];
                if (Settings.nanoPatching && matched.norm.length > frozenMsg.norm.length && (matched.norm.length - frozenMsg.norm.length) < 300) {
                    patches.push({ role: 'system', content: `[設定微調補充] 新增細節：${matched.content.substring(0, 150)}...`, _meta: { category: '系統補丁', origin: '插件生成', creator: 'Plugin', action: '底部追加', protocol: '17. 量子微創', frozen: true } });
                    Logger.patch(`觸發量子微創手術`, LogLevels.DEBUG);
                } else if (Settings.hotReload) {
                    patches.push({ role: 'system', content: `[設定熱更新] 最新特徵如下：\n${matched.content}`, _meta: { category: '系統補丁', origin: '插件生成', creator: 'Plugin', action: '底部追加', protocol: '18. 熱更新', frozen: true } });
                    Logger.patch(`觸發提示詞熱更新`, LogLevels.DEBUG);
                }
                missingHistoryCount = 0;
            }
            else if (Settings.timeSpacePatch && bestSim > 0.5) {
                const matched = incomingPool.splice(bestMatchIdx, 1)[0];
                patches.push({ role: 'system', content: `[時空修正] 之前的事件已發生改變，最新情況為：\n${matched.content}`, _meta: { category: '系統補丁', origin: '插件生成', creator: 'Plugin', action: '底部追加', protocol: '9. 時空補丁', frozen: true } });
                Logger.patch(`觸發時空補丁`, LogLevels.DEBUG);
                missingHistoryCount = 0;
            }
            else {
                if (frozenMsg.role === 'system') {
                    if (Settings.memoryImprint) Logger.patch(`保留已消失的系統提示詞 (永久記憶烙印)`, LogLevels.TRACE);
                } else {
                    missingHistoryCount++;
                    if (Settings.prefixAnchor && i === 0) {
                        Logger.patch(`觸發絕對前綴錨點，保留頭部記憶`, LogLevels.TRACE);
                    } else if (Settings.amnesia && missingHistoryCount > 5) {
                        if (missingHistoryCount === 6) patches.push({ role: 'system', content: `[系統提示] 早期的記憶已歸檔，請根據當前上下文繼續。`, _meta: { category: '系統補丁', origin: '插件生成', creator: 'Plugin', action: '底部追加', protocol: '12. 失憶症', frozen: true } });
                    } else if (Settings.retconMode && missingHistoryCount <= 3) {
                        patches.push({ role: 'system', content: `[世界意志] 之前的某個事件已被抹除，請當作從未發生過。`, _meta: { category: '系統補丁', origin: '插件生成', creator: 'Plugin', action: '底部追加', protocol: '13. 吃書協議', frozen: true } });
                        Logger.patch(`觸發吃書協議`, LogLevels.DEBUG);
                    } else if (Settings.voidBridging) {
                        patches.push({ role: 'system', content: `[上下文微小跳躍]`, _meta: { category: '系統補丁', origin: '插件生成', creator: 'Plugin', action: '底部追加', protocol: '11. 虛空架橋', frozen: true } });
                    }
                }
            }
        }

        // 階段 4：精準分類新生代數據
        let newDefaultPrompts = [];
        let newLorebooks = [];
        let newOtherPrompts = [];
        let newHistory = [];
        let dynamicPrompts = [];

        for (const msg of incomingPool) {
            if (Settings.deduplication && seenHashes.has(msg.hash)) {
                Logger.patch(`觸發絕對去重協議，捨棄重複節點`, LogLevels.TRACE);
                continue;
            }

            msg._meta.action = '底部追加';
            msg._meta.protocol = '1. 秩序矩陣';

            if (msg.role === 'system') {
                if (Settings.diaryMode && Detectors.isDynamicPrompt(msg.content)) {
                    dynamicPrompts.push({ role: 'system', content: `[狀態更新] ${msg.content}`, _meta: { category: '動態提示詞', origin: 'ST 傳入', creator: 'ST', action: '底部追加', protocol: '14. 寫日記', frozen: true } });
                    Logger.patch(`觸發寫日記模式`, LogLevels.DEBUG);
                } else if (Detectors.isLorebook(msg)) {
                    newLorebooks.push(msg);
                } else if (Detectors.isDefaultPrompt(msg)) {
                    newDefaultPrompts.push(msg);
                } else {
                    newOtherPrompts.push(msg);
                }
            } 
            else {
                if (Settings.chronos && Detectors.isChronos(msg.norm)) {
                    patches.push({ role: 'system', content: `[敘事過渡] ${msg.content}`, _meta: { category: '系統補丁', origin: '插件生成', creator: 'Plugin', action: '底部追加', protocol: '20. 克羅諾斯', frozen: true } });
                    Logger.patch(`觸發克羅諾斯協議`, LogLevels.DEBUG);
                }
                else if (Settings.flashback && msg.originalIndex < incomingStream.length - 3) {
                    patches.push({ role: 'system', content: `[閃回補充] 在之前的事件中，還發生了以下細節：\n${msg.role}: ${msg.content}`, _meta: { category: '系統補丁', origin: '插件生成', creator: 'Plugin', action: '底部追加', protocol: '10. 閃回插入', frozen: true } });
                    Logger.patch(`觸發閃回插入協議`, LogLevels.DEBUG);
                }
                else {
                    newHistory.push(msg); 
                }
            }
        }

        // 階段 5：雙軌排序引擎
        let rawNewItems = [];
        if (state.frozenSequence.length === 0) {
            rawNewItems = [...newDefaultPrompts, ...newLorebooks, ...newOtherPrompts, ...newHistory, ...dynamicPrompts, ...patches];
            Logger.log(`執行 對話1 初始排序邏輯`, LogLevels.DEBUG);
        } else {
            rawNewItems = [...newHistory, ...newDefaultPrompts, ...newLorebooks, ...newOtherPrompts, ...dynamicPrompts, ...patches];
            Logger.log(`執行 對話2+ 追加排序邏輯 (AI回覆優先凍結)`, LogLevels.DEBUG);
        }

        const newItemsToFreeze = rawNewItems.map(item => {
            if(item._meta) item._meta.frozen = true;
            return { role: item.role, content: item.content, norm: Logger.normalize(item.content), hash: Logger.hash(item.content), _meta: item._meta };
        });

        state.frozenSequence = [...nextFrozenSequence, ...newItemsToFreeze];
        safeSave();

        // 構建最終陣列並注入未凍結元數據
        const finalStream = [...state.frozenSequence];
        
        ephemeralZone.forEach(m => finalStream.push({ role: m.role, content: m.content, _meta: m._meta }));
        
        if (currentUserMsg) {
            currentUserMsg._meta = { category: '當前輸入', origin: '用戶發送', creator: 'User', action: '尾部附加', protocol: '-', frozen: false };
            finalStream.push(currentUserMsg);
        }
        prefills.forEach(p => {
            p._meta = { category: '預填充', origin: 'ST 傳入', creator: 'AI', action: '尾部附加', protocol: '-', frozen: false };
            finalStream.push(p);
        });

        // 📊 生成 Markdown 拓撲圖表 (僅在 DETAILED 級別以上顯示)
        if (Settings.logLevel >= LogLevels.DETAILED) {
            let mdTable = `### 📊 絕對時序陣列拓撲圖 (共 ${finalStream.length} 項)\n\n`;
            mdTable += `| 序號 | 分類 | 生成來源 | 創建者 | 處理方式 | 觸發協議 | 狀態 | 內容摘要 |\n`;
            mdTable += `|---|---|---|---|---|---|---|---|\n`;
            finalStream.forEach((item, idx) => {
                const m = item._meta || {};
                const content = item.content ? item.content.replace(/\n/g, ' ').substring(0, 15) + '...' : '';
                mdTable += `| ${idx} | ${m.category||'-'} | ${m.origin||'-'} | ${m.creator||'-'} | ${m.action||'-'} | ${m.protocol||'-'} | ${m.frozen?'❄️ 凍結':'🔥 未凍結'} | \`${content}\` |\n`;
            });
            Logger.log(mdTable, LogLevels.DETAILED);
        }

        data.chat.splice(0, data.chat.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
        Logger.log(`重構完成。凍結池: ${state.frozenSequence.length} | 臨時區: ${ephemeralZone.length}`, LogLevels.BASIC);

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
                <div id="ds-chat-list-container" style="max-height: 180px; overflow-y: auto; margin-bottom: 10px; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 5px; background: rgba(0,0,0,0.2);"></div>
                <button id="ds-cache-factory-reset" class="menu_button" style="width: 100%; margin-bottom: 15px; background: #8b0000; color: white; border-radius: 6px; padding: 8px;">⚠️ 廠級清空所有凍結池 (還原 ST 默認)</button>
                
                <hr style="border-color: rgba(255,255,255,0.1); margin: 15px 0;">
                
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                    <b style="font-size: 14px; color: #e0e0e0;">📝 Markdown 結構化日誌</b>
                    <select id="ds-opt-logLevel" class="text_pole" style="width: 120px; padding: 4px; background: #222; color: #fff; border: 1px solid #555;">
                        <option value="0" ${Settings.logLevel===0?'selected':''}>0: 關閉</option>
                        <option value="1" ${Settings.logLevel===1?'selected':''}>1: 簡要</option>
                        <option value="2" ${Settings.logLevel===2?'selected':''}>2: 詳細 (拓撲圖)</option>
                        <option value="3" ${Settings.logLevel===3?'selected':''}>3: 深度追蹤</option>
                        <option value="4" ${Settings.logLevel===4?'selected':''}>4: 極限除錯</option>
                    </select>
                </div>
                <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                    <button id="ds-cache-clear-log" class="menu_button" style="flex: 1; background: #444; border-radius: 6px; padding: 6px;">🗑️ 清空日誌</button>
                    <button id="ds-cache-export-log" class="menu_button" style="flex: 1; background: #2d5a27; border-radius: 6px; padding: 6px;">💾 導出日誌 (.md)</button>
                </div>
                <div id="ds-cache-log-container" style="width: 100%; height: 300px; background: #0d0d0d; color: #ccc; font-family: Consolas, monospace; font-size: 12px; overflow-y: auto; border-radius: 6px; padding: 10px; border: 1px solid rgba(255,255,255,0.1); line-height: 1.5;"></div>
            `)}
        </div>
    </div>`;
    
    $('#extensions_settings').append(html);

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
    $('#ds-cache-clear-log').on('click', Logger.clear);
    $('#ds-cache-export-log').on('click', Logger.export);
    
    $('#ds-cache-factory-reset').on('click', () => {
        if (confirm("這將摧毀所有存檔的快取連續性！確定要清除嗎？")) { Settings.chats = {}; safeSave(); renderChatsUI(); }
    });
    
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

        Logger.log('══════ 🛡️ V13 終極日誌旗艦版 就緒 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件啟動崩潰:', e);
    }
});
