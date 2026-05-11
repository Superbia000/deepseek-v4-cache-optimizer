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
        logLevel: 3, // 0:關閉, 1:錯誤, 2:僅動作, 3:動作+表格, 4:極限除錯
        chats: {} 
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
// 深度日誌系統 (Markdown LogManager)
// ==========================================
const LogManager = {
    rawMarkdown: "",
    currentSession: null,

    startSession: function() {
        this.currentSession = { actions: [], original: [], final: [] };
    },
    
    addAction: function(action) {
        if (this.currentSession) this.currentSession.actions.push(action);
    },

    addOriginal: function(msg, index) {
        if (this.currentSession) this.currentSession.original.push({ msg, index });
    },

    addFinal: function(msg, newIndex) {
        if (this.currentSession) this.currentSession.final.push({ msg, newIndex });
    },

    truncate: function(text) {
        if (!text) return "";
        const cleanText = text.replace(/\n/g, ' ').trim();
        return cleanText.length > 30 ? cleanText.substring(0, 30) + '...' : cleanText;
    },

    flush: function() {
        if (!this.currentSession || Settings.logLevel < 2) return;
        
        const time = new Date().toLocaleString(); // 瀏覽器時區
        let md = `### 🕒 處理時間: ${time}\n\n`;

        // 動作列表
        if (this.currentSession.actions.length > 0) {
            md += `**🛠️ 插件執行動作:**\n`;
            this.currentSession.actions.forEach(a => md += `- ${a}\n`);
            md += `\n`;
        }

        // 表格 (僅在 Level 3 以上顯示)
        if (Settings.logLevel >= 3) {
            md += `**📊 處理前原始陣列:**\n`;
            md += `| 原排序 | 角色 | 分類 | 內容摘要 |\n|---|---|---|---|\n`;
            this.currentSession.original.forEach(item => {
                const cat = item.msg.name ? `System(${item.msg.name})` : item.msg.role;
                md += `| ${item.index} | ${item.msg.role} | ${cat} | ${this.truncate(item.msg.content)} |\n`;
            });
            md += `\n`;

            md += `**📈 處理後最終陣列:**\n`;
            md += `| 新排序 | 原排序 | 分類 | 來源/生成 | 處理方式 | 使用協議 | 狀態 | 內容摘要 |\n|---|---|---|---|---|---|---|---|\n`;
            this.currentSession.final.forEach(item => {
                const m = item.msg._meta || { originalIndex: '-', category: '未知', source: '未知', action: '未知', protocol: '未知', status: '未知' };
                md += `| ${item.newIndex} | ${m.originalIndex} | ${m.category} | ${m.source} | ${m.action} | ${m.protocol} | ${m.status} | ${this.truncate(item.msg.content)} |\n`;
            });
            md += `\n---\n\n`;
        }

        this.rawMarkdown += md;
        this.renderToUI();
    },

    renderToUI: function() {
        const container = document.getElementById('ds-cache-log-content');
        if (!container) return;

        // 輕量級 Markdown 轉 HTML 渲染器
        let html = this.rawMarkdown;
        html = html.replace(/^### (.*$)/gim, '<h3 style="color:#00e5ff; margin:15px 0 5px 0; font-size:13px;">$1</h3>');
        html = html.replace(/^\*\* (.*$)/gim, '<b style="color:#e0e0e0; font-size:12px;">$1</b>');
        html = html.replace(/\*\*(.*?)\*\*/g, '<b style="color:#e0e0e0; font-size:12px;">$1</b>');
        html = html.replace(/^- (.*$)/gim, '<li style="margin-left:15px; color:#ccc; font-size:11px;">$1</li>');
        html = html.replace(/^---/gim, '<hr style="border-color:rgba(255,255,255,0.1); margin:15px 0;">');

        // 表格渲染
        const tableRegex = /\|(.+)\|\n\|[-|]+\|\n(\|.+?\|\n)+/g;
        html = html.replace(tableRegex, function(match) {
            const rows = match.trim().split('\n');
            let tableHtml = `<table style="width:100%; border-collapse:collapse; margin:8px 0; font-size:10px; text-align:left;">`;
            rows.forEach((row, i) => {
                if (row.includes('---')) return;
                const cells = row.split('|').filter(c => c !== '');
                tableHtml += `<tr>`;
                cells.forEach(cell => {
                    const style = i === 0 
                        ? `border:1px solid #555; background:rgba(255,255,255,0.1); padding:4px; color:#00e5ff; font-weight:bold;` 
                        : `border:1px solid #444; padding:4px; color:#ccc;`;
                    tableHtml += `<td style="${style}">${cell.trim()}</td>`;
                });
                tableHtml += `</tr>`;
            });
            tableHtml += `</table>`;
            return tableHtml;
        });

        container.innerHTML = html;
        container.scrollTop = container.scrollHeight;
    },

    clear: function() { this.rawMarkdown = ""; this.renderToUI(); },
    copy: function() { navigator.clipboard.writeText(this.rawMarkdown); },
    export: function() {
        const blob = new Blob([this.rawMarkdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `DS_Cache_Log_${new Date().toISOString().slice(0,10)}.md`;
        a.click();
        URL.revokeObjectURL(url);
    }
};

const Logger = {
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
        LogManager.startSession();
        const state = getChatState(getChatKey());
        const incomingStream = data.chat;
        
        let currentUserMsg = null;
        let prefills = [];
        let incomingPool = [];

        // 記錄原始陣列並拆解
        for (let i = 0; i < incomingStream.length; i++) {
            LogManager.addOriginal(incomingStream[i], i);
        }

        for (let i = incomingStream.length - 1; i >= 0; i--) {
            const msg = incomingStream[i];
            if (!currentUserMsg && msg.role === 'user') {
                currentUserMsg = { ...msg, _meta: { originalIndex: i, category: 'User', source: '用戶輸入', action: '附加', protocol: '基礎', status: '未凍結' }};
            } else if (!currentUserMsg && msg.role === 'assistant') {
                prefills.unshift({ ...msg, _meta: { originalIndex: i, category: 'Prefill', source: '預填充', action: '附加', protocol: '基礎', status: '未凍結' }});
            } else {
                incomingPool.unshift({
                    ...msg, norm: Logger.normalize(msg.content), hash: Logger.hash(msg.content), originalIndex: i,
                    _meta: { originalIndex: i, category: msg.name ? 'System' : msg.role, source: 'ST傳入', action: '待處理', protocol: '-', status: '待定' }
                });
            }
        }

        if (Settings.warpFilter) {
            const beforeLen = incomingPool.length;
            incomingPool = incomingPool.filter(msg => !Detectors.isZeroEntropy(msg.norm));
            if (beforeLen > incomingPool.length) LogManager.addAction(`觸發曲率引擎過濾，剔除 ${beforeLen - incomingPool.length} 個零熵節點`);
        }

        let ephemeralZone = [];
        incomingPool = incomingPool.filter(msg => {
            if (Detectors.isEphemeral(msg.norm) || (Settings.floatingAnchor && msg.role === 'system' && msg.name === "Author's Note")) {
                msg._meta.action = '隔離'; msg._meta.protocol = '隔離區/沉底錨點'; msg._meta.status = '未凍結';
                ephemeralZone.push(msg);
                LogManager.addAction(`將節點隔離至底部臨時態 (索引: ${msg.originalIndex})`);
                return false;
            }
            return true;
        });

        const nextFrozenSequence = [];
        const seenHashes = new Set();
        let missingHistoryCount = 0;

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
                patches.push({ role: 'system', content: `[系統微調] 之前的對話已修正微小細節。`, _meta: { originalIndex: '-', category: 'Patch', source: '插件生成', action: '生成補丁', protocol: '熵減護盾', status: '凍結' }});
                LogManager.addAction(`觸發熵減護盾 (相似度: ${bestSim.toFixed(3)})`);
                missingHistoryCount = 0;
            }
            else if (bestSim > 0.85 && frozenMsg.role === 'system') {
                const matched = incomingPool.splice(bestMatchIdx, 1)[0];
                if (Settings.nanoPatching && matched.norm.length > frozenMsg.norm.length && (matched.norm.length - frozenMsg.norm.length) < 300) {
                    patches.push({ role: 'system', content: `[設定微調補充] 新增細節：${matched.content.substring(0, 150)}...`, _meta: { originalIndex: matched.originalIndex, category: 'Patch', source: '插件生成', action: '生成補丁', protocol: '量子微創手術', status: '凍結' }});
                    LogManager.addAction(`觸發量子微創手術`);
                } else if (Settings.hotReload) {
                    patches.push({ role: 'system', content: `[設定熱更新] 最新特徵如下：\n${matched.content}`, _meta: { originalIndex: matched.originalIndex, category: 'Patch', source: '插件生成', action: '生成補丁', protocol: '提示詞熱更新', status: '凍結' }});
                    LogManager.addAction(`觸發提示詞熱更新`);
                }
                missingHistoryCount = 0;
            }
            else if (Settings.timeSpacePatch && bestSim > 0.5) {
                const matched = incomingPool.splice(bestMatchIdx, 1)[0];
                patches.push({ role: 'system', content: `[時空修正] 之前的事件已發生改變，最新情況為：\n${matched.content}`, _meta: { originalIndex: matched.originalIndex, category: 'Patch', source: '插件生成', action: '生成補丁', protocol: '時空補丁', status: '凍結' }});
                LogManager.addAction(`觸發時空補丁`);
                missingHistoryCount = 0;
            }
            else {
                if (frozenMsg.role === 'system') {
                    if (Settings.memoryImprint) LogManager.addAction(`觸發永久記憶烙印，保留已消失的系統提示詞`);
                } else {
                    missingHistoryCount++;
                    if (Settings.prefixAnchor && i === 0) {
                        LogManager.addAction(`觸發絕對前綴錨點，保留頭部記憶`);
                    } else if (Settings.amnesia && missingHistoryCount > 5) {
                        if (missingHistoryCount === 6) patches.push({ role: 'system', content: `[系統提示] 早期的記憶已歸檔，請根據當前上下文繼續。`, _meta: { originalIndex: '-', category: 'Patch', source: '插件生成', action: '生成補丁', protocol: '失憶症協議', status: '凍結' }});
                    } else if (Settings.retconMode && missingHistoryCount <= 3) {
                        patches.push({ role: 'system', content: `[世界意志] 之前的某個事件已被抹除，請當作從未發生過。`, _meta: { originalIndex: '-', category: 'Patch', source: '插件生成', action: '生成補丁', protocol: '吃書協議', status: '凍結' }});
                        LogManager.addAction(`觸發吃書協議`);
                    } else if (Settings.voidBridging) {
                        patches.push({ role: 'system', content: `[上下文微小跳躍]`, _meta: { originalIndex: '-', category: 'Patch', source: '插件生成', action: '生成補丁', protocol: '虛空架橋協議', status: '凍結' }});
                    }
                }
            }
        }

        let newDefaultPrompts = [], newLorebooks = [], newOtherPrompts = [], newHistory = [], dynamicPrompts = [], patches = [];

        for (const msg of incomingPool) {
            if (Settings.deduplication && seenHashes.has(msg.hash)) {
                LogManager.addAction(`觸發絕對去重協議，捨棄重複節點 (索引: ${msg.originalIndex})`);
                continue;
            }

            if (msg.role === 'system') {
                if (Settings.diaryMode && Detectors.isDynamicPrompt(msg.content)) {
                    dynamicPrompts.push({ role: 'system', content: `[狀態更新] ${msg.content}`, _meta: { originalIndex: msg.originalIndex, category: 'System', source: '動態轉換', action: '追加', protocol: '寫日記模式', status: '凍結' }});
                    LogManager.addAction(`觸發寫日記模式`);
                } else if (Detectors.isLorebook(msg)) {
                    msg._meta.action = '追加'; msg._meta.protocol = '排序引擎'; msg._meta.status = '凍結';
                    newLorebooks.push(msg);
                } else if (Detectors.isDefaultPrompt(msg)) {
                    msg._meta.action = '追加'; msg._meta.protocol = '排序引擎'; msg._meta.status = '凍結';
                    newDefaultPrompts.push(msg);
                } else {
                    msg._meta.action = '追加'; msg._meta.protocol = '排序引擎'; msg._meta.status = '凍結';
                    newOtherPrompts.push(msg);
                }
            } 
            else {
                if (Settings.chronos && Detectors.isChronos(msg.norm)) {
                    patches.push({ role: 'system', content: `[敘事過渡] ${msg.content}`, _meta: { originalIndex: msg.originalIndex, category: 'Patch', source: '旁白轉換', action: '生成補丁', protocol: '克羅諾斯協議', status: '凍結' }});
                    LogManager.addAction(`觸發克羅諾斯協議`);
                }
                else if (Settings.flashback && msg.originalIndex < incomingStream.length - 3) {
                    patches.push({ role: 'system', content: `[閃回補充] 在之前的事件中，還發生了以下細節：\n${msg.role}: ${msg.content}`, _meta: { originalIndex: msg.originalIndex, category: 'Patch', source: '插隊轉換', action: '生成補丁', protocol: '閃回插入協議', status: '凍結' }});
                    LogManager.addAction(`觸發閃回插入協議`);
                }
                else {
                    msg._meta.action = '追加'; msg._meta.protocol = '排序引擎'; msg._meta.status = '凍結';
                    newHistory.push(msg);
                }
            }
        }

        let rawNewItems = [];
        if (state.frozenSequence.length === 0) {
            rawNewItems = [...newDefaultPrompts, ...newLorebooks, ...newOtherPrompts, ...newHistory, ...dynamicPrompts, ...patches];
            LogManager.addAction(`執行 對話1 初始排序邏輯`);
        } else {
            rawNewItems = [...newHistory, ...newDefaultPrompts, ...newLorebooks, ...newOtherPrompts, ...dynamicPrompts, ...patches];
            LogManager.addAction(`執行 對話2+ 追加排序邏輯 (AI回覆優先凍結)`);
        }

        const newItemsToFreeze = rawNewItems.map(item => ({
            role: item.role, content: item.content, norm: Logger.normalize(item.content), hash: Logger.hash(item.content),
            _meta: item._meta || { originalIndex: '-', category: '未知', source: '未知', action: '凍結', protocol: '排序引擎', status: '凍結' }
        }));

        state.frozenSequence = [...nextFrozenSequence, ...newItemsToFreeze];
        safeSave();

        const finalStream = [...state.frozenSequence];
        ephemeralZone.forEach(m => finalStream.push(m));
        if (currentUserMsg) finalStream.push(currentUserMsg);
        prefills.forEach(p => finalStream.push(p));

        // 記錄最終陣列並發送
        finalStream.forEach((msg, idx) => LogManager.addFinal(msg, idx));
        data.chat.splice(0, data.chat.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
        
        LogManager.addAction(`✅ 絕對時序重構完成。凍結池: ${state.frozenSequence.length} | 臨時區: ${ephemeralZone.length}`);
        LogManager.flush();

    } catch (err) {
        if (Settings.logLevel >= 1) console.error('[DS Cache] 攔截器發生錯誤', err);
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
            <b>DeepSeek V4 Pro 絕對防禦矩陣 (v13.0 終極日誌版)</b>
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
                
                <hr style="border-color:rgba(255,255,255,0.1); margin:15px 0;">
                
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <b style="font-size: 14px; color: #fff;">📝 Markdown 深度日誌</b>
                    <select id="ds-opt-logLevel" class="text_pole" style="width: 120px; padding: 4px; font-size: 12px;">
                        <option value="0" ${Settings.logLevel===0?'selected':''}>0: 關閉</option>
                        <option value="1" ${Settings.logLevel===1?'selected':''}>1: 僅錯誤</option>
                        <option value="2" ${Settings.logLevel===2?'selected':''}>2: 僅動作</option>
                        <option value="3" ${Settings.logLevel===3?'selected':''}>3: 動作+表格</option>
                        <option value="4" ${Settings.logLevel===4?'selected':''}>4: 極限除錯</option>
                    </select>
                </div>
                
                <div style="display: flex; gap: 8px; margin-bottom: 10px;">
                    <button id="ds-log-copy" class="menu_button" style="flex: 1; padding: 6px; font-size: 12px;">📋 複製</button>
                    <button id="ds-log-export" class="menu_button" style="flex: 1; padding: 6px; font-size: 12px;">💾 導出 .md</button>
                    <button id="ds-log-clear" class="menu_button" style="flex: 1; padding: 6px; font-size: 12px; background: #552222;">🗑️ 清空</button>
                </div>
                
                <div id="ds-cache-log-content" style="width: 100%; height: 300px; overflow-y: auto; background: #0d0d0d; border-radius: 6px; padding: 10px; border: 1px solid rgba(255,255,255,0.1); font-family: Consolas, monospace;">
                    <div style="color: #666; font-size: 12px; text-align: center; margin-top: 130px;">等待生成日誌...</div>
                </div>
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
    $('#ds-cache-factory-reset').on('click', () => { if (confirm("確定要清除所有存檔的快取連續性嗎？")) { Settings.chats = {}; safeSave(); renderChatsUI(); }});
    
    $('#ds-log-copy').on('click', () => { LogManager.copy(); alert("日誌已複製到剪貼簿！"); });
    $('#ds-log-export').on('click', () => LogManager.export());
    $('#ds-log-clear').on('click', () => LogManager.clear());
    
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

        console.log('[DS Cache] ══════ 🛡️ V13 終極日誌旗艦版 就緒 ══════');
    } catch (e) {
        console.error('[DS Cache] 插件啟動崩潰:', e);
    }
});
