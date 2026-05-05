import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

let logLevel = 2; // 0:silent, 1:basic, 2:detailed, 3:debug
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const prefix = `[${time}]`;
    const fullMsg = `${prefix} ${msg}`;
    if (type === 'warn') console.warn(`%c[DS V4 Opt] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    else if (type === 'error') console.error(`[DS V4 Opt] 🔴 ${msg}`);
    else console.log(`%c[DS V4 Opt] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
// 基礎工具
// ==========================================
function normalizeText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
}

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}

function estimateTokens(text) {
    if (!text) return 0;
    let tokens = 0;
    for (const ch of text) tokens += ch.charCodeAt(0) > 0x3000 ? 1 : 0.25;
    return Math.ceil(tokens);
}

// 緩存狀態機
const CacheState = {
    enabled: true,
    lockedSequence: [], // 永遠凍結的絕對順序陣列
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// ==========================================
// 第一階段：原子化分離 (Atomic Carving)
// 從 ST 揉碎的 data.chat 中完美切割出各個獨立模塊
// ==========================================
function extractAtomicBlocks(dataChat, context) {
    let atomicBlocks = [];
    
    // 1. 建立真實歷史副本，精確標定「當時用戶輸入」
    let rawHistory = (context.chat || []).filter(m => m.mes && m.mes.trim().length > 0);
    let lastUserIndex = rawHistory.findLastIndex(m => m.is_user);
    
    let historyTargets = rawHistory.map((m, idx) => ({
        mes: m.mes,
        type: (idx === lastUserIndex) ? 'Current_User' : (m.is_user ? 'History_User' : 'History_AI'),
        role: m.is_user ? 'user' : 'assistant'
    }));

    // 獲取當前角色的靜態文本（用於區分預設和世界書）
    let char = context.characters?.[context.characterId] || {};
    let staticFeatures = [
        char.description, char.personality, char.scenario, char.first_mes, context.persona_description
    ].filter(Boolean).map(t => normalizeText(t));

    dataChat.forEach((msg, msgIndex) => {
        let content = msg.content;
        if (!content) return;

        let foundParts = [];
        
        // 2. 利用 indexOf 進行精準切割 (Carving)
        historyTargets.forEach(target => {
            let idx = content.indexOf(target.mes);
            if (idx !== -1) {
                // 為了保留 ST 加入的 "User:" 或 "Char:" 等前綴，我們向前尋找換行符
                let startIdx = content.lastIndexOf('\n', idx);
                startIdx = startIdx === -1 ? 0 : startIdx + 1;
                let endIdx = idx + target.mes.length;
                foundParts.push({ ...target, start: startIdx, end: endIdx });
            }
        });

        // 解決可能出現的重疊
        foundParts.sort((a, b) => a.start - b.start);
        let validParts = [];
        let lastValidEnd = -1;
        foundParts.forEach(fp => {
            if (fp.start >= lastValidEnd) {
                validParts.push(fp);
                lastValidEnd = fp.end;
            }
        });

        let lastEnd = 0;
        
        // 3. 處理被切碎的邊緣文本 (這些就是 System/WorldBook 提示詞)
        const processLeftovers = (text) => {
            let lines = text.split('\n');
            lines.forEach(line => {
                let t = line.trim();
                if (!t) return;
                
                let isDefault = false;
                let lower = t.toLowerCase();
                
                // ST 底層提示詞特徵
                if (lower.includes("write next reply") || lower.includes("roleplay") || 
                    lower.includes("avoid impersonation") || lower.includes("nsfw") || 
                    lower.includes("system note") || lower.includes("description") || 
                    lower.startsWith('[')) {
                    isDefault = true;
                } else {
                    // 相似度特徵匹配：如果包含在角色卡或 Persona 中，則是預設提示詞
                    for (let sf of staticFeatures) {
                        if (sf.includes(t) || t.includes(sf.substring(0, 30))) {
                            isDefault = true; break;
                        }
                    }
                }
                
                // 否則，這 100% 是一條動態加載的世界書或插件提示詞！
                atomicBlocks.push({
                    type: isDefault ? 'DefaultPrompt' : 'WorldBook',
                    role: 'system',
                    content: t  // 遂條輸出，絕對不合併！
                });
            });
        };

        // 依序壓入：邊角料 -> 歷史文本 -> 邊角料
        validParts.forEach(fp => {
            if (fp.start > lastEnd) {
                processLeftovers(content.substring(lastEnd, fp.start));
            }
            atomicBlocks.push({
                type: fp.type,
                role: fp.role,
                content: content.substring(fp.start, fp.end).trim()
            });
            lastEnd = fp.end;
        });

        if (lastEnd < content.length) {
            let afterText = content.substring(lastEnd).trim();
            if (afterText) {
                // 如果是陣列的最後一塊，且 ST 標記為 assistant，這就是預填充
                if (msg.role === 'assistant' && msgIndex === dataChat.length - 1 && validParts.length === 0) {
                    atomicBlocks.push({ type: 'Prefill', role: 'assistant', content: afterText });
                } else if (msg.role === 'user' && msgIndex >= dataChat.length - 2 && validParts.length === 0 && !atomicBlocks.some(b => b.type === 'Current_User')) {
                    // ST 某些插件導致的未識別用戶輸入兜底
                    atomicBlocks.push({ type: 'Current_User', role: 'user', content: afterText });
                } else {
                    processLeftovers(afterText);
                }
            }
        }
    });

    // 4. 去重與計算哈希 (確保重複的提示詞只出現一次)
    let unique = [];
    let seen = new Set();
    atomicBlocks.forEach(b => {
        b.hash = simpleHash(b.content + b.type);
        if (!seen.has(b.hash)) {
            seen.add(b.hash);
            unique.push(b);
        }
    });

    return unique;
}

// ==========================================
// 最終攔截與極限重排
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`\n========================================`);
        Logger.log(`[攔截器] #${CacheState.stats.total} 執行精準重排...`);

        if (!data?.chat?.length) return;

        // 獲取原子化後的提示詞陣列 (已精確分類為 DefaultPrompt, WorldBook, History, Current_User 等)
        const incomingBlocks = extractAtomicBlocks(data.chat, getContext());
        
        // 分離出靜態元素和瞬態元素
        const incomingStatic = incomingBlocks.filter(b => b.type !== 'Current_User' && b.type !== 'Prefill');
        const transientBlocks = incomingBlocks.filter(b => b.type === 'Current_User' || b.type === 'Prefill');
        
        let newLockedSequence = [];
        let missingTokens = 0;
        let originalTokens = CacheState.lockedSequence.reduce((acc, b) => acc + estimateTokens(b.content), 0);
        
        let incomingLeftovers = [...incomingStatic];

        // 1. 校對並延續舊有的鎖定陣列 (只要沒被刪除，就留在原地)
        CacheState.lockedSequence.forEach(lockedBlock => {
            const index = incomingLeftovers.findIndex(b => b.hash === lockedBlock.hash);
            if (index !== -1) {
                newLockedSequence.push(lockedBlock);
                incomingLeftovers.splice(index, 1); // 標記為已處理
            } else {
                // 用戶刪除或超出 ST Context 的內容自動被拋棄，後方內容「自動順推」
                missingTokens += estimateTokens(lockedBlock.content);
            }
        });
        
        // 2. 檢測大範圍刪改 (大於40%的 Token 丟失)，觸發重置並發出彈窗
        if (originalTokens > 300 && missingTokens > (originalTokens * 0.4)) {
            Logger.warn(`大範圍刪減檢測 (${missingTokens}/${originalTokens} tokens missing)，自動重置緩存狀態機！`, LogLevels.BASIC);
            if (typeof toastr !== 'undefined') toastr.warning('提示詞發生大範圍變更，已自動重置緩存核心！', 'DS V4 Cache Opt');
            
            CacheState.lockedSequence = [];
            newLockedSequence = [];
            incomingLeftovers = [...incomingStatic]; // 重新接管所有靜態模塊
        }

        // 3. 嚴格分類所有「新增加」的靜態內容
        const addedHistory = incomingLeftovers.filter(b => b.type === 'History_User' || b.type === 'History_AI');
        const addedDefault = incomingLeftovers.filter(b => b.type === 'DefaultPrompt');
        const addedWorldBook = incomingLeftovers.filter(b => b.type === 'WorldBook');

        // 4. 嚴格執行你的排序要求！
        // 舊鎖定 -> 新增加的歷史 -> 新增加的預設 -> 新增加的世界書
        newLockedSequence.push(...addedHistory);
        newLockedSequence.push(...addedDefault);
        newLockedSequence.push(...addedWorldBook);
        
        // 更新狀態機快照
        CacheState.lockedSequence = [...newLockedSequence];
        
        // 5. 將瞬態內容 (當時輸入、預填充) 壓入最尾端
        const finalSequence = [...newLockedSequence, ...transientBlocks];

        // 計算統計數據
        const lockedTokens = newLockedSequence.reduce((acc, b) => acc + estimateTokens(b.content), 0);
        if (lockedTokens > 0 && CacheState.stats.total > 1) {
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += lockedTokens;
            Logger.log(`✅ 緩存順推成功！安全鎖定: ~${lockedTokens} tokens`, LogLevels.BASIC);
        }
        CacheState.stats.prefixTokens = lockedTokens;

        // 6. 回填到 data.chat (遂條輸出，絕不合併！)
        data.chat.splice(0, data.chat.length);
        finalSequence.forEach(block => {
            data.chat.push({ role: block.role, content: block.content });
        });

        if (logLevel >= LogLevels.DEBUG) {
            let trace = finalSequence.map(b => `[${b.type}] ${b.role}: ${b.content.substring(0, 20).replace(/\n/g, '')}...`).join('\n');
            Logger.log(`最終排序檢查 (共 ${finalSequence.length} 條):\n${trace}`, LogLevels.DEBUG);
        }
        
        updateStatsUI();

    } catch (err) {
        Logger.error('攔截器發生致命錯誤', err);
    }
}

// ==========================================
// UI 與啟動配置
// ==========================================
function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `
        <span>精準命中: ${hits}/${total} (${rate}%)</span>
        <span style="margin-left:10px;">保護前綴: ~${prefixTokens.toLocaleString()}t</span>
        <span style="margin-left:10px;">累計省下: ~${savedTokens.toLocaleString()}t</span>
    `;
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DS V4 Atomic Optimizer Pro</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">使用原子化切割技術，無視ST排序設定，完美分離並順推世界書、歷史及用戶輸入。</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;color:#00ff00;font-weight:bold;"></div>
                <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" id="ds-cache-enable" checked> 啟用極限緩存攔截器
                </label>
                <div style="display:flex;align-items:center;gap:8px;margin:8px 0;">
                    <span style="font-size:0.9em;">日誌等級:</span>
                    <select id="ds-cache-loglevel" style="flex:1;">
                        <option value="0">關閉</option>
                        <option value="1">簡要</option>
                        <option value="2" selected>詳細</option>
                        <option value="3">除錯 (DEBUG)</option>
                    </select>
                </div>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 強制重置靜態核心 (通常無需手動)</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');
        $('#ds-cache-enable').on('change', function() { CacheState.enabled = $(this).is(':checked'); });
        $('#ds-cache-loglevel').on('change', function() { logLevel = parseInt($(this).val()); });
        $('#ds-cache-reset').on('click', () => {
            CacheState.lockedSequence = [];
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateStatsUI();
            if (typeof toastr !== 'undefined') toastr.success('已清空緩存狀態機');
        });
        updateStatsUI();
    } catch (e) {
        Logger.error('UI初始化失敗', e);
    }
}

jQuery(async () => {
    console.log('DS V4 Atomic Optimizer Pro loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('已掛載事件鉤子，使用原子化切割模式', LogLevels.BASIC);
    } else {
        Logger.error('無法掛載事件鉤子');
    }
});
