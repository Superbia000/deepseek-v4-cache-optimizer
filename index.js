import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 狀態與設定 (延遲初始化)
// ==========================================
let Settings = {};

function initSettings() {
    if (!extension_settings.ds_cache_v9) {
        extension_settings.ds_cache_v9 = {
            enabled: true,
            toastSys: true,
            toastLore: true,
            toastHistory: true,
            showResetPrompt: true,
            logLevel: 3,
            chats: {} 
        };
    }
    Settings = extension_settings.ds_cache_v9;
    if (!Settings.chats) Settings.chats = {}; 
}

function safeSave() {
    try {
        if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
    } catch (e) {
        console.warn("[DS Cache] 存檔失敗", e);
    }
}

// ==========================================
// 日誌系統 (神級標籤強化)
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function logAt(level, type, msg) {
    if (Settings.logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const fullMsg = `[${time}] ${msg}`;
    if (type === 'warn') {
        console.warn(`%c[DS Cache v9.0] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS Cache v9.0] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS Cache v9.0] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
    }
    if (Logger._uiTextarea) {
        Logger._uiTextarea.value += fullMsg + '\n';
        Logger._uiTextarea.scrollTop = Logger._uiTextarea.scrollHeight;
    }
}

const Logger = {
    _uiTextarea: null,
    log: (msg, level = LogLevels.DETAILED) => logAt(level, 'log', msg),
    warn: (msg, level = LogLevels.BASIC) => logAt(level, 'warn', msg),
    error: (msg, err, level = LogLevels.BASIC) => logAt(level, 'error', err ? `${msg} ${err}` : msg),
    normalize: (text) => text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
};

// ==========================================
// 狀態管理：精確識別存檔
// ==========================================
function getChatKey() {
    const context = getContext();
    let charName = "Unknown";
    if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
        charName = context.characters[context.characterId].name || context.characterId;
    } else if (context.name2) {
        charName = context.name2;
    }
    
    let chatId = context.chatId || "default_chat";
    let groupId = context.groupId;
    
    if (groupId) {
        return { key: `group_${groupId}_${chatId}`, label: `群組存檔: ${chatId}` };
    }
    return { key: `char_${context.characterId}_${chatId}`, label: `角色: ${charName} | 存檔: ${chatId}` };
}

function getChatState(chatKeyInfo) {
    if (!Settings.chats[chatKeyInfo.key]) {
        Settings.chats[chatKeyInfo.key] = {
            label: chatKeyInfo.label,
            frozenSequence: [],
            lastSentSequence: [],
            lastPrefills: []
        };
        safeSave();
        renderChatsUI();
    }
    return Settings.chats[chatKeyInfo.key];
}

// ==========================================
// 核心工具：分類與相似度
// ==========================================
function createMsg(msg, tag) {
    const content = msg.content || '';
    return {
        role: msg.role,
        content: content,
        norm: Logger.normalize(content),
        len: content.length,
        tag: tag 
    };
}

function getSimilarity(str1, str2) {
    if (str1 === str2) return 1;
    if (Math.abs(str1.length - str2.length) > Math.max(str1.length, str2.length) * 0.5) return 0;
    const s1 = str1.length < str2.length ? str1 : str2;
    const s2 = str1.length < str2.length ? str2 : str1;
    if (s1.length === 0) return 0;
    
    const bigrams = new Set();
    for (let i = 0; i < s1.length - 1; i++) bigrams.add(s1.substring(i, i+2));
    
    let matchCount = 0;
    for (let i = 0; i < s2.length - 1; i++) {
        if (bigrams.has(s2.substring(i, i+2))) matchCount++;
    }
    const union = (s1.length - 1) + (s2.length - 1) - matchCount;
    return union <= 0 ? 1 : matchCount / union;
}

function stripPrefillFromAssistant(assistantObj, prefills) {
    if (!assistantObj || !prefills || prefills.length === 0) return assistantObj;
    let content = assistantObj.content || '';
    let modified = false;
    for (const p of prefills) {
        const pContent = p.content || '';
        if (content.startsWith(pContent)) {
            content = content.substring(pContent.length);
            modified = true;
        }
    }
    if (modified) {
        content = content.replace(/^[\s\n]+/, ''); 
        return { ...assistantObj, content: content, norm: Logger.normalize(content), len: content.length };
    }
    return assistantObj;
}

// ==========================================
// 解析 ST 數據流
// ==========================================
function parseSTStream(stream) {
    const sysMsgs = [];
    const chatMsgs = [];

    for (const msg of stream) {
        const isSys = (msg.role === 'system' || (msg.role !== 'user' && msg.role !== 'assistant'));
        if (isSys) sysMsgs.push(createMsg(msg, 'SYS'));
        else chatMsgs.push(createMsg(msg, msg.role === 'user' ? 'USER' : 'AI'));
    }

    let lastUserIdx = -1;
    for (let i = chatMsgs.length - 1; i >= 0; i--) {
        if (chatMsgs[i].tag === 'USER') { lastUserIdx = i; break; }
    }

    let historyTurns = [];
    let currentTurn = { user: null, prefills: [] };

    if (lastUserIdx === -1) {
        currentTurn.prefills = chatMsgs.filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'}));
    } else {
        const hMsgs = chatMsgs.slice(0, lastUserIdx);
        const cMsgs = chatMsgs.slice(lastUserIdx);

        currentTurn.user = cMsgs[0];
        currentTurn.prefills = cMsgs.slice(1).filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'}));

        let curUser = null;
        let curAiContents = [];
        for (const msg of hMsgs) {
            if (msg.tag === 'USER') {
                if (curUser) historyTurns.push({ user: curUser, assistant: curAiContents.length ? createMsg({role: 'assistant', content: curAiContents.join('\n')}, 'AI') : null });
                curUser = msg;
                curAiContents = [];
            } else if (msg.tag === 'AI') {
                curAiContents.push(msg.content);
            }
        }
        if (curUser) historyTurns.push({ user: curUser, assistant: curAiContents.length ? createMsg({role: 'assistant', content: curAiContents.join('\n')}, 'AI') : null });
    }
    return { sysMsgs, historyTurns, currentTurn };
}

// ==========================================
// 核心：平鋪同步演算法
// ==========================================
function buildSequence(state, sysMsgs, historyTurns, currentTurn) {
    const sysMsgsPool = [...sysMsgs];
    const newFrozen = [];

    // 1. 原位更新或移除
    for (let i = 0; i < state.frozenSequence.length; i++) {
        const item = state.frozenSequence[i];
        
        if (item.tag === 'SYS') {
            let bestIdx = -1;
            let bestScore = 0;
            for (let j = 0; j < sysMsgsPool.length; j++) {
                const score = getSimilarity(item.norm, sysMsgsPool[j].norm);
                if (score > bestScore) { bestScore = score; bestIdx = j; }
            }
            if (bestScore === 1) {
                newFrozen.push(item);
                sysMsgsPool.splice(bestIdx, 1);
                Logger.log(`[SYS-不變] 原位保留: ${item.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DEBUG);
            } else if (bestScore > 0.6) { 
                const matchedItem = sysMsgsPool[bestIdx];
                newFrozen.push(matchedItem);
                sysMsgsPool.splice(bestIdx, 1);
                Logger.log(`[SYS-修改] 原位更新: ${matchedItem.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DETAILED);
            } else {
                Logger.log(`[SYS-刪除] 檢測到提示詞被刪除，抽出上移...`, LogLevels.DETAILED);
            }
        } else {
            newFrozen.push(item);
        }
    }

    // 2. 歷史追加
    let lastFrozenUserNorm = null;
    for (let i = newFrozen.length - 1; i >= 0; i--) {
        if (newFrozen[i].tag === 'USER') { lastFrozenUserNorm = newFrozen[i].norm; break; }
    }

    let startIdx = 0;
    if (lastFrozenUserNorm) {
        for (let i = 0; i < historyTurns.length; i++) {
            if (historyTurns[i].user.norm === lastFrozenUserNorm) {
                startIdx = i + 1;
                if (historyTurns[i].assistant) {
                    const cleanAssistant = stripPrefillFromAssistant(historyTurns[i].assistant, state.lastPrefills || []);
                    let aiUpdated = false;
                    for (let k = newFrozen.length - 1; k >= 0; k--) {
                        if (newFrozen[k].tag === 'SYS') break;
                        if (newFrozen[k].tag === 'USER') {
                            if (!aiUpdated) {
                                newFrozen.splice(k + 1, 0, cleanAssistant);
                                Logger.log(`[歷史-AI] 補全凍結: ${cleanAssistant.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DEBUG);
                            }
                            break;
                        }
                        if (newFrozen[k].tag === 'AI') {
                            newFrozen[k] = cleanAssistant;
                            aiUpdated = true;
                            break;
                        }
                    }
                }
                break;
            }
        }
    }

    for (let i = startIdx; i < historyTurns.length; i++) {
        const turn = historyTurns[i];
        newFrozen.push(turn.user);
        Logger.log(`[歷史-USER] 新歷史凍結: ${turn.user.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DEBUG);
        if (turn.assistant) {
            const cleanAssistant = stripPrefillFromAssistant(turn.assistant, state.lastPrefills || []);
            newFrozen.push(cleanAssistant);
            Logger.log(`[歷史-AI] 新歷史凍結: ${cleanAssistant.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DEBUG);
        }
    }

    // 3. 尾部追加新 SYS
    for (let sys of sysMsgsPool) {
        newFrozen.push(sys);
        Logger.log(`[SYS-追加] 提示詞已附加尾部: ${sys.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DETAILED);
    }

    return newFrozen;
}

// ==========================================
// 攔截器主程式 (KV Cache 前綴阻斷器)
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!Settings.enabled || data.dryRun) return;

    try {
        const chatKeyInfo = getChatKey();
        let state = getChatState(chatKeyInfo);

        Logger.log(`==============================`);
        Logger.log(`[請求] 處理存檔 | ${chatKeyInfo.label}`);

        if (!data?.chat?.length) return;
        const stream = data.chat;

        const { sysMsgs, historyTurns, currentTurn } = parseSTStream(stream);

        let rawFrozenSequence = buildSequence(state, sysMsgs, historyTurns, currentTurn);

        // SYS 嚴格去重
        let dedupedSequence = [];
        const seenSysNorms = new Set();
        for (const item of rawFrozenSequence) {
            if (item.tag === 'SYS') {
                if (seenSysNorms.has(item.norm)) {
                    Logger.log(`[SYS-去重] 攔截重複提示詞: ${item.content.substring(0, 30).replace(/\n/g, '')}...`, LogLevels.DETAILED);
                    continue; 
                }
                seenSysNorms.add(item.norm);
            }
            dedupedSequence.push(item);
        }

        // =======================================
        // 【核心】DeepSeek 嚴格前綴 KV Cache 命中計算
        // =======================================
        let requireResetConfirm = false;
        let similarityRatio = 1.0;

        if (state.lastSentSequence && state.lastSentSequence.length > 0) {
            let oldTotalLen = 0;
            let cacheHitLen = 0;
            
            for (const oldM of state.lastSentSequence) oldTotalLen += oldM.len;

            // 從第 0 項開始逐一比對，遇到任何斷層直接終止計算 (模擬 KV Cache 失效)
            for (let i = 0; i < Math.min(state.lastSentSequence.length, dedupedSequence.length); i++) {
                if (state.lastSentSequence[i].norm === dedupedSequence[i].norm) {
                    cacheHitLen += state.lastSentSequence[i].len;
                } else {
                    Logger.warn(`[斷點] 在第 ${i} 條提示詞偵測到變動，後續緩存全部失效！`, LogLevels.BASIC);
                    break;
                }
            }

            similarityRatio = oldTotalLen === 0 ? 1 : (cacheHitLen / oldTotalLen);

            if (similarityRatio < 0.90 && Settings.showResetPrompt) {
                requireResetConfirm = true;
            }
        }

        // 發送阻斷彈窗
        if (requireResetConfirm) {
            const dropPercent = ((1 - similarityRatio) * 100).toFixed(1);
            const msg = `🚨 [Deepseek KV 緩存阻斷] 🚨\n\n檢測到前排的系統提示詞、預設或世界書被修改/刪除！\n這將導致後續關聯的緩存全部作廢，命中率暴跌 ${dropPercent}%。\n\n▶ 點擊【確定】：攔截發送！重新排列提示詞 (完美保留所有對話歷史)。\n▶ 點擊【取消】：強行發送 (容忍本次緩存碎片化)。`;
            
            // confirm() 是同步的，會完美阻斷並掛起當前線程
            if (confirm(msg)) {
                Logger.warn(`[重置] 緩存降級 ${dropPercent}%，用戶選擇重置！重新初始化序列...`, LogLevels.BASIC);
                
                // 完美保留歷史的重置法：SYS 放最前，HISTORY 緊接其後
                let resetSequence = [];
                for (let sys of sysMsgs) resetSequence.push(sys);
                for (let turn of historyTurns) {
                    resetSequence.push(turn.user);
                    if (turn.assistant) resetSequence.push(turn.assistant);
                }
                
                dedupedSequence = [];
                seenSysNorms.clear();
                for (const item of resetSequence) {
                    if (item.tag === 'SYS') {
                        if (seenSysNorms.has(item.norm)) continue;
                        seenSysNorms.add(item.norm);
                    }
                    dedupedSequence.push(item);
                }
            } else {
                Logger.warn('[取消] 用戶拒絕重置，殘缺狀態強行發送', LogLevels.BASIC);
            }
        }

        // 保存並輸出
        state.frozenSequence = dedupedSequence;
        state.lastPrefills = currentTurn.prefills;

        const finalStream = [];
        for (const item of state.frozenSequence) finalStream.push({ role: item.role, content: item.content });
        
        if (currentTurn.user) {
            finalStream.push({ role: currentTurn.user.role, content: currentTurn.user.content });
            Logger.log(`[當前-USER] ${currentTurn.user.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DEBUG);
        }
        for (const p of currentTurn.prefills) {
            finalStream.push({ role: p.role, content: p.content });
            Logger.log(`[當前-預填充] ${p.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DEBUG);
        }

        state.lastSentSequence = dedupedSequence.concat(
            currentTurn.user ? [currentTurn.user] : [],
            currentTurn.prefills
        );
        safeSave();

        stream.splice(0, stream.length, ...finalStream);

    } catch (err) {
        Logger.error('攔截器發生錯誤', err);
        throw err;
    }
}

// ==========================================
// 即時修改提醒機制 (覆蓋 Select2 與 Modal)
// ==========================================
let warningTimeout = null;
function triggerWarning(msg, toggle) {
    if (!Settings.enabled || !toggle) return;
    if (warningTimeout) clearTimeout(warningTimeout);
    warningTimeout = setTimeout(() => {
        if (typeof toastr !== 'undefined') toastr.warning(msg, '⚠️ 緩存狀態變更', { timeOut: 3000 });
    }, 500); // 縮短延遲，讓彈窗更即時
}

// ==========================================
// 輔助 UI 與 初始化
// ==========================================
function renderChatsUI() {
    const container = $('#ds-chat-list-container');
    if (container.length === 0) return;
    container.empty();
    
    const keys = Object.keys(Settings.chats);
    if (keys.length === 0) {
        container.append('<p style="font-size:0.85em; opacity:0.6;">尚無接管的存檔數據。</p>');
        return;
    }

    keys.forEach(key => {
        const chat = Settings.chats[key];
        const html = `
            <div style="display:flex; justify-content:space-between; align-items:center; background:#222; padding:5px; margin-bottom:5px; border-radius:4px;">
                <span style="font-size:0.85em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:75%;" title="${chat.label}">
                    ${chat.label}
                </span>
                <button class="menu_button interactable ds-reset-btn" data-key="${key}" style="font-size:0.8em; padding:2px 5px;">重置此檔</button>
            </div>
        `;
        container.append(html);
    });

    container.find('.ds-reset-btn').on('click', function() {
        const key = $(this).data('key');
        delete Settings.chats[key];
        safeSave();
        renderChatsUI();
        if (typeof toastr !== 'undefined') toastr.success("已重置該存檔的緩存狀態");
        Logger.warn(`[管理] 手動清空存檔狀態: ${key}`, LogLevels.BASIC);
    });
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Deepseek 缓存优化 (v9.0 KV前綴阻斷版)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.85em;opacity:0.8;">嚴格 SYS 去重，KV Cache 前綴丟失阻斷器，多檔沙盒。</p>
                
                <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}> 啟用插件總開關</label>
                
                <div style="margin:5px 0 10px 15px; border-left: 2px solid #555; padding-left: 10px;">
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-sys" ${Settings.toastSys ? 'checked' : ''}> Presets/提示詞修改彈窗</label>
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-lore" ${Settings.toastLore ? 'checked' : ''}> 世界書修改彈窗</label>
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-his" ${Settings.toastHistory ? 'checked' : ''}> 歷史修改彈窗</label>
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-reset" ${Settings.showResetPrompt ? 'checked' : ''}> 10% KV 丟失阻斷確認窗</label>
                </div>
                
                <div style="margin:8px 0; display:flex; align-items:center;">
                    <span style="font-size:0.85em; margin-right:5px;">日誌等級:</span>
                    <select id="ds-cache-loglevel" class="text_pole" style="width:auto;">
                        <option value="0" ${Settings.logLevel===0?'selected':''}>關閉</option>
                        <option value="1" ${Settings.logLevel===1?'selected':''}>簡要</option>
                        <option value="2" ${Settings.logLevel===2?'selected':''}>詳細</option>
                        <option value="3" ${Settings.logLevel===3?'selected':''}>深度標籤解析</option>
                    </select>
                </div>

                <hr style="border-color:#444; margin:10px 0;">
                <b style="font-size:0.9em;">📂 存檔緩存管理區：</b>
                <div id="ds-chat-list-container" style="max-height:150px; overflow-y:auto; margin:5px 0; border:1px solid #444; padding:5px;"></div>
                
                <button id="ds-cache-factory-reset" class="menu_button" style="width:100%;margin:5px 0;background:#722;">⚠️ 廠級重置 (清空所有存檔數據)</button>
                <button id="ds-cache-clearlog" class="menu_button" style="width:100%;margin:5px 0;">🗑️ 清空日誌面板</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:250px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:10px;white-space:pre-wrap;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');

        $('#ds-cache-enable').on('change', function () { Settings.enabled = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-sys').on('change', function () { Settings.toastSys = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-lore').on('change', function () { Settings.toastLore = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-his').on('change', function () { Settings.toastHistory = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-reset').on('change', function () { Settings.showResetPrompt = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-loglevel').on('change', function () { Settings.logLevel = parseInt($(this).val()); safeSave(); });
        
        $('#ds-cache-factory-reset').on('click', () => {
            if (confirm("這將會清除所有角色卡與聊天存檔的 Deepseek 緩存狀態！確定嗎？")) {
                Settings.chats = {};
                safeSave();
                renderChatsUI();
                if (typeof toastr !== 'undefined') toastr.success("已完成廠級重置！");
                Logger.warn('[廠級重置] 所有存檔狀態已清空', LogLevels.BASIC);
            }
        });
        $('#ds-cache-clearlog').on('click', () => { if (Logger._uiTextarea) Logger._uiTextarea.value = ''; });
        
        renderChatsUI();
    } catch (e) {
        console.error('[DS Cache] UI初始化失敗', e);
    }
}

// ==========================================
// 啟動與全局事件綁定
// ==========================================
jQuery(async () => {
    try {
        initSettings(); 
        await setupUI();

        if (eventSource) {
            if (event_types?.CHAT_COMPLETION_PROMPT_READY) {
                eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
            }
            if (event_types?.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, () => triggerWarning('刪除歷史對話將引發緩存重組！', Settings.toastHistory));
            if (event_types?.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, () => triggerWarning('修改歷史對話將引發緩存重組！', Settings.toastHistory));
            if (event_types?.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, () => triggerWarning('切換歷史對話將引發緩存重組！', Settings.toastHistory));
        }

        // ===============================================
        // 深度掛載：確保 Chat Completion Presets 與世界書必彈窗
        // ===============================================
        
        // 1. Presets 下拉選單 (專門針對 Select2)
        $(document).on('change.select2 select2:select', '#chat_completion_preset, select[id*="preset"]', function() {
            triggerWarning('Chat Completion Presets 已變更！將影響緩存。', Settings.toastSys);
        });

        // 2. 文本框與一般 input
        const sysSelectors = '#main_prompt_textarea, #nsfw_prompt_textarea, #jailbreak_prompt_textarea, #rm_ch_sys_prompt, #author_note_textarea, #story_string_textarea';
        $(document).on('input change', sysSelectors, function() {
            triggerWarning('修改核心提示詞將更新對應的凍結位置！', Settings.toastSys);
        });

        // 3. 世界書深度掛載 (涵蓋彈窗、側邊欄、列表)
        const loreSelectors = '.world_info_entry textarea, .world_info_entry input, #world_info_entries_list textarea, #world_info_entries_list input, .lorebook_entry textarea, .lorebook_entry input, .drawer-content textarea';
        $(document).on('input change focusout', loreSelectors, function() {
            triggerWarning('修改世界書將更新對應的凍結位置！', Settings.toastLore);
        });

        Logger.log('══════ v9.0 KV前綴阻斷版 就緒 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件啟動嚴重崩潰:', e);
    }
});
