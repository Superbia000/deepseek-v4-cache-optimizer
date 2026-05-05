import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 模組 1：顯眼且詳盡的 Debug 排錯記錄器
// ==========================================
const Logger = {
    log: (msg, ...args) => {
        const time = new Date().toISOString();
        const logStr = `[${time}] [DS V4 Optimizer] [INFO] ✅ ${msg}`;
        console.log(`%c${logStr}`, 'color: #00ff00; font-weight: bold;', ...args);
        appendLogToUI(logStr);
    },
    error: (msg, err) => {
        const time = new Date().toISOString();
        const errorDetail = err?.stack || err?.message || err || "Unknown Error";
        const logStr = `[${time}] [DS V4 Optimizer] [ERROR] 🔴 ${msg} | 詳細: ${errorDetail}`;
        console.error(`%c${logStr}`, 'color: #ff0000; font-weight: bold; font-size: 14px;', err);
        appendLogToUI(logStr);
    },
    debug: (msg, ...args) => {
        const time = new Date().toISOString();
        const logStr = `[${time}] [DS V4 Optimizer] [DEBUG] 🟡 ${msg}`;
        console.log(`%c${logStr}`, 'color: #00ffff;', ...args);
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
    lastStaticBase: null,
    turnCount: 0
};

// ==========================================
// 模組 2：核心攔截與緩存重組算法 (終極凍結版)
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return; 

    try {
        Logger.log("==========================================");
        Logger.log("啟動攔截器：捕獲最終提示詞陣列");
        
        if (!data || !Array.isArray(data.chat) || data.chat.length === 0) return;

        const originalMessages = [...data.chat];
        Logger.debug(`原始陣列長度: ${originalMessages.length} 個區塊`);

        // 1. 尾部精準剝離：分離出 AI Prefill 與 當前用戶輸入
        const prefillMessages = [];
        // 只要尾部是 assistant，就代表是 ST 的預填充或強制開頭
        while (originalMessages.length > 0 && originalMessages[originalMessages.length - 1].role === 'assistant') {
            prefillMessages.unshift(originalMessages.pop());
        }
        
        let lastUserMessage = null;
        // 緊接著的最後一個 user 必定是「當前用戶輸入」
        if (originalMessages.length > 0 && originalMessages[originalMessages.length - 1].role === 'user') {
            lastUserMessage = originalMessages.pop();
        }

        Logger.debug(`已剝離尾部: ${lastUserMessage ? '1個當前用戶輸入' : '無用戶輸入'}, ${prefillMessages.length}個AI預填充`);

        // 2. 分離 System 與 歷史對話 (pureChatHistory)
        const systemLines = [];
        const pureChatHistory = [];
        originalMessages.forEach((msg) => {
            if (msg.role === 'system') {
                systemLines.push(msg.content);
            } else {
                pureChatHistory.push(msg);
            }
        });

        const currentSystemText = systemLines.join('\n');
        let dynamicSuffix = "";

        // 3. 【核心突破】絕對零度凍結算法
        if (!CacheState.lastStaticBase) {
            Logger.log("初始回合：已鎖定並凍結 System 靜態核心 (防禦時間/宏替換破壞緩存)");
            CacheState.lastStaticBase = currentSystemText;
        }

        // 檢查 System 核心是否有「巨大改變」(如切換角色卡)
        const newLines = currentSystemText.split('\n');
        const oldLinesSet = new Set(CacheState.lastStaticBase.split('\n').map(l => l.trim()));
        
        let commonCount = 0;
        const dynamicLines = [];
        for (const line of newLines) {
            if (line.trim() === '') continue;
            if (oldLinesSet.has(line.trim())) {
                commonCount++;
            } else {
                dynamicLines.push(line); // 抓出所有臨時插入的世界書或動態記憶
            }
        }

        const similarity = commonCount / Math.max(newLines.length, 1);
        Logger.debug(`System 核心相似度: ${(similarity * 100).toFixed(2)}%`);

        if (similarity < 0.3) {
            Logger.log("⚠️ 偵測到 System 發生巨變 (相似度低於30%)，自動重置靜態核心！");
            CacheState.lastStaticBase = currentSystemText;
            dynamicSuffix = ""; 
        } else {
            // 只要相似，我們就強制發送「被凍結的原始 Core」，這樣前綴絕對 100% 匹配！
            dynamicSuffix = dynamicLines.join('\n');
        }

        // 4. 重組為完美的前綴緩存陣列
        const newMessages = [];
        
        // [Index 0]: 被絕對凍結的系統設定 (20k+ tokens 完美命中)
        if (CacheState.lastStaticBase.trim().length > 0) {
            newMessages.push({ role: 'system', content: CacheState.lastStaticBase });
        }
        
        // [Index 1 ~ N]: 歷史對話 (位置永遠不變，前綴持續延伸)
        newMessages.push(...pureChatHistory);
        
        // [Index N+1]: 最新回合用戶的輸入
        if (lastUserMessage) {
            newMessages.push(lastUserMessage);
        }

        // [Index N+2]: 所有世界書與動態內容 (強制放在用戶輸入之後，絕不污染歷史對話的前綴！)
        if (dynamicSuffix.trim().length > 0) {
            newMessages.push({ role: 'system', content: `[System Note / Dynamic Info / World Info]:\n${dynamicSuffix}` });
            Logger.debug(`已將 ${dynamicLines.length} 行動態內容掛載至安全區底端！`);
        }

        // [Index N+3]: AI 預填充
        newMessages.push(...prefillMessages);

        // 5. 原地覆寫請求陣列
        data.chat.splice(0, data.chat.length, ...newMessages);
        
        CacheState.turnCount++;
        Logger.log(`✅ 重組完成！已覆寫 ST 的發送陣列 (總區塊數: ${data.chat.length})`);
        
    } catch (err) {
        Logger.error("致命錯誤：攔截與重組過程中發生崩潰！", err);
    }
}

// ==========================================
// 模組 3：內建折疊式 UI 介面 (修復 CSS 擠壓問題)
// ==========================================
async function setupUI() {
    try {
        Logger.log("初始化 UI...");
        
        const uiHTML = `
            <div class="inline-drawer" id="ds-v4-optimizer-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>🧠 Deepseek V4 Cache Optimizer</b>
                    <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="padding: 10px; background: rgba(0,0,0,0.1); border-radius: 5px;">
                    <p style="font-size: 0.9em; opacity: 0.8; margin-top: 0; margin-bottom: 15px;">強制分離靜態與動態提示詞，鎖定核心防止宏替換破壞緩存。</p>
                    
                    <div style="margin-bottom: 15px;">
                        <label class="checkbox_label" style="display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="ds-cache-enable" checked> 
                            <span>啟用緩存攔截與重組</span>
                        </label>
                    </div>
                    
                    <button id="ds-cache-reset" class="menu_button" style="width: 100%; display: block; margin-bottom: 15px; padding: 10px; text-align: center;">
                        🔄 強制重置靜態緩存核心
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
            CacheState.turnCount = 0;
            Logger.log("已清空緩存核心！下一回合將重新抓取並凍結靜態基底！");
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
        } else {
            throw new Error("找不到 CHAT_COMPLETION_PROMPT_READY 事件源！");
        }
    } catch (err) {
        Logger.error("擴展加載過程發生致命錯誤！", err);
    }
});
