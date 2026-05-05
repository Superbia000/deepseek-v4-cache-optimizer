import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 日志与等级控制
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
    const ta = document.getElementById('ds-cache-log');
    if (ta) {
        ta.value += fullMsg + '\n';
        ta.scrollTop = ta.scrollHeight;
    }
}

const Logger = {
    log: (msg, level = LogLevels.DETAILED) => logAt(level, 'log', msg),
    warn: (msg, level = LogLevels.BASIC) => logAt(level, 'warn', msg),
    error: (msg, err, level = LogLevels.BASIC) => logAt(level, 'error', err ? `${msg} ${err}` : msg),
};

// ==========================================
// 消息比对工具
// ==========================================
function messagesEqual(a, b) {
    if (a.role !== b.role) return false;
    // 内容标准化比对，忽略末尾空格差异
    return (a.content || '').trim() === (b.content || '').trim();
}

// 找出 curr 中所有不在 prev 中的条目（新增条目），保持 curr 中的顺序
function extractNewItems(prev, curr) {
    const used = new Array(prev.length).fill(false);
    const newItems = [];
    // 遍历 curr，用贪心匹配跳过 prev 中已匹配的条目
    let pi = 0;
    for (let ci = 0; ci < curr.length; ci++) {
        if (pi < prev.length && messagesEqual(prev[pi], curr[ci])) {
            pi++; // 匹配成功，继续
        } else {
            // 尝试在剩余的 prev 中寻找匹配（允许 prev 中有被删除的条目造成的不匹配）
            let found = false;
            for (let pj = pi; pj < prev.length; pj++) {
                if (!used[pj] && messagesEqual(prev[pj], curr[ci])) {
                    // 匹配到一个晚出现的 prev 条目，说明中间有删除
                    // 标记已用，但当前 ci 不是新增，而是旧条目位置偏移
                    used[pj] = true;
                    found = true;
                    // 需要调整 pi？不调整全局 pi，复杂。
                    break;
                }
            }
            if (!found) {
                newItems.push(curr[ci]); // 确实未在 prev 中出现过
            }
        }
    }
    return newItems;
}

// 判断 curr 是否是 prev 的超集（prev 所有条目在 curr 中按相同顺序出现，且无修改）
// 返回 { isSuperset, newItems, cleanCurr }，其中 cleanCurr 是移除 newItems 后的子序列
function checkSuperset(prev, curr) {
    // 将 prev 的条目按顺序在 curr 中匹配，允许 curr 中间插入新条目
    const matches = [];
    let pi = 0;
    for (let ci = 0; ci < curr.length && pi < prev.length; ci++) {
        if (messagesEqual(prev[pi], curr[ci])) {
            matches.push(ci);
            pi++;
        }
    }
    if (pi < prev.length) {
        return { isSuperset: false, newItems: [], cleanCurr: null }; // 不是超集，有缺失
    }
    // 收集不在 matches 中的 curr 条目即为新增条目
    const matchSet = new Set(matches);
    const newItems = curr.filter((_, idx) => !matchSet.has(idx));
    // 从 curr 中移除 newItems 后，应等于 prev（顺序一致）
    const cleanCurr = curr.filter((_, idx) => matchSet.has(idx));
    // 验证 cleanCurr 是否与 prev 完全匹配（可能因内容微小差异而不等）
    if (cleanCurr.length !== prev.length) return { isSuperset: false, newItems: [], cleanCurr: null };
    for (let i = 0; i < prev.length; i++) {
        if (!messagesEqual(prev[i], cleanCurr[i])) {
            return { isSuperset: false, newItems: [], cleanCurr: null };
        }
    }
    return { isSuperset: true, newItems, cleanCurr };
}

// 计算最长公共前缀长度
function longestCommonPrefix(arr1, arr2) {
    let i = 0;
    while (i < arr1.length && i < arr2.length && messagesEqual(arr1[i], arr2[i])) {
        i++;
    }
    return i;
}

// ==========================================
// 状态管理
// ==========================================
const CacheState = {
    enabled: true,
    lastSentMessages: null,         // 上一轮实际发送的消息数组快照
    stats: { total: 0, hits: 0, savedTokens: 0 }
};

function estimateTokens(text) {
    if (!text) return 0;
    let t = 0;
    for (const ch of text) {
        const code = ch.charCodeAt(0);
        if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3040 && code <= 0x30FF) || (code >= 0xAC00 && code <= 0xD7AF)) {
            t += 1;
        } else {
            t += 0.25;
        }
    }
    return Math.ceil(t);
}

function arrayTokens(messages) {
    return messages.reduce((sum, m) => sum + estimateTokens(m.content || ''), 0);
}

// ==========================================
// 核心拦截与重组
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;
    try {
        CacheState.stats.total++;
        Logger.log(`==============================`);
        Logger.log(`拦截器 #${CacheState.stats.total}`);

        if (!data?.chat?.length) return;
        const currMessages = [...data.chat]; // 当前原始数组
        const prev = CacheState.lastSentMessages;

        // 首次或重置后
        if (!prev) {
            // 直接发送原始数组，作为基准
            CacheState.lastSentMessages = currMessages.map(m => ({ role: m.role, content: m.content }));
            const tokens = arrayTokens(currMessages);
            CacheState.stats.savedTokens += tokens; // 首次无法命中，但计入前缀建立
            Logger.log(`首次建立基准消息序列，共 ${currMessages.length} 条，~${tokens} tokens`, LogLevels.BASIC);
            if (logLevel >= LogLevels.DEBUG) {
                Logger.log(`序列结构: ${currMessages.map(m => `${m.role}(${m.content.length})`).join(' → ')}`, LogLevels.DEBUG);
            }
            updateStatsUI();
            return; // data.chat 保持不变
        }

        // 超集检测（仅新增，无删除/修改）
        const { isSuperset, newItems, cleanCurr } = checkSuperset(prev, currMessages);
        if (isSuperset) {
            // 完美复用前缀，新条目追加到末尾（历史最后，新用户输入之前）
            // 注意：我们需要保持 prev 的顺序不变，然后将新条目按原来相对顺序放在 prev 之后
            const finalMessages = [...prev, ...newItems];
            data.chat.splice(0, data.chat.length, ...finalMessages);
            CacheState.stats.hits++;
            const saved = arrayTokens(prev);
            CacheState.stats.savedTokens += saved;
            Logger.log(`✅ 仅新增 ${newItems.length} 条内容，前缀完全复用！缓存命中，节省 ~${saved} tokens`, LogLevels.BASIC);
            if (logLevel >= LogLevels.DEBUG) {
                Logger.log(`新增条目: ${newItems.map(m => `${m.role}(${m.content.length})`).join(', ')}`, LogLevels.DEBUG);
            }
            // 更新快照：当前发送的序列
            CacheState.lastSentMessages = finalMessages.map(m => ({ role: m.role, content: m.content }));
            updateStatsUI();
            return;
        }

        // 降级处理：计算最长公共前缀，并检测是否发生剧变
        const lcpLen = longestCommonPrefix(prev, currMessages);
        const prevTotal = prev.length;
        const changeRatio = (prevTotal - lcpLen) / prevTotal;
        
        Logger.warn(`前缀发生变动：仅前 ${lcpLen}/${prevTotal} 条未变 (变化比例 ${(changeRatio*100).toFixed(1)}%)`, LogLevels.BASIC);
        
        // 如果变化比例很大（比如超过 70% 的条目消失或变化），判定为角色卡/预设大范围替换
        if (changeRatio > 0.7 && prevTotal > 5) {
            // 弹窗提醒用户（若在浏览器环境下）
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                // 使用 toastr 或 alert
                if (typeof toastr !== 'undefined') {
                    toastr.warning('检测到提示词结构发生巨大变化（可能更换了角色或大量删改），建议重置缓存优化器状态以获得最佳缓存效果。', '缓存优化器', { timeOut: 10000 });
                } else {
                    alert('提示词结构剧变，请考虑手动重置缓存优化器。');
                }
            }
            Logger.warn('⚠️ 系统检测到提示词大幅变动，建议重置插件状态。', LogLevels.BASIC);
        }

        // 构建降级数组：公共前缀 + 剩余部分
        const lcp = currMessages.slice(0, lcpLen);
        const rest = currMessages.slice(lcpLen);
        const finalMessages = [...lcp, ...rest];
        data.chat.splice(0, data.chat.length, ...finalMessages);
        
        // 缓存部分命中（前缀部分可命中）
        const cachedTokens = arrayTokens(lcp);
        CacheState.stats.savedTokens += cachedTokens;
        if (lcpLen > 0) {
            // 如果前缀长度大于0，可视为部分命中，但为了统计命中请求，我们仍认为本轮未完全命中，但节省了前缀token
            Logger.log(`⚠️ 部分命中：前缀 ${lcpLen} 条 (~${cachedTokens} tokens) 复用，其余需重新计算`, LogLevels.BASIC);
        }
        // 更新快照为本次发送的序列
        CacheState.lastSentMessages = finalMessages.map(m => ({ role: m.role, content: m.content }));
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
    const { total, hits, savedTokens } = CacheState.stats;
    const rate = total ? ((hits / total) * 100).toFixed(1) : '0.0';
    el.innerHTML = `
        <span>命中: ${hits}/${total} (${rate}%)</span>
        <span style="margin-left:10px;">共省: ~${savedTokens.toLocaleString()}t</span>
    `;
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DS V4 Cache Optimizer v5.0</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">智能消息数组比对，新增自动追加，变动最大限度保留（弹窗提醒剧变）。</p>
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
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:10px 0;">🔄 强制重置静态核心</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`状态: ${CacheState.enabled ? '启用' : '停用'}`, LogLevels.BASIC);
        });
        $('#ds-cache-loglevel').on('change', function() {
            logLevel = parseInt($(this).val());
            Logger.log(`日志等级设为: ${['关闭','简要','详细','调试'][logLevel]}`, LogLevels.BASIC);
        });
        $('#ds-cache-reset').on('click', () => {
            CacheState.lastSentMessages = null;
            CacheState.stats = { total: 0, hits: 0, savedTokens: 0 };
            updateStatsUI();
            Logger.warn('已重置，下一轮将重新建立基准序列。', LogLevels.BASIC);
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
    console.log('DS V4 Optimizer v5 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('已挂载事件钩子', LogLevels.BASIC);
    } else {
        Logger.error('无法挂载事件钩子');
    }
    Logger.log('══════ v5.0 就绪：智能数组比对，新增追加，最大命中率 ══════', LogLevels.BASIC);
});
