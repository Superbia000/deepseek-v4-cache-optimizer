import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志系统 (增強版)
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };
let logLevel = 2;

function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const fullMsg = `[${time}] ${msg}`;
    if (type === 'warn') {
        console.warn(`%c[DS Cache v6.4] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS Cache v6.4] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS Cache v6.4] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
    simpleHash: (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
    },
    estimateTokens: (text) => {
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
    },
    normalize: (text) => text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim(),
};

// ==========================================
// 状态机 v6.4
// ==========================================
const CacheState = {
    enabled: true,
    backgroundBlock: null,
    dialogueHistory: null,
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
};

// ==========================================
// 消息分类 (增强日志)
// ==========================================
function classifyMessage(msg, originalChat) {
    const orig = originalChat.find(m => m.mes === msg.content);
    let cls;
    if (orig) {
        if (orig.is_user) cls = { isRealUser: true, isRealAI: false, isInstructional: false };
        else if (!orig.is_system) {
            if (msg.role === 'assistant') cls = { isRealUser: false, isRealAI: true, isInstructional: false };
            else cls = { isRealUser: false, isRealAI: false, isInstructional: true };
        } else {
            cls = { isRealUser: false, isRealAI: false, isInstructional: true };
        }
    } else {
        cls = { isRealUser: false, isRealAI: false, isInstructional: true };
    }
    if (logLevel >= LogLevels.DEBUG) {
        const label = cls.isRealUser ? '👤真实用户' : (cls.isRealAI ? '🤖真实AI' : '📋教学/系统');
        Logger.log(`[分类] ${label} | ${msg.role}: ${msg.content.substring(0, 30)}...`, LogLevels.DEBUG);
    }
    return cls;
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
    };
}

// ==========================================
// 处理请求流 (消除重复，纳入预填充)
// ==========================================
function processStream(stream, originalChat) {
    let prefillStart = stream.length;
    while (prefillStart > 0 && stream[prefillStart - 1].role === 'assistant') {
        prefillStart--;
    }
    const prefills = stream.slice(prefillStart);
    const nonPrefill = stream.slice(0, prefillStart);

    // 将预填充消息转化为对象，纳入对话历史
    const prefillMessages = prefills.map(msg => {
        const cls = classifyMessage(msg, originalChat);
        return createMessageObj(msg, cls);
    });

    if (logLevel >= LogLevels.DEBUG) {
        Logger.log(`[流分割] 非预填充: ${nonPrefill.length} 条, 预填充: ${prefills.length} 条`, LogLevels.DEBUG);
    }

    let currentUserMsg = null;
    const others = [];
    for (let i = nonPrefill.length - 1; i >= 0; i--) {
        const msg = nonPrefill[i];
        const cls = classifyMessage(msg, originalChat);
        const obj = createMessageObj(msg, cls);
        if (!currentUserMsg && cls.isRealUser && msg.role === 'user') {
            currentUserMsg = obj;
            if (logLevel >= LogLevels.DEBUG) {
                Logger.log(`[当前用户消息] 索引 ${i}: ${obj.content.substring(0, 30)}...`, LogLevels.DEBUG);
            }
        } else {
            // 跳过与当前用户消息完全相同的重复条目
            if (currentUserMsg && cls.isRealUser && msg.role === 'user' && obj.uid === currentUserMsg.uid) {
                Logger.log(`[跳过重复用户消息] ${obj.content.substring(0, 30)}...`, LogLevels.DEBUG);
                continue;
            }
            others.unshift(obj);
        }
    }
    return { currentUserMsg, others, prefillMessages };
}

// ==========================================
// 核心拦截器
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`[请求 #${CacheState.stats.total}] 开始处理...`);

        if (!data?.chat?.length) return;
        const stream = data.chat;
        const context = getContext();
        const originalChat = context?.chat ?? [];

        const { currentUserMsg, others, prefillMessages } = processStream(stream, originalChat);

        const currentBg = others.filter(m => m.isInstructional);
        const currentDialogue = others.filter(m => !m.isInstructional);
        // 完整的对话历史 = 非预填充对话 + 预填充（通常为最新的AI回复）
        const completeDialogue = currentDialogue.concat(prefillMessages);

        // 去重背景
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
            CacheState.backgroundBlock = dedupBg;
            CacheState.dialogueHistory = completeDialogue;
            Logger.log(`[初始化] 背景:${dedupBg.length} 对话:${completeDialogue.length}`, LogLevels.BASIC);
            buildAndApply(stream, dedupBg, completeDialogue, currentUserMsg);
            updateStats(true);
            return;
        }

        // 背景相似度检测
        const bgSimilarity = computeSetSimilarity(
            new Set(CacheState.backgroundBlock.map(m => m.norm)),
            new Set(dedupBg.map(m => m.norm))
        );
        Logger.log(`[背景相似度] ${(bgSimilarity*100).toFixed(1)}%`, LogLevels.DEBUG);

        if (bgSimilarity < 0.9) {
            const shouldReset = confirm(
                '检测到系统提示词核心变动（更换角色卡/预设），建议重置缓存前缀以保证性能。\n\n' +
                '按「确定」重置前缀并发送消息；按「取消」放弃本次发送。'
            );
            if (!shouldReset) {
                if (typeof toastr !== 'undefined') toastr.warning('发送已取消');
                throw new Error('User cancelled send due to cache prefix change');
            }
            Logger.warn('[用户选择重置] 因背景变动，重置前缀并重新构建', LogLevels.BASIC);
            rebuildCacheAndApply(stream, dedupBg, completeDialogue, currentUserMsg);
            return;
        }

        // 对话增量
        const newDialogue = findNewEntries(CacheState.dialogueHistory, completeDialogue);
        if (newDialogue.length > 0) {
            Logger.warn(`[对话增量] +${newDialogue.length} 条`, LogLevels.DETAILED);
        }
        CacheState.dialogueHistory = CacheState.dialogueHistory.concat(newDialogue);

        // 大幅删除检测
        if (completeDialogue.length < CacheState.dialogueHistory.length * 0.7) {
            const shouldReset = confirm(
                '对话历史被大幅删除，缓存命中率将下降，建议重置。\n\n' +
                '按「确定」重置前缀并发送；按「取消」放弃本次发送。'
            );
            if (!shouldReset) {
                if (typeof toastr !== 'undefined') toastr.warning('发送已取消');
                throw new Error('User cancelled send due to dialogue deletion');
            }
            Logger.warn('[用户选择重置] 因对话删除，重置前缀并重新构建', LogLevels.BASIC);
            rebuildCacheAndApply(stream, dedupBg, completeDialogue, currentUserMsg);
            return;
        }

        // 构建最终序列
        buildAndApply(stream, CacheState.backgroundBlock, CacheState.dialogueHistory, currentUserMsg);
        updateStats(false);

    } catch (err) {
        Logger.error('拦截器致命错误', err);
        throw err;
    }
}

function rebuildCacheAndApply(stream, bgBlock, dialogueHist, currentUser) {
    performReset();
    CacheState.backgroundBlock = bgBlock;
    CacheState.dialogueHistory = dialogueHist;
    Logger.log(`[重置后重建] 背景:${bgBlock.length} 对话:${dialogueHist.length}`, LogLevels.BASIC);
    buildAndApply(stream, bgBlock, dialogueHist, currentUser);
    updateStats(true);
}

function buildAndApply(stream, bgBlock, dialogueHist, currentUser) {
    const final = [];
    bgBlock.forEach(b => final.push({ role: b.role, content: b.content }));
    dialogueHist.forEach(d => final.push({ role: d.role, content: d.content }));
    if (currentUser) final.push({ role: currentUser.role, content: currentUser.content });

    if (logLevel >= LogLevels.DEBUG) {
        Logger.log(`[最终序列] 背景:${bgBlock.length} 对话:${dialogueHist.length} 用户:${currentUser?1:0}`, LogLevels.DEBUG);
        final.forEach((m, i) => Logger.log(`  ${i}: [${m.role}] ${m.content.substring(0, 40)}...`, LogLevels.DEBUG));
    }
    stream.splice(0, stream.length, ...final);
}

function findNewEntries(oldSeq, newSeq) {
    const oldUids = new Set(oldSeq.map(m => m.uid));
    return newSeq.filter(m => !oldUids.has(m.uid));
}

function computeSetSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1;
    const union = new Set([...setA, ...setB]);
    let intersection = 0;
    for (const item of setA) if (setB.has(item)) intersection++;
    return union.size === 0 ? 1 : intersection / union.size;
}

function updateStats(isInit = false) {
    const bgTokens = CacheState.backgroundBlock?.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0) ?? 0;
    const dialogueTokens = CacheState.dialogueHistory?.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0) ?? 0;
    CacheState.stats.prefixTokens = bgTokens + dialogueTokens;
    CacheState.stats.hits++;
    CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
    updateStatsUI();
}

function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `
        <span>命中: ${hits}/${total} (${rate}%)</span>
        <span style="margin-left:10px;">前缀: ~${prefixTokens.toLocaleString()}t</span>
        <span style="margin-left:10px;">节省: ~${savedTokens.toLocaleString()}t</span>
    `;
}

// ==========================================
// 重置函数
// ==========================================
function performReset() {
    CacheState.backgroundBlock = null;
    CacheState.dialogueHistory = null;
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    updateStatsUI();
    Logger.warn('[重置] 前缀已清空，下次请求重建', LogLevels.BASIC);
}

// ==========================================
// UI 初始化 + ST菜单项
// ==========================================
async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Deepseek 缓存命中优化</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">背景/对话分离，绝对稳定前缀，弹窗+菜单重置。</p>
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

        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`插件 ${CacheState.enabled?'启用':'停用'}`, LogLevels.BASIC);
        });
        $('#ds-cache-loglevel').on('change', function() {
            logLevel = parseInt($(this).val());
            Logger.log(`日志等级: ${['关闭','简要','详细','调试'][logLevel]}`, LogLevels.BASIC);
        });
        $('#ds-cache-reset').on('click', () => performReset());
        $('#ds-cache-clearlog').on('click', () => {
            if (Logger._uiTextarea) Logger._uiTextarea.value = '';
        });

        // 注册 ST 扩展菜单项
        if (typeof extension_settings !== 'undefined') {
            extension_settings['ds-cache'] = extension_settings['ds-cache'] || {};
            extension_settings['ds-cache'].extensionsMenu = [
                {
                    label: '重置DS缓存前缀',
                    action: () => performReset(),
                }
            ];
        }

        updateStatsUI();
    } catch (e) {
        Logger.error('UI初始化失败', e);
    }
}

function registerMenuItems() {
    if (typeof extension_settings !== 'undefined') {
        extension_settings['ds-cache'] = extension_settings['ds-cache'] || {};
        extension_settings['ds-cache'].extensionsMenu = extension_settings['ds-cache'].extensionsMenu || [];
        if (!extension_settings['ds-cache'].extensionsMenu.find(m => m.label === '重置DS缓存前缀')) {
            extension_settings['ds-cache'].extensionsMenu.push({
                label: '重置DS缓存前缀',
                action: () => performReset(),
            });
        }
    }
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
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v6.4 就绪，强制阻塞确认，保证发送前干预 ══════', LogLevels.BASIC);
});
