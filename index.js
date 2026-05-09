import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// 日志
const LogLevels = { SILENT:0, BASIC:1, DETAILED:2, DEBUG:3 };
let logLevel = 2;
function logAt(level, type, msg) {
    if (logLevel < level) return;
    const time = new Date().toISOString().split('T')[1].slice(0,-1);
    const full = `[${time}] ${msg}`;
    if (type==='warn') console.warn(`%c[DS Cache v6.9] 🌪️ ${msg}`, 'color:#ffaa00; font-weight:bold;');
    else if (type==='error') console.error(`[DS Cache v6.9] 🔴 ${msg}`);
    else console.log(`%c[DS Cache v6.9] ✅ ${msg}`, 'color:#00ff00; font-weight:bold;');
    if (Logger._uiTextarea) {
        Logger._uiTextarea.value += full + '\n';
        Logger._uiTextarea.scrollTop = Logger._uiTextarea.scrollHeight;
    }
}
const Logger = {
    _uiTextarea: null,
    log: (m,l=LogLevels.DETAILED)=>logAt(l,'log',m), warn: (m,l=LogLevels.BASIC)=>logAt(l,'warn',m), error: (m,e,l=LogLevels.BASIC)=>logAt(l,'error',e?`${m} ${e}`:m),
    simpleHash: (s)=>{let h=0;for(let i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0;}return (h>>>0).toString(16).padStart(8,'0').slice(0,8);},
    estimateTokens: (t)=>{if(!t)return 0;let n=0;for(const c of t){const code=c.charCodeAt(0);if((code>=0x4E00&&code<=0x9FFF)||(code>=0x3040&&code<=0x30FF)||(code>=0xAC00&&code<=0xD7AF))n+=1;else n+=0.25;}return Math.ceil(n);},
    normalize: (t)=>t.replace(/\s+/g,' ').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").trim(),
};

const CacheState = {
    enabled: true,
    backgroundBlock: null,
    dialogueHistory: null,
    stats: { total:0, hits:0, savedTokens:0, prefixTokens:0 },
    blocked: false,
};

function classifyMessage(msg, originalChat) {
    const idx = originalChat.findIndex(m=>m.mes===msg.content);
    if (idx!==-1) {
        const orig = originalChat[idx];
        if (orig.is_user) return {isRealUser:true, isRealAI:false, isInstructional:false, matched:true};
        if (!orig.is_system && orig.role==='assistant') return {isRealUser:false, isRealAI:true, isInstructional:false, matched:true};
        if (orig.is_system) return {isRealUser:false, isRealAI:false, isInstructional:true, matched:true};
        return {isRealUser:false, isRealAI:false, isInstructional:true, matched:true};
    }
    return {isRealUser:false, isRealAI:false, isInstructional:true, matched:false};
}

function createMsgObj(msg, cls, uid) {
    return {
        role: msg.role,
        content: msg.content,
        isRealUser: cls.isRealUser,
        isRealAI: cls.isRealAI,
        isInstructional: cls.isInstructional,
        uid: uid || `${msg.role}:${Logger.simpleHash(msg.content)}`,
        norm: Logger.normalize(msg.content),
        matched: cls.matched,
    };
}

// 处理流：坚决丢弃所有历史 user/assistant
function processStream(stream, originalChat) {
    let prefillStart = stream.length;
    while (prefillStart>0 && stream[prefillStart-1].role==='assistant') prefillStart--;
    let hasRealReply = false;
    for (let i=prefillStart;i<stream.length;i++) {
        const cls = classifyMessage(stream[i], originalChat);
        if (cls.isRealAI) { hasRealReply = true; break; }
    }
    if (hasRealReply) prefillStart = stream.length;
    const prefills = stream.slice(prefillStart);
    const nonPrefill = stream.slice(0, prefillStart);

    const classified = nonPrefill.map(msg => {
        const cls = classifyMessage(msg, originalChat);
        return { msg, cls, obj: createMsgObj(msg, cls) };
    });

    // 打印 originalChat 尾部信息（调试）
    if (logLevel>=LogLevels.DEBUG) {
        Logger.log(`[originalChat] 尾3: ${originalChat.slice(-3).map((m,i)=>`is_user:${m.is_user} "${m.mes?.substring(0,20)}..."`)}`, LogLevels.DEBUG);
    }

    // 找出现有所有真实 user 索引
    const realUserIdx = [];
    classified.forEach((c,i)=>{ if(c.cls.isRealUser && c.msg.role==='user') realUserIdx.push(i); });
    let currentUserMsg = null;
    if (realUserIdx.length>0) {
        const lastIdx = realUserIdx[realUserIdx.length-1];
        currentUserMsg = classified[lastIdx].obj;
        // 将除最后一个外的真实 user 标记为丢弃（不进入 others）
        for (let i=0; i<realUserIdx.length-1; i++) {
            classified[realUserIdx[i]].discard = true;
            Logger.log(`[丢弃历史user] ${classified[realUserIdx[i]].msg.content.substring(0,30)}...`, LogLevels.DEBUG);
        }
    }

    // 构建 others：排除 discard 和当前用户输入
    const others = [];
    for (const c of classified) {
        if (c.discard || c.obj === currentUserMsg) continue;
        others.push(c.obj);
    }

    if (logLevel>=LogLevels.DEBUG) {
        Logger.log('[分类结果]', LogLevels.DEBUG);
        classified.forEach((c,i)=> {
            const tag = c.discard ? 'DISCARD' : (c.obj===currentUserMsg?'CURRENT_USER':'');
            Logger.log(`  [${i}] ${c.msg.role} | realUser:${c.cls.isRealUser} realAI:${c.cls.isRealAI} instr:${c.cls.isInstructional} ${tag} | ${c.msg.content.substring(0,40)}...`, LogLevels.DEBUG);
        });
    }

    return { currentUserMsg, others, prefills };
}

// 核心拦截器
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return;
    if (CacheState.blocked) {
        Logger.warn('[阻塞] 保持原始消息', LogLevels.BASIC);
        return;
    }
    try {
        CacheState.stats.total++;
        Logger.log('==============================');
        Logger.log(`[请求 #${CacheState.stats.total}] 开始处理...`);

        if (!data?.chat?.length) return;
        const stream = data.chat;
        const context = getContext();
        const originalChat = context?.chat ?? [];

        const { currentUserMsg, others, prefills } = processStream(stream, originalChat);

        // 背景块：仅保留 role 为 system 且 isInstructional 的消息
        const pureBg = others.filter(m => m.role === 'system' && m.isInstructional);
        // 对话历史：任何非背景的真实消息，这里也强制清空，因为我们只在初始化后增量添加
        const possibleDialogue = others.filter(m => !m.isInstructional);
        if (possibleDialogue.length > 0) {
            Logger.warn(`[警告] 发现未处理的对话消息 ${possibleDialogue.length} 条，将丢弃`, LogLevels.BASIC);
            possibleDialogue.forEach(m => Logger.warn(`  - ${m.role}: ${m.content.substring(0,40)}...`, LogLevels.DEBUG));
        }

        // 背景去重
        const seen = new Set();
        const dedupBg = [];
        for (const m of pureBg) {
            if (!seen.has(m.norm)) {
                seen.add(m.norm);
                dedupBg.push(m);
            } else {
                Logger.log(`[背景去重] 跳过: ${m.content.substring(0,40)}...`, LogLevels.DEBUG);
            }
        }

        // 初始化或重置后：对话历史为空
        if (!CacheState.backgroundBlock || !CacheState.dialogueHistory) {
            CacheState.backgroundBlock = dedupBg;
            CacheState.dialogueHistory = []; // 强制清空
            Logger.log(`[初始化] 背景:${dedupBg.length} 对话:0`, LogLevels.BASIC);
            buildAndApply(stream, dedupBg, [], currentUserMsg, prefills);
            updateStats(true);
            return;
        }

        // 常规：检测背景相似度
        const bgSim = computeSetSimilarity(
            new Set(CacheState.backgroundBlock.map(m=>m.norm)),
            new Set(dedupBg.map(m=>m.norm))
        );
        Logger.log(`[背景相似度] ${(bgSim*100).toFixed(1)}%`, LogLevels.DEBUG);
        if (bgSim < 0.9) {
            triggerResetAlert('检测到系统提示词核心变动，建议重置缓存前缀以保证性能。');
            return;
        }

        // 对话增量（这里 currentDialogue 应该为空，因为我们过滤掉了）
        const currentDialogue = []; // 实际没有对话历史
        const newDial = findNewEntries(CacheState.dialogueHistory, currentDialogue);
        if (newDial.length > 0) Logger.warn(`[对话增量] +${newDial.length}`, LogLevels.DETAILED);
        CacheState.dialogueHistory = CacheState.dialogueHistory.concat(newDial);

        buildAndApply(stream, CacheState.backgroundBlock, CacheState.dialogueHistory, currentUserMsg, prefills);
        updateStats(false);
    } catch (err) {
        Logger.error('拦截器错误', err);
    }
}

function buildAndApply(stream, bg, dialogue, curUser, prefills) {
    const final = [];
    bg.forEach(b => final.push({ role: b.role, content: b.content }));
    dialogue.forEach(d => final.push({ role: d.role, content: d.content }));
    if (curUser) final.push({ role: curUser.role, content: curUser.content });
    prefills.forEach(p => final.push({ role: p.role, content: p.content }));

    if (logLevel>=LogLevels.DEBUG) {
        Logger.log(`[最终序列] bg:${bg.length} dl:${dialogue.length} usr:${curUser?1:0} pf:${prefills.length}`, LogLevels.DEBUG);
        final.forEach((m,i)=> Logger.log(`  ${i}: [${m.role}] ${m.content.substring(0,80)}...`, LogLevels.DEBUG));
    }
    stream.splice(0, stream.length, ...final);
}

function findNewEntries(oldSeq, newSeq) {
    const oldUids = new Set(oldSeq.map(m=>m.uid));
    return newSeq.filter(m=>!oldUids.has(m.uid));
}
function computeSetSimilarity(a,b) {
    if (a.size===0 && b.size===0) return 1;
    const union = new Set([...a, ...b]);
    let inter = 0;
    for (const item of a) if (b.has(item)) inter++;
    return union.size===0 ? 1 : inter/union.size;
}

function updateStats() {
    const bgT = CacheState.backgroundBlock?.reduce((a,m)=>a+Logger.estimateTokens(m.content),0)??0;
    const dgT = CacheState.dialogueHistory?.reduce((a,m)=>a+Logger.estimateTokens(m.content),0)??0;
    CacheState.stats.prefixTokens = bgT + dgT;
    CacheState.stats.hits++;
    CacheState.stats.savedTokens += CacheState.stats.prefixTokens;
    updateStatsUI();
}
function updateStatsUI() {
    const el = document.getElementById('ds-cache-stats');
    if (!el) return;
    const { total, hits, savedTokens, prefixTokens } = CacheState.stats;
    const rate = total ? ((hits/total)*100).toFixed(1) : '0.0';
    el.innerHTML = `<span>命中: ${hits}/${total} (${rate}%)</span> <span style="margin-left:10px;">前缀: ~${prefixTokens.toLocaleString()}t</span> <span style="margin-left:10px;">节省: ~${savedTokens.toLocaleString()}t</span>`;
}

// 弹窗
function triggerResetAlert(reason) {
    if (CacheState.blocked) return;
    CacheState.blocked = true;
    Logger.warn('[阻塞] 弹窗', LogLevels.BASIC);
    const onResolve = (reset) => {
        if (reset) {
            CacheState.backgroundBlock = null;
            CacheState.dialogueHistory = null;
            CacheState.stats = {total:0,hits:0,savedTokens:0,prefixTokens:0};
            updateStatsUI();
            Logger.warn('[重置] 前缀已清空', LogLevels.BASIC);
        } else Logger.warn('[取消]', LogLevels.BASIC);
        CacheState.blocked = false;
    };
    if (typeof callPopup === 'function') {
        callPopup(`<h4>缓存优化器</h4><p>${reason}</p>`, [
            { text:'重置', className:'btn-danger', callback:()=>onResolve(true) },
            { text:'取消', callback:()=>onResolve(false) }
        ]);
    } else showFallbackDialog(reason, onResolve);
}
function showFallbackDialog(reason, cb) {
    const id = 'ds-reset-fallback';
    if (document.getElementById(id)) return;
    const d = document.createElement('div'); d.id = id;
    d.innerHTML = `<div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;"><div style="background:#2b2b2b;color:#ddd;padding:24px;border-radius:8px;max-width:500px;"><h3>缓存优化器提醒</h3><p>${reason}</p><div style="display:flex;justify-content:flex-end;gap:10px;"><button id="ds-cancel" class="btn btn-secondary">取消</button><button id="ds-reset" class="btn btn-danger">重置</button></div></div></div>`;
    document.body.appendChild(d);
    document.getElementById('ds-reset').onclick = ()=>{ cb(true); d.remove(); };
    document.getElementById('ds-cancel').onclick = ()=>{ cb(false); d.remove(); };
}
function performReset() {
    CacheState.backgroundBlock = null;
    CacheState.dialogueHistory = null;
    CacheState.stats = {total:0,hits:0,savedTokens:0,prefixTokens:0};
    CacheState.blocked = false;
    updateStatsUI();
    Logger.warn('[强制重置] 已清空', LogLevels.BASIC);
    const fb = document.getElementById('ds-reset-fallback');
    if (fb) fb.remove();
}

// 菜单注册
function registerMenu() {
    try {
        if (typeof window['SillyTavern'] !== 'undefined' && window['SillyTavern'].addExtensionMenuItem) {
            window['SillyTavern'].addExtensionMenuItem({
                label: '重置DS缓存前缀',
                callback: performReset
            });
            Logger.log('[菜单] 已注册至 SillyTavern 扩展菜单', LogLevels.BASIC);
        } else if (extension_settings) {
            extension_settings['ds-cache'] = extension_settings['ds-cache'] || {};
            extension_settings['ds-cache'].menu = [{ label:'重置DS缓存前缀', callback:performReset }];
            Logger.warn('[菜单] 已注册 extension_settings（需启用“扩展菜单”开关）', LogLevels.BASIC);
        }
    } catch(e) { Logger.error('菜单注册失败', e); }
}

// UI
async function setupUI() {
    const html = `
    <div class="inline-drawer" id="ds-v4-opt-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>🧠 DS Cache Optimizer v6.9 (纯系统背景)</b>
            <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="padding:10px;">
            <p>背景块严格限制为 system 提示词，丢弃一切历史 user/assistant，确保顺序完美。</p>
            <div id="ds-cache-stats" style="margin-bottom:8px;"></div>
            <label class="checkbox_label"><input type="checkbox" id="ds-cache-enable" checked> 启用</label>
            <div style="margin:8px 0;">
                <span>日志:</span>
                <select id="ds-cache-loglevel">
                    <option value="0">关闭</option><option value="1">简要</option>
                    <option value="2" selected>详细</option><option value="3">调试</option>
                </select>
            </div>
            <button id="ds-cache-reset" class="menu_button" style="width:100%;margin:5px 0;">🔄 强制重置</button>
            <button id="ds-cache-clearlog" class="menu_button" style="width:100%;margin:5px 0;">🗑️ 清空日志</button>
            <textarea id="ds-cache-log" class="text_pole" readonly style="height:200px;background:#121212;color:#4af626;font-family:Consolas,monospace;font-size:11px;"></textarea>
        </div>
    </div>`;
    $('#extensions_settings').append(html);
    Logger._uiTextarea = document.getElementById('ds-cache-log');

    $('#ds-cache-enable').on('change', function() { CacheState.enabled = $(this).is(':checked'); Logger.log(`插件 ${CacheState.enabled?'启用':'停用'}`, LogLevels.BASIC); });
    $('#ds-cache-loglevel').on('change', function() { logLevel = parseInt($(this).val()); Logger.log(`日志等级: ${['关闭','简要','详细','调试'][logLevel]}`, LogLevels.BASIC); });
    $('#ds-cache-reset').on('click', () => performReset());
    $('#ds-cache-clearlog').on('click', () => { if (Logger._uiTextarea) Logger._uiTextarea.value = ''; });
    updateStatsUI();
}

jQuery(async () => {
    await setupUI();
    registerMenu();
    if (eventSource && event_types?.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
        Logger.log('[系统] 钩子已挂载', LogLevels.BASIC);
    } else Logger.error('无法挂载钩子');
    Logger.log('══════ v6.9 就绪，纯系统背景 + 历史彻底丢弃 ══════', LogLevels.BASIC);
});
