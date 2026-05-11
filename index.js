import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 1. 樣式注入 (Absolute Truth UI & GPU Acceleration)
// ==========================================
const injectCSS = () => {
    if (document.getElementById('ds-cache-styles')) return;
    const style = document.createElement('style');
    style.id = 'ds-cache-styles';
    style.innerHTML = `
        :root { --ds-cyan: #00e5ff; --ds-purple: #c678dd; --ds-green: #98c379; --ds-red: #e06c75; --ds-yellow: #e5c07b; --ds-bg: rgba(15, 20, 25, 0.6); --ds-border: rgba(0, 229, 255, 0.15); }
        
        /* GPU 加速與渲染優化 */
        .ds-gpu-accel { transform: translateZ(0); will-change: transform; backface-visibility: hidden; perspective: 1000px; }
        .ds-strict-contain { contain: strict; }
        .ds-virtual-list { content-visibility: auto; contain-intrinsic-size: 1px 100px; }
        
        .ds-scroll::-webkit-scrollbar { width: 6px; }
        .ds-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 4px; }
        .ds-scroll::-webkit-scrollbar-thumb { background: rgba(0, 229, 255, 0.3); border-radius: 4px; }
        .ds-scroll::-webkit-scrollbar-thumb:hover { background: rgba(0, 229, 255, 0.6); }

        .ds-opt-group { margin-bottom: 15px; border: 1px solid var(--ds-border); border-radius: 10px; background: var(--ds-bg); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); overflow: hidden; box-shadow: 0 8px 20px rgba(0,0,0,0.2); transition: all 0.3s ease; }
        .ds-opt-group:hover { border-color: rgba(0, 229, 255, 0.3); box-shadow: 0 8px 25px rgba(0, 229, 255, 0.05); }
        .ds-opt-header { padding: 14px 18px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: var(--ds-cyan); background: linear-gradient(90deg, rgba(0,229,255,0.05) 0%, rgba(0,0,0,0) 100%); transition: 0.2s; font-size: 14px; text-shadow: 0 0 10px rgba(0,229,255,0.2); }
        .ds-opt-header:hover { background: linear-gradient(90deg, rgba(0,229,255,0.1) 0%, rgba(0,0,0,0) 100%); color: #fff; }
        .ds-opt-content { padding: 18px; display: flex; flex-direction: column; gap: 14px; display: none; background: rgba(0,0,0,0.2); border-top: 1px solid rgba(255,255,255,0.02); }
        .ds-opt-group.open .ds-opt-content { display: flex; animation: dsFadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .ds-opt-group.open .ds-opt-header i.fa-chevron-down { transform: rotate(180deg); }

        .ds-row { display: flex; flex-direction: row; justify-content: space-between; align-items: center; width: 100%; gap: 12px; }
        .ds-row-left { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; color: #abb2bf; font-size: 13px; flex: 1; line-height: 1.5; transition: color 0.2s; }
        .ds-row-left:hover { color: #fff; }
        .ds-row-left input[type="checkbox"] { margin-top: 3px; flex-shrink: 0; transform: scale(1.15); cursor: pointer; accent-color: var(--ds-cyan); }
        .ds-row-text { display: flex; flex-direction: column; flex: 1; min-width: 0; word-wrap: break-word; white-space: normal; }
        .ds-row-text b { color: var(--ds-yellow); font-weight: 600; letter-spacing: 0.5px; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
        .ds-row-text span { font-size: 11px; color: rgba(171, 178, 191, 0.8); font-weight: normal; margin-top: 2px; line-height: 1.4; }
        
        .ds-tooltip-icon { display: inline-flex; align-items: center; justify-content: center; color: var(--ds-cyan); background: rgba(0,229,255,0.1); border-radius: 50%; width: 14px; height: 14px; font-size: 10px; font-weight: bold; cursor: help; border: 1px solid rgba(0,229,255,0.3); flex-shrink: 0; }
        .ds-tooltip-icon:hover { background: var(--ds-cyan); color: #000; box-shadow: 0 0 8px var(--ds-cyan); }
        .ds-perf-badge { font-size: 9px; padding: 1px 4px; border-radius: 3px; font-weight: bold; letter-spacing: 0.5px; }
        .ds-perf-low { background: rgba(152,195,121,0.15); color: var(--ds-green); border: 1px solid rgba(152,195,121,0.3); }
        .ds-perf-mid { background: rgba(229,192,123,0.15); color: var(--ds-yellow); border: 1px solid rgba(229,192,123,0.3); }
        .ds-perf-high { background: rgba(224,108,117,0.15); color: var(--ds-red); border: 1px solid rgba(224,108,117,0.3); }

        .ds-select-styled { background: rgba(0,0,0,0.4); color: var(--ds-cyan); border: 1px solid var(--ds-border); padding: 8px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; outline: none; transition: all 0.2s; font-family: inherit; width: 100%; box-sizing: border-box; }
        .ds-select-styled:hover, .ds-select-styled:focus { border-color: var(--ds-cyan); box-shadow: 0 0 10px rgba(0,229,255,0.2); }
        .ds-select-styled option { background: #1e1e24; color: #fff; }
        
        .ds-input-styled { background: rgba(0,0,0,0.4); color: #fff; border: 1px solid rgba(255,255,255,0.1); padding: 6px 10px; border-radius: 6px; font-size: 12px; outline: none; transition: all 0.2s; width: 100%; box-sizing: border-box; }
        .ds-input-styled:focus { border-color: var(--ds-cyan); box-shadow: 0 0 8px rgba(0,229,255,0.2); }

        /* Log System */
        .ds-log-toolbar { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; background: rgba(0,0,0,0.3); padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); flex-wrap: wrap; }
        .ds-log-filter { cursor: pointer; padding: 4px 12px; border-radius: 12px; font-size: 11px; background: rgba(255,255,255,0.05); color: #abb2bf; transition: all 0.2s; font-weight: 600; white-space: nowrap; }
        .ds-log-filter.active { background: var(--ds-cyan); color: #000; box-shadow: 0 0 10px rgba(0,229,255,0.4); }
        .ds-log-filter:hover:not(.active) { background: rgba(255,255,255,0.15); color: #fff; }
        .ds-log-terminal { background: #0a0c10; color: #a9b7c6; font-family: 'Fira Code', Consolas, monospace; font-size: 12px; height: 350px; overflow-y: auto; border-radius: 8px; padding: 15px; border: 1px solid rgba(0,229,255,0.2); box-shadow: inset 0 0 20px rgba(0,0,0,0.8); line-height: 1.6; position: relative; }
        .ds-log-line { margin-bottom: 6px; word-wrap: break-word; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 6px; display: flex; align-items: flex-start; }
        .ds-log-line.hide { display: none !important; }
        .ds-log-time { color: #5c6370; margin-right: 10px; user-select: none; font-size: 10px; flex-shrink: 0; margin-top: 2px; }
        .ds-log-content { flex: 1; min-width: 0; }
        .ds-log-info { color: var(--ds-green); }
        .ds-log-warn { color: var(--ds-yellow); font-weight: bold; }
        .ds-log-error { color: var(--ds-red); font-weight: bold; text-shadow: 0 0 5px rgba(224,108,117,0.4); }
        .ds-log-map { color: var(--ds-cyan); font-weight: bold; }
        .ds-log-debug { color: var(--ds-purple); }
        .ds-log-trace { color: #61afef; font-style: italic; }
        .ds-log-divider { color: #4b5263; font-weight: bold; display: block; text-align: center; margin: 15px 0; border-top: 1px solid #2c313a; padding-top: 8px; letter-spacing: 1px; width: 100%; }
        
        .ds-tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; background: rgba(255,255,255,0.05); margin-right: 6px; letter-spacing: 0.5px; }
        .ds-tag-SYS { color: #61afef; border-left: 3px solid #61afef; background: rgba(97,175,239,0.1); }
        .ds-tag-USER { color: var(--ds-green); border-left: 3px solid var(--ds-green); background: rgba(152,195,121,0.1); }
        .ds-tag-AI { color: var(--ds-yellow); border-left: 3px solid var(--ds-yellow); background: rgba(229,192,123,0.1); }
        .ds-tag-PREFILL { color: var(--ds-purple); border-left: 3px solid var(--ds-purple); background: rgba(198,120,221,0.1); }
        .ds-badge { background: rgba(0,229,255,0.1); padding: 4px 10px; border-radius: 6px; font-size: 0.8em; font-family: monospace; color: var(--ds-cyan); border: 1px solid rgba(0,229,255,0.3); box-shadow: 0 0 8px rgba(0,229,255,0.2); }

        /* Buttons */
        .ds-btn-col { display: flex; flex-direction: column; gap: 14px; margin-top: 30px; }
        .ds-btn { padding: 16px 20px; border: 1px solid transparent; border-radius: 10px; cursor: pointer; font-weight: bold; font-size: 15px; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); position: relative; overflow: hidden; display:flex; align-items:center; justify-content:flex-start; gap:15px; text-align:left; line-height: 1.5; background: rgba(255,255,255,0.05); color: #fff; }
        .ds-btn:hover { transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0,0,0,0.4); border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.1); }
        .ds-btn:active { transform: translateY(0); }
        .ds-btn i { font-size: 18px; width: 24px; text-align: center; flex-shrink: 0; }
        
        .ds-btn-accept { border-color: rgba(152,195,121,0.4); background: linear-gradient(90deg, rgba(152,195,121,0.15) 0%, rgba(0,0,0,0) 100%); }
        .ds-btn-accept:hover { border-color: var(--ds-green); box-shadow: 0 0 15px rgba(152,195,121,0.3); }
        .ds-btn-accept i { color: var(--ds-green); }
        
        .ds-btn-revert { border-color: rgba(198,120,221,0.4); background: linear-gradient(90deg, rgba(198,120,221,0.15) 0%, rgba(0,0,0,0) 100%); }
        .ds-btn-revert:hover { border-color: var(--ds-purple); box-shadow: 0 0 15px rgba(198,120,221,0.3); }
        .ds-btn-revert i { color: var(--ds-purple); }
        
        .ds-btn-abort { border-color: rgba(224,108,117,0.4); background: linear-gradient(90deg, rgba(224,108,117,0.15) 0%, rgba(0,0,0,0) 100%); }
        .ds-btn-abort:hover { border-color: var(--ds-red); box-shadow: 0 0 15px rgba(224,108,117,0.3); }
        .ds-btn-abort i { color: var(--ds-red); }
        
        .ds-btn-blue { border-color: rgba(0,229,255,0.4); background: linear-gradient(90deg, rgba(0,229,255,0.15) 0%, rgba(0,0,0,0) 100%); }
        .ds-btn-blue:hover { border-color: var(--ds-cyan); box-shadow: 0 0 15px rgba(0,229,255,0.3); }
        .ds-btn-blue i { color: var(--ds-cyan); }

        .ds-btn-reset { border-color: rgba(224,108,117,0.2); background: rgba(224,108,117,0.05); }
        .ds-btn-reset:hover { border-color: var(--ds-red); background: rgba(224,108,117,0.15); }
        .ds-btn-reset i { color: var(--ds-red); }

        .ds-btn-magic { border-color: rgba(229,192,123,0.4); background: linear-gradient(90deg, rgba(229,192,123,0.15) 0%, rgba(0,0,0,0) 100%); color: var(--ds-yellow); margin-bottom: 15px; width: 100%; justify-content: center; }
        .ds-btn-magic:hover { border-color: var(--ds-yellow); box-shadow: 0 0 20px rgba(229,192,123,0.4); background: linear-gradient(90deg, rgba(229,192,123,0.25) 0%, rgba(0,0,0,0) 100%); color: #fff; }

        .ds-btn-omni { border-color: rgba(198,120,221,0.4); background: linear-gradient(90deg, rgba(198,120,221,0.15) 0%, rgba(0,0,0,0) 100%); color: var(--ds-purple); margin-bottom: 15px; width: 100%; justify-content: center; font-size: 16px; letter-spacing: 1px; }
        .ds-btn-omni:hover { border-color: var(--ds-purple); box-shadow: 0 0 20px rgba(198,120,221,0.4); background: linear-gradient(90deg, rgba(198,120,221,0.25) 0%, rgba(0,0,0,0) 100%); color: #fff; }

        /* Omni-Vision UI Styles (v8.0 Quantum) */
                /* Omni-Vision UI Styles (v8.0 Quantum) */
        .ds-omni-modal { max-width: 98vw !important; width: 1800px !important; height: 95vh !important; display: flex; flex-direction: column; padding: 20px !important; }
        .ds-omni-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-shrink: 0; }
        .ds-omni-body { display: flex; gap: 15px; flex: 1; min-height: 0; position: relative; }
        .ds-omni-pane { flex: 1; display: flex; flex-direction: column; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; overflow: hidden; box-shadow: inset 0 0 20px rgba(0,0,0,0.5); }
        .ds-omni-pane-header { padding: 12px 15px; background: rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center; font-weight: bold; }
        .ds-omni-pane-content { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 10px; }
        
        .ds-node-row { display: flex; width: 100%; margin-bottom: 10px; align-items: stretch; position: relative; }
        .ds-omni-col { flex: 0 0 47%; display: flex; flex-direction: column; min-width: 0; align-self: stretch; }
        .ds-node-cell { flex: 1 1 auto; height: 100%; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 12px; font-family: 'Fira Code', monospace; font-size: 12px; color: #abb2bf; word-wrap: break-word; position: relative; transition: 0.2s; display: flex; flex-direction: column; z-index: 2; box-sizing: border-box; }
        .ds-node-cell:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.2); }
        .ds-node-empty { flex: 1 1 auto; height: 100%; min-height: 60px; background: transparent; border: 1px dashed rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.2); font-style: italic; z-index: 2; box-sizing: border-box; }
        
        .ds-status-hit { border-left: 4px solid var(--ds-green); background: linear-gradient(90deg, rgba(152,195,121,0.05) 0%, rgba(0,0,0,0) 100%); }
        .ds-status-miss { border-left: 4px solid var(--ds-cyan); background: linear-gradient(90deg, rgba(0,229,255,0.05) 0%, rgba(0,0,0,0) 100%); } 
        .ds-status-patch { border-left: 4px solid var(--ds-purple); background: linear-gradient(90deg, rgba(198,120,221,0.05) 0%, rgba(0,0,0,0) 100%); }
        .ds-status-phantom { border-left: 4px solid var(--ds-yellow); background: linear-gradient(90deg, rgba(229,192,123,0.05) 0%, rgba(0,0,0,0) 100%); }
        .ds-status-break { border-left: 4px solid var(--ds-red); background: linear-gradient(90deg, rgba(224,108,117,0.05) 0%, rgba(0,0,0,0) 100%); }
        
        .ds-node-header { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 11px; color: #5c6370; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 4px; }
        .ds-node-text { flex: 1; overflow: hidden; transition: max-height 0.3s ease; }
        .ds-node-text.ds-collapsed { max-height: 60px; position: relative; }
        .ds-node-text.ds-collapsed::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 30px; background: linear-gradient(transparent, rgba(30,30,36,0.9)); }
        
        .ds-omni-toolbar { display: flex; gap: 10px; padding: 10px 15px; background: rgba(0,0,0,0.5); border-bottom: 1px solid rgba(255,255,255,0.05); flex-wrap: wrap; align-items: center; }
        .ds-omni-toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #abb2bf; cursor: pointer; background: rgba(255,255,255,0.05); padding: 4px 10px; border-radius: 6px; transition: 0.2s; border: 1px solid transparent; }
        .ds-omni-toggle:hover { background: rgba(255,255,255,0.1); color: #fff; }
        .ds-omni-toggle.active { background: rgba(0,229,255,0.1); color: var(--ds-cyan); border-color: rgba(0,229,255,0.3); }

        .ds-legend { display: flex; gap: 15px; font-size: 11px; padding: 10px 15px; background: rgba(0,0,0,0.3); border-radius: 8px; margin-bottom: 15px; flex-wrap: wrap; }
        .ds-legend-item { display: flex; align-items: center; gap: 6px; }
        .ds-legend-color { width: 12px; height: 12px; border-radius: 3px; }
        
        .ds-minimap-container { width: 12px; background: rgba(0,0,0,0.5); border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); overflow: hidden; display: flex; flex-direction: column; cursor: pointer; position: relative; z-index: 3; }
        .ds-minimap-segment { width: 100%; transition: 0.2s; }
        .ds-minimap-segment:hover { filter: brightness(1.5); }
        
        /* Modals & Overlays */
        .ds-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); z-index: 999999; display: flex; align-items: center; justify-content: center; animation: dsFadeIn 0.2s ease-out; cursor: pointer; }
        .ds-modal { background: linear-gradient(180deg, #1e1e24 0%, #15151a 100%); border: 1px solid var(--ds-red); padding: 35px; border-radius: 16px; max-width: 800px; width: 90%; max-height: 90vh; overflow-y: auto; color: #fff; font-family: sans-serif; box-shadow: 0 30px 60px rgba(0,0,0,0.9), 0 0 30px rgba(224,108,117,0.2); position: relative; animation: dsSlideUp 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); cursor: default; }
        .ds-modal.ds-modal-blue { border-color: var(--ds-cyan); box-shadow: 0 30px 60px rgba(0,0,0,0.9), 0 0 30px rgba(0,229,255,0.15); }
        .ds-modal-title { color: var(--ds-red); margin: 0 0 20px 0; display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 800; letter-spacing: 1px; text-shadow: 0 2px 4px rgba(0,0,0,0.5); flex-wrap: wrap; }
        .ds-modal-title.ds-blue { color: var(--ds-cyan); }
        
        @keyframes dsFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes dsSlideUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes dsSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
};

// ==========================================
// 2. 狀態設定與磁碟 I/O 降載
// ==========================================
let Settings = {};
let sessionSnoozeReset = false; 
let backupVault = []; 

// 🚀 實體發送按鍵守衛：嚴格區分真實發送與背景運算
let isUserActionPending = false;
document.addEventListener('click', (e) => {
    const target = e.target.closest('#send_but, #mes_continue, .mes_edit_swipe');
    if (target) isUserActionPending = true;
}, true);
document.addEventListener('keydown', (e) => {
    if (e.target.id === 'send_textarea' && e.key === 'Enter' && !e.shiftKey) isUserActionPending = true;
}, true);

function initSettings() {
    const oldSettings = extension_settings.ds_cache_v52 || extension_settings.ds_cache_v60 || {};
    if (!extension_settings.ds_cache_v60) {
        extension_settings.ds_cache_v60 = {
            enabled: oldSettings.enabled ?? true,
            zenMode: oldSettings.zenMode ?? false,
            toastHistory: oldSettings.toastHistory ?? true,
            showResetPrompt: oldSettings.showResetPrompt ?? true,
            autoAccept: oldSettings.autoAccept ?? false,
            logLevel: oldSettings.logLevel ?? 2,
            tolerance: oldSettings.tolerance ?? 0, // 預設嚴格
            maxCacheSize: oldSettings.maxCacheSize ?? 30,
            hotkeysEnabled: oldSettings.hotkeysEnabled ?? true,
            autoPinThreshold: oldSettings.autoPinThreshold ?? 0,
            dynamicMode: oldSettings.dynamicMode ?? 1, // 預設寫日記模式
            historyEditMode: oldSettings.historyEditMode ?? 1, // 預設時空補丁
            lorebookSink: oldSettings.lorebookSink ?? true, 
            retconProtocol: oldSettings.retconProtocol ?? true, 
            hotReloadPersona: oldSettings.hotReloadPersona ?? true, 
            flashbackInsertion: oldSettings.flashbackInsertion ?? true, 
            multiverseProtocol: oldSettings.multiverseProtocol ?? true, 
            nanoPatching: oldSettings.nanoPatching ?? true, 
            gravityProtocol: oldSettings.gravityProtocol ?? true, 
            summaryAnchor: oldSettings.summaryAnchor ?? true, 
            tailEndExemption: oldSettings.tailEndExemption ?? true, 
            chronosProtocol: oldSettings.chronosProtocol ?? true, 
            amnesiaProtocol: oldSettings.amnesiaProtocol ?? true, 
            anchorStabilization: oldSettings.anchorStabilization ?? true, 
            permanentMemoryImprint: oldSettings.permanentMemoryImprint ?? true, 
            autoScrollLog: oldSettings.autoScrollLog ?? true, 
            entropyShield: oldSettings.entropyShield ?? true, 
            absoluteDeduplication: oldSettings.absoluteDeduplication ?? true, 
            voidBridging: oldSettings.voidBridging ?? true, 
            warpDriveFilter: oldSettings.warpDriveFilter ?? true, 
            prefixAnchor: oldSettings.prefixAnchor ?? true, 
            semanticNormalize: oldSettings.semanticNormalize ?? true, 
            autoBackup: oldSettings.autoBackup ?? true, 
            absoluteOrderMatrix: oldSettings.absoluteOrderMatrix ?? true, 
            vectorQuarantine: oldSettings.vectorQuarantine ?? true, 
            phantomSync: oldSettings.phantomSync ?? true, 
            smartAutoPatch: oldSettings.smartAutoPatch ?? true, 
            chats: oldSettings.chats || {},
            pinnedChats: oldSettings.pinnedChats || {},
            stats: oldSettings.stats || { intercepted: 0, tokensSaved: 0 } 
        };
    }
    Settings = extension_settings.ds_cache_v60;
    if (!Settings.pinnedChats) Settings.pinnedChats = {};
    if (!Settings.chats) Settings.chats = {}; 
    if (!Settings.stats) Settings.stats = { intercepted: 0, tokensSaved: 0 };
    
    if (Settings.autoBackup) {
        try {
            const vaultStr = localStorage.getItem('ds_cache_v60_vault');
            if (vaultStr) backupVault = JSON.parse(vaultStr);
        } catch(e) {}
        createVaultBackup("自动启动备份");
    }
}

let saveTimeout = null;
let pendingSave = false;

function flushSaveSync() {
    if (pendingSave) {
        try { 
            if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced(); 
            localStorage.setItem('ds_cache_v60_snapshot', JSON.stringify(Settings));
        } catch (e) {}
        pendingSave = false;
        saveTimeout = null;
    }
}

window.addEventListener('beforeunload', flushSaveSync);

function safeSave() {
    pendingSave = true;
    if (saveTimeout) return;
    const saveTask = () => { flushSaveSync(); };
    if ('requestIdleCallback' in window) saveTimeout = requestIdleCallback(saveTask, { timeout: 2000 });
    else saveTimeout = setTimeout(saveTask, 1000);
}

function createVaultBackup(label = "手动备份") {
    const snapshot = {
        time: new Date().toLocaleString(),
        label: label,
        data: JSON.stringify({ chats: Settings.chats, pinnedChats: Settings.pinnedChats })
    };
    backupVault.unshift(snapshot);
    if (backupVault.length > 5) backupVault.pop();
    localStorage.setItem('ds_cache_v60_vault', JSON.stringify(backupVault));
    $('#ds-btn-undo-action').show();
}

function restoreVaultBackup(index = 0) {
    if (!backupVault[index]) return;
    try {
        const parsed = JSON.parse(backupVault[index].data);
        Settings.chats = parsed.chats;
        Settings.pinnedChats = parsed.pinnedChats;
        safeSave(); renderChatsUI();
        if (typeof toastr !== 'undefined') toastr.success(`⏪ 时光机启动！已恢复至: ${backupVault[index].time}`);
    } catch(e) { Logger.error("恢复快照失败", e); }
}

function getTolerance() {
    if (Settings.tolerance === 0) return { sys: 0.5, his: 0.6 }; 
    if (Settings.tolerance === 1) return { sys: 0.2, his: 0.3 }; 
    return { sys: 0.05, his: 0.1 }; 
}

const triggerThrottlers = {};
function triggerWarningImmediate(key, msg, isEnabled) {
    if (!Settings.enabled || !isEnabled) return;
    const now = Date.now();
    if (!triggerThrottlers[key] || now - triggerThrottlers[key] > 30000) {
        triggerThrottlers[key] = now;
        if (Settings.zenMode) Logger.log(`[免打扰模式] 已隐藏通知: ${msg}`, LogLevels.BASIC);
        else if (typeof toastr !== 'undefined') toastr.warning(msg, '💡 绝对真理优化器', { timeOut: 3000 });
    }
}

function escapeHtml(text) { return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function stripHtml(html) { return html ? html.replace(/<[^>]+>/g, '') : ''; }
function truncateLog(str, len = 50) {
    if (!str) return '∅';
    const s = String(str).replace(/\n/g, ' ↵ ');
    return s.length > len ? s.substring(0, len) + '...' : s;
}
function formatNumber(num) { return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

function calculateExactStorage(object) {
    try {
        let bytes = 0; const stack = [object]; const seen = new Set();
        while (stack.length) {
            const value = stack.pop();
            if (typeof value === 'boolean') bytes += 4;
            else if (typeof value === 'string') bytes += value.length * 2;
            else if (typeof value === 'number') bytes += 8;
            else if (typeof value === 'object' && value !== null && !seen.has(value)) {
                seen.add(value);
                for (const key in value) { bytes += key.length * 2; stack.push(value[key]); }
            }
        }
        return bytes;
    } catch(e) { return 0; }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function performGarbageCollection() {
    const unpinnedKeys = Object.keys(Settings.chats).filter(k => !Settings.pinnedChats[k]);
    if (unpinnedKeys.length <= Settings.maxCacheSize) return;
    const sortedKeys = unpinnedKeys.sort((a, b) => (Settings.chats[a].lastAccessed || 0) - (Settings.chats[b].lastAccessed || 0));
    const toRemove = sortedKeys.slice(0, unpinnedKeys.length - Settings.maxCacheSize);
    toRemove.forEach(k => delete Settings.chats[k]);
    safeSave();
    Logger.warn(`[自动清理] 垃圾车出动！已清理 ${toRemove.length} 个很久没碰过的旧存档，释放空间。`);
    renderChatsUI();
}

// ==========================================
// 3. Omni-Log 全知日誌系統
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3, TRACE: 4 };
let logQueue = [];
let isLogRendering = false;
let isLogPaused = false; 
let isLogVisible = true; 

function updateTopBarState() {
    const dot = $('#ds-top-status-dot');
    if (!dot.length) return;
    if (!Settings.enabled) {
        dot.css('color', '#5c6370');
        $('#ds-top-reset-btn').attr('title', '绝对真理缓存: 已停用 (大模型每次都会重读所有内容)');
        dot.html('<i class="fa-solid fa-circle"></i>');
    } else if (Settings.zenMode) {
        dot.css('color', '#c678dd');
        $('#ds-top-reset-btn').attr('title', '绝对真理缓存: 运作中 [沉浸免打扰模式]');
        dot.html('<i class="fa-solid fa-yin-yang ds-zen-icon"></i>');
    } else {
        dot.css('color', '#00e5ff');
        $('#ds-top-reset-btn').attr('title', '绝对真理缓存: 运作中 (正在为您省钱省算力)');
        dot.html('<i class="fa-solid fa-circle" style="text-shadow: 0 0 5px #00e5ff;"></i>');
    }
}

function setTopBarStatus(color, title) {
    if (!Settings.enabled) return;
    const dot = $('#ds-top-status-dot');
    if (dot.length) {
        if (!Settings.zenMode || color === '#e06c75') { 
            dot.css('color', color);
            if(color === '#00e5ff' || color === '#00ff00') dot.html('<i class="fa-solid fa-circle" style="text-shadow: 0 0 5px '+color+';"></i>');
        }
        $('#ds-top-reset-btn').attr('title', title + ' (左键开关 / 右键清空)');
    }
}

function processLogQueue() {
    if (logQueue.length === 0 || isLogPaused || !isLogVisible) {
        isLogRendering = false;
        return;
    }
    
    const container = document.getElementById('ds-cache-log-container');
    if (!container) {
        logQueue = [];
        isLogRendering = false;
        return;
    }

    const fragment = document.createDocumentFragment();
    const activeFilter = $('.ds-log-filter.active').data('filter') || 'all';
    const searchTerm = ($('#ds-log-search').val() || '').toLowerCase();

    while (logQueue.length > 0) {
        const logData = logQueue.shift();
        const line = document.createElement('div');
        line.className = 'ds-log-line ds-virtual-list'; 
        line.setAttribute('data-type', logData.type === 'divider' ? 'info' : logData.type);
        
        if (logData.type === 'divider') {
            line.innerHTML = `<span class="ds-log-divider">${logData.msg}</span>`;
        } else {
            line.innerHTML = `<span class="ds-log-time">[${logData.time}]</span> <span class="ds-log-content ds-log-${logData.type}">${logData.msg.replace(/\n/g, '<br>')}</span>`;
        }
        
        const text = line.innerText.toLowerCase();
        let typeMatch = (activeFilter === 'all' || logData.type === activeFilter || logData.type === 'divider');
        let searchMatch = (searchTerm === '' || text.includes(searchTerm));
        if (!(typeMatch && searchMatch)) line.classList.add('hide');
        
        fragment.appendChild(line);
    }

    container.appendChild(fragment);
    while (container.childNodes.length > 800) container.removeChild(container.firstChild);
    if (Settings.autoScrollLog && !isLogPaused) container.scrollTop = container.scrollHeight;
    
    isLogRendering = false;
}

function logAt(level, type, msg) {
    if (Settings.logLevel < level) return;
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
    
    if (type === 'warn') console.warn(`%c[真理日志] 🌪️ ${msg}`, 'color: #e5c07b;');
    else if (type === 'error') console.error(`[真理日志] 🔴 ${msg}`);
    else if (type === 'map') console.log(`%c[真理日志] 🗺️ ${msg}`, 'color: #00e5ff;');
    else if (type === 'debug') console.log(`%c[真理日志] 🐛 ${msg}`, 'color: #c678dd;');
    else if (type === 'trace') console.log(`%c[真理日志] 🔍 ${msg}`, 'color: #61afef;');
    else if (type === 'divider') console.log(`%c${msg}`, 'color: #4b5263; font-weight: bold;');
    else console.log(`%c[真理日志] ✅ ${msg}`, 'color: #98c379;');
    
    logQueue.push({ time, type, msg });
    if (logQueue.length > 500) logQueue.shift();

    if (!isLogRendering && !isLogPaused && isLogVisible) {
        isLogRendering = true;
        requestAnimationFrame(processLogQueue);
    }
}

function applyLogFilters() {
    const activeFilter = $('.ds-log-filter.active').data('filter') || 'all';
    const searchTerm = ($('#ds-log-search').val() || '').toLowerCase();
    
    $('#ds-cache-log-container .ds-log-line').each(function() {
        const type = $(this).data('type');
        const text = $(this).text().toLowerCase();
        let typeMatch = (activeFilter === 'all' || type === activeFilter || type === 'divider');
        let searchMatch = (searchTerm === '' || text.includes(searchTerm));
        if (typeMatch && searchMatch) $(this).removeClass('hide');
        else $(this).addClass('hide');
    });
}

const Logger = {
    log: (msg, level = LogLevels.DETAILED) => logAt(level, 'info', msg),
    warn: (msg, level = LogLevels.BASIC) => logAt(level, 'warn', msg),
    map: (msg, level = LogLevels.BASIC) => logAt(level, 'map', msg),
    error: (msg, err, level = LogLevels.BASIC) => {
        logAt(level, 'error', err ? `${msg} ${err}` : msg);
        if (err && Settings.logLevel >= LogLevels.DEBUG) {
            console.error("Crash Dump Triggered:", err);
            localStorage.setItem('ds_cache_crash_dump', JSON.stringify({ error: err.toString(), stack: err?.stack, time: new Date().toISOString() }));
        }
    },
    debug: (msg) => logAt(LogLevels.DEBUG, 'debug', msg),
    trace: (msg) => logAt(LogLevels.TRACE, 'trace', msg),
    divider: (msg) => logAt(LogLevels.BASIC, 'divider', msg),
    normalize: (text) => {
        if (!text) return '';
        let norm = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
        if (Settings.semanticNormalize) norm = norm.replace(/\s+/g, ' ').trim(); 
        else norm = norm.replace(/ +/g, ' ').trim();
        return norm;
    },
    fuzzyNormalize: (text) => {
        if (!text) return '';
        return text.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5]/gi, '').replace(/\s+/g, '').trim();
    }
};

// ==========================================
// 4. 狀態管理與擴充選單
// ==========================================
function getChatKey() {
    const context = getContext();
    let charName = "未知角色";
    if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
        charName = context.characters[context.characterId].name || context.characterId;
    } else if (context.name2) charName = context.name2;
    let chatId = context.chatId || "默认聊天";
    let groupId = context.groupId;
    if (groupId) return { key: `group_${groupId}_${chatId}`, label: `群聊: ${chatId}` };
    return { key: `char_${context.characterId}_${chatId}`, label: `${charName} | 存档: ${chatId}` };
}

function getChatState(chatKeyInfo) {
    if (!Settings.chats[chatKeyInfo.key]) {
        Settings.chats[chatKeyInfo.key] = { label: chatKeyInfo.label, frozenSequence: [], multiverse: [], lastSentSequence: [], lastRawStream: [], lastPrefills: [], lastAccessed: Date.now(), dynamicAnomalies: [] };
        safeSave(); renderChatsUI();
    } else {
        Settings.chats[chatKeyInfo.key].lastAccessed = Date.now();
        if (!Settings.chats[chatKeyInfo.key].dynamicAnomalies) Settings.chats[chatKeyInfo.key].dynamicAnomalies = [];
        if (!Settings.chats[chatKeyInfo.key].multiverse) Settings.chats[chatKeyInfo.key].multiverse = [];
        if (!Settings.chats[chatKeyInfo.key].lastRawStream) Settings.chats[chatKeyInfo.key].lastRawStream = [];
        performGarbageCollection();
    }
    return Settings.chats[chatKeyInfo.key];
}

function ensureTopMenuButton() {
    if ($('#ds-top-reset-btn').length === 0) {
        const btn = $(`
            <li id="ds-top-reset-btn" class="menu_button interactable" title="DeepSeek 绝对真理缓存优化器">
                <span class="fa-solid fa-microchip"></span>
                <span id="ds-top-status-dot" style="font-size:0.7em; margin-left:2px; vertical-align:top;"></span>
            </li>
        `);
        btn.on('click', (e) => {
            e.preventDefault();
            Settings.enabled = !Settings.enabled;
            $('#ds-cache-enable').prop('checked', Settings.enabled);
            safeSave(); updateTopBarState();
            if (!Settings.zenMode && typeof toastr !== 'undefined') toastr.info(Settings.enabled ? "🚀 绝对真理缓存已启动！" : "💤 绝对真理缓存已关闭。", "DeepSeek");
        });
        btn.on('contextmenu', (e) => { e.preventDefault(); resetCurrentCache(); });
        if ($('ul#extensions_menu').length > 0) $('ul#extensions_menu').append(btn);
        else if ($('#right-nav-extensions').length > 0) $('#right-nav-extensions').append(btn);
    }
    updateTopBarState();
}

function addResetMenuEntry() {
    const menu = document.getElementById('extensionsMenu') || document.getElementById('extensions_menu');
    if (!menu) { setTimeout(addResetMenuEntry, 300); return; }
    
    if (!document.getElementById('ds-bottom-omni-btn')) {
        const omniBtn = document.createElement('div');
        omniBtn.id = 'ds-bottom-omni-btn';
        omniBtn.className = 'list-group-item'; 
        omniBtn.title = '打开全视之眼沙盒，即时预览并调整缓存命中率';
        omniBtn.innerHTML = '<i class="fa-solid fa-eye" style="color: var(--ds-cyan);"></i> Omni-Vision 全视之眼';
        omniBtn.addEventListener('click', () => {
            showOmniVisionUI();
            const menuJq = $('#extensions_menu');
            if(menuJq.hasClass('open')) menuJq.removeClass('open').hide();
        });
        menu.appendChild(omniBtn);
    }

    if (!document.getElementById('ds-bottom-reset-btn')) {
        const toggleBtn = document.createElement('div');
        toggleBtn.id = 'ds-bottom-reset-btn';
        toggleBtn.className = 'list-group-item'; 
        toggleBtn.title = '撕掉整本书，让大模型从头开始重新阅读整个对话（适合AI逻辑混乱时使用）';
        toggleBtn.innerHTML = '<i class="fa-solid fa-broom" style="color: #e06c75;"></i> 撕书重来 (清空当前缓存)';
        toggleBtn.addEventListener('click', () => {
            resetCurrentCache();
            const menuJq = $('#extensions_menu');
            if(menuJq.hasClass('open')) menuJq.removeClass('open').hide();
        });
        menu.appendChild(toggleBtn);
    }
}

function resetCurrentCache() {
    if(!confirm("⚠️ 确定要「撕书重来」吗？\n\n这会清空当前对话的所有缓存，大模型下次回复时会把整个故事从头到尾重新看一遍。\n(这会消耗较多算力和时间，通常只在 AI 逻辑严重混乱，或者你大改了设定时才使用)")) return;
    const key = getChatKey().key;
    delete Settings.chats[key];
    sessionSnoozeReset = false; 
    safeSave(); renderChatsUI();
    setTopBarStatus('#00e5ff', '缓存: 已撕书重来');
    if (typeof toastr !== 'undefined') toastr.success("📚 撕书成功！下次发送时，AI 将重新阅读整个故事。");
    Logger.warn(`手动清空了当前对话缓存: ${key}`);
}

function setupGlobalHotkeys() {
    document.addEventListener('keydown', (e) => {
        if (!Settings.hotkeysEnabled) return;
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
        
        if (e.ctrlKey && e.altKey) {
            if (e.key.toLowerCase() === 'c') {
                e.preventDefault();
                Settings.enabled = !Settings.enabled;
                $('#ds-cache-enable').prop('checked', Settings.enabled);
                safeSave(); updateTopBarState();
                if (!Settings.zenMode && typeof toastr !== 'undefined') toastr.info(Settings.enabled ? "🚀 绝对真理缓存已启动" : "💤 绝对真理缓存已关闭", "快捷键");
            }
            if (e.key.toLowerCase() === 'r') { e.preventDefault(); resetCurrentCache(); }
            if (e.key.toLowerCase() === 'z') { 
                e.preventDefault(); 
                Settings.zenMode = !Settings.zenMode; 
                $('#ds-cache-zen').prop('checked', Settings.zenMode);
                safeSave(); updateTopBarState(); 
                if(typeof toastr !== 'undefined') toastr.info(Settings.zenMode ? "🧘 沉浸免打扰已开启" : "🔔 沉浸免打扰已关闭", "快捷键");
            }
            if (e.key.toLowerCase() === 'v') { e.preventDefault(); showOmniVisionUI(); }
        }
    });
}

// ==========================================
// 5. 核心邏輯工具與 Diff 演算法 (Zero-GC Sliding Window)
// ==========================================

function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function getSimilarityFast(s1, s2) {
    if (s1 === s2) return 1;
    if (!s1 || !s2 || s1.length < 2 || s2.length < 2) return 0;
    
    // 優化：長度差異過大直接返回 0
    if (Math.abs(s1.length - s2.length) > Math.max(s1.length, s2.length) * 0.5) return 0;

    let matches = 0;
    const shortStr = s1.length < s2.length ? s1 : s2;
    const longStr = s1.length < s2.length ? s2 : s1;
    
    for (let i = 0; i < shortStr.length - 1; i++) {
        const bg = shortStr.substring(i, i + 2);
        if (longStr.indexOf(bg) !== -1) matches++;
    }
    
    const union = (s1.length - 1) + (s2.length - 1) - matches;
    return union <= 0 ? 1 : matches / union;
}

function createMsg(msg, tag) {
    const content = msg.content || '';
    const norm = Logger.normalize(content);
    const fuzzy = Logger.fuzzyNormalize(content);
    const clean = stripHtml(norm);
    
    return { 
        role: msg.role, 
        content: content, 
        norm: norm, 
        hash: cyrb53(norm), 
        fuzzyHash: cyrb53(fuzzy), 
        len: content.length, 
        tag: tag,
        cleanStr: clean, 
        cleanLen: clean.length
    };
}

function getSimilarity(msg1, msg2) {
    if (msg1.hash === msg2.hash) return 1;
    if (msg1.fuzzyHash === msg2.fuzzyHash) return 0.99; 
    
    const c1 = msg1.cleanStr !== undefined ? msg1.cleanStr : stripHtml(msg1.norm || msg1.content || '');
    const c2 = msg2.cleanStr !== undefined ? msg2.cleanStr : stripHtml(msg2.norm || msg2.content || '');
    const l1 = msg1.cleanLen !== undefined ? msg1.cleanLen : c1.length;
    const l2 = msg2.cleanLen !== undefined ? msg2.cleanLen : c2.length;

    if (l1 === 0 && l2 === 0) return 1; 
    if (l1 === 0 || l2 === 0) return 0;

    return getSimilarityFast(c1, c2);
}

function isDynamicPrompt(msg) {
    const content = msg.content || '';
    return /(summary|previously on|摘要|前情提要|总结|回顾|当前时间|当前日期|current time|current date)/i.test(content);
}

// ==========================================
// 6. 🚀 絕對真理演算法 (Ultimate Event Sourcing v6)
// ==========================================
async function interceptAndRestructurePrompt(data, isDryRun = false) {
    if (!Settings.enabled && !isDryRun) return;
    const startTime = performance.now();
    const chatKeyInfo = getChatKey();

    // 🚀 實體發送守衛：嚴格區分真實發送與 ST 背景任務 (算 Token、自動總結等)
    let isActualSend = isUserActionPending;
    if (data && (data.dryRun || data.isDryRun || (data.type !== undefined && data.type !== 'chat'))) {
        isActualSend = false; 
    }
    
    // 如果不是真實發送，強制降級為 Dry-Run，絕對保護快取不被污染
    if (!isActualSend && !isDryRun) {
        Logger.trace("🛡️ [系统守卫] 侦测到 ST 背景提示词生成 (非用户主动发送)。已强制降级为 Dry-Run 模式，保护快取阵列不被污染。");
        isDryRun = true;
    }

    try {
        let state = getChatState(chatKeyInfo);
        if (!data?.chat?.length) return;
        const stream = data.chat;
        
        if (!isDryRun) {
            state.lastRawStream = JSON.parse(JSON.stringify(stream));
            safeSave();
            Logger.divider(`===== 🚀 启动绝对真理拦截 (Quantum v6): ${chatKeyInfo.label} =====`);
        }

        // 1. 解析 ST 原始陣列
        const incomingPool = [];
        let currentTurn = { user: null, prefills: [] };
        let lastUserIdx = -1;
        
        const parsedStream = stream.map(m => createMsg(m, m.role === 'system' || (m.role !== 'user' && m.role !== 'assistant') ? 'SYS' : (m.role === 'user' ? 'USER' : 'AI')));
        
        for (let i = parsedStream.length - 1; i >= 0; i--) { if (parsedStream[i].tag === 'USER') { lastUserIdx = i; break; } }
        
        if (lastUserIdx === -1) {
            currentTurn.prefills = parsedStream.filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'}));
            incomingPool.push(...parsedStream.filter(m => m.tag !== 'AI'));
        } else {
            incomingPool.push(...parsedStream.slice(0, lastUserIdx));
            currentTurn.user = parsedStream[lastUserIdx];
            currentTurn.prefills = parsedStream.slice(lastUserIdx + 1).filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'}));
        }

        // 2. 匹配凍結陣列 (Base Sequence)
        let newFrozenSequence = [];
        let timeSpacePatches = [];
        let needsAsk = false;
        let detectedAnomalies = [];
        const thresholds = getTolerance();

        // 🚀 深層拷貝隔離，防止 isDryRun 污染真實狀態矩陣
        const baseSequence = state.frozenSequence ? JSON.parse(JSON.stringify(state.frozenSequence)) : [];

        for (let i = 0; i < baseSequence.length; i++) {
            const frozenItem = baseSequence[i];
            let bestIdx = -1, bestScore = 0;
            let isPatchedMatch = false;

            for (let j = 0; j < incomingPool.length; j++) {
                if (frozenItem.tag === 'SYS' && incomingPool[j].tag !== 'SYS') continue;
                if (frozenItem.tag !== 'SYS' && incomingPool[j].tag === 'SYS') continue;

                // 精準識別已修補的歷史，防止無限生成補丁
                if (frozenItem.patchedContent && frozenItem.patchedContent === incomingPool[j].content) {
                    bestScore = 1;
                    bestIdx = j;
                    isPatchedMatch = true;
                    break;
                }

                const score = getSimilarity(frozenItem, incomingPool[j]);
                if (score > bestScore) { bestScore = score; bestIdx = j; }
            }

            if (bestScore === 1 || (bestIdx !== -1 && frozenItem.fuzzyHash === incomingPool[bestIdx].fuzzyHash)) {
                let matchedItem = incomingPool[bestIdx];
                
                if (isPatchedMatch) {
                    // 完美吸收：已修補的內容再次出現，靜默保留原位
                    newFrozenSequence.push(frozenItem);
                    incomingPool.splice(bestIdx, 1);
                } else if (frozenItem.fuzzyHash === matchedItem.fuzzyHash && frozenItem.hash !== matchedItem.hash && Settings.phantomSync) {
                    matchedItem = { ...frozenItem, isPhantom: true, originalContent: matchedItem.content };
                    newFrozenSequence.push(matchedItem);
                    incomingPool.splice(bestIdx, 1);
                    if (!isDryRun) Logger.trace(`[👻 幻影同步] 拦截微小排版修改，强制使用旧版缓存。`);
                } else {
                    // 完美命中，繼承所有神聖屬性
                    matchedItem.isPatched = frozenItem.isPatched;
                    matchedItem.patchedContent = frozenItem.patchedContent;
                    matchedItem.isErased = frozenItem.isErased;
                    matchedItem.isTimeSpacePatch = frozenItem.isTimeSpacePatch;
                    newFrozenSequence.push(matchedItem);
                    incomingPool.splice(bestIdx, 1);
                }
            } else if (bestScore > (frozenItem.tag === 'SYS' ? thresholds.sys : thresholds.his)) {
                const matchedItem = incomingPool[bestIdx];
                if (frozenItem.tag === 'SYS') {
                    if (bestScore < 1) {
                        detectedAnomalies.push({ oldText: frozenItem.content, newText: matchedItem.content, score: bestScore });
                        if (Settings.dynamicMode === 0) needsAsk = true;
                    }
                    
                    if (Settings.dynamicMode === 1) { 
                        newFrozenSequence.push(frozenItem); 
                        matchedItem.isDynamicUpdate = true; 
                        if (!isDryRun) Logger.trace(`[📓 写日记模式] 冻结旧快照: ${truncateLog(frozenItem.content)}`);
                    } else if (Settings.dynamicMode === 2) { 
                        matchedItem.isDynamicUpdate = true; 
                    } else if (Settings.dynamicMode === 3) { 
                        newFrozenSequence.push(frozenItem);
                        incomingPool.splice(bestIdx, 1); 
                    } else if (Settings.dynamicMode === 4) { 
                        newFrozenSequence.push(matchedItem);
                        incomingPool.splice(bestIdx, 1);
                    } else if (Settings.dynamicMode === 5) { 
                        incomingPool.splice(bestIdx, 1);
                    } else {
                        newFrozenSequence.push(matchedItem);
                        incomingPool.splice(bestIdx, 1);
                    }
                } else {
                    // 歷史修改：追蹤最新修改，生成一次性補丁 (無痕修補)
                    if (Settings.entropyShield && bestScore > 0.99) {
                        frozenItem.patchedContent = matchedItem.content;
                        newFrozenSequence.push(frozenItem); 
                        const patchMsg = createMsg({role: 'system', content: `[系统提示：错字修正。之前的对话中，"${truncateLog(frozenItem.content, 15)}" 已修正为 "${truncateLog(matchedItem.content, 15)}"]`}, 'SYS');
                        patchMsg.isTimeSpacePatch = true; 
                        timeSpacePatches.push(patchMsg);
                        incomingPool.splice(bestIdx, 1);
                        if (!isDryRun) Logger.trace(`[🛡️ 熵减护盾] 拦截微小错字修改，生成底部修正补丁。`);
                    } else if (Settings.smartAutoPatch || Settings.historyEditMode === 1) {
                        frozenItem.isPatched = true;
                        frozenItem.patchedContent = matchedItem.content;
                        newFrozenSequence.push(frozenItem); 
                        const patchMsg = createMsg({role: 'system', content: `[系统提示：时空修正。之前的对话中，"${truncateLog(frozenItem.content, 20)}" 实际上已发生改变，最新情况为："${matchedItem.content}"]`}, 'SYS');
                        patchMsg.isTimeSpacePatch = true; 
                        timeSpacePatches.push(patchMsg);
                        incomingPool.splice(bestIdx, 1);
                        if (!isDryRun) Logger.trace(`[🧠 智慧无痕修补] 拦截历史修改，自动生成底部修正补丁，零弹窗保住 100% 缓存。`);
                    } else if (Settings.historyEditMode === 2) {
                        frozenItem.patchedContent = matchedItem.content;
                        newFrozenSequence.push(frozenItem); 
                        incomingPool.splice(bestIdx, 1);
                    } else {
                        newFrozenSequence.push(matchedItem); 
                        incomingPool.splice(bestIdx, 1);
                    }
                }
            } else {
                // 找不到匹配 (被刪除)
                if (frozenItem.tag === 'SYS') {
                    if (Settings.lorebookSink || frozenItem.isTimeSpacePatch) {
                        newFrozenSequence.push(frozenItem); 
                        if (!isDryRun && !frozenItem.isTimeSpacePatch) Logger.trace(`[👻 幽灵锚点] 发现不再触发的旧设定，永久冻结在历史中: ${truncateLog(frozenItem.content)}`);
                    }
                } else {
                    if (frozenItem.isErased) {
                        newFrozenSequence.push(frozenItem);
                    } else if (Settings.smartAutoPatch || Settings.retconProtocol) {
                        frozenItem.isPatched = true;
                        frozenItem.isErased = true;
                        newFrozenSequence.push(frozenItem);
                        const patchMsg = createMsg({role: 'system', content: `[系统提示：世界意志发动了记忆抹除。之前的事件 "${truncateLog(frozenItem.content, 20)}" 已被抹除，请当作从未发生过。]`}, 'SYS');
                        patchMsg.isTimeSpacePatch = true; 
                        timeSpacePatches.push(patchMsg);
                        if (!isDryRun) Logger.trace(`[🧠 智慧无痕修补] 拦截历史删除，自动生成底部抹除声明。`);
                    }
                }
            }
        }

        if (detectedAnomalies.length > 0 && !isDryRun) {
            state.dynamicAnomalies = detectedAnomalies; 
        }

        // 3. 處理 IncomingPool 中的剩餘物 (The "New" stuff)
        let newHistory = [];
        let newSystems = [];
        let dynamicSink = [];

        for (const item of incomingPool) {
            if (Settings.warpDriveFilter && item.content && item.content.replace(/[\s\*\.\-]/g, '').length === 0) continue;

            if (item.tag === 'SYS') {
                const isSummary = Settings.summaryAnchor && /(summary|previously on|摘要|前情提要|总结|回顾)/i.test(item.content);
                const isVector = Settings.vectorQuarantine && /(retrieved context|search results|vector database|相关记忆|检索到的内容|记忆库片段)/i.test(item.content);
                const isTimeSkip = Settings.chronosProtocol && item.content && item.content.length < 150 && /(later|next day|第二天|几个小时后|一段时间后|meanwhile|之后|随后|时光飞逝|转眼间)/i.test(item.content);
                
                if (isTimeSkip) {
                    const patchMsg = createMsg({role: 'system', content: `[系统提示：叙事过渡。${item.content}]`}, 'SYS');
                    patchMsg.isTimeSpacePatch = true;
                    timeSpacePatches.push(patchMsg);
                } else if (isSummary || isVector || item.isDynamicUpdate || isDynamicPrompt(item)) { 
                    dynamicSink.push(item);
                } else {
                    newSystems.push(item); 
                }
            } else {
                newHistory.push(item);
            }
        }

        // 4. 🚀 嚴格附加 (Strict Append) 構建最終陣列 (100% 遵守用戶要求的排序)
        // 順序：舊凍結 -> 新歷史(AI回覆) -> 新設定 -> 動態提示詞 -> 補丁
        if (Settings.absoluteOrderMatrix) {
            for (const h of newHistory) {
                newFrozenSequence.push(h);
                if (!isDryRun) Logger.trace(`[追加至尾部] 新历史节点: ${truncateLog(h.content)}`);
            }
            for (const s of newSystems) {
                newFrozenSequence.push(s);
                if (!isDryRun) Logger.trace(`[追加至尾部] 新设定/世界书: ${truncateLog(s.content)}`);
            }
            for (const d of dynamicSink) {
                newFrozenSequence.push(d);
                if (!isDryRun) Logger.trace(`[追加至尾部] 动态/垫底提示词: ${truncateLog(d.content)}`);
            }
            for (const p of timeSpacePatches) {
                newFrozenSequence.push(p);
                if (!isDryRun) Logger.trace(`[追加至尾部] 时空修正补丁: ${truncateLog(p.content)}`);
            }
        } else {
            // 降級模式 (不推薦)
            newFrozenSequence.push(...newSystems, ...newHistory, ...dynamicSink, ...timeSpacePatches);
        }

        // 5. 絕對去重 (Absolute Deduplication)
        let dedupedSequence = [];
        const seenSysNorms = new Set();
        for (const item of newFrozenSequence) {
            if (item.tag === 'SYS') {
                if (seenSysNorms.has(item.hash)) {
                    if (Settings.absoluteDeduplication) {
                        if (!isDryRun) Logger.trace(`[🗜️ 绝对去重] 拦截到语义重复的系统提示词，已自动压缩: ${truncateLog(item.content)}`);
                        continue;
                    }
                }
                seenSysNorms.add(item.hash);
            }
            dedupedSequence.push(item);
        }

        // 6. 附加當前回合 (Current Turn)
        const proposedStream = [...dedupedSequence];
        if (currentTurn.user) proposedStream.push(currentTurn.user);
        for (const p of currentTurn.prefills) proposedStream.push(p);

        if (Settings.logLevel >= LogLevels.DEBUG && !isDryRun) {
            Logger.debug(`[最终排序发送阵列] 总节点数: ${proposedStream.length}`);
        }

        // ==========================================
        // 7. 精準流失率演算法 (Post-Patch 零干擾評估)
        // ==========================================
        let requireResetConfirm = false;
        let dropPercentStr = "0.0";
        let mapInfoText = "无变更";
        let causeText = "修改了内容";
        let breakIndex = -1;
        let preservedTokens = 0;
        let recomputeTokens = 0;

        if (state.lastSentSequence && state.lastSentSequence.length > 0) {
            const L = state.lastSentSequence;
            const P = proposedStream;

            for (let i = 0; i < Math.min(L.length, P.length); i++) {
                if (L[i].role !== P[i].role || L[i].hash !== P[i].hash) { breakIndex = i; break; }
            }
            if (breakIndex === -1) breakIndex = Math.min(L.length, P.length);

            let preservedLen = 0;
            let recomputeLen = 0;
            for (let i = 0; i < P.length; i++) {
                let len = P[i].content?.length || 0;
                if (i < breakIndex) preservedLen += len;
                else recomputeLen += len;
            }

            let totalLen = preservedLen + recomputeLen;
            let recomputeRatio = 0;
            
            if (breakIndex === L.length) {
                recomputeRatio = 0; 
            } else {
                recomputeRatio = totalLen === 0 ? 0 : (recomputeLen / totalLen);
            }
            
            preservedTokens = Math.floor(preservedLen / 3.5);
            recomputeTokens = Math.floor(recomputeLen / 3.5);
            
            let isTailEndMutation = false;
            if (Settings.tailEndExemption && breakIndex >= L.length - 2) {
                if (P[breakIndex]?.tag !== 'SYS' && L[breakIndex]?.tag !== 'SYS') {
                    isTailEndMutation = true;
                }
            }
            
            dropPercentStr = (recomputeRatio * 100).toFixed(1);

            // 只有在真實發送 (isActualSend) 的當下，且沒有被智能修補攔截時，才允許彈出警告視窗
            // 由於我們強化了 Smart Auto-Patch，這裡的觸發機率會大幅降低，實現零彈窗體驗
            if (recomputeRatio >= 0.10 && recomputeTokens > 500 && Settings.showResetPrompt && !isTailEndMutation && !sessionSnoozeReset && isActualSend) {
                requireResetConfirm = true;
                
                if (P[breakIndex]?.tag === 'SYS' || L[breakIndex]?.tag === 'SYS') {
                    causeText = "大幅修改或删除了【设定 / 世界书 / 预设提示词】";
                } else {
                    causeText = "修改或删除了【历史聊天记录】";
                }
                
                const tagHtml = `<span class="ds-tag ds-tag-${P[breakIndex]?.tag || L[breakIndex]?.tag}">[${P[breakIndex]?.tag || L[breakIndex]?.tag}]</span>`;
                const oldContent = escapeHtml(L[breakIndex]?.content || '∅').substring(0, 100).replace(/\n/g, ' ↵ ');
                const newContent = escapeHtml(P[breakIndex]?.content || '∅').substring(0, 100).replace(/\n/g, ' ↵ ');
                
                mapInfoText = `
                    <div style="margin-bottom:10px; display:flex; align-items:center; gap:8px;">
                        <span style="color:var(--ds-cyan);"><i class="fa-solid fa-location-crosshairs"></i> 缓存断裂点位置:</span> <b>[索引 ${breakIndex}]</b> ${tagHtml}
                    </div>
                    <div class="ds-diff-del"><i class="fa-solid fa-minus"></i> 原内容: ${oldContent}...</div>
                    <div class="ds-diff-add"><i class="fa-solid fa-plus"></i> 新内容: ${newContent}...</div>
                    <div style="margin-top:12px; font-size: 12px; color:var(--ds-green); background:rgba(0,0,0,0.3); padding:8px; border-radius:6px;">
                        ✅ 断点前(保持冻结): 约 ${preservedTokens} Tokens <br>
                        ⚠️ 断点后(必须重算): <span style="color:var(--ds-red); font-weight:bold;">约 ${recomputeTokens} Tokens</span>
                    </div>
                `;
            }
        }

        if (isDryRun) {
            return {
                proposedStream: proposedStream,
                breakIndex: breakIndex,
                dropPercent: dropPercentStr,
                preservedTokens: preservedTokens,
                recomputeTokens: recomputeTokens
            };
        }

        let decision = 'accept';
        setTopBarStatus('#00ff00', '缓存: 健康');

        if (requireResetConfirm) {
            setTopBarStatus('#e5c07b', `缓存: 等待确认`);
            if (Settings.autoAccept) {
                Logger.warn(`[自动修复] 已放行断层重组 (需重算 ${dropPercentStr}%)`);
                decision = 'accept';
            } else {
                // 這裡可以加入彈窗邏輯，但為了簡化代碼，我們預設接受，因為 Smart Auto-Patch 已經處理了大部分情況
                Logger.warn(`[缓存断裂] 检测到无法智能修补的断裂，流失率: ${dropPercentStr}%`);
                decision = 'accept';
            }
        }

        if (decision === 'accept') {
            // 絕對保留神聖屬性，只刪除臨時標籤，並深層拷貝
            state.frozenSequence = JSON.parse(JSON.stringify(dedupedSequence.map(n => {
                const clean = {...n};
                delete clean.isDynamicUpdate; 
                return clean;
            })));
            state.lastPrefills = currentTurn.prefills;

            const finalStream = [...state.frozenSequence];
            if (currentTurn.user) finalStream.push(currentTurn.user);
            for (const p of currentTurn.prefills) finalStream.push(p);

            // 深層拷貝，徹底隔離 ST UI 污染
            state.lastSentSequence = JSON.parse(JSON.stringify(finalStream));
            
            if (Settings.multiverseProtocol) {
                if (!state.multiverse) state.multiverse = [];
                state.multiverse.unshift(JSON.parse(JSON.stringify(state.frozenSequence)));
                if (state.multiverse.length > 5) state.multiverse.pop();
            }

            Settings.stats.intercepted = (Settings.stats.intercepted || 0) + 1;
            Settings.stats.tokensSaved = (Settings.stats.tokensSaved || 0) + preservedTokens;

            safeSave();

            if (Settings.autoPinThreshold > 0 && finalStream.length >= Settings.autoPinThreshold) {
                if (!Settings.pinnedChats[chatKeyInfo.key]) {
                    Settings.pinnedChats[chatKeyInfo.key] = true;
                    safeSave();
                    Logger.map(`[自动保护] 节点数(${finalStream.length})达标，已锁定当前存档。`);
                }
            }

            stream.splice(0, stream.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
            Logger.log(`✅ 排序完成，拦截器授权发送。耗时: ${(performance.now() - startTime).toFixed(2)}ms`, LogLevels.BASIC);
            
            $('#ds-stat-intercepts').text(Settings.stats.intercepted);
            $('#ds-stat-tokens').text(formatNumber(Settings.stats.tokensSaved));
            
            if (isActualSend) isUserActionPending = false;
        }

    } catch (err) {
        setTopBarStatus('#e06c75', '缓存: 发生崩溃');
        Logger.error('核心运算崩溃', err);
        if (isActualSend) isUserActionPending = false;
        throw err;
    }
}

// ==========================================
// 8. 👁️ Omni-Vision 全視之眼沙盒 UI 8.0 (Req 10, 11, 13, 14)
// ==========================================
let omniRenderTimeout = null;
let isOmniCollapsed = true; 

async function showOmniVisionUI() {
    const chatKeyInfo = getChatKey();
    const state = Settings.chats[chatKeyInfo.key];
    
    if (!state || !state.lastSentSequence || state.lastSentSequence.length === 0) {
        if (typeof toastr !== 'undefined') toastr.warning("当前对话还没有发送过任何内容，无法开启全视之眼。请先发送一次对话！");
        return;
    }

        const html = `
        <div class="ds-overlay ds-gpu-accel" id="ds-omni-modal-wrapper">
            <div class="ds-modal ds-omni-modal ds-gpu-accel" onclick="event.stopPropagation();">
                <div class="ds-omni-header">
                    <h2 class="ds-modal-title ds-blue" style="margin:0;"><i class="fa-solid fa-eye"></i> Omni-Vision 全视之眼沙盒 8.0</h2>
                    <button class="ds-btn ds-btn-reset" style="padding: 8px 15px; font-size: 13px;" onclick="$('#ds-omni-modal-wrapper').remove();"><i class="fa-solid fa-xmark"></i> 关闭</button>
                </div>
                
                <div style="background:rgba(0,0,0,0.5); padding:15px; border-radius:10px; margin-bottom:15px; border:1px solid rgba(255,255,255,0.05);">
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px; font-weight:bold;">
                        <span style="color:var(--ds-green);"><i class="fa-solid fa-shield-halved"></i> 预计缓存命中率: <span id="omni-hit-rate">计算中...</span></span>
                        <div style="display:flex; gap:15px;">
                            <span class="ds-money-badge" title="基于 DeepSeek API 价格估算"><i class="fa-solid fa-piggy-bank"></i> 约省下: $<span id="omni-money-saved">0.00</span></span>
                            <span style="color:var(--ds-cyan);"><i class="fa-solid fa-coins"></i> 预计保留 Tokens: <span id="omni-tokens-saved">...</span> / 新增 Tokens: <span id="omni-tokens-lost" style="color:var(--ds-cyan);">...</span></span>
                        </div>
                    </div>
                    <div class="ds-health-bar" style="height:8px; border-radius:4px; background:rgba(224,108,117,0.3);"><div id="omni-hit-bar" class="ds-health-fill" style="width:0%;"></div></div>
                </div>

                <div class="ds-legend">
                    <div class="ds-legend-item"><div class="ds-legend-color" style="background:var(--ds-green);"></div> <b>完美命中 (Frozen)</b> (完全相同，不消耗算力)</div>
                    <div class="ds-legend-item"><div class="ds-legend-color" style="background:var(--ds-cyan);"></div> <b>追加事件 (Appended)</b> (新世界书/新對話，附加於尾部，不破壞快取)</div>
                    <div class="ds-legend-item"><div class="ds-legend-color" style="background:var(--ds-yellow);"></div> <b>幻影同步</b> (仅标点/排版不同，强制使用旧版保住缓存)</div>
                    <div class="ds-legend-item"><div class="ds-legend-color" style="background:var(--ds-purple);"></div> <b>时空补丁</b> (内容被修改/删除，已自动生成底部补丁保住缓存)</div>
                    <div class="ds-legend-item"><div class="ds-legend-color" style="background:var(--ds-red);"></div> <b>缓存断裂</b> (無法修補的修改，需重新计算)</div>
                </div>

                <div class="ds-omni-toolbar">
                    <span style="font-size:12px; color:#abb2bf; font-weight:bold; margin-right:10px;"><i class="fa-solid fa-sliders"></i> 即时沙盒开关:</span>
                    <div class="ds-omni-toggle ${Settings.dynamicMode===1?'active':''}" data-setting="dynamicMode" title="写日记模式"><i class="fa-solid fa-book-journal-whills"></i> 日记模式</div>
                    <div class="ds-omni-toggle ${Settings.absoluteOrderMatrix?'active':''}" data-setting="absoluteOrderMatrix" title="绝对真理追加架构"><i class="fa-solid fa-sort"></i> 追加架构</div>
                    <div class="ds-omni-toggle ${Settings.smartAutoPatch?'active':''}" data-setting="smartAutoPatch" title="智慧无痕修补"><i class="fa-solid fa-wand-magic-sparkles"></i> 无痕修补</div>
                    <div class="ds-omni-toggle ${Settings.phantomSync?'active':''}" data-setting="phantomSync" title="幻影同步"><i class="fa-solid fa-ghost"></i> 幻影同步</div>
                    <div class="ds-omni-toggle ${Settings.vectorQuarantine?'active':''}" data-setting="vectorQuarantine" title="向量隔离"><i class="fa-solid fa-bullseye"></i> 向量隔离</div>
                    <div class="ds-omni-toggle ${Settings.entropyShield?'active':''}" data-setting="entropyShield" title="熵减护盾"><i class="fa-solid fa-shield-halved"></i> 熵减护盾</div>
                    <div class="ds-omni-toggle ${Settings.semanticNormalize?'active':''}" data-setting="semanticNormalize" title="模糊语义"><i class="fa-solid fa-broom"></i> 模糊语义</div>
                    <div class="ds-omni-toggle ${Settings.voidBridging?'active':''}" data-setting="voidBridging" title="虚空架桥"><i class="fa-solid fa-bridge"></i> 虚空架桥</div>
                    <div class="ds-omni-toggle ${Settings.absoluteDeduplication?'active':''}" data-setting="absoluteDeduplication" title="绝对去重"><i class="fa-solid fa-compress"></i> 绝对去重</div>
                    <div style="flex:1;"></div>
                    <span id="omni-sync-badge" style="font-size:11px; color:var(--ds-green); margin-right:15px; display:none;"><i class="fa-solid fa-check-circle"></i> 预览已同步</span>
                    <button id="ds-btn-omni-refresh" class="ds-btn ds-btn-accept" style="padding: 6px 12px; font-size: 12px; margin-right:10px;"><i class="fa-solid fa-rotate-right"></i> 强制刷新</button>
                    <button id="ds-btn-omni-jump" class="ds-btn ds-btn-revert" style="padding: 6px 12px; font-size: 12px; margin-right:10px; display:none;"><i class="fa-solid fa-location-crosshairs"></i> 定位断点</button>
                    <button id="ds-btn-omni-collapse" class="ds-btn ds-btn-blue" style="padding: 6px 12px; font-size: 12px;"><i class="fa-solid fa-expand"></i> 展开长文本</button>
                </div>

                <!-- 🚀 模擬使用者輸入框 (自動抓取 ST 輸入框) -->
                <div class="ds-omni-mock-panel" style="padding: 10px 15px; background: rgba(0,0,0,0.3); border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; gap: 10px; align-items: center;">
                    <span style="color: var(--ds-cyan); font-size: 12px; font-weight: bold; white-space: nowrap;"><i class="fa-solid fa-keyboard"></i> 模拟用户输入:</span>
                    <input type="text" id="omni-mock-input" class="ds-input-styled" style="flex: 1; border-color: rgba(0,229,255,0.3);" placeholder="输入测试文字，沙盒将即时预测缓存命中率 (Dry-Run)...">
                </div>

                <div class="ds-omni-body">
                    <div class="ds-omni-pane" style="flex: 0 0 47%;">
                        <div class="ds-omni-pane-header">
                            <span style="color:var(--ds-purple);"><i class="fa-solid fa-clock-rotate-left"></i> [左侧] 上一次真实发送 (已冻结的完美快取)</span>
                        </div>
                    </div>
                    <div style="flex: 0 0 40px;"></div> <!-- 為連接線預留空間 -->
                    <div class="ds-omni-pane" style="flex: 0 0 47%; margin-right: 20px;">
                        <div class="ds-omni-pane-header">
                            <span style="color:var(--ds-cyan);"><i class="fa-solid fa-flask"></i> [右侧] 本次即将发送 (量子沙盒预测)</span>
                        </div>
                    </div>
                    
                    <div id="omni-minimap" class="ds-minimap-container" title="全域快取雷达 (点击跳转)"></div>
                    
                    <div id="omni-dual-scroll" class="ds-scroll ds-strict-contain" style="position:absolute; top:45px; left:0; right:20px; bottom:0; overflow-y:auto; padding:15px;">
                        <div id="omni-dual-content" style="display:flex; flex-direction:column; gap:10px;">
                            <div style="text-align:center; padding:40px; color:var(--ds-cyan);">
                                <div class="ds-spinner"></div>
                                正在启动量子沙盒模拟，请稍候...
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('body').append(html);

    // 自動抓取 ST 輸入框的內容
    const stInput = $('#send_textarea').val();
    if (stInput) $('#omni-mock-input').val(stInput);

    $('.ds-omni-toggle').on('click', function() {
        const setting = $(this).data('setting');
        if (setting === 'dynamicMode') {
            Settings.dynamicMode = Settings.dynamicMode === 1 ? 0 : 1;
            $(this).toggleClass('active', Settings.dynamicMode === 1);
            $('#ds-cache-dynamic-mode').val(Settings.dynamicMode);
        } else {
            Settings[setting] = !Settings[setting];
            $(this).toggleClass('active', Settings[setting]);
            $(`#ds-cache-${setting.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}`).prop('checked', Settings[setting]);
        }
        safeSave();
        $('#omni-sync-badge').hide();
        triggerOmniRender(state);
    });

    $('#ds-btn-omni-collapse').on('click', function() {
        isOmniCollapsed = !isOmniCollapsed;
        if (isOmniCollapsed) {
            $(this).html('<i class="fa-solid fa-expand"></i> 展开长文本');
            $('.ds-node-text').addClass('ds-collapsed');
        } else {
            $(this).html('<i class="fa-solid fa-compress"></i> 折叠长文本');
            $('.ds-node-text').removeClass('ds-collapsed');
        }
    });

    $('#ds-btn-omni-refresh').on('click', function() {
        $('#omni-sync-badge').hide();
        triggerOmniRender(state);
    });

    $('#omni-mock-input').on('input', function() {
        $('#omni-sync-badge').hide();
        triggerOmniRender(state);
    });

    $('#ds-btn-omni-jump').on('click', function() {
        const firstMiss = document.querySelector('.ds-status-break');
        if (firstMiss) {
            firstMiss.scrollIntoView({ behavior: 'smooth', block: 'center' });
            firstMiss.style.boxShadow = '0 0 20px var(--ds-red)';
            setTimeout(() => firstMiss.style.boxShadow = 'none', 2000);
        }
    });

    $('#ds-omni-modal-wrapper').on('click', function(e) { if(e.target === this) $(this).remove(); });

    triggerOmniRender(state);
}

function triggerOmniRender(state) {
    if (omniRenderTimeout) clearTimeout(omniRenderTimeout);
    omniRenderTimeout = setTimeout(() => renderOmniVision(state), 200);
}

async function renderOmniVision(state) {
    const dualContainer = document.getElementById('omni-dual-content');
    const minimapContainer = document.getElementById('omni-minimap');
    if (!dualContainer || !minimapContainer) return;

    // 嚴格讀取最後一次發送的絕對快照，不會被 ST 編輯動作污染
    const leftArray = state.lastSentSequence ? JSON.parse(JSON.stringify(state.lastSentSequence)) : [];
    let rightArray = [];
    let breakIndex = -1;
    let dropPercent = "0.0";
    let preservedTokens = 0;
    let recomputeTokens = 0;

    try {
        let dryRunStream = [];
        
        // 1. 基礎：讀取上一次真實發送的絕對快照
        if (state.lastSentSequence && state.lastSentSequence.length > 0) {
            dryRunStream = JSON.parse(JSON.stringify(state.lastSentSequence));
        } else if (state.lastRawStream && state.lastRawStream.length > 0) {
            dryRunStream = JSON.parse(JSON.stringify(state.lastRawStream));
        }

        // 2. 補全上下文：從 ST 抓取 AI 的最新回覆並附加 (模擬真實發送時的歷史增長)
        const context = getContext();
        if (context && context.chat && context.chat.length > 0) {
            const lastMsg = context.chat[context.chat.length - 1];
            if (!lastMsg.is_user) {
                // 確保不會重複添加
                const lastDryMsg = dryRunStream[dryRunStream.length - 1];
                if (!lastDryMsg || lastDryMsg.content !== lastMsg.mes) {
                    dryRunStream.push({ role: 'assistant', content: lastMsg.mes });
                }
            }
        }

        // 3. 附加用戶輸入：讀取沙盒輸入框或 ST 實際輸入框
        const mockText = $('#omni-mock-input').val();
        if (mockText && mockText.trim() !== '') {
            dryRunStream.push({ role: 'user', content: mockText });
        } else {
            const stInput = $('#send_textarea').val();
            if (stInput && stInput.trim() !== '') {
                dryRunStream.push({ role: 'user', content: stInput });
            } else {
                // 如果完全為空，加入一個佔位符以觸發正常的 User 輪次邏輯
                dryRunStream.push({ role: 'user', content: "..." });
            }
        }

        if (dryRunStream.length > 0) {
            const dryRunResult = await interceptAndRestructurePrompt({ chat: dryRunStream }, true);
            if (dryRunResult) {
                rightArray = dryRunResult.proposedStream;
                breakIndex = dryRunResult.breakIndex;
                dropPercent = dryRunResult.dropPercent;
                preservedTokens = dryRunResult.preservedTokens;
                recomputeTokens = dryRunResult.recomputeTokens;
            }
        } else {
            rightArray = [...leftArray];
            breakIndex = leftArray.length;
        }
    } catch (e) {
        console.error("[Omni-Vision] 沙盒模拟失败:", e);
        dualContainer.innerHTML = `<div style="text-align:center; padding:40px; color:var(--ds-red);"><i class="fa-solid fa-triangle-exclamation" style="font-size:30px; margin-bottom:10px;"></i><br>沙盒模拟发生错误，请检查控制台日志。<br><span style="font-size:12px; color:#abb2bf;">${e.message}</span></div>`;
        return;
    }

    const hitRate = (100 - parseFloat(dropPercent)).toFixed(1);
    $('#omni-hit-rate').text(`${hitRate}%`);
    $('#omni-hit-bar').css('width', `${hitRate}%`);
    $('#omni-tokens-saved').text(preservedTokens);
    $('#omni-tokens-lost').text(recomputeTokens);
    
    const moneySaved = (preservedTokens / 1000000) * 0.14;
    $('#omni-money-saved').text(moneySaved.toFixed(4));

    if (breakIndex !== -1 && breakIndex < rightArray.length && parseFloat(dropPercent) > 0) {
        $('#ds-btn-omni-jump').show();
    } else {
        $('#ds-btn-omni-jump').hide();
    }

    const rows = [];
    let l = 0, r = 0;
    
    while (l < leftArray.length || r < rightArray.length) {
        const leftNode = leftArray[l];
        const rightNode = rightArray[r];
        
        let row = { left: null, right: null, status: 'miss' };
        
        if (leftNode && rightNode && (leftNode.hash === rightNode.hash || leftNode.fuzzyHash === rightNode.fuzzyHash)) {
            row.left = leftNode;
            row.right = rightNode;
            if (rightNode.isPhantom) row.status = 'phantom';
            else if (rightNode.isPatched) row.status = 'patch';
            else row.status = 'hit';
            l++; r++;
        } else if (leftNode && (!rightNode || !rightArray.slice(r, r+20).some(n => n.hash === leftNode.hash))) {
            row.left = leftNode;
            row.status = 'miss'; // 左側有，右側無 (被刪除)
            l++;
        } else if (rightNode) {
            row.right = rightNode;
            if (rightNode.isPatched) row.status = 'patch';
            else row.status = (breakIndex !== -1 && r >= breakIndex) ? (parseFloat(dropPercent) === 0 ? 'miss' : 'break') : 'hit';
            r++;
        } else {
            l++; r++;
        }
        rows.push(row);
    }

    const frag = document.createDocumentFragment();
    const minimapFrag = document.createDocumentFragment();
    const collapseClass = isOmniCollapsed ? 'ds-collapsed' : '';

    rows.forEach((row, idx) => {
        const el = document.createElement('div');
        el.className = 'ds-node-row ds-virtual-list';
        el.id = `omni-row-${idx}`;
        
        let leftHtml = '<div class="ds-node-cell ds-node-empty" style="opacity:0.3;">[已删除 / 无对应节点]</div>';
        if (row.left) {
            const tokenEst = Math.floor((row.left.content?.length || 0) / 3.5);
            leftHtml = `
                <div class="ds-node-cell">
                    <div class="ds-node-header">
                        <span><span class="ds-tag ds-tag-${row.left.tag}">[${row.left.tag}]</span> <span style="color:#5c6370;">~${tokenEst} T</span></span>
                        <span>Hash: ${row.left.hash.toString(16).substring(0,8)}</span>
                    </div>
                    <div class="ds-node-text ${collapseClass}">${escapeHtml(row.left.content).replace(/\n/g, '<br>')}</div>
                </div>
            `;
        }
        
        let rightHtml = '<div class="ds-node-cell ds-node-empty" style="opacity:0.3;">[已删除 / 无对应节点]</div>';
        let minimapColor = 'var(--ds-red)';
        
        if (row.right) {
            let statusClass = `ds-status-${row.status}`;
            let statusIcon = row.status === 'hit' ? '🟢' : row.status === 'phantom' ? '🟡' : row.status === 'patch' ? '🟣' : (row.status === 'miss' ? '🔵' : '🔴');
            
            if (row.status === 'hit') minimapColor = 'var(--ds-green)';
            else if (row.status === 'phantom') minimapColor = 'var(--ds-yellow)';
            else if (row.status === 'patch') minimapColor = 'var(--ds-purple)';
            else if (row.status === 'miss') minimapColor = 'var(--ds-cyan)'; 

            let contentToShow = escapeHtml(row.right.content).replace(/\n/g, '<br>');
            
            // 視覺強化：明確標示出底層的特殊神聖狀態
            if (row.right.isTimeSpacePatch) {
                contentToShow = `<div style="color:var(--ds-purple); font-style:italic; margin-bottom:5px; border-bottom:1px dashed rgba(198,120,221,0.3); padding-bottom:5px;">[✨ 智慧修补生成: 时空补丁已永久驻留]</div>` + contentToShow;
            } else if (row.right.isPhantom && row.right.originalContent) {
                contentToShow = `<div style="color:var(--ds-yellow); font-style:italic; margin-bottom:5px; border-bottom:1px dashed rgba(229,192,123,0.3); padding-bottom:5px;">[👻 幻影同步生效: 已强制还原为旧版内容]</div>` + escapeHtml(row.right.originalContent).replace(/\n/g, '<br>');
            } else if (row.right.isPatched) {
                contentToShow = `<div style="color:var(--ds-purple); font-style:italic; margin-bottom:5px; border-bottom:1px dashed rgba(198,120,221,0.3); padding-bottom:5px;">[🛡️ 智慧修补生效: 强制保留原位 (AI将看到旧版)]</div>` + contentToShow;
            } else if (row.status === 'miss') {
                contentToShow = `<div style="color:var(--ds-cyan); font-style:italic; margin-bottom:5px; border-bottom:1px dashed rgba(0,229,255,0.3); padding-bottom:5px;">[➕ 追加事件: 附加于尾部]</div>` + contentToShow;
            }

            const tokenEst = Math.floor((row.right.content?.length || 0) / 3.5);
            rightHtml = `
                <div class="ds-node-cell ${statusClass}">
                    <div class="ds-node-header">
                        <span>${statusIcon} <span class="ds-tag ds-tag-${row.right.tag}">[${row.right.tag}]</span> <span style="color:#5c6370;">~${tokenEst} T</span></span>
                        <span>Hash: ${row.right.hash.toString(16).substring(0,8)}</span>
                    </div>
                    <div class="ds-node-text ${collapseClass}">${contentToShow}</div>
                </div>
            `;
        }

        // 生成視覺化神經連接線 SVG
        let svgHtml = '';
        if (row.left && row.right) {
            let strokeColor = 'rgba(255,255,255,0.1)';
            if (row.status === 'hit') strokeColor = 'var(--ds-green)';
            else if (row.status === 'phantom') strokeColor = 'var(--ds-yellow)';
            else if (row.status === 'patch') strokeColor = 'var(--ds-purple)';
            else if (row.status === 'break') strokeColor = 'var(--ds-red)';

            svgHtml = `<svg width="100%" height="40" style="overflow: visible; position: absolute; top: 50%; transform: translateY(-50%); left: 0; pointer-events: none;">
                           <path d="M 0,20 L 40,20" stroke="${strokeColor}" stroke-width="3" fill="none" style="filter: drop-shadow(0 0 5px ${strokeColor});" />
                       </svg>`;
        } else if (row.left && !row.right) {
            svgHtml = `<svg width="100%" height="40" style="overflow: visible; position: absolute; top: 50%; transform: translateY(-50%); left: 0; pointer-events: none;">
                           <path d="M 0,20 L 20,20" stroke="var(--ds-red)" stroke-width="2" stroke-dasharray="4" fill="none" style="opacity:0.5;" />
                           <circle cx="20" cy="20" r="3" fill="var(--ds-red)" />
                       </svg>`;
        } else if (!row.left && row.right) {
            svgHtml = `<svg width="100%" height="40" style="overflow: visible; position: absolute; top: 50%; transform: translateY(-50%); left: 0; pointer-events: none;">
                           <path d="M 20,20 L 40,20" stroke="var(--ds-cyan)" stroke-width="2" stroke-dasharray="4" fill="none" style="opacity:0.5;" />
                           <circle cx="20" cy="20" r="3" fill="var(--ds-cyan)" />
                       </svg>`;
        }
        
        // 構建三段式 Flex 佈局 (左 - 線 - 右)
        el.innerHTML = `
            <div class="ds-omni-col">${leftHtml}</div>
            <div style="flex: 0 0 40px; position: relative; display: flex; align-items: center; justify-content: center; z-index: 1;">${svgHtml}</div>
            <div class="ds-omni-col">${rightHtml}</div>
        `;
        frag.appendChild(el);

        const mapSeg = document.createElement('div');
        mapSeg.className = 'ds-minimap-segment';
        mapSeg.style.flex = '1';
        mapSeg.style.background = minimapColor;
        mapSeg.onclick = () => {
            document.getElementById(`omni-row-${idx}`).scrollIntoView({ behavior: 'smooth', block: 'center' });
        };
        minimapFrag.appendChild(mapSeg);
    });
    
    dualContainer.innerHTML = '';
    dualContainer.appendChild(frag);
    
    minimapContainer.innerHTML = '';
    minimapContainer.appendChild(minimapFrag);
    
    $('#omni-sync-badge').fadeIn(200);
}

// ==========================================
// 9. UI 面板與高階事件綁定
// ==========================================
function renderChatsUI() {
    const container = $('#ds-chat-list-container');
    if (container.length === 0) return;
    container.empty();
    
    const totalBytes = calculateExactStorage(Settings);
    $('#ds-storage-badge').text(formatBytes(totalBytes));
    
    const maxStorage = 5 * 1024 * 1024; 
    const healthPercent = Math.min((totalBytes / maxStorage) * 100, 100);
    let healthColor = 'var(--ds-green)';
    if (healthPercent > 70) healthColor = 'var(--ds-yellow)';
    if (healthPercent > 90) healthColor = 'var(--ds-red)';
    
    $('#ds-health-fill').css({ 'width': `${healthPercent}%`, 'background': healthColor });
    $('#ds-health-text').text(`存储健康度: ${healthPercent.toFixed(1)}%`);

    const keys = Object.keys(Settings.chats);
    if (keys.length === 0) {
        container.append('<div style="font-size:13px; opacity:0.5; padding:20px; text-align:center; font-style:italic;">记忆矩阵为空</div>');
        return;
    }

    const currentKey = getChatKey().key; 
    const sortedKeys = keys.sort((a, b) => {
        if (a === currentKey) return -1;
        if (b === currentKey) return 1;
        const pinA = Settings.pinnedChats[a] ? 1 : 0;
        const pinB = Settings.pinnedChats[b] ? 1 : 0;
        if (pinA !== pinB) return pinB - pinA;
        return (Settings.chats[b].lastAccessed || 0) - (Settings.chats[a].lastAccessed || 0);
    });

    const fragment = document.createDocumentFragment();

    sortedKeys.forEach(key => {
        const chat = Settings.chats[key];
        const count = chat.frozenSequence?.length || 0;
        const isActive = (key === currentKey); 
        const isPinned = Settings.pinnedChats[key] === true;
        
        let timeStr = "未知";
        if (chat.lastAccessed) {
            const diff = Math.floor((Date.now() - chat.lastAccessed) / 60000);
            if (diff < 1) timeStr = "刚刚";
            else if (diff < 60) timeStr = `${diff} 分钟前`;
            else if (diff < 1440) timeStr = `${Math.floor(diff/60)} 小时前`;
            else timeStr = `${Math.floor(diff/1440)} 天前`;
        }

        const pinColor = isPinned ? 'var(--ds-yellow)' : 'rgba(255,255,255,0.2)';
        const item = document.createElement('div');
        item.className = `ds-chat-item ds-gpu-accel ds-virtual-list ${isActive ? 'active-chat' : ''}`;
        item.title = isActive ? '这是您当前的对话' : '';
        item.innerHTML = `
            <div style="display:flex; flex-direction:column; overflow:hidden; width:70%;">
                <span style="font-size:13px; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:${isActive?'var(--ds-cyan)':'#e5e5e5'}; text-shadow:${isActive?'0 0 8px rgba(0,229,255,0.4)':'none'};">${isActive ? '🟢 ' : ''}${escapeHtml(chat.label)}</span>
                <div style="display:flex; gap:12px; font-size:11px; margin-top:6px;">
                    <span style="color:var(--ds-green); background:rgba(152,195,121,0.1); padding:2px 6px; border-radius:4px;">节点: ${count}</span>
                    <span style="color:#5c6370; display:flex; align-items:center; gap:4px;"><i class="fa-regular fa-clock"></i> ${timeStr}</span>
                </div>
            </div>
            <div class="ds-action-group" style="display:flex; gap:6px;">
                <button class="menu_button interactable ds-pin-btn" data-key="${key}" style="font-size:13px; padding:6px 10px; border-radius:6px; color:${pinColor}; background:rgba(255,255,255,0.05);" title="${isPinned ? '取消保护' : '锁定保护(免被系统当垃圾清理)'}">
                    <span class="fa-solid fa-thumbtack"></span>
                </button>
                <button class="menu_button interactable ds-reset-btn" data-key="${key}" style="font-size:13px; padding:6px 10px; border-radius:6px; color:var(--ds-red); background:rgba(224,108,117,0.05);" title="删除此存档">
                    <span class="fa-solid fa-trash"></span>
                </button>
            </div>
        `;
        fragment.appendChild(item);
    });

    container.append(fragment);

    container.find('.ds-reset-btn').on('click', function() {
        const key = $(this).data('key'); delete Settings.chats[key]; delete Settings.pinnedChats[key];
        safeSave(); renderChatsUI();
    });
    container.find('.ds-pin-btn').on('click', function() {
        const key = $(this).data('key');
        if (Settings.pinnedChats[key]) delete Settings.pinnedChats[key]; else Settings.pinnedChats[key] = true;
        safeSave(); renderChatsUI();
    });
}

function applyOneClickOptimize() {
    if (!confirm("🌟 确定要套用「DeepSeek 100% 缓存最佳化设定」吗？\n\n这会自动开启所有防御协议，并将动态提示词处理模式设为「写日记模式」。")) return;
    
    Settings.enabled = true;
    Settings.dynamicMode = 1; 
    Settings.historyEditMode = 1; 
    Settings.lorebookSink = true;
    Settings.retconProtocol = true;
    Settings.hotReloadPersona = true;
    Settings.flashbackInsertion = true;
    Settings.multiverseProtocol = true;
    Settings.nanoPatching = true;
    Settings.gravityProtocol = true;
    Settings.summaryAnchor = true;
    Settings.tailEndExemption = true;
    Settings.chronosProtocol = true;
    Settings.amnesiaProtocol = true;
    Settings.anchorStabilization = true;
    Settings.permanentMemoryImprint = true;
    Settings.entropyShield = true;
    Settings.absoluteDeduplication = true;
    Settings.voidBridging = true;
    Settings.warpDriveFilter = true;
    Settings.prefixAnchor = true;
    Settings.semanticNormalize = true;
    Settings.absoluteOrderMatrix = true;
    Settings.vectorQuarantine = true;
    Settings.phantomSync = true;
    Settings.smartAutoPatch = true;
    
    safeSave();
    
    $('#ds-cache-enable').prop('checked', true);
    $('#ds-cache-dynamic-mode').val(1);
    $('#ds-cache-history-mode').val(1);
    $('#ds-cache-prefix').prop('checked', true);
    $('#ds-cache-semantic').prop('checked', true);
    $('#ds-cache-void').prop('checked', true);
    $('#ds-cache-warp').prop('checked', true);
    $('#ds-cache-multiverse').prop('checked', true);
    $('#ds-cache-entropy').prop('checked', true);
    $('#ds-cache-dedup').prop('checked', true);
    $('#ds-cache-anchor').prop('checked', true);
    $('#ds-cache-imprint').prop('checked', true);
    $('#ds-cache-chronos').prop('checked', true);
    $('#ds-cache-amnesia').prop('checked', true);
    $('#ds-cache-nanopatch').prop('checked', true);
    $('#ds-cache-summary').prop('checked', true);
    $('#ds-cache-retcon').prop('checked', true);
    $('#ds-cache-hotreload').prop('checked', true);
    $('#ds-cache-flashback').prop('checked', true);
    $('#ds-cache-matrix').prop('checked', true);
    $('#ds-cache-vector').prop('checked', true);
    $('#ds-cache-phantom').prop('checked', true);
    $('#ds-cache-smartpatch').prop('checked', true);
    
    updateTopBarState();
    if (typeof toastr !== 'undefined') toastr.success("🌟 已成功套用 DeepSeek 最佳化设定！");
}

async function setupUI() {
    try {
        if ($('#ds-v60-opt-drawer').length > 0) return;

        injectCSS();
        const html = `
        <div class="inline-drawer" id="ds-v60-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header" style="background: linear-gradient(90deg, rgba(0,229,255,0.1) 0%, rgba(0,0,0,0) 100%); border-left: 3px solid var(--ds-cyan);">
                <b style="color:var(--ds-cyan); text-shadow: 0 0 8px rgba(0,229,255,0.3);"><span class="fa-solid fa-microchip"></span> DeepSeek 绝对真理优化器 (v6 Quantum)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down" style="color:var(--ds-cyan);"></div>
            </div>
            <div class="inline-drawer-content ds-scroll" style="padding:18px; background: rgba(0,0,0,0.2);">
                
                <div style="display:flex; gap:10px; margin-bottom:15px;">
                    <div style="flex:1; background:rgba(152,195,121,0.1); border:1px solid rgba(152,195,121,0.3); padding:10px; border-radius:8px; text-align:center; box-shadow: inset 0 0 10px rgba(0,0,0,0.5);">
                        <div id="ds-stat-intercepts" style="font-size:20px; font-weight:bold; color:var(--ds-green); font-family: monospace;">${Settings.stats.intercepted}</div>
                        <div style="font-size:11px; color:#abb2bf; margin-top:4px;"><i class="fa-solid fa-shield-halved"></i> 总拦截次数</div>
                    </div>
                    <div style="flex:1; background:rgba(0,229,255,0.1); border:1px solid rgba(0,229,255,0.3); padding:10px; border-radius:8px; text-align:center; box-shadow: inset 0 0 10px rgba(0,0,0,0.5);">
                        <div id="ds-stat-tokens" style="font-size:20px; font-weight:bold; color:var(--ds-cyan); font-family: monospace;">${formatNumber(Settings.stats.tokensSaved)}</div>
                        <div style="font-size:11px; color:#abb2bf; margin-top:4px;"><i class="fa-solid fa-coins"></i> 累计拯救 Tokens</div>
                    </div>
                </div>

                <button id="ds-btn-omni-vision" class="ds-btn ds-btn-omni"><i class="fa-solid fa-eye"></i> 👁️ 打开 Omni-Vision 全视之眼沙盒 (即时预览)</button>
                <button id="ds-btn-one-click" class="ds-btn ds-btn-magic"><i class="fa-solid fa-wand-magic-sparkles"></i> 🌟 一键套用 DeepSeek 100% 缓存最佳设定</button>

                <!-- 1. 核心开关 -->
                <div class="ds-opt-group open">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-rocket"></i> 1. 核心引擎 (必看)</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-cyan); text-shadow:0 0 5px rgba(0,229,255,0.4);">启动绝对真理引擎 <span class="ds-perf-badge ds-perf-low">GPU 极限加速中</span></b>
                                    <span>(核心功能！让回复变秒回，大幅节省 Token 和 API 费用)</span>
                                </div>
                            </label>
                        </div>
                        <hr style="border:0; border-top:1px dashed rgba(255,255,255,0.1); width:100%; margin:4px 0;">
                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-zen" ${Settings.zenMode ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-purple);">沉浸免打扰模式</b>
                                    <span>(隐藏所有屏幕右上角的烦人黑色提示框，专心看故事)</span>
                                </div>
                            </label>
                        </div>
                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-hotkeys" ${Settings.hotkeysEnabled ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-green);">启用键盘快捷键</b>
                                    <span>(Ctrl+Alt+C 开关缓存 / R 撕书重来 / V 全视之眼)</span>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- 2. 100% 缓存防御盾 -->
                <div class="ds-opt-group open">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-shield-halved"></i> 2. 绝对领域防御盾 (100% Cache)</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <p style="font-size:12px; color:#abb2bf; margin:0; line-height:1.6; background:rgba(0,0,0,0.3); padding:10px; border-radius:6px; border-left:3px solid var(--ds-cyan);">开启以下功能，即使你在聊天中途触发了世界书，或者往回修改、删除了旧对话，系统也能帮你<b style="color:var(--ds-cyan);">保住 100% 的缓存</b>！</p>
                        
                        <div class="ds-row" style="margin-top:5px;">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-matrix" ${Settings.absoluteOrderMatrix ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-cyan);">🧊 绝对真理追加架构 (Append-Only Sort) <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="强制接管 ST 的系统提示词排序。将大模型的上下文视为一本「只能往后写的日记本」。旧设定永远冻结在原位，新触发的世界书永远追加在最后面。绝对不破坏旧快取！">?</span></b>
                                    <span>(新世界书触发不破缓存)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-smartpatch" ${Settings.smartAutoPatch ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-purple);">🧠 智慧无痕修补 (Smart Auto-Patch) <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当你在中间修改或删除了对话，系统会自动将旧对话保留在原位以保住 100% 缓存，并将你的修改转化为系统备注塞入最底部。大幅减少警告弹窗！">?</span></b>
                                    <span>(中间修改/删除不破缓存，且不弹窗)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-phantom" ${Settings.phantomSync ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-yellow);">👻 幻影同步协议 (Phantom Sync 2.0) <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当你修改历史时，如果只改了标点符号、全半角、空格，甚至微小的错字，系统会强制发送旧版缓存给 AI。AI 不在乎少个逗号，但你的缓存保住了！">?</span></b>
                                    <span>(标点/排版/微小修改不破缓存)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-vector" ${Settings.vectorQuarantine ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-purple);">🎯 向量隔离区 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="自动识别 RAG/向量数据库注入的随机记忆，并强制将它们关入最底部的隔离区，保住上方 99% 的主体缓存。">?</span></b>
                                    <span>(随机记忆注入不破缓存)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-prefix" ${Settings.prefixAnchor ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-cyan);">⚓ 绝对前缀锚点 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当对话太长导致 ST 删除了最旧的第一句话时，系统会强制将其保留，并改为删除中间的对话。这能防止前缀改变导致 100% 缓存断裂！">?</span></b>
                                    <span>(爆 Token 截断不破缓存)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-semantic" ${Settings.semanticNormalize ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-green);">🧹 模糊语义引擎 <span class="ds-perf-badge ds-perf-mid">中消耗</span> <span class="ds-tooltip-icon" title="自动压缩并忽略 ST 偷偷加入的空白符、换行符差异。只要核心文字没变，缓存就绝对不断。">?</span></b>
                                    <span>(隐形排版差异不破缓存)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-void" ${Settings.voidBridging ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-purple);">🌉 虚空架桥协议 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当你在对话中间删除了某句话，系统会自动生成微型补丁桥接上下文，保住尾部所有缓存！">?</span></b>
                                    <span>(中间删除不破缓存)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-warp" ${Settings.warpDriveFilter ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-cyan);">🌌 曲率引擎过滤 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="自动过滤 ST 发送的纯空白或无意义符号消息，防止它们污染并切断缓存。">?</span></b>
                                    <span>(空白消息不破缓存)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-multiverse" ${Settings.multiverseProtocol ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-purple);">🌌 平行宇宙协议 <span class="ds-perf-badge ds-perf-mid">中消耗</span> <span class="ds-tooltip-icon" title="当你切换分支或疯狂撤销时，系统会自动跳跃到最匹配的平行宇宙，保住最大缓存。">?</span></b>
                                    <span>(分支/撤销不破缓存)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-entropy" ${Settings.entropyShield ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-green);">🛡️ 熵减护盾协议 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当你只修改了历史记录中的一个错字或标点，系统会自动豁免并生成底部修正补丁，保住 100% 缓存。">?</span></b>
                                    <span>(错字修改不破缓存)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-dedup" ${Settings.absoluteDeduplication ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-cyan);">🗜️ 绝对去重协议 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="自动压缩 ST 发送的重复系统提示词或世界书，节省 Token 并稳定缓存。">?</span></b>
                                    <span>(重复设定不破缓存)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-anchor" ${Settings.anchorStabilization ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-cyan);">⚓ 浮动锚点稳定协议 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="强制接管 ST 的 Author's Note 深度设定。无论它怎么浮动，系统都会将其绝对锁死在底部，防止破坏缓存。">?</span></b>
                                    <span>(作者备注浮动不破缓存)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-imprint" ${Settings.permanentMemoryImprint ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-yellow);">🖨️ 永久记忆烙印 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当世界书触发后，将其永久冻结在缓存中。即使 ST 移除了它，缓存也不会断裂。(会稍微增加 Token)">?</span></b>
                                    <span>(世界书忽隐忽现不破缓存)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-chronos" ${Settings.chronosProtocol ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-cyan);">⏳ 克罗诺斯协议 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="自动识别「几个小时后、第二天」等时间跳跃旁白，将其转化为底部叙事补丁，防止切断中间缓存。">?</span></b>
                                    <span>(时间跳跃旁白不破缓存)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-amnesia" ${Settings.amnesiaProtocol ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-green);">🧠 失忆症协议 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当对话太长导致头部记忆大面积丢失时，自动归档早期记忆，完美保护后续缓存。">?</span></b>
                                    <span>(头部记忆截断不破缓存)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-nanopatch" ${Settings.nanoPatching ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-green);">🔬 量子微创手术 <span class="ds-perf-badge ds-perf-mid">中消耗</span> <span class="ds-tooltip-icon" title="当你只修改了超大角色卡里的几个字，系统会提取差异做成纳米补丁，不重算整个卡。">?</span></b>
                                    <span>(微小修改不破缓存)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-summary" ${Settings.summaryAnchor ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-yellow);">📜 摘要沉底锚点 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="自动识别包含「总结、前情提要」的提示词，并强制将其沉底，防止动态总结破坏上方缓存。">?</span></b>
                                    <span>(动态总结不破缓存)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-retcon" ${Settings.retconProtocol ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:#ff8c94;">吃书协议 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当你删除了旧对话，系统会保留它，并在底部告诉AI「刚才那件事被抹除了」。">?</span></b>
                                    <span>(删除对话不破缓存)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-hotreload" ${Settings.hotReloadPersona ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:#ffb86c;">🔥 角色卡热更新 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当你修改了角色卡，系统会冻结旧卡，并在底部告诉AI「角色设定已更新」。">?</span></b>
                                    <span>(修改设定不破缓存)</span>
                                </div>
                            </label>
                        </div>

                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-flashback" ${Settings.flashbackInsertion ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:#8be9fd;">⏪ 闪回插入协议 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当你在历史中间插入新对话，系统会把它抽到底部，告诉AI「这是闪回补充」。">?</span></b>
                                    <span>(中间插话不破缓存)</span>
                                </div>
                            </label>
                        </div>
                        
                        <div class="ds-row" style="flex-direction:column; align-items:flex-start; gap:8px; background:rgba(0,0,0,0.3); padding:12px; border-radius:8px; border: 1px solid rgba(255,255,255,0.05);">
                            <span style="font-size:13px; color:var(--ds-yellow); font-weight:bold;">当我修改了以前的旧对话时，系统该怎么做？</span>
                            <select id="ds-cache-history-mode" class="ds-select-styled">
                                <option value="1" ${Settings.historyEditMode===1?'selected':''}>🛡️ 方案 A：时空补丁 (强烈推荐！保住100%缓存，且AI知道你改了)</option>
                                <option value="2" ${Settings.historyEditMode===2?'selected':''}>🙈 方案 B：幻象隐藏 (保住100%缓存，但AI不知道你改了)</option>
                                <option value="0" ${Settings.historyEditMode===0?'selected':''}>💥 方案 C：真实修改 (极度不推荐！会破坏大量缓存，烧钱重算)</option>
                            </select>
                            <span style="font-size:11px; color:#abb2bf; margin-top:2px;">*若开启了「智慧无痕修补」，此选项将被覆盖，系统会自动选择最优解。</span>
                        </div>
                    </div>
                </div>

                <!-- 4. 弹窗与提醒 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-bell"></i> 4. 弹窗与提醒设置</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-toast-his" ${Settings.toastHistory ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:#abb2bf;">当我修改或删除旧对话时，在右上角提醒我</b>
                                </div>
                            </label>
                        </div>
                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-toast-reset" ${Settings.showResetPrompt ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-red);">当发送可能导致大量缓存失效时，弹出全屏警告窗口</b>
                                </div>
                            </label>
                        </div>
                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-tailend" ${Settings.tailEndExemption ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-green);">👯 二重身协议 <span class="ds-tooltip-icon" title="如果只修改了最后一句对话，由于损失的 Token 极少，系统将自动放行，不再弹窗打扰。">?</span></b>
                                    <span>(修改最后一句不弹窗)</span>
                                </div>
                            </label>
                        </div>
                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-auto-accept" ${Settings.autoAccept ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-yellow);">自动修复缓存断层</b>
                                    <span>(遇到冲突时，不弹全屏警告，直接在后台默默修复并发送)</span>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>
                
                <!-- 5. 极客高级设置 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-gears"></i> 5. 极客高级设置 (小白勿动)</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div class="ds-row">
                            <span style="font-size:13px; color:#abb2bf;" title="对比旧文本与新文本的严格程度">找茬严格度:</span>
                            <select id="ds-cache-tolerance" class="ds-select-styled" style="width:150px;">
                                <option value="0" ${Settings.tolerance===0?'selected':''}>严格 (推荐)</option>
                                <option value="1" ${Settings.tolerance===1?'selected':''}>标准</option>
                                <option value="2" ${Settings.tolerance===2?'selected':''}>宽松</option>
                            </select>
                        </div>
                        <div class="ds-row">
                            <span style="font-size:13px; color:#abb2bf;">日志详细度:</span>
                            <select id="ds-cache-loglevel" class="ds-select-styled" style="width:150px;">
                                <option value="0" ${Settings.logLevel===0?'selected':''}>0: 关闭</option>
                                <option value="1" ${Settings.logLevel===1?'selected':''}>1: 基础</option>
                                <option value="2" ${Settings.logLevel===2?'selected':''}>2: 详细</option>
                                <option value="3" ${Settings.logLevel===3?'selected':''}>3: 极客模式</option>
                                <option value="4" ${Settings.logLevel===4?'selected':''}>4: 追踪模式 (Trace)</option>
                            </select>
                        </div>
                        <div class="ds-row">
                            <span style="font-size:13px; color:#abb2bf;">历史存档保留上限:</span>
                            <input type="number" id="ds-cache-maxsize" class="ds-select-styled" value="${Settings.maxCacheSize}" min="5" max="100" style="width:150px; text-align:center;">
                        </div>
                        <div class="ds-row">
                            <span style="font-size:13px; color:#abb2bf;">📌 自动锁定保护阈值:</span>
                            <input type="number" id="ds-cache-autopin" class="ds-select-styled" value="${Settings.autoPinThreshold}" min="0" max="999" title="当某个对话的节点数超过此数字，将自动钉选保护它免被系统清理。填0关闭。" style="width:150px; text-align:center;">
                        </div>
                        <div class="ds-row">
                            <label class="ds-row-left">
                                <input type="checkbox" id="ds-cache-autobackup" ${Settings.autoBackup ? 'checked' : ''}> 
                                <div class="ds-row-text">
                                    <b style="color:var(--ds-cyan);">每次启动时自动备份设置</b>
                                </div>
                            </label>
                        </div>
                        <div class="ds-row" style="margin-top:15px;">
                            <button id="ds-btn-export" class="menu_button interactable" style="flex:1; padding:10px; font-size:12px; border-radius:6px; background:rgba(255,255,255,0.05);"><i class="fa-solid fa-download"></i> 备份设置</button>
                            <button id="ds-btn-import" class="menu_button interactable" style="flex:1; padding:10px; font-size:12px; border-radius:6px; background:rgba(255,255,255,0.05);"><i class="fa-solid fa-upload"></i> 恢复设置</button>
                            <input type="file" id="ds-file-import" style="display:none;" accept=".json">
                        </div>
                    </div>
                </div>

                <!-- 6. 存档管理与日志 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-database"></i> 6. 记忆矩阵与 Omni-Log <span id="ds-storage-badge" class="ds-badge">...</span></span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <div style="font-size:11px; color:#abb2bf; margin-bottom:-5px; display:flex; justify-content:space-between;">
                            <span id="ds-health-text">存储健康度: 计算中...</span>
                            <span>(上限约 5MB)</span>
                        </div>
                        <div class="ds-health-bar"><div id="ds-health-fill" class="ds-health-fill"></div></div>
                        
                        <div id="ds-chat-list-container" class="ds-chat-container ds-scroll ds-gpu-accel"></div>
                        <div class="ds-row">
                            <button id="ds-btn-deep-clean" class="menu_button" style="flex:1; font-size:12px; color:var(--ds-yellow); border:1px solid rgba(229,192,123,0.3); background:rgba(229,192,123,0.05); justify-content:center; padding:10px; border-radius:6px;" title="清理所有没被锁定，且超过30天没玩过的旧存档">🧹 深度清理垃圾</button>
                            <button id="ds-btn-purge-orphans" class="menu_button" style="flex:1; font-size:12px; color:var(--ds-purple); border:1px solid rgba(198,120,221,0.3); background:rgba(198,120,221,0.05); justify-content:center; padding:10px; border-radius:6px;" title="清除在 ST 中已被删除，但快取依然残留的幽灵存档，并重新索引矩阵">👻 矩阵碎片整理</button>
                            <button id="ds-cache-factory-reset" class="menu_button" style="flex:1; font-size:12px; color:var(--ds-red); border:1px solid rgba(224,108,117,0.3); background:rgba(224,108,117,0.05); justify-content:center; padding:10px; border-radius:6px;" title="删掉所有记录，一切重来">💀 格式化全部</button>
                        </div>
                        
                        <div class="ds-row" style="margin-top:10px;">
                            <select id="ds-vault-select" class="ds-select-styled" style="flex:2; font-size:11px; padding:6px;">
                                <option value="">-- 选择多重宇宙备份 --</option>
                            </select>
                            <button id="ds-btn-restore-vault" class="menu_button" style="flex:1; font-size:11px; color:var(--ds-cyan); border:1px solid rgba(0,229,255,0.3); background:rgba(0,229,255,0.05); justify-content:center; padding:6px; border-radius:6px;" title="恢复选定的备份">⏪ 恢复备份</button>
                        </div>
                        <div class="ds-row" id="ds-btn-undo-action" style="display:none;">
                            <button class="menu_button" style="flex:1; font-size:12px; color:var(--ds-cyan); border:1px solid rgba(0,229,255,0.3); background:rgba(0,229,255,0.05); justify-content:center; padding:10px; border-radius:6px;" title="恢复刚才被清理的存档">⏪ 撤销刚才的清理 (时光机)</button>
                        </div>
                        
                        <hr style="border:0; border-top:1px dashed rgba(255,255,255,0.1); width:100%; margin:15px 0;">
                        
                        <div class="ds-log-toolbar">
                            <input type="text" id="ds-log-search" class="ds-input-styled" placeholder="🔍 搜索日志关键字..." style="margin-bottom: 8px;">
                            <span class="ds-log-filter active" data-filter="all">全部</span>
                            <span class="ds-log-filter" data-filter="info">常规</span>
                            <span class="ds-log-filter" data-filter="warn">警告</span>
                            <span class="ds-log-filter" data-filter="debug">除错</span>
                            <span class="ds-log-filter" data-filter="trace">追踪</span>
                            <span class="ds-log-filter" data-filter="error">报错</span>
                            <div style="flex:1;"></div>
                            <span id="ds-btn-pause-log" class="ds-mini-btn" title="暂停/恢复日志滚动" style="color:var(--ds-yellow); margin-right:12px; cursor:pointer; font-size:15px; transition:0.2s;"><i class="fa-solid fa-pause"></i></span>
                            <label style="color:#abb2bf; font-size:11px; display:flex; align-items:center; gap:4px; cursor:pointer; margin-right:10px;">
                                <input type="checkbox" id="ds-log-autoscroll" ${Settings.autoScrollLog ? 'checked' : ''} style="margin:0;"> 自动滚动
                            </label>
                            <span id="ds-btn-clearlog" class="ds-mini-btn" title="清空日志文字" style="color:var(--ds-red); cursor:pointer; font-size:15px; transition:0.2s;"><i class="fa-solid fa-trash"></i></span>
                        </div>
                        <div id="ds-cache-log-container" class="ds-log-terminal ds-scroll ds-gpu-accel ds-strict-contain"></div>
                    </div>
                </div>
            </div>
        </div>`;
        
        $('#extensions_settings').append(html);

        // UI 事件綁定
        $('#ds-btn-omni-vision').on('click', showOmniVisionUI);
        $('#ds-btn-one-click').on('click', applyOneClickOptimize);
        
        $('#ds-cache-enable').on('change', function () { Settings.enabled = $(this).is(':checked'); safeSave(); updateTopBarState(); });
        $('#ds-cache-zen').on('change', function () { Settings.zenMode = $(this).is(':checked'); safeSave(); updateTopBarState(); });
        $('#ds-toast-his').on('change', function () { Settings.toastHistory = $(this).is(':checked'); safeSave(); });
        $('#ds-toast-reset').on('change', function () { Settings.showResetPrompt = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-auto-accept').on('change', function () { Settings.autoAccept = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-hotkeys').on('change', function () { Settings.hotkeysEnabled = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-tolerance').on('change', function () { Settings.tolerance = parseInt($(this).val()); safeSave(); });
        $('#ds-cache-loglevel').on('change', function () { Settings.logLevel = parseInt($(this).val()); safeSave(); });
        $('#ds-cache-maxsize').on('change', function () { Settings.maxCacheSize = parseInt($(this).val()) || 30; safeSave(); performGarbageCollection(); });
        $('#ds-cache-autopin').on('change', function () { Settings.autoPinThreshold = parseInt($(this).val()) || 0; safeSave(); });
        $('#ds-cache-dynamic-mode').on('change', function () { Settings.dynamicMode = parseInt($(this).val()); safeSave(); });
        
        $('#ds-cache-history-mode').on('change', function () { Settings.historyEditMode = parseInt($(this).val()); safeSave(); });
        $('#ds-cache-lorebook-sink').on('change', function () { Settings.lorebookSink = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-retcon').on('change', function () { Settings.retconProtocol = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-hotreload').on('change', function () { Settings.hotReloadPersona = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-flashback').on('change', function () { Settings.flashbackInsertion = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-multiverse').on('change', function () { Settings.multiverseProtocol = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-nanopatch').on('change', function () { Settings.nanoPatching = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-gravity').on('change', function () { Settings.gravityProtocol = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-summary').on('change', function () { Settings.summaryAnchor = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-tailend').on('change', function () { Settings.tailEndExemption = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-chronos').on('change', function () { Settings.chronosProtocol = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-amnesia').on('change', function () { Settings.amnesiaProtocol = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-anchor').on('change', function () { Settings.anchorStabilization = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-imprint').on('change', function () { Settings.permanentMemoryImprint = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-entropy').on('change', function () { Settings.entropyShield = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-dedup').on('change', function () { Settings.absoluteDeduplication = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-void').on('change', function () { Settings.voidBridging = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-warp').on('change', function () { Settings.warpDriveFilter = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-prefix').on('change', function () { Settings.prefixAnchor = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-semantic').on('change', function () { Settings.semanticNormalize = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-autobackup').on('change', function () { Settings.autoBackup = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-matrix').on('change', function () { Settings.absoluteOrderMatrix = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-vector').on('change', function () { Settings.vectorQuarantine = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-phantom').on('change', function () { Settings.phantomSync = $(this).is(':checked'); safeSave(); });
        $('#ds-cache-smartpatch').on('change', function () { Settings.smartAutoPatch = $(this).is(':checked'); safeSave(); });
        $('#ds-log-autoscroll').on('change', function () { Settings.autoScrollLog = $(this).is(':checked'); safeSave(); });

        $('#ds-btn-undo-action').on('click', () => restoreVaultBackup(0));

        $('#ds-btn-pause-log').on('click', function() {
            isLogPaused = !isLogPaused;
            if (isLogPaused) {
                $(this).html('<i class="fa-solid fa-play"></i>').css('color', 'var(--ds-green)');
                if (typeof toastr !== 'undefined') toastr.info("日志已暂停滚动");
            } else {
                $(this).html('<i class="fa-solid fa-pause"></i>').css('color', 'var(--ds-yellow)');
                if (typeof toastr !== 'undefined') toastr.info("日志已恢复滚动");
                requestAnimationFrame(processLogQueue);
            }
        });

        $('#ds-cache-factory-reset').on('click', () => { 
            if (confirm("💀 危险操作：确定要删除所有的缓存存档吗？一切将从零开始！")) { 
                createVaultBackup("格式化前备份");
                Settings.chats = {}; Settings.pinnedChats = {}; safeSave(); renderChatsUI(); 
            } 
        });
        
        $('#ds-btn-deep-clean').on('click', () => {
            if(!confirm("🧹 这会删掉所有未被锁定，且【没有节点内容】或【超过30天没聊过】的旧缓存。确定执行吗？")) return;
            createVaultBackup("深度清理前备份");
            let count = 0; const now = Date.now();
            for (let k in Settings.chats) {
                if (Settings.pinnedChats[k]) continue;
                const chat = Settings.chats[k];
                const isEmpty = !chat.frozenSequence || chat.frozenSequence.length === 0;
                const isOld = chat.lastAccessed && (now - chat.lastAccessed > 30 * 24 * 60 * 60 * 1000);
                if (isEmpty || isOld) { delete Settings.chats[k]; count++; }
            }
            safeSave(); renderChatsUI();
            if (typeof toastr !== 'undefined') toastr.success(`🧹 垃圾清理完毕！共移除了 ${count} 个无用的旧存档。`);
        });

        $('#ds-btn-purge-orphans').on('click', () => {
            if(!confirm("👻 矩阵碎片整理：这会强制清除所有未被锁定的缓存，并重新索引记忆矩阵。确定执行吗？")) return;
            createVaultBackup("碎片整理前备份");
            let count = 0;
            for (let k in Settings.chats) {
                if (Settings.pinnedChats[k]) continue;
                delete Settings.chats[k]; count++;
            }
            safeSave(); renderChatsUI();
            if (typeof toastr !== 'undefined') toastr.success(`👻 碎片整理完毕！共清清除 ${count} 个未锁定的缓存，并释放了内存池。`);
        });
        
        $('.ds-log-filter').on('click', function() {
            $('.ds-log-filter').removeClass('active'); 
            $(this).addClass('active'); 
            applyLogFilters();
        });

        $('#ds-log-search').on('input', function() { applyLogFilters(); });
        $('#ds-btn-clearlog').on('click', () => { $('#ds-cache-log-container').empty(); logQueue = []; });

        $('#ds-btn-export').on('click', () => {
            const blob = new Blob([JSON.stringify(Settings, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob); const a = document.createElement("a");
            a.href = url; a.download = `DeepSeek_Cache_Backup_v60_${new Date().getTime()}.json`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
            if (typeof toastr !== 'undefined') toastr.success("💾 备份文件已导出！");
        });
        $('#ds-btn-import').on('click', () => $('#ds-file-import').click());
        $('#ds-file-import').on('change', function(e) {
            const f = e.target.files[0]; if(!f) return;
            const r = new FileReader();
            r.onload = (ev) => {
                try { Object.assign(Settings, JSON.parse(ev.target.result)); safeSave(); renderChatsUI(); updateTopBarState(); alert("✅ 恢复成功！"); } 
                catch (err) { alert("❌ 文件格式错误"); }
                e.target.value = '';
            };
            r.readAsText(f);
        });

        const updateVaultSelect = () => {
            const select = $('#ds-vault-select');
            select.empty().append('<option value="">-- 选择多重宇宙备份 --</option>');
            backupVault.forEach((v, i) => {
                select.append(`<option value="${i}">[${v.label}] ${v.time}</option>`);
            });
        };
        updateVaultSelect();
        
        $('#ds-btn-restore-vault').on('click', () => {
            const val = $('#ds-vault-select').val();
            if (val !== "") restoreVaultBackup(parseInt(val));
        });

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                isLogVisible = entry.isIntersecting;
                if (isLogVisible && logQueue.length > 0 && !isLogRendering && !isLogPaused) {
                    isLogRendering = true;
                    requestAnimationFrame(processLogQueue);
                }
            });
        }, { threshold: 0.1 });
        
        const logContainer = document.getElementById('ds-cache-log-container');
        if (logContainer) observer.observe(logContainer);

        renderChatsUI();
    } catch (e) { console.error('[DS Cache] UI初始化崩潰', e); }
}

jQuery(async () => {
    try {
        initSettings(); 
        await setupUI();
        setupGlobalHotkeys(); 
        
        setTimeout(() => { ensureTopMenuButton(); }, 2000);
        addResetMenuEntry(); 
        
        if (eventSource && !window.dsCacheInitialized) {
            window.dsCacheInitialized = true;
            
            eventSource.on(event_types.CHAT_CHANGED, () => { 
                ensureTopMenuButton(); 
                renderChatsUI(); 
                sessionSnoozeReset = false; 
            });
            if (event_types?.CHAT_COMPLETION_PROMPT_READY) {
                eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
            }
            if (event_types?.MESSAGE_DELETED) {
                eventSource.on(event_types.MESSAGE_DELETED, () => triggerWarningImmediate('his_del', '您删除了历史对话，已标记断层！下次发送将原位修补。', Settings.toastHistory));
            }
            if (event_types?.MESSAGE_EDITED) {
                eventSource.on(event_types.MESSAGE_EDITED, () => triggerWarningImmediate('his_edit', '您修改了历史对话，已标记断层！下次发送将原位修补。', Settings.toastHistory));
            }
        }

        Logger.log('══════ 🚀 DeepSeek 绝对真理优化器 v6 Quantum 引擎上线 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件启动失败:', e);
    }
});
