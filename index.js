import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, substituteParams } from '../../../../script.js';

// ========== 日志 ==========
let logLevel = 2;
const Logger = {
    _uiTextarea: null,
    log: (msg, level = 2) => { if (logLevel >= level) append('log', msg); },
    warn: (msg, level = 1) => { if (logLevel >= level) append('warn', msg); },
    error: (msg, err, level = 1) => { if (logLevel >= level) append('error', err ? msg + ' ' + err : msg); },
    _appendLine(type, text) {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const prefix = type === 'warn' ? '🌪️' : (type === 'error' ? '🔴' : '✅');
        const line = `[${time}] ${prefix} ${text}`;
        if (Logger._uiTextarea) {
            Logger._uiTextarea.value += line + '\n';
            Logger._uiTextarea.scrollTop = Logger._uiTextarea.scrollHeight;
        }
        if (type === 'error') console.error('[DS V4 Opt v7.0]', text);
        else if (type === 'warn') console.warn('[DS V4 Opt v7.0]', text);
        else console.log('%c[DS V4 Opt v7.0]', 'color:#00ff00;font-weight:bold', text);
    }
};
function append(type, msg) { Logger._appendLine(type, msg); }

// ========== 工具函数 ==========
const utils = {
    hash: (str) => { let h = 0; for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; } return (h >>> 0).toString(16).padStart(8, '0'); },
    estimateTokens: (text) => { if (!text) return 0; let t = 0; for (const ch of text) { const code = ch.charCodeAt(0); t += ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3040 && code <= 0x30FF) || (code >= 0xAC00 && code <= 0xD7AF)) ? 1 : 0.25; } return Math.ceil(t); },
    normalize: (text) => text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
        .replace(/[，。！？、；：]/g, m => ({'，':',','。':'.','！':'!','？':'?','、':',','；':';','：':':'})[m] || m).trim()
};

const CacheState = { enabled: true, lockedPresets: [], lockedWorlds: [], lockedHistory: [], fpPresets: null, fpWorlds: null, fpHistory: null, stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 } };
const WORLD_INFO_IDS = ['worldInfoBefore', 'worldInfoAfter'];
const PRESET_ID_BLACKLIST = ['main', 'nsfw', 'jailbreak', 'enhanceDefinitions', ...WORLD_INFO_IDS];

function getPromptManagerItems() {
    const pm = window['promptManager'];
    if (!pm || !pm.serviceSettings) return [];
    return pm.serviceSettings.prompts.filter(p => p.is_enabled !== false);
}

function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;
    try {
        CacheState.stats.total++;
        Logger.log(`====== [请求 #${CacheState.stats.total}] ======`, 2);
        const original = data.chat;
        if (!original?.length) return;

        const prefills = [];
        let idx = original.length - 1;
        while (idx >= 0 && original[idx].role === 'assistant') prefills.unshift(original.splice(idx--, 1)[0]);

        // 当前用户输入是最后一条 user 消息
        let currentUser = null;
        for (let i = original.length - 1; i >= 0; i--) {
            if (original[i].role === 'user') { currentUser = original.splice(i, 1)[0]; break; }
        }
        if (!currentUser) return Logger.warn('未找到当前用户输入', 1);

        const prompts = getPromptManagerItems();
        const worldSet = new Set(prompts.filter(p => WORLD_INFO_IDS.includes(p.identifier)).map(p => utils.normalize(p.content)));
        const presetSet = new Set(prompts.filter(p => !WORLD_INFO_IDS.includes(p.identifier)).map(p => utils.normalize(p.content)));

        const currentPresets = [], currentWorlds = [];
        for (const msg of original) {
            if (msg.role === 'system') {
                const n = utils.normalize(msg.content);
                if (worldSet.has(n)) currentWorlds.push(msg);
                else if (presetSet.has(n)) currentPresets.push(msg);
                else {
                    // 兜底判断：如果内容中包含世界书关键词，则归为世界书
                    const hasWorldKeyword = worldSet.size > 0 && [...worldSet].some(w => msg.content.includes(w));
                    if (hasWorldKeyword) currentWorlds.push(msg);
                    else currentPresets.push(msg);
                }
            }
        }

        // 构建历史对话
        const fullHistory = getContext().chat.filter(m => !m.is_system).map(m => ({ role: m.is_user ? 'user' : 'assistant', content: m.mes }));
        const inputIdx = fullHistory.findIndex(m => m.role === 'user' && utils.normalize(m.content) === utils.normalize(currentUser.content));
        if (inputIdx === -1) return Logger.error('无法定位当前输入', null, 1);
        const prevHistory = fullHistory.slice(0, inputIdx);

        // 指纹计算
        const fpP = currentPresets.map(m => utils.hash(utils.normalize(m.content))).join('|');
        const fpW = currentWorlds.map(m => utils.hash(utils.normalize(m.content))).join('|');
        const fpH = prevHistory.map(m => utils.hash(utils.normalize(m.content))).join('|');

        // 初始化
        if (!CacheState.fpPresets) {
            Object.assign(CacheState, { lockedPresets: currentPresets, lockedWorlds: currentWorlds, lockedHistory: prevHistory, fpPresets: fpP, fpWorlds: fpW, fpHistory: fpH });
            Logger.log(`[初始化] 锁定预设:${currentPresets.length}条, 世界书:${currentWorlds.length}条, 历史:${prevHistory.length}条`, 2);
            const final = [...CacheState.lockedPresets, ...CacheState.lockedWorlds, ...CacheState.lockedHistory, currentUser, ...prefills];
            data.chat.splice(0, data.chat.length, ...final);
            updateStats(); return;
        }

        // 变化检测
        const isPAppend = fpP !== CacheState.fpPresets && fpP.startsWith(CacheState.fpPresets);
        const isWAppend = fpW !== CacheState.fpWorlds && fpW.startsWith(CacheState.fpWorlds);
        const isHAppend = fpH !== CacheState.fpHistory && fpH.startsWith(CacheState.fpHistory);

        if ((fpP !== CacheState.fpPresets && !isPAppend) || (fpW !== CacheState.fpWorlds && !isWAppend) || (fpH !== CacheState.fpHistory && !isHAppend)) {
            Logger.warn('[重置] 检测到修改或删除，自动重置', 1);
            Object.keys(CacheState).forEach(k => { if (k.startsWith('fp') || k.startsWith('locked')) CacheState[k] = null; });
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            return interceptAndRestructurePrompt(data);
        }

        let appendedPresets = [], appendedWorlds = [];
        if (isPAppend) { appendedPresets = currentPresets.slice(CacheState.lockedPresets.length); CacheState.lockedPresets = currentPresets; CacheState.fpPresets = fpP; Logger.warn(`[追加] ${appendedPresets.length} 条新预设`, 2); }
        if (isWAppend) { appendedWorlds = currentWorlds.slice(CacheState.lockedWorlds.length); CacheState.lockedWorlds = currentWorlds; CacheState.fpWorlds = fpW; Logger.warn(`[追加] ${appendedWorlds.length} 条新世界书`, 2); }
        if (isHAppend) { CacheState.lockedHistory = prevHistory; CacheState.fpHistory = fpH; }

        const final = [...CacheState.lockedPresets, ...CacheState.lockedWorlds, ...CacheState.lockedHistory, ...appendedPresets, ...appendedWorlds, currentUser, ...prefills];
        data.chat.splice(0, data.chat.length, ...final);

        const prefixTokens = utils.estimateTokens(CacheState.lockedPresets.concat(CacheState.lockedWorlds, CacheState.lockedHistory).map(m => m.content).join(''));
        CacheState.stats.prefixTokens = prefixTokens;
        CacheState.stats.hits++;
        CacheState.stats.savedTokens += prefixTokens;
        Logger.log(`✅ 缓存命中！静态前缀 ${prefixTokens}tokens`, 2);
        updateStats();
    } catch (e) { Logger.error('致命错误', e); }
}

// ========== UI ==========
function updateStats() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    el.innerHTML = `命中: ${hits}/${total} (${total ? ((hits / total) * 100).toFixed(1) : '0.0'}%) | 前缀: ~${prefixTokens.toLocaleString()}t | 节省: ~${savedTokens.toLocaleString()}t`;
}

async function setupUI() {
    const html = `<div class="inline-drawer" id="ds-v4-opt-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>🧠 DS V4 缓存优化器 v7.0 (最终版)</b></div><div class="inline-drawer-content" style="padding:10px;"><p style="font-size:0.9em;opacity:0.8;">基于标识符的绝对分类：预设 → 世界书 → 历史。新增仅追加，实现极限缓存命中。</p><div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;"></div><label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" checked> 启用</label><div style="display:flex;align-items:center;gap:8px;margin:8px 0;"><span>日志等级:</span><select id="ds-cache-loglevel"><option value="0">关闭</option><option value="1">简要</option><option value="2" selected>详细</option><option value="3">调试</option></select></div><button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置</button><textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea></div></div>`;
    $('#extensions_settings').append(html);
    Logger._uiTextarea = document.getElementById('ds-cache-log');
    $('#ds-cache-enable').on('change', function() { CacheState.enabled = $(this).is(':checked'); });
    $('#ds-cache-loglevel').on('change', function() { logLevel = parseInt($(this).val()); });
    $('#ds-cache-reset').on('click', () => { Object.keys(CacheState).forEach(k => { if (k.startsWith('fp') || k.startsWith('locked')) CacheState[k] = null; }); updateStats(); Logger.warn('已重置', 1); });
    updateStats();
}

jQuery(async () => { await setupUI(); if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) { eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt); Logger.log('已挂载钩子', 2); } else Logger.error('无法挂载钩子'); Logger.log('══════ v7.0 就绪，标识符绝对分类 ══════', 2); });
