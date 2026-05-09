import { extension_settings, getContext, saveSettingsDebounced } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 全局設置與持久化存儲 (Profiles)
// ==========================================
const SETTINGS_KEY = 'dsCacheOpt_v8';
if (!extension_settings[SETTINGS_KEY]) {
    extension_settings[SETTINGS_KEY] = {
        enabled: true,
        toastSys: true, toastLore: true, toastHistory: true, showResetPrompt: true,
        logLevel: 3,
        profiles: {} // 記錄所有角色卡的獨立聊天檔案
    };
}
const settings = extension_settings[SETTINGS_KEY];
function saveSettings() { if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced(); }

// 獲取當前獨立的聊天檔案 (Chat Profile)
function getCurrentProfile() {
    const ctx = getContext();
    const chatId = ctx.chatId || 'default_chat_id';
    
    if (!settings.profiles[chatId]) {
        let charName = "未知角色";
        if (ctx.characters && ctx.characters.length > 0) charName = ctx.characters[0].name;
        else if (ctx.name2) charName = ctx.name2;

        settings.profiles[chatId] = {
            charName: charName,
            chatId: chatId,
            frozenSequence: [],   
            lastSentSequence: [], 
            lastPrefills: []      
        };
        saveSettings();
    }
    return settings.profiles[chatId];
}

// ==========================================
// 日誌系統 (深度強化版)
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function logAt(level, type, msg) {
    if (settings.logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const ctx = getContext();
    const chatInfo = ctx.chatId ? `[${ctx.chatId.substring(0,8)}] ` : '';
    const fullMsg = `[${time}] ${chatInfo}${msg}`;
    
    if (type === 'warn') console.warn(`%c[DS Cache v8.0] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    else if (type === 'error') console.error(`[DS Cache v8.0] 🔴 ${msg}`);
    else console.log(`%c[DS Cache v8.0] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
    
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
// 工具：相似度與消息分類
// ==========================================
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

function classifyMsgLog(msg, type) {
    if (settings.logLevel < LogLevels.DEBUG) return;
    const labels = { 'sys': '📋系統/設定', 'user': '👤真實用戶', 'ai': '🤖真實AI' };
    let snippet = msg.content.replace(/\n/g, ' ');
    if (snippet.length > 40) snippet = snippet.substring(0, 40) + '...';
    Logger.log(`[解析] ${labels[type]} | ${snippet}`, LogLevels.DEBUG);
}

function createMsg(msg, type) {
    return { role: msg.role, content: msg.content, norm: Logger.normalize(msg.content), type: type };
}

function stripPrefillFromAssistant(assistantObj, prefills) {
    if (!assistantObj || !prefills || prefills.length === 0) return assistantObj;
    let content = assistantObj.content || '';
    let modified = false;
    for (const p of prefills) {
        if (content.startsWith(p.content)) { content = content.substring(p.content.length); modified = true; }
    }
    if (modified) {
        content = content.replace(/^[\s\n]+/, ''); 
        return { ...assistantObj, content: content, norm: Logger.normalize(content) };
    }
    return assistantObj;
}

// ==========================================
// 核心演算法：解析、去重與生成新序列
// ==========================================
function parseSTStream(stream) {
    const sysMsgs = [];
    const chatMsgs = [];
    const seenSysNorms = new Set();

    Logger.log(`[流程] 開始嚴格解析與分類數據流...`, LogLevels.DEBUG);
    for (const msg of stream) {
        const isSys = (msg.role === 'system' || (msg.role !== 'user' && msg.role !== 'assistant'));
        if (isSys) {
            const norm = Logger.normalize(msg.content);
            // 嚴格限制系統提示詞/世界書不能重複
            if (!seenSysNorms.has(norm)) {
                seenSysNorms.add(norm);
                sysMsgs.push(createMsg(msg, 'sys'));
                classifyMsgLog(msg, 'sys');
            }
        } else {
            const type = msg.role === 'user' ? 'user' : 'ai';
            chatMsgs.push(createMsg(msg, type));
            classifyMsgLog(msg, type);
        }
    }

    // 嚴格準確分類：歷史用戶、歷史AI、當前用戶、預填充
    let lastUserIdx = -1;
    for (let i = chatMsgs.length - 1; i >= 0; i--) {
        if (chatMsgs[i].type === 'user') { lastUserIdx = i; break; }
    }

    let stHistoryTurns = [];
    let stCurrentTurn = { user: null, prefills: [] };

    if (lastUserIdx === -1) {
        stCurrentTurn.prefills = chatMsgs.filter(m => m.type === 'ai');
    } else {
        const historyMsgs = chatMsgs.slice(0, lastUserIdx);
        const currentMsgs = chatMsgs.slice(lastUserIdx);

        stCurrentTurn.user = currentMsgs[0];
        stCurrentTurn.prefills = currentMsgs.slice(1).filter(m => m.type === 'ai');

        let curUser = null; let curAiContents = [];
        for (const msg of historyMsgs) {
            if (msg.type === 'user') {
                if (curUser) stHistoryTurns.push({ user: curUser, assistant: curAiContents.length ? { role: 'assistant', content: curAiContents.join('\n') } : null });
                curUser = msg; curAiContents = [];
            } else if (msg.type === 'ai') {
                curAiContents.push(msg.content);
            }
        }
        if (curUser) stHistoryTurns.push({ user: curUser, assistant: curAiContents.length ? { role: 'assistant', content: curAiContents.join('\n') } : null });
    }
    return { sysMsgs, stHistoryTurns, stCurrentTurn };
}

function buildIntendedSequence(profile, sysMsgs, stHistoryTurns, stCurrentTurn) {
    const sysMsgsPool = [...sysMsgs];
    const newFrozen = [];
    const globalSeenSys = new Set(); // 用於全局嚴格去重系統提示詞

    // 1. 原位更新或移除已凍結的訊息
    for (let i = 0; i < profile.frozenSequence.length; i++) {
        const item = profile.frozenSequence[i];
        
        if (item.type === 'sys') {
            let bestIdx = -1; let bestScore = 0;
            for (let j = 0; j < sysMsgsPool.length; j++) {
                const score = getSimilarity(item.norm, sysMsgsPool[j].norm);
                if (score > bestScore) { bestScore = score; bestIdx = j; }
            }
            if (bestScore === 1) {
                if (!globalSeenSys.has(item.norm)) {
                    newFrozen.push(item);
                    globalSeenSys.add(item.norm);
                }
                sysMsgsPool.splice(bestIdx, 1);
            } else if (bestScore > 0.6) {
                const matchedItem = sysMsgsPool[bestIdx];
                if (!globalSeenSys.has(matchedItem.norm)) {
                    newFrozen.push(matchedItem);
                    globalSeenSys.add(matchedItem.norm);
                    Logger.log(`[修改] 提示詞內容原位更新 (相近度 ${(bestScore*100).toFixed(1)}%)`, LogLevels.DETAILED);
                }
                sysMsgsPool.splice(bestIdx, 1);
            } else {
                Logger.log(`[刪除] 檢測到提示詞被刪除，自動抽出補位`, LogLevels.DETAILED);
            }
        } else {
            // 用戶與 AI 可以無限重複，不參與 globalSeenSys 去重
            newFrozen.push(item);
        }
    }

    // 2. 處理歷史對話追加
    let lastFrozenUserNorm = null;
    for (let i = newFrozen.length - 1; i >= 0; i--) {
        if (newFrozen[i].type === 'user') { lastFrozenUserNorm = newFrozen[i].norm; break; }
    }

    let startIdx = 0;
    if (lastFrozenUserNorm) {
        for (let i = 0; i < stHistoryTurns.length; i++) {
            if (stHistoryTurns[i].user.norm === lastFrozenUserNorm) {
                startIdx = i + 1;
                if (stHistoryTurns[i].assistant) {
                    const cleanAssistant = stripPrefillFromAssistant(stHistoryTurns[i].assistant, profile.lastPrefills || []);
                    let aiUpdated = false;
                    for (let k = newFrozen.length - 1; k >= 0; k--) {
                        if (newFrozen[k].type === 'sys') break;
                        if (newFrozen[k].type === 'user') {
                            if (!aiUpdated) newFrozen.splice(k + 1, 0, createMsg(cleanAssistant, 'ai'));
                            break;
                        }
                        if (newFrozen[k].type === 'ai') {
                            newFrozen[k] = createMsg(cleanAssistant, 'ai');
                            aiUpdated = true;
                            break;
                        }
                    }
                }
                break;
            }
        }
    }

    for (let i = startIdx; i < stHistoryTurns.length; i++) {
        const turn = stHistoryTurns[i];
        newFrozen.push(createMsg(turn.user, 'user'));
        if (turn.assistant) {
            const cleanAssistant = stripPrefillFromAssistant(turn.assistant, profile.lastPrefills || []);
            newFrozen.push(createMsg(cleanAssistant, 'ai'));
        }
    }

    // 3. 追加全新提示詞 (嚴格去重)
    for (const sys of sysMsgsPool) {
        if (!globalSeenSys.has(sys.norm)) {
            newFrozen.push(sys);
            globalSeenSys.add(sys.norm);
            Logger.log(`[新增] 全新提示詞已附加於序列尾部`, LogLevels.DEBUG);
        }
    }

    // 4. 組合最終發送序列
    const finalSequence = [...newFrozen];
    if (stCurrentTurn.user) finalSequence.push(createMsg(stCurrentTurn.user, 'user'));
    for (const p of stCurrentTurn.prefills) finalSequence.push(createMsg(p, 'ai'));

    return { newFrozen, finalSequence };
}

// 計算前綴命中率 (核心雷達)
function calculateCacheHitRate(lastSent, currentFinal) {
    if (!lastSent || lastSent.length === 0) return 1.0;
    let matchedLen = 0;
    let lastSentTotalLen = lastSent.reduce((sum, item) => sum + item.content.length, 0);
    if (lastSentTotalLen === 0) return 1.0;

    for (let i = 0; i < Math.min(lastSent.length, currentFinal.length); i++) {
        if (lastSent[i].norm === currentFinal[i].norm) {
            matchedLen += lastSent[i].content.length;
        } else {
            break; // 前綴斷裂
        }
    }
    return matchedLen / lastSentTotalLen;
}

// ==========================================
// 攔截主入口
// ==========================================
let isResetting = false; 

function interceptAndRestructurePrompt(data) {
    if (!settings.enabled || data.dryRun) return;

    try {
        const profile = getCurrentProfile();
        Logger.log(`==============================`);
        Logger.log(`[請求] 開始處理檔案: [${profile.chatId}] (${profile.charName})`, LogLevels.BASIC);

        if (!data?.chat?.length) return;
        const stream = data.chat;

        const { sysMsgs, stHistoryTurns, stCurrentTurn } = parseSTStream(stream);
        const { newFrozen, finalSequence } = buildIntendedSequence(profile, sysMsgs, stHistoryTurns, stCurrentTurn);

        // 10% 緩存丟失自適應雷達
        const hitRate = calculateCacheHitRate(profile.lastSentSequence, finalSequence);
        const wastePercent = ((1 - hitRate) * 100).toFixed(1);

        if (hitRate < 0.90 && settings.showResetPrompt && !isResetting && profile.lastSentSequence.length > 0) {
            Logger.warn(`[雷達警報] 檢測到前綴斷裂，將導致 ${wastePercent}% 的緩存失效！`, LogLevels.BASIC);
            const msg = `🚨 [Deepseek 緩存優化 雷達] 🚨\n\n檢測到您的修改將導致 ${wastePercent}% 的緩存失效 (命中率低於 90%)。\n\n▶ 點擊【確定】：重置前綴緩存，並保留所有對話重新構建。\n▶ 點擊【取消】：忍受本次斷裂，強行發送。`;
            const ok = confirm(msg);
            
            if (ok) {
                isResetting = true;
                Logger.warn(`[緩存重置] 用戶同意，正在保留歷史並重構檔案 [${profile.chatId}]...`, LogLevels.BASIC);
                profile.frozenSequence = [];
                profile.lastSentSequence = [];
                profile.lastPrefills = [];
                saveSettings();
                
                // 遞迴呼叫：利用已保留的 ST 完整上下文重新構建
                const result = interceptAndRestructurePrompt(data);
                isResetting = false;
                return result;
            } else {
                Logger.warn(`[忽略重置] 用戶選擇強行發送，容忍 ${wastePercent}% 損失。`, LogLevels.BASIC);
            }
        }

        Logger.log(`[驗證] 本次預估前綴命中率: ${(hitRate*100).toFixed(1)}%`, LogLevels.BASIC);

        // 更新持久化狀態
        profile.frozenSequence = newFrozen;
        profile.lastSentSequence = finalSequence;
        profile.lastPrefills = stCurrentTurn.prefills;
        saveSettings();
        renderProfilesList(); 

        // 輸出至 ST
        const finalOutput = finalSequence.map(item => ({ role: item.role, content: item.content }));
        stream.splice(0, stream.length, ...finalOutput);

    } catch (err) {
        Logger.error('攔截器發生錯誤', err);
        isResetting = false;
        throw err;
    }
}

// ==========================================
// 即時修改提醒機制 (DOM 深度監聽)
// ==========================================
let warningTimeout = null;
function triggerWarning(msg, toggle) {
    if (!settings.enabled || !toggle) return;
    if (warningTimeout) clearTimeout(warningTimeout);
    warningTimeout = setTimeout(() => {
        if (typeof toastr !== 'undefined') toastr.warning(msg, '⚠️ 緩存狀態變更', { timeOut: 3000 });
    }, 1000);
}

// ==========================================
// UI 與 初始化
// ==========================================
function renderProfilesList() {
    const container = $('#ds-profiles-list');
    if (!container.length) return;
    container.empty();
    const entries = Object.entries(settings.profiles);
    if (entries.length === 0) {
        container.append(`<div style="color:#888; text-align:center;">暫無已緩存的檔案</div>`);
        return;
    }
    for (const [chatId, prof] of entries) {
        const row = $(`<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px; padding:3px; background:#222; border-radius:4px;">
            <span style="font-size:0.85em; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:75%;" title="${chatId}">
                👤 ${prof.charName} <br><span style="color:#888;font-size:0.8em;">${chatId}</span>
            </span>
            <button class="menu_button" style="padding:2px 8px; font-size:0.8em; min-width:40px;" data-id="${chatId}">重置</button>
        </div>`);
        row.find('button').on('click', function() {
            const id = $(this).data('id');
            settings.profiles[id] = { charName: prof.charName, chatId: id, frozenSequence: [], lastPrefills: [], lastSentSequence: [] };
            saveSettings();
            toastr.success(`已重置檔案: ${prof.charName}`);
        });
        container.append(row);
    }
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Deepseek 缓存优化 (v8.0 多檔案隔離版)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">嚴格去重，10% 雷達，多檔案完全隔離並持久化保存。</p>
                <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" ${settings.enabled ? 'checked' : ''}> 啟用插件總開關</label>
                <div style="margin:5px 0 10px 15px; border-left: 2px solid #555; padding-left: 10px;">
                    <label class="checkbox_label" style="font-size:0.9em;"><input type="checkbox" id="ds-toast-sys" ${settings.toastSys ? 'checked' : ''}> 預設/提示詞修改即時彈窗</label>
                    <label class="checkbox_label" style="font-size:0.9em;"><input type="checkbox" id="ds-toast-lore" ${settings.toastLore ? 'checked' : ''}> 世界書修改即時彈窗</label>
                    <label class="checkbox_label" style="font-size:0.9em;"><input type="checkbox" id="ds-toast-his" ${settings.toastHistory ? 'checked' : ''}> 歷史對話修改即時彈窗</label>
                    <label class="checkbox_label" style="font-size:0.9em;"><input type="checkbox" id="ds-toast-reset" ${settings.showResetPrompt ? 'checked' : ''}> 啟用 10% 緩存丟失阻斷確認彈窗</label>
                </div>
                
                <div style="margin:8px 0; display:flex; align-items:center;">
                    <span style="font-size:0.9em; margin-right:5px;">日誌等級:</span>
                    <select id="ds-cache-loglevel" class="text_pole" style="width:auto;">
                        <option value="0" ${settings.logLevel === 0 ? 'selected' : ''}>關閉</option>
                        <option value="1" ${settings.logLevel === 1 ? 'selected' : ''}>簡要</option>
                        <option value="2" ${settings.logLevel === 2 ? 'selected' : ''}>詳細</option>
                        <option value="3" ${settings.logLevel === 3 ? 'selected' : ''}>深度(推薦)</option>
                    </select>
                </div>
                
                <div style="margin:10px 0; padding:5px; border:1px solid #444; border-radius:5px;">
                    <div style="font-size:0.9em; margin-bottom:5px; color:#aaa;">📂 獨立檔案管理 (Profiles)</div>
                    <div id="ds-profiles-list" style="max-height:120px; overflow-y:auto; margin-bottom:5px;"></div>
                    <button id="ds-reset-all" class="menu_button" style="width:100%; background:#833;">⚠️ 徹底清空所有檔案狀態</button>
                </div>

                <button id="ds-cache-clearlog" class="menu_button" style="width:100%;margin:5px 0;">🗑️ 清空日誌面板</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:250px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;white-space:pre-wrap;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');

        $('#ds-cache-enable').on('change', function () { settings.enabled = $(this).is(':checked'); saveSettings(); });
        $('#ds-toast-sys').on('change', function () { settings.toastSys = $(this).is(':checked'); saveSettings(); });
        $('#ds-toast-lore').on('change', function () { settings.toastLore = $(this).is(':checked'); saveSettings(); });
        $('#ds-toast-his').on('change', function () { settings.toastHistory = $(this).is(':checked'); saveSettings(); });
        $('#ds-toast-reset').on('change', function () { settings.showResetPrompt = $(this).is(':checked'); saveSettings(); });
        $('#ds-cache-loglevel').on('change', function () { settings.logLevel = parseInt($(this).val()); saveSettings(); });
        
        $('#ds-reset-all').on('click', () => { 
            if(confirm('確定要清空「所有角色卡」及「所有聊天檔案」的插件狀態嗎？')) {
                settings.profiles = {}; 
                saveSettings(); 
                renderProfilesList();
                toastr.success("已清空所有緩存檔案狀態");
            }
        });
        $('#ds-cache-clearlog').on('click', () => { if (Logger._uiTextarea) Logger._uiTextarea.value = ''; });
        
        renderProfilesList();
    } catch (e) {
        Logger.error('UI初始化失敗', e);
    }
}

// ==========================================
// 啟動與全局事件綁定
// ==========================================
jQuery(async () => {
    await setupUI();

    if (eventSource) {
        if (event_types?.CHAT_COMPLETION_PROMPT_READY) eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        if (event_types?.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, () => triggerWarning('刪除歷史對話將引發緩存陣列重組！', settings.toastHistory));
        if (event_types?.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, () => triggerWarning('修改歷史對話將引發緩存陣列重組！', settings.toastHistory));
        if (event_types?.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, () => triggerWarning('切換歷史對話將引發緩存陣列重組！', settings.toastHistory));
    }

    // 擴大監聽範圍覆蓋 Chat Completion Presets 與 API
    const sysSelectors = '#main_prompt_textarea, #nsfw_prompt_textarea, #rm_ch_sys_prompt, #author_note_textarea, #chat_completion_system, textarea[id*="prompt"], textarea[id*="jailbreak"], .preset_textarea';
    const loreSelectors = '.world_info_entry textarea, .world_info_entry input';

    $(document).on('input', sysSelectors, function() { triggerWarning('修改系統預設將觸發 10% 緩存雷達偵測！', settings.toastSys); });
    $(document).on('input', loreSelectors, function() { triggerWarning('修改世界書將觸發 10% 緩存雷達偵測！', settings.toastLore); });
    
    Logger.log('══════ v8.0 就緒，多檔案持久化與 10% 雷達已啟用 ══════', LogLevels.BASIC);
});
