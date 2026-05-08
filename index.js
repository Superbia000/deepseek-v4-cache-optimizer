import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志等级 & 基础日志函数
// ==========================================
let logLevel = 2; // 0:silent, 1:basic, 2:detailed, 3:debug
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3 };

function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    const prefix = `[${time}]`;
    const fullMsg = `${prefix} ${msg}`;
    if (type === 'warn') {
        console.warn(`%c[DS V4 Opt v5] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS V4 Opt v5] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS V4 Opt v5] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
};

// ==========================================
// 简单 token 估算
// ==========================================
function estimateTokens(text) {
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
}

function estimateTokensForMessages(messages) {
    return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

// ==========================================
// 消息去重（相同角色 + 相同内容只保留第一次出现）
// ==========================================
function deduplicateMessages(messages) {
    const seen = new Set();
    const result = [];
    for (const msg of messages) {
        const key = msg.role + '::' + msg.content;
        if (!seen.has(key)) {
            seen.add(key);
            result.push(msg);
        }
    }
    return result;
}

// ==========================================
// 数组前缀比较
// ==========================================
function arraysEqual(a, b, length) {
    if (a.length < length || b.length < length) return false;
    for (let i = 0; i < length; i++) {
        if (a[i].role !== b[i].role || a[i].content !== b[i].content) return false;
    }
    return true;
}

// ==========================================
// 缓存状态机 (v5 - 恒定前缀策略)
// ==========================================
const CacheState = {
    enabled: true,
    baseline: null,         // 上一轮完整 prompt 数组（去重后）
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 }
};

// ==========================================
// 核心拦截重组 —— 保证前缀恒定不变
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`拦截器 #${CacheState.stats.total}`);

        if (!data?.chat?.length) return;

        // 1. 去重：相同角色+内容只出现一次，顺序不变
        let chat = deduplicateMessages(data.chat);

        // 2. 若无基线，建立基线（首次或重置后）
        if (!CacheState.baseline) {
            CacheState.baseline = chat.map(m => ({ role: m.role, content: m.content }));
            const prefixTokens = estimateTokensForMessages(chat);
            CacheState.stats.prefixTokens = prefixTokens;
            data.chat = chat;
            Logger.log(`基线建立，消息数: ${chat.length}，前缀 tokens: ~${prefixTokens}`, LogLevels.BASIC);
            if (typeof toastr !== 'undefined') {
                toastr.info('Prompt baseline established. New cache context started.');
            }
            updateStatsUI();
            return;
        }

        // 3. 检查当前 prompt 的前缀是否与基线完全一致
        const baselineLen = CacheState.baseline.length;
        if (arraysEqual(chat, CacheState.baseline, baselineLen)) {
            // 缓存命中！前缀完全未变
            CacheState.stats.hits++;
            const prefixTokens = estimateTokensForMessages(CacheState.baseline);
            CacheState.stats.savedTokens += prefixTokens;
            CacheState.stats.prefixTokens = prefixTokens;
            Logger.log(`✅ 缓存命中！前缀 ${baselineLen} 条消息不变 (~${prefixTokens} tokens 省)`, LogLevels.BASIC);

            // 更新基线为当前完整 prompt（为下一轮铺垫）
            CacheState.baseline = chat.map(m => ({ role: m.role, content: m.content }));
        } else {
            // 前缀改变（新增/删除/修改提示词、世界书等）
            Logger.warn(`⚠️ 前缀不匹配，基线重置。旧基线 ${baselineLen} 条，将新建基线。`, LogLevels.BASIC);
            CacheState.baseline = chat.map(m => ({ role: m.role, content: m.content }));
            const prefixTokens = estimateTokensForMessages(chat);
            CacheState.stats.prefixTokens = prefixTokens;
            if (typeof toastr !== 'undefined') {
                toastr.warning('Prompt structure changed (preset/world book modified). Cache baseline reset.');
            }
        }

        // 4. 将去重后的数组回写，确保实际发送的是优化后的序列
        data.chat = chat;
        updateStatsUI();

    } catch (err) {
        Logger.error('拦截器致命错误', err);
    }
}

// ==========================================
// UI 与统计
// ==========================================
function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `
        <span>命中: ${hits}/${total} (${rate}%)</span>
        <span style="margin-left:10px;">前缀: ~${prefixTokens.toLocaleString()}t</span>
        <span style="margin-left:10px;">共省: ~${savedTokens.toLocaleString()}t</span>
    `;
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>DS V4 Cache Optimizer v5</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">恒定前缀策略：保持提示词/世界书顺序不变，自动检测变更并重置基线。</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;"></div>
                <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" id="ds-cache-enable" checked> 启用拦截器
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
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置缓存基线</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._uiTextarea = document.getElementById('ds-cache-log');
        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`状态: ${CacheState.enabled ? '启用' : '停用'}`, LogLevels.BASIC);
        });
        $('#ds-cache-loglevel').on('change', function() {
            logLevel = parseInt($(this).val());
            Logger.log(`日志等级设为: ${['关闭','简要','详细','调试'][logLevel]}`, LogLevels.BASIC);
        });
        $('#ds-cache-reset').on('click', () => {
            CacheState.baseline = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateStatsUI();
            Logger.warn('已手动重置缓存基线', LogLevels.BASIC);
        });
        updateStatsUI();
    } catch (e) {
        Logger.error('UI初始化失败', e);
    }
}

// ==========================================
// 启动
// ==========================================
jQuery(async () => {
    console.log('DS V5 Cache Optimizer loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('已挂载事件钩子', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v5.0 就绪，恒定前缀 + 自动重置 ══════', LogLevels.BASIC);
});
