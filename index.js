import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==================== 日志 & 等级 ====================
let logLevel = 2; // 0:关 1:简要 2:详细 3:调试
const LV = { SILENT:0, BASIC:1, DETAILED:2, DEBUG:3 };

const Logger = {
    _textarea: null,
    _log(level, type, msg) {
        if (logLevel < level) return;
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const full = `[${time}] ${msg}`;
        if (type === 'warn') console.warn(`%c[DS V4 Opt v5] 🌪️ ${msg}`, 'color:#ffaa00; font-weight:bold;');
        else if (type === 'error') console.error(`[DS V4 Opt v5] 🔴 ${msg}`);
        else console.log(`%c[DS V4 Opt v5] ✅ ${msg}`, 'color:#00ff00; font-weight:bold;');
        if (this._textarea) {
            this._textarea.value += full + '\n';
            this._textarea.scrollTop = this._textarea.scrollHeight;
        }
    },
    log: (msg, level=LV.DETAILED) => Logger._log(level, 'log', msg),
    warn: (msg, level=LV.BASIC) => Logger._log(level, 'warn', msg),
    error: (msg, err, level=LV.BASIC) => Logger._log(level, 'error', msg + (err ? ' ' + err : '')),
};

// ==================== 工具函数 ====================
function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h) + str.charCodeAt(i) | 0;
    }
    return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}

function estimateTokens(text) {
    if (!text) return 0;
    let tokens = 0;
    for (const ch of text) {
        const c = ch.charCodeAt(0);
        if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3040 && c <= 0x30FF) || (c >= 0xAC00 && c <= 0xD7AF)) tokens += 1;
        else tokens += 0.25;
    }
    return Math.ceil(tokens);
}

function normalizeForFingerprint(text) {
    return text.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
}

function similarity(oldText, newText) {
    if (!oldText || !newText) return 0;
    const oldLines = new Set(oldText.split('\n').map(l => l.trim()).filter(Boolean));
    const newLines = newText.split('\n').map(l => l.trim()).filter(Boolean);
    if (newLines.length === 0) return 1;
    let common = 0;
    for (const l of newLines) if (oldLines.has(l)) common++;
    return common / newLines.length;
}

// ==================== 状态机 ====================
const State = {
    enabled: true,
    lockedMessages: [],           // 锁定前缀日志（完整消息对象数组）
    staticSystem: '',             // 已锁定的 system 核心内容（合并后）
    absorbedUserInstruction: '',  // 吸收的浮动 user 指令
    fixedPrefill: null,           // 吸收的固定 assistant 预填充
    stats: { total:0, hits:0, savedTokens:0, prefixTokens:0 },
    lastFirstUserFingerprint: null,
    lastBottomBlocks: [],
    knownFloats: new Set(),
};

// ==================== 消息解析 ====================
function extractParts(chat) {
    const systems = [], history = [], prefills = [];
    const arr = [...chat];
    while (arr.length && arr[arr.length-1].role === 'assistant') prefills.unshift(arr.pop());
    for (const m of arr) {
        if (m.role === 'system') systems.push(m);
        else history.push(m);
    }
    return { systems, history, prefills };
}

function mergeSystems(sysArray) {
    const seen = new Set();
    const lines = [];
    for (const m of sysArray) {
        for (const line of (m.content||'').split('\n')) {
            const t = line.trim();
            if (t && !seen.has(t)) { seen.add(t); lines.push(line); }
        }
    }
    return lines.join('\n');
}

// ==================== 浮动 & 重复检测 ====================
function detectAndAbsorbFloats(history) {
    if (!history.length) return { cleaned: history, absorbed: false };
    const currentBottoms = history.slice(-3);
    const cleaned = [];
    let absorbed = false;
    for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        const isBottom = i >= history.length - 3;
        const long = msg.content?.length > 25;
        if (State.knownFloats.has(msg.content)) { absorbed = true; continue; }
        const wasInLastBottom = State.lastBottomBlocks.some(b => b.content === msg.content);
        if (isBottom && long && wasInLastBottom) {
            State.knownFloats.add(msg.content);
            State.absorbedUserInstruction += (State.absorbedUserInstruction ? '\n\n' : '') + msg.content;
            Logger.warn(`吸收浮动指令 (${msg.role}, ${msg.content.length}字) 合并入固定user`, LV.DETAILED);
            absorbed = true;
            continue;
        }
        cleaned.push(msg);
    }
    State.lastBottomBlocks = cleaned.slice(-3).map(m=>({role:m.role, content:m.content}));
    return { cleaned, absorbed };
}

function detectAndAbsorbRepeatedFirstUser(history) {
    if (!history.length) return { cleaned: history, absorbed: false };
    const first = history[0];
    if (first.role !== 'user' || !first.content || first.content.length < 25) {
        State.lastFirstUserFingerprint = first.role==='user' ? normalizeForFingerprint(first.content) : null;
        return { cleaned: history, absorbed: false };
    }
    const fp = normalizeForFingerprint(first.content);
    if (State.lastFirstUserFingerprint && fp === State.lastFirstUserFingerprint) {
        State.knownFloats.add(first.content);
        State.absorbedUserInstruction += (State.absorbedUserInstruction ? '\n\n' : '') + first.content;
        Logger.warn(`吸收重复首条 user 指令 (${first.content.length}字)`, LV.DETAILED);
        history.shift();
        return { cleaned: history, absorbed: true };
    }
    State.lastFirstUserFingerprint = fp;
    return { cleaned: history, absorbed: false };
}

// ==================== 前缀快照与差异 ====================
function captureSnapshot() {
    const sysHash = simpleHash(State.staticSystem);
    const insHash = simpleHash(State.absorbedUserInstruction);
    const prefHash = simpleHash(State.fixedPrefill || '');
    const tokens = estimateTokens(State.staticSystem) + estimateTokens(State.absorbedUserInstruction) + estimateTokens(State.fixedPrefill || '');
    return { sysHash, insHash, prefHash, tokens };
}

function compareSnapshots(prev, curr) {
    if (!prev) return '首次建立前缀';
    let r = '';
    r += prev.sysHash === curr.sysHash ? `✅ System 不变 (${curr.tokens} tokens)` : `❌ System 变化 ${prev.sysHash}->${curr.sysHash}`;
    r += '\n' + (prev.insHash === curr.insHash ? `✅ User指令不变` : `❌ User指令变化 ${prev.insHash}->${curr.insHash}`);
    r += '\n' + (prev.prefHash === curr.prefHash ? `✅ 预填充不变` : `❌ 预填充变化 ${prev.prefHash}->${curr.prefHash}`);
    return r;
}

// ==================== 核心重组 ====================
function intercept(data) {
    if (!State.enabled || data.dryRun) return;
    State.stats.total++;
    Logger.log(`================== 拦截器 #${State.stats.total}`, LV.BASIC);

    const original = [...data.chat];
    const { systems, history, prefills } = extractParts(original);
    const currentSysText = mergeSystems(systems);

    // ---------- 初始化 lockedMessages ----------
    if (!State.lockedMessages.length) {
        const { cleaned: h1, absorbed: f1 } = detectAndAbsorbFloats(history);
        let h2 = h1;
        const { cleaned: h3, absorbed: f2 } = detectAndAbsorbRepeatedFirstUser(h2);
        h2 = h3;
        State.staticSystem = currentSysText;
        if (prefills.length && prefills[0].content) State.fixedPrefill = prefills[0].content;
        else State.fixedPrefill = null;

        const locked = [];
        locked.push({ role: 'system', content: State.staticSystem });
        if (State.absorbedUserInstruction.trim()) locked.push({ role: 'user', content: State.absorbedUserInstruction });
        if (State.fixedPrefill && State.fixedPrefill.trim()) locked.push({ role: 'assistant', content: State.fixedPrefill });
        locked.push(...h2);
        // 如果有预填充但我们已经吸收，跳过原预填充
        if (State.fixedPrefill && prefills.length && prefills[0].content === State.fixedPrefill) prefills.shift();
        locked.push(...prefills);

        State.lockedMessages = locked;
        const snap = captureSnapshot();
        State.stats.prefixTokens = snap.tokens;
        State.stats.hits++;
        State.stats.savedTokens += snap.tokens;
        data.chat.splice(0, data.chat.length, ...State.lockedMessages);
        Logger.log(`初始化完成，锁定消息 ${State.lockedMessages.length} 条`, LV.BASIC);
        if (logLevel >= LV.DEBUG) Logger.log('结构: ' + State.lockedMessages.map(m=>`${m.role}(${m.content.length}字)`).join(' → '), LV.DEBUG);
        return;
    }

    // ---------- 检测 system 变化 ----------
    let newSystemBlock = null;
    if (currentSysText !== State.staticSystem) {
        if (currentSysText.startsWith(State.staticSystem)) {
            const addition = currentSysText.slice(State.staticSystem.length).trim();
            if (addition) {
                newSystemBlock = { role: 'system', content: addition };
                Logger.log(`检测到新增系统内容 (${addition.length}字)，将追加到历史之后`, LV.BASIC);
            }
            // 更新静态核心到当前完整版本，以便下一轮不再重复追加
            State.staticSystem = currentSysText;
        } else {
            const sim = similarity(State.staticSystem, currentSysText);
            Logger.warn(`System 核心内容变化，相似度 ${(sim*100).toFixed(1)}%`, LV.BASIC);
            if (sim < 0.3 && currentSysText.length > 50) {
                Logger.warn('相似度过低，重置锁定状态', LV.BASIC);
                // 完全重置
                State.lockedMessages = [];
                State.staticSystem = '';
                State.absorbedUserInstruction = '';
                State.fixedPrefill = null;
                State.knownFloats.clear();
                State.lastBottomBlocks = [];
                State.lastFirstUserFingerprint = null;
                intercept(data); // 递归重新初始化
                return;
            } else {
                // 局部修改，采用新的静态核心，但历史全部断裂
                State.staticSystem = currentSysText;
                // 将 system 消息更新到 lockedMessages[0]
                if (State.lockedMessages[0]?.role === 'system') {
                    State.lockedMessages[0].content = currentSysText;
                } else {
                    State.lockedMessages.unshift({ role: 'system', content: currentSysText });
                }
                Logger.warn('System 核心已更新，之前的历史缓存将断裂', LV.BASIC);
            }
        }
    }

    // 处理浮动指令和重复首条（在历史中）
    let h = [...history];
    const { cleaned: h1, absorbed: f1 } = detectAndAbsorbFloats(h);
    h = h1;
    const { cleaned: h2, absorbed: f2 } = detectAndAbsorbRepeatedFirstUser(h);
    h = h2;

    // 处理预填充
    let remainingPrefills = [...prefills];
    if (State.fixedPrefill) {
        if (remainingPrefills.length && remainingPrefills[0]?.content === State.fixedPrefill) {
            remainingPrefills.shift(); // 去掉已吸收的
        } else if (remainingPrefills.length && remainingPrefills[0]?.content !== State.fixedPrefill) {
            Logger.warn('预填充内容变化，前缀将更新', LV.DETAILED);
            State.fixedPrefill = remainingPrefills[0].content;
            remainingPrefills.shift();
        }
    } else if (remainingPrefills.length && remainingPrefills[0]?.content) {
        State.fixedPrefill = remainingPrefills[0].content;
        remainingPrefills.shift();
        Logger.log(`首次捕获预填充 (${State.fixedPrefill.length}字)`, LV.DETAILED);
    }

    // ---------- 与 lockedMessages 对齐，找出新增对话 ----------
    // lockedMessages 结构：[system, (user指令), (assistant预填充), ...历史..., ...尾预填充]
    // 我们需要找到本轮历史中哪些消息是新的。
    // 简单方法：从 lockedMessages 中提取历史部分（跳过前3个可能的固定块）
    const fixedPrefixCount = (State.absorbedUserInstruction.trim()?1:0) + (State.fixedPrefill&&State.fixedPrefill.trim()?1:0) + 1; // +1 for system
    const oldHistory = State.lockedMessages.slice(fixedPrefixCount);
    // 去除 oldHistory 中末尾的预填充（如果有）
    // 实际上我们将预填充也放在 lockedMessages 末尾了，但现在是分开的。
    // 简化：直接比对 oldHistory 与 h（当前清理后的历史），找出共同前缀长度
    let matchingLen = 0;
    while (matchingLen < oldHistory.length && matchingLen < h.length) {
        if (oldHistory[matchingLen].role === h[matchingLen].role && oldHistory[matchingLen].content === h[matchingLen].content) {
            matchingLen++;
        } else break;
    }

    if (matchingLen < oldHistory.length) {
        Logger.warn(`历史被截断，前 ${matchingLen} 条保留，之后的重建`, LV.BASIC);
    }

    // 新历史尾部
    const newHistoryPart = h.slice(matchingLen);
    if (newHistoryPart.length) {
        Logger.log(`新增对话消息 ${newHistoryPart.length} 条`, LV.DETAILED);
    }

    // ---------- 构建新锁定数组 ----------
    const newLocked = [];
    // 固定前缀
    newLocked.push({ role: 'system', content: State.staticSystem });
    if (State.absorbedUserInstruction.trim()) newLocked.push({ role: 'user', content: State.absorbedUserInstruction });
    if (State.fixedPrefill && State.fixedPrefill.trim()) newLocked.push({ role: 'assistant', content: State.fixedPrefill });
    // 旧的历史（保留部分）
    for (let i = 0; i < matchingLen; i++) newLocked.push(oldHistory[i]);
    // 新增的系统块（插入在历史之后，新用户之前）
    if (newSystemBlock) {
        newLocked.push(newSystemBlock);
        Logger.log(`已追加新增系统块`, LV.DETAILED);
    }
    // 剩余的历史（新的对话）
    newLocked.push(...newHistoryPart);
    // 剩余的预填充
    newLocked.push(...remainingPrefills);

    // 更新锁定数组
    State.lockedMessages = newLocked;

    // 快照与缓存命中判定
    const currSnap = captureSnapshot();
    const prevSnap = State._prevSnapshot || currSnap;
    Logger.log(`前缀差异:\n${compareSnapshots(prevSnap, currSnap)}`, LV.DETAILED);

    const cacheHit = (prevSnap.sysHash === currSnap.sysHash && prevSnap.insHash === currSnap.insHash && prevSnap.prefHash === currSnap.prefHash);
    if (cacheHit) {
        State.stats.hits++;
        State.stats.savedTokens += currSnap.tokens;
        Logger.log(`✅ 缓存命中！仅新增尾部 ~${estimateTokens(newHistoryPart.map(m=>m.content).join('')) + estimateTokens(remainingPrefills.map(m=>m.content).join(''))} tokens 需计算`, LV.BASIC);
    } else {
        Logger.warn('⚠️ 前缀变化，部分缓存未命中 (下一轮将稳定)', LV.BASIC);
    }
    State._prevSnapshot = currSnap;
    State.stats.prefixTokens = currSnap.tokens;

    // 覆写 data.chat
    data.chat.splice(0, data.chat.length, ...State.lockedMessages);
    Logger.log(`重组完成：${original.length} 条 → ${State.lockedMessages.length} 条`, LV.BASIC);
    if (logLevel >= LV.DEBUG) {
        Logger.log('结构: ' + State.lockedMessages.map(m=>`${m.role}(${m.content.length}字)`).join(' → '), LV.DEBUG);
    }
}

// ==================== UI ====================
function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = State.stats;
    const rate = total ? ((hits/total)*100).toFixed(1) : '0.0';
    el.innerHTML = `<span>命中: ${hits}/${total} (${rate}%)</span> <span style="margin-left:10px;">前缀: ~${prefixTokens.toLocaleString()}t</span> <span style="margin-left:10px;">共省: ~${savedTokens.toLocaleString()}t</span>`;
}

async function setupUI() {
    try {
        const html = `
        <div class="inline-drawer" id="ds-v4-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🧠 DS V4 Cache Optimizer v5</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <p style="font-size:0.9em;opacity:0.8;">前缀日志自动追加，新增世界书/预设不破坏缓存。</p>
                <div id="ds-cache-stats" style="margin-bottom:8px;font-size:0.85em;"></div>
                <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" checked> 启用拦截器</label>
                <div style="margin:8px 0;display:flex;align-items:center;gap:8px;">
                    <span>日志等级:</span>
                    <select id="ds-loglevel">
                        <option value="0">关闭</option><option value="1">简要</option><option value="2" selected>详细</option><option value="3">调试</option>
                    </select>
                </div>
                <button id="ds-cache-reset" class="menu_button" style="width:100%;margin-bottom:10px;">🔄 强制重置前缀日志</button>
                <textarea id="ds-cache-log" class="text_pole" readonly style="width:100%;height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
            </div>
        </div>`;
        $('#extensions_settings').append(html);
        Logger._textarea = document.getElementById('ds-cache-log');
        $('#ds-cache-enable').on('change', function(){ State.enabled = $(this).is(':checked'); Logger.log(`状态: ${State.enabled?'启用':'停用'}`, LV.BASIC); });
        $('#ds-loglevel').on('change', function(){ logLevel = parseInt($(this).val()); Logger.log(`日志等级: ${['关','简要','详细','调试'][logLevel]}`, LV.BASIC); });
        $('#ds-cache-reset').on('click', ()=>{
            State.lockedMessages = [];
            State.staticSystem = '';
            State.absorbedUserInstruction = '';
            State.fixedPrefill = null;
            State.knownFloats.clear();
            State.lastBottomBlocks = [];
            State.lastFirstUserFingerprint = null;
            State._prevSnapshot = null;
            State.stats = { total:0, hits:0, savedTokens:0, prefixTokens:0 };
            updateStatsUI();
            Logger.warn('已完全重置前缀日志', LV.BASIC);
        });
        updateStatsUI();
    } catch(e) { Logger.error('UI错误', e); }
}

jQuery(async () => {
    console.log('DS V4 Optimizer v5 loading...');
    await setupUI();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, intercept);
        Logger.log('钩子已挂载', LV.BASIC);
    } else Logger.error('无法挂载钩子');
    Logger.log('══════ v5.0 前缀日志引擎就绪 ══════', LV.BASIC);
});
