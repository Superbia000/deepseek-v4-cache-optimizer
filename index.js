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
        const logStr = `[${time}] 🌪️ ${msg}`;
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

// 核心狀態機：存儲跨回合記憶
const CacheState = {
    enabled: true,
    lastStaticBase: null,        // 凍結的系統核心
    blackHoleCore: "",           // 吸收所有浮動 Jailbreak 的黑洞
    knownFloats: new Set(),      // 已確認為浮動提示詞的特徵庫
    lastBottomBlocks: []         // 上一回合底部的區塊特徵
};

// ==========================================
// 模組 2：黑洞合併算法 (Black Hole Merging)
// ==========================================
function interceptAndRestructurePrompt(data) {
    if (!CacheState.enabled || data.dryRun) return; 

    try {
        Logger.log("==========================================");
        Logger.log("啟動攔截器：執行黑洞合併與絕對對齊");
        
        if (!data || !Array.isArray(data.chat) || data.chat.length === 0) return;

        const originalMessages = [...data.chat];
        
        // 1. 剝離 AI 預填充 (Prefill)
        const prefillMessages = [];
        while (originalMessages.length > 0 && originalMessages[originalMessages.length - 1].role === 'assistant') {
            prefillMessages.unshift(originalMessages.pop());
        }

        // 2. 剝離所有的 System 消息並合併
        const systemLines = [];
        let chatHistory = [];
        originalMessages.forEach((msg) => {
            if (msg.role === 'system') {
                systemLines.push(msg.content);
            } else {
                chatHistory.push(msg);
            }
        });

        // 3. 【核心技術】跨回合浮動指令捕獲 (針對 253t User 與 21t Assistant)
        // 提取當前陣列底部倒數 3 個對話區塊
        const currentBottoms = chatHistory.slice(-3);
        let newlyAbsorbed = 0;

        // 從 Chat 陣列中過濾並吸入已知/新發現的浮動區塊
        const cleanedChatHistory = [];
        for (let i = 0; i < chatHistory.length; i++) {
            const msg = chatHistory[i];
            const isAtBottom = i >= chatHistory.length - 3;
            const isLongEnough = msg.content.length > 25; // 防呆：不吸收短對話(如 "...")
            
            // 條件 A：已經在黑洞特徵庫中
            if (CacheState.knownFloats.has(msg.content)) {
                // 直接剝離，不再進入對話歷史
                continue; 
            }
            
            // 條件 B：跨回合出現在底部，證明它是酒館插入的浮動 Jailbreak！
            const wasInLastBottom = CacheState.lastBottomBlocks.some(oldMsg => oldMsg.content === msg.content);
            if (isAtBottom && isLongEnough && wasInLastBottom) {
                CacheState.knownFloats.add(msg.content);
                CacheState.blackHoleCore += `\n\n[Persistent Formatting / ${msg.role.toUpperCase()}]:\n${msg.content}`;
                Logger.warn(`發現浮動指令 (${msg.role}, ${msg.content.length}字)，已永久吸入黑洞核心！`);
                newlyAbsorbed++;
                continue; // 剝離
            }

            cleanedChatHistory.push(msg);
        }

        // 更新底部特徵庫，供下一回合比對
        CacheState.lastBottomBlocks = cleanedChatHistory.slice(-3).map(m => ({ role: m.role, content: m.content }));

        // 4. 絕對零度凍結 System 核心
        const currentSystemText = systemLines.join('\n');
        if (!CacheState.lastStaticBase) {
            Logger.log("初始回合：鎖定並凍結 System 核心");
            CacheState.lastStaticBase = currentSystemText;
        } else if (newlyAbsorbed > 0) {
            Logger.log("黑洞核心已更新，即將重新對齊緩存前綴！");
        }

        // 計算相似度防崩潰機制
        const newLines = currentSystemText.split('\n');
        const oldLinesSet = new Set(CacheState.lastStaticBase.split('\n').map(l => l.trim()));
        let commonCount = 0;
        for (const line of newLines) {
            if (line.trim() !== '' && oldLinesSet.has(line.trim())) commonCount++;
        }
        if (commonCount / Math.max(newLines.length, 1) < 0.3) {
            Logger.warn("System 發生巨變 (切換角色?)，已自動重置核心！");
            CacheState.lastStaticBase = currentSystemText;
            CacheState.blackHoleCore = "";
            CacheState.knownFloats.clear();
        }

        // 5. 重組為 100% 命中的終極緩存陣列
        const newMessages = [];
        
        // [Index 0]: 被絕對凍結的系統設定 + 吸入的所有 Jailbreak (確保 24k+ 完美命中)
        const ultraCoreText = CacheState.lastStaticBase + CacheState.blackHoleCore;
        if (ultraCoreText.trim().length > 0) {
            newMessages.push({ role: 'system', content: ultraCoreText });
        }
        
        // [Index 1 ~ N]: 純淨無污染的對話歷史 (位置永遠不變，KV Cache 完美延伸)
        newMessages.push(...cleanedChatHistory);

        // [Index N+1]: AI 預填充
        newMessages.push(...prefillMessages);

        // 原地覆寫請求陣列
        data.chat.splice(0, data.chat.length, ...newMessages);
        
        Logger.log(`重組完成！發送陣列已達最優化結構 (總區塊: ${data.chat.length})`);
        
    } catch (err) {
        Logger.error("致命錯誤！已取消優化。", err);
    }
}

// ==========================================
// 模組 3：內建折疊式 UI 介面
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
                    <p style="font-size: 0.9em; opacity: 0.8; margin-top: 0; margin-bottom: 15px;">採用「黑洞合併算法」，自動捕捉酒館的浮動提示詞並凍結於頂部，實現 99.9% 緩存命中。</p>
                    
                    <div style="margin-bottom: 15px;">
                        <label class="checkbox_label" style="display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="ds-cache-enable" checked> 
                            <span>啟用黑洞緩存攔截器</span>
                        </label>
                    </div>
                    
                    <button id="ds-cache-reset" class="menu_button" style="width: 100%; display: block; margin-bottom: 15px; padding: 10px; text-align: center;">
                        🔄 強制重置黑洞與靜態核心
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
            CacheState.blackHoleCore = "";
            CacheState.knownFloats.clear();
            CacheState.lastBottomBlocks = [];
            Logger.warn("已清空緩存核心與黑洞！下一回合將重新抓取並凍結！");
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
