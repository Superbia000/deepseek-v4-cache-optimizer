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
    if (type === 'warn') {
        console.warn(`%c[DS Cache v8] 🌪️ ${msg}`, 'color: #ffaa00;');
    } else if (type === 'error') {
        console.error(`[DS Cache v8] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS Cache v8] ✅ ${msg}`, 'color: #00ff00;');
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
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
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
    normalizeForFingerprint: (text) => {
        return text
            .replace(/\s+/g, ' ')
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, "'")
            .replace(/[，。！？、；：]/g, (m) => ({'，':',','。':'.','！':'!','？':'?','、':',','；':';','：':':'})[m] || m)
            .trim();
    }
};

// ==========================================
// 缓存状态 v8
// ==========================================
const CacheState = {
    enabled: true,
    frozenPrefix: null,      // 冻结前缀数组 [{ role, content, uid, isInstructional }]
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
    pendingReset: false      // 弹窗状态
};

// ==========================================
// 精确分类函数
// ==========================================
function classifyMessage(content, role, originalChat, usedIndices) {
    // 在原始chat中查找匹配的消息（按顺序，避免重复匹配）
    for (let i = 0; i < originalChat.length; i++) {
        if (usedIndices.has(i)) continue;
        const orig = originalChat[i];
        if (orig.mes === content && orig.role === role) {
            usedIndices.add(i);
            if (orig.is_user) return { isInstructional: false, isRealUser: true, isRealAI: false, type: 'user_input' };
            if (orig.is_system) return { isInstructional: true, isRealUser: false, isRealAI: false, type: 'system_prompt' };
            if (orig.extra && orig.extra.world_entry) return { isInstructional: true, type: 'world_entry' };
            if (role === 'assistant') return { isInstructional: false, isRealUser: false, isRealAI: true, type: 'ai_response' };
            // 其他情况视为注入提示词
            return { isInstructional: true, type: 'injected_prompt' };
        }
    }
    // 未匹配到，根据角色保守分类
    if (role === 'system') return { isInstructional: true, type: 'system_prompt' };
    if (role === 'user') return { isInstructional: true, type: 'injected_user' }; // 可能是隐藏提示词
    return { isInstructional: true, type: 'injected_assistant' };
}

// ==========================================
// 核心重组逻辑
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        const stream = data.chat;
        if (!stream || stream.length === 0) return;

        const context = getContext();
        const originalChat = context?.chat ?? [];
        const usedIndices = new Set();

        // --- 1. 解析当前消息数组 ---
        // 确定预填充：尾部连续的 assistant 消息
        let prefillStart = stream.length;
        while (prefillStart > 0 && stream[prefillStart - 1].role === 'assistant') {
            prefillStart--;
        }

        const messages = [];
        let currentUserInput = null;

        for (let i = 0; i < stream.length; i++) {
            const msg = stream[i];
            const isPrefill = (i >= prefillStart && msg.role === 'assistant');
            const classification = classifyMessage(msg.content, msg.role, originalChat, usedIndices);

            const item = {
                role: msg.role,
                content: msg.content,
                isPrefill,
                uid: `${msg.role}:${Logger.simpleHash(Logger.normalizeForFingerprint(msg.content))}`,
                isInstructional: classification.isInstructional,
                isRealUser: classification.isRealUser || false,
                isRealAI: classification.isRealAI || false,
                type: classification.type
            };

            messages.push(item);

            // 当前用户输入：最后一个非预填充、role=user 且 isRealUser 为真
            if (!isPrefill && item.role === 'user' && item.isRealUser) {
                currentUserInput = item;
            }
        }

        // 构建候选前缀（非预填充、非当前用户输入的所有消息，保持原顺序）
        const candidates = messages.filter(m => !m.isPrefill && m !== currentUserInput);

        // --- 2. 变动检测（弹窗） ---
        if (CacheState.frozenPrefix) {
            // 2.1 检查系统提示词是否变化（更换预设/角色卡）
            const currentSystemUIDs = candidates
                .filter(m => m.role === 'system' && m.isInstructional)
                .map(m => m.uid)
                .sort()
                .join(',');
            const frozenSystemUIDs = CacheState.frozenPrefix
                .filter(m => m.role === 'system' && m.isInstructional)
                .map(m => m.uid)
                .sort()
                .join(',');
            if (currentSystemUIDs !== frozenSystemUIDs) {
                Logger.warn('[变动检测] 系统提示词已更改，可能更换了预设或角色卡。', LogLevels.BASIC);
                triggerResetDialog('检测到核心提示词变化（如更换角色卡或预设）。\n建议重置缓存前缀以保证最佳缓存命中。');
                return;
            }

            // 2.2 检查是否大幅删减（前缀长度明显缩短）
            const frozenTokens = CacheState.frozenPrefix.reduce((sum, m) => sum + Logger.estimateTokens(m.content), 0);
            const candTokens = candidates.reduce((sum, m) => sum + Logger.estimateTokens(m.content), 0);
            if (frozenTokens > 0 && candTokens / frozenTokens < 0.7) {
                Logger.warn(`[变动检测] 前缀长度大幅缩短 (${candTokens}t vs ${frozenTokens}t)`, LogLevels.BASIC);
                triggerResetDialog('检测到对话历史被大幅删减，缓存前缀将被破坏。\n建议重置以恢复最佳性能。');
                return;
            }
        }

        // --- 3. 构建或更新冻结前缀 ---
        if (!CacheState.frozenPrefix) {
            // 首次初始化：构建冻结前缀
            const newPrefix = [];
            const seenPromptNorm = new Set(); // 用于提示词去重
            for (const cand of candidates) {
                if (cand.isInstructional) {
                    const norm = Logger.normalizeForFingerprint(cand.content);
                    if (seenPromptNorm.has(norm)) {
                        Logger.log(`[去重] 忽略重复提示词: ${cand.content.substring(0, 50)}...`, LogLevels.DEBUG);
                        continue;
                    }
                    seenPromptNorm.add(norm);
                }
                // 历史对话（用户输入/AI回复）直接加入，不去重
                newPrefix.push({ role: cand.role, content: cand.content, uid: cand.uid, isInstructional: cand.isInstructional });
            }
            CacheState.frozenPrefix = newPrefix;
            Logger.log(`[初始化] 冻结前缀已建立，共 ${newPrefix.length} 条消息。`, LogLevels.BASIC);
        } else {
            // 常规运行：找出新增条目并追加，同时处理提示词去重
            const existingUIDs = new Set(CacheState.frozenPrefix.map(m => m.uid));
            const seenPromptNorm = new Set(
                CacheState.frozenPrefix.filter(m => m.isInstructional).map(m => Logger.normalizeForFingerprint(m.content))
            );

            for (const cand of candidates) {
                if (existingUIDs.has(cand.uid)) continue; // 已存在于前缀中

                if (cand.isInstructional) {
                    const norm = Logger.normalizeForFingerprint(cand.content);
                    if (seenPromptNorm.has(norm)) {
                        Logger.log(`[去重] 忽略重复提示词: ${cand.content.substring(0, 50)}...`, LogLevels.DEBUG);
                        continue;
                    }
                    seenPromptNorm.add(norm);
                }

                // 追加到冻结前缀末尾
                CacheState.frozenPrefix.push({
                    role: cand.role,
                    content: cand.content,
                    uid: cand.uid,
                    isInstructional: cand.isInstructional
                });
                Logger.log(`[新增消息] + ${cand.role} (${cand.type}): ${cand.content.substring(0, 50)}...`, LogLevels.DEBUG);
            }
        }

        // --- 4. 组装最终发送序列：冻结前缀 + 当前用户输入 + 预填充 ---
        const finalMessages = CacheState.frozenPrefix.map(m => ({ role: m.role, content: m.content }));
        if (currentUserInput) {
            finalMessages.push({ role: currentUserInput.role, content: currentUserInput.content });
        }
        const prefills = messages.filter(m => m.isPrefill);
        prefills.forEach(p => finalMessages.push({ role: p.role, content: p.content }));

        // 应用回 data.chat
        stream.splice(0, stream.length);
        finalMessages.forEach(m => stream.push({ role: m.role, content: m.content }));

        // --- 5. 更新统计 ---
        const prefixTokens = finalMessages.reduce((sum, m) => sum + Logger.estimateTokens(m.content), 0);
        CacheState.stats.hits++;       // 有前缀均视为命中
        CacheState.stats.savedTokens += prefixTokens;
        CacheState.stats.prefixTokens = prefixTokens;

        updateStatsUI();

        if (logLevel >= LogLevels.DEBUG) {
            Logger.log(`[最终序列] 前缀${CacheState.frozenPrefix.length}条 + 用户输入 + 预填充${prefills.length}条`, LogLevels.DEBUG);
        }

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

// ==========================================
// 弹窗逻辑（永久存在，用户必须手动处理）
// ==========================================
function triggerResetDialog(message) {
    if (CacheState.pendingReset) return;
    CacheState.pendingReset = true;

    const dialog = document.getElementById('ds-reset-dialog');
    if (!dialog) {
        // 降级为 confirm
        if (confirm(message + '\n\n按“确定”重置，按“取消”保持当前状态。')) {
            performReset();
        } else {
            CacheState.pendingReset = false;
        }
        return;
    }
    document.getElementById('ds-reset-dialog-text').textContent = message;
    dialog.style.display = 'flex';
}

function hideResetDialog() {
    const dialog = document.getElementById('ds-reset-dialog');
    if (dialog) dialog.style.display = 'none';
}

function performReset() {
    CacheState.frozenPrefix = null;
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    CacheState.pendingReset = false;
    hideResetDialog();
    updateStatsUI();
    Logger.warn('[用户操作] 已重置缓存前缀，将在下次请求时重新锁定。', LogLevels.BASIC);
}

// ==========================================
// UI 界面
// ==========================================
function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `
        <span>命中: ${hits}/${total} (${rate}%)</span>
        <span style="margin-left:10px;">前缀 ~${prefixTokens.toLocaleString()}t</span>
        <span style="margin-left:10px;">已节省 ~${savedTokens.toLocaleString()}t</span>
    `;
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DS Cache Optimizer v8.0 (严格锁定 + 增量追加)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">100% 遵循对话结构：提示词去重 → 历史对话按序冻结 → 动态追加新增条目。自动检测变动并弹窗确认。</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;"></div>
                <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" id="ds-cache-enable" checked> 启用缓存优化
                </label>
                <div style="display:flex;align-items:center;gap:8px;margin:8px 0;">
                    <span style="font-size:0.9em;">日志等级:</span>
                    <select id="ds-cache-loglevel" style="flex:1;">
                        <option value="0">关闭</option>
                        <option value="1">简要</option>
                        <option value="2" selected>详细</option>
                        <option value="3">调试</option>
                    </select>
                </div>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置缓存前缀</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>

        <!-- 自定义重置弹窗 -->
        <div id="ds-reset-dialog" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; align-items:center; justify-content:center;">
            <div style="background:#2b2b2b; padding:20px; border-radius:8px; max-width:500px; box-shadow:0 0 20px black;">
                <h3 style="margin-top:0;">⚡ 缓存优化器提醒</h3>
                <p id="ds-reset-dialog-text" style="margin:16px 0;"></p>
                <div style="display:flex; justify-content:flex-end; gap:8px;">
                    <button id="ds-reset-cancel" class="menu_button" style="background:#444;">取消 (保持当前)</button>
                    <button id="ds-reset-confirm" class="menu_button" style="background:#c0392b; color:white;">重置缓存前缀</button>
                </div>
            </div>
        </div>`;

        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');

        // 事件绑定
        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`插件状态: ${CacheState.enabled ? '启用' : '停用'}`, LogLevels.BASIC);
        });
        $('#ds-cache-loglevel').on('change', function() {
            logLevel = parseInt($(this).val());
            Logger.log(`日志等级: ${['关闭','简要','详细','调试'][logLevel]}`, LogLevels.BASIC);
        });
        $('#ds-cache-reset').on('click', performReset);
        $('#ds-reset-cancel').on('click', () => {
            CacheState.pendingReset = false;
            hideResetDialog();
            Logger.warn('[用户操作] 选择不重置，继续使用当前前缀（可能缓存不命中）。', LogLevels.BASIC);
        });
        $('#ds-reset-confirm').on('click', performReset);

        updateStatsUI();
    } catch (e) {
        Logger.error('UI初始化失败', e);
    }
}

// ==========================================
// 启动
// ==========================================
jQuery(async () => {
    console.log('DS Cache Optimizer v8 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 已挂载事件钩子。', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载关键事件钩子，扩展无法运行。');
    }
    Logger.log('══════ v8.0 就绪 · 严格按结构重组 · 完美适配 DeepSeek 缓存 ══════', LogLevels.BASIC);
});
