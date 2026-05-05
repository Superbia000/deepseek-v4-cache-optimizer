import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 模組 1：純淨版日誌記錄器
// ==========================================
const Logger = {
    log: (msg) => {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const logStr = `[${time}] ✅ ${msg}`;
        console.log(`%c[DS Optimizer] ${logStr}`, 'color: #00ff00; font-weight: bold;');
        appendLogToUI(logStr);
    },
    warn: (msg) => {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const logStr = `[${time}] ⚠️ ${msg}`;
        console.log(`%c[DS Optimizer] ${logStr}`, 'color: #ffaa00; font-weight: bold;');
        appendLogToUI(logStr);
    },
    error: (msg, err) => {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        const logStr = `[${time}] 🔴 ${msg}`;
        console.error(`[DS Optimizer] ${logStr}`, err);
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

const CacheState = {
    enabled: true,
    lastStaticBase: null
};

// ==========================================
// 模組 2：絕對純淨分離法 (Absolute Sieve Algorithm)
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun || !data.chat || data.chat.length === 0) return; 

    try {
        Logger.log("==========================================");
        Logger.log("啟動攔截：執行【絕對純淨分離法】");
        
        // 1. 處理並凍結 System Core (Index 0)
        const coreMsg = data.chat[0];
        if (coreMsg.role === 'system') {
            if (!CacheState.lastStaticBase) {
                CacheState.lastStaticBase = coreMsg.content;
                Logger.log("已鎖定系統核心緩存 (20k+ tokens 保證命中)。");
            } else {
                // 防呆：如果用戶大改了角色卡(差異>20%)，自動重置核心
                const diffRatio = Math.abs(coreMsg.content.length - CacheState.lastStaticBase.length) / Math.max(coreMsg.content.length, 1);
                if (diffRatio > 0.2) {
                    CacheState.lastStaticBase = coreMsg.content;
                    Logger.warn("偵測到系統核心發生重大變更，已自動重置緩存基底！");
                }
            }
        }

        const dynamicSystems = [];
        const dialogue = [];

        // 2. 嚴格分離歷史對話與動態系統訊息
        for (let i = (coreMsg.role === 'system' ? 1 : 0); i < data.chat.length; i++) {
            const msg = data.chat[i];
            if (msg.role === 'system') {
                // 將隨機出現的世界書、動態記憶抽取出來
                dynamicSystems.push(msg);
            } else {
                // 深拷貝保留純淨歷史，絕不修改任何一個字！
                dialogue.push({ role: msg.role, content: msg.content, name: msg.name });
            }
        }

        // 3. 【核心自適應】動態尾部分割
        // 無論你的預設是 "嘿嘿..." 還是其他東西，無論擴寫指令多長，
        // 只要是從底部連續的 user 和 assistant，統統被判定為「當前回合尾部」
        let splitIndex = dialogue.length;
        
        // 往回跳過結尾的 AI 預填充 (如：嘿嘿，要求閱讀完畢...)
        while (splitIndex > 0 && dialogue[splitIndex - 1].role === 'assistant') {
            splitIndex--;
        }
        // 往回跳過結尾的 User 輸入 (如：253t 擴寫指令、用戶當前對話)
        while (splitIndex > 0 && dialogue[splitIndex - 1].role === 'user') {
            splitIndex--;
        }

        const pureHistory = dialogue.slice(0, splitIndex);
        const currentTurnTail = dialogue.slice(splitIndex);

        // 4. 重組為 100% Cache 友好的陣列
        const finalChat = [];
        
        // [模塊 A] 絕對凍結的核心
        if (coreMsg.role === 'system') {
            finalChat.push({ role: 'system', content: CacheState.lastStaticBase, name: coreMsg.name });
        }
        
        // [模塊 B] 原汁原味的歷史對話 (位置與內容永遠不變，前綴完美命中！)
        finalChat.push(...pureHistory);
        
        // [模塊 C] 動態沉澱區 (把世界書等不穩定的因素全壓到最底下，避免污染歷史緩存)
        if (dynamicSystems.length > 0) {
            finalChat.push(...dynamicSystems);
            Logger.log(`已將 ${dynamicSystems.length} 條世界書/動態記憶沉澱至底部安全區。`);
        }
        
        // [模塊 D] 當前回合的觸發與預填充
        finalChat.push(...currentTurnTail);

        // 5. 原地覆寫請求陣列
        data.chat.splice(0, data.chat.length, ...finalChat);
        Logger.log(`重組完畢！歷史陣列已達最優化追加結構 (區塊數: ${data.chat.length})`);
        
    } catch (err) {
        Logger.error("致命錯誤！已取消優化。", err);
    }
}

// ==========================================
// 模組 3：內建折疊式 UI 介面 (修復列表不齊齊的問題)
// ==========================================
async function setupUI() {
    try {
        Logger.log("初始化 UI...");
        
        // 移除 Emoji 與標籤，完全採用酒館原生樣式，保證列表左側對齊
        const uiHTML = `
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Deepseek V4 Cache Optimizer</b>
                    <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="padding: 10px;">
                    <p style="font-size: 0.85em; opacity: 0.8; margin-top: 0; margin-bottom: 15px;">採用「絕對純淨分離法」，將動態世界書壓入底層，實現最高極限的 KV Cache 命中率。</p>
                    
                    <div style="margin-bottom: 15px;">
                        <label class="checkbox_label" style="display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="ds-cache-enable" checked> 
                            <span>啟用緩存優化器</span>
                        </label>
                    </div>
                    
                    <button id="ds-cache-reset" class="menu_button" style="width: 100%; display: block; margin-bottom: 15px; padding: 10px; text-align: center;">
                        🔄 強制重置系統核心緩存
                    </button>
                    
                    <div>
                        <div style="font-weight: bold; margin-bottom: 5px; font-size: 0.9em;">排錯日誌 (Debug Logs):</div>
                        <textarea id="ds-cache-log" class="text_pole" readonly style="width: 100%; height: 220px; font-family: monospace; font-size: 11px; padding: 8px; box-sizing: border-box;"></textarea>
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
            Logger.warn("用戶手動觸發：已清空核心緩存！下一回合將重新鎖定！");
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
        console.log("Deepseek Optimizer is loading...");
        await setupUI();
        
        if (eventSource && event_types && event_types.CHAT_COMPLETION_PROMPT_READY) {
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
            Logger.log("成功掛載發送前鉤子");
        }
    } catch (err) {
        Logger.error("擴展加載過程發生致命錯誤！", err);
    }
});
