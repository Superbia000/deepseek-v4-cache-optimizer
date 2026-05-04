import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 模組 1：顯眼且詳盡的 Debug 排錯記錄器
// ==========================================
const Logger = {
    log: (msg, ...args) => {
        const time = new Date().toISOString();
        const logStr = `[${time}] [Deepseek V4 Optimizer] [INFO] ${msg}`;
        console.log(`%c${logStr}`, 'color: #00ff00; font-weight: bold;', ...args);
        appendLogToUI(logStr);
    },
    error: (msg, err) => {
        const time = new Date().toISOString();
        const errorDetail = err?.stack || err?.message || err || "Unknown Error";
        const logStr = `[${time}] [Deepseek V4 Optimizer] [ERROR] 🔴 ${msg} | 詳細錯誤: ${errorDetail}`;
        console.error(`%c${logStr}`, 'color: #ff0000; font-weight: bold; font-size: 14px;', err);
        appendLogToUI(logStr);
    },
    debug: (msg, ...args) => {
        const time = new Date().toISOString();
        const logStr = `[${time}] [Deepseek V4 Optimizer] [DEBUG] 🟡 ${msg}`;
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

// 緩存狀態機
const CacheState = {
    enabled: true,
    lastStaticBase: null, // 用於記錄絕對靜態的 System 核心
    turnCount: 0
};

// ==========================================
// 模組 2：核心攔截與緩存重組算法 (深度思考實現)
// ==========================================
function interceptAndRestructurePrompt(requestData) {
    if (!CacheState.enabled) return;

    try {
        Logger.log("==========================================");
        Logger.log("啟動攔截器：捕獲到 BEFORE_API_REQUEST 事件");
        
        if (!requestData || !Array.isArray(requestData.messages)) {
            Logger.error("攔截失敗：requestData.messages 不是陣列，可能非 Chat Completion API", JSON.stringify(requestData));
            return;
        }

        const originalMessages = requestData.messages;
        Logger.debug(`原始陣列長度: ${originalMessages.length} 個 Message 區塊`);

        if (originalMessages.length === 0) {
            Logger.debug("陣列為空，跳過處理。");
            return;
        }

        // 1. 拆解陣列：將最後一條消息（通常是當前用戶輸入）分離
        const finalMessage = originalMessages.pop(); 
        Logger.debug(`已分離最終觸發消息, Role: ${finalMessage.role}`);

        const systemLines = [];
        const pureChatHistory = [];

        // 2. 遍歷剩餘的所有消息，無情剝離所有 System 與 Chat History
        originalMessages.forEach((msg, index) => {
            if (msg.role === 'system') {
                systemLines.push(msg.content);
            } else {
                pureChatHistory.push(msg);
            }
        });

        Logger.debug(`成功分離出 ${pureChatHistory.length} 條歷史對話, 與 ${systemLines.length} 條系統提示詞區塊`);

        // 3. 執行「Converging Static Core」自適應差分算法
        const currentSystemText = systemLines.join('\n');
        let staticCore = "";
        let dynamicSuffix = "";

        if (!CacheState.lastStaticBase) {
            Logger.log("初始回合 (或緩存被重置)：將當前所有 System 設定為靜態核心。");
            CacheState.lastStaticBase = currentSystemText;
            staticCore = currentSystemText;
        } else {
            Logger.debug("開始執行文本差異 (Diffing) 算法對比上一回合...");
            const oldLines = CacheState.lastStaticBase.split('\n');
            const newLines = currentSystemText.split('\n');

            const oldLinesSet = new Set(oldLines.map(l => l.trim()));
            const commonLines = [];
            const dynamicLines = [];

            // 逐行比對，分離出「固定不變的設定」與「臨時觸發的世界書/記憶」
            for (const line of newLines) {
                if (line.trim() === '') continue; // 忽略純空行以防擾亂比對
                if (oldLinesSet.has(line.trim())) {
                    commonLines.push(line);
                } else {
                    dynamicLines.push(line);
                }
            }

            // 計算相似度，防呆機制：如果用戶徹底切換角色，相似度會極低，需自動重置
            const similarity = commonLines.length / Math.max(newLines.length, 1);
            Logger.debug(`System 核心相似度: ${(similarity * 100).toFixed(2)}%`);

            if (similarity < 0.15 && newLines.length > 5) {
                Logger.log("⚠️ 偵測到 System 內容發生重大變更 (低於15%)，自動重置靜態核心以防上下文崩潰！");
                CacheState.lastStaticBase = currentSystemText;
                staticCore = currentSystemText;
            } else {
                staticCore = commonLines.join('\n');
                dynamicSuffix = dynamicLines.join('\n');
                
                // 【核心奧義】：讓 staticCore 不斷收斂，剔除偶發的世界書，最終達到 100% 絕對靜態！
                CacheState.lastStaticBase = staticCore; 
                
                Logger.log(`Diff 完畢：靜態核心行數 ${commonLines.length}，動態後置行數 (世界書/插件插入) ${dynamicLines.length}`);
            }
        }

        // 4. 重組為 Deepseek V4 Pro 絕對完美的 Prefix-Cache 陣列
        const newMessages = [];
        
        // [Index 0]: 絕對不變的系統設定
        if (staticCore.trim().length > 0) {
            newMessages.push({ role: 'system', content: staticCore });
        }

        // [Index 1 ~ N]: 用戶與 AI 的對話歷史 (完美保留深度，即使用戶刪除了某句話，也依然符合前綴命中！)
        newMessages.push(...pureChatHistory);

        // [Index N+1]: 所有被剝離出來的動態內容 (觸發的世界書、動態記憶，統統放在最下方！)
        if (dynamicSuffix.trim().length > 0) {
            newMessages.push({ role: 'system', content: `[System Note / Memory / World Info]:\n${dynamicSuffix}` });
            Logger.debug("已將動態內容 (World Info/Memory) 成功掛載至陣列底部！");
        }

        // [Index N+2]: 最新回合用戶的輸入
        newMessages.push(finalMessage);

        // 5. 覆寫請求
        requestData.messages = newMessages;
        CacheState.turnCount++;
        Logger.log(`✅ 重組完成！已輸出高度適應 Deepseek V4 Pro 緩存的陣列 (總區塊數: ${newMessages.length})`);
        
    } catch (err) {
        Logger.error("致命錯誤：攔截與重組過程中發生崩潰！已取消此次優化，將使用原生發送。", err);
    }
}

// ==========================================
// 模組 3：純淨無特效的內置 UI 介面
// ==========================================
async function setupUI() {
    try {
        Logger.log("正在初始化 SillyTavern 擴展 UI...");
        
        // 核心 UI 結構 (純潔無特效)
        const uiHTML = `
            <div id="deepseek-v4-cache-optimizer" class="drawer-content">
                <h3>🧠 Deepseek V4 Cache Optimizer</h3>
                <p>強制分離靜態與動態提示詞，將動態記憶移至底部以達到極致的 KV Cache 命中率。</p>
                
                <div class="flex-container alignitemscenter">
                    <label class="checkbox_label">
                        <input type="checkbox" id="ds-cache-enable" checked> 
                        啟用緩存攔截與重組
                    </label>
                </div>
                
                <div class="menu_button_step">
                    <button id="ds-cache-reset" class="menu_button">🔄 強制重置靜態緩存核心</button>
                </div>
                
                <div style="margin-top: 10px;">
                    <label style="font-weight: bold; margin-bottom: 5px; display: block;">排錯日誌 (Debug Logs):</label>
                    <textarea id="ds-cache-log" readonly></textarea>
                </div>
            </div>
        `;
        
        // 注入到擴展面板
        $('#extensions_settings').append(uiHTML);
        uiLogTextarea = document.getElementById('ds-cache-log');
        
        // 綁定事件
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
        console.log("Deepseek V4 Pro Cache Optimizer is loading...");
        await setupUI();
        
        // 核心鉤子：攔截 BEFORE_API_REQUEST
        if (eventSource && event_types && event_types.BEFORE_API_REQUEST) {
            eventSource.on(event_types.BEFORE_API_REQUEST, interceptAndRestructurePrompt);
            Logger.log("✅ 成功掛載 event_types.BEFORE_API_REQUEST 事件鉤子");
        } else {
            throw new Error("SillyTavern 版本不匹配，找不到 event_types.BEFORE_API_REQUEST 事件源！");
        }
    } catch (err) {
        Logger.error("擴展加載過程發生致命錯誤！", err);
    }
});
