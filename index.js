import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

// ==========================================
// 1. 樣式注入 (Ultimate Truth UI)
// ==========================================
const injectCSS = () => {
    if (document.getElementById('ds-cache-styles')) return;
    const style = document.createElement('style');
    style.id = 'ds-cache-styles';
    style.innerHTML = `
        :root { --ds-cyan: #00e5ff; --ds-purple: #c678dd; --ds-green: #98c379; --ds-red: #e06c75; --ds-yellow: #e5c07b; --ds-orange: #d19a66; --ds-blue: #61afef; --ds-bg: rgba(15, 20, 25, 0.75); --ds-border: rgba(0, 229, 255, 0.25); }
        
        .ds-gpu-accel { transform: translateZ(0); will-change: transform; backface-visibility: hidden; perspective: 1000px; }
        .ds-strict-contain { contain: strict; }
        
        .ds-scroll::-webkit-scrollbar { width: 6px; }
        .ds-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.4); border-radius: 4px; }
        .ds-scroll::-webkit-scrollbar-thumb { background: rgba(0, 229, 255, 0.5); border-radius: 4px; }
        .ds-scroll::-webkit-scrollbar-thumb:hover { background: rgba(0, 229, 255, 0.9); box-shadow: 0 0 12px var(--ds-cyan); }

        .ds-opt-group { margin-bottom: 16px; border: 1px solid var(--ds-border); border-radius: 12px; background: var(--ds-bg); backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px); overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.4); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .ds-opt-group:hover { border-color: rgba(0, 229, 255, 0.5); box-shadow: 0 8px 30px rgba(0, 229, 255, 0.15); }
        .ds-opt-header { padding: 16px 20px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: var(--ds-cyan); background: linear-gradient(90deg, rgba(0,229,255,0.1) 0%, rgba(0,0,0,0) 100%); transition: 0.2s; font-size: 14px; text-shadow: 0 0 12px rgba(0,229,255,0.4); letter-spacing: 0.5px; }
        .ds-opt-header:hover { background: linear-gradient(90deg, rgba(0,229,255,0.2) 0%, rgba(0,0,0,0) 100%); color: #fff; }
        .ds-opt-content { padding: 20px; display: flex; flex-direction: column; gap: 16px; display: none; background: rgba(0,0,0,0.3); border-top: 1px solid rgba(255,255,255,0.05); }
        .ds-opt-group.open .ds-opt-content { display: flex; animation: dsFadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .ds-opt-group.open .ds-opt-header i.fa-chevron-down { transform: rotate(180deg); }

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

        .ds-select-styled { background: rgba(0,0,0,0.6); color: var(--ds-cyan); border: 1px solid var(--ds-border); padding: 10px 14px; border-radius: 8px; font-weight: bold; cursor: pointer; outline: none; transition: all 0.2s; font-family: inherit; width: 100%; box-sizing: border-box; }
        .ds-select-styled:hover, .ds-select-styled:focus { border-color: var(--ds-cyan); box-shadow: 0 0 12px rgba(0,229,255,0.3); }
        .ds-select-styled option { background: #1e1e24; color: #fff; }
        
        .ds-input-styled { background: rgba(0,0,0,0.6); color: #fff; border: 1px solid rgba(255,255,255,0.2); padding: 8px 12px; border-radius: 8px; font-size: 12px; outline: none; transition: all 0.2s; width: 100%; box-sizing: border-box; }
        .ds-input-styled:focus { border-color: var(--ds-cyan); box-shadow: 0 0 10px rgba(0,229,255,0.3); }

        .ds-log-toolbar { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; background: rgba(0,0,0,0.5); padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.1); flex-wrap: wrap; }
        .ds-log-filter { cursor: pointer; padding: 6px 14px; border-radius: 14px; font-size: 11px; background: rgba(255,255,255,0.05); color: #abb2bf; transition: all 0.2s; font-weight: 600; white-space: nowrap; border: 1px solid transparent; }
        .ds-log-filter.active { background: rgba(0,229,255,0.15); color: var(--ds-cyan); border-color: rgba(0,229,255,0.4); box-shadow: 0 0 12px rgba(0,229,255,0.2); }
        .ds-log-filter:hover:not(.active) { background: rgba(255,255,255,0.15); color: #fff; }
        .ds-log-terminal { background: #0a0c10; color: #a9b7c6; font-family: 'Fira Code', Consolas, monospace; font-size: 12px; height: 350px; overflow-y: auto; border-radius: 10px; padding: 18px; border: 1px solid rgba(0,229,255,0.3); box-shadow: inset 0 0 25px rgba(0,0,0,0.9); line-height: 1.7; position: relative; }
        .ds-log-line { margin-bottom: 8px; word-wrap: break-word; border-bottom: 1px dashed rgba(255,255,255,0.08); padding-bottom: 8px; display: flex; align-items: flex-start; }
        .ds-log-line.hide { display: none !important; }
        .ds-log-time { color: #5c6370; margin-right: 12px; user-select: none; font-size: 10px; flex-shrink: 0; margin-top: 3px; }
        .ds-log-content { flex: 1; min-width: 0; }
        .ds-log-info { color: var(--ds-green); }
        .ds-log-warn { color: var(--ds-yellow); font-weight: bold; }
        .ds-log-error { color: var(--ds-red); font-weight: bold; text-shadow: 0 0 8px rgba(224,108,117,0.6); }
        .ds-log-map { color: var(--ds-cyan); font-weight: bold; }
        .ds-log-debug { color: var(--ds-purple); }
        .ds-log-divider { color: #4b5263; font-weight: bold; display: block; text-align: center; margin: 18px 0; border-top: 1px solid #2c313a; padding-top: 10px; letter-spacing: 1.5px; width: 100%; }
        
        .ds-tag { display: inline-block; padding: 3px 10px; border-radius: 6px; font-size: 10px; font-weight: bold; background: rgba(255,255,255,0.08); margin-right: 8px; letter-spacing: 0.5px; }
        .ds-tag-SYS { color: #61afef; border-left: 3px solid #61afef; background: rgba(97,175,239,0.15); }
        .ds-tag-USER { color: var(--ds-green); border-left: 3px solid var(--ds-green); background: rgba(152,195,121,0.15); }
        .ds-tag-AI { color: var(--ds-yellow); border-left: 3px solid var(--ds-yellow); background: rgba(229,192,123,0.15); }
        .ds-tag-PREFILL { color: var(--ds-purple); border-left: 3px solid var(--ds-purple); background: rgba(198,120,221,0.15); }
        .ds-badge { background: rgba(0,229,255,0.15); padding: 4px 10px; border-radius: 6px; font-size: 0.8em; font-family: monospace; color: var(--ds-cyan); border: 1px solid rgba(0,229,255,0.4); box-shadow: 0 0 8px rgba(0,229,255,0.3); }

        .ds-chat-container { max-height:300px; overflow-y:auto; border:1px solid rgba(255,255,255,0.1); padding:12px; border-radius:10px; background: rgba(0,0,0,0.5); }
        .ds-chat-item { display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.04); padding:14px; margin-bottom:12px; border-radius:10px; border:1px solid rgba(255,255,255,0.08); transition: all 0.2s; }
        .ds-chat-item:hover { background:rgba(255,255,255,0.1); transform: translateX(5px); border-color: rgba(255,255,255,0.2); }
        .ds-chat-item.active-chat { background: linear-gradient(90deg, rgba(0,229,255,0.15) 0%, rgba(0,0,0,0) 100%); border-left: 4px solid var(--ds-cyan); border-top: 1px solid var(--ds-border); border-bottom: 1px solid var(--ds-border); border-right: 1px solid var(--ds-border); box-shadow: inset 0 0 20px rgba(0,229,255,0.15); }
        
        .ds-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.92); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); z-index: 999999; display: flex; align-items: center; justify-content: center; animation: dsFadeIn 0.2s ease-out; cursor: pointer; }
        .ds-modal { background: linear-gradient(180deg, #1e1e24 0%, #15151a 100%); border: 1px solid var(--ds-cyan); padding: 30px; border-radius: 20px; max-width: 800px; width: 90%; max-height: 90vh; overflow-y: auto; color: #fff; font-family: sans-serif; box-shadow: 0 40px 80px rgba(0,0,0,0.95), 0 0 40px rgba(0,229,255,0.25); position: relative; animation: dsSlideUp 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); cursor: default; }
        .ds-modal-title { color: var(--ds-cyan); margin: 0 0 20px 0; display: flex; align-items: center; gap: 14px; font-size: 24px; font-weight: 800; letter-spacing: 1px; text-shadow: 0 2px 8px rgba(0,229,255,0.5); flex-wrap: wrap; }
        
        .ds-btn-col { display: flex; flex-direction: column; gap: 16px; margin-top: 35px; }
        .ds-btn { padding: 18px 24px; border: 1px solid transparent; border-radius: 12px; cursor: pointer; font-weight: bold; font-size: 15px; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); position: relative; overflow: hidden; display:flex; align-items:center; justify-content:flex-start; gap:16px; text-align:left; line-height: 1.5; background: rgba(255,255,255,0.08); color: #fff; }
        .ds-btn:hover { transform: translateY(-3px); box-shadow: 0 10px 25px rgba(0,0,0,0.6); border-color: rgba(255,255,255,0.25); background: rgba(255,255,255,0.15); }
        .ds-btn:active { transform: translateY(0); }
        .ds-btn i { font-size: 20px; width: 26px; text-align: center; flex-shrink: 0; }
        
        .ds-btn-accept { border-color: rgba(152,195,121,0.6); background: linear-gradient(90deg, rgba(152,195,121,0.25) 0%, rgba(0,0,0,0) 100%); }
        .ds-btn-accept:hover { border-color: var(--ds-green); box-shadow: 0 0 20px rgba(152,195,121,0.5); }
        .ds-btn-accept i { color: var(--ds-green); }
        
        .ds-btn-revert { border-color: rgba(198,120,221,0.6); background: linear-gradient(90deg, rgba(198,120,221,0.25) 0%, rgba(0,0,0,0) 100%); }
        .ds-btn-revert:hover { border-color: var(--ds-purple); box-shadow: 0 0 20px rgba(198,120,221,0.5); }
        .ds-btn-revert i { color: var(--ds-purple); }
        
        .ds-btn-abort { border-color: rgba(224,108,117,0.6); background: linear-gradient(90deg, rgba(224,108,117,0.25) 0%, rgba(0,0,0,0) 100%); }
        .ds-btn-abort:hover { border-color: var(--ds-red); box-shadow: 0 0 20px rgba(224,108,117,0.5); }
        .ds-btn-abort i { color: var(--ds-red); }
        
        .ds-btn-blue { border-color: rgba(0,229,255,0.6); background: linear-gradient(90deg, rgba(0,229,255,0.25) 0%, rgba(0,0,0,0) 100%); }
        .ds-btn-blue:hover { border-color: var(--ds-cyan); box-shadow: 0 0 20px rgba(0,229,255,0.5); }
        .ds-btn-blue i { color: var(--ds-cyan); }

        .ds-btn-reset { border-color: rgba(224,108,117,0.4); background: rgba(224,108,117,0.1); }
        .ds-btn-reset:hover { border-color: var(--ds-red); background: rgba(224,108,117,0.25); }
        .ds-btn-reset i { color: var(--ds-red); }

        .ds-btn-magic { border-color: rgba(229,192,123,0.6); background: linear-gradient(90deg, rgba(229,192,123,0.25) 0%, rgba(0,0,0,0) 100%); color: var(--ds-yellow); margin-bottom: 16px; width: 100%; justify-content: center; font-size: 16px; letter-spacing: 1px; }
        .ds-btn-magic:hover { border-color: var(--ds-yellow); box-shadow: 0 0 25px rgba(229,192,123,0.6); background: linear-gradient(90deg, rgba(229,192,123,0.35) 0%, rgba(0,0,0,0) 100%); color: #fff; }

        .ds-btn-omni { border-color: rgba(198,120,221,0.6); background: linear-gradient(90deg, rgba(198,120,221,0.25) 0%, rgba(0,0,0,0) 100%); color: var(--ds-purple); margin-bottom: 16px; width: 100%; justify-content: center; font-size: 16px; letter-spacing: 1px; }
        .ds-btn-omni:hover { border-color: var(--ds-purple); box-shadow: 0 0 25px rgba(198,120,221,0.6); background: linear-gradient(90deg, rgba(198,120,221,0.35) 0%, rgba(0,0,0,0) 100%); color: #fff; }

        .ds-health-bar { height: 6px; background: rgba(255,255,255,0.15); border-radius: 3px; margin-top: 6px; overflow: hidden; box-shadow: inset 0 1px 4px rgba(0,0,0,0.6); }
        .ds-health-fill { height: 100%; background: var(--ds-green); transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1), background 0.4s; }

        /* ==========================================
           Omni-Vision v53 Ultimate Truth Styles
           ========================================== */
        .ds-omni-modal { max-width: 98vw !important; width: 1800px !important; height: 95vh !important; display: flex; flex-direction: column; padding: 25px !important; overflow: hidden; }
        
        /* 控制台區域 */
        .ds-omni-control-panel { background: rgba(0,0,0,0.7); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; margin-bottom: 15px; flex-shrink: 0; box-shadow: inset 0 0 25px rgba(0,0,0,0.6); transition: max-height 0.3s ease; overflow: hidden; }
        .ds-omni-control-header { padding: 12px 18px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; background: rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.08); }
        .ds-omni-control-header:hover { background: rgba(255,255,255,0.08); }
        .ds-omni-control-body { padding: 15px 18px; display: flex; flex-direction: column; gap: 15px; }
        .ds-omni-control-panel.collapsed .ds-omni-control-body { display: none; }
        .ds-omni-control-panel.collapsed .ds-omni-control-header i.fa-chevron-up { transform: rotate(180deg); }

        .ds-omni-actions-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        .ds-omni-action-btn { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #abb2bf; padding: 8px 16px; border-radius: 8px; font-size: 12px; cursor: pointer; transition: 0.2s; display: flex; align-items: center; gap: 8px; font-weight: bold; }
        .ds-omni-action-btn:hover { background: rgba(255,255,255,0.2); color: #fff; border-color: rgba(255,255,255,0.4); }
        .ds-omni-action-btn.active { background: rgba(0,229,255,0.2); color: var(--ds-cyan); border-color: rgba(0,229,255,0.5); box-shadow: 0 0 12px rgba(0,229,255,0.3); }
        
        .ds-omni-toggles-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; max-height: 150px; overflow-y: auto; padding-right: 5px; }
        .ds-omni-toggle { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #abb2bf; cursor: pointer; background: rgba(255,255,255,0.08); padding: 6px 10px; border-radius: 6px; transition: 0.2s; border: 1px solid transparent; user-select: none; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ds-omni-toggle:hover { background: rgba(255,255,255,0.15); color: #fff; }
        .ds-omni-toggle.active { background: rgba(0,229,255,0.2); color: var(--ds-cyan); border-color: rgba(0,229,255,0.5); box-shadow: 0 0 12px rgba(0,229,255,0.3); }

        /* 圖例區域 (Legend) */
        .ds-omni-legend { display: flex; flex-wrap: wrap; gap: 10px; padding: 10px 15px; background: rgba(0,0,0,0.4); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); font-size: 11px; color: #abb2bf; margin-bottom: 10px; }
        .ds-legend-item { display: flex; align-items: center; gap: 6px; }
        .ds-legend-color { width: 12px; height: 12px; border-radius: 3px; }

        /* 矩陣視窗區域 (Quantum Matrix Layout) */
        .ds-omni-matrix-container { display: flex; flex: 1; min-height: 0; position: relative; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; overflow: hidden; box-shadow: inset 0 0 35px rgba(0,0,0,0.9); }
        
        .ds-omni-pane { flex: 1; display: flex; flex-direction: column; position: relative; z-index: 2; width: 45%; }
        .ds-omni-pane-header { padding: 12px 20px; background: rgba(255,255,255,0.08); border-bottom: 1px solid rgba(255,255,255,0.15); display: flex; justify-content: space-between; align-items: center; font-weight: bold; flex-shrink: 0; font-size: 14px; }
        .ds-omni-pane-content { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 15px; position: relative; scroll-behavior: auto; will-change: scroll-position; }
        
        /* 畫布橋樑 (Canvas Bridge) */
        .ds-omni-bridge { position: absolute; top: 0; left: 45%; width: 10%; height: 100%; z-index: 1; pointer-events: none; overflow: hidden; }
        #omni-svg-canvas { width: 100%; height: 100%; position: absolute; top: 0; left: 0; overflow: visible; }
        #omni-svg-canvas path { will-change: d; transition: stroke 0.3s; }

        /* 卡片樣式 */
        .ds-node-card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 14px; font-family: 'Fira Code', monospace; font-size: 12px; color: #abb2bf; word-wrap: break-word; position: relative; transition: 0.2s; width: 100%; box-sizing: border-box; }
        .ds-node-card:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.35); z-index: 10; box-shadow: 0 0 25px rgba(0,0,0,0.7); transform: translateY(-2px); }
        
        /* 9 維度色彩定義 */
        .ds-node-frozen { border-left: 5px solid var(--ds-green); background: linear-gradient(90deg, rgba(152,195,121,0.1) 0%, rgba(0,0,0,0) 100%); }
        .ds-node-deleted { border-left: 5px solid var(--ds-red); background: linear-gradient(90deg, rgba(224,108,117,0.1) 0%, rgba(0,0,0,0) 100%); opacity: 0.6; }
        .ds-node-fuzzy { border-left: 5px solid var(--ds-yellow); background: linear-gradient(90deg, rgba(229,192,123,0.1) 0%, rgba(0,0,0,0) 100%); }
        .ds-node-new-sys { border-left: 5px solid var(--ds-blue); background: linear-gradient(90deg, rgba(97,175,239,0.1) 0%, rgba(0,0,0,0) 100%); }
        .ds-node-new-lore { border-left: 5px solid var(--ds-cyan); background: linear-gradient(90deg, rgba(0,229,255,0.1) 0%, rgba(0,0,0,0) 100%); }
        .ds-node-new-dyn { border-left: 5px solid var(--ds-orange); background: linear-gradient(90deg, rgba(209,154,102,0.1) 0%, rgba(0,0,0,0) 100%); }
        .ds-node-new-his { border-left: 5px solid var(--ds-green); background: linear-gradient(90deg, rgba(152,195,121,0.1) 0%, rgba(0,0,0,0) 100%); }
        .ds-node-patch { border-left: 5px solid var(--ds-purple); background: linear-gradient(90deg, rgba(198,120,221,0.1) 0%, rgba(0,0,0,0) 100%); }
        
        .ds-node-header { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 11px; color: #8b92a5; border-bottom: 1px dashed rgba(255,255,255,0.2); padding-bottom: 6px; }
        
        .ds-node-content-wrapper { position: relative; }
        .ds-node-content { line-height: 1.6; }
        .ds-node-content.collapsed { max-height: 70px; overflow: hidden; mask-image: linear-gradient(to bottom, black 40%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, black 40%, transparent 100%); }
        .ds-node-expand-btn { text-align: center; font-size: 11px; color: var(--ds-cyan); cursor: pointer; margin-top: 6px; padding: 6px; background: rgba(0,229,255,0.1); border-radius: 6px; transition: 0.2s; border: 1px solid rgba(0,229,255,0.25); font-weight: bold; }
        .ds-node-expand-btn:hover { background: rgba(0,229,255,0.25); border-color: rgba(0,229,255,0.5); box-shadow: 0 0 12px rgba(0,229,255,0.3); }

        @keyframes dsFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes dsSlideUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes dsShimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
    `;
    document.head.appendChild(style);
};

// ==========================================
// 2. 狀態設定與磁碟 I/O 降載 (Quantum Storage)
// ==========================================
let Settings = {};
let sessionSnoozeReset = false; 
let backupVault = []; 
let cachedStorageBytes = 0; 

function fastClone(obj) {
    if (typeof structuredClone === 'function') {
        try { return structuredClone(obj); } catch(e) {}
    }
    return JSON.parse(JSON.stringify(obj));
}

function initSettings() {
    const oldSettings = extension_settings.ds_cache_v52 || extension_settings.ds_cache_v51 || {};
    if (!extension_settings.ds_cache_v53) {
        extension_settings.ds_cache_v53 = {
            enabled: oldSettings.enabled ?? true,
            zenMode: oldSettings.zenMode ?? false,
            toastHistory: oldSettings.toastHistory ?? true,
            showResetPrompt: oldSettings.showResetPrompt ?? true,
            autoAccept: oldSettings.autoAccept ?? false,
            logLevel: oldSettings.logLevel ?? 2,
            tolerance: oldSettings.tolerance ?? 1,
            maxCacheSize: oldSettings.maxCacheSize ?? 30,
            hotkeysEnabled: oldSettings.hotkeysEnabled ?? true,
            autoPinThreshold: oldSettings.autoPinThreshold ?? 0,
            dynamicMode: oldSettings.dynamicMode ?? 1, 
            historyEditMode: oldSettings.historyEditMode ?? 1, 
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
            chats: oldSettings.chats || {},
            pinnedChats: oldSettings.pinnedChats || {} 
        };
    }
    Settings = extension_settings.ds_cache_v53;
    if (!Settings.pinnedChats) Settings.pinnedChats = {};
    if (!Settings.chats) Settings.chats = {}; 
    
    if (Settings.autoBackup) {
        try {
            const vaultStr = localStorage.getItem('ds_cache_v53_vault');
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
            const dataStr = JSON.stringify(Settings);
            cachedStorageBytes = dataStr.length * 2; 
            localStorage.setItem('ds_cache_v53_snapshot', dataStr);
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
    localStorage.setItem('ds_cache_v53_vault', JSON.stringify(backupVault));
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

// ==========================================
// 2.5 量子態彈窗聚合引擎 (ToastManager)
// ==========================================
const ToastManager = {
    queue: {},
    timer: null,
    trigger: function(key, msg, type = 'info', icon = '💡') {
        if (!Settings.enabled || !Settings.toastHistory || Settings.zenMode) return;
        
        if (!this.queue[key]) {
            this.queue[key] = { count: 1, msg: msg, type: type, icon: icon };
        } else {
            this.queue[key].count++;
        }

        if (!this.timer) {
            this.timer = setTimeout(() => this.flush(), 800);
        }
    },
    flush: function() {
        if (typeof toastr === 'undefined') {
            this.queue = {}; this.timer = null; return;
        }

        const keys = Object.keys(this.queue);
        if (keys.length === 0) return;

        if (keys.length === 1) {
            const item = this.queue[keys[0]];
            const text = item.count > 1 ? `${item.icon} ${item.msg} (x${item.count})` : `${item.icon} ${item.msg}`;
            if (item.type === 'success') toastr.success(text, '终极真理协议');
            else if (item.type === 'warning') toastr.warning(text, '终极真理协议');
            else toastr.info(text, '终极真理协议');
        } else {
            // 聚合多個彈窗
            let summary = [];
            for (let k of keys) {
                const item = this.queue[k];
                summary.push(`${item.icon} ${item.msg.split('：')[0]} (x${item.count})`);
            }
            toastr.success(`⚡ 矩阵协议批量触发:<br>${summary.join('<br>')}`, '终极真理协议');
        }

        this.queue = {};
        this.timer = null;
    }
};

function triggerToast(key, msg, type = 'info', icon = '💡') {
    ToastManager.trigger(key, msg, type, icon);
}

function escapeHtml(text) { return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function stripHtml(html) { return html ? html.replace(/<[^>]+>/g, '') : ''; }
function truncateLog(str, len = 50) {
    if (!str) return '∅';
    const s = String(str).replace(/\n/g, ' ↵ ');
    return s.length > len ? s.substring(0, len) + '...' : s;
}

function getStorageSize() {
    if (cachedStorageBytes === 0) {
        cachedStorageBytes = JSON.stringify(Settings).length * 2;
    }
    return cachedStorageBytes;
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
        $('#ds-top-reset-btn').attr('title', '终极真理缓存: 已停用 (大模型每次都会重读所有内容)');
        dot.html('<i class="fa-solid fa-circle"></i>');
    } else if (Settings.zenMode) {
        dot.css('color', '#c678dd');
        $('#ds-top-reset-btn').attr('title', '终极真理缓存: 运作中 [沉浸免打扰模式]');
        dot.html('<i class="fa-solid fa-yin-yang ds-zen-icon"></i>');
    } else {
        dot.css('color', '#00e5ff');
        $('#ds-top-reset-btn').attr('title', '终极真理缓存: 运作中 (正在为您省钱省算力)');
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
    else if (type === 'divider') console.log(`%c${msg}`, 'color: #4b5263; font-weight: bold;');
    else console.log(`%c[真理日志] ✅ ${msg}`, 'color: #98c379;');
    
    logQueue.push({ time, type, msg });
    if (logQueue.length > 500) logQueue.shift();

    if (!isLogRendering && !isLogPaused && isLogVisible) {
        isLogRendering = true;
        requestAnimationFrame(processLogQueue);
    }
}

const Logger = {
    log: (msg, level = LogLevels.DETAILED) => logAt(level, 'info', msg),
    warn: (msg, level = LogLevels.BASIC) => logAt(level, 'warn', msg),
    map: (msg, level = LogLevels.BASIC) => logAt(level, 'map', msg),
    error: (msg, err, level = LogLevels.BASIC) => {
        logAt(level, 'error', err ? `${msg} ${err}` : msg);
        if (err && Settings.logLevel >= LogLevels.DEBUG) {
            console.error("Crash Dump Triggered:", err);
            localStorage.setItem('ds_cache_crash_dump', JSON.stringify({ error: err.toString(), stack: err.stack, time: new Date().toISOString() }));
        }
    },
    debug: (msg) => logAt(LogLevels.DEBUG, 'debug', msg),
    trace: (msg) => logAt(LogLevels.TRACE, 'debug', msg),
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
            <li id="ds-top-reset-btn" class="menu_button interactable" title="DeepSeek 终极真理缓存优化器">
                <span class="fa-solid fa-microchip"></span>
                <span id="ds-top-status-dot" style="font-size:0.7em; margin-left:2px; vertical-align:top;"></span>
            </li>
        `);
        btn.on('click', (e) => {
            e.preventDefault();
            Settings.enabled = !Settings.enabled;
            $('#ds-cache-enable').prop('checked', Settings.enabled);
            safeSave(); updateTopBarState();
            if (!Settings.zenMode && typeof toastr !== 'undefined') toastr.info(Settings.enabled ? "🚀 终极真理缓存已启动！" : "💤 终极真理缓存已关闭。", "DeepSeek");
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
        omniBtn.title = '打开 Omni-Vision 全视之眼沙盒，即时预览并调整缓存命中率';
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
                if (!Settings.zenMode && typeof toastr !== 'undefined') toastr.info(Settings.enabled ? "🚀 终极真理已启动" : "💤 终极真理已关闭", "快捷键");
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
// 5. 核心邏輯工具與 Diff 演算法
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

class LRUCache {
    constructor(maxSize) { this.cache = new Map(); this.maxSize = maxSize; }
    get(key) {
        if (!this.cache.has(key)) return null;
        const val = this.cache.get(key);
        this.cache.delete(key); this.cache.set(key, val); 
        return val;
    }
    set(key, value) {
        if (this.cache.has(key)) this.cache.delete(key);
        else if (this.cache.size >= this.maxSize) this.cache.delete(this.cache.keys().next().value); 
        this.cache.set(key, value);
    }
    clear() { this.cache.clear(); }
}

const bigramCache = new LRUCache(2000);

function getBigrams(str) {
    const cached = bigramCache.get(str);
    if (cached) return cached;
    const bigrams = new Set();
    for (let i = 0; i < str.length - 1; i++) bigrams.add(str.substring(i, i+2));
    bigramCache.set(str, bigrams);
    return bigrams;
}

function createMsg(msg, tag) {
    const content = msg.content || '';
    const norm = Logger.normalize(content);
    const fuzzy = Logger.fuzzyNormalize(content);
    return { 
        role: msg.role, 
        content: content, 
        norm: norm, 
        hash: cyrb53(norm), 
        fuzzyHash: cyrb53(fuzzy), 
        len: content.length, 
        tag: tag,
        _omniCat: '' 
    };
}

function getSimilarity(msg1, msg2) {
    if (msg1.hash === msg2.hash) return 1;
    if (msg1.fuzzyHash === msg2.fuzzyHash) return 0.99; 
    
    const str1 = msg1.norm; const str2 = msg2.norm;
    if (Math.abs(str1.length - str2.length) > Math.max(str1.length, str2.length) * 0.5) return 0;
    
    const clean1 = stripHtml(str1); const clean2 = stripHtml(str2);
    if (clean1 === clean2) return 1;
    
    const s1 = clean1.length < clean2.length ? clean1 : clean2;
    const s2 = clean1.length < clean2.length ? clean2 : clean1;
    if (s1.length === 0) return 0;
    if (s2.includes(s1) && s1.length > 10) return 0.95;

    const bigrams1 = getBigrams(s1);
    let matchCount = 0;
    for (let i = 0; i < s2.length - 1; i++) { if (bigrams1.has(s2.substring(i, i+2))) matchCount++; }
    const union = (s1.length - 1) + (s2.length - 1) - matchCount;
    return union <= 0 ? 1 : matchCount / union;
}

function extractAddedText(oldStr, newStr) {
    const cleanOld = stripHtml(oldStr); const cleanNew = stripHtml(newStr);
    if (cleanNew.length < cleanOld.length) return null; 
    if (cleanNew.length - cleanOld.length > 300) return null; 
    
    const oldSentences = cleanOld.split(/([。！？.!?\n]+)/);
    const newSentences = cleanNew.split(/([。！？.!?\n]+)/);
    const oldSet = new Set(oldSentences.map(s => s.trim()).filter(s => s.length > 2));
    let added = [];
    for (let s of newSentences) {
        let t = s.trim();
        if (t.length > 2 && !oldSet.has(t)) added.push(t);
    }
    return added.length > 0 ? added.join(' ') : null;
}

function stripPrefillFromAssistant(assistantObj, prefills) {
    if (!assistantObj || !prefills || prefills.length === 0) return assistantObj;
    let content = assistantObj.content || '';
    let modified = false;
    for (const p of prefills) {
        const pContent = p.content || '';
        const trimmedContent = content.trimStart();
        const trimmedPContent = pContent.trimStart();
        if (trimmedContent.startsWith(trimmedPContent)) { 
            content = trimmedContent.substring(trimmedPContent.length); 
            modified = true; 
        }
    }
    if (modified) {
        content = content.replace(/^[\s\n]+/, ''); 
        return createMsg({role: assistantObj.role, content: content}, assistantObj.tag);
    }
    return assistantObj;
}

// ==========================================
// 7. 🧊 絕對領域排序法則 (Absolute Truth Interceptor)
// ==========================================
async function interceptAndRestructurePrompt(data, isDryRun = false) {
    if (!Settings.enabled && !isDryRun) return;
    const startTime = performance.now();
    const chatKeyInfo = getChatKey();

    try {
        let state = getChatState(chatKeyInfo);
        if (isDryRun) {
            state = fastClone(state); 
        }

        if (!data?.chat?.length) return;
        const stream = data.chat;
        
        if (!isDryRun) {
            state.lastRawStream = fastClone(stream);
            safeSave();
            Logger.divider(`===== 🚀 启动绝对真理拦截: ${chatKeyInfo.label} =====`);
        }

        const topSysMsgs = []; 
        const bottomSysMsgs = []; 
        const chatMsgs = [];
        let hasSeenUserOrAi = false;
        const timeSkipRegex = /(later|next day|第二天|几个小时后|一段时间后|meanwhile|之后|随后|时光飞逝|转眼间|the next morning)/i;
        const vectorRegex = /(retrieved context|search results|vector database|相关记忆|检索到的内容|记忆库片段|data bank)/i;

        for (const msg of stream) {
            if (!msg.content) continue;
            if (Settings.warpDriveFilter && msg.content.replace(/[\s\*\.\-]/g, '').length === 0) {
                if (!isDryRun) {
                    Logger.trace(`[🌌 曲率引擎] 过滤了零熵空白节点。`);
                    triggerToast('warp', '曲率引擎：已过滤空白消息', 'info', '🌌');
                }
                continue;
            }
            
            const isSys = (msg.role === 'system' || (msg.role !== 'user' && msg.role !== 'assistant'));
            if (isSys) {
                const sysNode = createMsg(msg, 'SYS');
                const isSummary = Settings.summaryAnchor && /(summary|previously on|摘要|前情提要|总结|回顾)/i.test(sysNode.content);
                const isTimeSkip = Settings.chronosProtocol && sysNode.content.length < 150 && timeSkipRegex.test(sysNode.content);
                const isVector = Settings.vectorQuarantine && vectorRegex.test(sysNode.content);
                
                if (isSummary || isTimeSkip || isVector || (Settings.anchorStabilization && hasSeenUserOrAi) || (Settings.gravityProtocol && hasSeenUserOrAi)) {
                    if (isTimeSkip) sysNode.isTimeSkip = true; 
                    if (isVector) sysNode.isVector = true;
                    if (isSummary) sysNode.isSummary = true;
                    bottomSysMsgs.push(sysNode);
                } else {
                    topSysMsgs.push(sysNode);
                }
            } else {
                hasSeenUserOrAi = true;
                chatMsgs.push(createMsg(msg, msg.role === 'user' ? 'USER' : 'AI'));
            }
        }

        let lastUserIdx = -1;
        for (let i = chatMsgs.length - 1; i >= 0; i--) { if (chatMsgs[i].tag === 'USER') { lastUserIdx = i; break; } }

        let historyTurns = []; let currentTurn = { user: null, prefills: [] };
        if (lastUserIdx === -1) {
            currentTurn.prefills = chatMsgs.filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'}));
        } else {
            const hMsgs = chatMsgs.slice(0, lastUserIdx);
            const cMsgs = chatMsgs.slice(lastUserIdx);
            currentTurn.user = cMsgs[0];
            currentTurn.prefills = cMsgs.slice(1).filter(m => m.tag === 'AI').map(m => ({...m, tag: 'PREFILL'}));

            let curUser = null; let curAiContents = [];
            for (const msg of hMsgs) {
                if (msg.tag === 'USER') {
                    if (curUser) historyTurns.push({ user: curUser, assistant: curAiContents.length ? createMsg({role: 'assistant', content: curAiContents.join('\n')}, 'AI') : null });
                    curUser = msg; curAiContents = [];
                } else if (msg.tag === 'AI') curAiContents.push(msg.content);
            }
            if (curUser) historyTurns.push({ user: curUser, assistant: curAiContents.length ? createMsg({role: 'assistant', content: curAiContents.join('\n')}, 'AI') : null });
        }

        const incomingSysPool = [...topSysMsgs, ...bottomSysMsgs];
        const incomingHistoryPool = [];
        for(let t of historyTurns) {
            incomingHistoryPool.push(t.user);
            if(t.assistant) incomingHistoryPool.push(stripPrefillFromAssistant(t.assistant, state.lastPrefills));
        }

        if (Settings.multiverseProtocol && state.multiverse && state.multiverse.length > 0) {
            let bestUniverse = state.frozenSequence;
            let bestMatchCount = -1;
            const currentStreamNorms = [...incomingSysPool, ...incomingHistoryPool].map(m => m.norm);
            
            for (let i = 0; i < state.multiverse.length; i++) {
                const universe = state.multiverse[i];
                let matchCount = 0;
                for (let j = 0; j < Math.min(universe.length, currentStreamNorms.length); j++) {
                    if (universe[j].norm === currentStreamNorms[j]) matchCount++;
                    else break;
                }
                if (matchCount > bestMatchCount) { bestMatchCount = matchCount; bestUniverse = universe; }
            }
            if (bestUniverse !== state.frozenSequence) {
                if (!isDryRun) {
                    Logger.map(`[🌌 平行宇宙跳跃] 检测到分支切换！已跳跃至匹配度最高的宇宙。`);
                    triggerToast('multiverse', '平行宇宙：已跳跃至最佳历史分支', 'success', '🌌');
                }
                state.frozenSequence = bestUniverse;
            }
        }

        let newFrozenSequence = []; 
        let newAdditions = { history: [], sys_default: [], sys_lore: [], sys_other: [], dynamic: [], patches: [] };
        const thresholds = getTolerance();
        
        const handledIncomingSys = new Set();
        const handledIncomingHis = new Set();
        let lastHandledIncomingHisIdx = -1;

        // 階段 1：遍歷凍結的過去
        for (let i = 0; i < state.frozenSequence.length; i++) {
            const frozenItem = state.frozenSequence[i];

            if (frozenItem.tag === 'SYS') {
                let bestIdx = -1, bestScore = 0;
                for (let j = 0; j < incomingSysPool.length; j++) {
                    if (handledIncomingSys.has(j)) continue;
                    const score = getSimilarity(frozenItem, incomingSysPool[j]);
                    if (score > bestScore) { bestScore = score; bestIdx = j; }
                }

                if (bestScore === 1 || (bestIdx !== -1 && frozenItem.fuzzyHash === incomingSysPool[bestIdx].fuzzyHash)) {
                    frozenItem._omniCat = 'frozen';
                    newFrozenSequence.push(frozenItem);
                    handledIncomingSys.add(bestIdx);
                    if (bestScore < 1 && !isDryRun) {
                        Logger.debug(`[🧹 模糊语义] 无视排版差异，保持冻结: ${truncateLog(frozenItem.content)}`);
                        triggerToast('fuzzy', '模糊语义：已无视排版差异', 'success', '🧹');
                    }
                } else if (bestScore > thresholds.sys) {
                    const incomingItem = incomingSysPool[bestIdx];
                    frozenItem._omniCat = 'frozen';
                    newFrozenSequence.push(frozenItem); 
                    handledIncomingSys.add(bestIdx);

                    if (Settings.nanoPatching && bestScore > 0.85) {
                        let addedText = extractAddedText(frozenItem.content, incomingItem.content);
                        if (addedText) {
                            const patch = createMsg({role: 'system', content: `[系统提示：设定微调补充。新增细节：${addedText}]`}, 'SYS');
                            patch._omniCat = 'patch';
                            patch._patchedOldHash = frozenItem.hash; // 供 Omni-Vision 連線使用
                            newAdditions.patches.push(patch);
                            if (!isDryRun) {
                                Logger.debug(`[🔬 量子微创] 生成设定差异补丁。`);
                                triggerToast('nano', '量子微创：已生成设定差异补丁', 'success', '🔬');
                            }
                        }
                    } else if (Settings.hotReloadPersona && i === 0) {
                        const patch = createMsg({role: 'system', content: `[系统提示：角色设定已热更新，最新特征如下：\n${incomingItem.content}]`}, 'SYS');
                        patch._omniCat = 'patch';
                        patch._patchedOldHash = frozenItem.hash;
                        newAdditions.patches.push(patch);
                        if (!isDryRun) {
                            Logger.debug(`[🔥 设定热更新] 生成热更新补丁。`);
                            triggerToast('hotreload', '设定热更新：已生成更新补丁', 'success', '🔥');
                        }
                    } else {
                        if (Settings.dynamicMode === 1) {
                            incomingItem._omniCat = 'dynamic';
                            newAdditions.dynamic.push(incomingItem); 
                            if (!isDryRun) Logger.debug(`[📖 日记模式] 旧时间冻结，新时间追加至尾部。`);
                        } else if (Settings.dynamicMode === 4) {
                            newFrozenSequence.pop(); 
                            incomingItem._omniCat = 'frozen';
                            newFrozenSequence.push(incomingItem);
                            if (!isDryRun) Logger.warn(`[🔥 原位替换] 破坏了缓存: ${truncateLog(incomingItem.content)}`);
                        }
                    }
                } else {
                    if (Settings.permanentMemoryImprint) {
                        frozenItem._omniCat = 'frozen';
                        newFrozenSequence.push(frozenItem); 
                        if (!isDryRun) Logger.debug(`[🖨️ 永久记忆] 强制保留被删除的设定: ${truncateLog(frozenItem.content)}`);
                    }
                }
            } 
            else if (frozenItem.tag === 'USER' || frozenItem.tag === 'AI') {
                let bestIdx = -1, bestScore = 0;
                for (let j = 0; j < incomingHistoryPool.length; j++) {
                    if (handledIncomingHis.has(j)) continue;
                    if (frozenItem.tag !== incomingHistoryPool[j].tag) continue;
                    const score = getSimilarity(frozenItem, incomingHistoryPool[j]);
                    if (score > bestScore) { bestScore = score; bestIdx = j; }
                }

                if (bestScore === 1 || (bestIdx !== -1 && frozenItem.fuzzyHash === incomingHistoryPool[bestIdx].fuzzyHash)) {
                    frozenItem._omniCat = 'frozen';
                    newFrozenSequence.push(frozenItem);
                    handledIncomingHis.add(bestIdx);
                    lastHandledIncomingHisIdx = Math.max(lastHandledIncomingHisIdx, bestIdx);
                } else if (bestScore > thresholds.his) {
                    const incomingItem = incomingHistoryPool[bestIdx];
                    handledIncomingHis.add(bestIdx);
                    lastHandledIncomingHisIdx = Math.max(lastHandledIncomingHisIdx, bestIdx);

                    if (Settings.entropyShield && bestScore > 0.99) {
                        frozenItem._omniCat = 'frozen';
                        newFrozenSequence.push(frozenItem); 
                        const patch = createMsg({role: 'system', content: `[系统提示：错字修正。之前的对话中，"${truncateLog(frozenItem.content, 15)}" 已修正为 "${truncateLog(incomingItem.content, 15)}"]`}, 'SYS');
                        patch._omniCat = 'patch';
                        patch._patchedOldHash = frozenItem.hash;
                        newAdditions.patches.push(patch);
                        if (!isDryRun) {
                            Logger.debug(`[🛡️ 熵减护盾] 生成错字修正补丁。`);
                            triggerToast('entropy', '熵减护盾：已生成错字修正补丁', 'success', '🛡️');
                        }
                    } else if (Settings.historyEditMode === 1) {
                        frozenItem._omniCat = 'frozen';
                        newFrozenSequence.push(frozenItem); 
                        const patch = createMsg({role: 'system', content: `[系统提示：时空修正。之前的对话中，"${truncateLog(frozenItem.content, 20)}" 实际上已发生改变，最新情况为："${incomingItem.content}"]`}, 'SYS');
                        patch._omniCat = 'patch';
                        patch._patchedOldHash = frozenItem.hash;
                        newAdditions.patches.push(patch);
                        if (!isDryRun) {
                            Logger.debug(`[🛡️ 时空补丁] 生成历史修改补丁。`);
                            triggerToast('patch', '时空补丁：已生成历史修改补丁', 'success', '⏳');
                        }
                    } else if (Settings.historyEditMode === 2) {
                        frozenItem._omniCat = 'frozen';
                        newFrozenSequence.push(frozenItem); 
                        if (!isDryRun) Logger.debug(`[🙈 幻象隐藏] 强行使用旧版历史。`);
                    } else {
                        incomingItem._omniCat = 'frozen';
                        newFrozenSequence.push(incomingItem); 
                    }
                } else {
                    const isPrefix = (i === 0);
                    if (isPrefix && Settings.prefixAnchor) {
                        frozenItem._omniCat = 'frozen';
                        newFrozenSequence.push(frozenItem); 
                        if (!isDryRun) {
                            Logger.warn(`[⚓ 绝对前缀锚点] 强制保留被截断的头部。`);
                            triggerToast('prefix', '前缀锚点：已强制保留被截断的头部', 'warning', '⚓');
                        }
                    } else if (Settings.retconProtocol) {
                        frozenItem._omniCat = 'frozen';
                        newFrozenSequence.push(frozenItem); 
                        const patch = createMsg({role: 'system', content: `[系统提示：世界意志发动了记忆抹除。之前的事件 "${truncateLog(frozenItem.content, 20)}" 已被抹除，请当作从未发生过。]`}, 'SYS');
                        patch._omniCat = 'patch';
                        patch._patchedOldHash = frozenItem.hash;
                        newAdditions.patches.push(patch);
                        if (!isDryRun) {
                            Logger.debug(`[🗑️ 吃书协议] 生成记忆抹除声明。`);
                            triggerToast('retcon', '吃书协议：已生成记忆抹除声明', 'success', '🗑️');
                        }
                    }
                }
            }
        }

        // 階段 2：處理未匹配的全新內容
        for (let j = 0; j < incomingHistoryPool.length; j++) {
            if (!handledIncomingHis.has(j)) {
                const h = incomingHistoryPool[j];
                if (Settings.flashbackInsertion && j < lastHandledIncomingHisIdx) {
                    const patch = createMsg({role: 'system', content: `[系统提示：闪回补充。在之前的事件中，还发生了以下细节：\n${h.content}]`}, 'SYS');
                    patch._omniCat = 'patch';
                    newAdditions.patches.push(patch);
                    if (!isDryRun) {
                        Logger.debug(`[⏪ 闪回插入] 将新插入的对话转为闪回补丁。`);
                        triggerToast('flashback', '闪回插入：已生成闪回补丁', 'success', '⏪');
                    }
                } else {
                    h._omniCat = 'history';
                    newAdditions.history.push(h); 
                }
            }
        }

        for (let j = 0; j < incomingSysPool.length; j++) {
            if (!handledIncomingSys.has(j)) {
                const sys = incomingSysPool[j];
                if (sys.isTimeSkip) {
                    const patch = createMsg({role: 'system', content: `[系统提示：叙事过渡。${sys.content}]`}, 'SYS');
                    patch._omniCat = 'patch';
                    newAdditions.patches.push(patch);
                    if (!isDryRun) triggerToast('chronos', '克罗诺斯协议：已生成时间跳跃补丁', 'info', '⏳');
                } else if (sys.isVector) {
                    sys._omniCat = 'vector';
                    newAdditions.dynamic.push(sys);
                    if (!isDryRun) triggerToast('vector', '向量隔离区：已将检索记忆沉底', 'info', '🎯');
                } else if (sys.isSummary) {
                    sys._omniCat = 'dynamic';
                    newAdditions.dynamic.push(sys);
                } else {
                    // 嚴格分類：預設提示詞 vs 世界書 vs 其他
                    if (sys.content.length < 500 && !sys.content.includes("Write the next reply")) {
                        sys._omniCat = 'lorebook';
                        newAdditions.sys_lore.push(sys);
                    } else if (j === 0 || sys.content.includes("Write the next reply")) {
                        sys._omniCat = 'sys_default';
                        newAdditions.sys_default.push(sys);
                    } else {
                        sys._omniCat = 'sys_other';
                        newAdditions.sys_other.push(sys);
                    }
                }
            }
        }

        // 階段 3：嚴格按照 Append-Only 順序組裝 (絕對領域排序法則)
        for (let h of newAdditions.history) newFrozenSequence.push(h);
        for (let sys of newAdditions.sys_default) newFrozenSequence.push(sys);
        for (let lb of newAdditions.sys_lore) newFrozenSequence.push(lb);
        for (let other of newAdditions.sys_other) newFrozenSequence.push(other);
        for (let dyn of newAdditions.dynamic) newFrozenSequence.push(dyn);
        for (let patch of newAdditions.patches) newFrozenSequence.push(patch);

        // 階段 4：分類去重隔離 (絕對不碰動態變數與補丁)
        let dedupedSequence = [];
        const seenSysNorms = new Set();
        for (const item of newFrozenSequence) {
            if (item.tag === 'SYS' && Settings.absoluteDeduplication) {
                if (item._omniCat === 'sys_default' || item._omniCat === 'sys_lore' || item._omniCat === 'sys_other' || item._omniCat === 'frozen') {
                    if (seenSysNorms.has(item.hash)) continue;
                    seenSysNorms.add(item.hash);
                }
            }
            dedupedSequence.push(item);
        }

        const proposedStream = [...dedupedSequence];
        if (currentTurn.user) proposedStream.push(currentTurn.user);
        for (const p of currentTurn.prefills) proposedStream.push(p);

        if (Settings.logLevel >= LogLevels.DEBUG && !isDryRun) {
            Logger.debug(`[最终追加发送阵列] 总节点数: ${proposedStream.length}`);
            if (Settings.logLevel === LogLevels.TRACE) {
                proposedStream.forEach((n, i) => Logger.trace(`[${i}] [${n.tag}] [${n._omniCat}] Hash:${n.hash}`));
            }
        }

        // ==========================================
        // 5. 精準流失率演算法
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
            let recomputeRatio = breakIndex === L.length ? 0 : (totalLen === 0 ? 0 : (recomputeLen / totalLen));
            
            preservedTokens = Math.floor(preservedLen / 3.5);
            recomputeTokens = Math.floor(recomputeLen / 3.5);
            
            let isTailEndMutation = false;
            if (Settings.tailEndExemption && breakIndex >= L.length - 2) {
                if (P[breakIndex]?.tag !== 'SYS' && L[breakIndex]?.tag !== 'SYS') {
                    isTailEndMutation = true;
                    if (!isDryRun) Logger.log(`[👯 二重身协议] 检测到仅修改了最后回合对话，已自动放行。`);
                }
            }
            
            dropPercentStr = (recomputeRatio * 100).toFixed(1);

            // 減少彈窗：只有當重算 Token 超過 500 且比例大於 10% 時才彈窗
            if (recomputeRatio >= 0.10 && recomputeTokens > 500 && Settings.showResetPrompt && !isTailEndMutation && !sessionSnoozeReset) {
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
                if (!Settings.zenMode && typeof toastr !== 'undefined') toastr.info(`已自动修复后台顺序 (需重算 ${dropPercentStr}%)`, "终极真理");
                decision = 'accept';
            } else {
                decision = await askUserForResetAsync(dropPercentStr, mapInfoText, causeText);
            }
        }

        if (decision === 'abort') {
            Logger.error('[物理拦截] 已拦截本次发送，强制中止生成。', null, LogLevels.BASIC);
            setTopBarStatus('#e06c75', '缓存: 已拦截发送');
            if (typeof toastr !== 'undefined') toastr.error("已拦截发送！对话已中止。", "终极真理");
            
            data.chat.length = 0; 
            data.chat.push({ role: "invalid_abort_role", content: "ABORT_GENERATION" });
            
            setTimeout(() => {
                if (typeof StopGenerating === 'function') StopGenerating();
                const stopBtn = document.getElementById('stop_generating_button') || document.getElementById('send_but');
                if (stopBtn) stopBtn.click();
            }, 10);
            
            throw new Error("Generation aborted by DeepSeek Cache Optimizer."); 
        }

        if (decision === 'revert') {
            Logger.warn('[时空回溯] 用户选择无视本次修改，强行使用旧版缓存。');
            setTopBarStatus('#c678dd', '缓存: 强行冻结旧版');
            
            const finalStream = [...state.frozenSequence];
            if (currentTurn.user) finalStream.push(currentTurn.user);
            for (const p of currentTurn.prefills) finalStream.push(p);

            state.lastSentSequence = fastClone(finalStream);
            safeSave();

            stream.splice(0, stream.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
            if (typeof toastr !== 'undefined') toastr.success("已强行使用旧版内容发送，保住100%缓存！", "终极真理");
            return;
        }

        if (decision === 'bypass') {
            Logger.warn('[临时放行] 用户选择跳过本次优化，按 ST 原样乱序发送。');
            setTopBarStatus('#e5c07b', '缓存: 临时放行');
            return; 
        }

        if (decision === 'accept') {
            state.frozenSequence = dedupedSequence;
            state.lastPrefills = currentTurn.prefills;

            const finalStream = [...state.frozenSequence];
            if (currentTurn.user) finalStream.push(currentTurn.user);
            for (const p of currentTurn.prefills) finalStream.push(p);

            state.lastSentSequence = fastClone(finalStream);
            
            if (Settings.multiverseProtocol) {
                if (!state.multiverse) state.multiverse = [];
                state.multiverse.unshift([...state.frozenSequence]);
                if (state.multiverse.length > 5) state.multiverse.pop();
            }

            safeSave();

            if (Settings.autoPinThreshold > 0 && finalStream.length >= Settings.autoPinThreshold) {
                if (!Settings.pinnedChats[chatKeyInfo.key]) {
                    Settings.pinnedChats[chatKeyInfo.key] = true;
                    safeSave();
                    Logger.map(`[自动保护] 节点数(${finalStream.length})达标，已锁定当前存档。`);
                }
            }

            stream.splice(0, stream.length, ...finalStream.map(i => ({ role: i.role, content: i.content })));
            Logger.log(`✅ 追加排序完成，拦截器授权发送。耗时: ${(performance.now() - startTime).toFixed(2)}ms`, LogLevels.BASIC);
        }

    } catch (err) {
        if (err.message === "Generation aborted by DeepSeek Cache Optimizer.") throw err; 
        setTopBarStatus('#e06c75', '缓存: 发生崩溃');
        Logger.error('核心运算崩溃', err);
        throw err;
    }
}

// ==========================================
// 8. 👁️ Omni-Vision 全視之眼沙盒 UI (Ultimate Truth)
// ==========================================
let omniRenderTimeout = null;
let omniMappings = []; 
let isSyncScroll = true;
let isSyncingLeft = false;
let isSyncingRight = false;
let positionCache = []; 
let resizeObserver = null;

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
                    <h2 class="ds-modal-title ds-blue" style="margin:0;"><i class="fa-solid fa-eye"></i> Omni-Vision 终极真理沙盒</h2>
                    <button class="ds-btn ds-btn-reset" style="padding: 8px 15px; font-size: 13px;" onclick="closeOmniVision();"><i class="fa-solid fa-xmark"></i> 关闭</button>
                </div>
                
                <div style="background:rgba(0,0,0,0.5); padding:15px; border-radius:10px; margin-bottom:15px; border:1px solid rgba(255,255,255,0.05); flex-shrink:0;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px; font-weight:bold;">
                        <span style="color:var(--ds-green);"><i class="fa-solid fa-shield-halved"></i> 预计缓存命中率: <span id="omni-hit-rate">计算中...</span></span>
                        <span style="color:var(--ds-cyan);"><i class="fa-solid fa-coins"></i> 预计保留 Tokens: <span id="omni-tokens-saved">...</span> / 需重算: <span id="omni-tokens-lost" style="color:var(--ds-red);">...</span></span>
                    </div>
                    <div class="ds-health-bar" style="height:8px; border-radius:4px; background:rgba(224,108,117,0.3);"><div id="omni-hit-bar" class="ds-health-fill" style="width:0%; transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);"></div></div>
                </div>

                <!-- 摺疊式控制台 -->
                <div class="ds-omni-control-panel" id="omni-control-panel">
                    <div class="ds-omni-control-header" onclick="document.getElementById('omni-control-panel').classList.toggle('collapsed'); setTimeout(recalcOmniPositions, 350);">
                        <span style="color:var(--ds-purple); font-size:13px;"><i class="fa-solid fa-sliders"></i> 核心协议控制台 & 模拟输入</span>
                        <i class="fa-solid fa-chevron-up" style="color:#abb2bf; transition:0.3s;"></i>
                    </div>
                    <div class="ds-omni-control-body">
                        <div class="ds-omni-actions-row">
                            <button id="omni-btn-sync" class="ds-omni-action-btn active" title="同步左右两侧的滚动条"><i class="fa-solid fa-link"></i> 锁定滚动同步</button>
                            <button id="omni-btn-expand" class="ds-omni-action-btn" title="展开所有提示词卡片"><i class="fa-solid fa-expand"></i> 展开全部</button>
                            <button id="omni-btn-collapse" class="ds-omni-action-btn" title="折叠所有提示词卡片"><i class="fa-solid fa-compress"></i> 折叠全部</button>
                            <button id="omni-btn-export-matrix" class="ds-omni-action-btn" title="导出当前矩阵状态以供排错"><i class="fa-solid fa-bug"></i> 导出矩阵状态</button>
                        </div>
                        
                        <div class="ds-omni-toggles-grid ds-scroll">
                            <div class="ds-omni-toggle ${Settings.dynamicMode===1?'active':''}" data-setting="dynamicMode" data-val="1" title="写日记模式"><i class="fa-solid fa-book-journal-whills"></i> 日记模式</div>
                            <div class="ds-omni-toggle ${Settings.absoluteOrderMatrix?'active':''}" data-setting="absoluteOrderMatrix" title="绝对真理追加架构"><i class="fa-solid fa-sort"></i> 追加架构</div>
                            <div class="ds-omni-toggle ${Settings.vectorQuarantine?'active':''}" data-setting="vectorQuarantine" title="向量隔离区"><i class="fa-solid fa-bullseye"></i> 向量隔离</div>
                            <div class="ds-omni-toggle ${Settings.semanticNormalize?'active':''}" data-setting="semanticNormalize" title="模糊语义引擎"><i class="fa-solid fa-broom"></i> 模糊语义</div>
                            <div class="ds-omni-toggle ${Settings.prefixAnchor?'active':''}" data-setting="prefixAnchor" title="绝对前缀锚点"><i class="fa-solid fa-anchor"></i> 前缀锚点</div>
                            <div class="ds-omni-toggle ${Settings.voidBridging?'active':''}" data-setting="voidBridging" title="虚空架桥协议"><i class="fa-solid fa-bridge"></i> 虚空架桥</div>
                            <div class="ds-omni-toggle ${Settings.warpDriveFilter?'active':''}" data-setting="warpDriveFilter" title="曲率引擎过滤"><i class="fa-solid fa-filter"></i> 曲率过滤</div>
                            <div class="ds-omni-toggle ${Settings.multiverseProtocol?'active':''}" data-setting="multiverseProtocol" title="平行宇宙协议"><i class="fa-solid fa-code-branch"></i> 平行宇宙</div>
                            <div class="ds-omni-toggle ${Settings.entropyShield?'active':''}" data-setting="entropyShield" title="熵减护盾协议"><i class="fa-solid fa-shield"></i> 熵减护盾</div>
                            <div class="ds-omni-toggle ${Settings.absoluteDeduplication?'active':''}" data-setting="absoluteDeduplication" title="绝对去重协议"><i class="fa-solid fa-compress-arrows-alt"></i> 绝对去重</div>
                            <div class="ds-omni-toggle ${Settings.anchorStabilization?'active':''}" data-setting="anchorStabilization" title="浮动锚点稳定"><i class="fa-solid fa-anchor-circle-check"></i> 锚点稳定</div>
                            <div class="ds-omni-toggle ${Settings.permanentMemoryImprint?'active':''}" data-setting="permanentMemoryImprint" title="永久记忆烙印"><i class="fa-solid fa-fingerprint"></i> 记忆烙印</div>
                            <div class="ds-omni-toggle ${Settings.chronosProtocol?'active':''}" data-setting="chronosProtocol" title="克罗诺斯协议"><i class="fa-solid fa-hourglass-half"></i> 克罗诺斯</div>
                            <div class="ds-omni-toggle ${Settings.amnesiaProtocol?'active':''}" data-setting="amnesiaProtocol" title="失忆症协议"><i class="fa-solid fa-brain"></i> 失忆症</div>
                            <div class="ds-omni-toggle ${Settings.nanoPatching?'active':''}" data-setting="nanoPatching" title="量子微创手术"><i class="fa-solid fa-microscope"></i> 量子微创</div>
                            <div class="ds-omni-toggle ${Settings.summaryAnchor?'active':''}" data-setting="summaryAnchor" title="摘要沉底锚点"><i class="fa-solid fa-file-lines"></i> 摘要沉底</div>
                            <div class="ds-omni-toggle ${Settings.retconProtocol?'active':''}" data-setting="retconProtocol" title="吃书协议"><i class="fa-solid fa-eraser"></i> 吃书协议</div>
                            <div class="ds-omni-toggle ${Settings.hotReloadPersona?'active':''}" data-setting="hotReloadPersona" title="角色卡热更新"><i class="fa-solid fa-fire"></i> 热更新</div>
                            <div class="ds-omni-toggle ${Settings.flashbackInsertion?'active':''}" data-setting="flashbackInsertion" title="闪回插入协议"><i class="fa-solid fa-backward-fast"></i> 闪回插入</div>
                        </div>
                        
                        <textarea id="omni-simulated-input" class="ds-input-styled ds-scroll" placeholder="✍️ 模拟用户即将发送的输入 (输入后会自动触发下方沙盒重算)..." style="height: 40px; resize: vertical;"></textarea>
                    </div>
                </div>

                <!-- 9 維度神經連線圖例 -->
                <div class="ds-omni-legend">
                    <div class="ds-legend-item"><div class="ds-legend-color" style="background:rgba(152,195,121,0.8);"></div> 完美冻结 (Perfect)</div>
                    <div class="ds-legend-item"><div class="ds-legend-color" style="background:repeating-linear-gradient(90deg, rgba(229,192,123,0.8) 0, rgba(229,192,123,0.8) 4px, transparent 4px, transparent 8px);"></div> 模糊命中 (Fuzzy)</div>
                    <div class="ds-legend-item"><div class="ds-legend-color" style="background:rgba(198,120,221,0.8);"></div> 时空补丁连结 (Patch Link)</div>
                    <div class="ds-legend-item"><div class="ds-legend-color" style="background:linear-gradient(90deg, rgba(224,108,117,0.8) 0%, rgba(224,108,117,0) 100%);"></div> 节点被删除 (Deleted)</div>
                    <div class="ds-legend-item"><div class="ds-legend-color" style="background:linear-gradient(90deg, rgba(97,175,239,0) 0%, rgba(97,175,239,0.8) 100%);"></div> 全新预设提示词 (New Sys)</div>
                    <div class="ds-legend-item"><div class="ds-legend-color" style="background:linear-gradient(90deg, rgba(0,229,255,0) 0%, rgba(0,229,255,0.8) 100%);"></div> 全新世界书 (New Lore)</div>
                    <div class="ds-legend-item"><div class="ds-legend-color" style="background:linear-gradient(90deg, rgba(209,154,102,0) 0%, rgba(209,154,102,0.8) 100%);"></div> 全新动态变量 (New Dyn)</div>
                    <div class="ds-legend-item"><div class="ds-legend-color" style="background:linear-gradient(90deg, rgba(152,195,121,0) 0%, rgba(152,195,121,0.8) 100%);"></div> 全新历史对话 (New His)</div>
                    <div class="ds-legend-item"><div class="ds-legend-color" style="background:linear-gradient(90deg, rgba(160,82,45,0) 0%, rgba(160,82,45,0.8) 100%);"></div> 向量隔离区 (Vector)</div>
                </div>

                <div style="display: flex; padding: 0 15px; margin-bottom: 10px; font-weight: bold; flex-shrink: 0;">
                    <div style="flex: 1; color: var(--ds-purple);"><i class="fa-solid fa-clock-rotate-left"></i> 历史观测 (绝对锁定)</div>
                    <div style="flex: 0 0 80px;"></div>
                    <div style="flex: 1; color: var(--ds-cyan);"><i class="fa-solid fa-flask"></i> 即时沙盒预览 (套用设定后)</div>
                </div>

                <!-- 統一滾動容器 (Flexbox Rows) -->
                <div class="ds-omni-matrix-container">
                    <!-- 左視窗：歷史觀測 -->
                    <div class="ds-omni-pane">
                        <div id="omni-left-content" class="ds-omni-pane-content ds-scroll">
                            <div style="text-align:center; padding:20px; color:#abb2bf;">加载中...</div>
                        </div>
                    </div>

                    <!-- 畫布橋樑 (Canvas Bridge) -->
                    <div class="ds-omni-bridge">
                        <svg id="omni-svg-canvas">
                            <defs>
                                <linearGradient id="grad-red" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stop-color="rgba(224,108,117,0.8)" />
                                    <stop offset="100%" stop-color="rgba(224,108,117,0)" />
                                </linearGradient>
                                <linearGradient id="grad-blue" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stop-color="rgba(0,229,255,0)" />
                                    <stop offset="100%" stop-color="rgba(97,175,239,0.8)" />
                                </linearGradient>
                                <linearGradient id="grad-cyan" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stop-color="rgba(86,182,194,0)" />
                                    <stop offset="100%" stop-color="rgba(0,229,255,0.8)" />
                                </linearGradient>
                                <linearGradient id="grad-orange" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stop-color="rgba(209,154,102,0)" />
                                    <stop offset="100%" stop-color="rgba(209,154,102,0.8)" />
                                </linearGradient>
                                <linearGradient id="grad-green" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stop-color="rgba(152,195,121,0)" />
                                    <stop offset="100%" stop-color="rgba(152,195,121,0.8)" />
                                </linearGradient>
                                <linearGradient id="grad-vector" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stop-color="rgba(160,82,45,0)" />
                                    <stop offset="100%" stop-color="rgba(160,82,45,0.8)" />
                                </linearGradient>
                            </defs>
                        </svg>
                    </div>

                    <!-- 右視窗：即時沙盒預覽 -->
                    <div class="ds-omni-pane">
                        <div id="omni-right-content" class="ds-omni-pane-content ds-scroll">
                            <div style="text-align:center; padding:20px; color:#abb2bf;">加载中...</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('body').append(html);

    // 事件綁定
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
        triggerOmniRender(state);
    });

    $('#omni-btn-sync').on('click', function() {
        isSyncScroll = !isSyncScroll;
        $(this).toggleClass('active', isSyncScroll);
        if (isSyncScroll) {
            $(this).html('<i class="fa-solid fa-link"></i> 锁定滚动同步');
            syncScrollPositions(document.getElementById('omni-left-content'), document.getElementById('omni-right-content'));
        } else {
            $(this).html('<i class="fa-solid fa-link-slash"></i> 解除滚动同步');
        }
    });

    $('#omni-btn-expand').on('click', function() {
        $('.ds-node-content').removeClass('collapsed');
        $('.ds-node-expand-btn').html('<i class="fa-solid fa-chevron-up"></i> 收起');
        setTimeout(recalcOmniPositions, 250);
    });

    $('#omni-btn-collapse').on('click', function() {
        $('.ds-node-content').addClass('collapsed');
        $('.ds-node-expand-btn').html('<i class="fa-solid fa-chevron-down"></i> 展开');
        setTimeout(recalcOmniPositions, 250);
    });
    
    $('#omni-btn-export-matrix').on('click', function() {
        const blob = new Blob([JSON.stringify({left: state.lastSentSequence, right: state.lastRawStream}, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob); const a = document.createElement("a");
        a.href = url; a.download = `DS_Matrix_State_${new Date().getTime()}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        if (typeof toastr !== 'undefined') toastr.success("💾 矩阵状态已导出！");
    });

    let inputTimeout;
    $('#omni-simulated-input').on('input', function() {
        clearTimeout(inputTimeout);
        inputTimeout = setTimeout(() => triggerOmniRender(state), 500);
    });

    $('#ds-omni-modal-wrapper').on('click', '.ds-node-expand-btn', function() {
        const contentDiv = $(this).siblings('.ds-node-content');
        if (contentDiv.hasClass('collapsed')) {
            contentDiv.removeClass('collapsed');
            $(this).html('<i class="fa-solid fa-chevron-up"></i> 收起');
        } else {
            contentDiv.addClass('collapsed');
            $(this).html('<i class="fa-solid fa-chevron-down"></i> 展开');
        }
        setTimeout(recalcOmniPositions, 250);
    });

    $('#ds-omni-modal-wrapper').on('click', function(e) { if(e.target === this) closeOmniVision(); });

    // 零重排滾動監聽
    const lPane = document.getElementById('omni-left-content');
    const rPane = document.getElementById('omni-right-content');
    
    lPane.addEventListener('scroll', () => {
        if (isSyncingRight) return;
        if (isSyncScroll) {
            isSyncingLeft = true;
            syncScrollPositions(lPane, rPane);
            setTimeout(() => isSyncingLeft = false, 20);
        }
        requestAnimationFrame(drawOmniLinesFast);
    }, { passive: true });

    rPane.addEventListener('scroll', () => {
        if (isSyncingLeft) return;
        if (isSyncScroll) {
            isSyncingRight = true;
            syncScrollPositions(rPane, lPane);
            setTimeout(() => isSyncingRight = false, 20);
        }
        requestAnimationFrame(drawOmniLinesFast);
    }, { passive: true });

    // 監聽容器尺寸變化 (解決視窗縮放或卡片展開時線條脫位)
    if (window.ResizeObserver) {
        resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(recalcOmniPositions);
        });
        resizeObserver.observe(lPane);
        resizeObserver.observe(rPane);
    }

    triggerOmniRender(state);
}

window.closeOmniVision = function() {
    $('#ds-omni-modal-wrapper').remove();
    omniMappings.forEach(m => { m.pathEl = null; }); 
    omniMappings = [];
    positionCache = [];
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
};

function syncScrollPositions(source, target) {
    const sourceMax = source.scrollHeight - source.clientHeight;
    const targetMax = target.scrollHeight - target.clientHeight;
    if (sourceMax <= 0 || targetMax <= 0) return;
    const ratio = source.scrollTop / sourceMax;
    target.scrollTop = ratio * targetMax;
}

function triggerOmniRender(state) {
    if (omniRenderTimeout) clearTimeout(omniRenderTimeout);
    omniRenderTimeout = setTimeout(() => renderOmniVision(state), 100);
}

async function renderOmniVision(state) {
    const leftContainer = document.getElementById('omni-left-content');
    const rightContainer = document.getElementById('omni-right-content');
    if (!leftContainer || !rightContainer) return;

    const leftArray = fastClone(state.lastSentSequence || []);
    
    let rightArray = [];
    let breakIndex = -1;
    let dropPercent = "0.0";
    let preservedTokens = 0;
    let recomputeTokens = 0;

    if (state.lastRawStream && state.lastRawStream.length > 0) {
        let simulatedStream = fastClone(state.lastRawStream);
        const simInput = $('#omni-simulated-input').val().trim();
        if (simInput) {
            simulatedStream.push({ role: 'user', content: simInput });
        }

        const dryRunResult = await interceptAndRestructurePrompt({ chat: simulatedStream }, true);
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

    const hitRate = (100 - parseFloat(dropPercent)).toFixed(1);
    $('#omni-hit-rate').text(`${hitRate}%`);
    $('#omni-hit-bar').css('width', `${hitRate}%`);
    $('#omni-tokens-saved').text(preservedTokens);
    $('#omni-tokens-lost').text(recomputeTokens);

    omniMappings = [];
    const leftMatched = new Set();
    const rightMatched = new Set();

    // 1. 建立映射關係
    rightArray.forEach((rNode, rIdx) => {
        let bestMatchIdx = -1;
        let bestScore = 0;
        
        if (rNode._omniCat === 'patch' && rNode._patchedOldHash) {
            // 精準補丁追蹤
            bestMatchIdx = leftArray.findIndex(l => l.hash === rNode._patchedOldHash);
            if (bestMatchIdx !== -1) bestScore = 1;
        } else {
            leftArray.forEach((lNode, lIdx) => {
                if (rNode.hash === lNode.hash) { bestMatchIdx = lIdx; bestScore = 1; }
                else if (rNode.fuzzyHash === lNode.fuzzyHash && bestScore < 0.99) { bestMatchIdx = lIdx; bestScore = 0.99; }
                else {
                    let score = getSimilarity(rNode, lNode);
                    if (score > bestScore && score > 0.8) { bestScore = score; bestMatchIdx = lIdx; }
                }
            });
        }

        if (bestMatchIdx !== -1) {
            leftMatched.add(bestMatchIdx);
            rightMatched.add(rIdx);
            let type = bestScore === 1 ? 'perfect' : 'fuzzy';
            if (rNode._omniCat === 'patch') type = 'patch_link';
            omniMappings.push({ left: bestMatchIdx, right: rIdx, type: type });
        } else {
            let type = 'new_sys';
            if (rNode._omniCat === 'lorebook') type = 'new_lorebook';
            else if (rNode._omniCat === 'dynamic') type = 'new_dynamic';
            else if (rNode._omniCat === 'history') type = 'new_history';
            else if (rNode._omniCat === 'patch') type = 'new_patch';
            else if (rNode._omniCat === 'vector') type = 'new_vector';
            omniMappings.push({ left: -1, right: rIdx, type: type });
        }
    });

    leftArray.forEach((lNode, lIdx) => {
        if (!leftMatched.has(lIdx)) {
            omniMappings.push({ left: lIdx, right: -1, type: 'deleted' });
        }
    });

    // 2. 渲染左側 (絕對凍結)
    const leftFrag = document.createDocumentFragment();
    leftArray.forEach((node, idx) => {
        const isDeleted = !leftMatched.has(idx);
        const el = document.createElement('div');
        el.className = `ds-node-card ${isDeleted ? 'ds-node-deleted' : 'ds-node-frozen'}`;
        el.id = `omni-left-node-${idx}`;
        el.innerHTML = `
            <div class="ds-node-header">
                <span><span class="ds-tag ds-tag-${node.tag}">[${node.tag}]</span> Index: ${idx} ${isDeleted ? '<span style="color:var(--ds-red); font-weight:bold;">(DELETED)</span>' : ''}</span>
                <span>Hash: ${node.hash.toString(16).substring(0,8)}</span>
            </div>
            <div class="ds-node-content-wrapper">
                <div class="ds-node-content collapsed">${escapeHtml(node.content).replace(/\n/g, '<br>')}</div>
                <div class="ds-node-expand-btn"><i class="fa-solid fa-chevron-down"></i> 展开</div>
            </div>
        `;
        leftFrag.appendChild(el);
    });
    leftContainer.innerHTML = '';
    leftContainer.appendChild(leftFrag);

    // 3. 渲染右側 (即時沙盒)
    const rightFrag = document.createDocumentFragment();
    rightArray.forEach((node, idx) => {
        const isMiss = breakIndex !== -1 && idx >= breakIndex;
        const isNew = !rightMatched.has(idx);
        
        let cardClass = isMiss ? 'ds-node-warn' : 'ds-node-hit';
        let newLabel = '';
        
        if (isNew) {
            if (node._omniCat === 'lorebook') { cardClass = 'ds-node-new-lore'; newLabel = '<span style="color:var(--ds-cyan); font-weight:bold;">(NEW LORE)</span>'; }
            else if (node._omniCat === 'dynamic') { cardClass = 'ds-node-new-dyn'; newLabel = '<span style="color:var(--ds-orange); font-weight:bold;">(NEW DYN)</span>'; }
            else if (node._omniCat === 'history') { cardClass = 'ds-node-new-his'; newLabel = '<span style="color:var(--ds-green); font-weight:bold;">(NEW HIS)</span>'; }
            else if (node._omniCat === 'patch') { cardClass = 'ds-node-patch'; newLabel = '<span style="color:var(--ds-purple); font-weight:bold;">(PATCH)</span>'; }
            else if (node._omniCat === 'vector') { cardClass = 'ds-node-new-dyn'; newLabel = '<span style="color:#a0522d; font-weight:bold;">(VECTOR)</span>'; }
            else { cardClass = 'ds-node-new-sys'; newLabel = '<span style="color:var(--ds-blue); font-weight:bold;">(NEW SYS)</span>'; }
        } else if (node._omniCat === 'patch') {
            cardClass = 'ds-node-patch';
        }

        const el = document.createElement('div');
        el.className = `ds-node-card ${cardClass}`;
        el.id = `omni-right-node-${idx}`;
        el.innerHTML = `
            <div class="ds-node-header">
                <span><span class="ds-tag ds-tag-${node.tag}">[${node.tag}]</span> Index: ${idx} ${newLabel}</span>
                <span>Hash: ${node.hash.toString(16).substring(0,8)}</span>
            </div>
            <div class="ds-node-content-wrapper">
                <div class="ds-node-content collapsed">${escapeHtml(node.content).replace(/\n/g, '<br>')}</div>
                <div class="ds-node-expand-btn"><i class="fa-solid fa-chevron-down"></i> 展开</div>
            </div>
        `;
        rightFrag.appendChild(el);
    });
    rightContainer.innerHTML = '';
    rightContainer.appendChild(rightFrag);

    // 4. 初始化 SVG 與快取座標
    requestAnimationFrame(() => {
        initOmniSVGPaths();
        recalcOmniPositions();
    });
}

// 初始化 SVG 路徑池 (只建立一次 DOM)
function initOmniSVGPaths() {
    const svg = document.getElementById('omni-svg-canvas');
    if (!svg) return;
    const defs = svg.querySelector('defs');
    svg.innerHTML = '';
    if (defs) svg.appendChild(defs);

    omniMappings.forEach(m => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        let color, dash = '', strokeWidth = '2';

        if (m.type === 'deleted') { color = 'url(#grad-red)'; strokeWidth = '1.5'; dash = '4,4'; } 
        else if (m.type.startsWith('new_')) {
            if (m.type === 'new_lorebook') color = 'url(#grad-cyan)';
            else if (m.type === 'new_dynamic') color = 'url(#grad-orange)';
            else if (m.type === 'new_history') color = 'url(#grad-green)';
            else if (m.type === 'new_vector') color = 'url(#grad-vector)';
            else color = 'url(#grad-blue)';
            strokeWidth = '1.5'; dash = '4,4';
        } 
        else {
            if (m.type === 'perfect') color = 'rgba(152,195,121,0.6)'; 
            else if (m.type === 'fuzzy') { color = 'rgba(229,192,123,0.8)'; dash = '5,5'; } 
            else if (m.type === 'patch_link') color = 'rgba(198,120,221,0.8)'; 
        }

        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', strokeWidth);
        path.setAttribute('fill', 'none');
        if (dash) path.setAttribute('stroke-dasharray', dash);
        
        svg.appendChild(path);
        m.pathEl = path; 
    });
}

// 重新計算並快取所有卡片的絕對 Y 座標 (只在佈局改變時呼叫)
function recalcOmniPositions() {
    positionCache = [];
    omniMappings.forEach(m => {
        let cache = { pathEl: m.pathEl, type: m.type, lY: null, rY: null };
        
        if (m.left !== -1) {
            const el = document.getElementById(`omni-left-node-${m.left}`);
            if (el) cache.lY = el.offsetTop + (el.offsetHeight / 2);
        }
        if (m.right !== -1) {
            const el = document.getElementById(`omni-right-node-${m.right}`);
            if (el) cache.rY = el.offsetTop + (el.offsetHeight / 2);
        }
        positionCache.push(cache);
    });
    drawOmniLinesFast();
}

// 零重排極速繪圖引擎 (在 requestAnimationFrame 中呼叫)
function drawOmniLinesFast() {
    const lPane = document.getElementById('omni-left-content');
    const rPane = document.getElementById('omni-right-content');
    const svg = document.getElementById('omni-svg-canvas');
    if (!lPane || !rPane || !svg) return;

    const lScroll = lPane.scrollTop;
    const rScroll = rPane.scrollTop;
    const svgWidth = svg.clientWidth;
    const svgHeight = svg.clientHeight;

    positionCache.forEach(c => {
        if (!c.pathEl) return;
        let startX, startY, endX, endY;

        if (c.type === 'deleted') {
            if (c.lY === null) return;
            startY = c.lY - lScroll;
            if (startY < -50 || startY > svgHeight + 50) { c.pathEl.setAttribute('d', ''); return; }
            startX = 0; endX = svgWidth / 2; endY = startY;
        } 
        else if (c.type.startsWith('new_')) {
            if (c.rY === null) return;
            startY = c.rY - rScroll;
            if (startY < -50 || startY > svgHeight + 50) { c.pathEl.setAttribute('d', ''); return; }
            startX = svgWidth / 2; endX = svgWidth; endY = startY;
        } 
        else {
            if (c.lY === null || c.rY === null) return;
            startY = c.lY - lScroll;
            endY = c.rY - rScroll;
            if ((startY < -50 || startY > svgHeight + 50) && (endY < -50 || endY > svgHeight + 50)) {
                c.pathEl.setAttribute('d', ''); return;
            }
            startX = 0; endX = svgWidth;
        }

        const d = `M ${startX} ${startY} C ${startX + 40} ${startY}, ${endX - 40} ${endY}, ${endX} ${endY}`;
        c.pathEl.setAttribute('d', d);
    });
}

// ==========================================
// 9. UI 面板與高階事件綁定
// ==========================================
function renderChatsUI() {
    const container = $('#ds-chat-list-container');
    if (container.length === 0) return;
    container.empty();
    
    const totalBytes = getStorageSize(); 
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
        
        // 計算單個存檔大小
        const chatSize = JSON.stringify(chat).length * 2;

        const pinColor = isPinned ? 'var(--ds-yellow)' : 'rgba(255,255,255,0.2)';
        const item = document.createElement('div');
        item.className = `ds-chat-item ds-gpu-accel ds-virtual-list ${isActive ? 'active-chat' : ''}`;
        item.title = isActive ? '这是您当前的对话' : '';
        item.innerHTML = `
            <div style="display:flex; flex-direction:column; overflow:hidden; width:70%;">
                <span style="font-size:13px; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:${isActive?'var(--ds-cyan)':'#e5e5e5'}; text-shadow:${isActive?'0 0 8px rgba(0,229,255,0.4)':'none'};">${isActive ? '🟢 ' : ''}${escapeHtml(chat.label)}</span>
                <div style="display:flex; gap:12px; font-size:11px; margin-top:6px;">
                    <span style="color:var(--ds-green); background:rgba(152,195,121,0.1); padding:2px 6px; border-radius:4px;">节点: ${count}</span>
                    <span style="color:var(--ds-purple); background:rgba(198,120,221,0.1); padding:2px 6px; border-radius:4px;">${formatBytes(chatSize)}</span>
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

function generateDiagnosticReport() {
    const chatKeyInfo = getChatKey();
    const state = Settings.chats[chatKeyInfo.key] || {};
    
    let report = `=== DeepSeek Ultimate Truth Diagnostic Report ===\n`;
    report += `Generated: ${new Date().toISOString()}\n`;
    report += `User Agent: ${navigator.userAgent}\n\n`;
    
    report += `--- Current Chat State ---\n`;
    report += `Chat Key: ${chatKeyInfo.key}\n`;
    report += `Frozen Nodes: ${state.frozenSequence?.length || 0}\n`;
    report += `Multiverse Branches: ${state.multiverse?.length || 0}\n`;
    report += `Dynamic Anomalies Detected: ${state.dynamicAnomalies?.length || 0}\n\n`;
    
    report += `--- Plugin Settings ---\n`;
    report += JSON.stringify(Settings, null, 2) + `\n\n`;
    
    report += `--- Recent Logs (Last 100) ---\n`;
    const logLines = Array.from(document.querySelectorAll('#ds-cache-log-container .ds-log-line')).slice(-100);
    logLines.forEach(el => {
        report += el.innerText + `\n`;
    });
    
    const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob); 
    const a = document.createElement("a");
    a.href = url; 
    a.download = `DS_Diagnostic_${new Date().getTime()}.txt`;
    document.body.appendChild(a); 
    a.click(); 
    document.body.removeChild(a); 
    URL.revokeObjectURL(url);
    
    if (typeof toastr !== 'undefined') toastr.success("📄 诊断报告已生成并下载！");
}

function exportLogsAsJSON() {
    const logs = logQueue.concat(Array.from(document.querySelectorAll('#ds-cache-log-container .ds-log-line')).map(el => {
        return {
            time: el.querySelector('.ds-log-time')?.innerText.replace(/[\[\]]/g, '') || '',
            type: el.getAttribute('data-type') || 'info',
            msg: el.querySelector('.ds-log-content')?.innerText || el.innerText
        };
    }));
    
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); 
    const a = document.createElement("a");
    a.href = url; 
    a.download = `DS_Logs_${new Date().getTime()}.json`;
    document.body.appendChild(a); 
    a.click(); 
    document.body.removeChild(a); 
    URL.revokeObjectURL(url);
    if (typeof toastr !== 'undefined') toastr.success("📄 JSON 日志已导出！");
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
    
    updateTopBarState();
    if (typeof toastr !== 'undefined') toastr.success("🌟 已成功套用 DeepSeek 最佳化设定！");
}

async function setupUI() {
    try {
        injectCSS();
        const html = `
        <div class="inline-drawer" id="ds-v53-opt-drawer">
            <div class="inline-drawer-toggle inline-drawer-header" style="background: linear-gradient(90deg, rgba(0,229,255,0.1) 0%, rgba(0,0,0,0) 100%); border-left: 3px solid var(--ds-cyan);">
                <b style="color:var(--ds-cyan); text-shadow: 0 0 8px rgba(0,229,255,0.3);"><span class="fa-solid fa-microchip"></span> DeepSeek 终极真理优化器 (v53)</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down" style="color:var(--ds-cyan);"></div>
            </div>
            <div class="inline-drawer-content ds-scroll" style="padding:18px; background: rgba(0,0,0,0.2);">
                
                <button id="ds-btn-omni-vision" class="ds-btn ds-btn-omni"><i class="fa-solid fa-eye"></i> 👁️ 打开 Omni-Vision 终极真理沙盒 (即时预览)</button>
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
                                    <b style="color:var(--ds-cyan); text-shadow:0 0 5px rgba(0,229,255,0.4);">启动终极真理引擎 <span class="ds-perf-badge ds-perf-low">GPU 极限加速中</span></b>
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
                                    <b style="color:var(--ds-cyan);">🧊 绝对真理追加架构 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="强制接管 ST 的系统提示词排序。过去不可变，所有新增加的世界书、动态变量都会被强制追加到最底部。这是 100% 缓存的终极奥义！">?</span></b>
                                    <span>(ST 乱序不破缓存)</span>
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
                                    <b style="color:var(--ds-green);">🧹 模糊语义引擎 <span class="ds-perf-badge ds-perf-mid">中消耗</span> <span class="ds-tooltip-icon" title="自动压缩并忽略 ST 偷偷加入的空白符、换行符、甚至全半角标点差异。只要核心文字没变，缓存就绝对不断。">?</span></b>
                                    <span>(隐形排版与标点差异不破缓存)</span>
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
                                    <b style="color:#ff8c94;">🗑️ 吃书协议 <span class="ds-perf-badge ds-perf-low">低消耗</span> <span class="ds-tooltip-icon" title="当你删除了旧对话，系统会保留它，并在底部告诉AI「刚才那件事被抹除了」。">?</span></b>
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
                            <span style="font-size:11px; color:#abb2bf; margin-top:2px;">*选择「时空补丁」时，系统会保留旧对话，并在最底部偷偷塞一张纸条告诉AI你修改了什么。</span>
                        </div>
                    </div>
                </div>

                <!-- 3. 动态提示词诊断中心 -->
                <div class="ds-opt-group">
                    <div class="ds-opt-header" onclick="this.parentElement.classList.toggle('open')">
                        <span><i class="fa-solid fa-stethoscope"></i> 3. 缓存杀手体检中心</span> <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="ds-opt-content">
                        <p style="font-size:12px; color:#abb2bf; margin:0; line-height:1.5;">如果你的缓存命中率一直很低，可能是因为预设中包含了每次都会改变的变量（如时间、天气）。点击下方按钮进行体检。</p>
                        <button id="ds-btn-diagnostic" class="ds-btn ds-btn-blue" style="padding:12px; justify-content:center; border-radius:8px;"><i class="fa-solid fa-magnifying-glass"></i> 扫描当前对话的「缓存杀手」</button>
                        <hr style="border:0; border-top:1px dashed rgba(255,255,255,0.1); width:100%; margin:4px 0;">
                        <div class="ds-row" style="flex-direction:column; align-items:flex-start; gap:8px;">
                            <span style="font-size:13px; color:#abb2bf;">当系统抓到「缓存杀手」时，自动处理方式：</span>
                            <select id="ds-cache-dynamic-mode" class="ds-select-styled">
                                <option value="0" ${Settings.dynamicMode===0?'selected':''}>0: 首次弹窗询问我</option>
                                <option value="1" ${Settings.dynamicMode===1?'selected':''}>1: 写日记模式 (强烈推荐！100%缓存)</option>
                                <option value="2" ${Settings.dynamicMode===2?'selected':''}>2: 垫底模式 (99%缓存)</option>
                                <option value="3" ${Settings.dynamicMode===3?'selected':''}>3: 假装没看见 (100%缓存)</option>
                                <option value="4" ${Settings.dynamicMode===4?'selected':''}>4: 原位替换 (极度不推荐！烧钱)</option>
                                <option value="5" ${Settings.dynamicMode===5?'selected':''}>5: 直接删掉</option>
                            </select>
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
                                    <b style="color:#abb2bf;">开启详细协议弹窗提示 (Toast)</b>
                                    <span>(当触发吃书、时空补丁、微创手术等协议时，在右上角聚合提示)</span>
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
                            <button id="ds-btn-reset-settings" class="menu_button interactable" style="flex:1; padding:10px; font-size:12px; border-radius:6px; background:rgba(224,108,117,0.1); color:var(--ds-red);"><i class="fa-solid fa-rotate-left"></i> 恢复默认</button>
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
                            <span class="ds-log-filter" data-filter="error">报错</span>
                            <div style="flex:1;"></div>
                            <span id="ds-btn-pause-log" class="ds-mini-btn" title="暂停/恢复日志滚动" style="color:var(--ds-yellow); margin-right:12px; cursor:pointer; font-size:15px; transition:0.2s;"><i class="fa-solid fa-pause"></i></span>
                            <label style="color:#abb2bf; font-size:11px; display:flex; align-items:center; gap:4px; cursor:pointer; margin-right:10px;">
                                <input type="checkbox" id="ds-log-autoscroll" ${Settings.autoScrollLog ? 'checked' : ''} style="margin:0;"> 自动滚动
                            </label>
                            <span id="ds-btn-export-json" class="ds-mini-btn" title="导出 JSON 结构化日志" style="color:var(--ds-yellow); margin-right:12px; cursor:pointer; font-size:15px; transition:0.2s;"><i class="fa-solid fa-file-code"></i></span>
                            <span id="ds-btn-diagnostic-report" class="ds-mini-btn" title="生成诊断报告" style="color:var(--ds-purple); margin-right:12px; cursor:pointer; font-size:15px; transition:0.2s;"><i class="fa-solid fa-file-medical"></i></span>
                            <span id="ds-btn-copylog" class="ds-mini-btn" title="复制所有日志" style="color:var(--ds-cyan); margin-right:12px; cursor:pointer; font-size:15px; transition:0.2s;"><i class="fa-solid fa-copy"></i></span>
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
        $('#ds-log-autoscroll').on('change', function () { Settings.autoScrollLog = $(this).is(':checked'); safeSave(); });

        $('#ds-btn-diagnostic').on('click', showDiagnosticCenter);
        $('#ds-btn-diagnostic-report').on('click', generateDiagnosticReport);
        $('#ds-btn-export-json').on('click', exportLogsAsJSON);
        $('#ds-btn-undo-action').on('click', () => restoreVaultBackup(0));

        $('#ds-btn-reset-settings').on('click', () => {
            if(confirm("⚠️ 确定要恢复所有设置为默认值吗？")) {
                delete extension_settings.ds_cache_v53;
                initSettings();
                safeSave();
                location.reload();
            }
        });

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
            bigramCache.clear(); 
            safeSave(); renderChatsUI();
            if (typeof toastr !== 'undefined') toastr.success(`👻 碎片整理完毕！共清除了 ${count} 个未锁定的缓存，并释放了内存池。`);
        });
        
        $('.ds-log-filter').on('click', function() {
            $('.ds-log-filter').removeClass('active'); 
            $(this).addClass('active'); 
            applyLogFilters();
        });

        $('#ds-log-search').on('input', function() { applyLogFilters(); });
        $('#ds-btn-clearlog').on('click', () => { $('#ds-cache-log-container').empty(); logQueue = []; });
        
        $('#ds-btn-copylog').on('click', () => {
            const text = Array.from(document.querySelectorAll('#ds-cache-log-container .ds-log-line')).map(el => el.innerText).join('\n');
            navigator.clipboard.writeText(text).then(() => { if(typeof toastr !== 'undefined') toastr.success("📋 日志已复制到剪贴板！"); });
        });

        $('#ds-btn-export').on('click', () => {
            const blob = new Blob([JSON.stringify(Settings, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob); const a = document.createElement("a");
            a.href = url; a.download = `DeepSeek_Cache_Backup_v53_${new Date().getTime()}.json`;
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
        
        if (eventSource) {
            eventSource.on(event_types.CHAT_CHANGED, () => { 
                ensureTopMenuButton(); 
                renderChatsUI(); 
                sessionSnoozeReset = false; 
            });
            if (event_types?.CHAT_COMPLETION_PROMPT_READY) eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, interceptAndRestructurePrompt);
            
            if (event_types?.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, () => triggerToast('his_del', '您删除了历史对话，已标记断层！下次发送将原位修补。', 'warning', '🗑️'));
            if (event_types?.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, () => triggerToast('his_edit', '您修改了历史对话，已标记断层！下次发送将原位修补。', 'warning', '✏️'));
        }

        Logger.log('══════ 🚀 DeepSeek 终极真理优化器 v53 引擎上线 ══════', LogLevels.BASIC);
    } catch (e) {
        console.error('[DS Cache] 插件启动失败:', e);
    }
});
