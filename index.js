import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ========== 日志系统 ==========
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };
let logLevel = 2;
function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const full = `[${time}] ${msg}`;
    if (type === 'warn') console.warn(`%c[DS Cache V7.0] 🌪️ ${msg}`, 'color: #ffaa00;');
    else if (type === 'error') console.error(`[DS Cache V7.0] 🔴 ${msg}`);
    else console.log(`%c[DS Cache V7.0] ✅ ${msg}`, 'color: #00ff00;');
    if (Logger._ui) {
        Logger._ui.value += full + '\n';
        Logger._ui.scrollTop = Logger._ui.scrollHeight;
    }
}
const Logger = {
    _ui: null,
    log: (m, l = LogLevels.DETAILED) => logAt(l, 'log', m),
    warn: (m, l = LogLevels.BASIC) => logAt(l, 'warn', m),
    error: (m, e, l = LogLevels.BASIC) => logAt(l, 'error', e ? `${m} ${e}` : m),
    hash: s => { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8); },
    est: t => { if (!t) return 0; let n = 0; for (const c of t) { const code = c.charCodeAt(0); n += (code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3040 && code <= 0x30FF) || (code >= 0xAC00 && code <= 0xD7AF) ? 1 : 0.25; } return Math.ceil(n); },
    norm: t => t.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
};

// ========== 状态机 ==========
const CacheState = {
    enabled: true,
    backgroundBlock: null,  // 锁定背景（系统提示词去重）
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
    blocked: false,
};

// ========== 获取当前用户输入的确切内容 ==========
function getCurrentUserInput() {
    const ctx = getContext();
    if (!ctx || !ctx.chat || !Array.isArray(ctx.chat)) return null;
    // 从后往前找最后一个 is_user === true 的消息
    for (let i = ctx.chat.length - 1; i >= 0; i--) {
        if (ctx.chat[i].is_user) return ctx.chat[i].mes;
    }
    return null;
}

// ========== 核心处理 ==========
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun || CacheState.blocked) {
        if (CacheState.blocked) Logger.warn('[阻塞] 保持原始消息', LogLevels.BASIC);
        return;
    }

    try {
        CacheState.stats.total++;
        Logger.log(`===== [请求 #${CacheState.stats.total}] =====`);

        if (!data?.chat?.length) return;
        const stream = data.chat;

        // 1. 获取当前用户输入的真实文本
        const realUserInput = getCurrentUserInput();
        Logger.log(`[真实用户输入检测] ${realUserInput ? realUserInput.substring(0, 40) + '...' : '无'}`, LogLevels.DEBUG);

        // 2. 分离预填充：末尾连续的 assistant
        let prefillStart = stream.length;
        while (prefillStart > 0 && stream[prefillStart - 1].role === 'assistant') prefillStart--;
        const prefills = stream.slice(prefillStart);
        const nonPrefill = stream.slice(0, prefillStart);

        // 3. 找到当前用户输入在 nonPrefill 中的索引（通过内容完全匹配，且必须是 user 角色）
        let userInputIndex = -1;
        if (realUserInput) {
            userInputIndex = nonPrefill.findIndex(
                m => m.role === 'user' && m.content === realUserInput
            );
        }
        // 若找不到，回退到最后一个 user 消息（兼容极端情况）
        if (userInputIndex === -1) {
            for (let i = nonPrefill.length - 1; i >= 0; i--) {
                if (nonPrefill[i].role === 'user') {
                    userInputIndex = i;
                    Logger.warn('[用户输入定位] 通过末尾 user 回退定位', LogLevels.BASIC);
                    break;
                }
            }
        }

        // 4. 构建背景块：除去用户输入的那条 message，其余所有 nonPrefill 均视为背景
        const background = [];
        for (let i = 0; i < nonPrefill.length; i++) {
            if (i === userInputIndex) continue;
            background.push({ role: nonPrefill[i].role, content: nonPrefill[i].content, norm: Logger.norm(nonPrefill[i].content) });
        }

        // 背景去重（按标准化内容）
        const seen = new Set();
        const dedupBg = [];
        for (const m of background) {
            if (seen.has(m.norm)) {
                Logger.log(`[背景去重] 跳过: ${m.content.substring(0, 40)}...`, LogLevels.DEBUG);
            } else {
                seen.add(m.norm);
                dedupBg.push(m);
            }
        }

        // 5. 初始化 / 更新背景块
        if (!CacheState.backgroundBlock) {
            CacheState.backgroundBlock = dedupBg;
            Logger.log(`[初始化] 锁定背景块 (${dedupBg.length} 条)`, LogLevels.BASIC);
        } else {
            // 比较新旧背景相似度
            const oldSet = new Set(CacheState.backgroundBlock.map(m => m.norm));
            const newSet = new Set(dedupBg.map(m => m.norm));
            const union = new Set([...oldSet, ...newSet]);
            const intersection = [...oldSet].filter(x => newSet.has(x)).length;
            const sim = union.size === 0 ? 1 : intersection / union.size;
            Logger.log(`[背景相似度] ${(sim * 100).toFixed(1)}%`, LogLevels.DEBUG);

            if (sim < 0.9) {
                triggerResetAlert('检测到系统提示词核心变化，建议重置缓存前缀。');
                return;
            }
            // 仅当完全匹配时保持原背景，否则谨慎更新（此处保持不变以保证前缀稳定）
            // 实际上我们持续使用已锁定的背景块，因为它保证了前缀不变。
            // 新背景块 dedupBg 仅用于相似度检测，不覆盖原块。
        }

        // 6. 构建最终序列：锁定背景 + 当前用户输入 + 预填充
        const final = [];
        CacheState.backgroundBlock.forEach(b => final.push({ role: b.role, content: b.content }));
        if (userInputIndex !== -1) {
            const userMsg = nonPrefill[userInputIndex];
            final.push({ role: userMsg.role, content: userMsg.content });
        }
        prefills.forEach(p => final.push({ role: p.role, content: p.content }));

        if (logLevel >= LogLevels.DEBUG) {
            Logger.log(`[最终序列] 背景:${CacheState.backgroundBlock.length} 用户:${userInputIndex !== -1 ? 1 : 0} 预填充:${prefills.length}`);
            final.forEach((m, i) => Logger.log(`  ${i}: [${m.role}] ${m.content.substring(0, 50)}...`));
        }

        stream.splice(0, stream.length, ...final);
        updateStats();

    } catch (err) {
        Logger.error('致命错误', err);
    }
}

function updateStats() {
    const tokens = CacheState.backgroundBlock?.reduce((acc, m) => acc + Logger.est(m.content), 0) ?? 0;
    CacheState.stats.prefixTokens = tokens;
    CacheState.stats.hits++;
    CacheState.stats.savedTokens += tokens;
    updateUIStats();
}
function updateUIStats() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `<span>命中: ${hits}/${total} (${rate}%)</span> <span style="margin-left:10px;">前缀: ~${prefixTokens.toLocaleString()}t</span> <span style="margin-left:10px;">节省: ~${savedTokens.toLocaleString()}t</span>`;
}

// ========== 弹窗 ==========
function triggerResetAlert(reason) {
    if (CacheState.blocked) return;
    CacheState.blocked = true;
    Logger.warn('[阻塞] 弹窗已弹出');
    const resolve = (reset) => {
        if (reset) {
            CacheState.backgroundBlock = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateUIStats();
            Logger.warn('[重置] 已清空');
        }
        CacheState.blocked = false;
    };
    if (typeof callPopup === 'function') {
        callPopup(`<h4>缓存优化器</h4><p>${reason}</p>`, [
            { text: '重置', className: 'btn-danger', callback: () => resolve(true) },
            { text: '取消', callback: () => resolve(false) }
        ]);
    } else {
        showFallbackDialog(reason, resolve);
    }
}
function showFallbackDialog(reason, cb) {
    const id = 'ds-fb-dlg';
    if (document.getElementById(id)) return;
    const d = document.createElement('div');
    d.id = id;
    d.innerHTML = `<div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;"><div style="background:#2b2b2b;color:#ddd;padding:24px;border-radius:8px;max-width:500px;"><h3>缓存优化器</h3><p>${reason}</p><div style="display:flex;gap:10px;justify-content:flex-end;"><button id="ds-cancel" class="btn btn-secondary">取消</button><button id="ds-reset" class="btn btn-danger">重置</button></div></div></div>`;
    document.body.appendChild(d);
    document.getElementById('ds-reset').onclick = () => { cb(true); d.remove(); };
    document.getElementById('ds-cancel').onclick = () => { cb(false); d.remove(); };
}
function performReset() {
    CacheState.backgroundBlock = null;
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    CacheState.blocked = false;
    updateUIStats();
    Logger.warn('[强制重置] 已清空');
    const d = document.getElementById('ds-fb-dlg');
    if (d) d.remove();
}

// ========== 菜单（修复） ==========
function registerMenu() {
    // 方式1: 全局 API (SillyTavern 1.17+)
    if (typeof window.registerExtensionsMenu === 'function') {
        window.registerExtensionsMenu([
            { label: '重置DS缓存前缀', callback: performReset }
        ]);
        return;
    }
    // 方式2: SillyTavern 上下文
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const ctx = SillyTavern.getContext();
            if (ctx.registerExtensionsMenu) {
                ctx.registerExtensionsMenu([
                    { label: '重置DS缓存前缀', callback: performReset }
                ]);
                return;
            }
        }
    } catch (e) {}
    // 方式3: extension_settings 注入 + 手动监听（直接创建一个绝对可见的按钮）
    Logger.warn('[菜单] 将添加一个全局浮动重置按钮');
    const btn = document.createElement('button');
    btn.textContent = '🧠 重置DS缓存';
    btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;padding:8px 12px;background:#b33;color:white;border:none;border-radius:4px;cursor:pointer;';
    btn.onclick = performReset;
    document.body.appendChild(btn);
}

// ========== UI ==========
async function setupUI() {
    const html = `
    <div class="inline-drawer">
        <div class="inline-drawer-toggle"><b>🧠 DS Cache V7.0</b><div class="inline-drawer-icon"></div></div>
        <div class="inline-drawer-content" style="padding:10px;">
            <p>智能分离用户输入，锁定背景块，绝对稳定前缀。</p>
            <div id="ds-cache-stats" style="margin-bottom:8px;"></div>
            <label><input type="checkbox" id="ds-cache-enable" checked> 启用</label>
            <select id="ds-cache-loglevel" style="margin:5px 0;">
                <option value="0">关闭</option><option value="1">简要</option><option value="2" selected>详细</option><option value="3">调试</option>
            </select>
            <button id="ds-cache-reset" class="menu_button" style="width:100%;">🔄 强制重置</button>
            <button id="ds-cache-clearlog" class="menu_button" style="width:100%;">🗑️ 清空日志</button>
            <textarea id="ds-cache-log" readonly style="height:200px;background:#121212;color:#4af626;font-family:Consolas;font-size:11px;"></textarea>
        </div>
    </div>`;
    $('#extensions_settings').append(html);
    Logger._ui = document.getElementById('ds-cache-log');
    $('#ds-cache-enable').on('change', function() { CacheState.enabled = $(this).is(':checked'); });
    $('#ds-cache-loglevel').on('change', function() { logLevel = parseInt($(this).val()); });
    $('#ds-cache-reset').on('click', performReset);
    $('#ds-cache-clearlog').on('click', () => { if (Logger._ui) Logger._ui.value = ''; });
    updateUIStats();
}

jQuery(async () => {
    await setupUI();
    registerMenu();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 钩子已挂载', LogLevels.BASIC);
    }
    Logger.log('══════ V7.0 就绪，绝对稳定前缀 ══════', LogLevels.BASIC);
});
