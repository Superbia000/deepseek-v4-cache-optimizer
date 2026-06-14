import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced, substituteParams, substituteParamsExtended } from '../../../../script.js';

// ==========================================
// 🧠 ST API 中繼層 — 全部使用動態 import() 避免載入時序問題
// ==========================================
function getSTContext() { try { return getContext(); } catch (e) { return null; } }

/**
 * 使用動態 import 安全讀取 promptManager 的提示詞陣列
 * @returns {Promise<Array|null>}
 */
async function getSTPromptList() {
    try {
        // 動態導入，僅在需要時加載
        const openaiMod = await import('../../../openai.js');
        if (openaiMod?.promptManager?.serviceSettings?.prompts) {
            return openaiMod.promptManager.serviceSettings.prompts;
        }
        // fallback: oai_settings 可能也有
        if (openaiMod?.oai_settings?.prompts) {
            return openaiMod.oai_settings.prompts;
        }
    } catch (e) { console.debug('[DS Cache] 無法動態導入 openai.js:', e.message); }
    return null;
}

/**
 * 使用動態 import 安全讀取 world_info 中的所有條目
 * @returns {Promise<Map<string, {worldBookName, entryName, uid, entry}>>}
 */
async function getSTWorldInfoEntries() {
    const result = new Map();
    try {
        const wiMod = await import('../../../world-info.js');
        const wi = wiMod?.world_info;
        const cache = wiMod?.worldInfoCache;

        console.debug(`[DS Cache] 📚 world_info keys: ${wi ? Object.keys(wi).join(', ') : 'null'}, cache: ${!!cache}`);

        // 方法1: 從 worldInfoCache 讀取（ST 1.18.0 的延遲加載快取）
        if (cache && typeof cache.get === 'function') {
            const worldNames = Array.isArray(wiMod?.world_names) ? wiMod.world_names : [];
            console.debug(`[DS Cache] 📚 world_names: ${worldNames.join(', ')}`);
            for (const worldName of worldNames) {
                try {
                    const worldData = cache.get(worldName);
                    if (worldData?.entries && typeof worldData.entries === 'object') {
                        for (const [uid, entry] of Object.entries(worldData.entries)) {
                            if (!entry?.content || typeof entry.content !== 'string') continue;
                            const norm = CoreEngine.normalize(entry.content);
                            if (norm.length < 2) continue;
                            let entryName = entry.comment || '';
                            if (!entryName && Array.isArray(entry.key) && entry.key.length > 0) entryName = entry.key[0];
                            if (!entryName) entryName = `Entry_${uid}`;
                            const mapKey = `${worldName}::${norm}`;
                            if (!result.has(mapKey)) {
                                result.set(mapKey, { worldBookName: worldName, entryName, uid, entry });
                            }
                        }
                    }
                } catch (e) { /* skip failed world */ }
            }
        }

        // 方法2: 從 world_info 直接讀取（已加載的世界書）
        if (result.size === 0 && wi && typeof wi === 'object') {
            for (const [bookName, bookData] of Object.entries(wi)) {
                if (bookName === 'globalSelect') continue; // 跳過元數據
                if (!bookData?.entries || typeof bookData.entries !== 'object') continue;
                for (const [uid, entry] of Object.entries(bookData.entries)) {
                    if (!entry?.content || typeof entry.content !== 'string') continue;
                    const norm = CoreEngine.normalize(entry.content);
                    if (norm.length < 2) continue;
                    let entryName = entry.comment || '';
                    if (!entryName && Array.isArray(entry.key) && entry.key.length > 0) entryName = entry.key[0];
                    if (!entryName) entryName = `Entry_${uid}`;
                    const mapKey = `${bookName}::${norm}`;
                    if (!result.has(mapKey)) {
                        result.set(mapKey, { worldBookName: bookName, entryName, uid, entry });
                    }
                }
            }
        }
    } catch (e) { console.debug('[DS Cache] 無法讀取世界書:', e.message); }
    return result;
}

// ==========================================

// ==========================================
// 狀態與設定 (Settings & State)
// ==========================================
let Settings = {};

function initSettings() {
    const defaultSettings = { enabled: true, instantNotify: true, logLevel: 3, chats: {} };
    if (!extension_settings.ds_cache_v36_absolute) extension_settings.ds_cache_v36_absolute = defaultSettings;
    Settings = Object.assign({}, defaultSettings, extension_settings.ds_cache_v36_absolute);
}

function safeSave() {
    try { 
        extension_settings.ds_cache_v36_absolute = Settings;
        if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced(); 
    } catch (e) { console.warn("[DS Cache] 存檔失敗", e); }
}

// ==========================================
// 深度日誌系統 (GPU 加速 & 批次渲染)
// ==========================================
const LogLevels = { OFF: 0, BASIC: 1, STANDARD: 2, DETAILED: 3, EXTREME: 4 };
let rawMarkdownLogs = [];
let logQueue = [];
let logRenderTimer = null;
const MAX_LOG_ENTRIES = 500; 

const Logger = {
    _uiViewer: null,
    getTime: () => {
        const now = new Date();
        return `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
    },
    truncate: (text, maxLen = 30) => {
        if (!text) return '';
        const clean = text.replace(/[\n\r]/g, ' ');
        return clean.length > maxLen ? clean.substring(0, maxLen) + '...' : clean;
    },
    write: (markdownText, level = LogLevels.STANDARD) => {
        if (Settings.logLevel < level) return;
        const entry = `${markdownText}\n`;
        
        rawMarkdownLogs.push(entry);
        if (rawMarkdownLogs.length > MAX_LOG_ENTRIES) rawMarkdownLogs.shift();
        
        Logger.queueUIUpdate(entry);
        if (level === LogLevels.EXTREME) console.log(`[DS Cache EXTREME]`, markdownText);
    },
    queueUIUpdate: (newEntry) => {
        if (!Logger._uiViewer) return;
        let html = newEntry.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/^- (.*)/gm, '<li>$1</li>');
        if (html.includes('|')) {
            const lines = html.split('\n');
            let tableHtml = '<div class="ds-ui-log-container"><table class="ds-ui-log-table">';
            let inTable = false, isFirstRow = true;
            for (let line of lines) {
                if (line.trim().startsWith('|')) {
                    if (!inTable) inTable = true;
                    const cells = line.split('|').filter(c => c.trim() !== '');
                    if (line.includes('---')) continue;
                    if (isFirstRow) { tableHtml += '<tr>' + cells.map(c => `<th>${c.trim()}</th>`).join('') + '</tr>'; isFirstRow = false; } 
                    else { tableHtml += '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>'; }
                } else {
                    if (inTable) { tableHtml += '</table></div>'; inTable = false; isFirstRow = true; }
                    tableHtml += line + '<br>';
                }
            }
            if (inTable) tableHtml += '</table></div>';
            html = tableHtml;
        }
        
        logQueue.push(html);
        
        if (!logRenderTimer) {
            logRenderTimer = requestAnimationFrame(() => {
                const fragment = document.createDocumentFragment();
                logQueue.forEach(h => {
                    const div = document.createElement('div');
                    div.className = 'ds-ui-log-entry';
                    div.innerHTML = h;
                    fragment.appendChild(div);
                });
                Logger._uiViewer.appendChild(fragment);
                
                while (Logger._uiViewer.childElementCount > MAX_LOG_ENTRIES) {
                    Logger._uiViewer.removeChild(Logger._uiViewer.firstChild);
                }
                
                Logger._uiViewer.scrollTop = Logger._uiViewer.scrollHeight;
                logQueue = [];
                logRenderTimer = null;
            });
        }
    },
    clear: () => { rawMarkdownLogs = []; if (Logger._uiViewer) Logger._uiViewer.innerHTML = ''; if (typeof toastr !== 'undefined') toastr.success("日誌已清空", "DeepSeek 緩存優化器"); },
    copy: () => { navigator.clipboard.writeText(rawMarkdownLogs.join('\n')).then(() => { if (typeof toastr !== 'undefined') toastr.success("日誌已複製到剪貼簿", "DeepSeek 緩存優化器"); }); },
    export: () => {
        const blob = new Blob([rawMarkdownLogs.join('\n')], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `DSCache_Log_${new Date().toISOString().replace(/[:.]/g, '-')}.md`; a.click(); URL.revokeObjectURL(url);
        if (typeof toastr !== 'undefined') toastr.success("日誌導出成功", "DeepSeek 緩存優化器");
    }
};

// ==========================================
// 修改來源與 API 緩存率診斷面板
// ==========================================
const Diagnostics = {
    _panel: null,
    _cacheRateEl: null,
    _cacheMetaEl: null,
    _tbody: null,
    _sourceBody: null,
    events: [],
    sourceRows: [],
    lastCacheInfo: null,
    escapeHtml: (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    truncate: (text, maxLen = 80) => {
        const clean = String(text ?? '').replace(/[\n\r\t]+/g, ' ').trim();
        return clean.length > maxLen ? clean.substring(0, maxLen) + '...' : clean;
    },
    init: () => {
        Diagnostics._panel = document.getElementById('ds-diagnostics-panel');
        Diagnostics._cacheRateEl = document.getElementById('ds-api-cache-rate');
        Diagnostics._cacheMetaEl = document.getElementById('ds-api-cache-meta');
        Diagnostics._tbody = document.getElementById('ds-mod-source-body');
        Diagnostics._sourceBody = document.getElementById('ds-prompt-source-body');
        Diagnostics.renderCache();
        Diagnostics.renderEvents();
        Diagnostics.renderSources();
    },
    sourceTypeClass: (type) => {
        if (type === 'USER_HISTORY' || type === 'USER_CURRENT') return 'manual';
        if (type === 'AI_HISTORY' || type === 'AI_LAST_REPLY' || type === 'PREFILL') return 'ai';
        if (type === 'LOREBOOK') return 'world';
        if (type === 'SUMMARY' || type === 'DYNAMIC') return 'dynamic';
        if (type === 'OTHER_PLUGIN') return 'plugin';
        return 'system';
    },
    describeLocator: (msg) => {
        const attr = msg?._attr || {};
        const bits = [];
        if (attr.type === 'DEFAULT') bits.push(`Preset Prompt: ${attr.promptName || attr.promptId || attr.source || 'unknown'}`);
        else if (attr.type === 'LOREBOOK') bits.push(`World Info: ${attr.bookName || 'unknown book'} -> ${attr.entryName || attr.promptName || attr.entryUid || 'unknown entry'}`);
        else if (attr.type === 'SUMMARY') bits.push(`ST Summary/Summarize: ${attr.promptId || attr.source || 'summary'}`);
        else if (attr.type === 'DYNAMIC') bits.push(`Dynamic Prompt: ${attr.promptName || attr.promptId || attr.source || 'dynamic'}`);
        else if (attr.type === 'OTHER_PLUGIN') bits.push(`Extension/Prompt Item: ${attr.promptId || attr.creator || attr.source || 'unknown plugin'}`);
        else if (attr.type === 'USER_HISTORY' || attr.type === 'USER_CURRENT') bits.push(`Chat message #${Number.isInteger(msg?._chatIndex) ? msg._chatIndex + 1 : '?'} user`);
        else if (attr.type === 'AI_HISTORY' || attr.type === 'AI_LAST_REPLY') bits.push(`Chat message #${Number.isInteger(msg?._chatIndex) ? msg._chatIndex + 1 : '?'} assistant`);
        else if (attr.type === 'PREFILL') bits.push('Chat Completion Prefill');
        else bits.push(attr.source || 'Unknown source');

        if (attr.promptId) bits.push(`promptId=${attr.promptId}`);
        if (msg?._structuralId) bits.push(`identifier=${msg._structuralId}`);
        if (msg?._uid) bits.push(`uid=${msg._uid}`);
        if (Number.isInteger(msg?._origIdx)) bits.push(`incoming#=${msg._origIdx}`);
        return bits.join(' | ');
    },
    recordModification: (event) => {
        const normalized = Object.assign({
            time: Logger.getTime(),
            type: '未知',
            source: '未知來源',
            sourceDetail: '',
            target: '未知節點',
            outcome: '已記錄',
            before: '',
            after: '',
            confidence: 'medium',
        }, event || {});
        Diagnostics.events.unshift(normalized);
        if (Diagnostics.events.length > 80) Diagnostics.events.length = 80;
        Diagnostics.renderEvents();
    },
    recordPromptSnapshot: (messages, turn) => {
        Diagnostics.sourceRows = (messages || []).map((msg, index) => {
            const attr = msg?._attr || {};
            return {
                idx: index + 1,
                turn,
                type: attr.type || attr.cat || 'UNKNOWN',
                source: attr.source || '未知來源',
                locator: Diagnostics.describeLocator(msg),
                action: msg?._diagAction || (msg?._isDynamic ? '動態鏡像/追加' : '凍結'),
                preview: msg?.content || '',
            };
        });
        Diagnostics.renderSources();
    },
    renderEvents: () => {
        if (!Diagnostics._tbody) return;
        if (Diagnostics.events.length === 0) {
            Diagnostics._tbody.innerHTML = '<tr><td colspan="7" class="ds-diag-empty">尚未偵測到修改來源。開始對話後會在此顯示手動修改、正則、插件、預設與世界書造成的變化。</td></tr>';
            return;
        }
        Diagnostics._tbody.innerHTML = Diagnostics.events.map(evt => {
            const typeClass = evt.type === '手動修改' ? 'manual' : (evt.type === '自動轉換' ? 'auto' : 'system');
            return `<tr class="ds-diag-row-${typeClass}">
                <td>${Diagnostics.escapeHtml(evt.time)}</td>
                <td><span class="ds-diag-pill ${typeClass}">${Diagnostics.escapeHtml(evt.type)}</span></td>
                <td title="${Diagnostics.escapeHtml(evt.sourceDetail || evt.source)}">${Diagnostics.escapeHtml(Diagnostics.truncate(evt.source, 34))}</td>
                <td title="${Diagnostics.escapeHtml(evt.target)}">${Diagnostics.escapeHtml(Diagnostics.truncate(evt.target, 34))}</td>
                <td title="${Diagnostics.escapeHtml(evt.before)}">${Diagnostics.escapeHtml(Diagnostics.truncate(evt.before, 44))}</td>
                <td title="${Diagnostics.escapeHtml(evt.after)}">${Diagnostics.escapeHtml(Diagnostics.truncate(evt.after, 44))}</td>
                <td>${Diagnostics.escapeHtml(evt.outcome)}</td>
            </tr>`;
        }).join('');
    },
    renderSources: () => {
        if (!Diagnostics._sourceBody) return;
        if (Diagnostics.sourceRows.length === 0) {
            Diagnostics._sourceBody.innerHTML = '<tr><td colspan="7" class="ds-diag-empty">尚未有本輪提示詞來源快照。發送一次訊息後會列出所有凍結節點的來源與定位。</td></tr>';
            return;
        }
        Diagnostics._sourceBody.innerHTML = Diagnostics.sourceRows.map(row => {
            const typeClass = Diagnostics.sourceTypeClass(row.type);
            return `<tr class="ds-diag-row-${typeClass}">
                <td>${row.idx}</td>
                <td>第 ${Diagnostics.escapeHtml(row.turn)} 輪</td>
                <td><span class="ds-diag-pill ${typeClass}">${Diagnostics.escapeHtml(row.type)}</span></td>
                <td title="${Diagnostics.escapeHtml(row.source)}">${Diagnostics.escapeHtml(Diagnostics.truncate(row.source, 38))}</td>
                <td title="${Diagnostics.escapeHtml(row.locator)}">${Diagnostics.escapeHtml(Diagnostics.truncate(row.locator, 58))}</td>
                <td>${Diagnostics.escapeHtml(row.action)}</td>
                <td title="${Diagnostics.escapeHtml(row.preview)}">${Diagnostics.escapeHtml(Diagnostics.truncate(row.preview, 42))}</td>
            </tr>`;
        }).join('');
    },
    extractUsageObjects: (text) => {
        const usages = [];
        const tryPush = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            if (obj.usage && typeof obj.usage === 'object') usages.push(obj.usage);
            if (obj.data?.usage && typeof obj.data.usage === 'object') usages.push(obj.data.usage);
        };
        try {
            tryPush(JSON.parse(text));
        } catch (_) {
            const lines = String(text || '').split(/\r?\n/);
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const payload = trimmed.slice(5).trim();
                if (!payload || payload === '[DONE]') continue;
                try { tryPush(JSON.parse(payload)); } catch (_) { /* skip non-json SSE line */ }
            }
        }
        return usages;
    },
    normalizeUsage: (usage) => {
        const promptTokens = Number(
            usage?.prompt_tokens
            ?? usage?.input_tokens
            ?? usage?.usage?.prompt_tokens
            ?? 0
        ) || 0;
        const cachedTokens = Number(
            usage?.prompt_cache_hit_tokens
            ?? usage?.prompt_tokens_details?.cached_tokens
            ?? usage?.input_tokens_details?.cached_tokens
            ?? usage?.cache_read_input_tokens
            ?? usage?.cache_read_tokens
            ?? 0
        ) || 0;
        const missTokens = Number(
            usage?.prompt_cache_miss_tokens
            ?? usage?.cache_creation_input_tokens
            ?? usage?.cache_creation_tokens
            ?? 0
        ) || 0;
        const denominator = cachedTokens + missTokens > 0 ? cachedTokens + missTokens : promptTokens;
        const rate = denominator > 0 ? (cachedTokens / denominator) * 100 : null;
        return {
            raw: usage,
            promptTokens,
            cachedTokens,
            missTokens,
            denominator,
            rate,
        };
    },
    recordApiText: (text, url = '') => {
        const usages = Diagnostics.extractUsageObjects(text);
        if (usages.length === 0) {
            Diagnostics.lastCacheInfo = {
                time: Logger.getTime(),
                rate: null,
                cachedTokens: 0,
                missTokens: 0,
                promptTokens: 0,
                source: url,
                note: '本次回應未包含可解析的 usage/cache 欄位',
                raw: null,
            };
            Diagnostics.renderCache();
            return;
        }
        const normalized = Diagnostics.normalizeUsage(usages[usages.length - 1]);
        Diagnostics.lastCacheInfo = Object.assign({ time: Logger.getTime(), source: url, note: 'DeepSeek/OpenAI-compatible usage' }, normalized);
        Diagnostics.renderCache();
    },
    renderCache: () => {
        if (!Diagnostics._cacheRateEl || !Diagnostics._cacheMetaEl) return;
        const info = Diagnostics.lastCacheInfo;
        if (!info) {
            Diagnostics._cacheRateEl.textContent = '--';
            Diagnostics._cacheMetaEl.textContent = '等待下一次 DeepSeek API 回應';
            return;
        }
        Diagnostics._cacheRateEl.textContent = info.rate === null ? 'N/A' : `${info.rate.toFixed(2)}%`;
        const rawKeys = info.raw ? Object.keys(info.raw).slice(0, 10).join(', ') : 'none';
        Diagnostics._cacheMetaEl.textContent = `${info.time} | cached=${info.cachedTokens || 0}, miss=${info.missTokens || 0}, prompt=${info.promptTokens || 0} | ${info.note || ''} | fields: ${rawKeys}`;
    },
};

function installApiUsageInterceptor() {
    const isGenerationUrl = (url) => {
        const text = String(url || '');
        return text.includes('/api/') && text.includes('generate');
    };

    if (!window._ds_cache_fetch_usage_patched) {
        const originalFetch = globalThis.fetch || window.fetch;
        if (typeof originalFetch === 'function') {
            const boundFetch = originalFetch.bind(globalThis);
            const patchedFetch = async (...args) => {
                const response = await boundFetch(...args);
                try {
                    const request = args[0];
                    const url = typeof request === 'string' ? request : (request?.url || '');
                    if (isGenerationUrl(url)) {
                        const clone = response.clone();
                        clone.text()
                            .then(text => Diagnostics.recordApiText(text, url))
                            .catch(err => Diagnostics.recordApiText('', `${url} (${err?.message || 'read failed'})`));
                    }
                } catch (err) {
                    console.debug('[DS Cache] API fetch usage interceptor skipped:', err);
                }
                return response;
            };
            globalThis.fetch = patchedFetch;
            window.fetch = patchedFetch;
            window._ds_cache_fetch_usage_patched = true;
        } else {
            console.debug('[DS Cache] fetch is not available yet; XHR interceptor will still be installed.');
        }
    }

    if (!window._ds_cache_xhr_usage_patched && typeof XMLHttpRequest !== 'undefined') {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this._dsCacheGenerateUrl = isGenerationUrl(url) ? String(url) : '';
            return originalOpen.call(this, method, url, ...rest);
        };
        XMLHttpRequest.prototype.send = function(...args) {
            if (this._dsCacheGenerateUrl && !this._dsCacheUsageListenerAttached) {
                this._dsCacheUsageListenerAttached = true;
                this.addEventListener('loadend', () => {
                    try {
                        const responseText = typeof this.responseText === 'string' ? this.responseText : '';
                        Diagnostics.recordApiText(responseText, this._dsCacheGenerateUrl);
                    } catch (err) {
                        Diagnostics.recordApiText('', `${this._dsCacheGenerateUrl} (${err?.message || 'xhr read failed'})`);
                    }
                });
            }
            return originalSend.apply(this, args);
        };
        window._ds_cache_xhr_usage_patched = true;
    }
}

// ==========================================
// 存檔管理系統 (Archive System)
// ==========================================
function getChatKey() {
    const context = getContext();
    let character = (context.name2 || "未分類角色").trim();
    let chatId = context.chatId || "";
    if (context.groupId) {
        character = "群聊: " + (context.groupName || context.groupId);
        chatId = context.groupId;
    }

    // 🔑 雙鍵系統：同時支援 chatId 和角色名查找
    // 避免 chatId 在首次訊息後變化導致狀態丟失
    const charKey = `char_${character.replace(/[^a-zA-Z0-9一-鿿_-]/g, '_')}`;
    const chatIdKey = chatId ? `chat_${chatId}` : null;

    // 1. 先用 chatId 精確查找
    if (chatIdKey && Settings.chats[chatIdKey]) {
        return { key: chatIdKey, label: chatId, character };
    }

    // 2. 用角色名查找（跨 chatId 穩定）
    if (Settings.chats[charKey]) {
        return { key: charKey, label: chatId || charKey, character };
    }

    // 3. 遍歷所有已有 key 找相同角色（容錯）
    for (const k of Object.keys(Settings.chats)) {
        const c = Settings.chats[k]?.character;
        if (c && c.trim() === character) {
            return { key: k, label: chatId || k, character };
        }
    }

    // 4. 新建：優先使用角色名作為穩定 key
    const key = charKey;
    return { key, label: chatId || character, character };
}

function getChatState(chatKeyInfo) {
    let chat = Settings.chats[chatKeyInfo.key];
    if (!chat) { chat = Settings.chats[chatKeyInfo.key] = { frozenSequence: [], promptTracker: {}, templateVarTracker: {}, firstTurnRecords: {} }; safeSave(); }
    if (!chat.promptTracker) chat.promptTracker = {};
    if (!chat.templateVarTracker) chat.templateVarTracker = {};
    if (!chat.firstTurnRecords) chat.firstTurnRecords = {};
    chat.label = chatKeyInfo.label; chat.character = chatKeyInfo.character;
    return chat;
}

function resetCurrentChatCache() {
    const chatInfo = getChatKey();
    if (Settings.chats[chatInfo.key]) {
        Settings.chats[chatInfo.key].frozenSequence = [];
        Settings.chats[chatInfo.key].promptTracker = {};
        Settings.chats[chatInfo.key].templateVarTracker = {};
        Settings.chats[chatInfo.key].firstTurnRecords = {};
        safeSave(); renderChatsUI();
        if (typeof toastr !== 'undefined') toastr.success(`已重置當前聊天 (${chatInfo.character}) 的凍結池。<br>下一次對話將重新構建緩存序列。`, "DeepSeek 緩存優化器", {escapeHtml: false});
        Logger.write(`**[${Logger.getTime()}]** 🔄 用戶手動重置了當前聊天 (${chatInfo.character}) 的凍結池`, LogLevels.BASIC);
    }
}

// ==========================================
// 🛡️ 核心引擎：ST-API 精準溯源 & 量子排序
// ==========================================
const CoreEngine = {
    macroMap: new Map(),
    macroMapAll: new Map(),            // normalized(template) → { resolved, cleanRes, timestamp } — 完整紀錄(含空字串)
    macroMapRaw: new Map(),            // raw template → raw resolved — 未正規化的原始映射
    promptRegistry: new Map(),          // norm → {name, identifier, role, content}
    promptIdToTemplateContent: new Map(), // identifier → raw template content (含 {{}} 的原始模板)
    worldInfoRegistry: new Map(),       // norm → {worldBookName, entryName, uid, keys, constant, content}
    activeWorldInfoEntries: new Map(),  // "world.uid" → WIScanEntry (由 WORLD_INFO_ACTIVATED 事件填充)
    lastRegistryBuildTime: 0,
    promptIdToName: new Map(),          // identifier → name (for quick lookup)

    normalize: (text) => {
        if (!text) return '';
        return text.replace(/[\s\n\r\t]/g, '').replace(/\\n/g, '').trim();
    },

    // 🌟 剝離 {{XXX}} 動態巨集，使含巨集條目可與解析後內容比對
    stripMacros: (text) => {
        if (!text) return '';
        return text.replace(/\{\{[^}]*\}\}/g, '');
    },

    getGrams: (str) => {
        let grams = new Set();
        if (typeof str !== 'string') return grams;
        let len = str.length;
        if (len < 3) { if (len > 0) grams.add(str); return grams; }
        for (let i = 0; i <= len - 3; i++) grams.add(str.substring(i, i + 3));
        return grams;
    },

    getOverlapRatioFast: (g1, g2) => {
        if (!g1 || !g2 || !(g1 instanceof Set) || !(g2 instanceof Set) || g1.size === 0 || g2.size === 0) return 0;
        let intersect = 0;
        let smaller = g1.size < g2.size ? g1 : g2;
        let larger = g1.size < g2.size ? g2 : g1;
        for (let g of smaller) { if (larger.has(g)) intersect++; }
        return intersect / smaller.size;
    },

    getSimilarityFast: (g1, g2) => {
        if (!g1 || !g2 || !(g1 instanceof Set) || !(g2 instanceof Set) || g1.size === 0 || g2.size === 0) return 0;
        let intersect = 0;
        for (let g of g1) { if (g2.has(g)) intersect++; }
        let union = g1.size + g2.size - intersect;
        return union === 0 ? 0 : intersect / union;
    },

    // ==========================================
    // 📋 提示詞註冊表 – 動態導入 ST 內部模組
    // ==========================================
    buildPromptRegistry: async () => {
        CoreEngine.promptRegistry.clear();
        CoreEngine.promptIdToName.clear();
        CoreEngine.promptIdToTemplateContent.clear();

        // ── 來源1: promptManager.serviceSettings.prompts（所有提示詞，含使用者定義） ──
        const prompts = await getSTPromptList();
        if (Array.isArray(prompts) && prompts.length > 0) {
            for (const prompt of prompts) {
                if (!prompt?.content || typeof prompt.content !== 'string') continue;
                const name = prompt.name || '';
                const identifier = prompt.identifier || '';
                const norm = CoreEngine.normalize(prompt.content);
                if (norm.length < 2) continue;

                // 建立 identifier → name 的快速查找表
                if (identifier) {
                    CoreEngine.promptIdToName.set(identifier, name || identifier);
                    // 🌟 建立 identifier → 原始模板(含{{}}) 的映射，用於動態提示詞檢測
                    if (prompt.content && typeof prompt.content === 'string' && prompt.content.includes('{{')) {
                        CoreEngine.promptIdToTemplateContent.set(identifier, prompt.content);
                    }
                }

                // 避免重複插入相同內容
                if (CoreEngine.promptRegistry.has(norm)) continue;
                CoreEngine.promptRegistry.set(norm, {
                    name: name || identifier || '未命名',
                    identifier: identifier,
                    role: prompt.role || 'system',
                    content: prompt.content,
                });
            }
        }

        // ── 來源2: 系統級 identifier → name 靜態對照 (ST 內建提示詞) ──
        const staticSysNames = {
            'main': 'Main Prompt',
            'nsfw': 'Auxiliary Prompt',
            'jailbreak': 'Post-History Instructions',
            'enhanceDefinitions': 'Enhance Definitions',
            'worldInfoBefore': 'World Info (before)',
            'worldInfoAfter': 'World Info (after)',
            'charDescription': 'Char Description',
            'charPersonality': 'Char Personality',
            'scenario': 'Scenario',
            'personaDescription': 'Persona Description',
            'dialogueExamples': 'Chat Examples',
            'chatHistory': 'Chat History',
            'impersonate': 'Impersonation Prompt',
            'quietPrompt': 'Quiet Prompt',
            'groupNudge': 'Group Nudge',
            'bias': 'Bias',
            'summary': 'Summary',
            'authorsNote': 'Authors Note',
            'vectorsMemory': 'Vectors Memory',
            'vectorsDataBank': 'Vectors DataBank',
            'smartContext': 'Smart Context',
        };
        for (const [id, name] of Object.entries(staticSysNames)) {
            if (!CoreEngine.promptIdToName.has(id)) {
                CoreEngine.promptIdToName.set(id, name);
            }
        }

        // ── 來源3: 角色卡資料 ──
        try {
            const ctx = getSTContext();
            const character = ctx?.characters?.[ctx?.characterId];
            if (character) {
                const charDesc = character?.data?.description || character?.description;
                const charPers = character?.data?.personality || character?.personality;
                const charScen = character?.data?.scenario || character?.scenario;
                const charFirst = character?.data?.first_mes || character?.first_mes;
                const charExample = character?.data?.mes_example || character?.mes_example;
                const charSysEntries = [
                    { key: 'charDescription', label: '角色描述', content: charDesc },
                    { key: 'charPersonality', label: '性格描述', content: charPers },
                    { key: 'scenario', label: '場景', content: charScen },
                    { key: 'first_mes', label: '初次對話', content: charFirst },
                    { key: 'mes_example', label: '對話範例', content: charExample },
                ];
                for (const cse of charSysEntries) {
                    if (!cse.content || typeof cse.content !== 'string' || !cse.content.trim()) continue;
                    const norm = CoreEngine.normalize(cse.content);
                    if (norm.length < 2 || CoreEngine.promptRegistry.has(norm)) continue;
                    const label = `角色-${cse.label}`;
                    CoreEngine.promptRegistry.set(norm, {
                        name: label, identifier: cse.key, role: 'system', content: cse.content,
                    });
                    CoreEngine.promptIdToName.set(cse.key, label);
                }
            }
        } catch (e) { /* ignore */ }

        // ── 來源4: Persona 描述 (用戶設定) ──
        try {
            const pd = typeof window?.power_user?.persona_description === 'string'
                ? window.power_user.persona_description.trim() : '';
            if (pd.length > 0) {
                const norm = CoreEngine.normalize(pd);
                if (norm.length >= 2 && !CoreEngine.promptRegistry.has(norm)) {
                    CoreEngine.promptRegistry.set(norm, {
                        name: '用戶設定(Persona)', identifier: 'personaDescription', role: 'system', content: pd,
                    });
                    CoreEngine.promptIdToName.set('personaDescription', '用戶設定(Persona)');
                }
            }
        } catch (e) { /* ignore */ }
    },

    // ==========================================
    // 📚 世界書註冊表 – 從 worldInfoCache + world_info 讀取
    // ==========================================
    buildWorldInfoRegistry: async () => {
        CoreEngine.worldInfoRegistry.clear();

        const wiEntries = await getSTWorldInfoEntries();
        console.debug(`[DS Cache] 📚 從世界書讀取到 ${wiEntries.size} 個條目`);

        for (const [mapKey, wiData] of wiEntries) {
            const entryNorm = CoreEngine.normalize(wiData.entry.content);
            if (entryNorm.length < 2) continue;
            if (!CoreEngine.worldInfoRegistry.has(entryNorm)) {
                CoreEngine.worldInfoRegistry.set(entryNorm, {
                    worldBookName: wiData.worldBookName,
                    entryName: wiData.entryName,
                    uid: wiData.uid,
                    keys: Array.isArray(wiData.entry.key) ? wiData.entry.key : [],
                    constant: !!wiData.entry.constant,
                    content: wiData.entry.content,
                });
            }
        }
        console.debug(`[DS Cache] 📚 世界書註冊表: ${CoreEngine.worldInfoRegistry.size} 個條目`);
    },

    // ==========================================
    // 🔄 從已導入的 promptManager 建立註冊表
    // ==========================================
    buildRegistriesInternal: async (pm) => {
        const now = Date.now();
        if (now - CoreEngine.lastRegistryBuildTime < 3000) return;
        CoreEngine.lastRegistryBuildTime = now;
        if (pm) {
            await CoreEngine.buildPromptRegistryInternal(pm);
        } else {
            await CoreEngine.buildPromptRegistry();
        }
        await CoreEngine.buildWorldInfoRegistry();
    },

    buildRegistries: async () => {
        const now = Date.now();
        if (now - CoreEngine.lastRegistryBuildTime < 3000) return;
        CoreEngine.lastRegistryBuildTime = now;
        await CoreEngine.buildPromptRegistry();
        await CoreEngine.buildWorldInfoRegistry();
    },

    // ==========================================
    // 📋 從已導入的 promptManager 建立提示詞註冊表（不重複動態導入）
    // ==========================================
    buildPromptRegistryInternal: async (pm) => {
        CoreEngine.promptRegistry.clear();
        CoreEngine.promptIdToName.clear();
        CoreEngine.promptIdToTemplateContent.clear();

        // ── 來源1: promptManager.serviceSettings.prompts ──
        const prompts = pm?.serviceSettings?.prompts;
        if (Array.isArray(prompts) && prompts.length > 0) {
            for (const prompt of prompts) {
                if (!prompt?.content || typeof prompt.content !== 'string') continue;
                const name = prompt.name || '';
                const identifier = prompt.identifier || '';
                const norm = CoreEngine.normalize(prompt.content);
                if (norm.length < 2) continue;
                if (identifier) {
                    CoreEngine.promptIdToName.set(identifier, name || identifier);
                    // 🌟 建立 identifier → 原始模板(含{{}}) 的映射，用於動態提示詞檢測
                    if (prompt.content && typeof prompt.content === 'string' && prompt.content.includes('{{')) {
                        CoreEngine.promptIdToTemplateContent.set(identifier, prompt.content);
                    }
                    console.debug(`[DS Cache] 📋 註冊提示詞: "${name}" ← id="${identifier}"`);
                }
                if (!CoreEngine.promptRegistry.has(norm)) {
                    CoreEngine.promptRegistry.set(norm, { name: name || identifier || '未命名', identifier, role: prompt.role || 'system', content: prompt.content });
                }
            }
        }
        console.debug(`[DS Cache] 📋 從 promptManager 註冊了 ${CoreEngine.promptRegistry.size} 個提示詞內容, ${CoreEngine.promptIdToName.size} 個 ID→Name 映射, ${CoreEngine.promptIdToTemplateContent.size} 個模板映射`);

        // ── 來源2: 系統級靜態名稱 ──
        const staticSysNames = {
            'main': 'Main Prompt', 'nsfw': 'Auxiliary Prompt', 'jailbreak': 'Post-History Instructions',
            'enhanceDefinitions': 'Enhance Definitions', 'worldInfoBefore': 'World Info (before)',
            'worldInfoAfter': 'World Info (after)', 'charDescription': 'Char Description',
            'charPersonality': 'Char Personality', 'scenario': 'Scenario',
            'personaDescription': 'Persona Description', 'dialogueExamples': 'Chat Examples',
            'chatHistory': 'Chat History', 'impersonate': 'Impersonation Prompt',
            'quietPrompt': 'Quiet Prompt', 'groupNudge': 'Group Nudge', 'bias': 'Bias',
            'summary': 'Summary', 'authorsNote': 'Authors Note',
            'vectorsMemory': 'Vectors Memory', 'vectorsDataBank': 'Vectors DataBank',
            'smartContext': 'Smart Context', 'newMainChat': 'New Chat', 'continueNudge': 'Continue Nudge',
            'emptyUserMessageReplacement': 'Empty Message Repl', 'controlPrompts': 'Control Prompts',
        };
        for (const [id, name] of Object.entries(staticSysNames)) {
            if (!CoreEngine.promptIdToName.has(id)) CoreEngine.promptIdToName.set(id, name);
        }

        // ── 來源3: 角色卡資料 ──
        try {
            const ctx = getSTContext();
            const character = ctx?.characters?.[ctx?.characterId];
            if (character) {
                const charSysEntries = [
                    { key: 'charDescription', label: '角色描述', content: character?.data?.description || character?.description },
                    { key: 'charPersonality', label: '性格描述', content: character?.data?.personality || character?.personality },
                    { key: 'scenario', label: '場景', content: character?.data?.scenario || character?.scenario },
                    { key: 'first_mes', label: '初次對話', content: character?.data?.first_mes || character?.first_mes },
                    { key: 'mes_example', label: '對話範例', content: character?.data?.mes_example || character?.mes_example },
                ];
                for (const cse of charSysEntries) {
                    if (!cse.content || typeof cse.content !== 'string' || !cse.content.trim()) continue;
                    CoreEngine.promptIdToName.set(cse.key, `角色-${cse.label}`);
                    const norm = CoreEngine.normalize(cse.content);
                    if (norm.length >= 2 && !CoreEngine.promptRegistry.has(norm)) {
                        CoreEngine.promptRegistry.set(norm, { name: `角色-${cse.label}`, identifier: cse.key, role: 'system', content: cse.content });
                    }
                }
            }
        } catch (e) { /* ignore */ }

        // ── 來源4: Persona ──
        try {
            const pd = typeof window?.power_user?.persona_description === 'string' ? window.power_user.persona_description.trim() : '';
            if (pd.length > 0) {
                CoreEngine.promptIdToName.set('personaDescription', '用戶設定(Persona)');
                const norm = CoreEngine.normalize(pd);
                if (norm.length >= 2 && !CoreEngine.promptRegistry.has(norm)) {
                    CoreEngine.promptRegistry.set(norm, { name: '用戶設定(Persona)', identifier: 'personaDescription', role: 'system', content: pd });
                }
            }
        } catch (e) { /* ignore */ }
    },

    // ==========================================
    // 🔍 在註冊表中查找提示詞
    // ==========================================
    findInRegistries: (normContent, nGrams) => {
        if (!normContent || normContent.length < 2) return null;

        // 1. 精確匹配 – 提示詞註冊表
        const promptMatch = CoreEngine.promptRegistry.get(normContent);
        if (promptMatch) {
            return {
                cat: '預設',
                source: `預設(${promptMatch.name})`,
                creator: promptMatch.role || 'ST核心',
                type: 'DEFAULT',
                promptName: promptMatch.name,
                promptId: promptMatch.identifier,
                isWorldBook: false,
            };
        }

        // 2. 精確匹配 – 世界書註冊表
        const wiMatch = CoreEngine.worldInfoRegistry.get(normContent);
        if (wiMatch) {
            return {
                cat: '世界書',
                source: `${wiMatch.worldBookName}(${wiMatch.entryName})`,
                creator: '世界書系統',
                type: 'LOREBOOK',
                bookName: wiMatch.worldBookName,
                entryName: wiMatch.entryName,
                entryUid: wiMatch.uid,
                isWorldBook: true,
            };
        }

        // 3. 模糊匹配 – 用於參數替換後的變體 (僅比對長內容)
        if (normContent.length > 30 && nGrams && nGrams.size > 10) {
            let bestMatch = null, bestScore = 0;

            // 遍歷提示詞註冊表
            for (const [regNorm, regData] of CoreEngine.promptRegistry) {
                if (regNorm.length < 20) continue;
                const regGrams = CoreEngine.getGrams(regNorm);
                const overlap = CoreEngine.getOverlapRatioFast(regGrams, nGrams);
                const lenRatio = Math.min(regNorm.length, normContent.length) / Math.max(regNorm.length, normContent.length);
                const score = overlap * 0.85 + lenRatio * 0.15;
                if (overlap > 0.88 && score > bestScore) {
                    bestScore = score;
                    bestMatch = {
                        cat: '預設',
                        source: `預設(${regData.name})`,
                        creator: regData.role || 'ST核心',
                        type: 'DEFAULT',
                        promptName: regData.name,
                        promptId: regData.identifier,
                        isWorldBook: false,
                    };
                }
            }

            // 遍歷世界書註冊表
            for (const [regNorm, regData] of CoreEngine.worldInfoRegistry) {
                if (regNorm.length < 20) continue;
                const regGrams = CoreEngine.getGrams(regNorm);
                const overlap = CoreEngine.getOverlapRatioFast(regGrams, nGrams);
                const lenRatio = Math.min(regNorm.length, normContent.length) / Math.max(regNorm.length, normContent.length);
                const score = overlap * 0.85 + lenRatio * 0.15;
                if (overlap > 0.88 && score > bestScore) {
                    bestScore = score;
                    bestMatch = {
                        cat: '世界書',
                        source: `${regData.worldBookName}(${regData.entryName})`,
                        creator: '世界書系統',
                        type: 'LOREBOOK',
                        bookName: regData.worldBookName,
                        entryName: regData.entryName,
                        entryUid: regData.uid,
                        isWorldBook: true,
                    };
                }
            }

            if (bestMatch) return bestMatch;
        }

        return null;
    },

    // ==========================================
    // 🔍 世界書條目模糊匹配（內容被 macro 展開後的精確匹配 fallback）
    // ==========================================
    _findWorldBookFuzzy: (msgNorm, nGrams) => {
        if (!msgNorm || msgNorm.length < 20 || !nGrams || nGrams.size < 8) return null;
        let bestMatch = null, bestScore = 0;
        for (const [entryNorm, wiData] of CoreEngine.worldInfoRegistry) {
            if (entryNorm.length < 15) continue;
            const regGrams = CoreEngine.getGrams(entryNorm);
            const overlap = CoreEngine.getOverlapRatioFast(regGrams, nGrams);
            if (overlap > bestScore) {
                bestScore = overlap;
                bestMatch = {
                    cat: '世界書',
                    source: `${wiData.worldBookName}(${wiData.entryName})`,
                    creator: '世界書系統',
                    type: 'LOREBOOK',
                    bookName: wiData.worldBookName,
                    entryName: wiData.entryName,
                    entryUid: wiData.uid,
                    isWorldBook: true,
                };
            }
        }
        if (bestScore > 0.55 && bestMatch) {
            console.debug(`[DS Cache] 🔍 世界書模糊匹配: score=${bestScore.toFixed(3)} → ${bestMatch.bookName}(${bestMatch.entryName})`);
            return bestMatch;
        }
        return null;
    },

    // ==========================================
    // 🧬 拆分被 ST squash 合併的世界書訊息 – 辨識出個別條目
    // ==========================================
    splitWorldInfoEntries: (msg) => {
        const entries = [];
        if (!msg?.content || typeof msg.content !== 'string') return entries;

        // 遍歷世界書註冊表，找出內容中有出現的條目
        const msgNorm = CoreEngine.normalize(msg.content);
        const foundUids = new Set();

        for (const [entryNorm, wiData] of CoreEngine.worldInfoRegistry) {
            if (foundUids.has(wiData.uid)) continue;
            if (entryNorm.length < 10) continue;
            // 檢查條目內容是否完整出現在訊息中
            if (msgNorm.includes(entryNorm)) {
                foundUids.add(wiData.uid);
                entries.push({
                    uid: wiData.uid,
                    worldBookName: wiData.worldBookName,
                    entryName: wiData.entryName,
                    content: wiData.content,
                    constant: wiData.constant,
                });
            }
        }

        return entries;
    },

    // ==========================================
    // 🔌 劫持 ST 宏引擎以追蹤 {{macro}} → 展開內容的映射
    // ==========================================
    patchSTEngine: () => {
        try {
            // 🌟 ST 1.18.0 相容性：substituteParams 可能在 window 或僅在模組作用域
            // 確保函數在 window 上可用以便劫持
            if (typeof window.substituteParams !== 'function' && typeof substituteParams === 'function') {
                window.substituteParams = substituteParams;
            }
            if (typeof window.substituteParamsExtended !== 'function' && typeof substituteParamsExtended === 'function') {
                window.substituteParamsExtended = substituteParamsExtended;
            }

            const hook = (origFunc) => {
                return function(...args) {
                    const orig = args[0];
                    const res = origFunc.apply(this, args);
                    if (typeof orig === 'string' && typeof res === 'string' && orig !== res) {
                        if (orig.includes('{{') && orig.includes('}}')) {
                            let cleanRes = CoreEngine.normalize(res);
                            let cleanOrig = CoreEngine.normalize(orig);
                            // 🌟 完整紀錄：即使解析為空字串也追蹤
                            CoreEngine.macroMapAll.set(cleanOrig, { resolved: res, cleanRes, timestamp: Date.now() });
                            // 🌟 原始映射：未正規化版本，用於精確比對
                            CoreEngine.macroMapRaw.set(orig, res);
                            if (cleanRes.length > 0) {
                                CoreEngine.macroMap.set(cleanRes, cleanOrig);
                            }
                            // 防止記憶體洩漏
                            if (CoreEngine.macroMapAll.size > 2000) {
                                CoreEngine.macroMapAll.delete(CoreEngine.macroMapAll.keys().next().value);
                            }
                            if (CoreEngine.macroMapRaw.size > 2000) {
                                CoreEngine.macroMapRaw.delete(CoreEngine.macroMapRaw.keys().next().value);
                            }
                            if (CoreEngine.macroMap.size > 1000) {
                                CoreEngine.macroMap.delete(CoreEngine.macroMap.keys().next().value);
                            }
                        }
                    }
                    return res;
                };
            };

            if (typeof window.substituteParams === 'function' && !window._ds_orig_substituteParams) {
                window._ds_orig_substituteParams = window.substituteParams;
                window.substituteParams = hook(window._ds_orig_substituteParams);
            }
            if (typeof window.substituteParamsExtended === 'function' && !window._ds_orig_substituteParamsExtended) {
                window._ds_orig_substituteParamsExtended = window.substituteParamsExtended;
                window.substituteParamsExtended = hook(window._ds_orig_substituteParamsExtended);
            }
        } catch (e) {
            console.error("[DS Cache] 劫持 ST 宏引擎失敗:", e);
        }
    },

    // ==========================================
    // 📖 世界書內容檢測 — 純內容比對，不依賴 ID
    // ==========================================
    _isWorldBookContent: (msg) => {
        const norm = msg._norm;
        if (!norm || norm.length < 80) return false;

        // 🌟 剝離 {{XXX}} 巨集後再比對，避免 {{user}} → 「李傲」這類差異導致匹配失敗
        const normClean = CoreEngine.stripMacros(norm);

        // Phase 1: 精確匹配（無巨集條目）
        let matchedNormSet = new Set();
        let matchCount = 0;
        let matchedLength = 0;
        for (const [entryNorm, wiData] of CoreEngine.worldInfoRegistry) {
            if (entryNorm.length < 30) continue;
            // 條目也剝離巨集，兩邊都是純靜態內容即可精確匹配
            const entryClean = CoreEngine.stripMacros(entryNorm);
            if (entryClean.length < 20) continue;
            if (normClean.includes(entryClean)) {
                const hash = entryClean.substring(0, 50);
                if (!matchedNormSet.has(hash)) {
                    matchedNormSet.add(hash);
                    matchCount++;
                    matchedLength += entryClean.length;
                }
                if (matchCount >= 2) break;
            }
        }

        // Phase 2: 模糊匹配 — 只在已有 1 條精確命中時用於尋找含巨集的第 2 條
        if (matchCount === 1 && msg._nGrams && msg._nGrams.size >= 10) {
            for (const [entryNorm] of CoreEngine.worldInfoRegistry) {
                const entryClean = CoreEngine.stripMacros(entryNorm);
                const hash = entryClean.substring(0, 50);
                if (matchedNormSet.has(hash)) continue;
                if (entryClean.length < 20) continue;
                const entryGrams = CoreEngine.getGrams(entryClean);
                if (CoreEngine.getOverlapRatioFast(entryGrams, msg._nGrams) > 0.40) {
                    matchCount++;
                    matchedLength += entryClean.length;
                    if (matchCount >= 2) break;
                }
            }
        }

        // 必須同時滿足：命中 2+ 條目 AND 世界書內容佔比 > 40%
        return (matchCount >= 2 && (matchedLength / norm.length) > 0.40);
    },

    // ==========================================
    // 🏷️ 分類函數 – 使用 ST 結構化 identifier（非內容比對）
    // ==========================================
    /**
     * @param {object} msg - chat item
     * @param {string|null} structuralTag - 結構標籤
     * @param {boolean} isDynamic - 是否動態
     * @param {string|null} structuralIdentifier - 從 promptManager.messages 取得的結構化 identifier
     */
    classify: (msg, structuralTag, isDynamic, structuralIdentifier) => {
        if (msg._isDSPlugin) return { cat: '本插件', source: '本插件', creator: 'DS Cache', type: 'PLUGIN' };
        if (structuralTag === 'USER_CURRENT') return { cat: '用戶', source: '用戶輸入', creator: '用戶', type: 'USER_CURRENT' };
        if (structuralTag === 'PREFILL') return { cat: 'AI', source: '預填充', creator: '大模型', type: 'PREFILL' };
        if (structuralTag === 'AI_LAST_REPLY') return { cat: 'AI', source: 'AI回覆', creator: '大模型', type: 'AI_LAST_REPLY' };
        if (structuralTag === 'USER_HISTORY') return { cat: '用戶', source: '用戶歷史輸入', creator: '用戶', type: 'USER_HISTORY' };
        if (structuralTag === 'AI_HISTORY') return { cat: 'AI', source: 'AI歷史回覆', creator: '大模型', type: 'AI_HISTORY' };

        const sid = structuralIdentifier || '';
        const sidLower = sid.toLowerCase();

        // ── 摘要 ──
        if (sidLower.includes('summary') || sidLower.includes('summarization')) {
            return { cat: '摘要', source: `預設(系統摘要) [ID: ${sid}]`, creator: 'ST核心', type: 'SUMMARY' };
        }

        // ── chatHistory 歷史訊息 ──
        // 🌟 先檢查內容是否為世界書條目（世界書可被注入到 chatHistory 深度中）
        if (sidLower.startsWith('chathistory-') || sidLower === 'chathistory') {
            const msgNorm = msg._norm || CoreEngine.normalize(msg.content || '');
            // 精確匹配世界書
            if (msgNorm.length > 20 && CoreEngine.worldInfoRegistry.size > 0 && CoreEngine.worldInfoRegistry.has(msgNorm)) {
                const wiMatch = CoreEngine.worldInfoRegistry.get(msgNorm);
                return {
                    cat: '世界書', source: `${wiMatch.worldBookName}(${wiMatch.entryName})`,
                    creator: '世界書系統', type: 'LOREBOOK',
                    bookName: wiMatch.worldBookName, entryName: wiMatch.entryName, entryUid: wiMatch.uid, isWorldBook: true,
                };
            }
            // 模糊匹配世界書
            const wiFuzzy = CoreEngine._findWorldBookFuzzy(msgNorm, msg._nGrams);
            if (wiFuzzy) return wiFuzzy;
            // 非世界書 → 確認為歷史訊息
            return { cat: '聊天', source: '歷史訊息', creator: '用戶/角色', type: msg.role === 'user' ? 'USER_HISTORY' : 'AI_HISTORY' };
        }

        // ── 世界書系統標記 ──
        if (sid === 'worldInfoBefore' || sid === 'worldInfoAfter') {
            const label = sid === 'worldInfoBefore' ? 'World Info (before)' : 'World Info (after)';
            return { cat: '世界書', source: `預設(${label})`, creator: 'ST核心', type: 'LOREBOOK', promptName: label, promptId: sid };
        }

        // ── 從 promptIdToName 查表取得顯示名稱 ──
        if (sid && CoreEngine.promptIdToName.has(sid)) {
            const displayName = CoreEngine.promptIdToName.get(sid);
            const isWorldBookMarker = displayName.includes('World Info') || displayName.includes('世界書');

            // 🌟 第二階段：檢查內容是否匹配世界書條目（精確 + 模糊）
            const msgNorm = msg._norm || CoreEngine.normalize(msg.content || '');
            if (!isWorldBookMarker && msgNorm.length > 10 && CoreEngine.worldInfoRegistry.size > 0) {
                // 精確匹配
                if (CoreEngine.worldInfoRegistry.has(msgNorm)) {
                    const wiMatch = CoreEngine.worldInfoRegistry.get(msgNorm);
                    return {
                        cat: '世界書',
                        source: `${wiMatch.worldBookName}(${wiMatch.entryName})`,
                        creator: '世界書系統',
                        type: 'LOREBOOK',
                        bookName: wiMatch.worldBookName,
                        entryName: wiMatch.entryName,
                        entryUid: wiMatch.uid,
                        isWorldBook: true,
                        promptName: displayName,
                        promptId: sid,
                    };
                }
                // 模糊匹配（內容被 macro 展開後可能不完全相同）
                const wiFuzzy = CoreEngine._findWorldBookFuzzy(msgNorm, msg._nGrams);
                if (wiFuzzy) {
                    return { ...wiFuzzy, promptName: displayName, promptId: sid };
                }
            }

            return {
                cat: isWorldBookMarker ? '世界書' : '預設',
                source: `預設(${displayName})`,
                creator: 'ST核心',
                type: isWorldBookMarker ? 'LOREBOOK' : 'DEFAULT',
                promptName: displayName,
                promptId: sid,
            };
        }

        // ── 從世界書註冊表（動態導入的世界書）查詢 ──
        // 注意：world info 條目在 ST 中可能被打包成一個 MessageCollection，
        // 此時 sid 為 'worldInfoBefore'/'worldInfoAfter'，已在上面處理。
        // 若條目以獨立方式注入（如透過 in-chat injection），每個條目會
        // 有自己的 MessageCollection，此時 identifier 即為該條目的來源。
        if (sid && sid.length > 0) {
            // 嘗試匹配 world_info 中的條目 UID 或名稱
            for (const [norm, wiData] of CoreEngine.worldInfoRegistry) {
                if (sid.includes(String(wiData.uid)) || sid === wiData.entryName) {
                    return {
                        cat: '世界書',
                        source: `世界書(${wiData.worldBookName}: ${wiData.entryName})`,
                        creator: '世界書系統',
                        type: 'LOREBOOK',
                        bookName: wiData.worldBookName,
                        entryName: wiData.entryName,
                        entryUid: wiData.uid,
                        isWorldBook: true,
                    };
                }
            }
        }

        // ── 有未知 identifier → 來自其他插件或自訂提示詞 ──
        if (sid && sid.length > 0) {
            // 🌟 精確+模糊匹配世界書條目內容
            const msgNorm = msg._norm || CoreEngine.normalize(msg.content || '');
            if (msgNorm.length > 10 && CoreEngine.worldInfoRegistry.size > 0) {
                if (CoreEngine.worldInfoRegistry.has(msgNorm)) {
                    const wiMatch = CoreEngine.worldInfoRegistry.get(msgNorm);
                    return {
                        cat: '世界書', source: `${wiMatch.worldBookName}(${wiMatch.entryName})`,
                        creator: '世界書系統', type: 'LOREBOOK',
                        bookName: wiMatch.worldBookName, entryName: wiMatch.entryName,
                        entryUid: wiMatch.uid, isWorldBook: true, promptId: sid,
                    };
                }
                const wiFuzzy = CoreEngine._findWorldBookFuzzy(msgNorm, msg._nGrams);
                if (wiFuzzy) return { ...wiFuzzy, promptId: sid };
            }
            return { cat: '其他插件', source: `其他插件(ID: ${sid})`, creator: sid, type: 'OTHER_PLUGIN', promptId: sid };
        }

        // ── 無 identifier 的最終 fallback（理論上不應發生） ──
        const contentTrimmed = msg.content ? msg.content.trim() : '';
        if (contentTrimmed.length === 0) {
            return { cat: '預設', source: '預設(空白分隔)', creator: 'ST核心', type: 'DEFAULT' };
        }
        return { cat: '預設', source: `預設(無ID標記)`, creator: 'ST核心', type: 'DEFAULT' };
    },
};

// ==========================================
// 🌌 絕對防禦矩陣 (雙軌排序引擎 & 量子切片)
// ==========================================
async function interceptAndRestructurePrompt(data) {
    if (data.dryRun || !data?.chat?.length) return;

    // ==========================================
    // 🔗 結構化溯源：單次動態導入 openai.js，同時用於 registry 和 zipping
    // ==========================================
    /** @type {Map<number, string>} */ let positionToIdentifier = new Map();
    try {
        const openaiMod = await import('../../../openai.js');
        const pm = openaiMod?.promptManager;

        // 先重建 registry（使用已導入的模組）
        await CoreEngine.buildRegistriesInternal(pm);

        // 再建立 position → identifier 映射
        if (pm?.messages?.collection) {
            let chatIdx = 0;
            for (let item of pm.messages.collection) {
                if (item.collection && Array.isArray(item.collection)) {
                    for (let msg of item.collection) {
                        if (msg.content || msg.tool_calls) {
                            if (chatIdx < data.chat.length) {
                                // 🌟 優先使用內層 Message 的 identifier（如 chatHistory-N），
                                // 外層 MessageCollection 的 identifier 作為 fallback
                                positionToIdentifier.set(chatIdx, msg.identifier || item.identifier);
                                chatIdx++;
                            }
                        }
                    }
                } else if (item.content || item.tool_calls) {
                    if (chatIdx < data.chat.length) {
                        positionToIdentifier.set(chatIdx, item.identifier || '');
                        chatIdx++;
                    }
                }
            }
            console.debug(`[DS Cache] 🔗 結構化溯源完成: ${positionToIdentifier.size}/${data.chat.length} 個 chat item 取得 identifier`);
        } else {
            console.debug('[DS Cache] ⚠️ promptManager.messages 不可用');
        }
    } catch (e) {
        console.debug('[DS Cache] ❌ 無法動態導入 openai.js:', e.message);
        // fallback: 仍然嘗試建立 registry
        await CoreEngine.buildRegistries();
    }

    try {
        const state = getChatState(getChatKey());
        let incomingStream = data.chat;
        let incomingPool = [];
        let ledger = [];

        const processTime = Logger.getTime();
        const chatTurn = getContext().chat ? getContext().chat.length : 0;
        const isChat1 = state.frozenSequence.length === 0;
        let otherPluginActions = new Set();
        let detailedMods = [];

        const contextChat = getContext().chat || [];
        let structuralMap = new Array(incomingStream.length).fill(null);
        let uidMap = new Array(incomingStream.length).fill(null);
        let chatIndexMap = new Array(incomingStream.length).fill(null);
        let rawChatContentMap = new Array(incomingStream.length).fill(null);
        
        for (let i = incomingStream.length - 1; i >= 0; i--) {
            if (incomingStream[i].role === 'system') continue;
            if (incomingStream[i].role === 'assistant') {
                if (contextChat.length > 0 && contextChat[contextChat.length - 1].is_user) {
                    structuralMap[i] = 'PREFILL';
                    uidMap[i] = 'chat_prefill';
                }
            }
            break;
        }

        let cIdx = contextChat.length - 1;
        for (let i = incomingStream.length - 1; i >= 0; i--) {
            if (structuralMap[i]) continue;
            let msg = incomingStream[i];
            
            if (msg.role === 'system') continue;
            let name = msg.name ? msg.name.toLowerCase() : '';
            if (name.includes('example') || name.includes('scenario') || name.includes('system')) continue;

            if (cIdx >= 0) {
                let expectedRole = contextChat[cIdx].is_user ? 'user' : 'assistant';
                if (msg.role === expectedRole) {
                    uidMap[i] = `chat_msg_${cIdx}`; 
                    chatIndexMap[i] = cIdx;
                    rawChatContentMap[i] = typeof contextChat[cIdx]?.mes === 'string' ? contextChat[cIdx].mes : '';
                    if (cIdx === contextChat.length - 1) structuralMap[i] = 'USER_CURRENT';
                    else if (cIdx === contextChat.length - 2) structuralMap[i] = 'AI_LAST_REPLY';
                    else structuralMap[i] = expectedRole === 'user' ? 'USER_HISTORY' : 'AI_HISTORY';
                    cIdx--;
                }
            } else if (cIdx === -1 && contextChat.length === 0) {
                if (msg.role === 'user' && !structuralMap.includes('USER_CURRENT')) {
                    structuralMap[i] = 'USER_CURRENT';
                    uidMap[i] = `chat_msg_0`;
                    chatIndexMap[i] = 0;
                    rawChatContentMap[i] = typeof contextChat[0]?.mes === 'string' ? contextChat[0].mes : msg.content;
                }
            }
        }

        let userCurrentText = "";
        for (let i = 0; i < incomingStream.length; i++) {
            if (structuralMap[i] === 'USER_CURRENT') {
                userCurrentText = incomingStream[i].content.trim();
                break;
            }
        }

        let catCounters = {};
        for (let i = 0; i < incomingStream.length; i++) {
            const msg = incomingStream[i];
            const structuralId = positionToIdentifier.get(i) || null;
            msg._structuralId = structuralId;
            msg._norm = CoreEngine.normalize(msg.content);
            msg._nGrams = CoreEngine.getGrams(msg._norm); 
            msg._origTemplate = CoreEngine.macroMap.get(msg._norm) || msg._norm;

            // 🌟 優先使用結構化 identifier 查找原始模板（含 {{}}），比 macroMap 更可靠
            if (structuralId && CoreEngine.promptIdToTemplateContent.has(structuralId)) {
                msg._origTemplate = CoreEngine.promptIdToTemplateContent.get(structuralId);
            } else {
                // Fallback: 嘗試 macroMap (正規化結果 → 原始模板)
                const macroTemplate = CoreEngine.macroMap.get(msg._norm);
                if (macroTemplate) msg._origTemplate = macroTemplate;
                // 第二 fallback: macroMapAll（含空字串解析的完整紀錄）
                if (!msg._origTemplate || msg._origTemplate === msg._norm) {
                    for (const [cleanOrig, data] of CoreEngine.macroMapAll) {
                        if (data.cleanRes === msg._norm) {
                            msg._origTemplate = cleanOrig;
                            break;
                        }
                    }
                }
            }

            let isDynamic = false;
            let contentTrimmed = msg.content ? msg.content.trim() : '';
            let nameLower = msg.name ? msg.name.toLowerCase() : '';
            
            if (nameLower.includes('summary') || nameLower.includes('summarization') || contentTrimmed.startsWith('[Summary:')) {
                isDynamic = true;
            } else if (userCurrentText.length > 3 && structuralMap[i] !== 'USER_CURRENT' && msg.content.includes(userCurrentText)) {
                isDynamic = true;
            } else if (CoreEngine._isWorldBookContent(msg)) {
                // 世界書保持 LOREBOOK 分類，後續按「新增加的世界書提示詞」區段追加
                isDynamic = false;
            } else if (msg._origTemplate.includes('{{') && msg._origTemplate.includes('}}')) {
                // 🌟 動態變數追蹤器: 第一次對話(輪)紀錄前後數據，後續對話對比第一次紀錄
                const trackerKey = msg._structuralId || msg._origTemplate;

                if (isChat1) {
                    // 第一次對話 → 紀錄帶有動態變數的提示詞的前後數據
                    if (!state.firstTurnRecords[trackerKey]) {
                        state.firstTurnRecords[trackerKey] = {
                            template: msg._origTemplate,              // 「前」：含 {{}} 的原始模板
                            baselineResolved: msg._norm,              // 「後」：正規化後的解析結果
                            baselineRaw: msg.content,                 // 「後」：原始解析結果
                            firstSeenTurn: chatTurn,
                            firstSeenTime: processTime,
                        };
                    }
                    // 同步更新 templateVarTracker（向後兼容）
                    if (!state.templateVarTracker[trackerKey]) {
                        state.templateVarTracker[trackerKey] = {
                            template: msg._origTemplate,
                            baselineResolved: msg._norm,
                            baselineRaw: msg.content,
                            isDynamic: false,
                            firstSeenTurn: chatTurn,
                            firstSeenTime: processTime,
                        };
                    }
                    // 第一次對話無法判定是否動態（需後續對話比對）
                    isDynamic = false;
                } else {
                    // 第2次對話及之後 → 對比第一次對話時的紀錄
                    const firstRecord = state.firstTurnRecords[trackerKey];
                    if (firstRecord) {
                        // 有第一次對話的基準紀錄 → 比對 {{}} 內的數據是否有任何更改
                        const dynamicChanged = (firstRecord.baselineResolved !== msg._norm);

                        // 同步更新 templateVarTracker
                        if (!state.templateVarTracker[trackerKey]) {
                            state.templateVarTracker[trackerKey] = {
                                template: msg._origTemplate,
                                baselineResolved: firstRecord.baselineResolved,
                                baselineRaw: firstRecord.baselineRaw,
                                isDynamic: dynamicChanged,
                                firstSeenTurn: firstRecord.firstSeenTurn,
                                firstSeenTime: firstRecord.firstSeenTime,
                            };
                        }

                        if (dynamicChanged) {
                            // {{}} 內的數據有變更 → 確認為動態提示詞
                            state.templateVarTracker[trackerKey].isDynamic = true;
                            state.templateVarTracker[trackerKey].lastResolved = msg._norm;
                            state.templateVarTracker[trackerKey].lastRaw = msg.content;
                            state.templateVarTracker[trackerKey].lastChangedTurn = chatTurn;
                            state.templateVarTracker[trackerKey].lastChangedTime = processTime;
                            isDynamic = true;
                            console.debug(`[DS Cache] 🔄 動態提示詞檢測: "${trackerKey}" 內容已變更 (第一次對話基準 ≠ 當前值)`);
                        } else {
                            // {{}} 內的數據無變更 → 不是動態提示詞
                            isDynamic = state.templateVarTracker[trackerKey].isDynamic || false;
                        }
                    } else {
                        // 沒有第一次對話的紀錄 → 此模板在第一次對話中未出現，記錄為新基準
                        if (!state.templateVarTracker[trackerKey]) {
                            state.templateVarTracker[trackerKey] = {
                                template: msg._origTemplate,
                                baselineResolved: msg._norm,
                                baselineRaw: msg.content,
                                isDynamic: false,
                                firstSeenTurn: chatTurn,
                                firstSeenTime: processTime,
                            };
                        }
                        isDynamic = state.templateVarTracker[trackerKey].isDynamic || false;
                    }
                }
            }

            msg._isDynamic = isDynamic;
            msg._attr = CoreEngine.classify(msg, structuralMap[i], isDynamic, structuralId);

            // 🔍 診斷日誌：顯示每個 item 的 identifier 與分類結果
            if (Settings.logLevel >= LogLevels.EXTREME) {
                console.debug(`[DS Cache] [${i}] role=${msg.role} sid="${structuralId || 'NONE'}" → cat="${msg._attr.cat}" src="${msg._attr.source}"`, Logger.truncate(msg.content));
            }
            
            if (msg._attr.type === 'OTHER_PLUGIN') {
                otherPluginActions.add(`[${msg._attr.creator}] 處理/注入了提示詞節點: ${msg._attr.source}`);
            } else if (msg._attr.type === 'LOREBOOK') {
                const bn = msg._attr.bookName || '未知世界書';
                const en = msg._attr.entryName || '未知條目';
                otherPluginActions.add(`[世界書系統] 注入世界書條目 → 📚 ${bn} → 📑 ${en}`);
            }

            if (!uidMap[i]) {
                let key = `${msg._attr.cat}_${msg.role}`;
                catCounters[key] = (catCounters[key] || 0) + 1;
                uidMap[i] = `struct_${key}_${catCounters[key]}`;
            }
            msg._uid = uidMap[i];
            if (chatIndexMap[i] !== null) {
                msg._chatIndex = chatIndexMap[i];
                msg._rawChatContent = rawChatContentMap[i];
            }
            msg._origIdx = i + 1;
            incomingPool.push(msg);
        }

        const printLog = (isPluginDisabled) => {
            if (Settings.logLevel < LogLevels.STANDARD) return;

            let mdLog = `**[${processTime}]** ### ${isPluginDisabled ? '🛑 [插件已停止] 原始提示詞序列分析' : '🛡️ 絕對防禦矩陣處理報告 (量子糾纏)'}\n\n`;

            if (otherPluginActions.size > 0) {
                mdLog += `#### 🧩 其他插件與系統動作偵測\n`;
                otherPluginActions.forEach(act => mdLog += `- ${act}\n`);
                mdLog += `\n`;
            }

            if (detailedMods.length > 0) {
                mdLog += `#### 📝 詳細修改與操作紀錄\n`;
                detailedMods.forEach(mod => mdLog += `- ${mod}\n`);
                mdLog += `\n`;
            }

            mdLog += `| 時間 | 原始排序 | 最終排序 | 對話輪數 | 角色 | 分類 | 原始來源 | 生成/出現 | 修改/創造者 | 處理方式 | 處理功能 | 狀態 | 提示詞內容 |\n`;
            mdLog += `|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;

            ledger.forEach(entry => {
                if (entry.status === '已刪除') entry.finalIdx = '-';
                else if (!isPluginDisabled) {
                    let idx = state.frozenSequence.indexOf(entry.ref);
                    entry.finalIdx = idx !== -1 ? idx + 1 : '-';
                }
            });

            ledger.sort((a, b) => {
                if (a.finalIdx === '-' && b.finalIdx === '-') return 0;
                if (a.finalIdx === '-') return 1;
                if (b.finalIdx === '-') return -1;
                return a.finalIdx - b.finalIdx;
            });

            ledger.forEach(l => {
                mdLog += `| ${l.time} | ${l.origIdx} | ${l.finalIdx} | 第 ${chatTurn} 輪 | ${l.role} | ${l.attr.cat} | ${l.attr.source} | ${l.gen} | ${l.creator} | ${l.action} | ${l.func} | ${l.status} | ${Logger.truncate(l.ref.content)} |\n`;
            });

            Logger.write(mdLog, LogLevels.DETAILED);
        };

        if (!Settings.enabled) {
            incomingPool.forEach((msg, idx) => {
                ledger.push({
                    time: processTime, ref: msg, origIdx: msg._origIdx, finalIdx: idx + 1,
                    role: msg.role.charAt(0).toUpperCase() + msg.role.slice(1),
                    attr: msg._attr, gen: '原始載入', creator: msg._attr.creator, action: '未處理', func: '插件已停用', status: '未凍結'
                });
            });
            printLog(true);
            return; 
        }

        let incomingUidMap = new Map();
        let incomingNormMap = new Map();
        incomingPool.forEach((msg, j) => {
            if (!incomingUidMap.has(msg._uid)) incomingUidMap.set(msg._uid, []);
            incomingUidMap.get(msg._uid).push(j);
            
            if (!incomingNormMap.has(msg._norm)) incomingNormMap.set(msg._norm, []);
            incomingNormMap.get(msg._norm).push(j);
        });

        const hasRawChatTracking = (msg) => typeof msg?._rawChatContent === 'string';
        const isFrozenConversationNode = (msg) => {
            const attr = msg?._attr || {};
            return attr.type === 'USER_HISTORY'
                || attr.type === 'AI_HISTORY'
                || attr.type === 'USER_CURRENT'
                || attr.type === 'AI_LAST_REPLY'
                || attr.type === 'PREFILL'
                || attr.cat === '用戶'
                || attr.cat === 'AI'
                || attr.cat === '聊天';
        };
        const isLegacyUntrackedConversation = (msg) => isFrozenConversationNode(msg) && !hasRawChatTracking(msg);

        let nextFrozen = [];
        let matchResults = new Array(state.frozenSequence.length).fill(-1);
        let matchedIncomingIndices = new Set();
        let matchedFrozenIndices = new Set();
        
        for (let i = 0; i < state.frozenSequence.length; i++) {
            let frozen = state.frozenSequence[i];
            if (frozen._uid && frozen._uid.startsWith('chat_') && !isLegacyUntrackedConversation(frozen)) {
                let indices = incomingUidMap.get(frozen._uid);
                if (indices) {
                    for (let j of indices) {
                        if (!matchedIncomingIndices.has(j)) {
                            matchResults[i] = j; matchedIncomingIndices.add(j); matchedFrozenIndices.add(i); break;
                        }
                    }
                }
            }
        }

        for (let i = 0; i < state.frozenSequence.length; i++) {
            if (matchedFrozenIndices.has(i)) continue;
            let frozen = state.frozenSequence[i];
            let indices = incomingNormMap.get(frozen._norm);
            if (indices) {
                for (let j of indices) {
                    if (!matchedIncomingIndices.has(j) && incomingPool[j].role === frozen.role) {
                        matchResults[i] = j; matchedIncomingIndices.add(j); matchedFrozenIndices.add(i); break;
                    }
                }
            }
        }

        for (let i = 0; i < state.frozenSequence.length; i++) {
            if (matchedFrozenIndices.has(i)) continue;
            let frozen = state.frozenSequence[i];
            if (frozen._isDynamic) continue;
            if (isLegacyUntrackedConversation(frozen)) continue;
            
            if (!frozen._nGrams || !(frozen._nGrams instanceof Set)) {
                frozen._nGrams = CoreEngine.getGrams(frozen._norm || ''); 
            }
            
            let bestMatchIdx = -1; let bestSim = 0;
            for (let j = 0; j < incomingPool.length; j++) {
                if (matchedIncomingIndices.has(j)) continue;
                if (incomingPool[j].role !== frozen.role || incomingPool[j]._isDynamic || incomingPool[j]._attr.cat !== frozen._attr.cat) continue;
                
                let sim = CoreEngine.getSimilarityFast(frozen._nGrams, incomingPool[j]._nGrams);
                if (sim > bestSim) { bestSim = sim; bestMatchIdx = j; }
            }
            if (bestSim > 0.5 && bestMatchIdx !== -1) {
                matchResults[i] = bestMatchIdx; matchedIncomingIndices.add(bestMatchIdx); matchedFrozenIndices.add(i);
            }
        }

        for (let i = 0; i < state.frozenSequence.length; i++) {
            if (matchedFrozenIndices.has(i)) continue;
            let frozen = state.frozenSequence[i];
            if (frozen._isDynamic) continue;
            if (isLegacyUntrackedConversation(frozen)) continue;
            
            let indices = incomingUidMap.get(frozen._uid);
            if (indices) {
                for (let j of indices) {
                    if (!matchedIncomingIndices.has(j) && incomingPool[j]._attr.cat === frozen._attr.cat) {
                        matchResults[i] = j; matchedIncomingIndices.add(j); matchedFrozenIndices.add(i); break;
                    }
                }
            }
        }

        let totalFrozenLen = state.frozenSequence.reduce((acc, m) => acc + m.content.length, 0) || 1;
        let currentValidLength = 0;
        let firstBreakIndex = -1; 
        let breakNodeName = "";
        let syncMessages = [];
        let extractedAppends = []; // 🌟 存放切下來的尾巴
        let queuedDefaultAdditions = [];
        let queuedLorebookAdditions = [];
        let queuedOtherAdditions = [];
        let queuedDynamicAdditions = [];
        let queuedHistoryAdditions = [];
        let queuedAiLastReplyAdditions = [];
        let queuedCurrentUserAdditions = [];
        let queuedPrefillAdditions = [];

        const byOriginalOrder = (a, b) => (a._origIdx || 0) - (b._origIdx || 0);
        const isFrozenPromptNode = (msg) => {
            const attr = msg?._attr || {};
            return !!msg?._isDynamic
                || attr.type === 'DEFAULT'
                || attr.type === 'LOREBOOK'
                || attr.type === 'OTHER_PLUGIN'
                || attr.type === 'SUMMARY'
                || attr.type === 'DYNAMIC'
                || attr.cat === '預設'
                || attr.cat === '世界書'
                || attr.cat === '其他插件'
                || attr.cat === '摘要'
                || attr.cat === '動態';
        };
        const cloneFrozenAddition = (msg) => {
            const cloned = Object.assign({}, msg);
            cloned._attr = Object.assign({}, msg._attr);
            cloned._nGrams = CoreEngine.getGrams(cloned._norm || CoreEngine.normalize(cloned.content || ''));
            cloned._uid = `${msg._uid || msg._structuralId || 'prompt'}::frozen_add_${cloned._origIdx || 0}_${(cloned._norm || '').slice(0, 24)}`;
            return cloned;
        };
        const cloneConversationAddition = (msg) => {
            const cloned = Object.assign({}, msg);
            cloned._attr = Object.assign({}, msg._attr);
            cloned._nGrams = CoreEngine.getGrams(cloned._norm || CoreEngine.normalize(cloned.content || ''));
            cloned._uid = `${msg._uid || msg._structuralId || 'chat'}::conversation_add_${cloned._origIdx || 0}_${(cloned._norm || '').slice(0, 24)}`;
            return cloned;
        };
        const queueConversationAddition = (msg) => {
            if (!msg?._attr) return;
            if (msg._attr.type === 'USER_CURRENT') queuedCurrentUserAdditions.push(msg);
            else if (msg._attr.type === 'PREFILL') queuedPrefillAdditions.push(msg);
            else if (msg._attr.type === 'AI_LAST_REPLY') queuedAiLastReplyAdditions.push(msg);
            else queuedHistoryAdditions.push(msg);
        };
        const queueFrozenAddition = (msg) => {
            if (!msg?._attr) return;
            const attrType = msg._attr.type;
            if (msg._isDynamic || attrType === 'SUMMARY' || attrType === 'DYNAMIC') queuedDynamicAdditions.push(msg);
            else if (attrType === 'DEFAULT') queuedDefaultAdditions.push(msg);
            else if (attrType === 'LOREBOOK') queuedLorebookAdditions.push(msg);
            else queuedOtherAdditions.push(msg);
        };
        const rawTextChanged = (frozen, matched) => {
            if (!hasRawChatTracking(frozen) || !hasRawChatTracking(matched)) return false;
            return CoreEngine.normalize(frozen._rawChatContent) !== CoreEngine.normalize(matched._rawChatContent);
        };
        const rawChatStillExists = (frozen) => {
            if (!hasRawChatTracking(frozen)) return false;
            const targetNorm = CoreEngine.normalize(frozen._rawChatContent);
            if (!targetNorm) return false;
            return contextChat.some(item => CoreEngine.normalize(item?.mes || '') === targetNorm);
        };
        const getPromptLocator = (msg) => Diagnostics.describeLocator(msg);
        const getSourceDetail = (msg) => {
            const attr = msg?._attr || {};
            return [
                attr.promptName ? `promptName=${attr.promptName}` : '',
                attr.promptId ? `promptId=${attr.promptId}` : '',
                attr.bookName ? `book=${attr.bookName}` : '',
                attr.entryName ? `entry=${attr.entryName}` : '',
                msg?._structuralId ? `identifier=${msg._structuralId}` : '',
                Number.isInteger(msg?._chatIndex) ? `chatIndex=${msg._chatIndex}` : '',
                msg?._uid ? `uid=${msg._uid}` : '',
            ].filter(Boolean).join(' | ');
        };
        let regexEnginePromise = null;
        const getRegexEngine = async () => {
            if (!regexEnginePromise) {
                regexEnginePromise = import('../../regex/engine.js').catch(err => {
                    console.debug('[DS Cache] Regex attribution unavailable:', err?.message || err);
                    return null;
                });
            }
            return regexEnginePromise;
        };
        const typeLabel = (engine, type) => {
            if (!engine) return 'Unknown';
            if (type === engine.SCRIPT_TYPES?.GLOBAL) return 'Global';
            if (type === engine.SCRIPT_TYPES?.SCOPED) return 'Scoped';
            if (type === engine.SCRIPT_TYPES?.PRESET) return 'Preset';
            return 'Unknown';
        };
        const regexPlacementsFor = (engine, msg) => {
            const placements = [];
            const attrType = msg?._attr?.type;
            if (attrType === 'LOREBOOK' && engine.regex_placement?.WORLD_INFO !== undefined) placements.push(engine.regex_placement.WORLD_INFO);
            if ((msg?.role === 'assistant' || attrType === 'AI_HISTORY' || attrType === 'AI_LAST_REPLY' || attrType === 'PREFILL') && engine.regex_placement?.AI_OUTPUT !== undefined) placements.push(engine.regex_placement.AI_OUTPUT);
            if ((msg?.role === 'user' || attrType === 'USER_HISTORY' || attrType === 'USER_CURRENT') && engine.regex_placement?.USER_INPUT !== undefined) placements.push(engine.regex_placement.USER_INPUT);
            if (engine.regex_placement?.USER_INPUT !== undefined) placements.push(engine.regex_placement.USER_INPUT);
            if (engine.regex_placement?.AI_OUTPUT !== undefined) placements.push(engine.regex_placement.AI_OUTPUT);
            if (engine.regex_placement?.WORLD_INFO !== undefined) placements.push(engine.regex_placement.WORLD_INFO);
            return [...new Set(placements)];
        };
        const diagnoseRegexMutation = async (beforeCandidates, after, msg) => {
            const engine = await getRegexEngine();
            if (!engine?.getScriptsByType || !engine?.runRegexScript || !engine?.SCRIPT_TYPES) return null;
            const targetNorm = CoreEngine.normalize(after);
            if (!targetNorm) return null;
            const scriptTypes = [engine.SCRIPT_TYPES.GLOBAL, engine.SCRIPT_TYPES.SCOPED, engine.SCRIPT_TYPES.PRESET];
            const scripts = scriptTypes.flatMap(type => {
                try {
                    return (engine.getScriptsByType(type, { allowedOnly: true }) || []).map(script => ({ script, type }));
                } catch (_) {
                    return [];
                }
            });
            if (scripts.length === 0) return null;

            const candidates = [...new Set((beforeCandidates || []).filter(x => typeof x === 'string' && x.length > 0))];
            for (const rawBefore of candidates) {
                for (const placement of regexPlacementsFor(engine, msg)) {
                    let current = rawBefore;
                    const changed = [];
                    for (const item of scripts) {
                        const script = item.script;
                        const promptOnlyOk = script.promptOnly === true;
                        if (!promptOnlyOk || !Array.isArray(script.placement) || !script.placement.includes(placement)) continue;
                        const next = engine.runRegexScript(script, current);
                        if (next !== current) {
                            changed.push({
                                name: script.scriptName || script.id || 'Unnamed regex',
                                type: typeLabel(engine, item.type),
                                id: script.id || '',
                            });
                            current = next;
                        }
                    }
                    if (changed.length > 0 && CoreEngine.normalize(current) === targetNorm) {
                        return {
                            source: `Regex ${changed.map(x => `${x.type}:${x.name}`).join(' -> ')}`,
                            detail: changed.map(x => `${x.type} regex "${x.name}"${x.id ? ` id=${x.id}` : ''}`).join(' | '),
                            exact: true,
                        };
                    }
                }
            }
            return null;
        };
        const diagnoseChange = async (frozen, matched) => {
            const attr = matched?._attr || frozen?._attr || {};
            if (rawTextChanged(frozen, matched)) {
                return {
                    type: '手動修改',
                    source: attr.type?.startsWith('AI') ? '聊天訊息編輯: AI回覆' : '聊天訊息編輯: 用戶輸入',
                    sourceDetail: getSourceDetail(matched),
                    confidence: 'high',
                };
            }
            if (isFrozenConversationNode(frozen) && isFrozenConversationNode(matched) && (!hasRawChatTracking(frozen) || !hasRawChatTracking(matched))) {
                return {
                    type: '舊版狀態',
                    source: '缺少原始聊天追蹤，無法證明是用戶手動修改',
                    sourceDetail: getSourceDetail(matched),
                    confidence: 'low',
                };
            }
            const regex = await diagnoseRegexMutation([
                frozen?.content,
                matched?._rawChatContent,
                matched?._origTemplate,
            ], matched?.content || '', matched || frozen);
            if (regex) {
                return {
                    type: '自動轉換',
                    source: regex.source,
                    sourceDetail: regex.detail,
                    confidence: 'high',
                };
            }
            const frozenTemplate = frozen?._origTemplate || '';
            const matchedTemplate = matched?._origTemplate || '';
            if (frozenTemplate && matchedTemplate && CoreEngine.normalize(frozenTemplate) !== CoreEngine.normalize(matchedTemplate)) {
                if (attr.type === 'LOREBOOK') {
                    return { type: '提示詞來源修改', source: `世界書條目: ${attr.bookName || '未知世界書'} -> ${attr.entryName || attr.entryUid || '未知條目'}`, sourceDetail: getSourceDetail(matched), confidence: 'high' };
                }
                if (attr.type === 'DEFAULT') {
                    return { type: '提示詞來源修改', source: `預設提示詞: ${attr.promptName || attr.promptId || attr.source}`, sourceDetail: getSourceDetail(matched), confidence: 'high' };
                }
                if (attr.type === 'OTHER_PLUGIN') {
                    return { type: '提示詞來源修改', source: `插件/自訂提示詞: ${attr.promptId || attr.creator || attr.source}`, sourceDetail: getSourceDetail(matched), confidence: 'medium' };
                }
                return { type: '提示詞來源修改', source: attr.source || '未知提示詞來源', sourceDetail: getSourceDetail(matched), confidence: 'medium' };
            }
            if (frozen?._isDynamic || matched?._isDynamic || attr.type === 'DYNAMIC') {
                return { type: '自動轉換', source: `動態提示詞/模板變數: ${attr.promptName || attr.promptId || attr.source}`, sourceDetail: getSourceDetail(matched), confidence: 'high' };
            }
            if (attr.type === 'SUMMARY') {
                return { type: '自動轉換', source: `ST系統摘要: ${attr.promptId || attr.source}`, sourceDetail: getSourceDetail(matched), confidence: 'high' };
            }
            return { type: '未知修改', source: attr.source || '未知來源', sourceDetail: getSourceDetail(matched), confidence: 'low' };
        };

        for (let i = 0; i < state.frozenSequence.length; i++) {
            let frozen = state.frozenSequence[i];
            let matchIdx = matchResults[i];
            const roleStr = frozen.role.charAt(0).toUpperCase() + frozen.role.slice(1);

            if (frozen._origTemplate && state.promptTracker[frozen._origTemplate]?.isDynamic) {
                frozen._isDynamic = true;
                if (frozen._attr.type !== 'DYNAMIC') {
                    frozen._attr.cat = '動態'; frozen._attr.source = '動態提示詞(舊版保留)'; frozen._attr.type = 'DYNAMIC';
                }
            }

            if (matchIdx !== -1) {
                let matched = incomingPool[matchIdx];
                if (frozen._norm === matched._norm) {
                    nextFrozen.push(frozen);
                    if (firstBreakIndex === -1) currentValidLength += frozen.content.length;
                    ledger.push({ time: processTime, ref: frozen, origIdx: matched._origIdx, role: roleStr, attr: frozen._attr, gen: '繼承', creator: frozen._attr.creator, action: '原位凍結', func: '量子糾纏(完美匹配)', status: '已凍結' });
                } else {
                    // 🌟 優先量子切片：偵測是否僅為尾部追加（防止動態聚合訊息如 World Info 重複注入）
                    let isJustAppended = false;
                    let appendedContent = "";

                    if (matched._norm.startsWith(frozen._norm) && matched._norm.length > frozen._norm.length) {
                        let origIdx = 0;
                        let newIdx = 0;
                        let origClean = frozen.content.replace(/[\s\n\r\t]/g, '');

                        while (origIdx < origClean.length && newIdx < matched.content.length) {
                            if (matched.content[newIdx].replace(/[\s\n\r\t]/g, '') === origClean[origIdx]) {
                                origIdx++;
                            }
                            newIdx++;
                        }

                        if (origIdx === origClean.length) {
                            isJustAppended = true;
                            appendedContent = matched.content.substring(newIdx).trim();
                        }
                    }

                    if (isJustAppended && appendedContent && isFrozenPromptNode(frozen)) {
                        // 1. 保留原凍結節點不變 (救回緩存)
                        nextFrozen.push(frozen);
                        if (firstBreakIndex === -1) currentValidLength += frozen.content.length;
                        ledger.push({ time: processTime, ref: frozen, origIdx: matched._origIdx, role: roleStr, attr: frozen._attr, gen: '繼承', creator: frozen._attr.creator, action: '原位凍結', func: '量子糾纏(無損追加)', status: '已凍結' });

                        detailedMods.push(`[追加] 偵測到節點尾部新增，已抽取追加內容: ${matched._attr.source}`);
                        const changeInfo = await diagnoseChange(frozen, matched);
                        Diagnostics.recordModification({
                            type: changeInfo.type,
                            source: changeInfo.source,
                            sourceDetail: changeInfo.sourceDetail || getPromptLocator(matched),
                            target: getPromptLocator(matched),
                            before: frozen.content,
                            after: appendedContent,
                            outcome: '提示詞尾部新增已抽離追加，舊節點保持凍結',
                            confidence: changeInfo.confidence,
                        });
                        if (Settings.logLevel >= LogLevels.EXTREME) {
                            Logger.write(`**[${processTime}]** 📋 [EXTREME] 無損追加（尾部新增抽取）: ${frozen._attr.source}`, LogLevels.EXTREME);
                            Logger.write(`  📄 原文: ${frozen.content}`, LogLevels.EXTREME);
                            Logger.write(`  ✂️ 追加內容: ${appendedContent}`, LogLevels.EXTREME);
                        }

                        // 2. 創建切下來的追加節點
                        let appendedMsg = Object.assign({}, matched);
                        appendedMsg.content = appendedContent;
                        appendedMsg._norm = CoreEngine.normalize(appendedContent);
                        appendedMsg._nGrams = CoreEngine.getGrams(appendedMsg._norm);
                        const appendedIsDynamic = !!(matched._isDynamic || frozen._isDynamic || matched._attr.type === 'SUMMARY' || matched._attr.type === 'DYNAMIC');
                        appendedMsg._isDynamic = appendedIsDynamic;
                        appendedMsg._diagAction = '尾部追加已抽離';
                        appendedMsg._attr = Object.assign({}, matched._attr);
                        appendedMsg._attr.source = `${matched._attr.source}(追加內容)`;
                        if (appendedIsDynamic) {
                            appendedMsg._attr.cat = '動態';
                            appendedMsg._attr.type = 'DYNAMIC';
                        } else if (matched._attr.type === 'LOREBOOK') {
                            appendedMsg._attr.cat = '世界書';
                            appendedMsg._attr.type = 'LOREBOOK';
                        } else {
                            appendedMsg._attr.cat = '其他插件';
                            appendedMsg._attr.type = 'OTHER_PLUGIN';
                        }

                        queueFrozenAddition(cloneFrozenAddition(appendedMsg));
                    } else {
                    // 🌟 動態模板保護：偵測基於 {{}} 模板的內容變更，保留舊版以保護 DS 緩存
                    const frozenIdent = frozen._structuralId || (frozen._attr && frozen._attr.promptId);
                    const isTemplateDynamic = (
                        (frozen._origTemplate && frozen._origTemplate.includes('{{'))
                        || frozen._isDynamic || matched._isDynamic
                    ) && (
                        (frozenIdent && state.templateVarTracker[frozenIdent] && state.templateVarTracker[frozenIdent].isDynamic)
                        || frozen._isDynamic || matched._isDynamic
                    );

                    if (isTemplateDynamic) {
                        // 🛡️ 保護舊版凍結節點（維持 DS 緩存連續性）
                        nextFrozen.push(frozen);
                        if (firstBreakIndex === -1) currentValidLength += frozen.content.length;
                        ledger.push({ time: processTime, ref: frozen, origIdx: matched._origIdx, role: roleStr, attr: frozen._attr, gen: '繼承', creator: frozen._attr.creator, action: '原位凍結', func: '量子糾纏(動態舊版保留)', status: '已凍結' });

                        // 🌟 新版動態提示詞排入對話尾部的動態區，不插入舊版旁邊
                        const updatedMsg = Object.assign({}, matched);
                        updatedMsg._isDynamic = true;
                        updatedMsg._attr = Object.assign({}, matched._attr);
                        updatedMsg._attr.cat = '動態';
                        updatedMsg._attr.source = `${matched._attr.source}(動態更新)`;
                        updatedMsg._attr.type = 'DYNAMIC';
                        updatedMsg._diagAction = '動態更新新增鏡像';
                        queueFrozenAddition(cloneFrozenAddition(updatedMsg));

                        // 保持 matchedIncomingIndices 不變，避免新版透過剩餘池重複加入
                        detailedMods.push(`[動態] 偵測到動態提示詞內容變更，舊版保留，新版排入動態區: ${frozen._attr.source}`);
                        const changeInfo = await diagnoseChange(frozen, matched);
                        Diagnostics.recordModification({
                            type: changeInfo.type,
                            source: changeInfo.source,
                            sourceDetail: changeInfo.sourceDetail || getPromptLocator(matched),
                            target: getPromptLocator(matched),
                            before: frozen.content,
                            after: matched.content,
                            outcome: '動態提示詞舊版保留，新版鏡像追加',
                            confidence: changeInfo.confidence,
                        });
                        console.debug(`[DS Cache] 🛡️ 動態模板保護: "${frozen._attr.source}" 舊版保留，新版排入動態區`);
                        if (Settings.logLevel >= LogLevels.EXTREME) {
                            Logger.write(`**[${processTime}]** 📋 [EXTREME] 動態模板舊版保留: ${frozen._attr.source}`, LogLevels.EXTREME);
                            Logger.write(`  🗃️ 舊版內容: ${frozen.content}`, LogLevels.EXTREME);
                            Logger.write(`  🆕 新版內容: ${updatedMsg.content}`, LogLevels.EXTREME);
                        }
                    } else if (isFrozenPromptNode(frozen) && isFrozenPromptNode(matched)) {
                        // 提示詞類節點一旦凍結就不覆寫；新版只作為新增提示詞排入本輪指定區段
                        nextFrozen.push(frozen);
                        if (firstBreakIndex === -1) currentValidLength += frozen.content.length;
                        ledger.push({ time: processTime, ref: frozen, origIdx: matched._origIdx, role: roleStr, attr: frozen._attr, gen: '繼承', creator: frozen._attr.creator, action: '原位凍結', func: '絕對凍結(提示詞舊版保留)', status: '已凍結' });

                        const addedPrompt = cloneFrozenAddition(matched);
                        addedPrompt._diagAction = '提示詞修改新增鏡像';
                        queueFrozenAddition(addedPrompt);
                        detailedMods.push(`[新增] 偵測到提示詞內容更新，舊版保留並新增新版: ${matched._attr.source}`);
                        const changeInfo = await diagnoseChange(frozen, matched);
                        Diagnostics.recordModification({
                            type: changeInfo.type,
                            source: changeInfo.source,
                            sourceDetail: changeInfo.sourceDetail || getPromptLocator(matched),
                            target: getPromptLocator(matched),
                            before: frozen.content,
                            after: matched.content,
                            outcome: '提示詞舊版保留，新版按來源區段追加',
                            confidence: changeInfo.confidence,
                        });
                        if (Settings.logLevel >= LogLevels.EXTREME) {
                            Logger.write(`**[${processTime}]** 📋 [EXTREME] 提示詞舊版保留並新增新版: ${frozen._attr.source}`, LogLevels.EXTREME);
                            Logger.write(`  🗃️ 舊版內容: ${frozen.content}`, LogLevels.EXTREME);
                            Logger.write(`  🆕 新版內容: ${matched.content}`, LogLevels.EXTREME);
                        }
                    } else {
                        // 🌟 檢查配對是否為 ST 上下文管理導致的錯誤匹配
                        // 情境：角色完全不同（AI vs User, 世界書 vs 歷史）→ 跳過鏡像同步
                        const roleMismatch = matched._attr && frozen._attr && (
                            (frozen.role !== matched.role) ||
                            (frozen._attr.type?.includes('LOREBOOK') && !matched._attr.type?.includes('LOREBOOK')) ||
                            (!frozen._attr.type?.includes('LOREBOOK') && matched._attr.type?.includes('LOREBOOK'))
                        );
                        let isBadMatch = false;
                        if (roleMismatch && matched._nGrams && frozen._nGrams) {
                            const sim = CoreEngine.getSimilarityFast(frozen._nGrams, matched._nGrams);
                            if (sim < 0.5) isBadMatch = true; // 相似度低 + 角色不同 = 錯誤匹配
                        }

                        if (isBadMatch) {
                            // 保留舊版，不執行鏡像同步（ST 上下文管理導致）
                            nextFrozen.push(frozen);
                            if (firstBreakIndex === -1) currentValidLength += frozen.content.length;
                            ledger.push({ time: processTime, ref: frozen, origIdx: '-', role: roleStr, attr: frozen._attr, gen: '繼承', creator: frozen._attr.creator, action: '原位凍結', func: '量子糾纏(上下文移位保留)', status: '已凍結' });
                            if (Settings.logLevel >= LogLevels.EXTREME) {
                                Logger.write(`**[${processTime}]** 📋 [EXTREME] 錯誤匹配保留（上下文移位）: ${frozen._attr.source}`, LogLevels.EXTREME);
                                Logger.write(`  🗃️ 保留內容: ${frozen.content}`, LogLevels.EXTREME);
                                Logger.write(`  ⚠️ 匹配內容（已忽略）: ${matched.content}`, LogLevels.EXTREME);
                            }
                        } else {
                            // 🌟 檢查是否為 ST 上下文管理導致的重新分類（非用戶修改）
                            const trackedRawChanged = rawTextChanged(frozen, matched);
                            const isHistoryReclass = (
                                matched._attr && frozen._attr && (
                                    (frozen._attr.type === 'AI_LAST_REPLY' && (matched._attr.type === 'AI_HISTORY' || matched._attr.type === 'USER_HISTORY')) ||
                                    (frozen._attr.type === 'USER_CURRENT' && (matched._attr.type === 'USER_HISTORY' || matched._attr.type === 'AI_HISTORY')) ||
                                    (frozen._attr.type === 'PREFILL' && (matched._attr.type === 'AI_HISTORY' || matched._attr.type === 'PREFILL'))
                                )
                            );

                            let isReclassHighSim = false;
                            if (isHistoryReclass && !trackedRawChanged && matched._nGrams && frozen._nGrams) {
                                const sim = CoreEngine.getSimilarityFast(frozen._nGrams, matched._nGrams);
                                isReclassHighSim = true; // 只有原始聊天內容未變時，才把分類移位視為 ST 上下文重分類
                            }

                            if (isReclassHighSim) {
                                // ST 上下文重新分類：內容與 metadata 都維持舊版凍結，避免已凍結節點被改寫。
                                if (Settings.logLevel >= LogLevels.EXTREME) {
                                    Logger.write(`**[${processTime}]** 📋 [EXTREME] 上下文重分類保留: ${frozen._attr.source}`, LogLevels.EXTREME);
                                    Logger.write(`  原內容: ${frozen.content}`, LogLevels.EXTREME);
                                    Logger.write(`  偵測分類: ${frozen._attr.source} → ${matched._attr.source}`, LogLevels.EXTREME);
                                }
                                nextFrozen.push(frozen);
                                if (firstBreakIndex === -1) currentValidLength += frozen.content.length;
                                ledger.push({ time: processTime, ref: frozen, origIdx: matched._origIdx, role: roleStr, attr: frozen._attr, gen: '繼承', creator: frozen._attr.creator, action: '原位凍結', func: '絕對凍結(上下文重分類保留)', status: '已凍結' });
                            } else if (
                                isFrozenConversationNode(frozen)
                                && isFrozenConversationNode(matched)
                                && (
                                    !hasRawChatTracking(frozen)
                                    || !hasRawChatTracking(matched)
                                    || !rawTextChanged(frozen, matched)
                                )
                            ) {
                                // 歷史/對話節點已凍結後不可覆寫；新版對話內容另行排入對話追加區。
                                nextFrozen.push(frozen);
                                if (firstBreakIndex === -1) currentValidLength += frozen.content.length;
                                ledger.push({ time: processTime, ref: frozen, origIdx: matched._origIdx, role: roleStr, attr: frozen._attr, gen: '繼承', creator: frozen._attr.creator, action: '原位凍結', func: '絕對凍結(歷史舊版保留)', status: '已凍結' });

                                const addedConversation = cloneConversationAddition(matched);
                                addedConversation._diagAction = '自動轉換新增鏡像';
                                queueConversationAddition(addedConversation);
                                detailedMods.push(`[保留] 歷史節點內容變化，舊版保留並將新版排入對話區: ${frozen._attr.source}`);
                                const changeInfo = await diagnoseChange(frozen, matched);
                                Diagnostics.recordModification({
                                    type: changeInfo.type,
                                    source: changeInfo.source,
                                    sourceDetail: changeInfo.sourceDetail || getPromptLocator(matched),
                                    target: getPromptLocator(matched),
                                    before: frozen.content,
                                    after: matched.content,
                                    outcome: hasRawChatTracking(frozen) && hasRawChatTracking(matched)
                                        ? '聊天原文未變，判定為自動轉換；舊版保留，新版鏡像追加'
                                        : '舊版凍結節點缺少原文追蹤；保守保留舊版，新版鏡像追加',
                                    confidence: changeInfo.confidence,
                                });
                                if (Settings.logLevel >= LogLevels.EXTREME) {
                                    Logger.write(`**[${processTime}]** 📋 [EXTREME] 歷史舊版保留並新增新版: ${frozen._attr.source}`, LogLevels.EXTREME);
                                    Logger.write(`  🗃️ 舊版內容: ${frozen.content}`, LogLevels.EXTREME);
                                    Logger.write(`  🆕 新版內容: ${matched.content}`, LogLevels.EXTREME);
                                }
                            } else {
                        // 正常的修改，執行鏡像同步 (會斷緩存)
                        const changeInfo = await diagnoseChange(frozen, matched);
                        Diagnostics.recordModification({
                            type: changeInfo.type,
                            source: changeInfo.source,
                            sourceDetail: changeInfo.sourceDetail || getPromptLocator(matched),
                            target: getPromptLocator(matched),
                            before: changeInfo.type === '手動修改' && hasRawChatTracking(frozen) ? frozen._rawChatContent : frozen.content,
                            after: changeInfo.type === '手動修改' && hasRawChatTracking(matched) ? matched._rawChatContent : matched.content,
                            outcome: isFrozenConversationNode(frozen) ? '用戶/AI原文修改已完整同步' : '來源修改已鏡像同步',
                            confidence: changeInfo.confidence,
                        });
                        if (firstBreakIndex === -1) { firstBreakIndex = currentValidLength; breakNodeName = frozen._attr.source; }
                        syncMessages.push(`<span style="color:#ffaa00;">[內容修改]</span> ${matched._attr.source}`);
                        detailedMods.push(`[修改] 偵測到歷史節點被修改: ${frozen._attr.source}`);

                        // 📋 極限日誌：輸出原文及修改後的內容（完整顯示）
                        if (Settings.logLevel >= LogLevels.EXTREME) {
                            Logger.write(`**[${processTime}]** 📋 [EXTREME] 鏡像同步修改: ${frozen._attr.source}`, LogLevels.EXTREME);
                            Logger.write(`  📄 原文: ${frozen.content}`, LogLevels.EXTREME);
                            Logger.write(`  📝 改後: ${matched.content}`, LogLevels.EXTREME);
                        }

                        frozen.content = matched.content;
                        frozen._norm = matched._norm;
                        frozen._nGrams = matched._nGrams;
                        frozen._origTemplate = matched._origTemplate;
                        frozen._uid = matched._uid;
                        frozen._structuralId = matched._structuralId;
                        frozen._chatIndex = matched._chatIndex;
                        frozen._rawChatContent = matched._rawChatContent;
                        frozen._attr = matched._attr;
                        frozen._diagAction = '完整同步';

                        nextFrozen.push(frozen);
                        let funcName = frozen._uid === matched._uid ? '量子糾纏(結構感知)' : '量子糾纏(語義感知)';
                        ledger.push({ time: processTime, ref: frozen, origIdx: matched._origIdx, role: roleStr, attr: frozen._attr, gen: '修改', creator: frozen._attr.creator, action: '鏡像同步', func: funcName, status: '已凍結' });
                        }
                    }
                    } // 🌟 結束 isJustAppended 分支
                } // 🌟 結束 content-differs 分支
            } // 🌟 結束 matchIdx !== -1 分支

            // 處理未匹配條目（原為 else if，因 JS 語法限制改為獨立 if）
            if (matchIdx === -1 && isFrozenPromptNode(frozen)) {
                nextFrozen.push(frozen);
                if (firstBreakIndex === -1) currentValidLength += frozen.content.length;
                ledger.push({ time: processTime, ref: frozen, origIdx: '-', role: roleStr, attr: frozen._attr, gen: '繼承', creator: frozen._attr.creator, action: '原位凍結', func: '絕對凍結(提示詞保留)', status: '已凍結' });
                if (Settings.logLevel >= LogLevels.EXTREME) {
                    Logger.write(`**[${processTime}]** 📋 [EXTREME] 提示詞保留（本輪未出現）: ${frozen._attr.source}`, LogLevels.EXTREME);
                    Logger.write(`  🗃️ 保留內容: ${frozen.content}`, LogLevels.EXTREME);
                }
            } else if (matchIdx === -1 && isFrozenConversationNode(frozen) && (!hasRawChatTracking(frozen) || rawChatStillExists(frozen))) {
                nextFrozen.push(frozen);
                if (firstBreakIndex === -1) currentValidLength += frozen.content.length;
                ledger.push({ time: processTime, ref: frozen, origIdx: '-', role: roleStr, attr: frozen._attr, gen: '繼承', creator: frozen._attr.creator, action: '原位凍結', func: '絕對凍結(歷史保留)', status: '已凍結' });
                if (Settings.logLevel >= LogLevels.EXTREME) {
                    Logger.write(`**[${processTime}]** 📋 [EXTREME] 歷史保留（本輪未出現）: ${frozen._attr.source}`, LogLevels.EXTREME);
                    Logger.write(`  🗃️ 保留內容: ${frozen.content}`, LogLevels.EXTREME);
                }
            } else if (matchIdx === -1) {
                if (firstBreakIndex === -1) { firstBreakIndex = currentValidLength; breakNodeName = frozen._attr.source; }
                syncMessages.push(`<span style="color:#ff4444;">[節點刪除]</span> ${frozen._attr.source}`);
                detailedMods.push(`[刪除] 偵測到歷史節點被移除或失效: ${frozen._attr.source}`);
                Diagnostics.recordModification({
                    type: isFrozenConversationNode(frozen) ? '手動刪除' : '節點消失',
                    source: isFrozenConversationNode(frozen) ? '聊天訊息刪除/移除' : (frozen._attr?.source || '未知來源'),
                    sourceDetail: getSourceDetail(frozen),
                    target: getPromptLocator(frozen),
                    before: frozen.content,
                    after: '',
                    outcome: '來源已不存在，從凍結序列移除',
                    confidence: hasRawChatTracking(frozen) ? 'high' : 'medium',
                });
                console.log(`[DS Cache] 🗑️ 刪除節點: ${frozen._attr.source} | 位置: ${i}/${state.frozenSequence.length} | 斷點字節: ${firstBreakIndex}`);
                // 📋 極限日誌：輸出被刪除的內容（完整顯示）
                if (Settings.logLevel >= LogLevels.EXTREME) {
                    Logger.write(`**[${processTime}]** 📋 [EXTREME] 節點刪除: ${frozen._attr.source}`, LogLevels.EXTREME);
                    Logger.write(`  🗑️ 刪除內容: ${frozen.content}`, LogLevels.EXTREME);
                }
                ledger.push({ time: processTime, ref: frozen, origIdx: '-', role: roleStr, attr: frozen._attr, gen: '消失', creator: frozen._attr.creator, action: '向上補位(刪除)', func: '量子糾纏(刪除感知)', status: '已刪除' });
            }
        }
        } // 🌟 結束 for 迴圈

        let cacheDrop = 0;
        if (firstBreakIndex !== -1) cacheDrop = ((totalFrozenLen - firstBreakIndex) / totalFrozenLen) * 100;

        // 🌟 寫入日誌面板供測試讀取
        if (cacheDrop > 0.01) {
            Logger.write(`**[${processTime}]** ⚠️ 緩存流失率：**${cacheDrop.toFixed(2)}%** | 斷點: ${breakNodeName || '未知'}`, LogLevels.BASIC);
        }

        if (syncMessages.length > 0) {
            console.log(`[DS Cache] 🔄 量子糾纏同步觸發: ${syncMessages.length} 項變更, 緩存流失: ${cacheDrop.toFixed(2)}%`);

            if (Settings.instantNotify && typeof toastr !== 'undefined') {
            let dropText = cacheDrop > 0 
                ? `<div style="margin-top:8px; padding:6px; background:rgba(255,68,68,0.1); border-left:3px solid #ff4444; border-radius:4px;">
                     預估緩存流失率：<b style="color:#ff4444; font-size:14px;">${cacheDrop.toFixed(2)}%</b><br>
                     <span style="font-size:11px; color:#ccc;">DeepSeek 採用嚴格的順序緩存，斷點 <b>[${breakNodeName || '未知'}]</b> 之後的所有提示詞都必須重新計算 Token。</span>
                   </div>` 
                : `<div style="margin-top:8px; padding:6px; background:rgba(0,229,255,0.1); border-left:3px solid #00e5ff; border-radius:4px;">
                     <span style="color:#00e5ff; font-size:12px;">修改發生在序列最末端，<b>緩存無損 (0% 流失)</b>，完美！</span>
                   </div>`;
            
            toastr.warning(
                `<div style="font-family:sans-serif;">
                    <b style="font-size:14px; color:#fff;"><i class="fa-solid fa-bolt"></i> 量子糾纏同步觸發</b>
                    <div style="margin:8px 0; font-size:12px; color:#ddd; line-height:1.4;">
                        系統偵測到您修改或刪除了歷史提示詞，已自動為您同步緩存序列：<br>
                        <div style="background:rgba(0,0,0,0.3); padding:6px; border-radius:4px; margin-top:4px;">
                            ${syncMessages.join('<br>')}
                        </div>
                    </div>
                    ${dropText}
                </div>`, 
                'DeepSeek 緩存優化器', {timeOut: 12000, escapeHtml: false}
            );
            }
        }

        let remainingPool = incomingPool.filter((_, idx) => !matchedIncomingIndices.has(idx));
        let newHistory = [], newDefault = [], newLorebook = [], newOther = [], allDynamic = [], currentUser = [], currentPrefill = [], aiLastReply = [];
        let chat1SystemPrompts = [];
        let summaryPrompts = [];

        remainingPool.forEach(msg => {
            if (msg._attr.type === 'USER_CURRENT') { 
                currentUser.push(msg); 
                detailedMods.push(`[新增] 用戶發送了第 ${chatTurn} 輪的新訊息`); 
            }
            else if (msg._attr.type === 'PREFILL') { 
                currentPrefill.push(msg); 
                detailedMods.push(`[新增] 觸發了預填充 (Prefill)`); 
            }
            else if (msg._attr.type === 'AI_LAST_REPLY') {
                aiLastReply.push(msg);
                detailedMods.push(`[新增] 載入了AI回覆: ${msg._attr.source}`);
            }
            else if (msg._attr.type === 'USER_HISTORY' || msg._attr.type === 'AI_HISTORY') {
                newHistory.push(msg);
                detailedMods.push(`[新增] 載入了歷史訊息: ${msg._attr.source}`);
            }
            else if (msg._attr.type === 'SUMMARY') {
                if (isChat1) {
                    summaryPrompts.push(msg);
                    detailedMods.push(`[新增] 抽取了系統摘要: ${msg._attr.source}`);
                } else {
                    allDynamic.push(msg);
                    detailedMods.push(`[新增] 載入了系統摘要(動態追加): ${msg._attr.source}`);
                }
            }
            else {
                if (isChat1) {
                    chat1SystemPrompts.push(msg);
                    if (msg._isDynamic) detailedMods.push(`[新增] 載入了動態提示詞: ${msg._attr.source}`);
                    else if (msg._attr.type === 'DEFAULT') {
                        const pn = msg._attr.promptName ? ` (真實名稱: ${msg._attr.promptName})` : '';
                        detailedMods.push(`[新增] 載入了預設提示詞: ${msg._attr.source}${pn}`);
                    }
                    else if (msg._attr.type === 'LOREBOOK') {
                        const bnLb1 = msg._attr.bookName || '未知世界書';
                        const enLb1 = msg._attr.entryName || '未知條目';
                        detailedMods.push(`[新增] 觸發了世界書條目 → 📚 ${bnLb1} → 📑 ${enLb1}`);
                    }
                    else detailedMods.push(`[新增] 插件注入了新節點: ${msg._attr.source}`);
                } else {
                    if (msg._isDynamic) {
                        allDynamic.push(msg);
                        detailedMods.push(`[新增] 載入了動態提示詞: ${msg._attr.source}`);
                    } else if (msg._attr.type === 'DEFAULT') {
                        newDefault.push(msg);
                        const pn = msg._attr.promptName ? ` (真實名稱: ${msg._attr.promptName})` : '';
                        detailedMods.push(`[新增] 載入了預設提示詞: ${msg._attr.source}${pn}`);
                    }
                    else if (msg._attr.type === 'LOREBOOK') {
                        newLorebook.push(msg);
                        const bnLb = msg._attr.bookName || '未知世界書';
                        const enLb = msg._attr.entryName || '未知條目';
                        detailedMods.push(`[新增] 觸發了世界書條目 → 📚 "${bnLb}" → 📑 "${enLb}"`);
                    }
                    else {
                        newOther.push(msg);
                        detailedMods.push(`[新增] 插件注入了新節點: ${msg._attr.source}`);
                    }
                }
            }
        });

        if (queuedHistoryAdditions.length > 0) newHistory.push(...queuedHistoryAdditions);
        if (queuedAiLastReplyAdditions.length > 0) aiLastReply.push(...queuedAiLastReplyAdditions);
        if (queuedCurrentUserAdditions.length > 0) currentUser.push(...queuedCurrentUserAdditions);
        if (queuedPrefillAdditions.length > 0) currentPrefill.push(...queuedPrefillAdditions);
        if (queuedDefaultAdditions.length > 0) newDefault.push(...queuedDefaultAdditions);
        if (queuedLorebookAdditions.length > 0) newLorebook.push(...queuedLorebookAdditions);
        if (queuedOtherAdditions.length > 0) newOther.push(...queuedOtherAdditions);
        if (queuedDynamicAdditions.length > 0) allDynamic.push(...queuedDynamicAdditions);

        // 🌟 將量子切片提取下來的尾巴，加進動態池裡排隊
        if (extractedAppends.length > 0) {
            allDynamic.push(...extractedAppends);
        }
        newDefault.sort(byOriginalOrder);
        newLorebook.sort(byOriginalOrder);
        newOther.sort(byOriginalOrder);
        allDynamic.sort(byOriginalOrder);

        const appendToFrozen = (arr, gen, actionName, funcName) => {
            arr.forEach(msg => {
                if (!msg._diagAction) msg._diagAction = actionName;
                nextFrozen.push(msg);
                const roleStr = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
                ledger.push({ time: processTime, ref: msg, origIdx: msg._origIdx, role: roleStr, attr: msg._attr, gen: gen, creator: msg._attr.creator, action: actionName, func: funcName, status: '已凍結' });
            });
        };

        if (isChat1) {
            appendToFrozen(chat1SystemPrompts, '新增', '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(summaryPrompts, '新增', '即時凍結', '絕對凍結(對話1)'); 
            appendToFrozen(newHistory, '新增', '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(aiLastReply, '新增', '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(currentUser, '新增', '即時凍結', '絕對凍結(對話1)');
            appendToFrozen(currentPrefill, '新增', '即時凍結', '絕對凍結(對話1)');
        } else {
            appendToFrozen(newHistory, '新增', '追加凍結', '絕對凍結(對話2+)');
            appendToFrozen(aiLastReply, '新增', '追加凍結', '絕對凍結(對話2+)');
            appendToFrozen(newDefault, '新增', '追加凍結', '絕對凍結(對話2+)');
            appendToFrozen(newLorebook, '新增', '追加凍結', '絕對凍結(對話2+)');
            appendToFrozen(newOther, '新增', '追加凍結', '絕對凍結(對話2+)');
            appendToFrozen(allDynamic, '新增', '動態分離(底置)', '絕對凍結(對話2+)'); // 尾巴會在這裡被追加
            appendToFrozen(currentUser, '新增', '即時凍結', '絕對凍結(對話2+)');
            appendToFrozen(currentPrefill, '新增', '即時凍結', '絕對凍結(對話2+)');
        }

        state.frozenSequence = nextFrozen;
        state.updatedAt = Date.now();
        safeSave();
        Diagnostics.recordPromptSnapshot(state.frozenSequence, chatTurn);

        data.chat.length = 0;
        data.chat.push(...nextFrozen.map(m => {
            let clean = { role: m.role, content: m.content };
            if (m.name) clean.name = m.name;
            return clean;
        }));

        printLog(false);

    } catch (err) {
        console.error('[DS Cache] 攔截器發生錯誤:', err);
        Logger.write(`❌ 攔截器發生錯誤: ${err.message}`, LogLevels.BASIC);
    }
}

// ==========================================
// 🌟 UI 渲染與設置 (GPU 加速 & 事件代理)
// ==========================================
function addMenuEntry() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('ds-cache-reset-menu-item')) return;
    
    const item = document.createElement('div');
    item.id = 'ds-cache-reset-menu-item';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.setAttribute('role', 'listitem');
    item.title = '重置當前聊天凍結池 (DeepSeek 緩存優化器)';
    item.innerHTML = `<div class="fa-fw fa-solid fa-bolt extensionsMenuExtensionButton" style="color: #00e5ff; text-shadow: 0 0 5px rgba(0,229,255,0.5);"></div><span style="font-weight:bold; color:#e0e0e0;">重置 DS 緩存池</span>`;
    
    item.addEventListener('click', () => {
        const menuEl = document.getElementById('extensionsMenu');
        if (menuEl) menuEl.style.display = 'none';
        resetCurrentChatCache();
    });
    
    menu.appendChild(item);
}

function renderChatsUI() {
    const container = $('#ds-ui-chat-list-container');
    if (container.length === 0) return;
    
    const keys = Object.keys(Settings.chats);
    if (keys.length === 0) {
        container.html(`<div style="padding: 20px; text-align: center; color: #666; font-size: 13px; font-style: italic;">尚無接管的存檔數據，開始聊天以建立緩存池。</div>`);
        return;
    }

    const groupedChats = {};
    keys.forEach(k => {
        const chat = Settings.chats[k];
        if (!groupedChats[chat.character]) groupedChats[chat.character] = [];
        groupedChats[chat.character].push({ key: k, ...chat });
    });

    const currentChatKey = getChatKey().key;
    let html = '';

    for (const [charName, chats] of Object.entries(groupedChats)) {
        const hasCurrent = chats.some(c => c.key === currentChatKey);
        
        html += `
        <div class="ds-ui-char-folder">
            <div class="ds-ui-char-header ${hasCurrent ? 'active' : ''}">
                <div class="ds-ui-char-title">
                    <i class="fa-solid fa-folder${hasCurrent ? '-open' : ''}" style="color: ${hasCurrent ? '#00e5ff' : '#888'};"></i>
                    <span>${charName}</span>
                    <span class="ds-ui-badge">${chats.length}</span>
                </div>
                <button class="ds-ui-icon-btn ds-ui-delete-char-btn" data-char="${charName}" title="清除此角色的所有緩存池"><i class="fa-solid fa-trash-can"></i></button>
            </div>
            <div class="ds-ui-char-content" style="display: ${hasCurrent ? 'block' : 'none'};">`;
        
        chats.forEach(c => {
            const isCurrent = c.key === currentChatKey;
            const chatName = c.label.replace('.jsonl', '');
            html += `
                <div class="ds-ui-chat-item ${isCurrent ? 'ds-ui-chat-current' : ''}">
                    <div class="ds-ui-chat-info">
                        <span class="ds-ui-chat-name">${isCurrent ? '<i class="fa-solid fa-location-dot" style="color:#00e5ff; margin-right:6px; text-shadow: 0 0 5px rgba(0,229,255,0.5);"></i>' : '<i class="fa-regular fa-file-lines" style="color:#555; margin-right:6px;"></i>'}${chatName}</span>
                        <span class="ds-ui-chat-nodes">已凍結 ${c.frozenSequence.length} 個節點</span>
                    </div>
                    <button class="ds-ui-icon-btn ds-ui-delete-chat-btn" data-key="${c.key}" title="清除此聊天的緩存池"><i class="fa-solid fa-xmark"></i></button>
                </div>`;
        });
        html += `</div></div>`;
    }
    
    container.html(html);
}

function createToggle(id, title, desc, checked) {
    return `
    <div class="ds-ui-setting-row">
        <div class="ds-ui-setting-text">
            <div class="ds-ui-setting-title">${title}</div>
            <div class="ds-ui-setting-desc">${desc}</div>
        </div>
        <label class="ds-ui-switch">
            <input type="checkbox" id="ds-opt-${id}" ${checked ? 'checked' : ''}>
            <span class="ds-ui-slider"></span>
        </label>
    </div>`;
}

async function setupUI() {
    if (!$('#ds-ui-style').length) {
        $('head').append(`
            <style id="ds-ui-style">
                :root { --ds-cyan: #00e5ff; --ds-cyan-dim: rgba(0, 229, 255, 0.15); --ds-bg: rgba(15, 15, 20, 0.6); --ds-border: rgba(255, 255, 255, 0.08); }
                .ds-ui-panel { background: var(--ds-bg); backdrop-filter: blur(10px); border: 1px solid var(--ds-border); border-radius: 8px; padding: 12px; margin-bottom: 15px; transform: translateZ(0); }
                .ds-ui-header { font-size: 14px; font-weight: bold; color: #e0e0e0; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
                .ds-ui-header i { transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); will-change: transform; }
                .ds-ui-header.collapsed i { transform: rotate(-90deg); }
                .ds-ui-content { overflow: hidden; will-change: height, opacity; transform: translateZ(0); }
                
                .ds-ui-setting-row { display: flex; justify-content: space-between; align-items: center; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 6px; margin-bottom: 8px; border: 1px solid transparent; transition: background-color 0.2s, border-color 0.2s; }
                .ds-ui-setting-row:hover { border-color: var(--ds-cyan-dim); background: rgba(0,0,0,0.4); }
                .ds-ui-setting-text { flex: 1; padding-right: 15px; }
                .ds-ui-setting-title { font-size: 14px; font-weight: bold; color: var(--ds-cyan); margin-bottom: 4px; }
                .ds-ui-setting-desc { font-size: 11px; color: #999; line-height: 1.4; }
                .ds-ui-switch { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; }
                .ds-ui-switch input { opacity: 0; width: 0; height: 0; }
                .ds-ui-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #333; transition: background-color 0.3s; border-radius: 22px; border: 1px solid #555; transform: translateZ(0); }
                .ds-ui-slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 3px; bottom: 3px; background-color: #aaa; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s; border-radius: 50%; will-change: transform; }
                .ds-ui-switch input:checked + .ds-ui-slider { background-color: rgba(0, 229, 255, 0.2); border-color: var(--ds-cyan); }
                .ds-ui-switch input:checked + .ds-ui-slider:before { transform: translate3d(18px, 0, 0); background-color: var(--ds-cyan); box-shadow: 0 0 8px var(--ds-cyan); }

                .ds-ui-char-folder { margin-bottom: 8px; background: rgba(0,0,0,0.3); border-radius: 6px; border: 1px solid var(--ds-border); overflow: hidden; transform: translateZ(0); }
                .ds-ui-char-header { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(255,255,255,0.02); cursor: pointer; transition: background-color 0.2s; }
                .ds-ui-char-header:hover { background: rgba(255,255,255,0.05); }
                .ds-ui-char-header.active { border-bottom: 1px solid var(--ds-border); }
                .ds-ui-char-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: bold; color: #ddd; }
                .ds-ui-badge { background: #333; color: #aaa; font-size: 10px; padding: 2px 6px; border-radius: 10px; }
                .ds-ui-chat-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px 8px 30px; border-bottom: 1px solid rgba(255,255,255,0.02); transition: background-color 0.2s; }
                .ds-ui-chat-item:last-child { border-bottom: none; }
                .ds-ui-chat-item:hover { background: rgba(0, 229, 255, 0.05); }
                .ds-ui-chat-current { background: rgba(0, 229, 255, 0.08); border-left: 3px solid var(--ds-cyan); padding-left: 27px; }
                .ds-ui-chat-info { display: flex; flex-direction: column; gap: 2px; }
                .ds-ui-chat-name { font-size: 12px; color: #ccc; }
                .ds-ui-chat-current .ds-ui-chat-name { color: #fff; font-weight: bold; }
                .ds-ui-chat-nodes { font-size: 10px; color: #777; }
                
                .ds-ui-icon-btn { background: transparent; border: none; color: #777; cursor: pointer; font-size: 13px; padding: 4px 6px; border-radius: 4px; transition: color 0.2s, background-color 0.2s; }
                .ds-ui-icon-btn:hover { color: var(--ds-cyan); background: var(--ds-cyan-dim); }
                .ds-ui-delete-char-btn:hover, .ds-ui-delete-chat-btn:hover { color: #ff4444; background: rgba(255, 68, 68, 0.15); }
                .ds-ui-btn-danger { background: rgba(255, 68, 68, 0.1); color: #ff4444; border: 1px solid rgba(255, 68, 68, 0.3); padding: 4px 10px; border-radius: 4px; font-size: 12px; cursor: pointer; transition: background-color 0.2s, box-shadow 0.2s; }
                .ds-ui-btn-danger:hover { background: rgba(255, 68, 68, 0.2); box-shadow: 0 0 8px rgba(255, 68, 68, 0.4); }
                
                .ds-ui-log-viewer { width: 100%; height: 350px; background: #080808; color: #ccc; font-family: 'Consolas', monospace; font-size: 11px; overflow-y: auto; border-radius: 6px; padding: 10px; border: 1px inset rgba(255,255,255,0.05); transform: translateZ(0); will-change: scroll-position; }
                .ds-ui-log-entry { margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px dashed rgba(255,255,255,0.1); }
                .ds-ui-log-table { width: 100%; border-collapse: collapse; margin-top: 5px; }
                .ds-ui-log-table th { background: #1a1a1a; color: var(--ds-cyan); padding: 6px; text-align: left; border-bottom: 1px solid var(--ds-cyan); position: sticky; top: 0; }
                .ds-ui-log-table td { padding: 6px; border-bottom: 1px solid rgba(255,255,255,0.05); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .ds-ui-log-table tr:hover td { background: rgba(0, 229, 255, 0.05); color: #fff; }
                .ds-diag-cache-grid { display: grid; grid-template-columns: minmax(110px, 160px) minmax(0, 1fr); gap: 10px; margin-bottom: 10px; }
                .ds-diag-cache-card { background: rgba(0,0,0,0.26); border: 1px solid rgba(0,229,255,0.18); border-radius: 6px; padding: 10px; min-width: 0; }
                .ds-diag-cache-label { font-size: 11px; color: #8aa; margin-bottom: 5px; }
                .ds-diag-cache-rate { font-size: 24px; line-height: 1.1; color: var(--ds-cyan); font-weight: 700; font-family: Consolas, monospace; }
                .ds-diag-cache-meta { font-size: 11px; color: #aaa; line-height: 1.45; overflow-wrap: anywhere; }
                .ds-diag-table-title { display: flex; align-items: center; gap: 6px; margin: 12px 0 6px; font-size: 12px; color: #ddd; font-weight: 700; }
                .ds-diag-table-wrap { max-height: 240px; overflow: auto; border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; background: #080808; }
                .ds-diag-table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
                .ds-diag-table th { position: sticky; top: 0; z-index: 1; background: #151515; color: var(--ds-cyan); padding: 6px; text-align: left; border-bottom: 1px solid rgba(0,229,255,0.35); }
                .ds-diag-table td { padding: 6px; border-bottom: 1px solid rgba(255,255,255,0.05); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .ds-diag-table tr:hover td { background: rgba(0,229,255,0.06); color: #fff; }
                .ds-diag-pill { display: inline-block; max-width: 100%; padding: 1px 6px; border-radius: 999px; font-size: 10px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
                .ds-diag-pill.manual { background: rgba(0,229,255,0.16); color: #64f1ff; }
                .ds-diag-pill.ai { background: rgba(150,190,255,0.16); color: #b7d0ff; }
                .ds-diag-pill.auto, .ds-diag-pill.dynamic { background: rgba(255,190,80,0.16); color: #ffd18c; }
                .ds-diag-pill.world { background: rgba(90,220,140,0.16); color: #9ff0bd; }
                .ds-diag-pill.plugin { background: rgba(210,160,255,0.16); color: #ddb8ff; }
                .ds-diag-pill.system { background: rgba(210,210,210,0.14); color: #ddd; }
                .ds-diag-empty { color: #777; font-style: italic; text-align: center; padding: 16px !important; white-space: normal !important; }
                
                .ds-ui-log-viewer::-webkit-scrollbar, #ds-ui-chat-list-container::-webkit-scrollbar, .ds-diag-table-wrap::-webkit-scrollbar { width: 6px; height: 6px; }
                .ds-ui-log-viewer::-webkit-scrollbar-track, #ds-ui-chat-list-container::-webkit-scrollbar-track, .ds-diag-table-wrap::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
                .ds-ui-log-viewer::-webkit-scrollbar-thumb, #ds-ui-chat-list-container::-webkit-scrollbar-thumb, .ds-diag-table-wrap::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
                .ds-ui-log-viewer::-webkit-scrollbar-thumb:hover, #ds-ui-chat-list-container::-webkit-scrollbar-thumb:hover, .ds-diag-table-wrap::-webkit-scrollbar-thumb:hover { background: var(--ds-cyan); }
            </style>
        `);
    }

    const html = `
    <div class="inline-drawer" id="ds-v36-opt-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b><i class="fa-solid fa-shield-halved" style="color:#00e5ff; margin-right:5px;"></i> DeepSeek V4 Pro 絕對防禦矩陣</b>
            <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="padding:15px 10px; background: #0d0d11;">
            
            <div class="ds-ui-panel">
                <div class="ds-ui-header collapsed" onclick="$(this).toggleClass('collapsed').next().slideToggle(200)">
                    <i class="fa-solid fa-chevron-down"></i> ⚙️ 核心防禦設定
                </div>
                <div class="ds-ui-content" style="display: none; padding-top: 10px;">
                    ${createToggle('enabled', '🛡️ 啟用絕對不可變序列 (總開關)', '嚴格遵守「只追加不移位」的絕對規則，鎖定所有提示詞位置，實現接近 100% 的緩存命中率。關閉後將恢復 ST 原生發送邏輯。', Settings.enabled)}
                    ${createToggle('instantNotify', '🔔 啟用量子糾纏即時提醒', '全自動感知用戶修改或刪除歷史訊息，並即時彈窗提醒該操作對緩存命中率的影響，幫助您理解緩存斷裂點。', Settings.instantNotify)}
                    
                    <div class="ds-ui-setting-row" style="margin-top: 10px;">
                        <div class="ds-ui-setting-text">
                            <div class="ds-ui-setting-title">📝 日誌輸出等級</div>
                            <div class="ds-ui-setting-desc">決定下方日誌面板記錄的詳細程度。建議日常使用設為「標準摘要」。</div>
                        </div>
                        <select id="ds-opt-logLevel" class="text_pole" style="width: 140px; padding: 4px; background: #111; color: #00e5ff; border: 1px solid #333; border-radius: 4px;">
                            <option value="0" ${Settings.logLevel===0?'selected':''}>0: 關閉</option>
                            <option value="1" ${Settings.logLevel===1?'selected':''}>1: 基礎警告</option>
                            <option value="2" ${Settings.logLevel===2?'selected':''}>2: 標準摘要</option>
                            <option value="3" ${Settings.logLevel===3?'selected':''}>3: 全景表格</option>
                            <option value="4" ${Settings.logLevel===4?'selected':''}>4: 極限除錯</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="ds-ui-panel" id="ds-diagnostics-panel">
                <div class="ds-ui-header collapsed" onclick="$(this).toggleClass('collapsed').next().slideToggle(200)">
                    <i class="fa-solid fa-chevron-down"></i> 📡 修改來源定位與 API 緩存率
                </div>
                <div class="ds-ui-content" style="display: none; padding-top: 10px;">
                    <div class="ds-diag-cache-grid">
                        <div class="ds-diag-cache-card">
                            <div class="ds-diag-cache-label">DeepSeek API Cache Rate</div>
                            <div id="ds-api-cache-rate" class="ds-diag-cache-rate">--</div>
                        </div>
                        <div class="ds-diag-cache-card">
                            <div class="ds-diag-cache-label">最近一次 API usage/cache 欄位</div>
                            <div id="ds-api-cache-meta" class="ds-diag-cache-meta">等待下一次 DeepSeek API 回應</div>
                        </div>
                    </div>

                    <div class="ds-diag-table-title"><i class="fa-solid fa-route"></i> 修改來源追蹤</div>
                    <div class="ds-diag-table-wrap">
                        <table class="ds-diag-table">
                            <thead>
                                <tr>
                                    <th style="width:58px;">時間</th>
                                    <th style="width:92px;">類型</th>
                                    <th style="width:190px;">來源</th>
                                    <th style="width:210px;">定位</th>
                                    <th>修改前</th>
                                    <th>修改後</th>
                                    <th style="width:180px;">處理結果</th>
                                </tr>
                            </thead>
                            <tbody id="ds-mod-source-body"></tbody>
                        </table>
                    </div>

                    <div class="ds-diag-table-title"><i class="fa-solid fa-map-location-dot"></i> 本輪提示詞來源定位</div>
                    <div class="ds-diag-table-wrap">
                        <table class="ds-diag-table">
                            <thead>
                                <tr>
                                    <th style="width:46px;">#</th>
                                    <th style="width:70px;">輪次</th>
                                    <th style="width:92px;">類型</th>
                                    <th style="width:170px;">來源</th>
                                    <th>可定位位置</th>
                                    <th style="width:120px;">凍結策略</th>
                                    <th style="width:180px;">內容摘要</th>
                                </tr>
                            </thead>
                            <tbody id="ds-prompt-source-body"></tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="ds-ui-panel">
                <div class="ds-ui-header collapsed" onclick="$(this).toggleClass('collapsed').next().slideToggle(200)">
                    <i class="fa-solid fa-chevron-down"></i> 📂 存檔與緩存管理
                </div>
                <div class="ds-ui-content" style="display: none; padding-top: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <span style="font-size: 11px; color: #888;">管理各個角色與聊天的獨立緩存池</span>
                        <button id="ds-cache-factory-reset" class="ds-ui-btn-danger"><i class="fa-solid fa-skull"></i> 摧毀所有存檔</button>
                    </div>
                    <div id="ds-ui-chat-list-container" style="max-height: 280px; overflow-y: auto; padding-right: 4px; transform: translateZ(0);"></div>
                </div>
            </div>
            
            <div class="ds-ui-panel" style="margin-bottom: 0;">
                <div class="ds-ui-header collapsed" onclick="$(this).toggleClass('collapsed').next().slideToggle(200)">
                    <i class="fa-solid fa-chevron-down"></i> 📝 深度日誌系統
                </div>
                <div class="ds-ui-content" style="display: none; padding-top: 10px;">
                    <div style="display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 8px;">
                        <button id="ds-log-copy" class="ds-ui-icon-btn" title="複製日誌"><i class="fa-solid fa-copy"></i> 複製</button>
                        <button id="ds-log-export" class="ds-ui-icon-btn" title="導出 .md"><i class="fa-solid fa-download"></i> 導出</button>
                        <button id="ds-log-clear" class="ds-ui-icon-btn" title="清空日誌"><i class="fa-solid fa-trash"></i> 清空</button>
                    </div>
                    <div id="ds-cache-log-viewer" class="ds-ui-log-viewer"></div>
                </div>
            </div>

        </div>
    </div>`;
    
    $('#extensions_settings').append(html);
    Logger._uiViewer = document.getElementById('ds-cache-log-viewer');
    Diagnostics.init();

    $('#ds-opt-enabled').on('change', function() { Settings.enabled = $(this).is(':checked'); safeSave(); });
    $('#ds-opt-instantNotify').on('change', function() { Settings.instantNotify = $(this).is(':checked'); safeSave(); });
    $('#ds-opt-logLevel').on('change', function () { Settings.logLevel = parseInt($(this).val()); safeSave(); });
    
    $('#ds-cache-factory-reset').on('click', () => { 
        if (confirm("⚠️ 終極警告：\n這將徹底摧毀所有角色卡、所有存檔的 DeepSeek 快取連續性！\n(不會刪除聊天記錄，但下次對話將全部重新計算 Token)\n\n確定要執行核彈級清除嗎？")) { 
            Settings.chats = {}; safeSave(); renderChatsUI(); 
            if (typeof toastr !== 'undefined') toastr.success("已摧毀所有緩存存檔", "DeepSeek 緩存優化器");
        } 
    });

    $('#ds-log-copy').on('click', Logger.copy);
    $('#ds-log-export').on('click', Logger.export);
    $('#ds-log-clear').on('click', Logger.clear);
    
    const $chatContainer = $('#ds-ui-chat-list-container');
    
    $chatContainer.on('click', '.ds-ui-char-title', function() {
        const content = $(this).parent().next('.ds-ui-char-content');
        const icon = $(this).find('i.fa-solid');
        content.slideToggle(200);
        if (icon.hasClass('fa-folder')) {
            icon.removeClass('fa-folder').addClass('fa-folder-open');
        } else {
            icon.removeClass('fa-folder-open').addClass('fa-folder');
        }
    });

    $chatContainer.on('click', '.ds-ui-delete-chat-btn', function(e) {
        e.stopPropagation();
        const key = $(this).data('key');
        if (confirm('確定要清除此聊天的凍結池嗎？\n(這不會刪除您的聊天記錄，僅重置 DeepSeek 緩存排序)')) {
            delete Settings.chats[key];
            safeSave(); renderChatsUI();
            if (typeof toastr !== 'undefined') toastr.success("已清除該聊天的凍結池", "DeepSeek 緩存優化器");
        }
    });

    $chatContainer.on('click', '.ds-ui-delete-char-btn', function(e) {
        e.stopPropagation();
        const charName = $(this).data('char');
        if (confirm(`確定要清除角色「${charName}」的所有緩存池嗎？\n(這不會刪除任何聊天記錄)`)) {
            Object.keys(Settings.chats).forEach(k => {
                if (Settings.chats[k].character === charName) delete Settings.chats[k];
            });
            safeSave(); renderChatsUI();
            if (typeof toastr !== 'undefined') toastr.success(`已清除 ${charName} 的所有凍結池`, "DeepSeek 緩存優化器");
        }
    });

    renderChatsUI();
}

jQuery(async () => {
    try {
        initSettings();
        await setupUI();
        installApiUsageInterceptor();
        addMenuEntry();

        CoreEngine.patchSTEngine();
        installApiUsageInterceptor();

        if (eventSource) {
            if (event_types?.CHAT_CHANGED) {
                eventSource.on(event_types.CHAT_CHANGED, () => {
                    CoreEngine.activeWorldInfoEntries.clear();
                    CoreEngine.lastRegistryBuildTime = 0;
                    renderChatsUI();
                });
            }
            if (event_types?.CHAT_COMPLETION_PROMPT_READY) {
                eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
            }
            // 追蹤世界書活化條目 (WORLD_INFO_ACTIVATED 事件會在每次掃描後觸發)
            if (event_types?.WORLD_INFO_ACTIVATED) {
                eventSource.on(event_types.WORLD_INFO_ACTIVATED, (activatedEntries) => {
                    CoreEngine.activeWorldInfoEntries.clear();
                    if (Array.isArray(activatedEntries)) {
                        for (const entry of activatedEntries) {
                            const key = `${entry.world || '?'}.${entry.uid || '?'}`;
                            CoreEngine.activeWorldInfoEntries.set(key, entry);
                        }
                    }
                    // 世界書狀態變更後重建註冊表
                    CoreEngine.lastRegistryBuildTime = 0;
                });
            }
        }

        Logger.write('══════ 🛡️ DeepSeek V4 Pro 緩存優化器 v2.0 (ST-API 精準溯源) 就緒 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件啟動崩潰:', e);
    }
});
