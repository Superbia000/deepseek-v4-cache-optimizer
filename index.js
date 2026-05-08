import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志等级 & 基础日志函数
// ==========================================
let logLevel = 2; // 0:silent, 1:basic, 2:detailed, 3:debug
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const prefix = `[${time}]`;
    const fullMsg = `${prefix} ${msg}`;
    if (type === 'warn') {
        console.warn(`%c[DS V4 Opt v5] ⚡ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS V4 Opt v5] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS V4 Opt v5] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
};

// ==========================================
// 简单 hash 与 token 估算
// ==========================================
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}

function estimateTokens(text) {
    if (!text) return 0;
    let tokens = 0;
    for (const ch of text) {
        const code = ch.charCodeAt(0);
        if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3040 && code <= 0x30FF) || (code >= 0xAC00 && code <= 0xD7AF)) {
            tokens += 1;
        } else {
            tokens += 0.25;
        }
    }
    return Math.ceil(tokens);
}

// ==========================================
// 深度比较两条消息是否完全相同
// ==========================================
function messagesEqual(a, b) {
    if (!a || !b) return false;
    return a.role === b.role && a.content === b.content;
}

// ==========================================
// 状态管理
// ==========================================
const CacheState = {
    enabled: true,
    frozenSystems: null,          // 凍結的 system 消息內容陣列（按順序）
    trailingSystems: [],          // 新增的動態 system 消息（放在歷史之後）
    lastFinalMessages: null,      // 上一輪最終發送的消息陣列（深拷貝）
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// ==========================================
// 提取消息分類
// ==========================================
function extractMessageParts(chat) {
    // 複製一份，避免修改原陣列
    const msgs = [...chat];
    const systems = [];
    const history = [];
    let prefill = null;

    // 從後往前找 prefill：最後一條 assistant 且前面是 user
    // 但更穩妥：找出最後一條 user 的位置，其後的 assistant 視為 prefill
    let lastUserIndex = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') {
            lastUserIndex = i;
            break;
        }
    }

    if (lastUserIndex !== -1 && lastUserIndex < msgs.length - 1) {
        // 用戶之後可能有多條助理？但一般只有一條預填充
        const afterUser = msgs.slice(lastUserIndex + 1);
        if (afterUser.length === 1 && afterUser[0].role === 'assistant') {
            prefill = afterUser[0];
        } else {
            // 如果有多條，取第一條作為 prefill，其餘歸入歷史（少見，保守處理）
            prefill = afterUser.find(m => m.role === 'assistant') || null;
        }
    }

    // 分類 system 與 history（不包含 prefill 與最後一條 user 之後的部分）
    for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i];
        if (i === lastUserIndex) continue; // 最後一條 user 單獨處理
        if (prefill && i >= lastUserIndex + 1 && msg === prefill) continue; // 跳過已提取的 prefill

        if (msg.role === 'system') {
            systems.push(msg);
        } else {
            history.push(msg);
        }
    }

    // 分離當前用戶輸入與過往歷史
    let currentUser = null;
    const pastHistory = [...history];
    // 如果 history 的最後一條是 user，則它即為當前輸入，將其取出
    if (pastHistory.length > 0 && pastHistory[pastHistory.length - 1].role === 'user') {
        currentUser = pastHistory.pop();
    } else if (lastUserIndex !== -1) {
        // 如果 history 未包含最後那條 user，直接從原陣列取
        currentUser = msgs[lastUserIndex];
    }

    return { systems, pastHistory, currentUser, prefill };
}

// ==========================================
// 最長公共前綴匹配
// ==========================================
function longestCommonPrefix(arr1, arr2) {
    const minLen = Math.min(arr1.length, arr2.length);
    let i = 0;
    for (; i < minLen; i++) {
        if (!messagesEqual(arr1[i], arr2[i])) break;
    }
    return i;
}

// ==========================================
// 檢查 frozenSystems 是否被修改（前綴匹配）
// ==========================================
function frozenSystemsModified(newSystems) {
    if (!CacheState.frozenSystems) return true;
    const frozen = CacheState.frozenSystems;
    if (newSystems.length < frozen.length) return true; // 删除了某些条
    for (let i = 0; i < frozen.length; i++) {
        if (i >= newSystems.length) return true;
        if (newSystems[i].content !== frozen[i]) return true; // 内容改变或顺序不同
    }
    return false; // 前 frozen.length 条完全一致
}

// ==========================================
// 自動重置
// ==========================================
function autoReset(reason) {
    CacheState.frozenSystems = null;
    CacheState.trailingSystems = [];
    CacheState.lastFinalMessages = null;
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    if (typeof toastr !== 'undefined') {
        toastr.warning(`DS V4 Optimizer: ${reason}，緩存已自動重置。`, '緩存重置');
    }
    Logger.warn(`自動重置：${reason}`, LogLevels.BASIC);
}

// ==========================================
// 核心攔截重組
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`攔截器 #${CacheState.stats.total}`);

        const originalChat = [...data.chat];
        const { systems, pastHistory, currentUser, prefill } = extractMessageParts(originalChat);

        // 提取 system 內容順序
        const systemContents = systems.map(m => m.content);

        // ------- 初始化或重置 -------
        if (!CacheState.frozenSystems) {
            // 首次凍結
            CacheState.frozenSystems = systemContents.slice(); // 儲存內容（非物件）
            CacheState.trailingSystems = []; // 初始無動態追加
            Logger.log(`初始化凍結系統提示，共 ${CacheState.frozenSystems.length} 條`, LogLevels.BASIC);

            // 構建最終 messages
            const finalMessages = [];
            // 1. 凍結 system 消息
            for (const content of CacheState.frozenSystems) {
                finalMessages.push({ role: 'system', content });
            }
            // 2. 過往歷史
            finalMessages.push(...pastHistory);
            // 3. 動態追加（目前為空）
            // 4. 當前用戶輸入
            if (currentUser) finalMessages.push(currentUser);
            // 5. prefill
            if (prefill) finalMessages.push(prefill);

            // 替換 data.chat
            data.chat.splice(0, data.chat.length, ...finalMessages);
            // 記錄本輪最終消息
            CacheState.lastFinalMessages = JSON.parse(JSON.stringify(finalMessages));
            Logger.log(`首輪發送，消息數: ${finalMessages.length}`, LogLevels.BASIC);
            return;
        }

        // ------- 檢測凍結部分是否被修改 -------
        if (frozenSystemsModified(systemContents)) {
            autoReset('系統提示詞已被修改或刪除，將重新凍結。');
            // 遞歸調用自身重新處理（此時 frozenSystems 為 null，會重新初始化）
            interceptAndRestructurePrompt(data);
            return;
        }

        // ------- 處理新增系統提示 -------
        const frozenLen = CacheState.frozenSystems.length;
        const newTrailing = systemContents.slice(frozenLen); // 新增的 system 內容
        // 更新動態追加列表（新加入的追加，並移除已消失的）
        CacheState.trailingSystems = newTrailing;

        // ------- 構建本輪理想 messages -------
        const candidateMessages = [];
        // 1. 凍結系統提示
        for (const content of CacheState.frozenSystems) {
            candidateMessages.push({ role: 'system', content });
        }
        // 2. 過往歷史
        candidateMessages.push(...pastHistory);
        // 3. 動態追加系統提示（放在歷史之後、用戶輸入之前）
        for (const content of CacheState.trailingSystems) {
            candidateMessages.push({ role: 'system', content });
        }
        // 4. 當前用戶輸入
        if (currentUser) candidateMessages.push(currentUser);
        // 5. prefill
        if (prefill) candidateMessages.push(prefill);

        // ------- 與上輪最終消息對齊，最大化前綴 -------
        let finalMessages;
        if (CacheState.lastFinalMessages) {
            const commonLen = longestCommonPrefix(CacheState.lastFinalMessages, candidateMessages);
            finalMessages = [
                ...CacheState.lastFinalMessages.slice(0, commonLen),
                ...candidateMessages.slice(commonLen)
            ];

            // 緩存命中統計（粗略：以完全匹配的前綴長度作為命中部分）
            const prefixTokens = finalMessages.slice(0, commonLen).reduce((sum, m) => sum + estimateTokens(m.content), 0);
            const totalTokens = finalMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += prefixTokens;
            CacheState.stats.prefixTokens = prefixTokens;

            const newTokens = totalTokens - prefixTokens;
            const hitRate = commonLen > 0 ? ((commonLen / finalMessages.length) * 100).toFixed(1) : '0.0';
            Logger.log(`前綴匹配: ${commonLen}/${finalMessages.length} 條消息 (${hitRate}%)，命中約 ${prefixTokens} tokens，新增 ${newTokens} tokens`, LogLevels.BASIC);
        } else {
            finalMessages = candidateMessages;
            Logger.log('無上輪記錄，直接使用候選消息', LogLevels.DEBUG);
        }

        // 替換 data.chat
        data.chat.splice(0, data.chat.length, ...finalMessages);
        // 儲存本輪最終消息供下輪使用
        CacheState.lastFinalMessages = JSON.parse(JSON.stringify(finalMessages));

        if (logLevel >= LogLevels.DEBUG) {
            Logger.log(`最終消息結構: ${finalMessages.map(m => `${m.role}(${m.content.length}字)`).join(' → ')}`, LogLevels.DEBUG);
        }

    } catch (err) {
        Logger.error('攔截器致命錯誤', err);
    }
}

// ==========================================
// UI 與統計
// ==========================================
function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `
        <span>命中: ${hits}/${total} (${rate}%)</span>
        <span style="margin-left:10px;">前綴: ~${prefixTokens.toLocaleString()}t</span>
        <span style="margin-left:10px;">共省: ~${savedTokens.toLocaleString()}t</span>
    `;
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>DS V4 Cache Optimizer v5</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">不合并提示词，自動後置新增指令，最大化 DeepSeek 緩存命中率。</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;"></div>
                <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" id="ds-cache-enable" checked> 啟用攔截器
                </label>
                <div style="display:flex;align-items:center;gap:8px;margin:8px 0;">
                    <span style="font-size:0.9em;">日誌等級:</span>
                    <select id="ds-cache-loglevel" style="flex:1;">
                        <option value="0">關閉</option>
                        <option value="1">簡要</option>
                        <option value="2" selected>詳細</option>
                        <option value="3">調試</option>
                    </select>
                </div>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 強制重置靜態核心</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');
        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`狀態: ${CacheState.enabled ? '啟用' : '停用'}`, LogLevels.BASIC);
        });
        $('#ds-cache-loglevel').on('change', function() {
            logLevel = parseInt($(this).val());
            Logger.log(`日誌等級設為: ${['關閉','簡要','詳細','調試'][logLevel]}`, LogLevels.BASIC);
        });
        $('#ds-cache-reset').on('click', () => {
            autoReset('用戶手動重置');
            updateStatsUI();
            Logger.warn('已完全重置', LogLevels.BASIC);
        });
        updateStatsUI();
    } catch (e) {
        Logger.error('UI初始化失敗', e);
    }
}

// ==========================================
// 啟動
// ==========================================
jQuery(async () => {
    console.log('DS V4 Optimizer v5 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('已掛載事件鉤子', LogLevels.BASIC);
    } else {
        Logger.error('無法掛載事件鉤子');
    }
    Logger.log('══════ v5.0 就緒，不合并提示詞 + 自動後置新增指令 ══════', LogLevels.BASIC);
});
