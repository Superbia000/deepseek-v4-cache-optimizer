import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 狀態與設定 (v44 絕對秩序矩陣版)
// ==========================================
let Settings = {};

function initSettings() {
    if (!extension_settings.ds_cache_v44) {
        extension_settings.ds_cache_v44 = {
            enabled: true,
            diaryMode: true,
            retconProtocol: true,
            toastSys: true,
            toastLore: true,
            toastHistory: true,
            showResetPrompt: true,
            logLevel: 3,
            chats: {} 
        };
    }
    Settings = extension_settings.ds_cache_v44;
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
// 深度日誌系統
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function logAt(level, type, msg) {
    if (Settings.logLevel < level) return;
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
    const fullMsg = `[${time}] ${msg}`;
    
    if (type === 'warn') console.warn(`%c[DS Cache v44] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    else if (type === 'error') console.error(`[DS Cache v44] 🔴 ${msg}`);
    else if (type === 'map') console.log(`%c[DS Cache v44] 🌌 ${msg}`, 'color: #b026ff; font-weight: bold;');
    else console.log(`%c[DS Cache v44] 🛡️ ${msg}`, 'color: #00ffcc;');
    
    if (Logger._uiTextarea) {
        Logger._uiTextarea.value += fullMsg + '\n';
        Logger._uiTextarea.scrollTop = Logger._uiTextarea.scrollHeight;
    }
}

const Logger = {
    _uiTextarea: null,
    log: (msg, level = LogLevels.DETAILED) => logAt(level, 'log', msg),
    warn: (msg, level = LogLevels.BASIC) => logAt(level, 'warn', msg),
    map: (msg, level = LogLevels.BASIC) => logAt(level, 'map', msg),
    error: (msg, err, level = LogLevels.BASIC) => logAt(level, 'error', err ? `${msg} ${err}` : msg),
    // 協議4: 語義正規化引擎
    normalize: (text) => text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
    getSeqString: (seq) => seq.map(m => `[${m.tag}]`).join(' ➔ ')
};

// ==========================================
// 核心工具與協議輔助
// ==========================================
function createMsg(msg, tag, stIndex = -1) {
    const content = msg.content || '';
    return { role: msg.role, content: content, norm: Logger.normalize(content), len: content.length, tag: tag, stIndex: stIndex };
}

function createPatch(content) {
    return createMsg({ role: 'system', content: content }, 'SYS_PATCH');
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

function getSimpleDiff(oldStr, newStr) {
    let i = 0;
    while (i < oldStr.length && i < newStr.length && oldStr[i] === newStr[i]) i++;
    let j = 0;
    while (j < oldStr.length - i && j < newStr.length - i && oldStr[oldStr.length - 1 - j] === newStr[newStr.length - 1 - j]) j++;
    let diff = newStr.substring(i, newStr.length - j).trim();
    return diff.length > 0 ? diff : "微小設定調整";
}

function findBestMatch(target, pool) {
    let bestIdx = -1, bestScore = -1;
    for (let i = 0; i < pool.length; i++) {
        if (target.tag !== 'SYS' && target.tag !== 'SYS_PATCH' && target.tag !== pool[i].tag) continue;
        const score = getSimilarity(target.norm, pool[i].norm);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    return { index: bestIdx, score: bestScore, item: bestIdx !== -1 ? pool[bestIdx] : null };
}

// 協議5: 絕對去重協議
function deduplicateSequence(seq) {
    const deduped = [];
    const seenNorms = new Set();
    for (const item of seq) {
        if (item.tag === 'SYS' || item.tag === 'SYS_PATCH') {
            if (seenNorms.has(item.norm)) continue;
            seenNorms.add(item.norm);
        }
        deduped.push(item);
    }
    return deduped;
}

// ==========================================
// 狀態管理
// ==========================================
function getChatKey() {
    const context = getContext();
    let charName = context.characterId !== undefined && context.characters && context.characters[context.characterId] ? context.characters[context.characterId].name : (context.name2 || "Unknown");
    let chatId = context.chatId || "default_chat";
    if (context.groupId) return { key: `group_${context.groupId}_${chatId}`, label: `群組: ${chatId}` };
    return { key: `char_${context.characterId}_${chatId}`, label: `角色: ${charName} | 存檔: ${chatId}` };
}

function getChatState(chatKeyInfo) {
    if (!Settings.chats[chatKeyInfo.key]) {
        Settings.chats[chatKeyInfo.key] = { label: chatKeyInfo.label, frozenSequence: [], lastPrefills: [] };
        safeSave(); renderChatsUI();
    }
    return Settings.chats[chatKeyInfo.key];
}

// ==========================================
// 核心處理器 (v44 絕對秩序矩陣引擎)
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (!Settings.enabled || data.dryRun) return;

    try {
        const chatKeyInfo = getChatKey();
        let state = getChatState(chatKeyInfo);
        if (!data?.chat?.length) return;
        const stream = data.chat;

        Logger.log(`================= 啟動時空重構協議 =================`, LogLevels.BASIC);

        let incomingSys = [];
        let incomingHis = [];
        let ephemeralPool = []; // 協議2 & 19: 隔離區
        let currentTurnUser = null;
        let currentTurnPrefills = [];

        // 1. 解析 ST 原始流並進行初步分類
        for (let i = 0; i < stream.length; i++) {
            const rawMsg = stream[i];
            const isSys = (rawMsg.role === 'system' || (rawMsg.role !== 'user' && rawMsg.role !== 'assistant'));
            const tag = isSys ? 'SYS' : (rawMsg.role === 'user' ? 'USER' : 'AI');
            const msg = createMsg(rawMsg, tag, i);

            // 協議6: 曲率引擎過濾 (剔除零熵節點)
            if (msg.norm.replace(/[\*\-\.\,]/g, '').length === 0) continue;

            // 協議2: 向量隔離區 (RAG)
            if (/retrieved context|search results|vector database|相关记忆|检索到的内容|记忆库片段/i.test(msg.content)) {
                ephemeralPool.push(msg);
                Logger.log(`[隔離區] 捕獲向量記憶，已沉底`, LogLevels.DEBUG);
                continue;
            }

            // 協議19: 摘要沉底錨點
            if (/summary|previously on|摘要|前情提要|总结|回顾/i.test(msg.content)) {
                ephemeralPool.push(msg);
                Logger.log(`[隔離區] 捕獲自動摘要，已沉底`, LogLevels.DEBUG);
                continue;
            }

            if (isSys) incomingSys.push(msg);
            else incomingHis.push(msg);
        }

        // 提取 Current Turn (最後的 User 與 Prefill)
        let lastUserIdx = -1;
        for (let i = incomingHis.length - 1; i >= 0; i--) {
            if (incomingHis[i].tag === 'USER') { lastUserIdx = i; break; }
        }
        if (lastUserIdx !== -1) {
            currentTurnUser = incomingHis[lastUserIdx];
            currentTurnPrefills = incomingHis.slice(lastUserIdx + 1).map(m => ({...m, tag: 'PREFILL'}));
            incomingHis = incomingHis.slice(0, lastUserIdx);
        } else {
            currentTurnPrefills = incomingHis.map(m => ({...m, tag: 'PREFILL'}));
            incomingHis = [];
        }

        // 2. 絕對秩序矩陣初始化
        if (!state.frozenSequence || state.frozenSequence.length === 0) {
            state.frozenSequence = deduplicateSequence([...incomingSys, ...incomingHis]);
            Logger.map(`[初次凍結] 建立絕對序列，長度: ${state.frozenSequence.length}`, LogLevels.BASIC);
        } 
        else {
            let newFrozen = [];
            let patches = [];
            let nodesToDeleteFromMiddle = 0; // 協議3: 質量守恆刪除
            let deletedHeadCount = 0;
            let firstHistoryFound = false;
            let lastMatchedStIndex = -1;

            // 3. 遍歷凍結序列，執行時空比對
            for (let i = 0; i < state.frozenSequence.length; i++) {
                let frozen = state.frozenSequence[i];

                if (frozen.tag === 'SYS' || frozen.tag === 'SYS_PATCH') {
                    let match = findBestMatch(frozen, incomingSys);
                    
                    if (match.score === 1) {
                        newFrozen.push(frozen);
                        incomingSys.splice(match.index, 1);
                    } else if (match.score > 0.85 && frozen.content.length > 300) {
                        // 協議17: 量子微創手術
                        newFrozen.push(frozen);
                        let diff = getSimpleDiff(frozen.content, match.item.content);
                        patches.push(createPatch(`設定微調補充：新增細節 ${diff}`));
                        incomingSys.splice(match.index, 1);
                        Logger.warn(`[微創手術] 角色卡微調，已生成補丁`, LogLevels.DEBUG);
                    } else if (match.score > 0.2) {
                        newFrozen.push(frozen);
                        // 協議14: 寫日記模式 (動態提示詞)
                        if (Settings.diaryMode && frozen.content.length < 150) {
                            patches.push(createPatch(`狀態更新日誌：${match.item.content}`));
                            Logger.log(`[日記模式] 動態提示詞已追加`, LogLevels.DEBUG);
                        } else {
                            // 協議18: 提示詞熱更新
                            patches.push(createPatch(`提示詞設定已熱更新，最新特徵如下：\n${match.item.content}`));
                            Logger.warn(`[熱更新] 提示詞大幅修改，已生成補丁`, LogLevels.DEBUG);
                        }
                        incomingSys.splice(match.index, 1);
                    } else {
                        // 協議16: 永久記憶烙印 (ST 移除了該提示詞/世界書)
                        newFrozen.push(frozen);
                        Logger.log(`[記憶烙印] 保留已失效的世界書/提示詞`, LogLevels.DEBUG);
                    }
                } 
                else { // USER or AI
                    let isFirstHistory = !firstHistoryFound;
                    firstHistoryFound = true;
                    let match = findBestMatch(frozen, incomingHis);

                    // 協議3 & 11: 質量守恆與虛空架橋 (從中間刪除以補償頭部保留)
                    if (nodesToDeleteFromMiddle > 0 && match.score > 0) {
                        nodesToDeleteFromMiddle--;
                        patches.push(createPatch(`上下文微小跳躍`));
                        incomingHis.splice(match.index, 1);
                        Logger.warn(`[虛空架橋] 刪除中間節點以補償 Token，已架橋`, LogLevels.DEBUG);
                        continue; // 丟棄此節點
                    }

                    if (match.score === 1) {
                        newFrozen.push(frozen);
                        lastMatchedStIndex = Math.max(lastMatchedStIndex, match.item.stIndex);
                        incomingHis.splice(match.index, 1);
                    } else if (match.score > 0.99) {
                        // 協議8: 熵減護盾協議 (錯字修正)
                        newFrozen.push(frozen);
                        patches.push(createPatch(`錯字修正：之前的對話已修正為：${match.item.content}`));
                        lastMatchedStIndex = Math.max(lastMatchedStIndex, match.item.stIndex);
                        incomingHis.splice(match.index, 1);
                        Logger.log(`[熵減護盾] 攔截微小修改`, LogLevels.DEBUG);
                    } else if (match.score > 0.5) {
                        // 協議9: 時空補丁 (大幅修改)
                        newFrozen.push(frozen);
                        patches.push(createPatch(`時空修正：之前的事件實際上已發生改變，最新情況為：${match.item.content}`));
                        lastMatchedStIndex = Math.max(lastMatchedStIndex, match.item.stIndex);
                        incomingHis.splice(match.index, 1);
                        Logger.warn(`[時空補丁] 攔截歷史改寫`, LogLevels.DEBUG);
                    } else {
                        // 節點在 ST 中消失 (被刪除或截斷)
                        if (isFirstHistory) {
                            // 協議3: 絕對前綴錨點
                            newFrozen.push(frozen);
                            nodesToDeleteFromMiddle++; // 欠下 Token 債，必須從中間刪除一個
                            deletedHeadCount++;
                            Logger.warn(`[前綴錨點] 攔截頭部截斷，強制保留錨點`, LogLevels.DEBUG);
                        } else if (deletedHeadCount > 0 && match.score === 0) {
                            // 連續的頭部截斷
                            newFrozen.push(frozen);
                            nodesToDeleteFromMiddle++;
                            deletedHeadCount++;
                        } else {
                            // 協議13: 吃書協議 (中間刪除)
                            newFrozen.push(frozen);
                            if (Settings.retconProtocol) {
                                patches.push(createPatch(`世界意志發動了記憶抹除。之前的事件已被抹除，請當作從未發生過。`));
                                Logger.warn(`[吃書協議] 攔截中間刪除`, LogLevels.DEBUG);
                            }
                        }
                    }
                }
            }

            // 協議12: 失憶症協議
            if (deletedHeadCount > 5) {
                patches.push(createPatch(`早期的記憶已歸檔，請根據當前上下文繼續。`));
                Logger.warn(`[失憶症協議] 偵測到大清洗，已生成歸檔補丁`, LogLevels.BASIC);
            }

            // 4. 處理剩餘的 Incoming (全新內容)
            for (let his of incomingHis) {
                if (his.stIndex < lastMatchedStIndex) {
                    // 協議10: 閃回插入協議
                    patches.push(createPatch(`閃回補充：在之前的事件中，還發生了以下細節：\n${his.content}`));
                    Logger.warn(`[閃回插入] 攔截中間插入的對話`, LogLevels.DEBUG);
                } else {
                    // 協議20: 克羅諾斯協議 (時間跳躍)
                    if (his.content.length < 150 && /later|next day|第二天|几个小时后|一段时间后|meanwhile/i.test(his.content)) {
                        patches.push(createPatch(`敘事過渡：${his.content}`));
                        Logger.log(`[克羅諾斯] 轉換時間跳躍旁白`, LogLevels.DEBUG);
                    } else {
                        newFrozen.push(his); // 正常的新對話追加
                    }
                }
            }

            for (let sys of incomingSys) {
                newFrozen.push(sys); // 新的世界書或提示詞追加
            }

            // 5. 補丁追加與去重
            newFrozen.push(...patches);
            state.frozenSequence = deduplicateSequence(newFrozen);
        }

        // 6. 最終流組裝 (嚴格按照 Prompt 排序邏輯)
        // 凍結序列 -> 隔離區(臨時態) -> 用戶輸入 -> 預填充
        const finalStream = [...state.frozenSequence];
        finalStream.push(...ephemeralPool);
        if (currentTurnUser) finalStream.push(currentTurnUser);
        finalStream.push(...currentTurnPrefills);

        state.lastPrefills = currentTurnPrefills;
        safeSave();

        Logger.map(`🌌 絕對秩序拓撲圖: \n${Logger.getSeqString(finalStream)}`, LogLevels.BASIC);

        // 覆蓋 ST 發送流
        stream.splice(0, stream.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
        Logger.log('🛡️ 矩陣重構完成，100% 緩存鎖定，授權發送。', LogLevels.BASIC);

    } catch (err) {
        Logger.error('攔截器發生致命錯誤', err);
        throw err;
    }
}

// ==========================================
// UI 與事件綁定
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
                <span style="font-size:0.85em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:75%;" title="${chat.label}">${chat.label}</span>
                <button class="menu_button interactable ds-reset-btn" data-key="${key}" style="font-size:0.8em; padding:2px 5px;">清空</button>
            </div>
        `;
        container.append(html);
    });

    container.find('.ds-reset-btn').on('click', function() {
        const key = $(this).data('key');
        delete Settings.chats[key];
        safeSave(); renderChatsUI();
        if (typeof toastr !== 'undefined') toastr.success("已清空該存檔的絕對序列");
    });
}

function addTopMenuButton() {
    if ($('#ds-top-reset-btn').length === 0) {
        const btn = $(`<li id="ds-top-reset-btn" class="menu_button interactable" title="重置當前 DS 緩存排序"><span class="fa-solid fa-rotate-right"></span> 廠級清空 DS 緩存</li>`);
        btn.on('click', () => {
            if(!confirm("確定要完全清空當前聊天的絕對序列嗎？(這將使所有提示詞回到 ST 預設的頂部排序，並導致一次 100% 緩存重算)")) return;
            const key = getChatKey().key;
            delete Settings.chats[key];
            safeSave(); renderChatsUI();
            if (typeof toastr !== 'undefined') toastr.success("當前聊天的緩存序列已清空！", "DS Cache");
        });
        if ($('ul#extensions_menu').length > 0) $('ul#extensions_menu').append(btn);
        else if ($('#right-nav-extensions').length > 0) $('#right-nav-extensions').append(btn);
    }
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Deepseek 缓存优化 (v44 絕對秩序矩陣版)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}> 🛡️ 啟用絕對秩序矩陣 (Append-Only)</label>
                
                <div style="margin:5px 0 10px 15px; border-left: 2px solid #b026ff; padding-left: 10px;">
                    <label class="checkbox_label" style="font-size:0.85em;" title="動態提示詞將轉化為底部日記"><input type="checkbox" id="ds-diary-mode" ${Settings.diaryMode ? 'checked' : ''}> 📖 寫日記模式 (動態提示詞防護)</label>
                    <label class="checkbox_label" style="font-size:0.85em;" title="刪除歷史對話時生成記憶抹除補丁"><input type="checkbox" id="ds-retcon-proto" ${Settings.retconProtocol ? 'checked' : ''}> 🌌 吃書協議 (歷史刪除防護)</label>
                </div>
                
                <div style="margin:8px 0; display:flex; align-items:center;">
                    <span style="font-size:0.85em; margin-right:5px;">日誌等級:</span>
                    <select id="ds-cache-loglevel" class="text_pole" style="width:auto;">
                        <option value="0" ${Settings.logLevel===0?'selected':''}>關閉</option>
                        <option value="1" ${Settings.logLevel===1?'selected':''}>拓撲圖與簡要</option>
                        <option value="2" ${Settings.logLevel===2?'selected':''}>詳細追蹤</option>
                        <option value="3" ${Settings.logLevel===3?'selected':''}>極限除錯</option>
                    </select>
                </div>

                <hr style="border-color:#444; margin:10px 0;">
                <b style="font-size:0.9em;">📂 存檔緩存管理區：</b>
                <div id="ds-chat-list-container" style="max-height:150px; overflow-y:auto; margin:5px 0; border:1px solid #444; padding:5px;"></div>
                
                <button id="ds-cache-factory-reset" class="menu_button" style="width:100%;margin:5px 0;background:#722;">⚠️ 清空所有存檔數據 (還原 ST 默認排序)</button>
                <button id="ds-cache-clearlog" class="menu_button" style="width:100%;margin:5px 0;">🗑️ 清空日誌面板</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:180px;background:#0d0d0d;color:#00ffcc;font-family:Consolas,monospace;font-size:10px;white-space:pre-wrap;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');

        $('#ds-cache-enable').on('change', function () { Settings.enabled = $(this).is(':checked'); safeSave(); });
        $('#ds-diary-mode').on('change', function () { Settings.diaryMode = $(this).is(':checked'); safeSave(); });
        $('#ds-retcon-proto').on('change', function () { Settings.retconProtocol = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-loglevel').on('change', function () { Settings.logLevel = parseInt($(this).val()); safeSave(); });
        
        $('#ds-cache-factory-reset').on('click', () => {
            if (confirm("這將使所有提示詞回到 ST 預設的頂部排序！確定要清除嗎？")) { Settings.chats = {}; safeSave(); renderChatsUI(); }
        });
        $('#ds-cache-clearlog').on('click', () => { if (Logger._uiTextarea) Logger._uiTextarea.value = ''; });
        
        renderChatsUI();
    } catch (e) { console.error('[DS Cache] UI初始化失敗', e); }
}

jQuery(async () => {
    try {
        initSettings(); 
        await setupUI();
        
        setTimeout(addTopMenuButton, 2000);
        if (eventSource) eventSource.on(event_types.CHAT_CHANGED, addTopMenuButton);

        if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        }

        Logger.log('══════ v44 絕對秩序矩陣版 就緒 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件啟動崩潰:', e);
    }
});
