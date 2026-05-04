import { extension_settings, getContext } from '../../../extensions.js';

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
    lastStaticBase: null,
    turnCount: 0
};

// ==========================================
// 模組 2：Prompt Interceptor (提示詞攔截與重組核心)
// ==========================================
// 依據 ST 官方文檔，攔截器必須是全局函數 (globalThis)，並接收 chat (陣列) 與 contextSize (數字)
globalThis.deepseekV4CacheOptimizerInterceptor = async function (chat, contextSize) {
    if (!CacheState.enabled) return;

    try {
        Logger.log("==========================================");
        Logger.log(`啟動攔截器：Prompt Interceptor 成功接管發送前陣列 (預估 Tokens: ${contextSize})`);
        
        if (!Array.isArray(chat) || chat.length === 0) {
            Logger.debug("Chat 陣列為空，跳過處理。");
            return;
        }

        Logger.debug(`原始陣列長度: ${chat.length} 個 Message 區塊`);

        // 1. 拆解陣列：將最後一條消息（通常是當前用戶輸入）分離
        const finalMessage = chat.pop(); 
        Logger.debug(`已分離最終觸發消息, Role: ${finalMessage.role}`);

        const systemLines = [];
        const pureChatHistory = [];

        // 2. 遍歷剩餘的所有消息，無情剝離所有 System (世界書、設定、預設) 與歷史對話
        chat.forEach((msg) => {
            if (msg.role === 'system') {
                systemLines.push(msg.content);
            } else {
                pureChatHistory.push(msg);
            }
        });

        Logger.debug(`成功分離出 ${pureChatHistory.length} 條歷史對話, 與 ${systemLines.length} 個系統提示區塊`);

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

            for (const line of newLines) {
                if (line.trim() === '') continue; // 忽略純空行
                if (oldLinesSet.has(line.trim())) {
                    commonLines.push(line);
                } else {
                    dynamicLines.push(line);
                }
            }

            const similarity = commonLines.length / Math.max(newLines.length, 1);
            Logger.debug(`System 核心相似度: ${(similarity * 100).toFixed(2)}%`);

            // 防呆：如果設定大改（例如切換角色或換卡），自動重置緩存基底
            if (similarity < 0.15 && newLines.length > 5) {
                Logger.log("⚠️ 偵測到 System 內容發生重大變更，自動重置靜態核心！");
                CacheState.lastStaticBase = currentSystemText;
                staticCore = currentSystemText;
            } else {
                staticCore = commonLines.join('\n');
                dynamicSuffix = dynamicLines.join('\n');
                CacheState.lastStaticBase = staticCore; // 讓核心不斷收斂逼近純靜態
                Logger.log(`Diff 完畢：靜態核心 ${commonLines.length} 行，動態後置(世界書/記憶) ${dynamicLines.length} 行`);
            }
        }

        // 4. 原地修改 Chat 陣列 (SillyTavern 官方允許 Mutable In-Place 修改)
        chat.length = 0; // 瞬間清空原本未優化的陣列
        
        // [Index 0]: 絕對不變的系統設定
        if (staticCore.trim().length > 0) {
            chat.push({ role: 'system', content: staticCore });
        }

        // [Index 1 ~ N]: 乾淨的用戶與 AI 的對話歷史
        chat.push(...pureChatHistory);

        // [Index N+1]: 所有動態內容 (世界書、動態記憶) 強制掛載在底部！
        if (dynamicSuffix.trim().length > 0) {
            chat.push({ role: 'system', content: `[System Note / Memory / World Info]:\n${dynamicSuffix}` });
            Logger.debug("已將動態內容 (World Info/Memory) 成功掛載至陣列底部！");
        }

        // [Index N+2]: 最新回合用戶的輸入
        chat.push(finalMessage);

        CacheState.turnCount++;
        Logger.log(`✅ 重組完成！已輸出高度適應緩存的陣列 (總區塊數: ${chat.length})`);
        
    } catch (err) {
        Logger.error("致命錯誤：攔截與重組過程中發生崩潰！", err);
    }
};

// ==========================================
// 模組 3：純淨無特效的內置 UI 介面
// ==========================================
async function setupUI() {
    try {
        Logger.log("正在初始化 SillyTavern 擴展 UI...");
        
        const uiHTML = `
            <div id="deepseek-v4-cache-optimizer" class="drawer-content">
                <h3>🧠 Deepseek V4 Cache Optimizer</h3>
                <p>強制分離靜態與動態提示詞，將動態記憶移至底部以達到極致的 KV Cache 命中率。</p>
                
                <div class="flex-container alignitemscenter" style="margin-bottom: 10px;">
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
        console.log("Deepseek V4 Cache Optimizer is loading...");
        await setupUI();
        Logger.log("✅ 擴展加載成功！攔截器已透過 manifest.json 註冊就緒，隨時準備接管對話。");
    } catch (err) {
        Logger.error("擴展加載過程發生致命錯誤！", err);
    }
});
