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
        console.warn(`%c[DS V4 Opt v7] 🌪️ ${msg}`, 'color: #ffaa00;');
    } else if (type === 'error') {
        console.error(`[DS V4 Opt v7] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS V4 Opt v7] ✅ ${msg}`, 'color: #00ff00;');
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
// 缓存状态机 v7
// ==========================================
const CacheState = {
    enabled: true,
    pinnedSequence: null,       // 锁定前缀（去重提示词 + 历史真实对话）
    pinnedFingerprint: null,    // 前缀指纹（用于快速变动检测）
    lastBuiltPrefix: null,      // 上次实际发送的前缀指纹
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
    pendingResetDialog: false   // 防止重复弹窗
};

// ==========================================
// 核心：从原始聊天对象精确分类消息类型
// ==========================================
function classifyWithOriginal(msgContent, msgRole, originalChat) {
    // 通过内容精确匹配原始消息
    const matched = originalChat.find(m => m.mes === msgContent);
    if (matched) {
        if (matched.is_user) {
            return { isInstructional: false, isRealUser: true, isRealAI: false, type: 'user_input' };
        }
        if (matched.is_system) {
            return { isInstructional: true, isRealUser: false, isRealAI: false, type: 'system_prompt' };
        }
        // 世界书条目通常带有 extra.world_entry 标记，也视为提示词
        if (matched.extra && matched.extra.world_entry) {
            return { isInstructional: true, isRealUser: false, isRealAI: false, type: 'world_entry' };
        }
        // 剩余的非用户非系统消息：如果是 assistant 角色，则为真实 AI 回复
        if (msgRole === 'assistant') {
            return { isInstructional: false, isRealUser: false, isRealAI: true, type: 'ai_response' };
        }
        // 其他情况（如角色为 user 但非用户输入，可能是注入的提示词）
        return { isInstructional: true, isRealUser: false, isRealAI: false, type: 'injected_prompt' };
    }
    // 未匹配到：根据角色进行保守分类
    if (msgRole === 'system') {
        return { isInstructional: true, isRealUser: false, isRealAI: false, type: 'system_prompt' };
    }
    if (msgRole === 'user') {
        // 无法确定时视为注入的提示词（避免误判为用户输入）
        return { isInstructional: true, isRealUser: false, isRealAI: false, type: 'injected_user' };
    }
    // assistant 但没有匹配，大概率是预填充或未记录的真实回复，先按提示词处理
    return { isInstructional: true, isRealUser: false, isRealAI: false, type: 'unknown_assistant' };
}

// ==========================================
// 主要拦截函数
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`========== 请求 #${CacheState.stats.total} 开始处理 ==========`);

        const stream = data.chat;
        if (!stream || stream.length === 0) return;

        const context = getContext();
        const originalChat = context?.chat ?? [];

        // --- 1. 解析当前消息数组，分离预填充、当前用户输入 ---
        const messages = [];

        // 尾部连续的 assistant 视为预填充
        let prefillStart = stream.length;
        while (prefillStart > 0 && stream[prefillStart - 1].role === 'assistant') {
            prefillStart--;
        }

        let currentUserInput = null;

        for (let i = 0; i < stream.length; i++) {
            const msg = stream[i];
            const isPrefill = (i >= prefillStart && msg.role === 'assistant');
            const classification = classifyWithOriginal(msg.content, msg.role, originalChat);

            const item = {
                role: msg.role,
                content: msg.content,
                isPrefill,
                uid: `${msg.role}:${Logger.simpleHash(Logger.normalizeForFingerprint(msg.content))}`,
                ...classification
            };

            messages.push(item);

            // 标记当前用户输入：最后一个非预填充且 isRealUser 为真的 user 消息
            if (!isPrefill && item.role === 'user' && item.isRealUser) {
                currentUserInput = item;
            }
        }

        // 非预填充且非当前用户输入的部分，构成候选前缀
        const candidateMessages = messages.filter(m => !m.isPrefill && m !== currentUserInput);

        // --- 2. 判断是否触发重置 ---
        // 通过比较当前候选前缀的“系统提示词”哈希与已锁定的系统提示词哈希
        if (CacheState.pinnedSequence) {
            const currentSystemHashes = candidateMessages
                .filter(m => m.role === 'system')
                .map(m => m.uid)
                .sort()
                .join(',');
            const pinnedSystemHashes = CacheState.pinnedSequence
                .filter(m => m.role === 'system')
                .map(m => m.uid)
                .sort()
                .join(',');

            if (currentSystemHashes !== pinnedSystemHashes) {
                Logger.warn('[核心重置] 系统提示词已变更，可能更换了角色卡或预设。', LogLevels.BASIC);
                triggerResetDialog('核心提示词发生变化（如更换角色卡或预设），建议重置缓存前缀以保证最佳性能。');
                return; // 暂停本次处理，等待用户决定
            }
        }

        // --- 3. 构建/更新锁定前缀（去重提示词，保留真实对话）---
        let pinned = CacheState.pinnedSequence ? [...CacheState.pinnedSequence] : [];
        const seenInstructional = new Set(pinned.filter(m => m.isInstructional).map(m => Logger.normalizeForFingerprint(m.content)));

        // 遍历候选消息，按顺序追加新条目（保持原始排序）
        for (const candidate of candidateMessages) {
            if (candidate.isInstructional) {
                const norm = Logger.normalizeForFingerprint(candidate.content);
                if (seenInstructional.has(norm)) {
                    Logger.log(`[去重] 跳过重复提示词: ${candidate.content.substring(0, 50)}...`, LogLevels.DEBUG);
                    continue;
                }
                seenInstructional.add(norm);
                pinned.push(candidate);
                Logger.log(`[新增提示词] + ${candidate.role}: ${candidate.content.substring(0, 50)}...`, LogLevels.DEBUG);
            } else {
                // 真实对话（用户输入或AI回复），不进行去重，直接追加
                pinned.push(candidate);
                Logger.log(`[新增对话] + ${candidate.role}(${candidate.type}): ${candidate.content.substring(0, 50)}...`, LogLevels.DEBUG);
            }
        }

        // 检测大幅删减（对比新旧前缀总 token 数量，如果骤减超过30%则提醒）
        if (CacheState.pinnedSequence) {
            const oldTokens = CacheState.pinnedSequence.reduce((sum, m) => sum + Logger.estimateTokens(m.content), 0);
            const newTokens = pinned.reduce((sum, m) => sum + Logger.estimateTokens(m.content), 0);
            if (oldTokens > 0 && newTokens / oldTokens < 0.7) {
                Logger.warn(`[大幅删减] 前缀 token 从 ${oldTokens} 骤减至 ${newTokens}`, LogLevels.BASIC);
                triggerResetDialog('检测到对话历史被大幅删减，缓存命中率将严重下降。建议重置前缀。');
                return;
            }
        }

        // --- 4. 保存新前缀 ---
        CacheState.pinnedSequence = pinned;
        CacheState.pinnedFingerprint = pinned.map(m => m.uid).join('|');

        // --- 5. 构建最终发送序列：锁定前缀 + 当前用户输入 + 预填充 ---
        const finalMessages = pinned.map(m => ({ role: m.role, content: m.content }));
        if (currentUserInput) {
            finalMessages.push({ role: currentUserInput.role, content: currentUserInput.content });
        }
        const prefills = messages.filter(m => m.isPrefill);
        prefills.forEach(p => finalMessages.push({ role: p.role, content: p.content }));

        // 应用重组（直接修改原数组）
        stream.splice(0, stream.length);
        finalMessages.forEach(m => stream.push({ role: m.role, content: m.content }));

        // --- 6. 更新统计 ---
        const sentFingerprint = finalMessages.map(m => `${m.role}:${Logger.simpleHash(m.content)}`).join('|');
        const cacheHit = (CacheState.lastBuiltPrefix === sentFingerprint);
        CacheState.stats.hits += cacheHit ? 1 : 0;
        const prefixTokens = pinned.reduce((sum, m) => sum + Logger.estimateTokens(m.content), 0);
        CacheState.stats.savedTokens += prefixTokens;
        CacheState.stats.prefixTokens = prefixTokens;
        CacheState.lastBuiltPrefix = sentFingerprint;

        updateStatsUI();

        if (logLevel >= LogLevels.DEBUG) {
            Logger.log(`[最终序列] 前缀${pinned.length}条 + 用户输入 + 预填充${prefills.length}条`, LogLevels.DEBUG);
        }

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

// ==========================================
// 弹窗逻辑
// ==========================================
function triggerResetDialog(message) {
    if (CacheState.pendingResetDialog) return;
    CacheState.pendingResetDialog = true;

    // 如果自定义弹窗不存在，则降级为 confirm
    const dialog = document.getElementById('ds-reset-dialog');
    if (!dialog) {
        if (confirm(message + '\n\n点击“确定”重置，点击“取消”保持不变。')) {
            performReset();
        } else {
            CacheState.pendingResetDialog = false;
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
    CacheState.pinnedSequence = null;
    CacheState.pinnedFingerprint = null;
    CacheState.lastBuiltPrefix = null;
    CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
    CacheState.pendingResetDialog = false;
    hideResetDialog();
    updateStatsUI();
    Logger.warn('[用户操作] 已重置缓存前缀，下次请求将重新锁定。', LogLevels.BASIC);
}

// ==========================================
// UI 与事件绑定
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
                <b>🧠 DS V4 Cache Optimizer v7.0 (准确分类 · 提示词去重)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">严格区分提示词与真实对话，仅去重提示词，动态锁定前缀，自适应检测变动。</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;"></div>
                <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" id="ds-cache-enable" checked> 启用优化
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

        <!-- 自定义重置确认弹窗 -->
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

        // 控件事件
        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`插件状态: ${CacheState.enabled ? '启用' : '停用'}`, LogLevels.BASIC);
        });
        $('#ds-cache-loglevel').on('change', function() {
            logLevel = parseInt($(this).val());
            Logger.log(`日志等级: ${['关闭','简要','详细','调试'][logLevel]}`, LogLevels.BASIC);
        });
        $('#ds-cache-reset').on('click', performReset);

        // 弹窗按钮
        $('#ds-reset-cancel').on('click', () => {
            CacheState.pendingResetDialog = false;
            hideResetDialog();
            Logger.warn('[用户操作] 拒绝重置，继续使用当前前缀（可能导致缓存未命中）。', LogLevels.BASIC);
        });
        $('#ds-reset-confirm').on('click', performReset);

        updateStatsUI();
    } catch (e) {
        Logger.error('UI初始化失败', e);
    }
}

// ==========================================
// 启动入口
// ==========================================
jQuery(async () => {
    console.log('DS V4 Optimizer v7 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 已挂载事件钩子。', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载关键事件钩子，扩展无法运行。');
    }
    Logger.log('══════ v7.0 就绪 · 精准分类 · 提示词严格去重 · 自适应变动检测 ══════', LogLevels.BASIC);
});
