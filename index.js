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

    if (!extension_settings.ds_cache_v14_quantum) {
        extension_settings.ds_cache_v14_quantum = defaultSettings;
    }
    Settings = Object.assign({}, defaultSettings, extension_settings.ds_cache_v14_quantum);
}

function safeSave() {
    try { if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced(); } 
    catch (e) { console.warn("[DS Cache] 存檔失敗", e); }
}

// ==========================================
// 深度日誌系統 (Markdown Logger Engine)
// ==========================================
let rawMarkdownLogs = [];

const Logger = {
    _uiViewer: null,
    getTime: () => {
        const now = new Date();
        return `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
    },
    truncate: (text) => {
        if (!text) return '';
        const clean = text.replace(/\n/g, ' ');
        return clean.length > 30 ? clean.substring(0, 30) + '...' : clean;
    },
    write: (markdownText, level = 2) => {
        if (Settings.logLevel < level) return;
        const entry = `**[${Logger.getTime()}]** ${markdownText}\n`;
        rawMarkdownLogs.push(entry);
        Logger.updateUI(entry);
    },
    updateUI: (newEntry) => {
        if (!Logger._uiViewer) return;
        let html = newEntry.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
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
        Logger._uiViewer.appendChild(div);
        Logger._uiViewer.scrollTop = Logger._uiViewer.scrollHeight;
    },
    clear: () => { rawMarkdownLogs = []; if (Logger._uiViewer) Logger._uiViewer.innerHTML = ''; }
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

// ==========================================
// 🛡️ 核心引擎：浮光排除、歸屬感知、動態探測
// ==========================================
const CoreEngine = {
    // 浮光排除：徹底抹除空格、換行、所有標點符號與簡單代碼，提取純粹的語義骨架
    normalize: (text) => {
        if (!text) return '';
        return text.replace(/[\s\n\r\t]/g, '')
                   .replace(/\\n/g, '')
                   .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()""''“”‘’]/g, '')
                   .trim();
    },

    // 歸屬感知：深度識別提示詞最初來源
    getAttribution: (msg, isLastUser, isPrefill) => {
        if (msg.role === 'user') return isLastUser ? { cat: '用戶當前輸入', type: 'USER_CURRENT' } : { cat: '用戶歷史輸入', type: 'USER_HISTORY' };
        if (msg.role === 'assistant') return isPrefill ? { cat: '預填充', type: 'PREFILL' } : { cat: 'AI歷史回覆', type: 'AI_HISTORY' };
        
        if (msg.name) {
            const n = msg.name.toLowerCase();
            if (n.includes('lorebook') || n.includes('world') || n.includes('wi-')) return { cat: `世界書(${msg.name})`, type: 'LOREBOOK' };
            if (n.includes('system') || n.includes('main') || n.includes('nsfw') || n.includes('jailbreak') || n.includes('persona') || n.includes('character')) return { cat: '預設提示詞', type: 'DEFAULT' };
            return { cat: `其他插件(${msg.name})`, type: 'OTHER_PLUGIN' };
        }
        return { cat: '預設提示詞', type: 'DEFAULT' };
    },

    // 動態探測：基於 ST 宏解析後的特徵進行逆向探測 [1][2]
    isDynamic: (msg) => {
        if (msg.role !== 'system') return false; // 歷史對話不視為動態
        const text = msg.content;
        if (!text) return false;
        
        const lower = text.toLowerCase();
        // 探測 RAG 向量檢索與自動摘要
        if (['retrieved context', 'search results', 'vector database', '相关记忆', '检索到的内容', 'summary', 'previously on', '前情提要', '总结', '回顾'].some(k => lower.includes(k))) return true;
        
        // 探測時間與日期變數 (ST 宏 {{time}}, {{date}} 解析後的結果)
        const timeRegex = /\b\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\b/;
        const dateRegex = /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/;
        if (timeRegex.test(text) || dateRegex.test(text)) return true;
        
        return false;
    },

    // 相似度計算 (用於量子糾纏)
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
    if (!Settings.enabled || data.dryRun || !data?.chat?.length) return;

    try {
        const state = getChatState(getChatKey());
        let incomingStream = data.chat;
        
        let lastUserIdx = -1;
        let prefillIdxs = [];
        
        // 尋找當前輸入與預填充
        for (let i = incomingStream.length - 1; i >= 0; i--) {
            if (incomingStream[i].role === 'user' && lastUserIdx === -1) lastUserIdx = i;
            else if (incomingStream[i].role === 'assistant' && lastUserIdx === -1) prefillIdxs.push(i);
        }

        let currentUserMsg = null;
        let prefills = [];
        let incomingPool = [];
        let dynamicPool = [];

        // 階段 1：歸屬感知與動態探測
        for (let i = 0; i < incomingStream.length; i++) {
            const msg = incomingStream[i];
            const isLastUser = (i === lastUserIdx);
            const isPrefill = prefillIdxs.includes(i);
            
            msg._attr = CoreEngine.getAttribution(msg, isLastUser, isPrefill);
            msg._norm = CoreEngine.normalize(msg.content);
            msg._isDynamic = CoreEngine.isDynamic(msg);

            if (isLastUser) currentUserMsg = msg;
            else if (isPrefill) prefills.push(msg);
            else if (msg._isDynamic) dynamicPool.push(msg);
            else incomingPool.push(msg);
        }

        let nextFrozen = [];
        let totalFrozenLen = state.frozenSequence.reduce((acc, m) => acc + m.content.length, 0) || 1;
        let cacheDrop = 0;
        let syncMessages = [];
        let ledger = [];

        // 階段 2：量子糾纏 (全自動感知修改與刪除)
        for (let i = 0; i < state.frozenSequence.length; i++) {
            let frozen = state.frozenSequence[i];
            
            let bestMatchIdx = -1;
            let bestSim = 0;
            for (let j = 0; j < incomingPool.length; j++) {
                if (incomingPool[j].role !== frozen.role) continue;
                let sim = CoreEngine.getSimilarity(frozen._norm, incomingPool[j]._norm);
                if (sim > bestSim) { bestSim = sim; bestMatchIdx = j; }
            }

            if (bestSim === 1) {
                // 完美匹配：原位凍結
                nextFrozen.push(frozen);
                incomingPool.splice(bestMatchIdx, 1);
                ledger.push({ cat: frozen._attr.cat, dyn: frozen._isDynamic ? '是' : '否', action: '原位凍結', content: frozen.content });
            } else if (bestSim > 0.6) {
                // 探測到修改
                if (frozen._isDynamic) {
                    // 動態提示詞例外：保留舊的，新的留在 incomingPool 等待追加
                    nextFrozen.push(frozen);
                    ledger.push({ cat: frozen._attr.cat, dyn: '是', action: '保留舊動態', content: frozen.content });
                } else {
                    // 鏡像同步修改
                    let matched = incomingPool.splice(bestMatchIdx, 1)[0];
                    let drop = (matched.content.length / totalFrozenLen) * 100;
                    cacheDrop += drop;
                    syncMessages.push(`[修改] ${matched._attr.cat} (-${drop.toFixed(1)}%)`);
                    
                    frozen.content = matched.content;
                    frozen._norm = matched._norm;
                    nextFrozen.push(frozen);
                    ledger.push({ cat: frozen._attr.cat, dyn: '否', action: '鏡像同步(修改)', content: frozen.content });
                }
            } else {
                // 探測到刪除 (無匹配)
                if (frozen._isDynamic) {
                    // 動態提示詞絕對不刪除，永遠保留
                    nextFrozen.push(frozen);
                    ledger.push({ cat: frozen._attr.cat, dyn: '是', action: '保留舊動態', content: frozen.content });
                } else {
                    // 完整刪除，下方提示詞將自動向上補位
                    let drop = (frozen.content.length / totalFrozenLen) * 100;
                    cacheDrop += drop;
                    syncMessages.push(`[刪除] ${frozen._attr.cat} (-${drop.toFixed(1)}%)`);
                    ledger.push({ cat: frozen._attr.cat, dyn: '否', action: '向上補位(刪除)', content: frozen.content });
                }
            }
        }

        // 即時提醒 (Toastr)
        if (cacheDrop > 0 && Settings.instantNotify && typeof toastr !== 'undefined') {
            toastr.warning(
                `<b style="font-size:14px;">⚠️ 量子糾纏同步觸發</b><br><br>
                ${syncMessages.join('<br>')}<br><br>
                預估緩存命中率下降: <b style="color:#ff4444;">${cacheDrop.toFixed(2)}%</b>`, 
                'DeepSeek 緩存優化器', 
                {timeOut: 8000, escapeHtml: false}
            );
        }

        // 階段 3：分類新生代提示詞
        let newHistory = [], newDefault = [], newLorebook = [], newOther = [];
        incomingPool.forEach(msg => {
            if (msg._attr.type === 'USER_HISTORY' || msg._attr.type === 'AI_HISTORY') newHistory.push(msg);
            else if (msg._attr.type === 'DEFAULT') newDefault.push(msg);
            else if (msg._attr.type === 'LOREBOOK') newLorebook.push(msg);
            else newOther.push(msg);
        });

        const appendToFrozen = (arr, actionName) => {
            arr.forEach(msg => {
                nextFrozen.push(msg);
                ledger.push({ cat: msg._attr.cat, dyn: msg._isDynamic ? '是' : '否', action: actionName, content: msg.content });
            });
        };

        // 階段 4：絕對凍結排序邏輯
        if (state.frozenSequence.length === 0) {
            // 對話 1：預設 -> 其他 -> 舊歷史 -> 動態
            appendToFrozen(newDefault, '即時凍結(預設)');
            appendToFrozen(newLorebook, '即時凍結(世界書)');
            appendToFrozen(newOther, '即時凍結(其他)');
            appendToFrozen(newHistory, '即時凍結(歷史)');
            appendToFrozen(dynamicPool, '即時凍結(動態)');
        } else {
            // 對話 2+：舊凍結(已在前面) -> 新歷史 -> 新預設 -> 新世界書 -> 新其他 -> 新動態
            appendToFrozen(newHistory, '追加凍結(歷史)');
            appendToFrozen(newDefault, '追加凍結(預設)');
            appendToFrozen(newLorebook, '追加凍結(世界書)');
            appendToFrozen(newOther, '追加凍結(其他)');
            appendToFrozen(dynamicPool, '鏡像追加(動態)');
        }

        state.frozenSequence = nextFrozen;
        state.updatedAt = Date.now();
        safeSave();

        // 階段 5：構建最終輸出流 (剝離內部標記)
        data.chat.length = 0;
        data.chat.push(...nextFrozen.map(m => {
            let clean = { role: m.role, content: m.content };
            if (m.name) clean.name = m.name;
            return clean;
        }));
        
        if (currentUserMsg) {
            let clean = { role: currentUserMsg.role, content: currentUserMsg.content };
            if (currentUserMsg.name) clean.name = currentUserMsg.name;
            data.chat.push(clean);
            ledger.push({ cat: currentUserMsg._attr.cat, dyn: '否', action: '置底發送', content: currentUserMsg.content });
        }
        prefills.forEach(p => {
            let clean = { role: p.role, content: p.content };
            if (p.name) clean.name = p.name;
            data.chat.push(clean);
            ledger.push({ cat: p._attr.cat, dyn: '否', action: '置底發送', content: p.content });
        });

        // 寫入全景日誌
        if (Settings.logLevel >= 2) {
            let mdLog = `### 🛡️ 絕對防禦矩陣處理報告 (量子糾纏)\n\n`;
            mdLog += `| 最終排序 | 分類 | 動態標記 | 處理動作 | 提示詞摘要 |\n`;
            mdLog += `|---|---|---|---|---|\n`;
            ledger.forEach((l, idx) => {
                mdLog += `| ${idx + 1} | ${l.cat} | ${l.dyn} | ${l.action} | ${Logger.truncate(l.content)} |\n`;
            });
            Logger.write(mdLog, 3);
        }

    } catch (err) {
        console.error('[DS Cache] 攔截器發生錯誤:', err);
    }
}

// ==========================================
// 🌟 UI 渲染與設置
// ==========================================
function renderChatsUI() {
    const container = $('#ds-chat-list-container');
    if (container.length === 0) return;
    container.empty();
    
    const keys = Object.keys(Settings.chats);
    if (keys.length === 0) {
        container.append(`<div style="padding: 20px; text-align: center; color: #888;">尚無接管的存檔數據</div>`);
        return;
    }

    keys.forEach(key => {
        const chat = Settings.chats[key];
        container.append(`
            <div style="display: flex; justify-content: space-between; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                <span style="color: #ccc; font-size: 13px;">${chat.character} (${chat.label})</span>
                <span style="color: #00e5ff; font-size: 12px;">${chat.frozenSequence.length} 節點</span>
            </div>
        `);
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
                .ds-log-table { width: 100%; border-collapse: collapse; font-size: 12px; color: #ddd; } 
                .ds-log-table th { position: sticky; top: 0; background: #222; color: #00e5ff; padding: 8px; text-align: left; }
                .ds-log-table td { border-bottom: 1px solid rgba(255,255,255,0.05); padding: 6px 8px; }
            </style>
        `);
    }

    const html = `
    <div class="inline-drawer" id="ds-v14-opt-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>DeepSeek V4 Pro 絕對防禦矩陣 (v14.0 量子糾纏版)</b>
            <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="padding:15px 10px;">
            
            <div style="margin-bottom: 15px;">
                ${createToggle('enabled', '🛡️ 啟用絕對不可變序列 (總開關)', '嚴格遵守「只追加不移位」的絕對規則，鎖定所有提示詞位置，實現接近 100% 的緩存命中率。', Settings.enabled)}
                ${createToggle('instantNotify', '🔔 啟用量子糾纏即時提醒', '全自動感知用戶修改或刪除歷史訊息，並即時彈窗提醒該操作對緩存命中率的影響。', Settings.instantNotify)}
            </div>

            <div style="margin-bottom: 10px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 6px;">
                <span style="font-size: 14px; font-weight: bold; color: #e0e0e0; margin-right: 15px;">📝 日誌輸出等級</span>
                <select id="ds-opt-logLevel" class="text_pole" style="width: 150px;">
                    <option value="0" ${Settings.logLevel===0?'selected':''}>0: 關閉</option>
                    <option value="2" ${Settings.logLevel===2?'selected':''}>2: 標準摘要</option>
                    <option value="3" ${Settings.logLevel===3?'selected':''}>3: 全景 Markdown 表格</option>
                </select>
            </div>
            
            <b style="font-size: 13px; color: #aaa; display: block; margin-bottom: 8px;">📂 存檔凍結池狀態：</b>
            <div id="ds-chat-list-container" style="max-height: 150px; overflow-y: auto; margin-bottom: 10px; background: rgba(0,0,0,0.3); border-radius: 6px;"></div>
            <button id="ds-cache-factory-reset" class="menu_button" style="width: 100%; margin-bottom: 15px; background: rgba(255, 68, 68, 0.1); color: #ff4444; border: 1px solid rgba(255, 68, 68, 0.3);">⚠️ 清空所有凍結池 (還原 ST 默認)</button>
            
            <b style="font-size: 13px; color: #aaa;">📝 全景 Markdown 日誌：</b>
            <div id="ds-cache-log-viewer" style="width: 100%; height: 350px; background: #0d0d0d; color: #e0e0e0; font-family: Consolas, monospace; font-size: 12px; overflow-y: auto; border-radius: 6px; padding: 10px; border: 1px solid rgba(255,255,255,0.1); margin-top: 5px;"></div>
        </div>
    </div>`;
    
    $('#extensions_settings').append(html);
    Logger._uiViewer = document.getElementById('ds-cache-log-viewer');

    $('#ds-opt-enabled').on('change', function() { Settings.enabled = $(this).is(':checked'); safeSave(); });
    $('#ds-opt-instantNotify').on('change', function() { Settings.instantNotify = $(this).is(':checked'); safeSave(); });
    $('#ds-opt-logLevel').on('change', function () { Settings.logLevel = parseInt($(this).val()); safeSave(); });
    
    $('#ds-cache-factory-reset').on('click', () => { 
        if (confirm("⚠️ 這將摧毀所有存檔的快取連續性！確定要清除嗎？")) { 
            Settings.chats = {}; safeSave(); renderChatsUI(); 
        } 
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

        Logger.write('══════ 🛡️ V14 量子糾纏版 (絕對凍結架構) 就緒 ══════', 2);
    } catch (e) {
        console.error('[DS Cache] 插件啟動崩潰:', e);
    }
});
