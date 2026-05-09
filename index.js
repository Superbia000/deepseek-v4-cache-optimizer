import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// 日志系统（同前）
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };
let logLevel = 2;
function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const fullMsg = `[${time}] ${msg}`;
    if (type === 'warn') console.warn(`%c[DS Cache v6.10] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    else if (type === 'error') console.error(`[DS Cache v6.10] 🔴 ${msg}`);
    else console.log(`%c[DS Cache v6.10] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
    if (Logger._uiTextarea) {
        Logger._uiTextarea.value += fullMsg + '\n';
        Logger._uiTextarea.scrollTop = Logger._uiTextarea.scrollHeight;
    }
}
const Logger = {
    _uiTextarea: null,
    log: (msg, lvl = LogLevels.DETAILED) => logAt(lvl, 'log', msg),
    warn: (msg, lvl = LogLevels.BASIC) => logAt(lvl, 'warn', msg),
    error: (msg, err, lvl = LogLevels.BASIC) => logAt(lvl, 'error', err ? `${msg} ${err}` : msg),
    simpleHash: (str) => { let h = 0; for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; } return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8); },
    estimateTokens: (text) => { if (!text) return 0; let t = 0; for (const ch of text) { const c = ch.charCodeAt(0); if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3040 && c <= 0x30FF) || (c >= 0xAC00 && c <= 0xD7AF)) t += 1; else t += 0.25; } return Math.ceil(t); },
    normalize: (text) => text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
};

const CacheState = {
    enabled: true,
    backgroundBlock: null,
    dialogueHistory: null,
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
    blocked: false,
    pendingData: null, // 用于重置后重新处理
};

// 消息分类（同前）
function classifyMessage(msg, originalChat) {
    const idx = originalChat.findIndex(m => m.mes === msg.content);
    if (idx !== -1) {
        const orig = originalChat[idx];
        if (orig.is_user) return { isRealUser: true, isRealAI: false, isInstructional: false, matched: true };
        if (!orig.is_system && orig.role === 'assistant') return { isRealUser: false, isRealAI: true, isInstructional: false, matched: true };
        if (orig.is_system) return { isRealUser: false, isRealAI: false, isInstructional: true, matched: true };
        return { isRealUser: false, isRealAI: false, isInstructional: true, matched: true };
    }
    return { isRealUser: false, isRealAI: false, isInstructional: true, matched: false };
}
function createMessageObj(msg, cls, uid) {
    return { role: msg.role, content: msg.content, isRealUser: cls.isRealUser, isRealAI: cls.isRealAI, isInstructional: cls.isInstructional, uid: uid || `${msg.role}:${Logger.simpleHash(msg.content)}`, norm: Logger.normalize(msg.content), matched: cls.matched };
}

// 改进 processStream：正确处理预填充
function processStream(stream, originalChat) {
    // 从后向前找真实的 AI 回复边界
    let prefillStart = stream.length;
    // 辅助函数：检查给定消息是否是真实 AI 回复
    const isRealAI = (msg) => {
        const cls = classifyMessage(msg, originalChat);
        return cls.isRealAI && msg.role === 'assistant';
    };
    // 扫描尾部 assistant，找到最后一个真实 AI 回复之后的预填充起点
    let lastRealAIIndex = -1;
    for (let i = stream.length - 1; i >= 0; i--) {
        if (stream[i].role === 'assistant' && isRealAI(stream[i])) {
            lastRealAIIndex = i;
            break;
        }
    }
    if (lastRealAIIndex !== -1) {
        // 真实 AI 回复之后的消息才是预填充
        prefillStart = lastRealAIIndex + 1;
    } else {
        // 没有真实 AI，则所有尾部 assistant 都可能作为预填充（但进一步检查是否有系统生成的预填充）
        // 保持原样
    }
    const prefills = stream.slice(prefillStart);
    const nonPrefill = stream.slice(0, prefillStart);

    // 分类所有非预填充
    const classified = nonPrefill.map(msg => {
        const cls = classifyMessage(msg, originalChat);
        return { msg, cls, obj: createMessageObj(msg, cls) };
    });

    // 找到所有真实用户消息，仅保留最后一个作为当前用户输入，其余强制转为提示词
    const realUserIndices = [];
    classified.forEach((c, i) => {
        if (c.cls.isRealUser && c.msg.role === 'user') realUserIndices.push(i);
    });
    let currentUserMsg = null;
    if (realUserIndices.length > 0) {
        const lastIdx = realUserIndices[realUserIndices.length - 1];
        currentUserMsg = classified[lastIdx].obj;
        for (let i = 0; i < realUserIndices.length - 1; i++) {
            const idx = realUserIndices[i];
            classified[idx].cls.isRealUser = false;
            classified[idx].cls.isInstructional = true;
            classified[idx].obj.isRealUser = false;
            classified[idx].obj.isInstructional = true;
        }
    }

    const others = [];
    for (const c of classified) {
        if (c.obj === currentUserMsg) continue;
        others.push(c.obj);
    }

    // 诊断日志
    if (logLevel >= LogLevels.DEBUG) {
        Logger.log(`[originalChat 尾部] ${originalChat.length} 条，最后真实AI索引:${lastRealAIIndex}`, LogLevels.DEBUG);
        originalChat.slice(-3).forEach((m, i) => Logger.log(`  ${originalChat.length-3+i}: role=${m.role} isUser=${m.is_user} mes="${m.mes?.substring(0,30)}..."`, LogLevels.DEBUG));
        Logger.log('[过程分类]', LogLevels.DEBUG);
        classified.forEach((c, i) => Logger.log(`  [${i}] ${c.msg.role} | rU:${c.cls.isRealUser} rAI:${c.cls.isRealAI} instr:${c.cls.isInstructional} | ${c.msg.content.substring(0, 40)}...`, LogLevels.DEBUG));
    }
    return { currentUserMsg, others, prefills };
}

// 核心拦截器，增加重置后重新处理
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;
    if (CacheState.blocked) {
        Logger.warn('[阻塞] 保持原样', LogLevels.BASIC);
        CacheState.pendingData = data; // 存储以便重置后使用
        return;
    }
    // 调用实际处理逻辑
    _processRequest(data);
}

function _processRequest(data) {
    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`[请求 #${CacheState.stats.total}] 开始处理...`);

        const stream = data.chat;
        const context = getContext();
        const originalChat = context?.chat ?? [];

        const { currentUserMsg, others, prefills } = processStream(stream, originalChat);

        // 初始化：背景块仅收集 system 角色且是提示词的消息，丢弃一切对话历史
        if (!CacheState.backgroundBlock) {
            const validBg = others.filter(m => m.role === 'system' && m.isInstructional && !m.isRealUser);
            const seenBgNorm = new Set();
            const dedupBg = [];
            for (const m of validBg) {
                if (!seenBgNorm.has(m.norm)) {
                    seenBgNorm.add(m.norm);
                    dedupBg.push(m);
                } else Logger.log(`[背景去重] 跳过: ${m.content.substring(0, 30)}...`, LogLevels.DEBUG);
            }
            const discarded = others.filter(m => !validBg.includes(m));
            if (discarded.length > 0 && logLevel >= LogLevels.DEBUG) {
                Logger.log('[初始化丢弃]', LogLevels.DEBUG);
                discarded.forEach(m => Logger.log(`  丢弃: role=${m.role} rU=${m.isRealUser} instr=${m.isInstructional} ${m.content.substring(0, 40)}...`, LogLevels.DEBUG));
            }
            CacheState.backgroundBlock = dedupBg;
            CacheState.dialogueHistory = [];
            Logger.log(`[初始化] 背景:${dedupBg.length} 对话:0`, LogLevels.BASIC);
            buildAndApply(stream, dedupBg, [], currentUserMsg, prefills);
            updateStats(true);
            return;
        }

        // 常规运行
        const currentBg = others.filter(m => m.isInstructional);
        const currentDialogue = others.filter(m => !m.isInstructional);
        const seenBgNorm = new Set();
        const dedupBg = [];
        for (const m of currentBg) {
            if (!seenBgNorm.has(m.norm)) { seenBgNorm.add(m.norm); dedupBg.push(m); }
        }
        const bgSim = computeSetSimilarity(new Set(CacheState.backgroundBlock.map(m => m.norm)), new Set(dedupBg.map(m => m.norm)));
        Logger.log(`[背景相似度] ${(bgSim*100).toFixed(1)}%`, LogLevels.DEBUG);
        if (bgSim < 0.9) {
            triggerResetAlert(data, '检测到系统提示词核心变动，建议重置以保证性能。');
            return;
        }
        const newDial = findNewEntries(CacheState.dialogueHistory, currentDialogue);
        if (newDial.length > 0) Logger.warn(`[对话增量] +${newDial.length}`, LogLevels.DETAILED);
        const updatedDialogue = CacheState.dialogueHistory.concat(newDial);
        if (currentDialogue.length < CacheState.dialogueHistory.length * 0.7) {
            triggerResetAlert(data, '对话历史被大幅删除，建议重置。');
            return;
        }
        CacheState.dialogueHistory = updatedDialogue;
        buildAndApply(stream, CacheState.backgroundBlock, CacheState.dialogueHistory, currentUserMsg, prefills);
        updateStats(false);

    } catch (err) {
        Logger.error('处理致命错误', err);
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

function updateStats(isInit) {
    const bg = CacheState.backgroundBlock?.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0) ?? 0;
    const dg = CacheState.dialogueHistory?.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0) ?? 0;
    CacheState.stats.prefixTokens = bg + dg;
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

// 弹窗：传递 data 以便重置后重新处理
function triggerResetAlert(data, reason) {
    if (CacheState.blocked) return;
    CacheState.blocked = true;
    Logger.warn('[阻塞] 弹窗已弹出，等待用户选择', LogLevels.BASIC);
    const onResolve = (reset) => {
        if (reset) {
            // 清空状态
            CacheState.backgroundBlock = null;
            CacheState.dialogueHistory = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateStatsUI();
            Logger.warn('[重置] 已清空，立即重新处理当前请求', LogLevels.BASIC);
            // 解除阻塞并重新处理
            CacheState.blocked = false;
            if (data) {
                _processRequest(data);
            }
        } else {
            Logger.warn('[取消] 不重置，继续使用当前前缀', LogLevels.BASIC);
            CacheState.blocked = false;
        }
    };
    if (typeof callPopup === 'function') {
        callPopup(`<h4>缓存优化器</h4><p>${reason}</p>`, [
            { text: '重置', className: 'btn-danger', callback: () => onResolve(true) },
            { text: '取消', callback: () => onResolve(false) }
        ]);
    } else {
        showFallbackDialog(reason, onResolve);
    }
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
    // 强制重置后下一次请求会自动初始化，不需要额外操作
}

// 扩展菜单注册（多方式尝试）
function registerMenuItems() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext().addExtensionMenu) {
            SillyTavern.getContext().addExtensionMenu([{ label: '重置DS缓存前缀', callback: performReset }]);
            Logger.log('[菜单] addExtensionMenu 注册成功', LogLevels.BASIC);
        } else if (typeof window['registerExtensionsMenu'] === 'function') {
            window['registerExtensionsMenu']([{ label: '重置DS缓存前缀', callback: performReset }]);
            Logger.log('[菜单] registerExtensionsMenu 注册成功', LogLevels.BASIC);
        } else {
            // extension_settings方式，需要用户在扩展面板勾选“显示菜单”
            extension_settings['ds-cache'] = extension_settings['ds-cache'] || {};
            extension_settings['ds-cache'].menu = [{ label: '重置DS缓存前缀', callback: performReset }];
            Logger.warn('[菜单] 已在extension_settings中注册，请在扩展设置中勾选“显示菜单”', LogLevels.BASIC);
        }
    } catch (e) {
        Logger.error('菜单注册失败', e);
    }
}

// UI初始化
async function setupUI() {
    const html = `
    <div class="inline-drawer" id="ds-v4-opt-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>🧠 DS Cache Optimizer v6.10 (重置重处理)</b>
            <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="padding:10px;">
            <p>重置后立即重新处理当前请求，确保新序列正确。</p>
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
    Logger.log('══════ v6.10 就绪，重置即时重处理 ══════', LogLevels.BASIC);
});
