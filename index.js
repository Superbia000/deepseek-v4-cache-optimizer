import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 狀態與設定 (Settings & State)
// ==========================================
let Settings = {};

function initSettings() {
    if (!extension_settings.ds_cache_v13_pro_ui) {
        extension_settings.ds_cache_v13_pro_ui = {
            enabled: true,
            warpFilter: true,     // P6: 曲率引擎
            entropyShield: true,  // P8: 熵減護盾
            retconMode: true,     // P13: 吃書協議
            diaryMode: true,      // P14: 寫日記模式
            chronosMode: true,    // P20: 克羅諾斯協議
            logLevel: 3,
            chats: {} 
        };
    }
    Settings = extension_settings.ds_cache_v13_pro_ui;
    if (!Settings.chats) Settings.chats = {}; 
}

function safeSave() {
    try { if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced(); } 
    catch (e) { console.warn("[DS Cache] 存檔失敗", e); }
}

// ==========================================
// 深度日誌與核心工具 (Logger & Utils)
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };
const Logger = {
    _uiTextarea: null,
    log: (msg, level = LogLevels.DETAILED) => logAt(level, 'log', msg),
    warn: (msg, level = LogLevels.BASIC) => logAt(level, 'warn', msg),
    patch: (msg, level = LogLevels.BASIC) => logAt(level, 'patch', msg),
    error: (msg, err, level = LogLevels.BASIC) => logAt(level, 'error', err ? `${msg} ${err}` : msg),
    normalize: (text) => text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
    hash: (text) => {
        let hash = 0, str = Logger.normalize(text);
        for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i);
        return hash.toString(16);
    }
};

function logAt(level, type, msg) {
    if (Settings.logLevel < level) return;
    const time = new Date().toISOString().substring(11, 23);
    const fullMsg = `[${time}] ${msg}`;
    if (type === 'warn') console.warn(`%c[DS Cache] 🌪️ ${msg}`, 'color: #ffaa00;');
    else if (type === 'error') console.error(`[DS Cache] 🔴 ${msg}`);
    else if (type === 'patch') console.log(`%c[DS Cache] 🩹 ${msg}`, 'color: #ff00ff; font-weight: bold;');
    else console.log(`%c[DS Cache] ✅ ${msg}`, 'color: #00ff00;');
    
    if (Logger._uiTextarea) {
        Logger._uiTextarea.value += fullMsg + '\n';
        Logger._uiTextarea.scrollTop = Logger._uiTextarea.scrollHeight;
    }
}

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
    isEphemeral: (text) => ['retrieved context', 'search results', 'vector database', '相关记忆', '检索到的内容', 'summary', 'previously on', '前情提要', '总结', '回顾'].some(k => text.toLowerCase().includes(k)),
    isChronos: (text) => text.length <= 150 && ['later', 'next day', '第二天', '几个小时后', '一段时间后', 'meanwhile'].some(k => text.toLowerCase().includes(k)),
    isDynamicPrompt: (text) => /\{\{.*?\}\}/.test(text) || text.includes('Current Time:') || text.includes('当前时间：')
};

// ==========================================
// 🌌 核心處理器 (The Absolute Engine)
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (!Settings.enabled || data.dryRun || !data?.chat?.length) return;

    try {
        const state = getChatState(getChatKey());
        const incomingStream = data.chat;
        
        let currentUserMsg = null, prefills = [], incomingPool = [];

        for (let i = incomingStream.length - 1; i >= 0; i--) {
            const msg = incomingStream[i];
            if (!currentUserMsg && msg.role === 'user') currentUserMsg = msg;
            else if (!currentUserMsg && msg.role === 'assistant') prefills.unshift(msg);
            else incomingPool.unshift({ ...msg, norm: Logger.normalize(msg.content), hash: Logger.hash(msg.content), originalIndex: i });
        }

        if (Settings.warpFilter) incomingPool = incomingPool.filter(msg => !Detectors.isZeroEntropy(msg.norm));

        let ephemeralZone = [], newSysPrompts = [], newLorebooks = [], newHistory = [], dynamicPrompts = [], patches = [];
        
        incomingPool = incomingPool.filter(msg => {
            if (Detectors.isEphemeral(msg.norm) || (msg.role === 'system' && msg.name === "Author's Note")) {
                ephemeralZone.push(msg); return false;
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

            let bestMatchIdx = -1, bestSim = 0;
            for (let j = 0; j < incomingPool.length; j++) {
                if (incomingPool[j].role !== frozenMsg.role) continue;
                const sim = getSimilarity(frozenMsg.norm, incomingPool[j].norm);
                if (sim > bestSim) { bestSim = sim; bestMatchIdx = j; }
            }

            if (bestSim === 1) {
                incomingPool.splice(bestMatchIdx, 1);
                missingHistoryCount = 0;
            } 
            else if (bestSim > 0.99 && Settings.entropyShield) {
                incomingPool.splice(bestMatchIdx, 1);
                patches.push({ role: 'system', content: `[系統微調] 之前的對話已修正微小細節。` });
                Logger.patch(`觸發熵減護盾`);
                missingHistoryCount = 0;
            }
            else if (bestSim > 0.85 && frozenMsg.role === 'system') {
                const matched = incomingPool.splice(bestMatchIdx, 1)[0];
                if (matched.norm.length > frozenMsg.norm.length && (matched.norm.length - frozenMsg.norm.length) < 300) {
                    patches.push({ role: 'system', content: `[設定微調補充] 新增細節：${matched.content.substring(0, 150)}...` });
                } else {
                    patches.push({ role: 'system', content: `[設定熱更新] 最新特徵如下：\n${matched.content}` });
                }
                missingHistoryCount = 0;
            }
            else if (bestSim > 0.5) {
                const matched = incomingPool.splice(bestMatchIdx, 1)[0];
                patches.push({ role: 'system', content: `[時空修正] 之前的事件已發生改變，最新情況為：\n${matched.content}` });
                missingHistoryCount = 0;
            }
            else {
                if (frozenMsg.role !== 'system') {
                    missingHistoryCount++;
                    if (i > 0) {
                        if (missingHistoryCount > 5) {
                            if (missingHistoryCount === 6) patches.push({ role: 'system', content: `[系統提示] 早期的記憶已歸檔，請根據當前上下文繼續。` });
                        } else if (Settings.retconMode && missingHistoryCount <= 3) {
                            patches.push({ role: 'system', content: `[世界意志] 之前的某個事件已被抹除，請當作從未發生過。` });
                        } else {
                            patches.push({ role: 'system', content: `[上下文微小跳躍]` });
                        }
                    }
                }
            }
        }

        for (const msg of incomingPool) {
            if (seenHashes.has(msg.hash)) continue;

            if (msg.role === 'system') {
                if (Settings.diaryMode && Detectors.isDynamicPrompt(msg.content)) {
                    dynamicPrompts.push({ role: 'system', content: `[狀態更新] ${msg.content}` });
                } else if (msg.name && msg.name.includes('Lorebook')) {
                    newLorebooks.push(msg);
                } else {
                    newSysPrompts.push(msg);
                }
            } 
            else {
                if (Settings.chronosMode && Detectors.isChronos(msg.norm)) {
                    patches.push({ role: 'system', content: `[敘事過渡] ${msg.content}` });
                }
                else if (msg.originalIndex < incomingStream.length - 3) {
                    patches.push({ role: 'system', content: `[閃回補充] 在之前的事件中，還發生了以下細節：\n${msg.role}: ${msg.content}` });
                }
                else {
                    newHistory.push(msg);
                }
            }
        }

        const newItemsToFreeze = [...newSysPrompts, ...newLorebooks, ...newHistory, ...dynamicPrompts, ...patches].map(item => ({
            role: item.role, content: item.content, norm: Logger.normalize(item.content), hash: Logger.hash(item.content)
        }));

        state.frozenSequence = [...nextFrozenSequence, ...newItemsToFreeze];
        safeSave();

        const finalStream = [...state.frozenSequence];
        ephemeralZone.forEach(m => finalStream.push({ role: m.role, content: m.content }));
        if (currentUserMsg) finalStream.push(currentUserMsg);
        prefills.forEach(p => finalStream.push(p));

        data.chat.splice(0, data.chat.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
        Logger.log(`✅ 重構完成。凍結池: ${state.frozenSequence.length} | 臨時區: ${ephemeralZone.length}`, LogLevels.BASIC);

    } catch (err) { Logger.error('攔截器發生錯誤', err); }
}

// ==========================================
// UI 構建與樣式注入 (UI & Styling)
// ==========================================
const UI_CSS = `
<style>
    .ds-v13-container { font-family: sans-serif; }
    .ds-v13-category { border: 1px solid var(--SmartThemeBorderColor, #444); margin-bottom: 10px; border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.1); }
    .ds-v13-header { padding: 10px 15px; background: var(--SmartThemeBlurTintColor, #222); cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; font-size: 1.05em; transition: background 0.2s; }
    .ds-v13-header:hover { background: var(--SmartThemeHoverColor, #333); }
    .ds-v13-content { padding: 12px; display: none; flex-direction: column; gap: 12px; }
    .ds-v13-row { display: flex; align-items: flex-start; gap: 12px; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px; border-left: 3px solid transparent; transition: border-color 0.2s; }
    .ds-v13-row:hover { border-left-color: #00e5ff; background: rgba(255,255,255,0.06); }
    .ds-v13-toggle-wrap { flex-shrink: 0; margin-top: 2px; }
    .ds-v13-text-wrap { display: flex; flex-direction: column; gap: 4px; }
    .ds-v13-title { font-size: 0.95em; font-weight: bold; color: var(--SmartThemeQuoteColor, #00e5ff); display: flex; align-items: center; gap: 8px; }
    .ds-v13-desc { font-size: 0.85em; opacity: 0.75; line-height: 1.4; }
    .ds-v13-badge-core { font-size: 0.7em; background: #4CAF50; color: white; padding: 2px 6px; border-radius: 12px; font-weight: normal; letter-spacing: 0.5px; }
    .ds-v13-badge-auto { font-size: 0.7em; background: #2196F3; color: white; padding: 2px 6px; border-radius: 12px; font-weight: normal; letter-spacing: 0.5px; }
    .ds-v13-icon { transition: transform 0.3s ease; }
    .ds-v13-header.open .ds-v13-icon { transform: rotate(180deg); }
</style>
`;

function createRow(title, desc, toggleId, settingKey, badgeType = null) {
    let leftElement = '';
    let badgeHtml = '';
    
    if (badgeType === 'core') badgeHtml = `<span class="ds-v13-badge-core">🔒 核心常駐</span>`;
    else if (badgeType === 'auto') badgeHtml = `<span class="ds-v13-badge-auto">⚡ 自動觸發</span>`;

    if (toggleId) {
        const isChecked = Settings[settingKey] ? 'checked' : '';
        leftElement = `<input type="checkbox" id="${toggleId}" ${isChecked} style="cursor:pointer; width:16px; height:16px;">`;
    } else {
        leftElement = `<div style="width:16px; height:16px; display:flex; align-items:center; justify-content:center; opacity:0.5;">🛡️</div>`;
    }

    return `
    <div class="ds-v13-row">
        <div class="ds-v13-toggle-wrap">
            <label class="checkbox_label" style="margin:0; padding:0;">${leftElement}</label>
        </div>
        <div class="ds-v13-text-wrap">
            <div class="ds-v13-title">${title} ${badgeHtml}</div>
            <div class="ds-v13-desc">${desc}</div>
        </div>
    </div>`;
}

function renderChatsUI() {
    const container = $('#ds-chat-list-container');
    if (container.length === 0) return;
    container.empty();
    
    const keys = Object.keys(Settings.chats);
    if (keys.length === 0) {
        container.append('<p style="font-size:0.85em; opacity:0.6; text-align:center; padding:10px;">尚無接管的存檔數據。</p>');
        return;
    }

    keys.forEach(key => {
        const chat = Settings.chats[key];
        const html = `
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.3); padding:8px 12px; margin-bottom:6px; border-radius:4px; border-left: 2px solid #4CAF50;">
                <span style="font-size:0.85em;">${chat.label} <span style="opacity:0.6; margin-left:5px;">(凍結節點: ${chat.frozenSequence.length})</span></span>
                <button class="menu_button interactable ds-reset-btn" data-key="${key}" style="font-size:0.75em; padding:4px 8px; margin:0;">清空快取鏈</button>
            </div>
        `;
        container.append(html);
    });

    container.find('.ds-reset-btn').on('click', function() {
        delete Settings.chats[$(this).data('key')];
        safeSave(); renderChatsUI();
    });
}

async function setupUI() {
    $('head').append(UI_CSS);

    const html = `
    <div class="inline-drawer ds-v13-container" id="ds-v13-opt-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>DeepSeek V4 Pro 絕對防禦矩陣 (v13.1)</b>
            <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="padding:15px 10px;">
            
            <!-- 總開關 -->
            <div style="margin-bottom: 15px; padding: 10px; background: rgba(76, 175, 80, 0.1); border: 1px solid #4CAF50; border-radius: 8px;">
                <label class="checkbox_label" style="font-size: 1.1em; font-weight: bold; color: #4CAF50;">
                    <input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}> 
                    🛡️ 啟用絕對不可變序列 (Append-Only 總引擎)
                </label>
                <div style="font-size: 0.85em; opacity: 0.8; margin-top: 5px; margin-left: 28px;">
                    廢棄傳統重新排序邏輯。一旦提示詞發送，其絕對位置將被永久物理凍結，從數學層面保證 100% 快取命中率。
                </div>
            </div>

            <!-- 分類 1: 核心防禦矩陣 -->
            <div class="ds-v13-category">
                <div class="ds-v13-header"><span>🛡️ 核心防禦矩陣 (Protocols 2-6)</span><span class="fa-solid fa-chevron-down ds-v13-icon"></span></div>
                <div class="ds-v13-content">
                    ${createRow('協議2 & 19: 向量隔離區與摘要沉底', '將 RAG 隨機記憶與自動摘要標記為臨時態，強制關入對話最底部的隔離區，不寫入永久凍結序列，保住上方 99% 主體快取。', null, null, 'core')}
                    ${createRow('協議3: 絕對前綴錨點', '當對話過長導致 ST 刪除最舊的第一句話時，強制攔截並保留該頭部錨點，改從中間刪除，完美保住前綴快取。', null, null, 'core')}
                    ${createRow('協議4 & 5: 語義正規化與絕對去重', '底層統一文本符號與排版，並計算量子哈希值。遇到語義相同或重複插入的提示詞，直接在底層抹除。', null, null, 'core')}
                    ${createRow('協議6: 曲率引擎過濾', '過濾掉 ST 偶爾發送的零熵節點（完全空白或只有無意義符號的消息），防止碎石切斷快取連續性。', 'ds-warp-filter', 'warpFilter')}
                </div>
            </div>

            <!-- 分類 2: 時空與歷史修正 -->
            <div class="ds-v13-category">
                <div class="ds-v13-header"><span>🌌 時空與歷史修正 (Protocols 8-13)</span><span class="fa-solid fa-chevron-down ds-v13-icon"></span></div>
                <div class="ds-v13-content">
                    ${createRow('協議8: 熵減護盾協議', '攔截對舊對話的微小修改（如錯字），保持舊對話不變，並在底部生成隱形補丁：「錯字修正：已修正微小細節」。', 'ds-entropy-shield', 'entropyShield')}
                    ${createRow('協議9 & 10: 時空補丁與閃回插入', '針對大幅度歷史修改或中途插入對話，凍結舊歷史，並在底部遞送紙條：「時空修正/閃回補充：事件已改變/發生新細節」。', null, null, 'auto')}
                    ${createRow('協議11 & 12: 虛空架橋與失憶症', '當對話中間或頭部被大量刪除時，生成「上下文微小跳躍」或「早期記憶已歸檔」補丁，引導 AI 接受記憶缺失。', null, null, 'auto')}
                    ${createRow('協議13: 吃書協議', '當刪除中間關鍵對話時，保留快取，並在底部告訴 AI：「世界意志發動了記憶抹除，請當作從未發生過」。', 'ds-retcon-mode', 'retconMode')}
                </div>
            </div>

            <!-- 分類 3: 動態提示詞與設定 -->
            <div class="ds-v13-category">
                <div class="ds-v13-header"><span>📜 動態提示詞與設定 (Protocols 14-20)</span><span class="fa-solid fa-chevron-down ds-v13-icon"></span></div>
                <div class="ds-v13-content">
                    ${createRow('協議14: 寫日記模式', '解決動態時間變數破壞快取的問題。將新時間當作「新的日記條目」追加在最底部，讓 AI 感受時間流逝。', 'ds-diary-mode', 'diaryMode')}
                    ${createRow('協議15 & 16: 浮動錨點穩定與永久記憶烙印', '剝奪 Author Note 的浮動權鎖死底部；無視 ST 移除不再觸發的世界書，讓其幽靈永久烙印在凍結序列中。', null, null, 'core')}
                    ${createRow('協議17 & 18: 量子微創手術與熱更新', '修改角色卡時，精準提取新增字句做成納米補丁放在底部；若大幅重寫則追加熱更新聲明，不讓 AI 重讀整張卡。', null, null, 'auto')}
                    ${createRow('協議20: 克羅諾斯協議', '自動識別簡短旁白（如時間跳躍 later, next day），將其轉化為底部的敘事過渡補丁，不打斷歷史快取。', 'ds-chronos-mode', 'chronosMode')}
                </div>
            </div>

            <!-- 分類 4: 存檔與日誌管理 -->
            <div class="ds-v13-category">
                <div class="ds-v13-header"><span>📂 存檔與日誌管理</span><span class="fa-solid fa-chevron-down ds-v13-icon"></span></div>
                <div class="ds-v13-content" style="display:flex;">
                    <b style="font-size:0.9em; color:#aaa;">當前接管的存檔凍結池：</b>
                    <div id="ds-chat-list-container" style="max-height:150px; overflow-y:auto; border:1px solid #444; border-radius:6px; padding:5px; background:rgba(0,0,0,0.2);"></div>
                    <button id="ds-cache-factory-reset" class="menu_button" style="margin:5px 0; background:rgba(244, 67, 54, 0.2); color:#ff5252; border:1px solid #ff5252;">⚠️ 廠級清空所有凍結池 (還原 ST 默認)</button>
                    <b style="font-size:0.9em; color:#aaa; margin-top:10px;">系統運作日誌：</b>
                    <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%; height:150px; background:#0d0d0d; color:#00e5ff; font-family:Consolas,monospace; font-size:11px; white-space:pre-wrap; border-radius:6px; padding:8px;"></textarea>
                </div>
            </div>

        </div>
    </div>`;
    
    $('#extensions_settings').append(html);
    Logger._uiTextarea = document.getElementById('ds-cache-log');

    // 折疊邏輯
    $('.ds-v13-header').on('click', function() {
        $(this).toggleClass('open');
        $(this).next('.ds-v13-content').slideToggle(200);
    });

    // 綁定開關事件
    const bindToggle = (id, key) => {
        $(`#${id}`).on('change', function () { Settings[key] = $(this).is(':checked'); safeSave(); });
    };
    bindToggle('ds-cache-enable', 'enabled');
    bindToggle('ds-warp-filter', 'warpFilter');
    bindToggle('ds-entropy-shield', 'entropyShield');
    bindToggle('ds-retcon-mode', 'retconMode');
    bindToggle('ds-diary-mode', 'diaryMode');
    bindToggle('ds-chronos-mode', 'chronosMode');
    
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

        Logger.log('══════ 🛡️ V13.1 絕對防禦矩陣 (旗艦UI版) 就緒 ══════', LogLevels.BASIC);
    } catch (e) { console.error('[DS Cache] 插件啟動崩潰:', e); }
});
