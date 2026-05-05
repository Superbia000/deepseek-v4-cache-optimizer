import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// ==========================================
// 模組 1：原生排錯記錄器
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
        const logStr = `[${time}] ⚠️ ${msg}`;
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

// 緩存狀態機
const CacheState = {
    enabled: true,
    lastStaticBase: null, // 絕對凍結的 System 頂部核心
};

// ==========================================
// 模組 2：絕對純淨算法 (Absolute Pure Pipeline)
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return; 

    try {
        Logger.log("==========================================");
        Logger.log("啟動攔截：執行【絕對純淨歷史算法】");
        
        if (!data || !Array.isArray(data.chat) || data.chat.length === 0) return;

        const topSystemBlocks = [];
        const dynamicSystemBlocks = [];
        const pureChatHistory = [];
        
        // 1. 陣列大分類：嚴格剝離，但不修改任何內容
        let isTop = true;
        for (const msg of data.chat) {
            if (msg.role === 'system') {
                if (isTop) {
                    topSystemBlocks.push(msg.content);
                } else {
                    // 亂竄的世界書或動態記憶
                    dynamicSystemBlocks.push(msg.content); 
                }
            } else {
                isTop = false;
                // 歷史對話 (User/Assistant)，絕對不修改其內部文字
                pureChatHistory.push({ ...msg }); 
            }
        }

        const currentSystemText = topSystemBlocks.join('\n\n');

        // 2. 核心凍結防禦機制
        if (!CacheState.lastStaticBase) {
            CacheState.lastStaticBase = currentSystemText;
            Logger.log("初始回合：已鎖定並凍結 100% 靜態 System 核心。");
        } else {
            // 相似度檢測：防止用戶徹底更換角色卡導致崩潰
            const newLen = currentSystemText.length;
            const oldLen = CacheState.lastStaticBase.length;
            const ratio = Math.min(newLen, oldLen) / Math.max(newLen, oldLen);
            
            if (ratio < 0.4) {
                Logger.warn("偵測到 System 核心發生巨變 (更換角色卡?)，已自動重置核心！");
                CacheState.lastStaticBase = currentSystemText;
            }
        }

        // 3. 尋找世界書的安全插入點 (最新用戶輸入的正上方)
        // 這樣可以保證世界書絕對不會污染過去的歷史對話前綴
        let insertIndex = pureChatHistory.length - 1;
        while (insertIndex >= 0 && pureChatHistory[insertIndex].role !== 'user') {
            insertIndex--;
        }
        if (insertIndex < 0) insertIndex = pureChatHistory.length; // 防呆設計

        // 4. 重組終極 100% 緩存陣列
        const finalMessages = [
            { role: 'system', content: CacheState.lastStaticBase } // [Index 0] 絕對不變
        ];

        for (let i = 0; i < pureChatHistory.length; i++) {
            // 在最新的用戶輸入上方，插入被剝離的世界書
            if (i === insertIndex && dynamicSystemBlocks.length > 0) {
                finalMessages.push({
                    role: 'system',
                    content: `[World Info / Dynamic Note]:\n${dynamicSystemBlocks.join('\n\n')}`
                });
                Logger.log(`已將 ${dynamicSystemBlocks.length} 塊動態世界書掛載至最新對話上方。`);
            }
            finalMessages.push(pureChatHistory[i]); // [Index 1~N] 歷史對話完美追加
        }

        // 異常情況處理：如果沒有找到 user 區塊，直接掛在最底
        if (insertIndex === pureChatHistory.length && dynamicSystemBlocks.length > 0) {
            finalMessages.push({
                role: 'system',
                content: `[World Info / Dynamic Note]:\n${dynamicSystemBlocks.join('\n\n')}`
            });
        }

        // 5. 覆寫 ST 的發送陣列
        data.chat.splice(0, data.chat.length, ...finalMessages);
        Logger.log(`重組完成！歷史區塊保持 100% 零修改 (總區塊數: ${data.chat.length})`);
        
    } catch (err) {
        Logger.error("致命錯誤！已取消優化。", err);
    }
}

// ==========================================
// 模組 3：內建折疊式 UI 介面 (原生 ST 風格)
// ==========================================
async function setupUI() {
    try {
        Logger.log("初始化 UI...");
        
        const uiHTML = `
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <span style="font-weight: 600;">Deepseek V4 Cache Optimizer</span>
                    <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="padding: 10px; background: rgba(0,0,0,0.1); border-radius: 5px;">
                    <p style="font-size: 0.85em; opacity: 0.8; margin-top: 0; margin-bottom: 15px;">🧠 採用「絕對純淨歷史算法」，零修改對話內容，只剝離世界書與凍結核心，實現極致前綴命中。</p>
                    
                    <div style="margin-bottom: 15px;">
                        <label class="checkbox_label" style="display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="ds-cache-enable" checked> 
                            <span>啟用緩存優化器</span>
                        </label>
                    </div>
                    
                    <button id="ds-cache-reset" class="menu_button" style="width: 100%; display: block; margin-bottom: 15px; padding: 10px; text-align: center;">
                        🔄 手動重置靜態核心
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
            Logger.warn("已清空緩存核心！下一回合將重新抓取！");
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
