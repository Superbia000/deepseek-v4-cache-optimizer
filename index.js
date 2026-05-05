import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志等級 & 基礎日志函數
// ==========================================
let logLevel = 2; // 0:silent, 1:basic, 2:detailed, 3:debug
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const prefix = `[${time}]`;
    const fullMsg = `${prefix} ${msg}`;
    if (type === 'warn') {
        console.warn(`%c[DS V4 Pro Opt] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS V4 Pro Opt] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS V4 Pro Opt] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
// 核心：指紋與 Token 估算
// ==========================================
function normalizeForFingerprint(text) {
    return text.replace(/\s+/g, ' ').trim();
}

function simpleHash(str) {
    str = normalizeForFingerprint(str);
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
// 緩存狀態機 (極簡化但強大的自動順推列)
// ==========================================
const CacheState = {
    enabled: true,
    lockedSequence: [], // 保存已凍結的模塊 { hash, role, content, type }
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// ==========================================
// 智能分類系統 (不依賴位置，只依賴內容特徵)
// ==========================================
function classifySystemBlock(content, context) {
    if (!content) return 'System';
    const lower = content.toLowerCase();
    
    // 基礎提示詞檢測
    if (lower.includes('write next reply') || lower.includes('char\'s next reply') || lower.includes('avoid impersonation') || lower.includes('roleplay')) {
        return 'DefaultPrompt';
    }
    
    // 從當前角色卡中動態識別預設提示詞
    let char = null;
    if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
        char = context.characters[context.characterId];
        if (char.description && char.description.trim().length > 10 && content.includes(char.description.trim().substring(0, 20))) return 'DefaultPrompt';
        if (char.personality && char.personality.trim().length > 10 && content.includes(char.personality.trim().substring(0, 20))) return 'DefaultPrompt';
        if (char.scenario && char.scenario.trim().length > 10 && content.includes(char.scenario.trim().substring(0, 20))) return 'DefaultPrompt';
    }
    
    if (context.persona_description && context.persona_description.trim().length > 10 && content.includes(context.persona_description.trim().substring(0, 20))) {
        return 'DefaultPrompt';
    }
    
    // 無法命中基礎角色特徵的，大概率為世界書或其他動態注入的插件
    return 'WorldBook';
}

// ==========================================
// 核心模塊：拆解、提取與重新格式化 ST 原始請求
// ==========================================
function extractBlocks(dataChat, context) {
    const incomingBlocks = [];
    const rawHistory = context.chat || [];
    
    // 建立歷史真實記錄本
    let historyItems = rawHistory.map(m => ({
        role: m.is_user ? 'user' : 'assistant',
        content: m.mes.trim(),
        is_current: false
    })).filter(m => m.content.length > 0);
    
    // 標記最末尾的用戶對話為「當前輸入」
    for (let i = historyItems.length - 1; i >= 0; i--) {
        if (historyItems[i].role === 'user') {
            historyItems[i].is_current = true;
            break;
        }
    }

    let matchedHistoryIndices = new Set();

    dataChat.forEach((msg, msgIndex) => {
        let text = msg.content || '';
        if (!text.trim()) return;

        let foundHistories = [];
        // 尋找並切割出精確的歷史記錄，對抗ST的 Prompt Post-Processing 合併
        historyItems.forEach((hi, hiIndex) => {
            if (matchedHistoryIndices.has(hiIndex)) return; 
            
            if (hi.content.length < 10) { // 過短內容要求精確匹配，避免誤傷提示詞
                if (text.trim() === hi.content) {
                    foundHistories.push({ ...hi, index: text.indexOf(hi.content), origIndex: hiIndex });
                }
            } else {
                let idx = text.indexOf(hi.content);
                if (idx !== -1) {
                    foundHistories.push({ ...hi, index: idx, origIndex: hiIndex });
                }
            }
        });
        
        // 解決重疊區間
        foundHistories.sort((a, b) => a.index - b.index);
        let validHistories = [];
        let lastValidEnd = 0;
        foundHistories.forEach(fh => {
            if (fh.index >= lastValidEnd) {
                validHistories.push(fh);
                matchedHistoryIndices.add(fh.origIndex);
                lastValidEnd = fh.index + fh.content.length;
            }
        });

        let lastIndex = 0;
        validHistories.forEach(fh => {
            let beforeText = text.substring(lastIndex, fh.index).trim();
            if (beforeText) {
                incomingBlocks.push({ role: 'system', content: beforeText, type: 'System' }); // ST底層混合物均視為 System
            }
            let bType = fh.is_current ? 'Current_User' : (fh.role === 'user' ? 'History_User' : 'History_AI');
            incomingBlocks.push({ role: fh.role, content: fh.content, type: bType });
            lastIndex = fh.index + fh.content.length;
        });
        
        let afterText = text.substring(lastIndex).trim();
        if (afterText) {
            // 判斷是否為預填充 (末尾assistant) 或 兜底的當前用戶輸入
            if (msg.role === 'assistant' && msgIndex === dataChat.length - 1 && lastIndex === 0) {
                 incomingBlocks.push({ role: 'assistant', content: afterText, type: 'Prefill' });
            } else if (msg.role === 'user' && msgIndex === dataChat.length - 1 && lastIndex === 0) {
                 incomingBlocks.push({ role: 'user', content: afterText, type: 'Current_User' });
            } else if (msg.role === 'user' && msgIndex === dataChat.length - 2 && lastIndex === 0 && dataChat[dataChat.length-1].role === 'assistant') {
                 incomingBlocks.push({ role: 'user', content: afterText, type: 'Current_User' });
            } else {
                 incomingBlocks.push({ role: msg.role, content: afterText, type: 'System' });
            }
        }
    });

    // 智能子分類與去重 (重複的提示詞只保留一次)
    const uniqueBlocks = [];
    const seen = new Set();
    incomingBlocks.forEach(block => {
        if (block.type === 'System') {
            block.type = classifySystemBlock(block.content, context);
            block.role = 'system'; // 強制標準化
        }
        
        block.hash = simpleHash(block.content + block.type);
        
        if (!seen.has(block.hash)) {
            seen.add(block.hash);
            uniqueBlocks.push(block);
        }
    });

    return uniqueBlocks;
}

// ==========================================
// 最終攔截與序列重組
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`[攔截器] #${CacheState.stats.total} 啟動：執行 Deepseek 前綴極限匹配優化...`);

        if (!data?.chat?.length) return;

        const context = getContext();
        const incomingBlocks = extractBlocks(data.chat, context);
        
        let currentLocked = [];
        let missingTokens = 0;
        let originalLockedTokens = 0;
        
        // 1. 校對並延續已凍結序列 (自動順推)
        CacheState.lockedSequence.forEach(lockedBlock => {
            originalLockedTokens += estimateTokens(lockedBlock.content);
            const foundIndex = incomingBlocks.findIndex(b => b.hash === lockedBlock.hash);
            if (foundIndex !== -1) {
                currentLocked.push(lockedBlock);
                incomingBlocks.splice(foundIndex, 1); // 標記為已處理
            } else {
                missingTokens += estimateTokens(lockedBlock.content);
                // 丟失的提示詞將被自動剔除，後面的模塊自然向前「順推」！完美保留命中率。
            }
        });
        
        // 大範圍刪減檢測 (超過50%或切換角色卡)，彈窗並自動重置
        if (originalLockedTokens > 200 && missingTokens > (originalLockedTokens * 0.4)) {
            Logger.warn(`檢測到提示詞發生大範圍變更 (${missingTokens}/${originalLockedTokens} tokens missing)，自動重置緩存核心！`, LogLevels.BASIC);
            if (typeof toast === 'function') toast({ title: 'DS V4 Cache Opt', text: '提示詞發生大範圍變更，已自動重置自適應核心！' });
            
            CacheState.lockedSequence = [];
            currentLocked = [];
            incomingBlocks.length = 0;
            incomingBlocks.push(...extractBlocks(data.chat, context)); // 重新提取全新狀態
        }

        // 2. 分離全新出現的模塊
        const newHistory = incomingBlocks.filter(b => b.type === 'History_User' || b.type === 'History_AI');
        const newDefault = incomingBlocks.filter(b => b.type === 'DefaultPrompt');
        const newWorldBook = incomingBlocks.filter(b => b.type === 'WorldBook' || b.type === 'System');
        const newCurrentUser = incomingBlocks.filter(b => b.type === 'Current_User');
        const newPrefill = incomingBlocks.filter(b => b.type === 'Prefill');

        const finalSequence = [];
        
        // ----------------------------------------------------
        // 嚴格遵從的極致緩存排序邏輯 (永遠只在尾部添加變量)
        // ----------------------------------------------------
        
        // A. 首先壓入上一輪已經完全凍結的所有內容 (不破壞任何既有緩存)
        finalSequence.push(...currentLocked);
        
        // B. 壓入新產生的歷史記錄 (成為新的凍結體)
        finalSequence.push(...newHistory);
        
        // C. 壓入新增加的預設提示詞或世界書 (動態加在歷史後面，保障舊歷史緩存100%命中)
        finalSequence.push(...newDefault);
        finalSequence.push(...newWorldBook);
        
        // 記錄下一次需要被「凍結」的序列快照
        CacheState.lockedSequence = [...finalSequence];
        
        // D. 壓入瞬態的模塊 (當前用戶輸入及預填充)
        finalSequence.push(...newCurrentUser);
        finalSequence.push(...newPrefill);

        // ----------------------------------------------------
        
        // 計算統計數據
        const finalTokens = finalSequence.reduce((acc, b) => acc + estimateTokens(b.content), 0);
        const lockedTokens = currentLocked.reduce((acc, b) => acc + estimateTokens(b.content), 0);
        
        if (lockedTokens > 0) {
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += lockedTokens;
            Logger.log(`✅ 完美命中！前置無損鎖定: ~${lockedTokens} tokens, 總計消耗: ~${finalTokens} tokens`, LogLevels.BASIC);
        } else {
            Logger.warn(`⚠️ 建立初次完整緩存 (首次對話或已被重置)`);
        }
        
        CacheState.stats.prefixTokens = lockedTokens;

        // 3. 回填改寫至 ST底層 (嚴禁合併，確保一條一條絕對獨立)
        data.chat.splice(0, data.chat.length);
        finalSequence.forEach(block => {
            data.chat.push({ role: block.role, content: block.content });
        });

        if (logLevel >= LogLevels.DEBUG) {
            Logger.log(`最終排序檢查: \n${finalSequence.map(b => `[${b.type}] ${b.role}(${b.content.length}字)`).join('\n')}`, LogLevels.DEBUG);
        }
        
        updateStatsUI();

    } catch (err) {
        Logger.error('攔截器發生致命錯誤', err);
    }
}

// ==========================================
// UI 與統計面板
// ==========================================
function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `
        <span>自適應命中: ${hits}/${total} (${rate}%)</span>
        <span style="margin-left:10px;">保護前綴: ~${prefixTokens.toLocaleString()}t</span>
        <span style="margin-left:10px;">總節省: ~${savedTokens.toLocaleString()}t</span>
    `;
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DS V4 Cache Optimizer Pro</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">自適應核心鎖定機制，針對Deepseek緩存機制進行接近100%免設置命中率優化。</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;color:#00ff00;font-weight:bold;"></div>
                <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" id="ds-cache-enable" checked> 啟用極限緩存攔截器
                </label>
                <div style="display:flex;align-items:center;gap:8px;margin:8px 0;">
                    <span style="font-size:0.9em;">日志等級:</span>
                    <select id="ds-cache-loglevel" style="flex:1;">
                        <option value="0">關閉</option>
                        <option value="1">簡要</option>
                        <option value="2" selected>詳細</option>
                        <option value="3">調試 (DEBUG)</option>
                    </select>
                </div>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 強制重置靜態核心 (通常無需手動)</button>
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
            Logger.log(`日志等級設為: ${['關閉','簡要','詳細','調試'][logLevel]}`, LogLevels.BASIC);
        });
        $('#ds-cache-reset').on('click', () => {
            CacheState.lockedSequence = [];
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateStatsUI();
            Logger.warn('已手動重置所有緩存與序列', LogLevels.BASIC);
            if (typeof toast === 'function') toast({ title: 'DS V4', text: '已強制清除所有自適應鎖定！' });
        });
        updateStatsUI();
    } catch (e) {
        Logger.error('UI初始化失敗', e);
    }
}

// ==========================================
// 啟動掛載
// ==========================================
jQuery(async () => {
    console.log('DS V4 Optimizer Pro loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('已掛載深層事件鉤子，隨時攔截ST源碼', LogLevels.BASIC);
    } else {
        Logger.error('無法掛載事件鉤子');
    }
    Logger.log('══════ Pro版 就緒，自適應動態增量凍結 ══════', LogLevels.BASIC);
});
