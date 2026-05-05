import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 模組 1：顯眼排錯記錄器
// ==========================================
const Logger = {
    log: (msg) => {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const logStr = `[${time}] ✅ ${msg}`;
        console.log(`%c[DS V4 Optimizer] ${logStr}`, 'color: #00ff00; font-weight: bold;');
        appendLogToUI(logStr);
    },
    warn: (msg) => {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const logStr = `[${time}] 👻 ${msg}`;
        console.log(`%c[DS V4 Optimizer] ${logStr}`, 'color: #ffaa00; font-weight: bold;');
        appendLogToUI(logStr);
    },
    error: (msg, err) => {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const logStr = `[${time}] 🔴 ${msg}`;
        console.error(`[DS V4 Optimizer] ${logStr}`, err);
        appendLogToUI(logStr);
    }
};

let uiLogTextarea = null;
function appendLogToUI(text) {
    if (uiLogTextarea) {
        uiLogTextarea.value += text + '\n';
        uiLogTextarea.scrollTop = uiLogTextarea.scrollHeight;
    }
}

// 核心狀態機：跨回合記憶
const CacheState = {
    enabled: true,
    lastStaticBase: null,        // 絕對凍結的 System 核心
    lastHistoryTail: [],         // 上一回合底部的區塊（用於比對浮動提示詞）
    knownFloats: new Map(),      // 已確認的浮動提示詞庫
    floatingSequence: []         // 當前預設的浮動提示詞排序
};

// ==========================================
// 模組 2：幽靈注入算法 (Phantom Injection)
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return; 

    try {
        Logger.log("==========================================");
        Logger.log("啟動攔截：執行【幽靈注入算法】與【核心凍結】");
        
        if (!data || !Array.isArray(data.chat) || data.chat.length === 0) return;

        const historyBlocks = [];
        const dynamicSystemLines = [];

        // 1. 分離 System 核心與動態世界書
        if (!CacheState.lastStaticBase) {
            const coreLines = [];
            data.chat.forEach(msg => {
                if (msg.role === 'system') coreLines.push(msg.content);
                else historyBlocks.push(msg);
            });
            CacheState.lastStaticBase = coreLines.join('\n');
            Logger.log("初始回合：已鎖定 100% 靜態 System 核心。");
        } else {
            data.chat.forEach(msg => {
                if (msg.role === 'system') {
                    // 如果 system 內容不在凍結核心內，說明是觸發的世界書 (World Info)
                    const lines = msg.content.split('\n');
                    const dynamicLines = lines.filter(l => l.trim() !== '' && !CacheState.lastStaticBase.includes(l.trim()));
                    if (dynamicLines.length > 0) dynamicSystemLines.push(dynamicLines.join('\n'));
                } else {
                    historyBlocks.push(msg);
                }
            });
        }

        // 2. 自適應偵測尾部浮動提示詞 (如：253t 擴寫指令、嘿嘿預填充)
        if (CacheState.lastHistoryTail.length > 0) {
            let i = CacheState.lastHistoryTail.length - 1;
            let j = historyBlocks.length - 1;
            while (i >= 0 && j >= 0) {
                const oldMsg = CacheState.lastHistoryTail[i];
                const newMsg = historyBlocks[j];
                // 如果連續兩回合出現在最底部，且完全相同
                if (oldMsg.role === newMsg.role && oldMsg.content === newMsg.content) {
                    // 防呆：只捕獲 prefill 或 長度較長的擴寫指令，避免捕獲用戶重複發送的短句
                    if (newMsg.role === 'assistant' || newMsg.role === 'system' || (newMsg.role === 'user' && newMsg.content.length > 30)) {
                        if (!CacheState.knownFloats.has(newMsg.content)) {
                            CacheState.knownFloats.set(newMsg.content, newMsg.role);
                            Logger.warn(`捕獲環境浮動指令 [${newMsg.role}] (${newMsg.content.length}字)，已加入幽靈注入庫！`);
                        }
                    }
                    i--; j--;
                } else {
                    break;
                }
            }
        }
        // 紀錄本回合尾部供下次比對
        CacheState.lastHistoryTail = historyBlocks.slice(-5);

        // 3. 提取當前陣列中的浮動區塊序列
        const currentFloats = [];
        let tailIndex = historyBlocks.length - 1;
        while (tailIndex >= 0) {
            const msg = historyBlocks[tailIndex];
            if (CacheState.knownFloats.has(msg.content)) {
                currentFloats.unshift(msg);
                tailIndex--;
            } else {
                break; // 遇到真正的當前用戶輸入就停止
            }
        }
        CacheState.floatingSequence = currentFloats;

        // 4. 重組歷史：【幽靈注入】還原 API 真實視角！
        const rebuiltHistory = [];
        for (let i = 0; i < historyBlocks.length; i++) {
            // 【關鍵防崩潰】必須深拷貝物件，否則會污染酒館的前端 UI 顯示！
            const originalMsg = historyBlocks[i];
            const msg = { role: originalMsg.role, content: originalMsg.content, name: originalMsg.name }; 

            const isTailFloat = i > tailIndex; // 是否為陣列最底部的浮動塊
            const isCurrentUserMsg = i === tailIndex; // 真正的當前用戶輸入

            // 將臨時觸發的世界書/記憶，無害地塞入當前輸入的上方
            if (isCurrentUserMsg && dynamicSystemLines.length > 0) {
                rebuiltHistory.push({ role: 'system', content: `[World Info / Dynamic Note]:\n${dynamicSystemLines.join('\n')}` });
                Logger.log(`已將 ${dynamicSystemLines.length} 行世界書掛載至底部安全區。`);
            }

            // 如果這是過去的 AI 歷史回覆 (非尾部 prefill)
            if (msg.role === 'assistant' && !isTailFloat) {
                CacheState.floatingSequence.forEach(floatMsg => {
                    if (floatMsg.role === 'assistant') {
                        // 【核心奧義】：將 "嘿嘿..." 完美黏合回過去的故事中！欺騙 Cache！
                        msg.content = floatMsg.content + (floatMsg.content.endsWith('\n') ? '' : '\n') + msg.content;
                    } else {
                        // 注入 253t 等擴寫指令到 AI 回覆的上方
                        rebuiltHistory.push({ role: floatMsg.role, content: floatMsg.content });
                    }
                });
                rebuiltHistory.push(msg);
            } else {
                rebuiltHistory.push(msg);
            }
        }

        // 5. 終極陣列組裝
        const finalMessages = [
            { role: 'system', content: CacheState.lastStaticBase },
            ...rebuiltHistory
        ];

        // 覆寫請求 payload
        data.chat.splice(0, data.chat.length, ...finalMessages);
        
        if (CacheState.floatingSequence.length > 0) {
            Logger.warn(`幽靈注入完成！已將 ${CacheState.floatingSequence.length} 個浮動區塊無縫還原至歷史對話中，保證 100% 緩存命中！`);
        } else {
            Logger.log(`重組完成！發送陣列已達最優化結構 (區塊數: ${data.chat.length})`);
        }
        
    } catch (err) {
        Logger.error("致命錯誤！已取消優化。", err);
    }
}

// ==========================================
// 模組 3：內建折疊式 UI 介面 (完全適配 ST 原生樣式)
// ==========================================
async function setupUI() {
    try {
        Logger.log("初始化 UI...");
        
        // 移除了 <b> 和 Emoji，完全使用酒館原生樣式，解決 UI 不統一的問題
        const uiHTML = `
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <span style="font-weight: 600;">Deepseek V4 Cache Optimizer</span>
                    <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="padding: 10px; background: rgba(0,0,0,0.1); border-radius: 5px;">
                    <p style="font-size: 0.85em; opacity: 0.8; margin-top: 0; margin-bottom: 15px;">🧠 採用「幽靈注入算法」，自動偵測並還原預填充與擴寫指令，實現絕對的 100% 緩存命中。</p>
                    
                    <div style="margin-bottom: 15px;">
                        <label class="checkbox_label" style="display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="ds-cache-enable" checked> 
                            <span>啟用緩存優化器</span>
                        </label>
                    </div>
                    
                    <button id="ds-cache-reset" class="menu_button" style="width: 100%; display: block; margin-bottom: 15px; padding: 10px; text-align: center;">
                        🔄 重置靜態核心與浮動記憶
                    </button>
                    
                    <div>
                        <div style="font-weight: bold; margin-bottom: 5px; font-size: 0.9em;">排錯日誌 (Debug Logs):</div>
                        <textarea id="ds-cache-log" class="text_pole" readonly style="width: 100%; height: 220px; background-color: #121212; color: #4af626; font-family: 'Consolas', monospace; font-size: 11px; padding: 8px; border: 1px solid var(--SmartThemeBorderColor, #555); border-radius: 4px; resize: vertical; box-sizing: border-box;"></textarea>
                    </div>
                </div>
            </div>
        `;
        
        $('#extensions_settings').append(uiHTML);
        uiLogTextarea = document.getElementById('ds-cache-log');
        
        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`插件狀態已更改: ${CacheState.enabled ? "啟用" : "停用"}`);
        });

        $('#ds-cache-reset').on('click', function() {
            CacheState.lastStaticBase = null;
            CacheState.lastHistoryTail = [];
            CacheState.knownFloats.clear();
            CacheState.floatingSequence = [];
            Logger.warn("已清空緩存核心與幽靈記憶！下一回合將重新抓取！");
        });

    } catch (err) {
        Logger.error("UI 初始化失敗！", err);
    }
}

// ==========================================
// 模組 4：生命週期啟動
// ==========================================
jQuery(async () => {
    try {
        console.log("Deepseek V4 Optimizer is loading...");
        await setupUI();
        
        if (eventSource && event_types && event_types.CHAT_COMPLETION_PROMPT_READY) {
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
            Logger.log("成功掛載 CHAT_COMPLETION_PROMPT_READY 鉤子");
        }
    } catch (err) {
        Logger.error("擴展加載過程發生致命錯誤！", err);
    }
});
