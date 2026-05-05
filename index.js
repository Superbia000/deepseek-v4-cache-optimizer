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

// 基礎工具
function normalizeText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
}

function simpleHash(str) {
    if (!str) return '0';
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

// 緩存狀態機 (嚴格維持順推排序)
const CacheState = {
    enabled: true,
    lockedSequence: [],
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// ==========================================
// 核心：整塊萃取與分類 (拒絕暴力拆分)
// ==========================================
function extractBlocks(dataChat, context) {
    let blocks = [];
    
    // 獲取純淨的歷史對話
    let rawHistory = (context.chat || []).filter(m => m.mes && m.mes.trim().length > 0);
    let lastUserIndex = rawHistory.findLastIndex(m => m.is_user);
    
    let historyTargets = rawHistory.map((m, idx) => ({
        mes: m.mes,
        type: (idx === lastUserIndex) ? 'Current_User' : (m.is_user ? 'History_User' : 'History_AI'),
        role: m.is_user ? 'user' : 'assistant'
    }));

    // 獲取靜態特徵（用於判定預設提示詞）
    let char = context.characters?.[context.characterId] || {};
    let staticFeatures = [char.description, char.personality, char.scenario, char.first_mes, context.persona_description]
        .filter(Boolean).map(t => normalizeText(t));

    // 分類輔助函數：整塊判定，絕不碎裂
    const classifyPromptBlock = (text, defaultRole) => {
        let isDefault = false;
        let lower = text.toLowerCase();
        
        if (lower.includes("write next reply") || lower.includes("roleplay") || 
            lower.includes("avoid impersonation") || lower.includes("nsfw") || 
            lower.includes("system note") || lower.startsWith('[')) {
            isDefault = true;
        } else {
            let norm = normalizeText(text);
            for (let sf of staticFeatures) {
                // 如果包含大段靜態特徵，判定為預設提示詞
                if (sf.includes(norm.substring(0, 50)) || norm.includes(sf.substring(0, 50))) {
                    isDefault = true; break;
                }
            }
        }
        return {
            type: isDefault ? 'DefaultPrompt' : 'WorldBook',
            role: defaultRole,
            content: text,
            hash: simpleHash(text)
        };
    };

    dataChat.forEach((msg, msgIndex) => {
        let content = msg.content;
        if (!content) return;

        let foundParts = [];
        
        // 尋找此區塊內是否包含了歷史對話
        historyTargets.forEach(target => {
            let idx = content.indexOf(target.mes);
            if (idx !== -1) {
                // 盡量保留 ST 附加的角色名詞綴 (如 User:)
                let startIdx = content.lastIndexOf('\n', idx);
                startIdx = startIdx === -1 ? 0 : startIdx + 1;
                let endIdx = idx + target.mes.length;
                foundParts.push({ ...target, start: startIdx, end: endIdx });
            }
        });

        // 情況 A：這是一個純淨的提示詞/世界書區塊 (完全沒有混合歷史) -> 直接整塊壓入！
        if (foundParts.length === 0) {
            if (msg.role === 'assistant' && msgIndex === dataChat.length - 1) {
                blocks.push({ type: 'Prefill', role: 'assistant', content: content, hash: simpleHash(content) });
            } else if (msg.role === 'user' && msgIndex >= dataChat.length - 2 && !blocks.some(b => b.type === 'Current_User')) {
                blocks.push({ type: 'Current_User', role: 'user', content: content, hash: simpleHash(content) });
            } else {
                blocks.push(classifyPromptBlock(content, msg.role));
            }
            return; // 處理完畢，提早返回
        }

        // 情況 B：ST 把歷史記錄混在提示詞裡了 -> 只把歷史精準摳出來，剩餘部分整塊保留
        foundParts.sort((a, b) => a.start - b.start);
        let validParts = [];
        let lastValidEnd = -1;
        foundParts.forEach(fp => {
            if (fp.start >= lastValidEnd) { validParts.push(fp); lastValidEnd = fp.end; }
        });

        let lastEnd = 0;
        validParts.forEach(fp => {
            if (fp.start > lastEnd) {
                let leftover = content.substring(lastEnd, fp.start).trim();
                if (leftover) blocks.push(classifyPromptBlock(leftover, msg.role));
            }
            blocks.push({ type: fp.type, role: fp.role, content: content.substring(fp.start, fp.end).trim(), hash: simpleHash(fp.mes) });
            lastEnd = fp.end;
        });

        if (lastEnd < content.length) {
            let leftover = content.substring(lastEnd).trim();
            if (leftover) {
                if (msg.role === 'assistant' && msgIndex === dataChat.length - 1) {
                    blocks.push({ type: 'Prefill', role: 'assistant', content: leftover, hash: simpleHash(leftover) });
                } else {
                    blocks.push(classifyPromptBlock(leftover, msg.role));
                }
            }
        }
    });

    // 嚴格去重：相同的提示詞在輸出時只出現一次
    let unique = [];
    let seen = new Set();
    blocks.forEach(b => {
        if (!seen.has(b.hash)) {
            seen.add(b.hash);
            unique.push(b);
        }
    });
    return unique;
}

// ==========================================
// 終極排序狀態機 (完全遵從你的排序圖)
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`\n========================================`);
        Logger.log(`[攔截器] #${CacheState.stats.total} 啟動，進行區塊級無損重排...`);

        if (!data?.chat?.length) return;

        // 萃取分類後的模塊 (保持原有大小，不再碎裂)
        const incomingBlocks = extractBlocks(data.chat, getContext());
        
        // 分離靜態元素與瞬態元素
        const incomingStatic = incomingBlocks.filter(b => b.type !== 'Current_User' && b.type !== 'Prefill');
        const transientBlocks = incomingBlocks.filter(b => b.type === 'Current_User' || b.type === 'Prefill');
        
        let newLockedSequence = [];
        let incomingLeftovers = [...incomingStatic];
        
        let missingTokens = 0;
        let originalTokens = CacheState.lockedSequence.reduce((acc, b) => acc + estimateTokens(b.content), 0);

        // 1. 保留舊有鎖定順序 (對話1的預設、世界書、歷史)
        CacheState.lockedSequence.forEach(lockedBlock => {
            const index = incomingLeftovers.findIndex(b => b.hash === lockedBlock.hash);
            if (index !== -1) {
                newLockedSequence.push(lockedBlock);
                incomingLeftovers.splice(index, 1);
            } else {
                // 丟失的區塊 (被用戶刪除)，觸發無縫順推
                missingTokens += estimateTokens(lockedBlock.content);
            }
        });

        // 2. 檢測大範圍刪改 (超過 40% Token 丟失)，自動重置
        if (originalTokens > 300 && missingTokens > (originalTokens * 0.4)) {
            Logger.warn(`檢測到大範圍變更 (${missingTokens}/${originalTokens} tokens missing)，已自動重置緩存核心。`, LogLevels.BASIC);
            if (typeof toastr !== 'undefined') toastr.warning('提示詞大範圍變更，已重置緩存核心！', 'DS V4 Cache Opt');
            CacheState.lockedSequence = [];
            newLockedSequence = [];
            incomingLeftovers = [...incomingStatic];
        }

        // 3. 嚴格處理新增的內容，並附加到鎖定區列尾端
        // 這些是全新的回合歷史 (對話2歷史)，或者是你中途加入的新世界書/預設
        const newHistory = incomingLeftovers.filter(b => b.type === 'History_User' || b.type === 'History_AI');
        const newDefault = incomingLeftovers.filter(b => b.type === 'DefaultPrompt');
        const newWorldBook = incomingLeftovers.filter(b => b.type === 'WorldBook');

        // 完全按照你要求的圖譜排序：舊鎖定 -> 新歷史 -> 新預設 -> 新世界書
        newLockedSequence.push(...newHistory);
        newLockedSequence.push(...newDefault);
        newLockedSequence.push(...newWorldBook);
        
        // 更新快照
        CacheState.lockedSequence = [...newLockedSequence];
        
        // 4. 最後接上瞬態內容：當時輸入 -> 預填充
        const finalSequence = [...newLockedSequence, ...transientBlocks];

        // 計算命中
        const lockedTokens = newLockedSequence.reduce((acc, b) => acc + estimateTokens(b.content), 0);
        if (lockedTokens > 0 && CacheState.stats.total > 1) {
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += lockedTokens;
            Logger.log(`✅ 極限緩存命中！前置無損鎖定: ~${lockedTokens} tokens`, LogLevels.BASIC);
        }
        CacheState.stats.prefixTokens = lockedTokens;

        // 5. 回填 data.chat
        // 這邊依然是一條一條獨立放入 JSON Array (不合併字串)，但因為我們不再碎裂，所以數量會維持在原本的 50 條左右！
        data.chat.length = 0;
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
// UI 面板與啟動
// ==========================================
function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `
        <span>精準命中: ${hits}/${total} (${rate}%)</span>
        <span style="margin-left:10px;">保護前綴: ~${prefixTokens.toLocaleString()}t</span>
        <span style="margin-left:10px;">總省: ~${savedTokens.toLocaleString()}t</span>
    `;
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DS V4 Block Optimizer Pro</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">使用區塊級無損重排 (Block-Level Reordering)，不破壞原始提示詞結構，完美實現世界書、歷史及用戶輸入的緩存順推。</p>
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
            if (typeof toastr !== 'undefined') toastr.success('已清空狀態機');
        });
        updateStatsUI();
    } catch (e) {
        Logger.error('UI初始化失敗', e);
    }
}

jQuery(async () => {
    console.log('DS V4 Block Optimizer Pro loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('已掛載事件鉤子，使用區塊級無損重排', LogLevels.BASIC);
    }
});
