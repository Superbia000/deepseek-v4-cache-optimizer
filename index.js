import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志系统
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };
let logLevel = 2;
function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const fullMsg = `[${time}] ${msg}`;
    if (type === 'warn') console.warn(`%c[DS Cache v6.8] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    else if (type === 'error') console.error(`[DS Cache v6.8] 🔴 ${msg}`);
    else console.log(`%c[DS Cache v6.8] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
    simpleHash: (str) => { let hash = 0; for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; } return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8); },
    estimateTokens: (text) => { if (!text) return 0; let tokens = 0; for (const ch of text) { const code = ch.charCodeAt(0); if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3040 && code <= 0x30FF) || (code >= 0xAC00 && code <= 0xD7AF)) tokens += 1; else tokens += 0.25; } return Math.ceil(tokens); },
    normalize: (text) => text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
};

// ==========================================
// 状态机 v6.8
// ==========================================
const CacheState = {
    enabled: true,
    // 上次发送的完整序列（不含预填充），用于下次精准匹配前缀
    sentSequence: null,
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
    blocked: false,
};

// ==========================================
// 工具：从 stream 中提取预填充（尾部连续的 assistant，且非真实 AI 回复）
// ==========================================
function extractPrefills(stream, originalChat) {
    let prefillStart = stream.length;
    while (prefillStart > 0 && stream[prefillStart - 1].role === 'assistant') {
        prefillStart--;
    }
    // 检查候选预填充中是否有任何真实 AI 回复
    const hasRealReply = stream.slice(prefillStart).some(msg => {
        const orig = originalChat.find(m => m.mes === msg.content);
        return orig && !orig.is_system;
    });
    if (hasRealReply) return { prefills: [], nonPrefill: stream };
    return {
        prefills: stream.slice(prefillStart),
        nonPrefill: stream.slice(0, prefillStart),
    };
}

// ==========================================
// 对比 sentSequence 找出新增消息（返回新增数组，保持顺序）
// ==========================================
function findNewMessages(sentSequence, currentNonPrefill) {
    if (!sentSequence) return currentNonPrefill; // 没有历史，全部视为新
    let matchLen = 0;
    const minLen = Math.min(sentSequence.length, currentNonPrefill.length);
    for (let i = 0; i < minLen; i++) {
        if (sentSequence[i].role !== currentNonPrefill[i].role ||
            sentSequence[i].content !== currentNonPrefill[i].content) {
            break;
        }
        matchLen = i + 1;
    }
    Logger.log(`[前缀匹配] 匹配长度 ${matchLen}/${sentSequence.length}`, LogLevels.DEBUG);
    return currentNonPrefill.slice(matchLen);
}

// ==========================================
// 处理新增消息：分离背景（提示词）与对话（真实用户/AI），并去重背景
// ==========================================
function processNewMessages(newMessages, originalChat) {
    const bgList = [];
    const dialogueList = [];
    const seenBgNorm = new Set();

    for (const msg of newMessages) {
        const orig = originalChat.find(m => m.mes === msg.content);
        let isInstructional = true;
        if (orig) {
            if (orig.is_user) isInstructional = false; // 真实用户
            else if (!orig.is_system && msg.role === 'assistant') isInstructional = false; // 真实AI
        }
        const norm = Logger.normalize(msg.content);
        if (isInstructional) {
            if (!seenBgNorm.has(norm)) {
                seenBgNorm.add(norm);
                bgList.push(msg);
            } else {
                Logger.log(`[背景去重] 跳过: ${msg.content.substring(0, 40)}...`, LogLevels.DEBUG);
            }
        } else {
            dialogueList.push(msg);
        }
    }
    return { bgList, dialogueList };
}

// ==========================================
// 核心拦截器
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;
    if (CacheState.blocked) {
        Logger.warn('[阻塞中] 保持原始消息', LogLevels.BASIC);
        return;
    }

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`[请求 #${CacheState.stats.total}] 开始处理...`);

        if (!data?.chat?.length) return;
        const stream = data.chat;
        const context = getContext();
        const originalChat = context?.chat ?? [];

        // 1. 剥离预填充
        const { prefills, nonPrefill } = extractPrefills(stream, originalChat);
        // 2. 找出当前用户输入：nonPrefill 中最后一条在 originalChat 中匹配且 is_user 为 true 的消息
        let currentUserInput = null;
        const remaining = [];
        // 从后向前找最后一个真实用户消息
        for (let i = nonPrefill.length - 1; i >= 0; i--) {
            const msg = nonPrefill[i];
            const orig = originalChat.find(m => m.mes === msg.content);
            if (!currentUserInput && orig && orig.is_user && msg.role === 'user') {
                currentUserInput = msg;
                continue;
            }
            remaining.unshift(msg);
        }

        // 3. 基于 sentSequence 找出新增的 remaining 部分
        const newMessages = findNewMessages(CacheState.sentSequence, remaining);
        if (logLevel >= LogLevels.DEBUG) {
            Logger.log(`[新增消息] ${newMessages.length} 条`, LogLevels.DEBUG);
            newMessages.forEach((m, i) => Logger.log(`  ${i}: [${m.role}] ${m.content.substring(0, 50)}...`, LogLevels.DEBUG));
        }

        // 4. 处理新增消息（背景/对话分离）
        const { bgList, dialogueList } = processNewMessages(newMessages, originalChat);

        // 5. 构建新的完整前缀（sentSequence + 新增背景 + 新增对话，保持顺序）
        const oldPrefix = CacheState.sentSequence ? [...CacheState.sentSequence] : [];
        const newPrefix = oldPrefix.concat(bgList, dialogueList);

        // 6. 检测背景块重大变化（比较 newPrefix 中的背景与 oldPrefix 中的背景）
        if (CacheState.sentSequence) {
            const oldBgSet = new Set(oldPrefix.filter(m => m.role === 'system'));
            const newBgSet = new Set(newPrefix.filter(m => m.role === 'system'));
            const sim = computeSetSimilarity(oldBgSet, newBgSet);
            Logger.log(`[背景集相似度] ${(sim*100).toFixed(1)}%`, LogLevels.DEBUG);
            if (sim < 0.9) {
                triggerResetAlert('检测到系统提示词核心变动（更换角色卡/预设），建议重置缓存前缀以保证性能。');
                CacheState.sentSequence = null; // 清空以便下次重建
                return;
            }
        }

        // 7. 检测对话历史大幅删除（比较 newPrefix 中的对话数量与 oldPrefix 中的）
        if (CacheState.sentSequence) {
            const oldDialogueCount = oldPrefix.filter(m => m.role !== 'system' && !m.isPrefill).length;
            const newDialogueCount = newPrefix.filter(m => m.role !== 'system').length;
            if (newDialogueCount < oldDialogueCount * 0.7) {
                triggerResetAlert('对话历史被大幅删除，建议重置。');
                CacheState.sentSequence = null;
                return;
            }
        }

        // 8. 更新 sentSequence 为 newPrefix
        CacheState.sentSequence = newPrefix;

        // 9. 构建最终发送序列：前缀 + 当前用户输入 + 预填充
        const finalMessages = [...newPrefix];
        if (currentUserInput) finalMessages.push(currentUserInput);
        prefills.forEach(p => finalMessages.push(p));

        if (logLevel >= LogLevels.DEBUG) {
            Logger.log(`[最终序列] 前缀:${newPrefix.length} 用户:${currentUserInput?1:0} 预填充:${prefills.length}`, LogLevels.DEBUG);
            finalMessages.forEach((m, i) => Logger.log(`  ${i}: [${m.role}] ${m.content.substring(0, 50)}...`, LogLevels.DEBUG));
        }

        stream.splice(0, stream.length, ...finalMessages);
        updateStats();

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

function computeSetSimilarity(a, b) {
    if (a.size === 0 && b.size === 0) return 1;
    const union = new Set([...a, ...b]);
    let intersection = 0;
    for (const item of a) if (b.has(item)) intersection++;
    return union.size === 0 ? 1 : intersection / union.size;
}

function updateStats() {
    const prefixTokens = CacheState.sentSequence?.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0) ?? 0;
    CacheState.stats.prefixTokens = prefixTokens;
    CacheState.stats.hits++;
    CacheState.stats.savedTokens += prefixTokens;
    updateStatsUI();
}
function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `<span>命中: ${hits}/${total} (${rate}%)</span> <span style="margin-left:10px;">前缀: ~${prefixTokens.toLocaleString()}t</span> <span style="margin-left:10px;">节省: ~${savedTokens.toLocaleString()}t</span>`;
}

// ==========================================
// 弹窗与阻塞
// ==========================================
function triggerResetAlert(reason) {
    if (CacheState.blocked) return;
    CacheState.blocked = true;
    Logger.warn('[阻塞] 弹窗已弹出', LogLevels.BASIC);
    const onResolve = (reset) => {
        if (reset) {
            CacheState.sentSequence = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateStatsUI();
            Logger.warn('[重置] 已清空前缀', LogLevels.BASIC);
        } else {
            Logger.warn('[取消] 继续使用当前前缀', LogLevels.BASIC);
        }
        CacheState.blocked = false;
    };
    if (typeof callPopup === 'function') {
        callPopup(`<h4>缓存优化器</h4><p>${reason}</p>`, [
            { text: '重置', className: 'btn-danger', callback: () => onResolve(true) },
            { text: '取消', callback: () => onResolve(false) }
        ]);
    } else showFallbackDialog(reason, onResolve);
}
function showFallbackDialog(reason, cb) {
    const id = 'ds-reset-fallback-dialog';
    if (document.getElementById(id)) return;
    const d = document.createElement('div');
    d.id = id;
    d.innerHTML = `<div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;"><div style="background:#2b2b2b;color:#ddd;padding:24px;border-radius:8px;max-width:500px;"><h3>缓存优化器提醒</h3><p>${reason}</p><div style="display:flex;justify-content:flex-end;gap:10px;"><button id="ds-cancel" class="btn btn-secondary">取消</button><button id="ds-reset" class="btn btn-danger">重置</button></div></div></div>`;
    document.body.appendChild(d);
    document.getElementById('ds-reset').onclick = () => { cb(true); d.remove(); };
    document.getElementById('ds-cancel').onclick = () => { cb(false); d.remove(); };
}
function performReset() {
    CacheState.sentSequence = null;
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    CacheState.blocked = false;
    updateStatsUI();
    Logger.warn('[强制重置] 已清空', LogLevels.BASIC);
    const fb = document.getElementById('ds-reset-fallback-dialog');
    if (fb) fb.remove();
}

// ==========================================
// 菜单注册（兼容 1.17.0）
// ==========================================
function registerMenuItems() {
    try {
        // 最新版 SillyTavern 菜单 API
        if (typeof window['registerExtensionsMenu'] === 'function') {
            window['registerExtensionsMenu']([
                { label: '重置DS缓存前缀', callback: () => performReset() }
            ]);
            Logger.log('[菜单] 通过 window.registerExtensionsMenu 注册成功', LogLevels.BASIC);
        } else if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext().registerExtensionsMenu) {
            SillyTavern.getContext().registerExtensionsMenu([
                { label: '重置DS缓存前缀', callback: () => performReset() }
            ]);
            Logger.log('[菜单] 通过 SillyTavern API 注册成功', LogLevels.BASIC);
        } else if (typeof extension_settings !== 'undefined') {
            extension_settings['ds-cache'] = extension_settings['ds-cache'] || {};
            extension_settings['ds-cache'].extensionsMenu = [
                { label: '重置DS缓存前缀', action: () => performReset() }
            ];
            Logger.warn('[菜单] 采用 extension_settings 方式（可能需刷新）', LogLevels.BASIC);
        }
    } catch (e) {
        Logger.error('菜单注册失败', e);
    }
}

// ==========================================
// UI 初始化
// ==========================================
async function setupUI() {
    const html = `
    <div class="inline-drawer" id="ds-v4-opt-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>🧠 DS Cache Optimizer v6.8</b>
            <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="padding:10px;">
            <p style="font-size:0.9em;opacity:0.8;">精确前缀匹配 + sentSequence 锚定，杜绝历史注入干扰。</p>
            <div id="ds-cache-stats" style="margin-bottom:8px;"></div>
            <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" checked> 启用</label>
            <div style="margin:8px 0;">
                <span style="font-size:0.9em;">日志等级:</span>
                <select id="ds-cache-loglevel">
                    <option value="0">关闭</option><option value="1">简要</option>
                    <option value="2" selected>详细</option><option value="3">调试</option>
                </select>
            </div>
            <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:5px 0;">🔄 强制重置缓存前缀</button>
            <button id="ds-cache-clearlog" class="menu_button" style="width:100%;margin:5px 0;">🗑️ 清空日志</button>
            <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
        </div>
    </div>`;
    $('#extensions_settings').append(html);
    Logger._uiTextarea = document.getElementById('ds-cache-log');
    $('#ds-cache-enable').on('change', function() { CacheState.enabled = $(this).is(':checked'); Logger.log(`插件 ${CacheState.enabled?'启用':'停用'}`, LogLevels.BASIC); });
    $('#ds-cache-loglevel').on('change', function() { logLevel = parseInt($(this).val()); Logger.log(`日志等级: ${['关闭','简要','详细','调试'][logLevel]}`, LogLevels.BASIC); });
    $('#ds-cache-reset').on('click', () => performReset());
    $('#ds-cache-clearlog').on('click', () => { if (Logger._uiTextarea) Logger._uiTextarea.value = ''; });
    updateStatsUI();
}

// ==========================================
// 启动
// ==========================================
jQuery(async () => {
    await setupUI();
    registerMenuItems();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 钩子已挂载', LogLevels.BASIC);
    } else Logger.error('无法挂载钩子');
    Logger.log('══════ v6.8 就绪，sentSequence 锚定机制 ══════', LogLevels.BASIC);
});
