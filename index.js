import { extension_settings, getContext, saveSettingsDebounced } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 默認設定與持久化存儲 (v8.0)
// ==========================================
const defaultSettings = {
    enabled: true,
    toastSys: true,
    toastLore: true,
    toastHistory: true,
    showResetPrompt: true,
    logLevel: 3,
    chats: {} // 存放所有角色卡與存檔的獨立狀態
};

if (!extension_settings.ds_cache_v8) {
    extension_settings.ds_cache_v8 = defaultSettings;
}
const Settings = extension_settings.ds_cache_v8;

// ==========================================
// 日誌系統 (神級標籤強化)
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function logAt(level, type, msg) {
    if (Settings.logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const fullMsg = `[${time}] ${msg}`;
    if (type === 'warn') {
        console.warn(`%c[DS Cache v8.0] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS Cache v8.0] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS Cache v8.0] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
        charName = context.characters[context.characterId].name;
    }
    let chatId = context.chatId || "default_chat";
    let groupId = context.groupId;
    
    if (groupId) {
        return { key: `group_${groupId}_${chatId}`, label: `群組: ${chatId}` };
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
        saveSettingsDebounced();
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
        tag: tag // 'SYS', 'USER', 'AI', 'PREFILL'
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
// 解析 ST 數據流 (嚴格分類打標)
// ==========================================
function parseSTStream(stream) {
    const sysMsgs = [];
    const chatMsgs = [];

    // 第一階段：粗分類
    for (const msg of stream) {
        const isSys = (msg.role === 'system' || (msg.role !== 'user' && msg.role !== 'assistant'));
        if (isSys) sysMsgs.push(createMsg(msg, 'SYS'));
        else chatMsgs.push(createMsg(msg, msg.role === 'user' ? 'USER' : 'AI'));
    }

    // 尋找當前對話分界點
    let lastUserIdx = -1;
    for (let i = chatMsgs.length - 1; i >= 0; i--) {
        if (chatMsgs[i].tag === 'USER') { lastUserIdx = i; break; }
    }

    let historyTurns = [];
    let currentTurn = { user: null, prefills: [] };

    // 區分歷史與當前
    if (lastUserIdx === -1) {
        currentTurn.prefills = chatMsgs.filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'}));
    } else {
        const hMsgs = chatMsgs.slice(0, lastUserIdx);
        const cMsgs = chatMsgs.slice(lastUserIdx);

        currentTurn.user = cMsgs[0]; // USER
        currentTurn.prefills = cMsgs.slice(1).filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'}));

        let curUser = null;
        let curAiContents = [];
        for (const msg of hMsgs) {
            if (msg.tag === 'USER') {
                if (curUser) {
                    historyTurns.push({ user: curUser, assistant: curAiContents.length ? createMsg({role: 'assistant', content: curAiContents.join('\n')}, 'AI') : null });
                }
                curUser = msg;
                curAiContents = [];
            } else if (msg.tag === 'AI') {
                curAiContents.push(msg.content);
            }
        }
        if (curUser) {
            historyTurns.push({ user: curUser, assistant: curAiContents.length ? createMsg({role: 'assistant', content: curAiContents.join('\n')}, 'AI') : null });
        }
    }
    return { sysMsgs, historyTurns, currentTurn };
}

// ==========================================
// 核心：平鋪同步演算法
// ==========================================
function buildSequence(state, sysMsgs, historyTurns, currentTurn) {
    const sysMsgsPool = [...sysMsgs];
    const newFrozen = [];

    // 1. 原位更新或移除已凍結的 SYS 與保留歷史
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
                Logger.log(`[SYS-修改] 原位更新 (相似度 ${(bestScore*100).toFixed(1)}%): ${matchedItem.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DETAILED);
            } else {
                Logger.log(`[SYS-刪除] 檢測到提示詞被刪除，抽出上移: ${item.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DETAILED);
            }
        } else {
            // 保留歷史
            newFrozen.push(item);
        }
    }

    // 2. 處理歷史對話追加與 AI 補全
    let lastFrozenUserNorm = null;
    for (let i = newFrozen.length - 1; i >= 0; i--) {
        if (newFrozen[i].tag === 'USER') { lastFrozenUserNorm = newFrozen[i].norm; break; }
    }

    let startIdx = 0;
    if (lastFrozenUserNorm) {
        for (let i = 0; i < historyTurns.length; i++) {
            if (historyTurns[i].user.norm === lastFrozenUserNorm) {
                startIdx = i + 1;
                // 補全 AI
                if (historyTurns[i].assistant) {
                    const cleanAssistant = stripPrefillFromAssistant(historyTurns[i].assistant, state.lastPrefills || []);
                    let aiUpdated = false;
                    for (let k = newFrozen.length - 1; k >= 0; k--) {
                        if (newFrozen[k].tag === 'SYS') break;
                        if (newFrozen[k].tag === 'USER') {
                            if (!aiUpdated) {
                                newFrozen.splice(k + 1, 0, cleanAssistant);
                                Logger.log(`[歷史-AI] AI回覆已徹底凍結: ${cleanAssistant.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DEBUG);
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

    // 追加新一輪歷史
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

    // 3. 新增的提示詞 (世界書/預設) 嚴格附加於尾部
    for (let sys of sysMsgsPool) {
        newFrozen.push(sys);
        Logger.log(`[SYS-追加] 全新提示詞已附加於尾部: ${sys.content.substring(0,30).replace(/\n/g, '')}...`, LogLevels.DETAILED);
    }

    return newFrozen;
}

// ==========================================
// 攔截器：10%檢測、嚴格去重、輸出發送
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!Settings.enabled || data.dryRun) return;

    try {
        const chatKeyInfo = getChatKey();
        let state = getChatState(chatKeyInfo);

        Logger.log(`==============================`);
        Logger.log(`[請求] 開始構建緩存前綴 | ${chatKeyInfo.label}`);

        if (!data?.chat?.length) return;
        const stream = data.chat;

        const { sysMsgs, historyTurns, currentTurn } = parseSTStream(stream);

        // 構建平鋪序列
        let rawFrozenSequence = buildSequence(state, sysMsgs, historyTurns, currentTurn);

        // =======================================
        // 嚴格去重邏輯 (僅限 SYS，容忍 USER/AI/PREFILL)
        // =======================================
        let dedupedSequence = [];
        const seenSysNorms = new Set();
        
        for (const item of rawFrozenSequence) {
            if (item.tag === 'SYS') {
                if (seenSysNorms.has(item.norm)) {
                    Logger.log(`[SYS-去重] 成功攔截並剔除重複提示詞: ${item.content.substring(0, 30).replace(/\n/g, '')}...`, LogLevels.DETAILED);
                    continue; 
                }
                seenSysNorms.add(item.norm);
            }
            dedupedSequence.push(item);
        }

        // =======================================
        // 10% 緩存丟失檢測 (保留歷史重置)
        // =======================================
        let requireResetConfirm = false;
        let similarityRatio = 1.0;

        if (state.lastSentSequence && state.lastSentSequence.length > 0) {
            let oldTotalLen = 0;
            let matchedLen = 0;
            const newNorms = new Set(dedupedSequence.map(m => m.norm));
            
            for (const oldM of state.lastSentSequence) {
                oldTotalLen += oldM.len;
                if (newNorms.has(oldM.norm)) matchedLen += oldM.len;
            }
            similarityRatio = oldTotalLen === 0 ? 1 : (matchedLen / oldTotalLen);

            if (similarityRatio < 0.90 && Settings.showResetPrompt) {
                requireResetConfirm = true;
            }
        }

        if (requireResetConfirm) {
            const dropPercent = ((1 - similarityRatio) * 100).toFixed(1);
            const msg = `🚨 [Deepseek 緩存阻斷器] 🚨\n\n檢測到預設提示詞或世界書被大幅度修改/刪除！\n這將導致緩存命中率暴跌 ${dropPercent}%。\n\n▶ 點擊【確定】：重置系統提示詞排列 (完美保留所有歷史對話！強烈推薦)。\n▶ 點擊【取消】：強行發送 (容忍本次緩存碎片化)。`;
            const ok = confirm(msg);
            
            if (ok) {
                Logger.warn(`[用戶選擇重置] 緩存降級 ${dropPercent}%，清空凍結陣列並保留歷史重構...`, LogLevels.BASIC);
                // 核心：清空 frozenSequence，重新運行 buildSequence，這樣所有的歷史會被當作新的追加進去，完美保留！
                state.frozenSequence = [];
                rawFrozenSequence = buildSequence(state, sysMsgs, historyTurns, currentTurn);
                
                dedupedSequence = [];
                seenSysNorms.clear();
                for (const item of rawFrozenSequence) {
                    if (item.tag === 'SYS') {
                        if (seenSysNorms.has(item.norm)) continue;
                        seenSysNorms.add(item.norm);
                    }
                    dedupedSequence.push(item);
                }
            } else {
                Logger.warn('[用戶選擇取消] 拒絕重置，以殘缺狀態強行發送', LogLevels.BASIC);
            }
        }

        // =======================================
        // 最終保存與覆蓋 ST 數據流
        // =======================================
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
        saveSettingsDebounced();

        stream.splice(0, stream.length, ...finalStream);

    } catch (err) {
        Logger.error('攔截器發生錯誤', err);
        throw err;
    }
}

// ==========================================
// 即時修改提醒機制 (Debounce + 增強 DOM Delegation)
// ==========================================
let warningTimeout = null;
function triggerWarning(msg, toggle) {
    if (!Settings.enabled || !toggle) return;
    if (warningTimeout) clearTimeout(warningTimeout);
    warningTimeout = setTimeout(() => {
        if (typeof toastr !== 'undefined') toastr.warning(msg, '⚠️ 緩存狀態變更', { timeOut: 3000 });
    }, 1000);
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
                <button class="menu_button interactable" data-key="${key}" style="font-size:0.8em; padding:2px 5px;">重置此檔</button>
            </div>
        `;
        container.append(html);
    });

    container.find('button').on('click', function() {
        const key = $(this).data('key');
        delete Settings.chats[key];
        saveSettingsDebounced();
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
                <b>Deepseek 缓存优化 (v8.0 多檔沙盒版)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.85em;opacity:0.8;">嚴格 SYS 去重，10% 防丟失阻斷，多角色存檔互不干涉。</p>
                
                <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}> 啟用插件總開關</label>
                
                <div style="margin:5px 0 10px 15px; border-left: 2px solid #555; padding-left: 10px;">
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-sys" ${Settings.toastSys ? 'checked' : ''}> Presets/提示詞修改彈窗</label>
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-lore" ${Settings.toastLore ? 'checked' : ''}> 世界書修改彈窗</label>
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-his" ${Settings.toastHistory ? 'checked' : ''}> 歷史修改彈窗</label>
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-reset" ${Settings.showResetPrompt ? 'checked' : ''}> 10% 命中丟失阻斷確認窗</label>
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

        $('#ds-cache-enable').on('change', function () { Settings.enabled = $(this).is(':checked'); saveSettingsDebounced(); });
        $('#ds-toast-sys').on('change', function () { Settings.toastSys = $(this).is(':checked'); saveSettingsDebounced(); });
        $('#ds-toast-lore').on('change', function () { Settings.toastLore = $(this).is(':checked'); saveSettingsDebounced(); });
        $('#ds-toast-his').on('change', function () { Settings.toastHistory = $(this).is(':checked'); saveSettingsDebounced(); });
        $('#ds-toast-reset').on('change', function () { Settings.showResetPrompt = $(this).is(':checked'); saveSettingsDebounced(); });
        $('#ds-cache-loglevel').on('change', function () { Settings.logLevel = parseInt($(this).val()); saveSettingsDebounced(); });
        
        $('#ds-cache-factory-reset').on('click', () => {
            if (confirm("這將會清除所有角色卡與聊天存檔的 Deepseek 緩存狀態！確定嗎？")) {
                Settings.chats = {};
                saveSettingsDebounced();
                renderChatsUI();
                if (typeof toastr !== 'undefined') toastr.success("已完成廠級重置！");
                Logger.warn('[廠級重置] 所有存檔狀態已清空', LogLevels.BASIC);
            }
        });
        $('#ds-cache-clearlog').on('click', () => { if (Logger._uiTextarea) Logger._uiTextarea.value = ''; });
        
        renderChatsUI();
    } catch (e) {
        Logger.error('UI初始化失敗', e);
    }
}

function registerMenuItems() {
    const wandMenu = $('#extensionsMenu');
    if (wandMenu.length > 0 && $('#wand-ds-cache-reset').length === 0) {
        const menuItem = $('<div id="wand-ds-cache-reset" class="list-group-item extensionsMenu-item" style="cursor:pointer;"><i class="fa-solid fa-rotate-right"></i> 重置當前存檔 DS 緩存</div>');
        menuItem.on('click', () => {
            const key = getChatKey().key;
            delete Settings.chats[key];
            saveSettingsDebounced();
            renderChatsUI();
            if (typeof toastr !== 'undefined') toastr.success("已重置當前存檔的緩存狀態");
            $('#extensionsMenu').slideUp(100);
        });
        wandMenu.append(menuItem);
    }
}

// ==========================================
// 啟動與全局事件綁定
// ==========================================
jQuery(async () => {
    await setupUI();
    setTimeout(registerMenuItems, 2000); 

    if (eventSource) {
        if (event_types?.CHAT_COMPLETION_PROMPT_READY) {
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        }
        if (event_types?.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, () => triggerWarning('刪除歷史對話將引發緩存重組！', Settings.toastHistory));
        if (event_types?.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, () => triggerWarning('修改歷史對話將引發緩存重組！', Settings.toastHistory));
        if (event_types?.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, () => triggerWarning('切換歷史對話將引發緩存重組！', Settings.toastHistory));
    }

    // 全局深度監聽：涵蓋 Chat Completion Presets 與其他提示詞
    const sysSelectors = '#chat_completion_preset, select[id*="preset"], #main_prompt_textarea, #nsfw_prompt_textarea, #jailbreak_prompt_textarea, #rm_ch_sys_prompt, #author_note_textarea, #story_string_textarea';
    $(document).on('input change', sysSelectors, function() {
        triggerWarning('修改 Presets 或提示詞將更新對應的凍結位置！', Settings.toastSys);
    });

    const loreSelectors = '.world_info_entry textarea, .world_info_entry input, #world_info_entries_list textarea, #world_info_entries_list input';
    $(document).on('input change', loreSelectors, function() {
        triggerWarning('修改世界書將更新對應的凍結位置！', Settings.toastLore);
    });
    
    Logger.log('══════ v8.0 多檔沙盒版 就緒 ══════', LogLevels.BASIC);
});
