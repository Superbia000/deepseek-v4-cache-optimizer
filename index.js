import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==============================
// 日志与 UI
// ==============================
const Logger = {
    _textarea: null,
    log(msg) {
        const t = new Date().toISOString().split('T')[1].slice(0, -1);
        const line = `[${t}] ✅ ${msg}`;
        console.log(`%c[DS Cache v3] ${line}`, 'color: #4af626; font-weight: bold;');
        this._append(line);
    },
    warn(msg) {
        const t = new Date().toISOString().split('T')[1].slice(0, -1);
        const line = `[${t}] 🌪️ ${msg}`;
        console.warn(`%c[DS Cache v3] ${line}`, 'color: #ffaa00; font-weight: bold;');
        this._append(line);
    },
    error(msg, err) {
        const t = new Date().toISOString().split('T')[1].slice(0, -1);
        const line = `[${t}] 🔴 ${msg}`;
        console.error(`[DS Cache v3] ${line}`, err ?? '');
        this._append(line);
    },
    _append(text) {
        if (this._textarea) {
            this._textarea.value += text + '\n';
            this._textarea.scrollTop = this._textarea.scrollHeight;
        }
    }
};

// ==============================
// 状态机
// ==============================
const State = {
    enabled: true,
    // 永久冻结的系统内容（首次锁存后绝对不变）
    frozenSystem: null,
    // 上一轮实际发送的消息数组（用于保证基线延续）
    lastSentMessages: null,
    // 上一轮接收到的原始消息数组（用于计算本轮增量）
    lastRawMessages: null,
    // 黑洞过滤库：已确认的浮动格式指令特征 -> 直接丢弃
    floatingPatterns: new Set(),
    // 统计
    stats: { total: 0, hits: 0, savedTokens: 0, prefixLen: 0 }
};

// ==============================
// 工具函数
// ==============================
function estimateTokens(text) {
    if (!text) return 0;
    let tokens = 0;
    for (const ch of text) {
        const c = ch.charCodeAt(0);
        if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3040 && c <= 0x30FF) || (c >= 0xAC00 && c <= 0xD7AF)) {
            tokens += 1;
        } else {
            tokens += 0.25;
        }
    }
    return Math.ceil(tokens);
}

function messagesEqual(a, b) {
    if (!a || !b) return false;
    if (a.role !== b.role) return false;
    if (a.content !== b.content) return false;
    return true;
}

function isFloatingCandidate(msg, recentBottoms) {
    // 消息内容长度 > 25，且疑似格式指令/jailbreak
    if (!msg.content || msg.content.length <= 25) return false;
    return recentBottoms.some(m => m.content === msg.content);
}

// 从数组中移除 matching 条件并返回新数组
function filterOut(arr, predicate) {
    return arr.filter((_, i) => !predicate(_, i));
}

// ==============================
// 核心拦截与重组
// ==============================
function interceptAndRestructurePrompt(data) {
    if (!State.enabled || data.dryRun) return;
    try {
        State.stats.total++;

        const raw = Array.isArray(data.chat) ? [...data.chat] : [];
        if (raw.length === 0) return;

        // ----- 1. 浮动指令检测与剥离（仅剥离，绝不吸入系统前缀）-----
        const recentBottoms = raw.slice(-4);
        let cleanedRaw = raw.filter(msg => {
            if (State.floatingPatterns.has(msg.content)) return false;
            // 跨回合底部重复的 -> 标记为浮动并丢弃
            if (State.lastRawMessages && isFloatingCandidate(msg, recentBottoms)) {
                const wasInLastBottom = State.lastRawMessages.slice(-3).some(m => m.content === msg.content);
                if (wasInLastBottom) {
                    State.floatingPatterns.add(msg.content);
                    Logger.warn(`检测到浮动指令（${msg.role}, ${msg.content.length} 字符），已永久剥离`);
                    return false;
                }
            }
            return true;
        });

        // ----- 2. 抽取所有 system 消息（只取内容，之后忽略）-----
        const systemMsgs = cleanedRaw.filter(m => m.role === 'system');
        const nonSystem = cleanedRaw.filter(m => m.role !== 'system');

        // ----- 3. 冻结系统核心（首次锁存后永不改变）-----
        if (State.frozenSystem === null) {
            const merged = systemMsgs.map(m => m.content).join('\n');
            State.frozenSystem = merged;
            Logger.log(`🔒 冻结系统核心完成，${estimateTokens(merged)} tokens`);
        }

        // ----- 4. 构建本轮的非系统增量（相对上一轮 raw）-----
        let newNonSystemMessages;
        if (!State.lastRawMessages) {
            // 第一轮
            newNonSystemMessages = nonSystem;
        } else {
            // 找出上一轮 raw 中的非系统部分
            const lastNonSystem = State.lastRawMessages.filter(m => m.role !== 'system');
            // 正常情况：本轮 nonSystem 是上一轮 nonSystem + 新消息
            if (nonSystem.length >= lastNonSystem.length) {
                let common = 0;
                while (common < lastNonSystem.length && messagesEqual(nonSystem[common], lastNonSystem[common])) {
                    common++;
                }
                // 如果公共前缀长度 < 上一轮长度，说明历史被修改/删除 -> 必须重置基线
                if (common < lastNonSystem.length) {
                    Logger.warn('检测到对话历史回退/修改，重置缓存基线');
                    State.lastSentMessages = null;
                    State.lastRawMessages = null;
                    State.frozenSystem = null;   // 重置系统锁（可选，也可保留）
                    // 递归重跑一遍
                    data.chat = raw;   // 恢复原始，递归会重新锁存
                    interceptAndRestructurePrompt(data);
                    return;
                }
                // 提取新增的消息（common 之后的部分）
                newNonSystemMessages = nonSystem.slice(common);
            } else {
                // 本轮非系统长度竟然更短 -> 历史缩减，重置
                Logger.warn('对话历史缩水，重置基线');
                State.lastSentMessages = null;
                State.lastRawMessages = null;
                State.frozenSystem = null;
                data.chat = raw;
                interceptAndRestructurePrompt(data);
                return;
            }
        }

        // ----- 5. 构造完整 messages ：系统前缀 + 对话历史 + 增量 + 预填充处理 -----
        const newMessages = [];

        // 永远只有一个 system 消息在最前面
        if (State.frozenSystem.trim().length > 0) {
            newMessages.push({ role: 'system', content: State.frozenSystem });
        }

        // 对话历史 + 本轮新增的非系统消息
        if (State.lastSentMessages) {
            // 从上一轮发送的数组中取得所有非系统消息（跳过系统前缀）
            const lastSentNonSystem = State.lastSentMessages.slice(1);  // 去掉 system 头部
            newMessages.push(...lastSentNonSystem);
        } else {
            // 如果没有已发送基线（首轮或重置后），就直接使用本轮全部非系统消息
            newMessages.push(...nonSystem);
            // 注意：首轮 nonSystem 已经包含了截至当前的所有对话，
            // 后续 newNonSystemMessages 可能为空或包含新增；我们这里先放进去，再在下面追加 newNonSystemMessages
        }

        // 追加本轮真正的新消息（如果是首轮，newNonSystemMessages 等于 nonSystem，此时重复了，需要去重）
        if (State.lastSentMessages) {
            newMessages.push(...newNonSystemMessages);
        }

        // 处理 AI 预填充：原数组中末尾连续的 assistant 消息应在最后
        // 提取 raw 末尾连续的 assistant
        const rawTailAssistants = [];
        for (let i = raw.length - 1; i >= 0 && raw[i].role === 'assistant'; i--) {
            rawTailAssistants.unshift(raw[i]);
        }
        // 避免重复添加已在历史中的预填充（一般最后一轮 assistant 就是预填充）
        if (rawTailAssistants.length > 0) {
            // 查看 newMessages 最后是不是已经包含了相同的 assistant
            const lastMsg = newMessages[newMessages.length - 1];
            const lastPre = rawTailAssistants[rawTailAssistants.length - 1];
            if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content === lastPre.content) {
                // 已经存在，无需再加
            } else {
                newMessages.push(...rawTailAssistants);
            }
        }

        // ----- 6. 覆写 data.chat -----
        data.chat = newMessages;

        // ----- 7. 缓存命中统计与状态更新 -----
        let hit = false;
        if (State.lastSentMessages) {
            // 比较新消息的前缀（length of lastSent）是否与 lastSent 完全一致
            const prefixMatch = State.lastSentMessages.every((msg, idx) =>
                idx < newMessages.length && messagesEqual(msg, newMessages[idx])
            );
            if (prefixMatch) {
                hit = true;
                State.stats.hits++;
                const savedThisRound = estimateTokens(State.frozenSystem) +
                    State.lastSentMessages.slice(1).reduce((sum, m) => sum + estimateTokens(m.content), 0);
                State.stats.savedTokens += savedThisRound;
                State.stats.prefixLen = State.lastSentMessages.length;
            }
        }

        // 更新状态
        State.lastSentMessages = [...newMessages];
        State.lastRawMessages = raw;   // 保存未剥离浮动前的 raw（用于下一轮对比浮动）

        const hitRate = State.stats.total ? ((State.stats.hits / State.stats.total) * 100).toFixed(1) : '0.0';
        Logger.log(`发送 ${newMessages.length} 条消息 | 缓存${hit ? '✅命中' : '⚠️未命中'} | 累计命中 ${State.stats.hits}/${State.stats.total} (${hitRate}%)`);

        updateStatsUI();

    } catch (e) {
        Logger.error('拦截器崩溃', e);
    }
}

// ==============================
// UI 与统计面板
// ==============================
function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const s = State.stats;
    el.innerHTML = `命中: ${s.hits}/${s.total} (${s.total ? ((s.hits / s.total) * 100).toFixed(1) : '0.0'}%) | 预估节省: ${s.savedTokens.toLocaleString()} tokens | 冻结前缀: ${State.frozenSystem ? estimateTokens(State.frozenSystem) : 0} tokens`;
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v3-optimizer-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DeepSeek V4 Cache Optimizer v3</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <div style="margin-bottom:8px;background:#1a1a2e;padding:6px;border-radius:4px;font-size:0.85em;" id="ds-cache-stats">等待首轮...</div>
                <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <input type="checkbox" id="ds-cache-enable" checked> 启用缓存对齐
                </label>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin-bottom:10px;">🔄 重置冻结核心与基线</button>
                <textarea id="ds-cache-log" readonly style="width:100%;height:180px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;resize:vertical;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._textarea = document.getElementById('ds-cache-log');
        $('#ds-cache-enable').on('change', function () { State.enabled = $(this).is(':checked'); });
        $('#ds-cache-reset').on('click', () => {
            State.frozenSystem = null;
            State.lastSentMessages = null;
            State.lastRawMessages = null;
            State.floatingPatterns.clear();
            State.stats = { total: 0, hits: 0, savedTokens: 0, prefixLen: 0 };
            updateStatsUI();
            Logger.warn('已重置全部状态，下一轮将重新锁存系统核心与基线');
        });
    } catch (e) {
        Logger.error('UI 初始化失败', e);
    }
}

jQuery(async () => {
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('挂载成功，v3.0.0 基线延续模式已就绪');
    }
});
