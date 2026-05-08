import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// 日志系统 (不变)
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };
let logLevel = 2;
function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const fullMsg = `[${time}] ${msg}`;
    if (type === 'warn') console.warn(`%c[DS Cache v6.7] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    else if (type === 'error') console.error(`[DS Cache v6.7] 🔴 ${msg}`);
    else console.log(`%c[DS Cache v6.7] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
    simpleHash: (str) => { /* 不变 */ let hash = 0; for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; } return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8); },
    estimateTokens: (text) => { /* 不变 */ if (!text) return 0; let tokens = 0; for (const ch of text) { const code = ch.charCodeAt(0); if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3040 && code <= 0x30FF) || (code >= 0xAC00 && code <= 0xD7AF)) tokens += 1; else tokens += 0.25; } return Math.ceil(tokens); },
    normalize: (text) => text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
};

// 状态机 (增加详细分类标记)
const CacheState = {
    enabled: true,
    backgroundBlock: null,
    dialogueHistory: null,
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
    blocked: false,
};

// 增强分类：根据消息在 originalChat 中的真实身份判断
function classifyMessage(msg, originalChat) {
    // 通过内容匹配，但内容可能重复，我们以第一个匹配为准 (通常足够)
    const exactIndex = originalChat.findIndex(m => m.mes === msg.content);
    if (exactIndex !== -1) {
        const orig = originalChat[exactIndex];
        // 真实用户输入：is_user 为 true，且不是系统提示
        if (orig.is_user) return { isRealUser: true, isRealAI: false, isInstructional: false, matched: true };
        // 真实AI回复：is_system 为 false 且 role 通常为 assistant
        if (!orig.is_system && orig.role === 'assistant') return { isRealUser: false, isRealAI: true, isInstructional: false, matched: true };
        // 任何系统标记的消息都是提示词
        if (orig.is_system) return { isRealUser: false, isRealAI: false, isInstructional: true, matched: true };
        // 其他情况（如 orig 是 user 但 is_user 为 false）仍视为提示词
        return { isRealUser: false, isRealAI: false, isInstructional: true, matched: true };
    }
    // 未在 originalChat 中找到 -> 100% 是注入提示词
    return { isRealUser: false, isRealAI: false, isInstructional: true, matched: false };
}

function createMessageObj(msg, cls, uid) {
    return {
        role: msg.role,
        content: msg.content,
        isRealUser: cls.isRealUser,
        isRealAI: cls.isRealAI,
        isInstructional: cls.isInstructional,
        uid: uid || `${msg.role}:${Logger.simpleHash(msg.content)}`,
        norm: Logger.normalize(msg.content),
        matched: cls.matched,
    };
}

// 流程处理：精确分离当前用户输入与历史对话
function processStream(stream, originalChat) {
    // 1. 预填充：尾部连续的 assistant，但若发现任何真实的 AI 回复则回撤
    let prefillStart = stream.length;
    while (prefillStart > 0 && stream[prefillStart - 1].role === 'assistant') {
        prefillStart--;
    }
    let hasRealReply = false;
    for (let i = prefillStart; i < stream.length; i++) {
        const cls = classifyMessage(stream[i], originalChat);
        if (cls.isRealAI) { hasRealReply = true; break; }
    }
    if (hasRealReply) prefillStart = stream.length;
    const prefills = stream.slice(prefillStart);
    const nonPrefill = stream.slice(0, prefillStart);

    // 2. 寻找当前用户输入：最后一个在 originalChat 中匹配且 isRealUser 的 user 消息，且必须是整个 originalChat 的最后一条用户消息
    let currentUserMsg = null;
    const others = [];
    // 先收集所有 nonPrefill，记录每个的分类
    const classifiedNonPrefill = nonPrefill.map(msg => {
        const cls = classifyMessage(msg, originalChat);
        return { msg, cls, obj: createMessageObj(msg, cls) };
    });

    // 找到 originalChat 中最后一条真实用户消息的内容
    const lastUserContent = originalChat.filter(m => m.is_user).pop()?.mes;

    // 从后往前找到第一个匹配的 user
    for (let i = classifiedNonPrefill.length - 1; i >= 0; i--) {
        const { msg, cls, obj } = classifiedNonPrefill[i];
        if (!currentUserMsg && cls.isRealUser && msg.role === 'user') {
            // 额外检查：此内容必须是 originalChat 最后一条 user 消息（防止选择到历史中间的 user）
            if (msg.content === lastUserContent) {
                currentUserMsg = obj;
                continue;
            } else {
                Logger.log(`[用户输入识别] 跳过非最新用户消息: ${msg.content.substring(0, 30)}...`, LogLevels.DEBUG);
            }
        }
        others.unshift(obj);
    }

    // 3. 调试日志
    if (logLevel >= LogLevels.DEBUG) {
        Logger.log('[过程分类]', LogLevels.DEBUG);
        classifiedNonPrefill.forEach((c, i) => {
            Logger.log(`  [${i}] ${c.msg.role} | realUser:${c.cls.isRealUser} realAI:${c.cls.isRealAI} instr:${c.cls.isInstructional} matched:${c.cls.matched} | ${c.msg.content.substring(0, 40)}...`, LogLevels.DEBUG);
        });
    }

    return { currentUserMsg, others, prefills };
}

// 核心拦截器 (微调初始化逻辑)
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

        const { currentUserMsg, others, prefills } = processStream(stream, originalChat);

        const currentBg = others.filter(m => m.isInstructional);
        const currentDialogue = others.filter(m => !m.isInstructional);

        // 背景去重
        const seenBgNorm = new Set();
        const dedupBg = [];
        for (const m of currentBg) {
            if (!seenBgNorm.has(m.norm)) {
                seenBgNorm.add(m.norm);
                dedupBg.push(m);
            } else {
                Logger.log(`[背景去重] 跳过: ${m.content.substring(0, 40)}...`, LogLevels.DEBUG);
            }
        }

        // 初始化
        if (!CacheState.backgroundBlock || !CacheState.dialogueHistory) {
            // 额外清理：对话历史中不能有连续两个 user 或两个 assistant，且必须是交替的
            const cleanDialogue = [];
            let lastRole = null;
            for (const m of currentDialogue) {
                if (m.role === lastRole) {
                    Logger.warn(`[对话历史清理] 发现连续 ${m.role}，跳过重复角色消息: ${m.content.substring(0, 40)}...`, LogLevels.BASIC);
                    continue;
                }
                cleanDialogue.push(m);
                lastRole = m.role;
            }
            CacheState.backgroundBlock = dedupBg;
            CacheState.dialogueHistory = cleanDialogue;
            Logger.log(`[初始化] 背景:${dedupBg.length} 对话:${cleanDialogue.length}`, LogLevels.BASIC);
            buildAndApply(stream, dedupBg, cleanDialogue, currentUserMsg, prefills);
            updateStats(true);
            return;
        }

        // 背景相似度检测
        const bgSim = computeSetSimilarity(
            new Set(CacheState.backgroundBlock.map(m => m.norm)),
            new Set(dedupBg.map(m => m.norm))
        );
        Logger.log(`[背景相似度] ${(bgSim*100).toFixed(1)}%`, LogLevels.DEBUG);
        if (bgSim < 0.9) {
            triggerResetAlert('检测到系统提示词核心变动，建议重置缓存前缀以保证性能。');
            return;
        }

        // 对话增量
        const newDial = findNewEntries(CacheState.dialogueHistory, currentDialogue);
        if (newDial.length > 0) Logger.warn(`[对话增量] +${newDial.length} 条`, LogLevels.DETAILED);
        const updatedDialogue = CacheState.dialogueHistory.concat(newDial);

        if (currentDialogue.length < CacheState.dialogueHistory.length * 0.7) {
            triggerResetAlert('对话历史被大幅删除，建议重置。');
            return;
        }

        CacheState.dialogueHistory = updatedDialogue;
        buildAndApply(stream, CacheState.backgroundBlock, CacheState.dialogueHistory, currentUserMsg, prefills);
        updateStats(false);

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

function buildAndApply(stream, bg, dialogue, curUser, prefills) {
    const final = [];
    bg.forEach(b => final.push({ role: b.role, content: b.content }));
    dialogue.forEach(d => final.push({ role: d.role, content: d.content }));
    if (curUser) final.push({ role: curUser.role, content: curUser.content });
    prefills.forEach(p => final.push({ role: p.role, content: p.content }));

    if (logLevel >= LogLevels.DEBUG) {
        Logger.log(`[最终序列] bg:${bg.length} dl:${dialogue.length} usr:${curUser?1:0} pf:${prefills.length}`, LogLevels.DEBUG);
        final.forEach((m, i) => Logger.log(`  ${i}: [${m.role}] ${m.content.substring(0, 50)}...`, LogLevels.DEBUG));
    }
    stream.splice(0, stream.length, ...final);
}

function findNewEntries(oldSeq, newSeq) {
    const oldUids = new Set(oldSeq.map(m => m.uid));
    return newSeq.filter(m => !oldUids.has(m.uid));
}

function computeSetSimilarity(a, b) {
    if (a.size === 0 && b.size === 0) return 1;
    const union = new Set([...a, ...b]);
    let intersection = 0;
    for (const item of a) if (b.has(item)) intersection++;
    return union.size === 0 ? 1 : intersection / union.size;
}

function updateStats(isInit = false) {
    const bgTokens = CacheState.backgroundBlock?.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0) ?? 0;
    const dgTokens = CacheState.dialogueHistory?.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0) ?? 0;
    CacheState.stats.prefixTokens = bgTokens + dgTokens;
    CacheState.stats.hits++;
    CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
    updateStatsUI();
}

function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `<span>命中: ${hits}/${total} (${rate}%)</span> <span style="margin-left:10px;">前缀: ~${prefixTokens.toLocaleString()}t</span> <span style="margin-left:10px;">节省: ~${savedTokens.toLocaleString()}t</span>`;
}

// 弹窗与阻塞 (不变)
function triggerResetAlert(reason) {
    if (CacheState.blocked) return;
    CacheState.blocked = true;
    Logger.warn('[阻塞] 弹窗已弹出', LogLevels.BASIC);
    const onResolve = (reset) => {
        if (reset) {
            CacheState.backgroundBlock = null;
            CacheState.dialogueHistory = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateStatsUI();
            Logger.warn('[重置] 前缀已清空', LogLevels.BASIC);
        } else Logger.warn('[取消] 不重置', LogLevels.BASIC);
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
    CacheState.backgroundBlock = null;
    CacheState.dialogueHistory = null;
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    CacheState.blocked = false;
    updateStatsUI();
    Logger.warn('[强制重置] 已清空', LogLevels.BASIC);
    const fb = document.getElementById('ds-reset-fallback-dialog');
    if (fb) fb.remove();
}

// 注册扩展菜单
function registerMenuItems() {
    try {
        if (typeof window['registerExtensionsMenu'] === 'function') {
            window['registerExtensionsMenu']([
                { label: '重置DS缓存前缀', callback: () => performReset() }
            ]);
            Logger.log('[菜单] 通过 registerExtensionsMenu 注册成功', LogLevels.BASIC);
        } else if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext().registerExtensionsMenu) {
            SillyTavern.getContext().registerExtensionsMenu([
                { label: '重置DS缓存前缀', callback: () => performReset() }
            ]);
            Logger.log('[菜单] 通过 SillyTavern API 注册', LogLevels.BASIC);
        } else if (typeof extension_settings !== 'undefined') {
            // 兜底
            extension_settings['ds-cache'] = extension_settings['ds-cache'] || {};
            extension_settings['ds-cache'].extensionsMenu = [
                { label: '重置DS缓存前缀', action: () => performReset() }
            ];
            Logger.warn('[菜单] 采用 extension_settings 方式注册（可能不可见）', LogLevels.BASIC);
        }
    } catch (e) {
        Logger.error('菜单注册失败', e);
    }
}

// UI 初始化
async function setupUI() {
    const html = `
    <div class="inline-drawer" id="ds-v4-opt-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>🧠 DS Cache Optimizer v6.7</b>
            <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="padding:10px;">
            <p>精确识别用户/助手消息，预防重复 user 堆积，菜单注册增强。</p>
            <div id="ds-cache-stats" style="margin-bottom:8px;"></div>
            <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" checked> 启用</label>
            <div style="margin:8px 0;">
                <span>日志:</span>
                <select id="ds-cache-loglevel">
                    <option value="0">关闭</option><option value="1">简要</option>
                    <option value="2" selected>详细</option><option value="3">调试</option>
                </select>
            </div>
            <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:5px 0;">🔄 强制重置</button>
            <button id="ds-cache-clearlog" class="menu_button" style="width:100%;margin:5px 0;">🗑️ 清空日志</button>
            <textarea id="ds-cache-log" class="text_pole" readonly style="height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
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

jQuery(async () => {
    await setupUI();
    registerMenuItems();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 钩子已挂载', LogLevels.BASIC);
    } else Logger.error('无法挂载钩子');
    Logger.log('══════ v6.7 就绪，严格用户输入识别 + 菜单修复 ══════', LogLevels.BASIC);
});
