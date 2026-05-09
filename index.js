import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 狀態與設定
// ==========================================
let Settings = {};

function initSettings() {
    if (!extension_settings.ds_cache_v10) {
        extension_settings.ds_cache_v10 = {
            enabled: true,
            toastSys: true,
            toastLore: true,
            toastHistory: true,
            showResetPrompt: true,
            logLevel: 3,
            chats: {} 
        };
    }
    Settings = extension_settings.ds_cache_v10;
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
// 日誌系統
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function logAt(level, type, msg) {
    if (Settings.logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const fullMsg = `[${time}] ${msg}`;
    if (type === 'warn') {
        console.warn(`%c[DS Cache v10.1] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS Cache v10.1] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS Cache v10.1] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
// 狀態管理
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
    
    if (groupId) return { key: `group_${groupId}_${chatId}`, label: `群組: ${chatId}` };
    return { key: `char_${context.characterId}_${chatId}`, label: `角色: ${charName} | 存檔: ${chatId}` };
}

function getChatState(chatKeyInfo) {
    if (!Settings.chats[chatKeyInfo.key]) {
        Settings.chats[chatKeyInfo.key] = { label: chatKeyInfo.label, frozenSequence: [], lastSentSequence: [], lastPrefills: [] };
        safeSave();
        renderChatsUI();
    }
    return Settings.chats[chatKeyInfo.key];
}

// ==========================================
// 核心工具
// ==========================================
function createMsg(msg, tag) {
    const content = msg.content || '';
    return { role: msg.role, content: content, norm: Logger.normalize(content), len: content.length, tag: tag };
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
    for (let i = 0; i < s2.length - 1; i++) if (bigrams.has(s2.substring(i, i+2))) matchCount++;
    const union = (s1.length - 1) + (s2.length - 1) - matchCount;
    return union <= 0 ? 1 : matchCount / union;
}

function stripPrefillFromAssistant(assistantObj, prefills) {
    if (!assistantObj || !prefills || prefills.length === 0) return assistantObj;
    let content = assistantObj.content || '';
    let modified = false;
    for (const p of prefills) {
        const pContent = p.content || '';
        if (content.startsWith(pContent)) { content = content.substring(pContent.length); modified = true; }
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
    for (let i = chatMsgs.length - 1; i >= 0; i--) { if (chatMsgs[i].tag === 'USER') { lastUserIdx = i; break; } }

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
            } else if (msg.tag === 'AI') curAiContents.push(msg.content);
        }
        if (curUser) historyTurns.push({ user: curUser, assistant: curAiContents.length ? createMsg({role: 'assistant', content: curAiContents.join('\n')}, 'AI') : null });
    }
    return { sysMsgs, historyTurns, currentTurn };
}

// ==========================================
// 異步 UI 攔截器
// ==========================================
function askUserForResetAsync(dropPercent) {
    return new Promise(resolve => {
        const overlay = $('<div style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);z-index:999999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px);"></div>');
        const box = $('<div style="background:#1e1e1e;border:2px solid #f44336;padding:25px;border-radius:12px;max-width:550px;text-align:center;color:#fff;font-size:15px;box-shadow: 0 10px 25px rgba(0,0,0,0.8);font-family:sans-serif;"></div>');
        
        const title = $('<h2 style="color:#f44336;margin-top:0;">🚨 緩存嚴重斷裂預警 🚨</h2>');
        const text = $(`<p style="text-align:left;line-height:1.6;font-size:14px;">檢測到前排的 <b>提示詞或歷史對話</b> 發生了人為變更。<br><br>這將導致 KV 緩存鏈條斷裂，預計 <b>${dropPercent}%</b> 的歷史對話緩存將全部被冤枉失效 (需重新運算)！<br><br>請問您要如何處理？</p>`);
        
        const btnContainer = $('<div style="margin-top:25px;display:flex;justify-content:space-between;gap:10px;"></div>');
        
        const btnReset = $('<button style="flex:1;background:#4CAF50;color:white;padding:12px;border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-size:14px;transition:0.2s;">🔄 完美重置排列<br><span style="font-size:11px;font-weight:normal;">(清除碎片，重新排列)</span></button>');
        const btnAbort = $('<button style="flex:1;background:#f44336;color:white;padding:12px;border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-size:14px;transition:0.2s;">🛑 攔截發送<br><span style="font-size:11px;font-weight:normal;">(中止生成，去復原提示詞)</span></button>');
        const btnIgnore = $('<button style="flex:1;background:#555;color:white;padding:12px;border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-size:14px;transition:0.2s;">⚠️ 強行發送<br><span style="font-size:11px;font-weight:normal;">(容忍緩存重新運算)</span></button>');

        [btnReset, btnAbort, btnIgnore].forEach(b => b.hover(function(){$(this).css('opacity','0.8')}, function(){$(this).css('opacity','1')}));

        btnReset.click(() => { overlay.remove(); resolve('reset'); });
        btnAbort.click(() => { overlay.remove(); resolve('abort'); });
        btnIgnore.click(() => { overlay.remove(); resolve('ignore'); });

        btnContainer.append(btnReset, btnAbort, btnIgnore);
        box.append(title, text, btnContainer);
        overlay.append(box);
        $('body').append(overlay);
    });
}

// ==========================================
// 核心處理器 (異步)
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (!Settings.enabled || data.dryRun) return;

    try {
        const chatKeyInfo = getChatKey();
        let state = getChatState(chatKeyInfo);
        if (!data?.chat?.length) return;
        const stream = data.chat;

        const { sysMsgs, historyTurns, currentTurn } = parseSTStream(stream);

        // 構建平鋪對比序列
        let rawFrozenSequence = [];
        const sysMsgsPool = [...sysMsgs];
        
        for (let i = 0; i < state.frozenSequence.length; i++) {
            const item = state.frozenSequence[i];
            if (item.tag === 'SYS') {
                let bestIdx = -1, bestScore = 0;
                for (let j = 0; j < sysMsgsPool.length; j++) {
                    const score = getSimilarity(item.norm, sysMsgsPool[j].norm);
                    if (score > bestScore) { bestScore = score; bestIdx = j; }
                }
                if (bestScore === 1) { rawFrozenSequence.push(item); sysMsgsPool.splice(bestIdx, 1); }
                else if (bestScore > 0.6) { rawFrozenSequence.push(sysMsgsPool[bestIdx]); sysMsgsPool.splice(bestIdx, 1); }
            } else { rawFrozenSequence.push(item); }
        }

        let lastFrozenUserNorm = [...rawFrozenSequence].reverse().find(m => m.tag === 'USER')?.norm;
        let startIdx = 0;
        if (lastFrozenUserNorm) {
            for (let i = 0; i < historyTurns.length; i++) {
                if (historyTurns[i].user.norm === lastFrozenUserNorm) {
                    startIdx = i + 1;
                    if (historyTurns[i].assistant) {
                        const cleanAssistant = stripPrefillFromAssistant(historyTurns[i].assistant, state.lastPrefills || []);
                        for (let k = rawFrozenSequence.length - 1; k >= 0; k--) {
                            if (rawFrozenSequence[k].tag === 'SYS') break;
                            if (rawFrozenSequence[k].tag === 'AI') { rawFrozenSequence[k] = cleanAssistant; break; }
                            if (rawFrozenSequence[k].tag === 'USER') { rawFrozenSequence.splice(k + 1, 0, cleanAssistant); break; }
                        }
                    }
                    break;
                }
            }
        }

        for (let i = startIdx; i < historyTurns.length; i++) {
            rawFrozenSequence.push(historyTurns[i].user);
            if (historyTurns[i].assistant) rawFrozenSequence.push(stripPrefillFromAssistant(historyTurns[i].assistant, state.lastPrefills || []));
        }
        for (let sys of sysMsgsPool) rawFrozenSequence.push(sys);

        // 去重
        let dedupedSequence = [];
        const seenSysNorms = new Set();
        for (const item of rawFrozenSequence) {
            if (item.tag === 'SYS') {
                if (seenSysNorms.has(item.norm)) continue;
                seenSysNorms.add(item.norm);
            }
            dedupedSequence.push(item);
        }

        const proposedStream = [...dedupedSequence];
        if (currentTurn.user) proposedStream.push(currentTurn.user);
        for (const p of currentTurn.prefills) proposedStream.push(p);

        // =========================================================
        // 【v10.1 智能防誤報 KV 緩存斷裂計算器】
        // =========================================================
        let requireResetConfirm = false;
        let dropPercentStr = "0.0";

        if (state.lastSentSequence && state.lastSentSequence.length > 0) {
            const L = state.lastSentSequence;
            const P = proposedStream;

            // 尋找第一個斷點 (防誤報：使用 norm 比對，無視空格變動)
            let breakIndex = -1;
            for (let i = 0; i < Math.min(L.length, P.length); i++) {
                if (L[i].role !== P[i].role || L[i].norm !== P[i].norm) {
                    breakIndex = i;
                    break;
                }
            }
            if (breakIndex === -1) breakIndex = P.length;

            let isPureContextShift = false;
            
            // 嗅探：這是否只是一個不可抗力的自然上下文推移？
            if (breakIndex < L.length && breakIndex < P.length) {
                // 確認斷點是否發生在「歷史區的最開端」(代表舊歷史被擠出)
                let isAtHistoryStart = true;
                for (let i = 0; i < breakIndex; i++) {
                    if (L[i].tag !== 'SYS' && L[i].role !== 'system') {
                        isAtHistoryStart = false;
                        break;
                    }
                }

                if (isAtHistoryStart) {
                    // 確認被刪除的段落中，不包含任何 System / 世界書 提示詞
                    for (let x = breakIndex + 1; x < L.length; x++) {
                        if (L[x].role === P[breakIndex].role && L[x].norm === P[breakIndex].norm) {
                            let deletedBlocks = L.slice(breakIndex, x);
                            let deletedSys = deletedBlocks.filter(m => m.tag === 'SYS' || m.role === 'system');
                            if (deletedSys.length === 0) {
                                isPureContextShift = true; // 完全是正常的對話推移，無需彈窗！
                            }
                            break;
                        }
                    }
                }
            }

            // 計算因為前綴斷裂，導致後續有多少本來存在的 Token 被「冤枉」重新計算
            let wastedTokensLen = 0;
            let proposedTotalLen = 0;
            for (let i = 0; i < P.length; i++) {
                proposedTotalLen += (P[i].content?.length || 0);
                if (i >= breakIndex) {
                    let foundInL = L.some(oldM => oldM.role === P[i].role && oldM.norm === P[i].norm);
                    if (foundInL) {
                        wastedTokensLen += (P[i].content?.length || 0);
                    }
                }
            }

            if (isPureContextShift) {
                wastedTokensLen = 0; // 免除懲罰
                Logger.log(`[緩存分析] 偵測到自然對話推移 (Context Shift)，智能抑制彈窗`, LogLevels.DEBUG);
            }

            let dropRatio = proposedTotalLen === 0 ? 0 : (wastedTokensLen / proposedTotalLen);
            
            if (dropRatio > 0.10 && Settings.showResetPrompt) {
                requireResetConfirm = true;
                dropPercentStr = (dropRatio * 100).toFixed(1);
            }
        }

        // 觸發異步攔截彈窗
        let decision = 'ignore';
        if (requireResetConfirm) {
            Logger.warn(`檢測到緩存流失 ${dropPercentStr}%，掛起生成進程，等待用戶指示...`, LogLevels.BASIC);
            decision = await askUserForResetAsync(dropPercentStr);
        }

        // 【決策處理】
        if (decision === 'abort') {
            Logger.warn('[發送已攔截] 清空流數據以強制中止生成', LogLevels.BASIC);
            if (typeof toastr !== 'undefined') toastr.error("已強制攔截本次請求！您可以去還原提示詞了。", "緩存防護");
            stream.splice(0, stream.length); 
            return;
        }

        if (decision === 'reset') {
            Logger.warn('[完美重置] 重新將系統提示詞推至頂部，拼接完整歷史...', LogLevels.BASIC);
            let resetSequence = [];
            for (let sys of sysMsgs) resetSequence.push(sys);
            for (let turn of historyTurns) {
                resetSequence.push(turn.user);
                if (turn.assistant) resetSequence.push(turn.assistant);
            }
            dedupedSequence = [];
            seenSysNorms.clear();
            for (let item of resetSequence) {
                if (item.tag === 'SYS') {
                    if (seenSysNorms.has(item.norm)) continue;
                    seenSysNorms.add(item.norm);
                }
                dedupedSequence.push(item);
            }
        }

        // 寫入最終狀態
        state.frozenSequence = dedupedSequence;
        state.lastPrefills = currentTurn.prefills;

        const finalStream = [...state.frozenSequence];
        if (currentTurn.user) finalStream.push(currentTurn.user);
        for (const p of currentTurn.prefills) finalStream.push(p);

        state.lastSentSequence = finalStream;
        safeSave();

        // 覆蓋回 ST 數據流
        stream.splice(0, stream.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
        Logger.log('準備發送最終整理數據', LogLevels.BASIC);

    } catch (err) {
        Logger.error('攔截器發生錯誤', err);
        throw err;
    }
}

// ==========================================
// 提醒機制與 UI
// ==========================================
let warningTimeout = null;
function triggerWarning(msg, toggle) {
    if (!Settings.enabled || !toggle) return;
    if (warningTimeout) clearTimeout(warningTimeout);
    warningTimeout = setTimeout(() => {
        if (typeof toastr !== 'undefined') toastr.warning(msg, '⚠️ 提示詞狀態變更', { timeOut: 3000 });
    }, 300); 
}

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
                <button class="menu_button interactable ds-reset-btn" data-key="${key}" style="font-size:0.8em; padding:2px 5px;">重置</button>
            </div>
        `;
        container.append(html);
    });

    container.find('.ds-reset-btn').on('click', function() {
        const key = $(this).data('key');
        delete Settings.chats[key];
        safeSave();
        renderChatsUI();
        if (typeof toastr !== 'undefined') toastr.success("已重置該存檔");
    });
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Deepseek 缓存优化 (v10.1 智能防誤報版)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}> 啟用插件</label>
                
                <div style="margin:5px 0 10px 15px; border-left: 2px solid #555; padding-left: 10px;">
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-sys" ${Settings.toastSys ? 'checked' : ''}> Presets/提示詞修改彈窗</label>
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-lore" ${Settings.toastLore ? 'checked' : ''}> 世界書修改彈窗</label>
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-his" ${Settings.toastHistory ? 'checked' : ''}> 歷史對話修改彈窗</label>
                    <label class="checkbox_label" style="font-size:0.85em;"><input type="checkbox" id="ds-toast-reset" ${Settings.showResetPrompt ? 'checked' : ''}> 10% 異步攔截阻斷器</label>
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
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:150px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:10px;white-space:pre-wrap;"></textarea>
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
            if (confirm("清除所有存檔的緩存狀態？")) { Settings.chats = {}; safeSave(); renderChatsUI(); }
        });
        
        renderChatsUI();
    } catch (e) { console.error('[DS Cache] UI初始化失敗', e); }
}

jQuery(async () => {
    try {
        initSettings(); 
        await setupUI();

        if (eventSource) {
            if (event_types?.CHAT_COMPLETION_PROMPT_READY) {
                eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
            }
            if (event_types?.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, () => triggerWarning('手動刪除歷史對話將引發緩存重組！', Settings.toastHistory));
            if (event_types?.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, () => triggerWarning('修改歷史對話將引發緩存重組！', Settings.toastHistory));
        }

        $(document).on('change select2:select input focusout', '#chat_completion_preset, .preset_select, select[id*="preset"], #main_prompt_textarea, #nsfw_prompt_textarea, #jailbreak_prompt_textarea, #rm_ch_sys_prompt', function() {
            triggerWarning('提示詞已變更！將影響緩存。', Settings.toastSys);
        });

        $(document).on('input change focusout', '.world_info_entry textarea, .world_info_entry input, #world_info_entries_list textarea, .lorebook_entry textarea, .drawer-content textarea', function() {
            triggerWarning('修改世界書將影響後續緩存！', Settings.toastLore);
        });

        Logger.log('══════ v10.1 智能防誤報版 就緒 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件啟動崩潰:', e);
    }
});
