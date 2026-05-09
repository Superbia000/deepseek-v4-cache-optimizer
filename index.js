import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志系统 (增强版)
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
// 状态机 v6.4 - 改用线性前缀
// ==========================================
const CacheState = {
    enabled: true,
    prefix: null,              // 完整的提示词前缀序列 [{role, content}, ...]
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
};

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
        const stream = data.chat;  // 当前完整的消息数组

        // 初始化：直接用当前流作为前缀
        if (!CacheState.prefix) {
            CacheState.prefix = stream.map(m => ({ role: m.role, content: m.content }));
            Logger.log(`[初始化] 前缀长度: ${CacheState.prefix.length}`, LogLevels.BASIC);
            updateStats(true);
            return;
        }

        // 计算共同前缀长度
        const maxMatch = Math.min(CacheState.prefix.length, stream.length);
        let matchLen = 0;
        while (matchLen < maxMatch &&
               CacheState.prefix[matchLen].role === stream[matchLen].role &&
               CacheState.prefix[matchLen].content === stream[matchLen].content) {
            matchLen++;
        }
        Logger.log(`[匹配长度] ${matchLen} / ${CacheState.prefix.length} 条`, LogLevels.DEBUG);

        // 检测前缀是否被破坏
        if (matchLen < CacheState.prefix.length) {
            const shouldReset = confirm(
                '检测到提示词前缀变动（更换角色卡/预设、世界书变更等），缓存前缀已被破坏。\n\n' +
                '按「确定」重置前缀并发送消息；按「取消」放弃本次发送。'
            );
            if (!shouldReset) {
                if (typeof toastr !== 'undefined') toastr.warning('发送已取消');
                throw new Error('User cancelled send due to prefix mismatch');
            }
            Logger.warn('[用户选择重置] 因前缀破坏，重置并重建', LogLevels.BASIC);
            performReset();
            // 重建前缀：用当前完整的 stream
            CacheState.prefix = stream.map(m => ({ role: m.role, content: m.content }));
            Logger.log(`[重置后重建] 前缀长度: ${CacheState.prefix.length}`, LogLevels.BASIC);
            updateStats(true);
            return;
        }

        // 前缀完全匹配，取出新消息（共同前缀之后的部分）
        const newMessages = stream.slice(matchLen);
        if (newMessages.length > 0) {
            Logger.warn(`[新增消息] +${newMessages.length} 条`, LogLevels.DETAILED);
            CacheState.prefix.push(...newMessages.map(m => ({ role: m.role, content: m.content })));
        }

        // 用更新后的前缀覆盖 stream（保持原始顺序）
        stream.splice(0, stream.length, ...CacheState.prefix);

        if (logLevel >= LogLevels.DEBUG) {
            Logger.log(`[最终序列] 前缀长度: ${CacheState.prefix.length}`, LogLevels.DEBUG);
            CacheState.prefix.forEach((m, i) => {
                Logger.log(`  ${i}: [${m.role}] ${m.content.substring(0, 40)}...`, LogLevels.DEBUG);
            });
        }

        updateStats(false);
    } catch (err) {
        Logger.error('拦截器致命错误', err);
        throw err; // 中断生成
    }
}

function updateStats(isInit = false) {
    const tokens = CacheState.prefix?.reduce((acc, m) => acc + Logger.estimateTokens(m.content), 0) ?? 0;
    CacheState.stats.prefixTokens = tokens;
    CacheState.stats.hits++;
    CacheState.stats.savedTokens += tokens;
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
    CacheState.prefix = null;
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
                <p style="font-size:0.9em;opacity:0.8;">线性前缀强匹配，完全锁定提示词顺序，100%缓存命中。</p>
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
    Logger.log('══════ v6.4 就绪，线性前缀强匹配，锁定顺序 ══════', LogLevels.BASIC);
});
