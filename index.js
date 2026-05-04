import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 模組 1：顯眼且詳盡的 Debug 排錯記錄器
// ==========================================
const Logger = {
    log: (msg, ...args) => {
        const time = new Date().toISOString();
        const logStr = `[${time}] [DS V4 Optimizer] [INFO] ${msg}`;
        console.log(`%c${logStr}`, 'color: #00ff00; font-weight: bold;', ...args);
        appendLogToUI(logStr);
    },
    error: (msg, err) => {
        const time = new Date().toISOString();
        const errorDetail = err?.stack || err?.message || err || "Unknown Error";
        const logStr = `[${time}] [DS V4 Optimizer] [ERROR] 🔴 ${msg} | 詳細錯誤: ${errorDetail}`;
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
// 模組 2：核心攔截與緩存重組算法 (適配 1.17.0 payload)
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled) return;
    
    // 如果是酒館內部的 Token 計算(Dry Run)，則略過以免污染日誌
    if (data.dryRun) return; 

    try {
        Logger.log("==========================================");
        Logger.log("啟動攔截器：捕獲到 CHAT_COMPLETION_PROMPT_READY 事件");
        
        // 在 ST 1.17.0 中，最終組裝好的陣列存放在 data.chat
        if (!data || !Array.isArray(data.chat)) {
            Logger.error("攔截失敗：找不到 data.chat 陣列，可能非 Chat Completion 請求。");
            return;
        }

        const originalMessages = data.chat;
        Logger.debug(`原始陣列長度: ${originalMessages.length} 個 Message 區塊`);

        if (originalMessages.length === 0) return;

        // 1. 拆解陣列：將最後一條消息（當前用戶輸入）分離
        const finalMessage = originalMessages.pop(); 
        Logger.debug(`已分離最終觸發消息, Role: ${finalMessage.role}`);

        const systemLines = [];
        const pureChatHistory = [];

        // 2. 剝離所有 System 消息 (無視酒館或世界書的原本插入深度)
        originalMessages.forEach((msg) => {
            if (msg.role === 'system') {
                systemLines.push(msg.content);
            } else {
                pureChatHistory.push(msg);
            }
        });

        // 3. 執行「Converging Static Core」差分算法
        const currentSystemText = systemLines.join('\n');
        let staticCore = "";
        let dynamicSuffix = "";

        if (!CacheState.lastStaticBase) {
            Logger.log("初始回合：將當前所有 System 設定為靜態核心。");
            CacheState.lastStaticBase = currentSystemText;
            staticCore = currentSystemText;
        } else {
            Logger.debug("執行文本差異 (Diffing) 算法...");
            const oldLines = CacheState.lastStaticBase.split('\n');
            const newLines = currentSystemText.split('\n');
            const oldLinesSet = new Set(oldLines.map(l => l.trim()));
            
            const commonLines = [];
            const dynamicLines = [];

            for (const line of newLines) {
                if (line.trim() === '') continue; 
                if (oldLinesSet.has(line.trim())) {
                    commonLines.push(line);
                } else {
                    dynamicLines.push(line);
                }
            }

            const similarity = commonLines.length / Math.max(newLines.length, 1);
            Logger.debug(`System 核心相似度: ${(similarity * 100).toFixed(2)}%`);

            if (similarity < 0.15 && newLines.length > 5) {
                Logger.log("⚠️ System 內容巨變，自動重置靜態核心！");
                CacheState.lastStaticBase = currentSystemText;
                staticCore = currentSystemText;
            } else {
                staticCore = commonLines.join('\n');
                dynamicSuffix = dynamicLines.join('\n');
                CacheState.lastStaticBase = staticCore; 
            }
        }

        // 4. 重組為完美的前綴緩存陣列
        const newMessages = [];
        if (staticCore.trim().length > 0) {
            newMessages.push({ role: 'system', content: staticCore });
        }
        newMessages.push(...pureChatHistory);
        if (dynamicSuffix.trim().length > 0) {
            // 將世界書與其他插件的動態插入強制轉移到陣列最底部！
            newMessages.push({ role: 'system', content: `[System Note / Dynamic Info]:\n${dynamicSuffix}` });
            Logger.debug("已將動態內容成功掛載至陣列底部！");
        }
        newMessages.push(finalMessage);

        // 5. 【關鍵技術】使用 splice 進行 in-place(原地) 修改，覆寫即將發送出去的 payload
        data.chat.splice(0, data.chat.length, ...newMessages);
        
        CacheState.turnCount++;
        Logger.log(`✅ 重組完成！已覆寫 ST 的發送陣列 (總區塊數: ${data.chat.length})`);
        
    } catch (err) {
        Logger.error("致命錯誤：攔截與重組過程中發生崩潰！已取消優化。", err);
    }
}

// ==========================================
// 模組 3：內建折疊式 UI 介面 (SillyTavern 原生樣式)
// ==========================================
async function setupUI() {
    try {
        Logger.log("初始化 SillyTavern 折疊擴展 UI...");
        
        // 使用 ST 原生的 inline-drawer (折疊菜單) 類別，完美解決排版擠壓問題
        const uiHTML = `
            <div class="inline-drawer" id="ds-v4-optimizer-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>🧠 Deepseek V4 Cache Optimizer</b>
                    <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="padding-top: 10px; display: flex; flex-direction: column; gap: 10px;">
                    <p style="font-size: 0.9em; opacity: 0.8; margin: 0;">強制分離靜態與動態提示詞，將動態記憶移至底部以達到極致的 KV Cache 命中率。</p>
                    
                    <label class="checkbox_label">
                        <input type="checkbox" id="ds-cache-enable" checked> 
                        <span>啟用緩存攔截與重組</span>
                    </label>
                    
                    <div class="menu_button_step" style="margin-top: 5px;">
                        <button id="ds-cache-reset" class="menu_button">🔄 強制重置靜態緩存核心</button>
                    </div>
                    
                    <div style="margin-top: 5px;">
                        <label style="font-weight: bold; margin-bottom: 5px; display: block;">排錯日誌 (Debug Logs):</label>
                        <textarea id="ds-cache-log" readonly style="width: 100%; height: 200px; background-color: #1e1e1e; color: #4af626; font-family: monospace; font-size: 11px; padding: 8px; border: 1px solid var(--SmartThemeBorderColor, #555); border-radius: 4px; resize: vertical; box-sizing: border-box;"></textarea>
                    </div>
                </div>
            </div>
        `;
        
        // 將 UI 注入到擴展清單的尾部
        $('#extensions_settings').append(uiHTML);

        uiLogTextarea = document.getElementById('ds-cache-log');
        
        $('#ds-cache-enable').on('change', function() {
            CacheState.enabled = $(this).is(':checked');
            Logger.log(`插件狀態已更改: ${CacheState.enabled ? "啟用" : "停用"}`);
        });

        $('#ds-cache-reset').on('click', function() {
            CacheState.lastStaticBase = null;
            CacheState.turnCount = 0;
            Logger.log("用戶手動觸發：已清空緩存核心，下一回合將重新抓取靜態基底！");
        });

        Logger.log("UI 介面加載並綁定完成。");
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
        
        // 核心鉤子：完美攔截 ST 1.17.0 的 CHAT_COMPLETION_PROMPT_READY
        if (eventSource && event_types && event_types.CHAT_COMPLETION_PROMPT_READY) {
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
            Logger.log("✅ 成功掛載 CHAT_COMPLETION_PROMPT_READY 事件鉤子");
        } else {
            throw new Error("找不到 CHAT_COMPLETION_PROMPT_READY 事件源！");
        }
    } catch (err) {
        Logger.error("擴展加載過程發生致命錯誤！", err);
    }
});
