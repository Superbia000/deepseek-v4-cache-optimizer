// file: index.js
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
        console.warn(`%c[DS V4 Opt v4] 🌪️ ${msg}`, 'color: #ffaa00; font-weight: bold;');
    } else if (type === 'error') {
        console.error(`[DS V4 Opt v4] 🔴 ${msg}`);
    } else {
        console.log(`%c[DS V4 Opt v4] ✅ ${msg}`, 'color: #00ff00; font-weight: bold;');
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
// 工具函数：归一化、指纹、token 估算
// ==========================================
function normalizeForFingerprint(text) {
    return (text || '')
        .replace(/\s+/g, ' ')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/[，。！？、；：]/g, (m) => ({'，':',','。':'.','！':'!','？':'?','、':',','；':';','：':':'})[m] || m)
        .trim();
}

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}

function getMessageFingerprint(msg) {
    if (!msg || !msg.content) return 'EMPTY';
    return simpleHash(normalizeForFingerprint(msg.content));
}

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

// ==========================================
// 缓存状态机（新设计）
// ==========================================
const CacheState = {
    enabled: true,
    // 冻结的系统消息（保持独立，不合并）
    staticSystemMessages: [],        // 存储 { role:'system', content } 的对象数组
    staticSystemFingerprints: [],   // 对应内容的指纹
    // 冻结的非系统消息（user/assistant 对话历史，不含预填充）
    frozenNonSystem: [],            // 消息对象数组
    frozenNonSystemFingerprints: [],// 对应内容的指纹
    // 统计
    stats: { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 },
    // 上一轮的前缀token数，用于统计节省量
    lastPrefixTokens: 0,
};

// ==========================================
// 核心拦截重组（严格追加，永不合并提示词）
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;

    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`拦截器 #${CacheState.stats.total}`);

        if (!data?.chat?.length) return;

        // 1. 提取 system 和非 system 消息
        const systems = [];
        const nonSystems = [];
        for (const msg of data.chat) {
            if (msg.role === 'system') {
                systems.push({ role: 'system', content: msg.content }); // 浅拷贝用到的字段
            } else if (msg.role === 'user' || msg.role === 'assistant') {
                nonSystems.push({ role: msg.role, content: msg.content });
            } else {
                // 其他角色（如 tool）保持原样附加到 nonSystems 末尾（理论上不会出现）
                nonSystems.push({ role: msg.role, content: msg.content });
            }
        }

        // 2. 初始化或重置分支
        const isFirstRun = CacheState.staticSystemMessages.length === 0;
        if (isFirstRun) {
            // 首次：冻结所有系统消息，冻结非系统历史设为空（第一轮无历史）
            CacheState.staticSystemMessages = systems.map(s => ({ role: s.role, content: s.content }));
            CacheState.staticSystemFingerprints = systems.map(s => getMessageFingerprint(s));
            CacheState.frozenNonSystem = [];
            CacheState.frozenNonSystemFingerprints = [];

            const finalChat = [...CacheState.staticSystemMessages, ...nonSystems];
            data.chat.splice(0, data.chat.length, ...finalChat);

            const prefixTokens = estimateTokens(finalChat.map(m => m.content).join(''));
            CacheState.lastPrefixTokens = prefixTokens;
            CacheState.stats.prefixTokens = prefixTokens;
            CacheState.stats.hits++;
            CacheState.stats.savedTokens += prefixTokens;

            Logger.log(`✅ 初始化完成。冻结系统消息 ${CacheState.staticSystemMessages.length} 条`, LogLevels.BASIC);
            return;
        }

        // 3. 检查系统前缀
        let systemsMatch = true;
        if (systems.length < CacheState.staticSystemMessages.length) {
            systemsMatch = false;
        } else {
            for (let i = 0; i < CacheState.staticSystemMessages.length; i++) {
                const fp = getMessageFingerprint(systems[i]);
                if (fp !== CacheState.staticSystemFingerprints[i]) {
                    systemsMatch = false;
                    break;
                }
            }
        }

        // 4. 检查非系统历史前缀
        let nonSystemsMatch = true;
        if (nonSystems.length < CacheState.frozenNonSystem.length) {
            nonSystemsMatch = false;
        } else {
            for (let i = 0; i < CacheState.frozenNonSystem.length; i++) {
                const fp = getMessageFingerprint(nonSystems[i]);
                if (fp !== CacheState.frozenNonSystemFingerprints[i]) {
                    nonSystemsMatch = false;
                    break;
                }
            }
        }

        // 5. 若任一部分不匹配，触发重置
        if (!systemsMatch || !nonSystemsMatch) {
            Logger.warn(`⚠️ 检测到冻结前缀被修改（系统匹配:${systemsMatch}, 历史匹配:${nonSystemsMatch}），重置所有缓存并弹窗提醒`, LogLevels.BASIC);
            // 弹窗提醒
            if (typeof toastr !== 'undefined') {
                toastr.warning('对话前缀已被修改/删减，缓存优化器已自动重置以保护一致性。');
            }
            // 重置状态
            CacheState.staticSystemMessages = [];
            CacheState.staticSystemFingerprints = [];
            CacheState.frozenNonSystem = [];
            CacheState.frozenNonSystemFingerprints = [];
            CacheState.lastPrefixTokens = 0;
            // 递归调用，用当前数据重新初始化
            interceptAndRestructurePrompt(data);
            return;
        }

        // 6. 提取新增部分
        const newSystems = systems.slice(CacheState.staticSystemMessages.length);
        const tailNonSystems = nonSystems.slice(CacheState.frozenNonSystem.length);

        // 7. 处理尾部：分离用户输入与预填充 assistant
        const stableTail = [];          // 可冻结的尾部消息（用户输入）
        let prefillAssistant = null;   // 预填充消息
        let lastUserIdx = -1;
        for (let i = 0; i < tailNonSystems.length; i++) {
            if (tailNonSystems[i].role === 'user') {
                lastUserIdx = i;
                stableTail.push({ role: 'user', content: tailNonSystems[i].content });
            } else {
                // 非 user 消息暂存
            }
        }
        // 如果最后一条是 assistant 且处在最后位置，视为预填充
        if (tailNonSystems.length > 0 && tailNonSystems[tailNonSystems.length - 1].role === 'assistant') {
            // 且除了这条 assistant 外没有其他 user（即 stableTail 只有刚刚加入的 user 消息）
            if (lastUserIdx !== -1 && lastUserIdx === tailNonSystems.length - 2) {
                prefillAssistant = { role: 'assistant', content: tailNonSystems[tailNonSystems.length - 1].content };
            } else {
                // 如果 assistant 前没有 user，或者还有其他情况，安全起见不加预填充
                prefillAssistant = null;
            }
        }

        // 8. 去重新增系统提示词（与 frozen 系统消息比较）
        const dedupedNewSystems = [];
        const staticFingerprints = new Set(CacheState.staticSystemFingerprints);
        for (const sys of newSystems) {
            const fp = getMessageFingerprint(sys);
            if (!staticFingerprints.has(fp)) {
                dedupedNewSystems.push(sys);
                // 同时加入指纹集合，避免自身内部重复
                staticFingerprints.add(fp);
            } else {
                Logger.log(`跳过重复系统提示词: ${(sys.content || '').slice(0, 30)}...`, LogLevels.DEBUG);
            }
        }

        // 9. 组装最终消息：系统冻结 + 历史冻结 + 新增系统（放在历史之后、用户之前） + stableTail + 预填充
        const finalChat = [
            ...CacheState.staticSystemMessages,
            ...CacheState.frozenNonSystem,
            ...dedupedNewSystems,
            ...stableTail,
        ];
        if (prefillAssistant) {
            finalChat.push(prefillAssistant);
        }

        // 10. 更新冻结状态（为下一轮准备）
        // 固定非系统历史 = 旧历史 + 新的用户输入（stableTail），但不包含预填充
        CacheState.frozenNonSystem = [
            ...CacheState.frozenNonSystem,
            ...stableTail,
        ];
        CacheState.frozenNonSystemFingerprints = CacheState.frozenNonSystem.map(m => getMessageFingerprint(m));

        // 系统部分不变（新增的提示词不会冻结到 staticSystem 中，因为它们属于“本轮新增”，以后也不会变为前缀）
        // 这保证了下一轮系统前缀仍然只是最初的锁定部分，新增提示词继续被检测

        // 11. 统计
        const currentPrefixTokens = estimateTokens(
            [...CacheState.staticSystemMessages, ...CacheState.frozenNonSystem].map(m => m.content).join('')
        );
        const newTokens = estimateTokens(finalChat.map(m => m.content).join('')) - currentPrefixTokens;
        CacheState.stats.hits++;
        CacheState.stats.savedTokens += currentPrefixTokens; // 本次节省的重复计算量
        CacheState.stats.prefixTokens = currentPrefixTokens;
        CacheState.lastPrefixTokens = currentPrefixTokens;

        Logger.log(`✅ 重组完成。前缀 token: ~${currentPrefixTokens}，新增 token: ~${newTokens}`, LogLevels.BASIC);
        if (logLevel >= LogLevels.DEBUG) {
            Logger.log(`消息结构: ${finalChat.map(m => `${m.role}(${m.content.length}字)`).join(' → ')}`, LogLevels.DEBUG);
        }

        // 12. 写回 data.chat
        data.chat.splice(0, data.chat.length, ...finalChat);

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
                <b>DS V4 Cache Optimizer</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">严格追加策略：新增提示/世界书自动移到尾部，维持前缀冻结，实现约100%缓存命中。</p>
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
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置（清空所有冻结状态）</button>
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
            CacheState.staticSystemMessages = [];
            CacheState.staticSystemFingerprints = [];
            CacheState.frozenNonSystem = [];
            CacheState.frozenNonSystemFingerprints = [];
            CacheState.lastPrefixTokens = 0;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0, prefixTokens: 0 };
            updateStatsUI();
            Logger.warn('已完全重置所有冻结状态', LogLevels.BASIC);
        });
        updateStatsUI();
        // 定期更新统计（因为 stats 变化可能在回调中）
        setInterval(updateStatsUI, 2000);
    } catch (e) {
        Logger.error('UI初始化失败', e);
    }
}

// ==========================================
// 启动
// ==========================================
jQuery(async () => {
    console.log('DS V4 Optimizer v4.1 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('已挂载事件钩子', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v4.1 就绪，严格追加模式，无需手动重置 ══════', LogLevels.BASIC);
});
