import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 1. 樣式注入 (Quantum Canvas UI 3.0)
// ==========================================
const injectCSS = () => {
    if (document.getElementById('ds-cache-styles')) return;
    const style = document.createElement('style');
    style.id = 'ds-cache-styles';
    style.innerHTML = `
        :root { --ds-cyan: #00e5ff; --ds-purple: #c678dd; --ds-green: #98c379; --ds-red: #e06c75; --ds-yellow: #e5c07b; --ds-orange: #d19a66; --ds-pink: #ff79c6; --ds-gray: #abb2bf; --ds-bg: rgba(15, 20, 25, 0.7); --ds-border: rgba(0, 229, 255, 0.2); }
        .ds-gpu-accel { transform: translate3d(0,0,0); will-change: transform, scroll-position; backface-visibility: hidden; perspective: 1000px; }
        .ds-strict-contain { contain: strict; }
        .ds-virtual-list { content-visibility: auto; contain-intrinsic-size: auto 80px; }
        .ds-scroll::-webkit-scrollbar { width: 6px; }
        .ds-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.3); border-radius: 4px; }
        .ds-scroll::-webkit-scrollbar-thumb { background: rgba(0, 229, 255, 0.4); border-radius: 4px; }
        .ds-scroll::-webkit-scrollbar-thumb:hover { background: rgba(0, 229, 255, 0.8); box-shadow: 0 0 10px var(--ds-cyan); }
        .ds-opt-group { margin-bottom: 16px; border: 1px solid var(--ds-border); border-radius: 12px; background: var(--ds-bg); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.3); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .ds-opt-group:hover { border-color: rgba(0, 229, 255, 0.4); box-shadow: 0 8px 30px rgba(0, 229, 255, 0.1); }
        .ds-opt-header { padding: 16px 20px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: var(--ds-cyan); background: linear-gradient(90deg, rgba(0,229,255,0.08) 0%, rgba(0,0,0,0) 100%); transition: 0.2s; font-size: 14px; text-shadow: 0 0 12px rgba(0,229,255,0.3); letter-spacing: 0.5px; }
        .ds-opt-header:hover { background: linear-gradient(90deg, rgba(0,229,255,0.15) 0%, rgba(0,0,0,0) 100%); color: #fff; }
        .ds-opt-content { padding: 20px; display: flex; flex-direction: column; gap: 16px; display: none; background: rgba(0,0,0,0.25); border-top: 1px solid rgba(255,255,255,0.03); }
        .ds-opt-group.open .ds-opt-content { display: flex; animation: dsFadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .ds-opt-group.open .ds-opt-header i.fa-chevron-down { transform: rotate(180deg); }
        .ds-sub-header { font-size: 12px; color: var(--ds-cyan); font-weight: bold; margin-top: 10px; margin-bottom: -5px; padding-bottom: 5px; border-bottom: 1px dashed rgba(0,229,255,0.2); display: flex; align-items: center; gap: 8px; }
        .ds-row { display: flex; flex-direction: row; justify-content: space-between; align-items: center; width: 100%; gap: 14px; }
        .ds-row-left { display: flex; align-items: flex-start; gap: 12px; cursor: pointer; color: #abb2bf; font-size: 13px; flex: 1; line-height: 1.6; transition: color 0.2s; }
        .ds-row-left:hover { color: #fff; }
        .ds-row-left input[type="checkbox"] { margin-top: 4px; flex-shrink: 0; transform: scale(1.2); cursor: pointer; accent-color: var(--ds-cyan); }
        .ds-row-text { display: flex; flex-direction: column; flex: 1; min-width: 0; word-wrap: break-word; white-space: normal; }
        .ds-row-text b { color: var(--ds-yellow); font-weight: 600; letter-spacing: 0.5px; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
        .ds-row-text span { font-size: 11px; color: rgba(171, 178, 191, 0.8); font-weight: normal; margin-top: 4px; line-height: 1.5; }
        .ds-tooltip-icon { display: inline-flex; align-items: center; justify-content: center; color: var(--ds-cyan); background: rgba(0,229,255,0.1); border-radius: 50%; width: 16px; height: 16px; font-size: 11px; font-weight: bold; cursor: help; border: 1px solid rgba(0,229,255,0.3); flex-shrink: 0; transition: 0.2s; }
        .ds-tooltip-icon:hover { background: var(--ds-cyan); color: #000; box-shadow: 0 0 10px var(--ds-cyan); transform: scale(1.1); }
        .ds-perf-badge { font-size: 9px; padding: 2px 6px; border-radius: 4px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase; }
        .ds-perf-low { background: rgba(152,195,121,0.15); color: var(--ds-green); border: 1px solid rgba(152,195,121,0.3); }
        .ds-perf-mid { background: rgba(229,192,123,0.15); color: var(--ds-yellow); border: 1px solid rgba(229,192,123,0.3); }
        .ds-perf-high { background: rgba(224,108,117,0.15); color: var(--ds-red); border: 1px solid rgba(224,108,117,0.3); }
        .ds-select-styled { background: rgba(0,0,0,0.5); color: var(--ds-cyan); border: 1px solid var(--ds-border); padding: 10px 14px; border-radius: 8px; font-weight: bold; cursor: pointer; outline: none; transition: all 0.2s; font-family: inherit; width: 100%; box-sizing: border-box; }
        .ds-select-styled:hover, .ds-select-styled:focus { border-color: var(--ds-cyan); box-shadow: 0 0 12px rgba(0,229,255,0.2); }
        .ds-select-styled option { background: #1e1e24; color: #fff; }
        .ds-input-styled { background: rgba(0,0,0,0.5); color: #fff; border: 1px solid rgba(255,255,255,0.15); padding: 8px 12px; border-radius: 8px; font-size: 12px; outline: none; transition: all 0.2s; width: 100%; box-sizing: border-box; }
        .ds-input-styled:focus { border-color: var(--ds-cyan); box-shadow: 0 0 10px rgba(0,229,255,0.2); }
        .ds-log-toolbar { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; background: rgba(0,0,0,0.4); padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); flex-wrap: wrap; }
        .ds-log-filter { cursor: pointer; padding: 6px 14px; border-radius: 14px; font-size: 11px; background: rgba(255,255,255,0.05); color: #abb2bf; transition: all 0.2s; font-weight: 600; white-space: nowrap; border: 1px solid transparent; }
        .ds-log-filter.active { background: rgba(0,229,255,0.15); color: var(--ds-cyan); border-color: rgba(0,229,255,0.4); box-shadow: 0 0 12px rgba(0,229,255,0.2); }
        .ds-log-filter:hover:not(.active) { background: rgba(255,255,255,0.1); color: #fff; }
        .ds-log-terminal { background: #0a0c10; color: #a9b7c6; font-family: 'Fira Code', Consolas, monospace; font-size: 12px; height: 350px; overflow-y: auto; border-radius: 10px; padding: 18px; border: 1px solid rgba(0,229,255,0.2); box-shadow: inset 0 0 25px rgba(0,0,0,0.9); line-height: 1.7; position: relative; }
        .ds-log-line { margin-bottom: 8px; word-wrap: break-word; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 8px; display: flex; align-items: flex-start; }
        .ds-log-line.hide { display: none !important; }
        .ds-log-time { color: #5c6370; margin-right: 12px; user-select: none; font-size: 10px; flex-shrink: 0; margin-top: 3px; }
        .ds-log-content { flex: 1; min-width: 0; }
        .ds-log-info { color: var(--ds-green); }
        .ds-log-warn { color: var(--ds-yellow); font-weight: bold; }
        .ds-log-error { color: var(--ds-red); font-weight: bold; text-shadow: 0 0 8px rgba(224,108,117,0.5); }
        .ds-log-map { color: var(--ds-cyan); font-weight: bold; }
        .ds-log-debug { color: var(--ds-purple); }
        .ds-log-divider { color: #4b5263; font-weight: bold; display: block; text-align: center; margin: 18px 0; border-top: 1px solid #2c313a; padding-top: 10px; letter-spacing: 1.5px; width: 100%; }
        .ds-tag { display: inline-block; padding: 3px 10px; border-radius: 6px; font-size: 10px; font-weight: bold; background: rgba(255,255,255,0.05); margin-right: 8px; letter-spacing: 0.5px; }
        .ds-tag-SYS { color: #61afef; border-left: 3px solid #61afef; background: rgba(97,175,239,0.1); }
        .ds-tag-USER { color: var(--ds-green); border-left: 3px solid var(--ds-green); background: rgba(152,195,121,0.1); }
        .ds-tag-AI { color: var(--ds-yellow); border-left: 3px solid var(--ds-yellow); background: rgba(229,192,123,0.1); }
        .ds-tag-PREFILL { color: var(--ds-purple); border-left: 3px solid var(--ds-purple); background: rgba(198,120,221,0.1); }
        .ds-badge { background: rgba(0,229,255,0.1); padding: 4px 10px; border-radius: 6px; font-size: 0.8em; font-family: monospace; color: var(--ds-cyan); border: 1px solid rgba(0,229,255,0.3); box-shadow: 0 0 8px rgba(0,229,255,0.2); }
        .ds-chat-container { max-height:300px; overflow-y:auto; border:1px solid rgba(255,255,255,0.08); padding:12px; border-radius:10px; background: rgba(0,0,0,0.4); }
        .ds-chat-item { display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:14px; margin-bottom:12px; border-radius:10px; border:1px solid rgba(255,255,255,0.05); transition: all 0.2s; }
        .ds-chat-item:hover { background:rgba(255,255,255,0.08); transform: translateX(5px); border-color: rgba(255,255,255,0.15); }
        .ds-chat-item.active-chat { background: linear-gradient(90deg, rgba(0,229,255,0.15) 0%, rgba(0,0,0,0) 100%); border-left: 4px solid var(--ds-cyan); border-top: 1px solid var(--ds-border); border-bottom: 1px solid var(--ds-border); border-right: 1px solid var(--ds-border); box-shadow: inset 0 0 20px rgba(0,229,255,0.1); }
        .ds-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.9); backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px); z-index: 999999; display: flex; align-items: center; justify-content: center; animation: dsFadeIn 0.2s ease-out; cursor: pointer; }
        .ds-modal { background: linear-gradient(180deg, #1e1e24 0%, #15151a 100%); border: 1px solid var(--ds-cyan); padding: 20px 25px; border-radius: 20px; max-width: 99vw; width: 1850px; height: 98vh; display: flex; flex-direction: column; color: #fff; font-family: sans-serif; box-shadow: 0 40px 80px rgba(0,0,0,0.9), 0 0 40px rgba(0,229,255,0.2); position: relative; animation: dsSlideUp 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); cursor: default; }
        .ds-omni-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-shrink: 0; gap: 20px; }
        .ds-modal-title { color: var(--ds-cyan); margin: 0; display: flex; align-items: center; gap: 14px; font-size: 22px; font-weight: 800; letter-spacing: 1px; text-shadow: 0 2px 8px rgba(0,229,255,0.4); flex-shrink: 0; }
        .ds-omni-stats-bar { flex: 1; background: rgba(0,0,0,0.5); padding: 10px 20px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; justify-content: center; }
        .ds-omni-stats-text { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px; font-weight: bold; }
        .ds-health-bar { height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,0.5); }
        .ds-health-fill { height: 100%; background: var(--ds-green); transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1), background 0.4s; }
        .ds-btn-reset { border-color: rgba(224,108,117,0.3); background: rgba(224,108,117,0.08); padding: 8px 15px; font-size: 13px; border-radius: 8px; color: #fff; cursor: pointer; transition: 0.2s; display: flex; align-items: center; gap: 8px; font-weight: bold; }
        .ds-btn-reset:hover { border-color: var(--ds-red); background: rgba(224,108,117,0.2); box-shadow: 0 0 15px rgba(224,108,117,0.3); }
        .ds-btn-reset i { color: var(--ds-red); }
        .ds-omni-toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; flex-shrink: 0; background: rgba(0,0,0,0.4); padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); position: relative; }
        .ds-omni-action-btn { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #abb2bf; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; transition: 0.2s; display: flex; align-items: center; gap: 6px; font-weight: bold; }
        .ds-omni-action-btn:hover { background: rgba(255,255,255,0.15); color: #fff; border-color: rgba(255,255,255,0.3); }
        .ds-omni-action-btn.active { background: rgba(0,229,255,0.15); color: var(--ds-cyan); border-color: rgba(0,229,255,0.4); box-shadow: 0 0 10px rgba(0,229,255,0.2); }
        .ds-omni-floating-panel { position: absolute; top: calc(100% + 5px); left: 0; width: 100%; max-height: 400px; overflow-y: auto; background: rgba(15, 20, 25, 0.95); border: 1px solid var(--ds-cyan); border-radius: 8px; padding: 15px; z-index: 100; display: none; box-shadow: 0 10px 30px rgba(0,0,0,0.8); backdrop-filter: blur(10px); box-sizing: border-box; }
        .ds-omni-floating-panel.open { display: block; animation: dsFadeIn 0.2s ease; }
        .ds-omni-legend { display: flex; gap: 12px; font-size: 11px; font-weight: bold; background: transparent; padding: 0; border: none; flex-wrap: wrap; margin-left: auto; }
        .ds-omni-legend-item { display: flex; align-items: center; gap: 4px; color: #abb2bf; }
        .ds-omni-legend-color { width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 5px currentColor; }
        .ds-omni-toggles-container { display: flex; flex-wrap: wrap; gap: 8px; }
        .ds-omni-toggle { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #abb2bf; cursor: pointer; background: rgba(255,255,255,0.05); padding: 6px 12px; border-radius: 5px; transition: 0.2s; border: 1px solid transparent; user-select: none; font-weight: 600; }
        .ds-omni-toggle:hover { background: rgba(255,255,255,0.1); color: #fff; }
        .ds-omni-toggle.active { background: rgba(0,229,255,0.15); color: var(--ds-cyan); border-color: rgba(0,229,255,0.4); box-shadow: 0 0 8px rgba(0,229,255,0.2); }
        .ds-omni-workspace { display: flex; flex: 1; min-height: 0; position: relative; gap: 0; margin-top: 0; }
        .ds-omni-pane { flex: 1; display: flex; flex-direction: column; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; overflow: hidden; box-shadow: inset 0 0 30px rgba(0,0,0,0.8); z-index: 2; }
        .ds-omni-pane-header { padding: 10px 15px; background: rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.1); font-weight: bold; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center; }
        .ds-omni-pane-content { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 12px; position: relative; will-change: scroll-position; }
        .ds-omni-canvas-container { width: 160px; position: relative; flex-shrink: 0; z-index: 1; }
        #omni-canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
        #omni-arrows-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: hidden; }
        .ds-omni-arrow { position: absolute; top: 0; width: 22px; height: 22px; background: rgba(15, 20, 25, 0.9); border: 1px solid currentColor; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 10; font-size: 11px; transition: opacity 0.2s, transform 0.1s ease-out; box-shadow: 0 0 10px currentColor; pointer-events: auto; opacity: 0.7; will-change: transform; }
        .ds-omni-arrow:hover { opacity: 1; background: currentColor; color: #000 !important; z-index: 20; box-shadow: 0 0 15px currentColor; }
        .ds-omni-arrow-left { left: 10px; }
        .ds-omni-arrow-right { right: 10px; }
        .ds-node-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 14px; font-family: 'Fira Code', monospace; font-size: 12px; color: #abb2bf; word-wrap: break-word; position: relative; transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s; width: 100%; box-sizing: border-box; }
        .ds-node-card:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.3); z-index: 10; box-shadow: 0 0 20px rgba(0,0,0,0.6); transform: translateY(-2px); }
        .ds-node-card.highlight-pulse { animation: dsPulse 1.5s ease-out; }
        .ds-node-hit { border-left: 4px solid var(--ds-green); background: linear-gradient(90deg, rgba(152,195,121,0.08) 0%, rgba(0,0,0,0) 100%); }
        .ds-node-miss { border-left: 4px solid var(--ds-red); background: linear-gradient(90deg, rgba(224,108,117,0.08) 0%, rgba(0,0,0,0) 100%); opacity: 0.6; }
        .ds-node-warn { border-left: 4px solid var(--ds-yellow); background: linear-gradient(90deg, rgba(229,192,123,0.08) 0%, rgba(0,0,0,0) 100%); }
        .ds-node-new-sys { border-left: 4px solid var(--ds-cyan); background: linear-gradient(90deg, rgba(0,229,255,0.08) 0%, rgba(0,0,0,0) 100%); }
        .ds-node-new-lore { border-left: 4px solid #56b6c2; background: linear-gradient(90deg, rgba(86,182,194,0.08) 0%, rgba(0,0,0,0) 100%); }
        .ds-node-new-dyn { border-left: 4px solid var(--ds-orange); background: linear-gradient(90deg, rgba(209,154,102,0.08) 0%, rgba(0,0,0,0) 100%); }
        .ds-node-new-his { border-left: 4px solid var(--ds-green); background: linear-gradient(90deg, rgba(152,195,121,0.08) 0%, rgba(0,0,0,0) 100%); }
        .ds-node-patch { border-left: 4px solid var(--ds-purple); background: linear-gradient(90deg, rgba(198,120,221,0.08) 0%, rgba(0,0,0,0) 100%); }
        .ds-node-flashback { border-left: 4px solid var(--ds-pink); background: linear-gradient(90deg, rgba(255,121,198,0.08) 0%, rgba(0,0,0,0) 100%); }
        .ds-node-retcon { border-left: 4px solid var(--ds-gray); background: linear-gradient(90deg, rgba(171,178,191,0.08) 0%, rgba(0,0,0,0) 100%); }
        .ds-node-time { border-left: 4px solid var(--ds-orange); background: linear-gradient(90deg, rgba(209,154,102,0.08) 0%, rgba(0,0,0,0) 100%); }
        .ds-node-header { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 11px; color: #7f848e; border-bottom: 1px dashed rgba(255,255,255,0.15); padding-bottom: 6px; }
        .ds-node-content-wrapper { position: relative; }
        .ds-node-content { line-height: 1.6; transition: max-height 0.3s ease-in-out; }
        .ds-node-content.collapsed { max-height: 60px; overflow: hidden; mask-image: linear-gradient(to bottom, black 40%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, black 40%, transparent 100%); }
        .ds-node-expand-btn { text-align: center; font-size: 11px; color: var(--ds-cyan); cursor: pointer; margin-top: 6px; padding: 4px; background: rgba(0,229,255,0.08); border-radius: 6px; transition: 0.2s; border: 1px solid rgba(0,229,255,0.2); font-weight: bold; }
        .ds-node-expand-btn:hover { background: rgba(0,229,255,0.2); border-color: rgba(0,229,255,0.4); box-shadow: 0 0 10px rgba(0,229,255,0.2); }
        .ds-toast-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; margin-top: 10px; background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); }
        .ds-toast-grid label { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #abb2bf; cursor: pointer; transition: 0.2s; }
        .ds-toast-grid label:hover { color: #fff; }
        .ds-toast-grid input[type="checkbox"] { transform: scale(1.1); accent-color: var(--ds-cyan); margin: 0; }
        @keyframes dsFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes dsSlideUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes dsPulse { 0% { box-shadow: 0 0 0 0 rgba(0, 229, 255, 0.7); border-color: var(--ds-cyan); } 70% { box-shadow: 0 0 0 20px rgba(0, 229, 255, 0); border-color: rgba(255,255,255,0.3); } 100% { box-shadow: 0 0 0 0 rgba(0, 229, 255, 0); border-color: rgba(255,255,255,0.08); } }
    `;
    document.head.appendChild(style);
};

// ==========================================
// 2. 狀態設定與磁碟 I/O 降載
// ==========================================
let Settings = {}, sessionSnoozeReset = false, backupVault = [], cachedStorageBytes = 0;

const cloneStream = arr => arr?.map(i => ({ ...i })) || [];
const fastClone = obj => typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));

const defaultSettings = { enabled: true, zenMode: false, toastHistory: true, showResetPrompt: true, autoAccept: false, logLevel: 2, tolerance: 1, maxCacheSize: 30, hotkeysEnabled: true, autoPinThreshold: 0, dynamicMode: 1, historyEditMode: 1, lorebookSink: true, retconProtocol: true, hotReloadPersona: true, flashbackInsertion: true, multiverseProtocol: true, nanoPatching: true, gravityProtocol: true, summaryAnchor: true, tailEndExemption: true, chronosProtocol: true, amnesiaProtocol: true, anchorStabilization: true, permanentMemoryImprint: true, autoScrollLog: true, entropyShield: true, absoluteDeduplication: true, voidBridging: true, warpDriveFilter: true, prefixAnchor: true, semanticNormalize: true, autoBackup: true, absoluteOrderMatrix: true, vectorQuarantine: true, cotIsolation: true, timeVarNeutralizer: true, overflowCompression: true, toastToggles: { warp: true, multiverse: true, fuzzy: true, nano: true, hotreload: true, entropy: true, patch: true, prefix: true, retcon: true, flashback: true, chronos: true, vector: true, void: true, amnesia: true, time: true }, chats: {}, pinnedChats: {} };

function initSettings() {
    const old = extension_settings.ds_cache_v51 || extension_settings.ds_cache_v50 || {};
    extension_settings.ds_cache_v52 = { ...defaultSettings, ...old, ...(extension_settings.ds_cache_v52 || {}) };
    Settings = extension_settings.ds_cache_v52;
    if (Settings.autoBackup) {
        try { backupVault = JSON.parse(localStorage.getItem('ds_cache_v52_vault')) || []; } catch(e) {}
        createVaultBackup("自动启动备份");
    }
}

let saveTimeout = null, pendingSave = false;
function flushSaveSync() {
    if (!pendingSave) return;
    try { 
        saveSettingsDebounced?.(); 
        const dataStr = JSON.stringify(Settings);
        cachedStorageBytes = dataStr.length * 2; 
        if (cachedStorageBytes > 4.5 * 1024 * 1024) {
            Logger.warn("⚠️ 存储空间接近极限，触发紧急深度休眠压缩！");
            performGarbageCollection(true); 
            localStorage.setItem('ds_cache_v52_snapshot', JSON.stringify(Settings));
        } else localStorage.setItem('ds_cache_v52_snapshot', dataStr);
    } catch (e) { if (e.name === 'QuotaExceededError') Logger.error("🚨 LocalStorage 已满！放弃保存。"); }
    pendingSave = false; saveTimeout = null;
}

window.addEventListener('beforeunload', flushSaveSync);
const safeSave = () => { pendingSave = true; if (!saveTimeout) saveTimeout = ('requestIdleCallback' in window ? requestIdleCallback : setTimeout)(flushSaveSync, 1000); };

function createVaultBackup(label = "手动备份") {
    backupVault.unshift({ time: new Date().toLocaleString(), label, data: JSON.stringify({ chats: Settings.chats, pinnedChats: Settings.pinnedChats }) });
    while (backupVault.length > 0) {
        try {
            if (backupVault.length > 3) backupVault.length = 3; 
            localStorage.setItem('ds_cache_v52_vault', JSON.stringify(backupVault)); break;
        } catch (e) { backupVault.pop(); }
    }
    backupVault.length > 0 ? $('#ds-btn-undo-action').show() : Logger.warn("Vault backup disabled.");
}

function restoreVaultBackup(index = 0) {
    if (!backupVault[index]) return;
    try {
        const parsed = JSON.parse(backupVault[index].data);
        Settings.chats = parsed.chats; Settings.pinnedChats = parsed.pinnedChats;
        safeSave(); renderChatsUI();
        if (typeof toastr !== 'undefined') toastr.success(`⏪ 时光机启动！已恢复至: ${backupVault[index].time}`);
    } catch(e) { Logger.error("恢复快照失败", e); }
}

const getTolerance = () => Settings.tolerance === 0 ? { sys: 0.5, his: 0.6 } : Settings.tolerance === 1 ? { sys: 0.2, his: 0.3 } : { sys: 0.05, his: 0.1 };

// ==========================================
// 2.5 量子彈窗聚合器
// ==========================================
const QuantumToastAggregator = {
    queue: new Map(), timeout: null,
    add(key, msg, type = 'info', icon = '💡') {
        if (!Settings.enabled || !Settings.toastHistory || Settings.zenMode || Settings.toastToggles?.[key] === false) return;
        const existing = this.queue.get(key);
        this.queue.set(key, existing ? { ...existing, count: existing.count + 1 } : { msg, type, icon, count: 1 });
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = setTimeout(() => this.flush(), 500); 
    },
    flush() {
        if (!this.queue.size || typeof toastr === 'undefined') return;
        if (this.queue.size === 1) {
            const { msg, type, icon, count } = Array.from(this.queue.values())[0];
            toastrtype === 'warning' ? 'warning' : type === 'success' ? 'success' : 'info' [<sup>1</sup>](`${icon} ${msg}${count > 1 ? ` (x${count})` : ''}`, '绝对真理协议');
        } else {
            toastr.success(`本次拦截触发了多项协议：\n\n${Array.from(this.queue.values()).map(i => `• ${i.icon} ${i.msg}${i.count > 1 ? ` (x${i.count})` : ''}`).join('\n')}`, '🛡️ 绝对真理多重防御');
        }
        this.queue.clear();
    }
};

const escapeHtml = t => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const stripHtml = h => h?.replace(/<[^>]+>/g, '') || '';
const truncateLog = (s, l = 50) => s ? (String(s).replace(/\n/g, ' ↵ ').length > l ? String(s).replace(/\n/g, ' ↵ ').substring(0, l) + '...' : String(s).replace(/\n/g, ' ↵ ')) : '∅';
const getStorageSize = () => cachedStorageBytes || (cachedStorageBytes = JSON.stringify(Settings).length * 2);
const formatBytes = b => b === 0 ? '0 B' : parseFloat((b / Math.pow(1024, Math.floor(Math.log(b) / Math.log(1024)))).toFixed(2)) + ' ' + ['B', 'KB', 'MB', 'GB'][Math.floor(Math.log(b) / Math.log(1024))];

function performGarbageCollection(force = false) {
    const now = Date.now(), keys = Object.keys(Settings.chats);
    keys.forEach(k => {
        const c = Settings.chats[k];
        if (force || (c.lastAccessed && now - c.lastAccessed > 86400000)) { c.multiverse = []; c.lastRawStream = []; }
    });
    const unpinned = keys.filter(k => !Settings.pinnedChats[k]);
    if (unpinned.length > Settings.maxCacheSize) {
        unpinned.sort((a, b) => (Settings.chats[a].lastAccessed || 0) - (Settings.chats[b].lastAccessed || 0)).slice(0, unpinned.length - Settings.maxCacheSize).forEach(k => delete Settings.chats[k]);
        Logger.warn(`[自动清理] 已清理旧存档释放空间。`);
    }
    safeSave(); renderChatsUI();
}

// ==========================================
// 3. Omni-Log 全知日誌系統
// ==========================================
const LogLevels = { SILENT: 0, BASIC: 1, DETAILED: 2, DEBUG: 3, TRACE: 4 };
let logQueue = [], isLogRendering = false, isLogPaused = false, isLogVisible = true; 

function updateTopBarState() {
    const dot = $('#ds-top-status-dot'), btn = $('#ds-top-reset-btn');
    if (!dot.length) return;
    if (!Settings.enabled) { dot.css('color', '#5c6370').html('<i class="fa-solid fa-circle"></i>'); btn.attr('title', '绝对真理缓存: 已停用'); }
    else if (Settings.zenMode) { dot.css('color', '#c678dd').html('<i class="fa-solid fa-yin-yang ds-zen-icon"></i>'); btn.attr('title', '绝对真理缓存: 运作中 [沉浸免打扰]'); }
    else { dot.css('color', '#00e5ff').html('<i class="fa-solid fa-circle" style="text-shadow: 0 0 5px #00e5ff;"></i>'); btn.attr('title', '绝对真理缓存: 运作中'); }
}

const setTopBarStatus = (color, title) => {
    if (!Settings.enabled) return;
    const dot = $('#ds-top-status-dot');
    if (dot.length) {
        if (!Settings.zenMode || color === '#e06c75') { dot.css('color', color); if(color === '#00e5ff' || color === '#00ff00') dot.html(`<i class="fa-solid fa-circle" style="text-shadow: 0 0 5px ${color};"></i>`); }
        $('#ds-top-reset-btn').attr('title', `${title} (左键开关 / 右键清空)`);
    }
};

function processLogQueue() {
    if (!logQueue.length || isLogPaused || !isLogVisible) return isLogRendering = false;
    const container = document.getElementById('ds-cache-log-container');
    if (!container) { logQueue = []; return isLogRendering = false; }
    const frag = document.createDocumentFragment(), filter = $('.ds-log-filter.active').data('filter') || 'all', search = ($('#ds-log-search').val() || '').toLowerCase();
    while (logQueue.length) {
        const { time, type, msg } = logQueue.shift(), line = document.createElement('div');
        line.className = 'ds-log-line ds-virtual-list'; line.setAttribute('data-type', type === 'divider' ? 'info' : type);
        line.innerHTML = type === 'divider' ? `<span class="ds-log-divider">${msg}</span>` : `<span class="ds-log-time">[${time}]</span> <span class="ds-log-content ds-log-${type}">${msg.replace(/\n/g, '<br>')}</span>`;
        if (!((filter === 'all' || type === filter || type === 'divider') && (!search || line.innerText.toLowerCase().includes(search)))) line.classList.add('hide');
        frag.appendChild(line);
    }
    container.appendChild(frag);
    while (container.childNodes.length > 800) container.removeChild(container.firstChild);
    if (Settings.autoScrollLog && !isLogPaused) container.scrollTop = container.scrollHeight;
    isLogRendering = false;
}

const applyLogFilters = () => {
    const filter = $('.ds-log-filter.active').data('filter') || 'all', search = ($('#ds-log-search').val() || '').toLowerCase();
    $('#ds-cache-log-container .ds-log-line').each(function() {
        const type = $(this).attr('data-type'), text = $(this).text().toLowerCase();
        $(this).toggleClass('hide', !((filter === 'all' || type === filter || type === 'divider') && (!search || text.includes(search))));
    });
};

const logMeta = { warn: { i: '🌪️', s: 'color: #e5c07b;', f: 'warn' }, error: { i: '🔴', s: '', f: 'error' }, map: { i: '🗺️', s: 'color: #00e5ff;', f: 'log' }, debug: { i: '🐛', s: 'color: #c678dd;', f: 'log' }, divider: { i: '', s: 'color: #4b5263; font-weight: bold;', f: 'log' }, info: { i: '✅', s: 'color: #98c379;', f: 'log' } };
function logAt(level, type, msg) {
    if (Settings.logLevel < level) return;
    const now = new Date(), time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
    const meta = logMeta[type] || logMeta.info;
    consolemeta.f [<sup>2</sup>](`%c${type === 'divider' ? msg : `[真理日志] ${meta.i} ${msg}`}`, meta.s);
    logQueue.push({ time, type, msg });
    if (logQueue.length > 500) logQueue.shift();
    if (!isLogRendering && !isLogPaused && isLogVisible) { isLogRendering = true; requestAnimationFrame(processLogQueue); }
}

const Logger = {
    log: (m, l = LogLevels.DETAILED) => logAt(l, 'info', m), warn: (m, l = LogLevels.BASIC) => logAt(l, 'warn', m), map: (m, l = LogLevels.BASIC) => logAt(l, 'map', m),
    error: (m, e, l = LogLevels.BASIC) => { logAt(l, 'error', e ? `${m} ${e}` : m); if (e && Settings.logLevel >= LogLevels.DEBUG) { console.error("Crash Dump:", e); try { localStorage.setItem('ds_cache_crash_dump', JSON.stringify({ error: e.toString(), stack: e.stack, time: new Date().toISOString() })); } catch(err){} } },
    debug: m => logAt(LogLevels.DEBUG, 'debug', m), trace: m => logAt(LogLevels.TRACE, 'debug', m), divider: m => logAt(LogLevels.BASIC, 'divider', m),
    normalize: t => t ? (Settings.semanticNormalize ? t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim() : t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/ +/g, ' ').trim()) : '',
    fuzzyNormalize: t => t ? (Settings.timeVarNeutralizer ? t.toLowerCase().replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]m)?\b/gi, '').replace(/\b\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\b/gi, '').replace(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi, '') : t.toLowerCase()).replace(/[^\w\s\u4e00-\u9fa5]/gi, '').replace(/\s+/g, '').trim() : ''
};

// ==========================================
// 4. 狀態管理與擴充選單
// ==========================================
const getChatKey = () => {
    const ctx = getContext(), charName = ctx.characters?.[ctx.characterId]?.name || ctx.characterId || ctx.name2 || "未知角色", chatId = ctx.chatId || "默认聊天";
    return ctx.groupId ? { key: `group_${ctx.groupId}_${chatId}`, label: `群聊: ${chatId}` } : { key: `char_${ctx.characterId}_${chatId}`, label: `${charName} | 存档: ${chatId}` };
};

const getChatState = info => {
    const s = Settings.chats[info.key] || (Settings.chats[info.key] = { label: info.label, frozenSequence: [], multiverse: [], lastSentSequence: [], lastRawStream: [], lastPrefills: [], dynamicAnomalies: [] });
    s.lastAccessed = Date.now(); s.dynamicAnomalies ??= []; s.multiverse ??= []; s.lastRawStream ??= [];
    safeSave(); renderChatsUI(); performGarbageCollection(); return s;
};

function ensureTopMenuButton() {
    if (!$('#ds-top-reset-btn').length) {
        const btn = $(`<li id="ds-top-reset-btn" class="menu_button interactable"><span class="fa-solid fa-microchip"></span><span id="ds-top-status-dot" style="font-size:0.7em; margin-left:2px; vertical-align:top;"></span></li>`);
        btn.on('click', e => { e.preventDefault(); Settings.enabled = !Settings.enabled; $('#ds-cache-enable').prop('checked', Settings.enabled); safeSave(); updateTopBarState(); !Settings.zenMode && typeof toastr !== 'undefined' && toastr.info(Settings.enabled ? "🚀 绝对真理已启动" : "💤 绝对真理已关闭", "DeepSeek"); });
        btn.on('contextmenu', e => { e.preventDefault(); resetCurrentCache(); });
        $('ul#extensions_menu').length ? $('ul#extensions_menu').append(btn) : $('#right-nav-extensions').append(btn);
    }
    updateTopBarState();
}

function addResetMenuEntry() {
    const menu = document.getElementById('extensionsMenu') || document.getElementById('extensions_menu');
    if (!menu) return setTimeout(addResetMenuEntry, 300);
    if (!document.getElementById('ds-bottom-omni-btn')) {
        const btn = document.createElement('div'); btn.id = 'ds-bottom-omni-btn'; btn.className = 'list-group-item'; btn.innerHTML = '<i class="fa-solid fa-eye" style="color: var(--ds-cyan);"></i> Omni-Vision 全视之眼';
        btn.onclick = () => { showOmniVisionUI(); $('#extensions_menu').removeClass('open').hide(); }; menu.appendChild(btn);
    }
    if (!document.getElementById('ds-bottom-reset-btn')) {
        const btn = document.createElement('div'); btn.id = 'ds-bottom-reset-btn'; btn.className = 'list-group-item'; btn.innerHTML = '<i class="fa-solid fa-broom" style="color: #e06c75;"></i> 撕书重来 (清空缓存)';
        btn.onclick = () => { resetCurrentCache(); $('#extensions_menu').removeClass('open').hide(); }; menu.appendChild(btn);
    }
}

function resetCurrentCache() {
    if(!confirm("⚠️ 确定要「撕书重来」吗？\n\n这会清空当前对话的所有缓存，大模型下次回复时会把整个故事从头到尾重新看一遍。")) return;
    const key = getChatKey().key; delete Settings.chats[key]; sessionSnoozeReset = false; safeSave(); renderChatsUI(); setTopBarStatus('#00e5ff', '缓存: 已撕书重来');
    typeof toastr !== 'undefined' && toastr.success("📚 撕书成功！下次发送时，AI 将重新阅读整个故事。"); Logger.warn(`手动清空缓存: ${key}`);
}

const setupGlobalHotkeys = () => document.addEventListener('keydown', e => {
    if (!Settings.hotkeysEnabled || ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable || !(e.ctrlKey && e.altKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'c') { e.preventDefault(); Settings.enabled = !Settings.enabled; $('#ds-cache-enable').prop('checked', Settings.enabled); safeSave(); updateTopBarState(); !Settings.zenMode && typeof toastr !== 'undefined' && toastr.info(Settings.enabled ? "🚀 启动" : "💤 关闭", "快捷键"); }
    else if (k === 'r') { e.preventDefault(); resetCurrentCache(); }
    else if (k === 'z') { e.preventDefault(); Settings.zenMode = !Settings.zenMode; $('#ds-cache-zen').prop('checked', Settings.zenMode); safeSave(); updateTopBarState(); typeof toastr !== 'undefined' && toastr.info(Settings.zenMode ? "🧘 免打扰开启" : "🔔 免打扰关闭", "快捷键"); }
    else if (k === 'v') { e.preventDefault(); showOmniVisionUI(); }
});

// ==========================================
// 5. 核心邏輯工具與 Diff 演算法
// ==========================================
function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

class LRUCache {
    constructor(max) { this.c = new Map(); this.max = max; }
    get(k) { if (!this.c.has(k)) return null; const v = this.c.get(k); this.c.delete(k); this.c.set(k, v); return v; }
    set(k, v) { if (this.c.has(k)) this.c.delete(k); else if (this.c.size >= this.max) this.c.delete(this.c.keys().next().value); this.c.set(k, v); }
    clear() { this.c.clear(); }
}

const bigramCache = new LRUCache(2000);
const getBigrams = str => {
    let cached = bigramCache.get(str); if (cached) return cached;
    const b = new Set(); for (let i = 0; i < str.length - 1; i++) b.add(str.substring(i, i+2));
    bigramCache.set(str, b); return b;
};

const createMsg = (msg, tag) => {
    const c = msg.content || '', hc = Settings.cotIsolation ? c.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() || c : c;
    const n = Logger.normalize(hc), f = Logger.fuzzyNormalize(hc);
    return { role: msg.role, content: c, norm: n, hash: cyrb53(n), fuzzyHash: cyrb53(f), len: c.length, tag, _omniCat: '', _sourceHash: null };
};

const getSimilarity = (m1, m2) => {
    if (m1.hash === m2.hash) return 1; if (m1.fuzzyHash === m2.fuzzyHash) return 0.99;
    const s1 = m1.norm, s2 = m2.norm; if (Math.abs(s1.length - s2.length) > Math.max(s1.length, s2.length) * 0.5) return 0;
    const c1 = stripHtml(s1), c2 = stripHtml(s2); if (c1 === c2) return 1;
    const a = c1.length < c2.length ? c1 : c2, b = c1.length < c2.length ? c2 : c1;
    if (!a.length) return 0; if (b.includes(a) && a.length > 10) return 0.95;
    const bg1 = getBigrams(a); let m = 0; for (let i = 0; i < b.length - 1; i++) if (bg1.has(b.substring(i, i+2))) m++;
    const u = (a.length - 1) + (b.length - 1) - m; return u <= 0 ? 1 : m / u;
};

const extractAddedText = (o, n) => {
    const co = stripHtml(o), cn = stripHtml(n); if (cn.length < co.length || cn.length - co.length > 300) return null;
    const os = new Set(co.split(/([。！？.!?\n]+)/).map(s => s.trim()).filter(s => s.length > 2)), a = [];
    for (let s of cn.split(/([。！？.!?\n]+)/)) { let t = s.trim(); if (t.length > 2 && !os.has(t)) a.push(t); }
    return a.length ? a.join(' ') : null;
};

// ==========================================
// 7. 🧊 絕對真理追加架構
// ==========================================
async function interceptAndRestructurePrompt(data, isDryRun = false) {
    if (!Settings.enabled && !isDryRun) return;
    const startTime = performance.now(), chatKeyInfo = getChatKey();

    try {
        let state = isDryRun ? fastClone(getChatState(chatKeyInfo)) : getChatState(chatKeyInfo);
        if (!data?.chat?.length) return;
        const stream = data.chat;
        
        if (!isDryRun) { state.lastRawStream = cloneStream(stream); safeSave(); Logger.divider(`===== 🚀 启动绝对真理拦截: ${chatKeyInfo.label} =====`); }

        const topSysMsgs = [], bottomSysMsgs = [], chatMsgs = [];
        let hasSeenUserOrAi = false;
        const timeSkipRegex = /(later|next day|第二天|几个小时后|一段时间后|meanwhile|之后|随后|时光飞逝|转眼间|the next morning|fast forward|a few hours|days passed)/i;
        const vectorRegex = /(retrieved context|search results|vector database|相关记忆|检索到的内容|记忆库片段|data bank|smart context|chromadb|past events|memory recall)/i;

        for (let msg of stream) {
            if (!msg.content) continue;
            if (Settings.warpDriveFilter && !msg.content.replace(/[\s\*\.\-]/g, '').length) {
                if (!isDryRun) { Logger.trace(`[🌌 曲率引擎] 过滤空白节点。`); QuantumToastAggregator.add('warp', '曲率引擎：已过滤空白消息', 'info', '🌌'); }
                continue;
            }
            if (msg.role === 'system' || (msg.role !== 'user' && msg.role !== 'assistant')) {
                const sysNode = createMsg(msg, 'SYS');
                const isSummary = Settings.summaryAnchor && /(summary|previously on|摘要|前情提要|总结|回顾|story so far|the story thus far)/i.test(sysNode.content);
                const isTimeSkip = Settings.chronosProtocol && sysNode.content.length < 150 && timeSkipRegex.test(sysNode.content);
                const isVector = Settings.vectorQuarantine && vectorRegex.test(sysNode.content);
                if (isSummary || isTimeSkip || isVector || (Settings.anchorStabilization && hasSeenUserOrAi) || (Settings.gravityProtocol && hasSeenUserOrAi)) {
                    if (isTimeSkip) sysNode.isTimeSkip = true; else if (isVector) sysNode.isVector = true; else if (isSummary) sysNode.isSummary = true;
                    bottomSysMsgs.push(sysNode);
                } else topSysMsgs.push(sysNode);
            } else {
                hasSeenUserOrAi = true; chatMsgs.push(createMsg(msg, msg.role === 'user' ? 'USER' : 'AI'));
            }
        }

        let lastUserIdx = chatMsgs.findLastIndex(m => m.tag === 'USER');
        let historyTurns = [], currentTurn = { user: null, prefills: [] };
        if (lastUserIdx === -1) currentTurn.prefills = chatMsgs.filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'}));
        else {
            currentTurn.user = chatMsgs[lastUserIdx];
            currentTurn.prefills = chatMsgs.slice(lastUserIdx + 1).filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'}));
            let curUser = null, curAiContents = [];
            for (let msg of chatMsgs.slice(0, lastUserIdx)) {
                if (msg.tag === 'USER') { if (curUser) historyTurns.push({ user: curUser, assistant: curAiContents.length ? createMsg({role: 'assistant', content: curAiContents.join('\n')}, 'AI') : null }); curUser = msg; curAiContents = []; }
                else if (msg.tag === 'AI') curAiContents.push(msg.content);
            }
            if (curUser) historyTurns.push({ user: curUser, assistant: curAiContents.length ? createMsg({role: 'assistant', content: curAiContents.join('\n')}, 'AI') : null });
        }

        const incomingSysPool = [...topSysMsgs, ...bottomSysMsgs], incomingHistoryPool = historyTurns.flatMap(t => t.assistant ? [t.user, t.assistant] : [t.user]);

        if (Settings.multiverseProtocol && state.multiverse?.length) {
            let bestUniverse = state.frozenSequence, bestMatchCount = -1;
            const currentStreamNorms = [...incomingSysPool, ...incomingHistoryPool].map(m => m.norm);
            for (let universe of state.multiverse) {
                let matchCount = 0;
                for (let j = 0; j < Math.min(universe.length, currentStreamNorms.length); j++) { if (universe[j].norm === currentStreamNorms[j]) matchCount++; else break; }
                if (matchCount > bestMatchCount) { bestMatchCount = matchCount; bestUniverse = universe; }
            }
            if (bestUniverse !== state.frozenSequence) {
                if (!isDryRun) { Logger.map(`[🌌 平行宇宙跳跃] 已跳跃至最佳分支。`); QuantumToastAggregator.add('multiverse', '平行宇宙：已跳跃至最佳历史分支', 'success', '🌌'); }
                state.frozenSequence = bestUniverse;
            }
        }

        let newFrozenSequence = [], newAdditions = { history: [], sys: [], lorebooks: [], dynamic: [], patches: [] };
        const thresholds = getTolerance(), handledIncomingSys = new Set(), handledIncomingHis = new Set();
        let lastHandledIncomingHisIdx = -1, hasMatchedAnyHistory = false; 

        for (let i = 0; i < state.frozenSequence.length; i++) {
            const frozenItem = { ...state.frozenSequence[i] };
            if (frozenItem.tag === 'SYS') {
                let bestIdx = -1, bestScore = 0;
                for (let j = 0; j < incomingSysPool.length; j++) { if (!handledIncomingSys.has(j)) { const score = getSimilarity(frozenItem, incomingSysPool[j]); if (score > bestScore) { bestScore = score; bestIdx = j; } } }
                if (bestScore === 1) { frozenItem._omniCat = 'frozen'; newFrozenSequence.push(frozenItem); handledIncomingSys.add(bestIdx); }
                else if (bestIdx !== -1 && frozenItem.fuzzyHash === incomingSysPool[bestIdx].fuzzyHash) {
                    frozenItem._omniCat = 'frozen'; newFrozenSequence.push(frozenItem); handledIncomingSys.add(bestIdx);
                    if (Settings.timeVarNeutralizer && frozenItem.content !== incomingSysPool[bestIdx].content) {
                        const patch = createMsg({role: 'system', content: `[系统提示：状态更新。最新状态为：\n${truncateLog(incomingSysPool[bestIdx].content, 100)}]`}, 'SYS'); patch._omniCat = 'patch_time'; patch._sourceHash = frozenItem.hash; newAdditions.patches.push(patch);
                        if (!isDryRun) { Logger.trace(`[⏱️ 时序同步] 生成时序同步补丁。`); QuantumToastAggregator.add('time', '时序中和器：已生成时序同步补丁', 'success', '⏱️'); }
                    } else if (!isDryRun) { Logger.trace(`[🧹 模糊语义] 无视排版差异保持冻结。`); QuantumToastAggregator.add('fuzzy', '模糊语义：已无视排版差异', 'success', '🧹'); }
                } else if (bestScore > thresholds.sys) {
                    const incomingItem = incomingSysPool[bestIdx]; frozenItem._omniCat = 'frozen'; newFrozenSequence.push(frozenItem); handledIncomingSys.add(bestIdx);
                    let addedText = Settings.nanoPatching && bestScore > 0.85 ? extractAddedText(frozenItem.content, incomingItem.content) : null;
                    if (addedText) {
                        const patch = createMsg({role: 'system', content: `[系统提示：设定微调补充。新增细节：${addedText}]`}, 'SYS'); patch._omniCat = 'patch_nano'; patch._sourceHash = frozenItem.hash; newAdditions.patches.push(patch);
                        if (!isDryRun) { Logger.debug(`[🔬 量子微创] 生成设定差异补丁。`); QuantumToastAggregator.add('nano', '量子微创：已生成设定差异补丁', 'success', '🔬'); }
                    } else if (Settings.hotReloadPersona && (i === 0 || frozenItem.content.length > 400)) {
                        const patch = createMsg({role: 'system', content: `[系统提示：角色设定已热更新，最新特征如下：\n${incomingItem.content}]`}, 'SYS'); patch._omniCat = 'patch_hotreload'; patch._sourceHash = frozenItem.hash; newAdditions.patches.push(patch);
                        if (!isDryRun) { Logger.debug(`[🔥 设定热更新] 生成热更新补丁。`); QuantumToastAggregator.add('hotreload', '设定热更新：已生成更新补丁', 'success', '🔥'); }
                    } else {
                        if ([1, 2, 3].includes(Settings.dynamicMode)) { incomingItem._omniCat = 'dynamic'; newAdditions.dynamic.push(incomingItem); if (!isDryRun) Logger.trace(`[📖 动态追加] 旧时间冻结，新时间追加。`); }
                        else if (Settings.dynamicMode === 4) { newFrozenSequence.pop(); incomingItem._omniCat = 'frozen'; newFrozenSequence.push(incomingItem); if (!isDryRun) Logger.warn(`[🔥 原位替换] 破坏了缓存。`); }
                    }
                } else {
                    frozenItem._omniCat = 'frozen'; newFrozenSequence.push(frozenItem); 
                    if (i < 3 && Settings.prefixAnchor) { if (!isDryRun) { Logger.warn(`[⚓ 绝对前缀锚点] 强制保留被截断的头部。`); QuantumToastAggregator.add('prefix', '前缀锚点：已强制保留被截断的头部', 'warning', '⚓'); } }
                    else if (Settings.voidBridging && frozenItem.content.length > 30) {
                        const patch = createMsg({role: 'system', content: `[系统提示：设定已解除。之前的规则 "${truncateLog(frozenItem.content, 20)}" 已不再适用。]`}, 'SYS'); patch._omniCat = 'patch_void'; patch._sourceHash = frozenItem.hash; newAdditions.patches.push(patch);
                        if (!isDryRun) { Logger.debug(`[🌉 虚空架桥] 生成设定解除声明。`); QuantumToastAggregator.add('void', '虚空架桥：已生成设定解除声明', 'success', '🌉'); }
                    } else if ((Settings.permanentMemoryImprint || Settings.amnesiaProtocol) && !isDryRun) Logger.trace(`[🖨️ 永久记忆] 强制保留被删除的设定/记忆。`);
                }
            } else {
                let bestIdx = -1, bestScore = 0;
                for (let j = 0; j < incomingHistoryPool.length; j++) { if (!handledIncomingHis.has(j) && frozenItem.tag === incomingHistoryPool[j].tag) { const score = getSimilarity(frozenItem, incomingHistoryPool[j]); if (score > bestScore) { bestScore = score; bestIdx = j; } } }
                if (bestScore === 1 || (bestIdx !== -1 && frozenItem.fuzzyHash === incomingHistoryPool[bestIdx].fuzzyHash)) {
                    frozenItem._omniCat = 'frozen'; newFrozenSequence.push(frozenItem); handledIncomingHis.add(bestIdx); lastHandledIncomingHisIdx = Math.max(lastHandledIncomingHisIdx, bestIdx); hasMatchedAnyHistory = true;
                    if (bestScore < 1 && frozenItem.content !== incomingHistoryPool[bestIdx].content && !isDryRun) Logger.trace(`[👻 影同步] 忽略 CoT 或排版修改，强行发送旧版内容。`);
                } else if (bestScore > thresholds.his) {
                    const incomingItem = incomingHistoryPool[bestIdx]; handledIncomingHis.add(bestIdx); lastHandledIncomingHisIdx = Math.max(lastHandledIncomingHisIdx, bestIdx); hasMatchedAnyHistory = true;
                    if (Settings.entropyShield && bestScore > 0.90) {
                        frozenItem._omniCat = 'frozen'; newFrozenSequence.push(frozenItem); 
                        const patch = createMsg({role: 'system', content: `[系统提示：错字修正。之前的对话中，"${truncateLog(frozenItem.content, 15)}" 已修正为 "${truncateLog(incomingItem.content, 15)}"]`}, 'SYS'); patch._omniCat = 'patch_entropy'; patch._sourceHash = frozenItem.hash; newAdditions.patches.push(patch);
                        if (!isDryRun) { Logger.debug(`[🛡️ 熵减护盾] 生成错字修正补丁。`); QuantumToastAggregator.add('entropy', '熵减护盾：已生成错字修正补丁', 'success', '🛡️'); }
                    } else if (Settings.historyEditMode === 1) {
                        frozenItem._omniCat = 'frozen'; newFrozenSequence.push(frozenItem); 
                        const patch = createMsg({role: 'system', content: `[系统提示：时空修正。之前的对话中，"${truncateLog(frozenItem.content, 20)}" 实际上已发生改变，最新情况为："${incomingItem.content}"]`}, 'SYS'); patch._omniCat = 'patch_history'; patch._sourceHash = frozenItem.hash; newAdditions.patches.push(patch);
                        if (!isDryRun) { Logger.debug(`[🛡️ 时空补丁] 生成历史修改补丁。`); QuantumToastAggregator.add('patch', '时空补丁：已生成历史修改补丁', 'success', '⏳'); }
                    } else if (Settings.historyEditMode === 2) { frozenItem._omniCat = 'frozen'; newFrozenSequence.push(frozenItem); if (!isDryRun) Logger.debug(`[🙈 幻象隐藏] 强行使用旧版历史。`); }
                    else { incomingItem._omniCat = 'frozen'; newFrozenSequence.push(incomingItem); }
                } else {
                    frozenItem._omniCat = 'frozen'; newFrozenSequence.push(frozenItem); 
                    if (!hasMatchedAnyHistory && Settings.overflowCompression) {
                        const patch = createMsg({role: 'system', content: `[系统提示：早期记忆已归档。之前的事件 "${truncateLog(frozenItem.content, 20)}" 已转入潜意识。]`}, 'SYS'); patch._omniCat = 'patch_amnesia'; patch._sourceHash = frozenItem.hash; newAdditions.patches.push(patch);
                        if (!isDryRun) { Logger.debug(`[🧠 溢出压缩] 生成早期记忆归档补丁。`); QuantumToastAggregator.add('amnesia', '记忆溢出压缩：已生成早期记忆归档补丁', 'info', '🧠'); }
                    } else if (hasMatchedAnyHistory && Settings.retconProtocol) {
                        const patch = createMsg({role: 'system', content: `[系统提示：世界意志发动了记忆抹除。之前的事件 "${truncateLog(frozenItem.content, 20)}" 已被抹除，请当作从未发生过。]`}, 'SYS'); patch._omniCat = 'patch_retcon'; patch._sourceHash = frozenItem.hash; newAdditions.patches.push(patch);
                        if (!isDryRun) { Logger.debug(`[🗑️ 吃书协议] 生成记忆抹除声明。`); QuantumToastAggregator.add('retcon', '吃书协议：已生成记忆抹除声明', 'success', '🗑️'); }
                    } else if (Settings.amnesiaProtocol && !isDryRun) Logger.trace(`[🧠 失忆症协议] 强制保留被截断的历史。`);
                }
            }
        }

        for (let j = 0; j < incomingHistoryPool.length; j++) {
            if (!handledIncomingHis.has(j)) {
                const h = incomingHistoryPool[j];
                if (Settings.flashbackInsertion && j < lastHandledIncomingHisIdx) {
                    const patch = createMsg({role: 'system', content: `[系统提示：闪回补充。在之前的事件中，还发生了以下细节：\n${h.content}]`}, 'SYS'); patch._omniCat = 'patch_flashback'; newAdditions.patches.push(patch);
                    if (!isDryRun) { Logger.debug(`[⏪ 闪回插入] 将新插入的对话转为闪回补丁。`); QuantumToastAggregator.add('flashback', '闪回插入：已生成闪回补丁', 'success', '⏪'); }
                } else { h._omniCat = 'history'; newAdditions.history.push(h); }
            }
        }

        for (let j = 0; j < incomingSysPool.length; j++) {
            if (!handledIncomingSys.has(j)) {
                const sys = incomingSysPool[j];
                if (sys.isTimeSkip) {
                    const patch = createMsg({role: 'system', content: `[系统提示：叙事过渡。${sys.content}]`}, 'SYS'); patch._omniCat = 'patch_chronos'; newAdditions.patches.push(patch);
                    if (!isDryRun) QuantumToastAggregator.add('chronos', '克罗诺斯协议：已生成时间跳跃补丁', 'info', '⏳');
                } else if (sys.isVector) { sys._omniCat = 'dynamic'; newAdditions.dynamic.push(sys); if (!isDryRun) QuantumToastAggregator.add('vector', '向量隔离区：已将检索记忆沉底', 'info', '🎯'); }
                else if (sys.isSummary) { sys._omniCat = 'dynamic'; newAdditions.dynamic.push(sys); }
                else { sys._omniCat = sys.content.length < 500 ? 'lorebook' : 'sys'; newAdditions[sys._omniCat + 's'].push(sys); }
            }
        }

        let assembledSequence = [...newFrozenSequence];
        if (Settings.dynamicMode === 3) assembledSequence.push(...newAdditions.dynamic);
        assembledSequence.push(...newAdditions.sys, ...newAdditions.lorebooks, ...newAdditions.history);
        if ([1, 2].includes(Settings.dynamicMode)) assembledSequence.push(...newAdditions.dynamic);
        assembledSequence.push(...newAdditions.patches);

        let dedupedSequence = []; const seenSysNorms = new Set();
        for (let item of assembledSequence) {
            if (item.tag === 'SYS' && Settings.absoluteDeduplication) {
                if (['sys', 'lorebook'].includes(item._omniCat)) { if (seenSysNorms.has(item.hash)) continue; seenSysNorms.add(item.hash); }
                else if (item._omniCat === 'frozen') seenSysNorms.add(item.hash);
            }
            dedupedSequence.push(item);
        }

        const proposedStream = [...dedupedSequence];
        if (currentTurn.user) proposedStream.push(currentTurn.user);
        proposedStream.push(...currentTurn.prefills);

        if (Settings.logLevel >= LogLevels.DEBUG && !isDryRun) Logger.debug(`[最终追加发送阵列] 总节点数: ${proposedStream.length}`);
        if (!isDryRun) QuantumToastAggregator.flush();

        let requireResetConfirm = false, dropPercentStr = "0.0", mapInfoText = "无变更", causeText = "修改了内容", breakIndex = -1, preservedTokens = 0, recomputeTokens = 0;

        if (state.lastSentSequence?.length) {
            const L = state.lastSentSequence, P = proposedStream, minLen = Math.min(L.length, P.length);
            for (let i = 0; i < minLen; i++) if (L[i].role !== P[i].role || L[i].hash !== P[i].hash) { breakIndex = i; break; }
            if (breakIndex === -1) breakIndex = minLen;

            let preservedLen = 0, recomputeLen = 0;
            for (let i = 0; i < P.length; i++) { let len = P[i].content?.length || 0; i < breakIndex ? preservedLen += len : recomputeLen += len; }
            
            let recomputeRatio = breakIndex === L.length ? 0 : ((preservedLen + recomputeLen) === 0 ? 0 : (recomputeLen / (preservedLen + recomputeLen)));
            preservedTokens = Math.floor(preservedLen / 3.5); recomputeTokens = Math.floor(recomputeLen / 3.5);
            
            let isTailEndMutation = false;
            if (Settings.tailEndExemption && breakIndex >= L.length - 2 && P[breakIndex]?.tag !== 'SYS' && L[breakIndex]?.tag !== 'SYS') {
                isTailEndMutation = true; if (!isDryRun) Logger.log(`[👯 二重身协议] 检测到仅修改了最后回合对话，已自动放行。`);
            }
            
            dropPercentStr = (recomputeRatio * 100).toFixed(1);

            if (recomputeRatio >= 0.10 && Settings.showResetPrompt && !isTailEndMutation && !sessionSnoozeReset) {
                requireResetConfirm = true;
                causeText = (P[breakIndex]?.tag === 'SYS' || L[breakIndex]?.tag === 'SYS') ? "大幅修改或删除了【设定 / 世界书 / 预设提示词】" : "修改或删除了【历史聊天记录】";
                const tagHtml = `<span class="ds-tag ds-tag-${P[breakIndex]?.tag || L[breakIndex]?.tag}">[${P[breakIndex]?.tag || L[breakIndex]?.tag}]</span>`;
                mapInfoText = `<div style="margin-bottom:10px; display:flex; align-items:center; gap:8px;"><span style="color:var(--ds-cyan);"><i class="fa-solid fa-location-crosshairs"></i> 缓存断裂点位置:</span> <b>[索引 ${breakIndex}]</b> ${tagHtml}</div><div class="ds-diff-del"><i class="fa-solid fa-minus"></i> 原内容: ${escapeHtml(L[breakIndex]?.content || '∅').substring(0, 100).replace(/\n/g, ' ↵ ')}...</div><div class="ds-diff-add"><i class="fa-solid fa-plus"></i> 新内容: ${escapeHtml(P[breakIndex]?.content || '∅').substring(0, 100).replace(/\n/g, ' ↵ ')}...</div><div style="margin-top:12px; font-size: 12px; color:var(--ds-green); background:rgba(0,0,0,0.3); padding:8px; border-radius:6px;">✅ 断点前(保持冻结): 约 ${preservedTokens} Tokens <br>⚠️ 断点后(必须重算): <span style="color:var(--ds-red); font-weight:bold;">约 ${recomputeTokens} Tokens</span></div>`;
            }
        }

        if (isDryRun) return { proposedStream, breakIndex, dropPercent: dropPercentStr, preservedTokens, recomputeTokens };

        let decision = 'accept'; setTopBarStatus('#00ff00', '缓存: 健康');

        if (requireResetConfirm) {
            setTopBarStatus('#e5c07b', `缓存: 等待确认`);
            if (Settings.autoAccept) { Logger.warn(`[自动修复] 已放行断层重组 (需重算 ${dropPercentStr}%)`); !Settings.zenMode && typeof toastr !== 'undefined' && toastr.info(`已自动修复后台顺序 (需重算 ${dropPercentStr}%)`, "绝对真理"); decision = 'accept'; }
            else decision = await askUserForResetAsync(dropPercentStr, mapInfoText, causeText);
        }

        if (decision === 'abort') {
            Logger.error('[物理拦截] 已拦截本次发送，强制中止生成。', null, LogLevels.BASIC); setTopBarStatus('#e06c75', '缓存: 已拦截发送'); typeof toastr !== 'undefined' && toastr.error("已拦截发送！对话已中止。", "绝对真理");
            data.chat.length = 0; data.chat.push({ role: "invalid_abort_role", content: "ABORT_GENERATION" });
            setTimeout(() => { typeof StopGenerating === 'function' && StopGenerating(); (document.getElementById('stop_generating_button') || document.getElementById('send_but'))?.click(); }, 10);
            throw new Error("Generation aborted by DeepSeek Cache Optimizer."); 
        }

        if (decision === 'revert') {
            Logger.warn('[时空回溯] 用户选择无视本次修改，强行使用旧版缓存。'); setTopBarStatus('#c678dd', '缓存: 强行冻结旧版');
            const finalStream = [...state.frozenSequence]; if (currentTurn.user) finalStream.push(currentTurn.user); finalStream.push(...currentTurn.prefills);
            state.lastSentSequence = cloneStream(finalStream); safeSave();
            stream.splice(0, stream.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
            typeof toastr !== 'undefined' && toastr.success("已强行使用旧版内容发送，保住100%缓存！", "绝对真理"); return;
        }

        if (decision === 'bypass') { Logger.warn('[临时放行] 用户选择跳过本次优化，按 ST 原样乱序发送。'); setTopBarStatus('#e5c07b', '缓存: 临时放行'); return; }

        if (decision === 'accept') {
            state.frozenSequence = dedupedSequence; state.lastPrefills = currentTurn.prefills;
            const finalStream = [...state.frozenSequence]; if (currentTurn.user) finalStream.push(currentTurn.user); finalStream.push(...currentTurn.prefills);
            state.lastSentSequence = cloneStream(finalStream);
            if (Settings.multiverseProtocol) { state.multiverse.unshift([...state.frozenSequence]); if (state.multiverse.length > 5) state.multiverse.pop(); }
            safeSave();
            if (Settings.autoPinThreshold > 0 && finalStream.length >= Settings.autoPinThreshold && !Settings.pinnedChats[chatKeyInfo.key]) { Settings.pinnedChats[chatKeyInfo.key] = true; safeSave(); Logger.map(`[自动保护] 节点数(${finalStream.length})达标，已锁定当前存档。`); }
            stream.splice(0, stream.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
            Logger.log(`✅ 追加排序完成，拦截器授权发送。耗时: ${(performance.now() - startTime).toFixed(2)}ms`, LogLevels.BASIC);
        }

    } catch (err) {
        if (err.message === "Generation aborted by DeepSeek Cache Optimizer.") throw err; 
        setTopBarStatus('#e06c75', '缓存: 发生崩溃'); Logger.error('核心运算崩溃', err); throw err;
    }
}

// ==========================================
// 8. 👁️ Omni-Vision 全視之眼沙盒 UI
// ==========================================
let omniRenderTimeout = null, omniMappings = [], isSyncLocked = true, omniLeftArrayLastSent = [], omniNeedsRedraw = false, isOmniRendering = false, resizeObserver = null, nodePositionCache = { left: {}, right: {} }, currentOmniRenderId = 0, omniIsScrolling = false, omniScrollTimeout = null;

const OMNI_COLORS = { perfect: '152,195,121', fuzzy: '229,192,123', patch_link: '198,120,221', deleted: '224,108,117', new_lorebook: '86,182,194', new_dynamic: '209,154,102', new_history: '152,195,121', new_patch: '198,120,221', new_flashback: '255,121,198', new_retcon: '171,178,191', new_time: '209,154,102' };
const getColor = t => OMNI_COLORS[t] || '0,229,255';

const NODE_STYLES = {
    lorebook: { cls: 'ds-node-new-lore', lbl: '<span style="color:#56b6c2; font-weight:bold; margin-left:6px;">(NEW LORE)</span>' },
    dynamic: { cls: 'ds-node-new-dyn', lbl: '<span style="color:var(--ds-orange); font-weight:bold; margin-left:6px;">(NEW DYN)</span>' },
    history: { cls: 'ds-node-new-his', lbl: '<span style="color:var(--ds-green); font-weight:bold; margin-left:6px;">(NEW HIS)</span>' },
    patch_flashback: { cls: 'ds-node-flashback', lbl: '<span style="color:var(--ds-pink); font-weight:bold; margin-left:6px;">(FLASHBACK)</span>' },
    patch_retcon: { cls: 'ds-node-retcon', lbl: '<span style="color:var(--ds-gray); font-weight:bold; margin-left:6px;">(RETCON)</span>' },
    patch_void: { cls: 'ds-node-patch', lbl: '<span style="color:var(--ds-purple); font-weight:bold; margin-left:6px;">(VOID PATCH)</span>' },
    patch_nano: { cls: 'ds-node-patch', lbl: '<span style="color:var(--ds-purple); font-weight:bold; margin-left:6px;">(NANO PATCH)</span>' },
    patch_hotreload: { cls: 'ds-node-patch', lbl: '<span style="color:var(--ds-purple); font-weight:bold; margin-left:6px;">(HOT RELOAD)</span>' },
    patch_entropy: { cls: 'ds-node-patch', lbl: '<span style="color:var(--ds-purple); font-weight:bold; margin-left:6px;">(TYPO PATCH)</span>' },
    patch_history: { cls: 'ds-node-patch', lbl: '<span style="color:var(--ds-purple); font-weight:bold; margin-left:6px;">(TIME PATCH)</span>' },
    patch_chronos: { cls: 'ds-node-patch', lbl: '<span style="color:var(--ds-purple); font-weight:bold; margin-left:6px;">(TIME SKIP)</span>' },
    patch_amnesia: { cls: 'ds-node-patch', lbl: '<span style="color:var(--ds-purple); font-weight:bold; margin-left:6px;">(AMNESIA)</span>' },
    patch_time: { cls: 'ds-node-time', lbl: '<span style="color:var(--ds-orange); font-weight:bold; margin-left:6px;">(TIME SYNC)</span>' }
};

const omniResizeHandler = () => { if (!isOmniRendering) return; resizeCanvas(); cacheNodePositions(); requestCanvasUpdate(); };

function handleOmniScroll() {
    omniIsScrolling = true; requestCanvasUpdate();
    if (omniScrollTimeout) clearTimeout(omniScrollTimeout);
    omniScrollTimeout = setTimeout(() => { omniIsScrolling = false; requestCanvasUpdate(); }, 150);
}

async function showOmniVisionUI() {
    const chatKeyInfo = getChatKey(), state = Settings.chats[chatKeyInfo.key];
    if (!state?.frozenSequence?.length) return typeof toastr !== 'undefined' && toastr.warning("当前对话还没有冻结的缓存，无法开启全视之眼。请先发送一次对话！");

    omniLeftArrayLastSent = cloneStream(state.lastSentSequence || state.frozenSequence || []);

    const html = `
        <div class="ds-overlay ds-gpu-accel" id="ds-omni-modal-wrapper">
            <div class="ds-modal ds-omni-modal ds-gpu-accel" onclick="event.stopPropagation();">
                <div class="ds-omni-header-row">
                    <h2 class="ds-modal-title ds-blue"><i class="fa-solid fa-eye"></i> Omni-Vision 量子画布沙盒</h2>
                    <div class="ds-omni-stats-bar">
                        <div class="ds-omni-stats-text"><span style="color:var(--ds-green);"><i class="fa-solid fa-shield-halved"></i> 预计缓存命中率: <span id="omni-hit-rate">计算中...</span></span><span style="color:var(--ds-cyan);"><i class="fa-solid fa-coins"></i> 预计保留 Tokens: <span id="omni-tokens-saved">...</span> / 需重算: <span id="omni-tokens-lost" style="color:var(--ds-red);">...</span></span></div>
                        <div class="ds-health-bar"><div id="omni-hit-bar" class="ds-health-fill" style="width:0%;"></div></div>
                    </div>
                    <button class="ds-btn-reset" onclick="closeOmniVision();"><i class="fa-solid fa-xmark"></i> 关闭</button>
                </div>
                <div class="ds-omni-toolbar">
                    <button id="omni-btn-settings" class="ds-omni-action-btn"><i class="fa-solid fa-gears"></i> 核心协议控制台</button>
                    <button id="omni-btn-input" class="ds-omni-action-btn"><i class="fa-solid fa-keyboard"></i> 模拟输入测试</button>
                    <div style="width: 1px; height: 20px; background: rgba(255,255,255,0.2); margin: 0 5px;"></div>
                    <button id="omni-btn-sync" class="ds-omni-action-btn active" title="同步左右两侧的滚动条"><i class="fa-solid fa-link"></i> 锁定同步</button>
                    <button id="omni-btn-expand" class="ds-omni-action-btn" title="展开所有提示词卡片"><i class="fa-solid fa-expand"></i> 展开</button>
                    <button id="omni-btn-collapse" class="ds-omni-action-btn" title="折叠所有提示词卡片"><i class="fa-solid fa-compress"></i> 折叠</button>
                    <div style="flex:1;"></div>
                    <div class="ds-omni-legend">
                        <div class="ds-omni-legend-item"><div class="ds-omni-legend-color" style="background:var(--ds-green);"></div>完美冻结</div>
                        <div class="ds-omni-legend-item"><div class="ds-omni-legend-color" style="background:var(--ds-yellow);"></div>模糊命中</div>
                        <div class="ds-omni-legend-item"><div class="ds-omni-legend-color" style="background:var(--ds-purple);"></div>时空补丁</div>
                        <div class="ds-omni-legend-item"><div class="ds-omni-legend-color" style="background:var(--ds-orange);"></div>时序同步</div>
                        <div class="ds-omni-legend-item"><div class="ds-omni-legend-color" style="background:var(--ds-cyan);"></div>全新设定</div>
                        <div class="ds-omni-legend-item"><div class="ds-omni-legend-color" style="background:var(--ds-red);"></div>已删除</div>
                    </div>
                    <div id="omni-panel-settings" class="ds-omni-floating-panel">
                        <div class="ds-omni-toggles-container ds-scroll">
                            ${Object.keys(defaultSettings).filter(k => typeof defaultSettings[k] === 'boolean' && k !== 'enabled' && k !== 'zenMode' && k !== 'toastHistory' && k !== 'showResetPrompt' && k !== 'autoAccept' && k !== 'hotkeysEnabled' && k !== 'autoScrollLog' && k !== 'autoBackup').map(k => `<div class="ds-omni-toggle ${Settings[k]?'active':''}" data-setting="${k}"><i class="fa-solid fa-check"></i> ${k}</div>`).join('')}
                            <div class="ds-omni-toggle ${Settings.dynamicMode===1?'active':''}" data-setting="dynamicMode" data-val="1" title="写日记模式"><i class="fa-solid fa-book-journal-whills"></i> 日记模式</div>
                        </div>
                    </div>
                    <div id="omni-panel-input" class="ds-omni-floating-panel"><textarea id="omni-simulated-input" class="ds-input-styled ds-scroll" placeholder="✍️ 模拟用户即将发送的输入 (输入后会自动触发下方沙盒重算)..." style="height: 60px; resize: vertical;"></textarea></div>
                </div>
                <div class="ds-omni-workspace">
                    <div class="ds-omni-pane"><div class="ds-omni-pane-header"><span style="color:var(--ds-purple);"><i class="fa-solid fa-server"></i> 上次最终发送 (Last API Payload)</span></div><div id="omni-left-pane" class="ds-omni-pane-content ds-scroll"><div style="text-align:center; padding:20px; color:#abb2bf;">加载中...</div></div></div>
                    <div class="ds-omni-canvas-container"><canvas id="omni-canvas"></canvas><div id="omni-arrows-layer"></div></div>
                    <div class="ds-omni-pane"><div class="ds-omni-pane-header"><span style="color:var(--ds-cyan);"><i class="fa-solid fa-flask"></i> 下次预计发送 (Next API Preview)</span></div><div id="omni-right-pane" class="ds-omni-pane-content ds-scroll"><div style="text-align:center; padding:20px; color:#abb2bf;">加载中...</div></div></div>
                </div>
            </div>
        </div>
    `;
    $('body').append(html); renderOmniLeftPane(omniLeftArrayLastSent);

    $('#omni-btn-settings').on('click', e => { e.stopPropagation(); $('#omni-panel-input').removeClass('open'); $('#omni-panel-settings').toggleClass('open'); });
    $('#omni-btn-input').on('click', e => { e.stopPropagation(); $('#omni-panel-settings').removeClass('open'); $('#omni-panel-input').toggleClass('open'); });
    $('#ds-omni-modal-wrapper').on('click', function(e) { if (!$(e.target).closest('.ds-omni-toolbar').length) $('.ds-omni-floating-panel').removeClass('open'); if(e.target === this) closeOmniVision(); });

    $('.ds-omni-toggle').on('click', function() {
        const setting = $(this).data('setting');
        if (setting === 'dynamicMode') { Settings.dynamicMode = Settings.dynamicMode === 1 ? 0 : 1; $(this).toggleClass('active', Settings.dynamicMode === 1); $('#ds-cache-dynamic-mode').val(Settings.dynamicMode); }
        else { Settings[setting] = !Settings[setting]; $(this).toggleClass('active', Settings[setting]); $(`#ds-cache-${setting.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}`).prop('checked', Settings[setting]); }
        safeSave(); triggerOmniRender(state);
    });

    $('#omni-btn-sync').on('click', function() { isSyncLocked = !isSyncLocked; $(this).toggleClass('active', isSyncLocked).html(isSyncLocked ? '<i class="fa-solid fa-link"></i> 锁定同步' : '<i class="fa-solid fa-link-slash"></i> 解除同步'); if (isSyncLocked) syncScroll('left'); });

    const animateCanvasDuringTransition = () => {
        let start = performance.now();
        const step = time => { if (!isOmniRendering) return; cacheNodePositions(); requestCanvasUpdate(); if (time - start < 350) requestAnimationFrame(step); };
        requestAnimationFrame(step);
    };

    $('#omni-btn-expand').on('click', () => { $('.ds-node-content').removeClass('collapsed'); $('.ds-node-expand-btn').html('<i class="fa-solid fa-chevron-up"></i> 收起'); animateCanvasDuringTransition(); });
    $('#omni-btn-collapse').on('click', () => { $('.ds-node-content').addClass('collapsed'); $('.ds-node-expand-btn').html('<i class="fa-solid fa-chevron-down"></i> 展开'); animateCanvasDuringTransition(); });

    let inputTimeout; $('#omni-simulated-input').on('input', () => { clearTimeout(inputTimeout); inputTimeout = setTimeout(() => triggerOmniRender(state), 300); });

    $('#ds-omni-modal-wrapper').on('click', '.ds-node-expand-btn', function() {
        const contentDiv = $(this).siblings('.ds-node-content');
        contentDiv.toggleClass('collapsed'); $(this).html(contentDiv.hasClass('collapsed') ? '<i class="fa-solid fa-chevron-down"></i> 展开' : '<i class="fa-solid fa-chevron-up"></i> 收起');
        animateCanvasDuringTransition();
    });

    let ignoreLeftScroll = false, ignoreRightScroll = false;
    const leftPane = document.getElementById('omni-left-pane'), rightPane = document.getElementById('omni-right-pane');
    
    function syncScroll(sourceSide) {
        if (!isSyncLocked) return;
        const sourcePane = document.getElementById(`omni-${sourceSide}-pane`), targetSide = sourceSide === 'left' ? 'right' : 'left', targetPane = document.getElementById(`omni-${targetSide}-pane`);
        const sourceScrollTop = sourcePane.scrollTop;
        if (sourceScrollTop <= 5) return targetPane.scrollTop = 0;
        if (sourceScrollTop + sourcePane.clientHeight >= sourcePane.scrollHeight - 5) return targetPane.scrollTop = targetPane.scrollHeight;

        const sourceCenterY = sourceScrollTop + (sourcePane.clientHeight / 2), sourceCache = nodePositionCache[sourceSide];
        if (!Object.keys(sourceCache).length) return;

        let closestId = -1, minDiff = Infinity;
        for (const id in sourceCache) { const diff = Math.abs(sourceCache[id].baseY - sourceCenterY); if (diff < minDiff) { minDiff = diff; closestId = parseInt(id); } }

        if (closestId !== -1) {
            const mapping = omniMappings.find(m => sourceSide === 'left' ? m.left === closestId : m.right === closestId);
            if (mapping) {
                const targetId = sourceSide === 'left' ? mapping.right : mapping.left;
                if (targetId !== -1 && nodePositionCache[targetSide][targetId]) targetPane.scrollTop = nodePositionCache[targetSide][targetId].baseY - (targetPane.clientHeight / 2);
                else targetPane.scrollTop = (sourceScrollTop / (sourcePane.scrollHeight - sourcePane.clientHeight || 1)) * (targetPane.scrollHeight - targetPane.clientHeight || 1);
            }
        }
    }

    leftPane.addEventListener('scroll', () => { handleOmniScroll(); if (!isSyncLocked || ignoreLeftScroll) return; ignoreRightScroll = true; syncScroll('left'); setTimeout(() => ignoreRightScroll = false, 20); }, {passive: true});
    rightPane.addEventListener('scroll', () => { handleOmniScroll(); if (!isSyncLocked || ignoreRightScroll) return; ignoreLeftScroll = true; syncScroll('right'); setTimeout(() => ignoreLeftScroll = false, 20); }, {passive: true});

    window.removeEventListener('resize', omniResizeHandler); window.addEventListener('resize', omniResizeHandler);
    isOmniRendering = true; omniRenderLoop();

    resizeObserver = new ResizeObserver(() => { if (!isOmniRendering) return; resizeCanvas(); cacheNodePositions(); requestCanvasUpdate(); });
    resizeObserver.observe(leftPane); resizeObserver.observe(rightPane);

    triggerOmniRender(state);
}

window.closeOmniVision = () => {
    isOmniRendering = false; if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    window.removeEventListener('resize', omniResizeHandler); $('#ds-omni-modal-wrapper').remove();
    omniMappings = []; omniLeftArrayLastSent = []; nodePositionCache = { left: {}, right: {} };
};

const cacheNodePositions = () => {
    const canvasContainer = document.querySelector('.ds-omni-canvas-container'), leftPane = document.getElementById('omni-left-pane'), rightPane = document.getElementById('omni-right-pane');
    if (!canvasContainer || !leftPane || !rightPane) return;
    const canvasRect = canvasContainer.getBoundingClientRect();
    nodePositionCache = { left: {}, right: {} };
    
    const leftOffset = leftPane.getBoundingClientRect().top - canvasRect.top;
    leftPane.querySelectorAll('.ds-node-card').forEach(node => nodePositionCache.left[parseInt(node.id.replace('omni-left-node-', ''))] = { baseY: node.offsetTop + (node.offsetHeight / 2), offset: leftOffset });
    
    const rightOffset = rightPane.getBoundingClientRect().top - canvasRect.top;
    rightPane.querySelectorAll('.ds-node-card').forEach(node => nodePositionCache.right[parseInt(node.id.replace('omni-right-node-', ''))] = { baseY: node.offsetTop + (node.offsetHeight / 2), offset: rightOffset });
};

const renderOmniLeftPane = arr => {
    const container = document.getElementById('omni-left-pane'); if (!container) return;
    const frag = document.createDocumentFragment();
    arr.forEach((node, idx) => {
        const el = document.createElement('div'); el.className = `ds-node-card ds-node-hit`; el.id = `omni-left-node-${idx}`;
        el.innerHTML = `<div class="ds-node-header"><span><span class="ds-tag ds-tag-${node.tag || 'SYS'}">[${node.tag || 'SYS'}]</span> Index: ${idx} <span class="ds-omni-left-status"></span></span><span>Hash: ${(node.hash || 0).toString(16).substring(0,8)}</span></div><div class="ds-node-content-wrapper"><div class="ds-node-content collapsed">${escapeHtml(node.content).replace(/\n/g, '<br>')}</div><div class="ds-node-expand-btn"><i class="fa-solid fa-chevron-down"></i> 展开</div></div>`;
        frag.appendChild(el);
    });
    container.innerHTML = ''; container.appendChild(frag);
};

const requestCanvasUpdate = () => omniNeedsRedraw = true;
const omniRenderLoop = () => { if (!isOmniRendering) return; if (omniNeedsRedraw) { updateOmniCanvas(); omniNeedsRedraw = false; } requestAnimationFrame(omniRenderLoop); };
const triggerOmniRender = state => { if (omniRenderTimeout) clearTimeout(omniRenderTimeout); omniRenderTimeout = setTimeout(() => renderOmniVision(state), 50); };

let syncLockTimeout = null;
window.jumpToOmniNode = (side, id) => {
    const targetPane = document.getElementById(`omni-${side}-pane`), targetNode = document.getElementById(`omni-${side}-node-${id}`);
    if (targetPane && targetNode) {
        isSyncLocked = false; targetPane.scrollTo({ top: targetNode.offsetTop - (targetPane.clientHeight / 2) + (targetNode.offsetHeight / 2), behavior: 'smooth' });
        targetNode.classList.remove('highlight-pulse'); void targetNode.offsetWidth; targetNode.classList.add('highlight-pulse');
        if (syncLockTimeout) clearTimeout(syncLockTimeout); syncLockTimeout = setTimeout(() => isSyncLocked = $('#omni-btn-sync').hasClass('active'), 800);
    }
};

async function renderOmniVision(state) {
    const renderId = ++currentOmniRenderId, rightContainer = document.getElementById('omni-right-pane');
    if (!rightContainer) return;

    const leftArray = omniLeftArrayLastSent;
    let rightArray = [], breakIndex = -1, dropPercent = "0.0", preservedTokens = 0, recomputeTokens = 0;

    const ctxChat = (getContext().chat || []).map(m => ({ role: m.is_user ? 'user' : (m.is_system ? 'system' : 'assistant'), content: m.mes || '' }));
    let simulatedStream = state.lastRawStream?.length ? [...state.lastRawStream.filter(m => m.role === 'system' || (m.role !== 'user' && m.role !== 'assistant')), ...ctxChat] : [...ctxChat];

    if (simulatedStream.length) {
        const simInput = $('#omni-simulated-input').val().trim(); if (simInput) simulatedStream.push({ role: 'user', content: simInput });
        const dryRunResult = await interceptAndRestructurePrompt({ chat: simulatedStream }, true);
        if (renderId !== currentOmniRenderId) return; 
        if (dryRunResult) { rightArray = dryRunResult.proposedStream; breakIndex = dryRunResult.breakIndex; dropPercent = dryRunResult.dropPercent; preservedTokens = dryRunResult.preservedTokens; recomputeTokens = dryRunResult.recomputeTokens; }
    } else { rightArray = [...leftArray]; breakIndex = leftArray.length; }

    const hitRate = (100 - parseFloat(dropPercent)).toFixed(1);
    $('#omni-hit-rate').text(`${hitRate}%`); $('#omni-hit-bar').css('width', `${hitRate}%`); $('#omni-tokens-saved').text(preservedTokens); $('#omni-tokens-lost').text(recomputeTokens);

    omniMappings = []; const leftMatched = new Set(), rightMatched = new Set();

    rightArray.forEach((rNode, rIdx) => {
        let bestMatchIdx = -1, bestScore = 0;
        if (rNode._omniCat?.startsWith('patch_') && rNode._sourceHash) {
            bestMatchIdx = leftArray.findIndex(l => l.hash === rNode._sourceHash);
            if (bestMatchIdx !== -1) { omniMappings.push({ left: bestMatchIdx, right: rIdx, type: 'patch_link' }); rightMatched.add(rIdx); return; }
        }
        bestMatchIdx = leftArray.findIndex(l => l.hash === rNode.hash);
        if (bestMatchIdx !== -1) bestScore = 1;
        else leftArray.forEach((lNode, lIdx) => {
            if (rNode.fuzzyHash === lNode.fuzzyHash && bestScore < 0.99) { bestMatchIdx = lIdx; bestScore = 0.99; }
            else { let score = getSimilarity(rNode, lNode); if (score > bestScore && score > 0.8) { bestScore = score; bestMatchIdx = lIdx; } }
        });

        if (bestMatchIdx !== -1) { leftMatched.add(bestMatchIdx); rightMatched.add(rIdx); omniMappings.push({ left: bestMatchIdx, right: rIdx, type: bestScore === 1 ? 'perfect' : 'fuzzy' }); }
        else omniMappings.push({ left: -1, right: rIdx, type: rNode.tag === 'USER' || rNode.tag === 'AI' ? 'new_history' : rNode._omniCat?.startsWith('patch_') ? (rNode._omniCat === 'patch_time' ? 'new_time' : 'new_patch') : 'new_sys' });
    });

    leftArray.forEach((lNode, lIdx) => { if (!leftMatched.has(lIdx)) omniMappings.push({ left: lIdx, right: -1, type: 'deleted' }); });

    leftArray.forEach((node, idx) => {
        const el = document.getElementById(`omni-left-node-${idx}`);
        if (el) { el.className = `ds-node-card ${!leftMatched.has(idx) ? 'ds-node-miss' : 'ds-node-hit'}`; const s = el.querySelector('.ds-omni-left-status'); if (s) s.innerHTML = !leftMatched.has(idx) ? '<span style="color:var(--ds-red); font-weight:bold; margin-left:6px;">(DELETED)</span>' : ''; }
    });

    const rightFrag = document.createDocumentFragment();
    rightArray.forEach((node, idx) => {
        let cardClass = breakIndex !== -1 && idx >= breakIndex ? 'ds-node-warn' : 'ds-node-hit', newLabel = '';
        if (!rightMatched.has(idx)) {
            const style = NODE_STYLES[node._omniCat];
            if (style) { cardClass = style.cls; newLabel = style.lbl; } else { cardClass = 'ds-node-new-sys'; newLabel = '<span style="color:var(--ds-cyan); font-weight:bold; margin-left:6px;">(NEW SYS)</span>'; }
        } else if (node._omniCat?.startsWith('patch_')) cardClass = 'ds-node-patch';

        const el = document.createElement('div'); el.className = `ds-node-card ${cardClass}`; el.id = `omni-right-node-${idx}`;
        el.innerHTML = `<div class="ds-node-header"><span><span class="ds-tag ds-tag-${node.tag || 'SYS'}">[${node.tag || 'SYS'}]</span> Index: ${idx} ${newLabel}</span><span>Hash: ${(node.hash || 0).toString(16).substring(0,8)}</span></div><div class="ds-node-content-wrapper"><div class="ds-node-content collapsed">${escapeHtml(node.content).replace(/\n/g, '<br>')}</div><div class="ds-node-expand-btn"><i class="fa-solid fa-chevron-down"></i> 展开</div></div>`;
        rightFrag.appendChild(el);
    });
    rightContainer.innerHTML = ''; rightContainer.appendChild(rightFrag);

    if (resizeObserver) document.querySelectorAll('.ds-node-content').forEach(el => resizeObserver.observe(el));

    document.getElementById('omni-arrows-layer').innerHTML = omniMappings.map((m, i) => {
        const c = getColor(m.type);
        if (m.left !== -1 && m.right !== -1) return `<div id="omni-arrow-l-${i}" class="ds-omni-arrow ds-omni-arrow-left" style="display:none; color:rgb(${c});" onclick="jumpToOmniNode('right', ${m.right})" title="跳转到右侧对应节点"><i class="fa-solid fa-chevron-right"></i></div><div id="omni-arrow-r-${i}" class="ds-omni-arrow ds-omni-arrow-right" style="display:none; color:rgb(${c});" onclick="jumpToOmniNode('left', ${m.left})" title="跳转到左侧对应节点"><i class="fa-solid fa-chevron-left"></i></div>`;
        if (m.type === 'deleted') return `<div id="omni-arrow-l-${i}" class="ds-omni-arrow ds-omni-arrow-left" style="display:none; color:rgb(${c}); cursor:default;" title="此节点已被删除"><i class="fa-solid fa-xmark"></i></div>`;
        if (m.type.startsWith('new_')) return `<div id="omni-arrow-r-${i}" class="ds-omni-arrow ds-omni-arrow-right" style="display:none; color:rgb(${c}); cursor:default;" title="这是新插入的节点"><i class="fa-solid fa-plus"></i></div>`;
        return '';
    }).join('');

    requestAnimationFrame(() => { if (renderId !== currentOmniRenderId) return; resizeCanvas(); cacheNodePositions(); requestCanvasUpdate(); });
}

function resizeCanvas() {
    const canvas = document.getElementById('omni-canvas'), container = canvas?.parentElement; if (!canvas || !container) return;
    const rect = container.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr; canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
}

function updateOmniCanvas() {
    const canvas = document.getElementById('omni-canvas'), leftPane = document.getElementById('omni-left-pane'), rightPane = document.getElementById('omni-right-pane');
    if (!canvas || !leftPane || !rightPane) return;

    const ctx = canvas.getContext('2d'), width = canvas.width / (window.devicePixelRatio || 1), height = canvas.height / (window.devicePixelRatio || 1), halfWidth = width / 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.save(); ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowBlur = (omniIsScrolling || omniMappings.length > 50) ? 0 : 5;

    for (let i = 0; i < omniMappings.length; i++) {
        const m = omniMappings[i]; let startX = 0, startY = 0, endX = width, endY = 0, isVisible = false;
        if (m.left !== -1 && nodePositionCache.left[m.left]) startY = nodePositionCache.left[m.left].baseY - leftPane.scrollTop + nodePositionCache.left[m.left].offset;
        if (m.right !== -1 && nodePositionCache.right[m.right]) endY = nodePositionCache.right[m.right].baseY - rightPane.scrollTop + nodePositionCache.right[m.right].offset;

        if (m.type === 'deleted') { if (startY === undefined) continue; endY = startY; endX = halfWidth; if (startY > -50 && startY < height + 50) isVisible = true; } 
        else if (m.type.startsWith('new_')) { if (endY === undefined) continue; startY = endY; startX = halfWidth; if (endY > -50 && endY < height + 50) isVisible = true; } 
        else { if (startY === undefined || endY === undefined) continue; if ((startY > -50 && startY < height + 50) || (endY > -50 && endY < height + 50)) isVisible = true; }

        const arrowL = document.getElementById(`omni-arrow-l-${i}`), arrowR = document.getElementById(`omni-arrow-r-${i}`);
        if (!isVisible) { if (arrowL) arrowL.style.display = 'none'; if (arrowR) arrowR.style.display = 'none'; continue; }

        const distY = Math.abs(endY - startY), cpOffset = width * Math.min(0.45, 0.1 + (distY / height) * 0.4);
        ctx.beginPath(); ctx.moveTo(startX, startY); ctx.bezierCurveTo(startX + cpOffset, startY, endX - cpOffset, endY, endX, endY); ctx.lineWidth = 1.8; 

        const colorHex = getColor(m.type);
        ctx.setLineDash(['fuzzy', 'deleted'].includes(m.type) || m.type.startsWith('new_') ? [6, 6] : []);
        const alpha = Math.max(0.4, 0.85 - (distY / height) * 0.3);

        if (m.type === 'deleted') { const grad = ctx.createLinearGradient(0, 0, halfWidth, 0); grad.addColorStop(0, `rgba(${colorHex},${alpha})`); grad.addColorStop(1, `rgba(${colorHex},0)`); ctx.strokeStyle = grad; } 
        else if (m.type.startsWith('new_')) { const grad = ctx.createLinearGradient(halfWidth, 0, width, 0); grad.addColorStop(0, `rgba(${colorHex},0)`); grad.addColorStop(1, `rgba(${colorHex},${alpha})`); ctx.strokeStyle = grad; } 
        else ctx.strokeStyle = `rgba(${colorHex},${alpha})`;
        
        if (ctx.shadowBlur > 0) ctx.shadowColor = `rgba(${colorHex},0.4)`;
        ctx.stroke();

        if (arrowL) { arrowL.style.display = 'flex'; arrowL.style.transform = `translate3d(0, calc(${startY}px - 50%), 0)`; }
        if (arrowR) { arrowR.style.display = 'flex'; arrowR.style.transform = `translate3d(0, calc(${endY}px - 50%), 0)`; }
    }
    ctx.restore();
}

// ==========================================
// 9. UI 面板與高階事件綁定
// ==========================================
function renderChatsUI() {
    const container = $('#ds-chat-list-container'); if (!container.length) return; container.empty();
    const totalBytes = getStorageSize(), maxStorage = 5 * 1024 * 1024, healthPercent = Math.min((totalBytes / maxStorage) * 100, 100);
    $('#ds-storage-badge').text(formatBytes(totalBytes));
    $('#ds-health-fill').css({ 'width': `${healthPercent}%`, 'background': healthPercent > 90 ? 'var(--ds-red)' : healthPercent > 70 ? 'var(--ds-yellow)' : 'var(--ds-green)' });
    $('#ds-health-text').text(`存储健康度: ${healthPercent.toFixed(1)}%`);

    const keys = Object.keys(Settings.chats);
    if (!keys.length) return container.append('<div style="font-size:13px; opacity:0.5; padding:20px; text-align:center; font-style:italic;">记忆矩阵为空</div>');

    const currentKey = getChatKey().key; 
    const sortedKeys = keys.sort((a, b) => a === currentKey ? -1 : b === currentKey ? 1 : (Settings.pinnedChats[b] ? 1 : 0) - (Settings.pinnedChats[a] ? 1 : 0) || (Settings.chats[b].lastAccessed || 0) - (Settings.chats[a].lastAccessed || 0));

    const frag = document.createDocumentFragment();
    sortedKeys.forEach(key => {
        const chat = Settings.chats[key], isActive = key === currentKey, isPinned = Settings.pinnedChats[key] === true;
        const diff = chat.lastAccessed ? Math.floor((Date.now() - chat.lastAccessed) / 60000) : -1;
        const timeStr = diff === -1 ? "未知" : diff < 1 ? "刚刚" : diff < 60 ? `${diff} 分钟前` : diff < 1440 ? `${Math.floor(diff/60)} 小时前` : `${Math.floor(diff/1440)} 天前`;

        const item = document.createElement('div'); item.className = `ds-chat-item ds-gpu-accel ds-virtual-list ${isActive ? 'active-chat' : ''}`; item.title = isActive ? '这是您当前的对话' : '';
        item.innerHTML = `<div style="display:flex; flex-direction:column; overflow:hidden; width:70%;"><span style="font-size:13px; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:${isActive?'var(--ds-cyan)':'#e5e5e5'}; text-shadow:${isActive?'0 0 8px rgba(0,229,255,0.4)':'none'};">${isActive ? '🟢 ' : ''}${escapeHtml(chat.label)}</span><div style="display:flex; gap:12px; font-size:11px; margin-top:6px;"><span style="color:var(--ds-green); background:rgba(152,195,121,0.1); padding:2px 6px; border-radius:4px;">节点: ${chat.frozenSequence?.length || 0}</span><span style="color:#5c6370; display:flex; align-items:center; gap:4px;"><i class="fa-regular fa-clock"></i> ${timeStr}</span></div></div><div class="ds-action-group" style="display:flex; gap:6px;"><button class="menu_button interactable ds-pin-btn" data-key="${key}" style="font-size:13px; padding:6px 10px; border-radius:6px; color:${isPinned ? 'var(--ds-yellow)' : 'rgba(255,255,255,0.2)'}; background:rgba(255,255,255,0.05);" title="${isPinned ? '取消保护' : '锁定保护'}"><span class="fa-solid fa-thumbtack"></span></button><button class="menu_button interactable ds-reset-btn" data-key="${key}" style="font-size:13px; padding:6px 10px; border-radius:6px; color:var(--ds-red); background:rgba(224,108,117,0.05);" title="删除此存档"><span class="fa-solid fa-trash"></span></button></div>`;
        frag.appendChild(item);
    });
    container.append(frag);

    container.find('.ds-reset-btn').on('click', function() { const k = $(this).data('key'); delete Settings.chats[k]; delete Settings.pinnedChats[k]; safeSave(); renderChatsUI(); });
    container.find('.ds-pin-btn').on('click', function() { const k = $(this).data('key'); Settings.pinnedChats[k] ? delete Settings.pinnedChats[k] : Settings.pinnedChats[k] = true; safeSave(); renderChatsUI(); });
}

const generateDiagnosticReport = () => {
    const state = Settings.chats[getChatKey().key] || {};
    const report = `=== DeepSeek Absolute Truth Diagnostic Report ===\nGenerated: ${new Date().toISOString()}\nUser Agent: ${navigator.userAgent}\n\n--- Current Chat State ---\nChat Key: ${getChatKey().key}\nFrozen Nodes: ${state.frozenSequence?.length || 0}\nMultiverse Branches: ${state.multiverse?.length || 0}\nDynamic Anomalies Detected: ${state.dynamicAnomalies?.length || 0}\n\n--- Plugin Settings ---\n${JSON.stringify(Settings, null, 2)}\n\n--- Recent Logs (Last 100) ---\n${Array.from(document.querySelectorAll('#ds-cache-log-container .ds-log-line')).slice(-100).map(el => el.innerText).join('\n')}\n`;
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([report], { type: "text/plain;charset=utf-8" })); a.download = `DS_Diagnostic_${Date.now()}.txt`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    typeof toastr !== 'undefined' && toastr.success("📄 诊断报告已生成并下载！");
};

const exportLogsAsJSON = () => {
    const logs = logQueue.concat(Array.from(document.querySelectorAll('#ds-cache-log-container .ds-log-line')).map(el => ({ time: el.querySelector('.ds-log-time')?.innerText.replace(/[\[\]]/g, '') || '', type: el.getAttribute('data-type') || 'info', msg: el.querySelector('.ds-log-content')?.innerText || el.innerText })));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" })); a.download = `DS_Logs_${Date.now()}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    typeof toastr !== 'undefined' && toastr.success("📄 JSON 日志已导出！");
};

const copyApiPayload = () => {
    const state = Settings.chats[getChatKey().key];
    if (!state?.lastSentSequence) return typeof toastr !== 'undefined' && toastr.warning("当前没有可复制的发送阵列。");
    navigator.clipboard.writeText(JSON.stringify(state.lastSentSequence.map(m => ({ role: m.role, content: m.content })), null, 2)).then(() => typeof toastr !== 'undefined' && toastr.success("📋 最终 API 发送阵列已复制到剪贴板！"));
};

const applyOneClickOptimize = () => {
    if (!confirm("🌟 确定要套用「DeepSeek 100% 缓存最佳化设定」吗？\n\n这会自动开启所有防御协议，并将动态提示词处理模式设为「写日记模式」。")) return;
    Object.assign(Settings, { enabled: true, dynamicMode: 1, historyEditMode: 1, lorebookSink: true, retconProtocol: true, hotReloadPersona: true, flashbackInsertion: true, multiverseProtocol: true, nanoPatching: true, gravityProtocol: true, summaryAnchor: true, tailEndExemption: true, chronosProtocol: true, amnesiaProtocol: true, anchorStabilization: true, permanentMemoryImprint: true, entropyShield: true, absoluteDeduplication: true, voidBridging: true, warpDriveFilter: true, prefixAnchor: true, semanticNormalize: true, absoluteOrderMatrix: true, vectorQuarantine: true, cotIsolation: true, timeVarNeutralizer: true, overflowCompression: true });
    safeSave();
    ['enable', 'prefix', 'semantic', 'void', 'warp', 'multiverse', 'entropy', 'dedup', 'anchor', 'imprint', 'chronos', 'amnesia', 'nanopatch', 'summary', 'retcon', 'hotreload', 'flashback', 'matrix', 'vector', 'cot', 'timevar', 'overflow'].forEach(k => $(`#ds-cache-${k}`).prop('checked', true));
    $('#ds-cache-dynamic-mode').val(1); $('#ds-cache-history-mode').val(1);
    $('.ds-omni-toggle').addClass('active'); updateTopBarState();
    typeof toastr !== 'undefined' && toastr.success("🌟 已成功套用 DeepSeek 最佳化设定！");
};

async function setupUI() {
    try {
        injectCSS();
        const html = `
        <div class="inline-drawer" id="ds-v52-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header" style="background: linear-gradient(90deg, rgba(0,229,255,0.1) 0%, rgba(0,0,0,0) 100%); border-left: 3px solid var(--ds-cyan);">
                <b style="color:var(--ds-cyan); text-shadow: 0 0 8px rgba(0,229,255,0.3);"><span class="fa-solid fa-microchip"></span> DeepSeek 绝对真理优化器 (v52)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down" style="color:var(--ds-cyan);"></div>
            </div>
            <div class="inline-drawer-content ds-scroll" style="padding:18px; background: rgba(0,0,0,0.2);">
                <button id="ds-btn-omni-vision" class="ds-btn ds-btn-omni"><i class="fa-solid fa-eye"></i> 👁️ 打开 Omni-Vision 量子画布沙盒 (即时预览)</button>
                <button id="ds-btn-one-click" class="ds-btn ds-btn-magic"><i class="fa-solid fa-wand-magic-sparkles"></i> 🌟 一键套用 DeepSeek 100% 缓存最佳设定</button>

                <div class="ds-opt-group open"><div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')"><span><i class="fa-solid fa-rocket"></i> 1. 核心引擎 (必看)</span> <i class="fa-solid fa-chevron-down"></i></div><div class="ds-opt-content">
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-enable" ${Settings.enabled ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-cyan); text-shadow:0 0 5px rgba(0,229,255,0.4);">启动绝对真理引擎 <span class="ds-perf-badge ds-perf-low">GPU 极限加速中</span></b><span>(核心功能！让回复变秒回，大幅节省 Token 和 API 费用)</span></div></label></div><hr style="border:0; border-top:1px dashed rgba(255,255,255,0.1); width:100%; margin:4px 0;">
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-zen" ${Settings.zenMode ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-purple);">沉浸免打扰模式</b><span>(隐藏所有屏幕右上角的烦人黑色提示框，专心看故事)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-hotkeys" ${Settings.hotkeysEnabled ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-green);">启用键盘快捷键</b><span>(Ctrl+Alt+C 开关缓存 / R 撕书重来 / V 全视之眼)</span></div></label></div>
                </div></div>

                <div class="ds-opt-group open"><div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')"><span><i class="fa-solid fa-shield-halved"></i> 2. 绝对领域防御盾 (100% Cache)</span> <i class="fa-solid fa-chevron-down"></i></div><div class="ds-opt-content">
                    <p style="font-size:12px; color:#abb2bf; margin:0; line-height:1.6; background:rgba(0,0,0,0.3); padding:10px; border-radius:6px; border-left:3px solid var(--ds-cyan);">开启以下功能，即使你在聊天中途触发了世界书，或者往回修改、删除了旧对话，系统也能帮你<b style="color:var(--ds-cyan);">保住 100% 的缓存</b>！</p>
                    <div class="ds-sub-header"><i class="fa-solid fa-link"></i> [核心防断层] 基础排版与结构防御</div>
                    <div class="ds-row" style="margin-top:5px;"><label class="ds-row-left"><input type="checkbox" id="ds-cache-matrix" ${Settings.absoluteOrderMatrix ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-cyan);">🧊 绝对真理追加架构 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="强制接管 ST 的系统提示词排序。过去不可变，所有新增加的世界书、动态变量都会被强制追加到最底部。这是 100% 缓存的终极奥义！">?</span></b><span>(ST 乱序不破缓存)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-prefix" ${Settings.prefixAnchor ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-cyan);">⚓ 绝对前缀锚点 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当对话太长导致 ST 删除了最旧的第一句话时，系统会强制将其保留，并改为删除中间的对话。这能防止前缀改变导致 100% 缓存断裂！">?</span></b><span>(爆 Token 截断不破缓存)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-semantic" ${Settings.semanticNormalize ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-green);">🧹 模糊语义引擎 <span class="ds-perf-badge ds-perf-mid">中消耗</span> <span class="ds-tooltip-icon" title="自动压缩并忽略 ST 偷偷加入的空白符、换行符、甚至全半角标点差异。只要核心文字没变，缓存就绝对不断。">?</span></b><span>(隐形排版与标点差异不破缓存)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-cot" ${Settings.cotIsolation ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-purple);">🧠 思维链隔离协议 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="专为 DeepSeek R1 设计！在比对历史记录时，自动忽略 <think> 标签内的所有内容差异。即使你微调了 AI 的思考过程，主体缓存依然 100% 命中！">?</span></b><span>(修改 AI 思考过程不破缓存)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-warp" ${Settings.warpDriveFilter ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-cyan);">🌌 曲率引擎过滤 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="自动过滤 ST 发送的纯空白或无意义符号消息，防止它们污染并切断缓存。">?</span></b><span>(空白消息不破缓存)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-dedup" ${Settings.absoluteDeduplication ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-cyan);">🗜️ 绝对去重协议 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="自动压缩 ST 发送的重复系统提示词或世界书，节省 Token 并稳定缓存。">?</span></b><span>(重复设定不破缓存)</span></div></label></div>
                    <div class="ds-sub-header"><i class="fa-solid fa-wrench"></i> [智能修补与时空] 历史修改与删除防御</div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-nanopatch" ${Settings.nanoPatching ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-green);">🔬 量子微创手术 <span class="ds-perf-badge ds-perf-mid">中消耗</span> <span class="ds-tooltip-icon" title="当你只修改了超大角色卡里的几个字，系统会提取差异做成纳米补丁，不重算整个卡。">?</span></b><span>(微小修改设定不破缓存)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-hotreload" ${Settings.hotReloadPersona ? 'checked' : ''}> <div class="ds-row-text"><b style="color:#ffb86c;">🔥 角色卡热更新 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当你大幅修改了主角色卡，系统会冻结旧卡，并在底部告诉AI「角色设定已更新」。">?</span></b><span>(大幅修改主设定不破缓存)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-void" ${Settings.voidBridging ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-purple);">🌉 虚空架桥协议 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当你在对话中间删除了某条系统设定或世界书，系统会自动生成微型补丁桥接上下文，保住尾部所有缓存！">?</span></b><span>(中间删除设定不破缓存)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-retcon" ${Settings.retconProtocol ? 'checked' : ''}> <div class="ds-row-text"><b style="color:#ff8c94;">🗑️ 吃书协议 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当你删除了旧对话，系统会保留它，并在底部告诉AI「刚才那件事被抹除了」。">?</span></b><span>(删除历史对话不破缓存)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-flashback" ${Settings.flashbackInsertion ? 'checked' : ''}> <div class="ds-row-text"><b style="color:#8be9fd;">⏪ 闪回插入协议 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当你在历史中间插入新对话，系统会把它抽到底部，告诉AI「这是闪回补充」。">?</span></b><span>(中间插话不破缓存)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-entropy" ${Settings.entropyShield ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-green);">🛡️ 熵减护盾协议 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当你只修改了历史记录中的一个错字或标点，系统会自动豁免并生成底部修正补丁，保住 100% 缓存。">?</span></b><span>(错字修改不破缓存)</span></div></label></div>
                    <div class="ds-row" style="flex-direction:column; align-items:flex-start; gap:8px; background:rgba(0,0,0,0.3); padding:12px; border-radius:8px; border: 1px solid rgba(255,255,255,0.05);"><span style="font-size:13px; color:var(--ds-yellow); font-weight:bold;">当我修改了以前的旧对话时，系统该怎么做？</span><select id="ds-cache-history-mode" class="ds-select-styled"><option value="1" ${Settings.historyEditMode===1?'selected':''}>🛡️ 方案 A：时空补丁 (强烈推荐！保住100%缓存，且AI知道你改了)</option><option value="2" ${Settings.historyEditMode===2?'selected':''}>🙈 方案 B：幻象隐藏 (保住100%缓存，但AI不知道你改了)</option><option value="0" ${Settings.historyEditMode===0?'selected':''}>💥 方案 C：真实修改 (极度不推荐！会破坏大量缓存，烧钱重算)</option></select><span style="font-size:11px; color:#abb2bf; margin-top:2px;">*选择「时空补丁」时，系统会保留旧对话，并在最底部偷偷塞一张纸条告诉AI你修改了什么。</span></div>
                    <div class="ds-sub-header"><i class="fa-solid fa-bolt"></i> [动态与变量控制] 浮动与随机内容防御</div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-timevar" ${Settings.timeVarNeutralizer ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-yellow);">⏱️ 时序变量中和器 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="自动识别系统提示词中的时间 (如 10:00) 或日期。如果只有时间改变了，系统会将其视为模糊命中并冻结旧节点，彻底免疫时间流逝造成的缓存断裂！">?</span></b><span>(时间变量改变不破缓存)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-vector" ${Settings.vectorQuarantine ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-purple);">🎯 向量隔离区 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="自动识别 RAG/向量数据库注入的随机记忆，并强制将它们关入最底部的隔离区，保住上方 99% 的主体缓存。">?</span></b><span>(随机记忆注入不破缓存)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-anchor" ${Settings.anchorStabilization ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-cyan);">⚓ 浮动锚点稳定协议 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="强制接管 ST 的 Author's Note 深度设定。无论它怎么浮动，系统都会将其绝对锁死在底部，防止破坏缓存。">?</span></b><span>(作者备注浮动不破缓存)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-summary" ${Settings.summaryAnchor ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-yellow);">📜 摘要沉底锚点 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="自动识别包含「总结、前情提要」的提示词，并强制将其沉底，防止动态总结破坏上方缓存。">?</span></b><span>(动态总结不破缓存)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-imprint" ${Settings.permanentMemoryImprint ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-yellow);">🖨️ 永久记忆烙印 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当世界书触发后，将其永久冻结在缓存中。即使 ST 移除了它，缓存也不会断裂。(会稍微增加 Token)">?</span></b><span>(世界书忽隐忽现不破缓存)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-multiverse" ${Settings.multiverseProtocol ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-purple);">🌌 平行宇宙协议 <span class="ds-perf-badge ds-perf-mid">中消耗</span> <span class="ds-tooltip-icon" title="当你切换分支或疯狂撤销时，系统会自动跳跃到最匹配的平行宇宙，保住最大缓存。">?</span></b><span>(分支/撤销不破缓存)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-chronos" ${Settings.chronosProtocol ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-cyan);">⏳ 克罗诺斯协议 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="自动识别「几个小时后、第二天」等时间跳跃旁白，将其转化为底部叙事补丁，防止切断中间缓存。">?</span></b><span>(时间跳跃旁白不破缓存)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-overflow" ${Settings.overflowCompression ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-green);">🗜️ 溢出记忆压缩 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当对话太长，最顶部的记忆被 ST 挤出上下文时，系统会自动在底部生成一个「早期记忆已归档」的微型补丁，完美衔接上下文并保住缓存。">?</span></b><span>(顶部记忆溢出不破缓存)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-amnesia" ${Settings.amnesiaProtocol ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-green);">🧠 失忆症协议 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当对话太长导致头部记忆大面积丢失时，强制保留它们，完美保护后续缓存。">?</span></b><span>(头部记忆大面积截断不破缓存)</span></div></label></div>
                </div></div>

                <div class="ds-opt-group"><div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')"><span><i class="fa-solid fa-stethoscope"></i> 3. 缓存杀手体检中心</span> <i class="fa-solid fa-chevron-down"></i></div><div class="ds-opt-content">
                    <p style="font-size:12px; color:#abb2bf; margin:0; line-height:1.5;">如果你的缓存命中率一直很低，可能是因为预设中包含了每次都会改变的变量（如时间、天气）。点击下方按钮进行体检。</p>
                    <button id="ds-btn-diagnostic" class="ds-btn ds-btn-blue" style="padding:12px; justify-content:center; border-radius:8px;"><i class="fa-solid fa-magnifying-glass"></i> 扫描当前对话的「缓存杀手」</button><hr style="border:0; border-top:1px dashed rgba(255,255,255,0.1); width:100%; margin:4px 0;">
                    <div class="ds-row" style="flex-direction:column; align-items:flex-start; gap:8px;"><span style="font-size:13px; color:#abb2bf;">当系统抓到「缓存杀手」时，自动处理方式：</span><select id="ds-cache-dynamic-mode" class="ds-select-styled"><option value="0" ${Settings.dynamicMode===0?'selected':''}>0: 首次弹窗询问我</option><option value="1" ${Settings.dynamicMode===1?'selected':''}>1: 写日记模式 (强烈推荐！100%缓存)</option><option value="2" ${Settings.dynamicMode===2?'selected':''}>2: 垫底模式 (99%缓存)</option><option value="3" ${Settings.dynamicMode===3?'selected':''}>3: 假装没看见 (100%缓存)</option><option value="4" ${Settings.dynamicMode===4?'selected':''}>4: 原位替换 (极度不推荐！烧钱)</option><option value="5" ${Settings.dynamicMode===5?'selected':''}>5: 直接删掉</option></select></div>
                </div></div>

                <div class="ds-opt-group"><div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')"><span><i class="fa-solid fa-bell"></i> 4. 弹窗与提醒设置</span> <i class="fa-solid fa-chevron-down"></i></div><div class="ds-opt-content">
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-toast-his" ${Settings.toastHistory ? 'checked' : ''}> <div class="ds-row-text"><b style="color:#abb2bf;">允许显示绝对真理协议的弹窗提示</b></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-toast-reset" ${Settings.showResetPrompt ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-red);">当发送可能导致大量缓存失效时，弹出全屏警告窗口</b></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-tailend" ${Settings.tailEndExemption ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-green);">👯 二重身协议 <span class="ds-tooltip-icon" title="如果只修改了最后一句对话，由于损失的 Token 极少，系统将自动放行，不再弹窗打扰。">?</span></b><span>(修改最后一句不弹窗)</span></div></label></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-auto-accept" ${Settings.autoAccept ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-yellow);">自动修复缓存断层</b><span>(遇到冲突时，不弹全屏警告，直接在后台默默修复并发送)</span></div></label></div>
                    <hr style="border:0; border-top:1px dashed rgba(255,255,255,0.1); width:100%; margin:4px 0;"><span style="font-size:12px; color:var(--ds-cyan); font-weight:bold;"><i class="fa-solid fa-sliders"></i> 细分协议弹窗独立控制矩阵：</span>
                    <div class="ds-toast-grid">${Object.keys(Settings.toastToggles).map(k => `<label><input type="checkbox" class="ds-toast-toggle" data-key="${k}" ${Settings.toastToggles[k] ? 'checked' : ''}> ${k}</label>`).join('')}</div>
                </div></div>
                
                <div class="ds-opt-group"><div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')"><span><i class="fa-solid fa-gears"></i> 5. 极客高级设置 (小白勿动)</span> <i class="fa-solid fa-chevron-down"></i></div><div class="ds-opt-content">
                    <div class="ds-row"><span style="font-size:13px; color:#abb2bf;" title="对比旧文本与新文本的严格程度">找茬严格度:</span><select id="ds-cache-tolerance" class="ds-select-styled" style="width:150px;"><option value="0" ${Settings.tolerance===0?'selected':''}>严格 (推荐)</option><option value="1" ${Settings.tolerance===1?'selected':''}>标准</option><option value="2" ${Settings.tolerance===2?'selected':''}>宽松</option></select></div>
                    <div class="ds-row"><span style="font-size:13px; color:#abb2bf;">日志详细度:</span><select id="ds-cache-loglevel" class="ds-select-styled" style="width:150px;"><option value="0" ${Settings.logLevel===0?'selected':''}>0: 关闭</option><option value="1" ${Settings.logLevel===1?'selected':''}>1: 基础</option><option value="2" ${Settings.logLevel===2?'selected':''}>2: 详细</option><option value="3" ${Settings.logLevel===3?'selected':''}>3: 极客模式</option><option value="4" ${Settings.logLevel===4?'selected':''}>4: 追踪模式 (Trace)</option></select></div>
                    <div class="ds-row"><span style="font-size:13px; color:#abb2bf;">历史存档保留上限:</span><input type="number" id="ds-cache-maxsize" class="ds-select-styled" value="${Settings.maxCacheSize}" min="5" max="100" style="width:150px; text-align:center;"></div>
                    <div class="ds-row"><span style="font-size:13px; color:#abb2bf;">📌 自动锁定保护阈值:</span><input type="number" id="ds-cache-autopin" class="ds-select-styled" value="${Settings.autoPinThreshold}" min="0" max="999" title="当某个对话的节点数超过此数字，将自动钉选保护它免被系统清理。填0关闭。" style="width:150px; text-align:center;"></div>
                    <div class="ds-row"><label class="ds-row-left"><input type="checkbox" id="ds-cache-autobackup" ${Settings.autoBackup ? 'checked' : ''}> <div class="ds-row-text"><b style="color:var(--ds-cyan);">每次启动时自动备份设置</b></div></label></div>
                    <div class="ds-row" style="margin-top:15px;"><button id="ds-btn-export" class="menu_button interactable" style="flex:1; padding:10px; font-size:12px; border-radius:6px; background:rgba(255,255,255,0.05);"><i class="fa-solid fa-download"></i> 备份设置</button><button id="ds-btn-import" class="menu_button interactable" style="flex:1; padding:10px; font-size:12px; border-radius:6px; background:rgba(255,255,255,0.05);"><i class="fa-solid fa-upload"></i> 恢复设置</button><input type="file" id="ds-file-import" style="display:none;" accept=".json"></div>
                </div></div>

                <div class="ds-opt-group"><div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')"><span><i class="fa-solid fa-database"></i> 6. 记忆矩阵与 Omni-Log <span id="ds-storage-badge" class="ds-badge">...</span></span> <i class="fa-solid fa-chevron-down"></i></div><div class="ds-opt-content">
                    <div style="font-size:11px; color:#abb2bf; margin-bottom:-5px; display:flex; justify-content:space-between;"><span id="ds-health-text">存储健康度: 计算中...</span><span>(上限约 5MB)</span></div><div class="ds-health-bar"><div id="ds-health-fill" class="ds-health-fill"></div></div>
                    <div id="ds-chat-list-container" class="ds-chat-container ds-scroll ds-gpu-accel"></div>
                    <div class="ds-row"><button id="ds-btn-deep-clean" class="menu_button" style="flex:1; font-size:12px; color:var(--ds-yellow); border:1px solid rgba(229,192,123,0.3); background:rgba(229,192,123,0.05); justify-content:center; padding:10px; border-radius:6px;" title="清理所有没被锁定，且超过30天没玩过的旧存档">🧹 深度清理垃圾</button><button id="ds-btn-purge-orphans" class="menu_button" style="flex:1; font-size:12px; color:var(--ds-purple); border:1px solid rgba(198,120,221,0.3); background:rgba(198,120,221,0.05); justify-content:center; padding:10px; border-radius:6px;" title="清除在 ST 中已被删除，但快取依然残留的幽灵存档，并重新索引矩阵">👻 矩阵碎片整理</button><button id="ds-cache-factory-reset" class="menu_button" style="flex:1; font-size:12px; color:var(--ds-red); border:1px solid rgba(224,108,117,0.3); background:rgba(224,108,117,0.05); justify-content:center; padding:10px; border-radius:6px;" title="删掉所有记录，一切重来">💀 格式化全部</button></div>
                    <div class="ds-row" style="margin-top:10px;"><select id="ds-vault-select" class="ds-select-styled" style="flex:2; font-size:11px; padding:6px;"><option value="">-- 选择多重宇宙备份 --</option></select><button id="ds-btn-restore-vault" class="menu_button" style="flex:1; font-size:11px; color:var(--ds-cyan); border:1px solid rgba(0,229,255,0.3); background:rgba(0,229,255,0.05); justify-content:center; padding:6px; border-radius:6px;" title="恢复选定的备份">⏪ 恢复备份</button></div>
                    <div class="ds-row" id="ds-btn-undo-action" style="display:none;"><button class="menu_button" style="flex:1; font-size:12px; color:var(--ds-cyan); border:1px solid rgba(0,229,255,0.3); background:rgba(0,229,255,0.05); justify-content:center; padding:10px; border-radius:6px;" title="恢复刚才被清理的存档">⏪ 撤销刚才的清理 (时光机)</button></div>
                    <hr style="border:0; border-top:1px dashed rgba(255,255,255,0.1); width:100%; margin:15px 0;">
                    <div class="ds-log-toolbar"><input type="text" id="ds-log-search" class="ds-input-styled" placeholder="🔍 搜索日志关键字..." style="margin-bottom: 8px;"><span class="ds-log-filter active" data-filter="all">全部</span><span class="ds-log-filter" data-filter="info">常规</span><span class="ds-log-filter" data-filter="warn">警告</span><span class="ds-log-filter" data-filter="debug">除错</span><span class="ds-log-filter" data-filter="error">报错</span><div style="flex:1;"></div><span id="ds-btn-pause-log" class="ds-mini-btn" title="暂停/恢复日志滚动" style="color:var(--ds-yellow); margin-right:12px; cursor:pointer; font-size:15px; transition:0.2s;"><i class="fa-solid fa-pause"></i></span><label style="color:#abb2bf; font-size:11px; display:flex; align-items:center; gap:4px; cursor:pointer; margin-right:10px;"><input type="checkbox" id="ds-log-autoscroll" ${Settings.autoScrollLog ? 'checked' : ''} style="margin:0;"> 自动滚动</label><span id="ds-btn-copy-payload" class="ds-mini-btn" title="复制最终发送给大模型的 API 阵列" style="color:var(--ds-green); margin-right:12px; cursor:pointer; font-size:15px; transition:0.2s;"><i class="fa-solid fa-clipboard-list"></i></span><span id="ds-btn-export-json" class="ds-mini-btn" title="导出 JSON 结构化日志" style="color:var(--ds-yellow); margin-right:12px; cursor:pointer; font-size:15px; transition:0.2s;"><i class="fa-solid fa-file-code"></i></span><span id="ds-btn-diagnostic-report" class="ds-mini-btn" title="生成诊断报告" style="color:var(--ds-purple); margin-right:12px; cursor:pointer; font-size:15px; transition:0.2s;"><i class="fa-solid fa-file-medical"></i></span><span id="ds-btn-copylog" class="ds-mini-btn" title="复制所有日志" style="color:var(--ds-cyan); margin-right:12px; cursor:pointer; font-size:15px; transition:0.2s;"><i class="fa-solid fa-copy"></i></span><span id="ds-btn-clearlog" class="ds-mini-btn" title="清空日志文字" style="color:var(--ds-red); cursor:pointer; font-size:15px; transition:0.2s;"><i class="fa-solid fa-trash"></i></span></div>
                    <div id="ds-cache-log-container" class="ds-log-terminal ds-scroll ds-gpu-accel ds-strict-contain"></div>
                </div></div>
            </div>
        </div>`;
        
        $('#extensions_settings').append(html);

        $('#ds-btn-omni-vision').on('click', showOmniVisionUI);
        $('#ds-btn-one-click').on('click', applyOneClickOptimize);
        
        const bindToggle = (id, key, parser = x => x) => $(id).on('change', function() { Settings[key] = parser($(this).val() ?? $(this).is(':checked')); safeSave(); });
        bindToggle('#ds-cache-enable', 'enabled'); bindToggle('#ds-cache-zen', 'zenMode'); bindToggle('#ds-toast-his', 'toastHistory'); bindToggle('#ds-toast-reset', 'showResetPrompt'); bindToggle('#ds-cache-auto-accept', 'autoAccept'); bindToggle('#ds-cache-hotkeys', 'hotkeysEnabled'); bindToggle('#ds-cache-tolerance', 'tolerance', parseInt); bindToggle('#ds-cache-loglevel', 'logLevel', parseInt); bindToggle('#ds-cache-maxsize', 'maxCacheSize', x => parseInt(x) || 30); bindToggle('#ds-cache-autopin', 'autoPinThreshold', x => parseInt(x) || 0); bindToggle('#ds-cache-history-mode', 'historyEditMode', parseInt); bindToggle('#ds-cache-lorebook-sink', 'lorebookSink'); bindToggle('#ds-cache-retcon', 'retconProtocol'); bindToggle('#ds-cache-hotreload', 'hotReloadPersona'); bindToggle('#ds-cache-flashback', 'flashbackInsertion'); bindToggle('#ds-cache-multiverse', 'multiverseProtocol'); bindToggle('#ds-cache-nanopatch', 'nanoPatching'); bindToggle('#ds-cache-gravity', 'gravityProtocol'); bindToggle('#ds-cache-summary', 'summaryAnchor'); bindToggle('#ds-cache-tailend', 'tailEndExemption'); bindToggle('#ds-cache-chronos', 'chronosProtocol'); bindToggle('#ds-cache-amnesia', 'amnesiaProtocol'); bindToggle('#ds-cache-anchor', 'anchorStabilization'); bindToggle('#ds-cache-imprint', 'permanentMemoryImprint'); bindToggle('#ds-cache-entropy', 'entropyShield'); bindToggle('#ds-cache-dedup', 'absoluteDeduplication'); bindToggle('#ds-cache-void', 'voidBridging'); bindToggle('#ds-cache-warp', 'warpDriveFilter'); bindToggle('#ds-cache-prefix', 'prefixAnchor'); bindToggle('#ds-cache-semantic', 'semanticNormalize'); bindToggle('#ds-cache-autobackup', 'autoBackup'); bindToggle('#ds-cache-matrix', 'absoluteOrderMatrix'); bindToggle('#ds-cache-vector', 'vectorQuarantine'); bindToggle('#ds-log-autoscroll', 'autoScrollLog'); bindToggle('#ds-cache-cot', 'cotIsolation'); bindToggle('#ds-cache-timevar', 'timeVarNeutralizer'); bindToggle('#ds-cache-overflow', 'overflowCompression');
        
        $('#ds-cache-enable, #ds-cache-zen').on('change', updateTopBarState);
        $('#ds-cache-maxsize').on('change', () => performGarbageCollection());
        $('#ds-cache-dynamic-mode').on('change', function () { Settings.dynamicMode = parseInt($(this).val()); $('.ds-omni-toggle[data-setting="dynamicMode"]').toggleClass('active', Settings.dynamicMode === 1); safeSave(); });
        $('.ds-toast-toggle').on('change', function() { Settings.toastToggles[$(this).data('key')] = $(this).is(':checked'); safeSave(); });

        $('#ds-btn-diagnostic').on('click', () => typeof toastr !== 'undefined' && toastr.info("此功能已集成于后台运算", "系统提示"));
        $('#ds-btn-diagnostic-report').on('click', generateDiagnosticReport); $('#ds-btn-export-json').on('click', exportLogsAsJSON); $('#ds-btn-copy-payload').on('click', copyApiPayload); $('#ds-btn-undo-action').on('click', () => restoreVaultBackup(0));
        $('#ds-btn-pause-log').on('click', function() { isLogPaused = !isLogPaused; $(this).html(isLogPaused ? '<i class="fa-solid fa-play"></i>' : '<i class="fa-solid fa-pause"></i>').css('color', isLogPaused ? 'var(--ds-green)' : 'var(--ds-yellow)'); typeof toastr !== 'undefined' && toastr.info(isLogPaused ? "日志已暂停滚动" : "日志已恢复滚动"); !isLogPaused && requestAnimationFrame(processLogQueue); });
        $('#ds-cache-factory-reset').on('click', () => { if (confirm("💀 危险操作：确定要删除所有的缓存存档吗？一切将从零开始！")) { createVaultBackup("格式化前备份"); Settings.chats = {}; Settings.pinnedChats = {}; safeSave(); renderChatsUI(); } });
        $('#ds-btn-deep-clean').on('click', () => { if(!confirm("🧹 这会删掉所有未被锁定，且【没有节点内容】或【超过30天没聊过】的旧缓存。确定执行吗？")) return; createVaultBackup("深度清理前备份"); performGarbageCollection(true); typeof toastr !== 'undefined' && toastr.success(`🧹 深度清理完毕！`); });
        $('#ds-btn-purge-orphans').on('click', () => { if(!confirm("👻 矩阵碎片整理：这会强制清除所有未被锁定的缓存，并重新索引记忆矩阵。确定执行吗？")) return; createVaultBackup("碎片整理前备份"); let count = 0; for (let k in Settings.chats) if (!Settings.pinnedChats[k]) { delete Settings.chats[k]; count++; } bigramCache.clear(); safeSave(); renderChatsUI(); typeof toastr !== 'undefined' && toastr.success(`👻 碎片整理完毕！共清除了 ${count} 个未锁定的缓存，并释放了内存池。`); });
        
        $('.ds-log-filter').on('click', function() { $('.ds-log-filter').removeClass('active'); $(this).addClass('active'); applyLogFilters(); });
        $('#ds-log-search').on('input', applyLogFilters); $('#ds-btn-clearlog').on('click', () => { $('#ds-cache-log-container').empty(); logQueue = []; });
        $('#ds-btn-copylog').on('click', () => navigator.clipboard.writeText(Array.from(document.querySelectorAll('#ds-cache-log-container .ds-log-line')).map(el => el.innerText).join('\n')).then(() => typeof toastr !== 'undefined' && toastr.success("📋 日志已复制到剪贴板！")));
        $('#ds-btn-export').on('click', () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(Settings, null, 2)], { type: "application/json" })); a.download = `DeepSeek_Cache_Backup_v52_${Date.now()}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); typeof toastr !== 'undefined' && toastr.success("💾 备份文件已导出！"); });
        $('#ds-btn-import').on('click', () => $('#ds-file-import').click());
        $('#ds-file-import').on('change', e => { const f = e.target.files[0]; if(!f) return; const r = new FileReader(); r.onload = ev => { try { Object.assign(Settings, JSON.parse(ev.target.result)); safeSave(); renderChatsUI(); updateTopBarState(); alert("✅ 恢复成功！"); } catch (err) { alert("❌ 文件格式错误"); } e.target.value = ''; }; r.readAsText(f); });

        const updateVaultSelect = () => { const select = $('#ds-vault-select').empty().append('<option value="">-- 选择多重宇宙备份 --</option>'); backupVault.forEach((v, i) => select.append(`<option value="${i}">[${v.label}] ${v.time}</option>`)); }; updateVaultSelect();
        $('#ds-btn-restore-vault').on('click', () => { const val = $('#ds-vault-select').val(); if (val !== "") restoreVaultBackup(parseInt(val)); });

        const observer = new IntersectionObserver(entries => entries.forEach(entry => { isLogVisible = entry.isIntersecting; if (isLogVisible && logQueue.length && !isLogRendering && !isLogPaused) { isLogRendering = true; requestAnimationFrame(processLogQueue); } }), { threshold: 0.1 });
        const logContainer = document.getElementById('ds-cache-log-container'); if (logContainer) observer.observe(logContainer);

        renderChatsUI();
    } catch (e) { console.error('[DS Cache] UI初始化崩潰', e); }
}

jQuery(async () => {
    try {
        initSettings(); await setupUI(); setupGlobalHotkeys(); 
        setTimeout(ensureTopMenuButton, 2000); addResetMenuEntry(); 
        if (eventSource) {
            eventSource.on(event_types.CHAT_CHANGED, () => { ensureTopMenuButton(); renderChatsUI(); sessionSnoozeReset = false; });
            if (event_types?.CHAT_COMPLETION_PROMPT_READY) eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
            if (event_types?.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, () => QuantumToastAggregator.add('his_del', '您删除了历史对话，已标记断层！下次发送将原位修补。', 'warning', '🗑️'));
            if (event_types?.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, () => QuantumToastAggregator.add('his_edit', '您修改了历史对话，已标记断层！下次发送将原位修补。', 'warning', '✏️'));
        }
        Logger.log('══════ 🚀 DeepSeek 绝对真理优化器 v52 引擎上线 ══════', LogLevels.BASIC);
    } catch (e) { console.error('[DS Cache] 插件启动失败:', e); }
});
