/**
 * Shared 3D Holographic Spatial HUD for ALL Aegis Local Native Applications:
 * - Linux (.deb, .AppImage, .tar.gz, Electron)
 * - Windows (AegisDesktop.exe, Electron)
 * - Android (APK assets/aegis_hud.html with native window.AegisAndroid bridge)
 *
 * 100% self-contained (zero external CDN requests) so it runs offline at 60fps
 * on Linux desktops, Windows, and Android WebViews while matching and elevating
 * the Web 3D Jarvis Holographic Core interface.
 */

export function getLocalHoloUiHtml(options?: {
  platformMode?: 'desktop' | 'android';
  appVersion?: string;
}): string {
  const mode = options?.platformMode || 'desktop';
  const version = options?.appVersion || '2.1.0';

  return `<!doctype html>
<html lang="pt-BR" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <title>Aegis — Núcleo Holográfico Nativo</title>
  <style>
    :root {
      color-scheme: dark;
      --obsidian: #05070B;
      --surface: #0C111B;
      --panel-top: rgba(16, 22, 34, 0.94);
      --panel-bot: rgba(8, 12, 20, 0.97);
      --amber: #F59E0B;
      --gold: #FBBF24;
      --gold-soft: #FDE68A;
      --cyan: #38BDF8;
      --emerald: #34D399;
      --rose: #FB7185;
      --text: #F1F5F9;
      --muted: #94A3B8;
      --border: rgba(255, 255, 255, 0.09);
      --border-amber: rgba(245, 158, 11, 0.28);
      --font-display: 'Outfit', 'Plus Jakarta Sans', 'Segoe UI', system-ui, -apple-system, sans-serif;
      --font-sans: 'Public Sans', 'Segoe UI', system-ui, -apple-system, sans-serif;
      --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    }

    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body {
      height: 100%;
      width: 100%;
      margin: 0;
      overflow: hidden;
      background: var(--obsidian);
      color: var(--text);
      font-family: var(--font-sans);
      -webkit-font-smoothing: antialiased;
    }

    .font-display { font-family: var(--font-display); }
    .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
    .hidden { display: none !important; }
    button, input, textarea, select { font-family: inherit; }

    /* Full-Viewport 3D Holographic Core Stage */
    #core-stage {
      position: fixed;
      inset: 0;
      z-index: 1;
      background:
        radial-gradient(circle at 50% 48%, rgba(245, 158, 11, 0.10) 0%, rgba(56, 189, 248, 0.04) 34%, #05070B 72%);
      cursor: pointer;
    }
    #aegis-core-canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    /* Subtle Ambient Scanline & Vignette Depth (Compositor Only) */
    .stage-vignette {
      pointer-events: none;
      position: fixed;
      inset: 0;
      z-index: 2;
      background:
        radial-gradient(ellipse at center, transparent 42%, rgba(2, 4, 9, 0.72) 100%);
    }

    /* Floating Spatial Surfaces */
    .spatial-panel {
      background: linear-gradient(155deg, var(--panel-top) 0%, var(--panel-bot) 100%);
      border: 1px solid var(--border-amber);
      box-shadow:
        0 24px 64px -16px rgba(0, 0, 0, 0.88),
        0 0 0 1px rgba(255, 255, 255, 0.04) inset,
        0 1px 0 0 rgba(251, 191, 36, 0.16) inset;
    }
    .holo-screen-frame {
      background: linear-gradient(165deg, rgba(13, 18, 29, 0.94) 0%, rgba(7, 10, 17, 0.96) 100%);
      border: 1px solid rgba(245, 158, 11, 0.34);
      box-shadow:
        0 32px 84px -16px rgba(0, 0, 0, 0.92),
        0 0 42px -14px rgba(245, 158, 11, 0.24),
        0 1px 0 0 rgba(253, 224, 71, 0.22) inset;
      animation: holo-panel-in 240ms var(--ease-out) both;
    }
    .holo-dock {
      background: linear-gradient(180deg, rgba(15, 20, 32, 0.93) 0%, rgba(8, 11, 18, 0.96) 100%);
      border: 1px solid rgba(245, 158, 11, 0.30);
      box-shadow:
        0 20px 54px -12px rgba(0, 0, 0, 0.92),
        0 0 32px -12px rgba(245, 158, 11, 0.22),
        0 1px 0 0 rgba(251, 191, 36, 0.18) inset;
    }
    .spatial-drawer-3d {
      background: linear-gradient(165deg, rgba(14, 19, 30, 0.97) 0%, rgba(7, 10, 17, 0.99) 100%);
      border-right: 1px solid rgba(245, 158, 11, 0.28);
      box-shadow:
        28px 0 70px -12px rgba(0, 0, 0, 0.92),
        -1px 0 0 0 rgba(251, 191, 36, 0.16) inset;
      animation: drawer-in 210ms var(--ease-out) both;
    }

    @keyframes drawer-in {
      from { opacity: 0; transform: translateX(-22px); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes holo-panel-in {
      from { opacity: 0; transform: translateY(10px) scale(0.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes sweep-bar {
      0% { transform: translateX(-110%); }
      100% { transform: translateX(260%); }
    }
    .escalation-sweep {
      position: relative;
      overflow: hidden;
    }
    .escalation-sweep::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      height: 2px;
      width: 44%;
      background: linear-gradient(90deg, transparent, #F59E0B, #38BDF8, transparent);
      animation: sweep-bar 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }

    /* Top Minimal Floating Bar */
    .hud-header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 45;
      pointer-events: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: max(14px, env(safe-area-inset-top)) 18px 12px;
    }
    .hud-group {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .hud-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 38px;
      padding: 0 13px;
      border-radius: 12px;
      border: 1px solid rgba(245, 158, 11, 0.34);
      background: rgba(10, 14, 23, 0.92);
      color: var(--text);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: transform 160ms var(--ease-out), border-color 160ms var(--ease-out), background-color 160ms var(--ease-out);
      box-shadow: 0 10px 26px -10px rgba(0, 0, 0, 0.8);
    }
    .hud-btn:hover {
      border-color: rgba(251, 191, 36, 0.72);
      background: rgba(18, 24, 38, 0.96);
      transform: translateY(-1px);
    }
    .hud-btn.active {
      border-color: var(--gold);
      background: rgba(245, 158, 11, 0.18);
      color: var(--gold-soft);
    }
    .hud-btn.subtle {
      border-color: rgba(255, 255, 255, 0.12);
      color: #CBD5E1;
    }
    .hud-telemetry-text {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: var(--muted);
      padding: 0 6px;
      white-space: nowrap;
    }

    /* Spatial Hidden Menu Drawer */
    .drawer-backdrop {
      position: fixed;
      inset: 0;
      z-index: 48;
      background: rgba(2, 4, 10, 0.56);
    }
    .drawer-shell {
      position: fixed;
      top: 0;
      bottom: 0;
      left: 0;
      z-index: 50;
      width: min(312px, 86vw);
      display: flex;
      flex-direction: column;
      padding-top: max(12px, env(safe-area-inset-top));
    }
    .drawer-head {
      padding: 14px 20px;
      border-bottom: 1px solid rgba(245, 158, 11, 0.18);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .drawer-nav {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .nav-card {
      width: 100%;
      text-align: left;
      background: rgba(18, 25, 39, 0.55);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 12px;
      padding: 12px 14px;
      color: var(--text);
      cursor: pointer;
      transition: transform 170ms var(--ease-out), border-color 170ms var(--ease-out), background-color 170ms var(--ease-out);
    }
    .nav-card:hover {
      transform: translateX(3px);
      border-color: rgba(245, 158, 11, 0.42);
      background: rgba(245, 158, 11, 0.10);
    }
    .nav-card.active {
      border-color: rgba(251, 191, 36, 0.65);
      background: rgba(245, 158, 11, 0.16);
    }
    .nav-card-title { font-size: 13px; font-weight: 600; color: #F8FAFC; }
    .nav-card-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
    .drawer-foot {
      padding: 14px 18px max(16px, env(safe-area-inset-bottom));
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      flex-direction: column;
      gap: 10px;
      font-size: 12px;
    }

    /* Thinking Activity Popover */
    .thinking-popover {
      position: fixed;
      top: 62px;
      right: 18px;
      z-index: 46;
      width: min(410px, calc(100vw - 36px));
      max-height: 62vh;
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .thinking-body {
      padding: 12px 14px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 12px;
    }
    .trace-item {
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.07);
      background: rgba(6, 9, 16, 0.85);
      padding: 9px 11px;
    }

    /* Center-Right Floating Holographic Response / Screen */
    .holo-stage-right {
      position: fixed;
      top: 68px;
      right: 18px;
      bottom: 106px;
      z-index: 25;
      width: min(560px, calc(100vw - 36px));
      display: flex;
      flex-direction: column;
      border-radius: 18px;
      overflow: hidden;
    }
    .holo-screen-head {
      padding: 12px 16px;
      border-bottom: 1px solid rgba(245, 158, 11, 0.22);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      background: rgba(9, 13, 22, 0.88);
    }
    .chat-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .msg-card {
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(12, 17, 29, 0.90);
      padding: 11px 14px;
      font-size: 13px;
      line-height: 1.6;
      animation: holo-panel-in 190ms var(--ease-out) both;
    }
    .msg-card.user {
      background: rgba(245, 158, 11, 0.11);
      border-color: rgba(245, 158, 11, 0.34);
    }
    .msg-meta {
      font-size: 10.5px;
      color: var(--muted);
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-family: inherit; }

    /* Full Spatial Module Overlay (Terminal, Web, Memory, Drive, Usage, Android) */
    .module-overlay {
      position: fixed;
      top: 64px;
      left: 16px;
      right: 16px;
      bottom: 98px;
      z-index: 35;
      border-radius: 18px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: holo-panel-in 210ms var(--ease-out) both;
    }
    .module-head {
      padding: 13px 18px;
      border-bottom: 1px solid rgba(245, 158, 11, 0.20);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: rgba(10, 14, 24, 0.94);
    }
    .module-grid {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      padding: 16px;
      overflow-y: auto;
    }
    .sub-panel {
      background: rgba(7, 10, 18, 0.86);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }
    .sub-head {
      padding: 11px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12.5px;
      font-weight: 600;
      color: #E2E8F0;
    }
    .sub-body {
      padding: 12px 14px;
      overflow-y: auto;
      flex: 1;
    }
    .row-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 2px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 12.5px;
    }

    /* Core Floating Caption (when no screen open) */
    .core-caption {
      position: fixed;
      left: 50%;
      bottom: 108px;
      transform: translateX(-50%);
      z-index: 20;
      width: min(640px, calc(100vw - 32px));
      text-align: center;
      pointer-events: none;
    }
    .core-caption-text {
      display: inline-block;
      background: rgba(7, 10, 17, 0.84);
      border: 1px solid rgba(245, 158, 11, 0.26);
      border-radius: 14px;
      padding: 10px 16px;
      font-size: 13px;
      color: #E2E8F0;
      line-height: 1.5;
      pointer-events: auto;
      cursor: pointer;
    }

    /* Bottom Floating Command Dock */
    .dock-wrap {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 40;
      pointer-events: none;
      padding: 10px 16px max(16px, env(safe-area-inset-bottom));
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .dock-form {
      pointer-events: auto;
      width: min(820px, 100%);
      border-radius: 16px;
      padding: 8px 10px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Inputs & Buttons */
    input, textarea, select {
      background: rgba(6, 9, 16, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.11);
      color: var(--text);
      border-radius: 10px;
      padding: 9px 12px;
      font-size: 13px;
      width: 100%;
      outline: none;
      transition: border-color 150ms var(--ease-out);
    }
    input:focus, textarea:focus, select:focus { border-color: var(--amber); }
    .dock-input {
      background: transparent;
      border: 0;
      padding: 8px 6px;
      font-size: 13.5px;
      flex: 1;
      min-width: 0;
    }
    .dock-input:focus { border: 0; }
    .btn-primary {
      background: linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%);
      color: #090D16;
      border: 0;
      border-radius: 10px;
      padding: 9px 16px;
      min-height: 38px;
      font-weight: 700;
      font-size: 12.5px;
      cursor: pointer;
      white-space: nowrap;
      transition: transform 150ms var(--ease-out), filter 150ms var(--ease-out);
    }
    .btn-primary:hover { filter: brightness(1.08); transform: translateY(-1px); }
    .btn-primary:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn-ghost {
      background: rgba(20, 27, 41, 0.85);
      color: #E2E8F0;
      border: 1px solid rgba(255, 255, 255, 0.11);
      border-radius: 10px;
      padding: 7px 12px;
      min-height: 36px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: border-color 150ms var(--ease-out), background-color 150ms var(--ease-out);
    }
    .btn-ghost:hover { border-color: rgba(245, 158, 11, 0.48); background: rgba(245, 158, 11, 0.10); }
    .btn-mic {
      width: 38px;
      height: 38px;
      border-radius: 11px;
      border: 1px solid rgba(245, 158, 11, 0.34);
      background: rgba(245, 158, 11, 0.12);
      color: var(--gold);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
      transition: transform 150ms var(--ease-out), background-color 150ms var(--ease-out);
    }
    .btn-mic.listening {
      background: #F59E0B;
      color: #070B12;
      box-shadow: 0 0 24px rgba(245, 158, 11, 0.65);
    }
    .btn-danger {
      background: rgba(251, 113, 133, 0.14);
      color: #FDA4AF;
      border: 1px solid rgba(251, 113, 133, 0.34);
      border-radius: 8px;
      padding: 6px 11px;
      font-size: 11.5px;
      cursor: pointer;
    }

    /* Login Gate floating over Live 3D Core */
    .login-gate {
      position: fixed;
      inset: 0;
      z-index: 60;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(5, 7, 11, 0.45);
    }
    .login-card {
      width: min(410px, 100%);
      border-radius: 18px;
      padding: 28px;
    }
    .login-card h1 {
      margin: 0 0 6px;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .login-card p {
      margin: 0 0 20px;
      font-size: 13px;
      color: var(--muted);
      line-height: 1.5;
    }

    /* Security Confirmation Modal */
    .modal-bg {
      position: fixed;
      inset: 0;
      z-index: 75;
      background: rgba(2, 5, 12, 0.78);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
    }
    .modal-card {
      width: min(520px, 100%);
      border-radius: 16px;
      overflow: hidden;
    }

    /* Custom Scrollbars */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(245, 158, 11, 0.28); border-radius: 3px; }

    @media (max-width: 900px) {
      .module-grid { grid-template-columns: 1fr; }
      .hud-telemetry-text { display: none; }
      .model-select-wrap { display: none; }
      .holo-stage-right { left: 14px; right: 14px; width: auto; top: 64px; bottom: 96px; }
    }
  </style>
</head>
<body>
  <!-- FULL-VIEWPORT 3D HOLOGRAPHIC NEURAL CORE -->
  <div id="core-stage" onclick="onCoreTap()">
    <canvas id="aegis-core-canvas"></canvas>
  </div>
  <div class="stage-vignette"></div>

  <!-- LOGIN / SETUP OVERLAY (Desktop Local Daemon only; skipped automatically on Android APK) -->
  <div id="login-screen" class="login-gate hidden">
    <div class="login-card spatial-panel">
      <div class="mono" style="font-size:11px; color:var(--gold); margin-bottom:8px;">AEGIS NATIVO · v${version}</div>
      <h1 id="login-title" class="font-display">Aegis Desktop</h1>
      <p id="login-sub">Autentique-se para comandar o núcleo 3D local, terminal, arquivos, navegador autônomo e Google Workspace.</p>
      <form onsubmit="submitAuth(event)" style="display:flex; flex-direction:column; gap:12px;">
        <div>
          <label style="display:block; font-size:12px; color:var(--muted); margin-bottom:6px;">Operador Local</label>
          <input id="auth-user" placeholder="ex: juan" autocomplete="username" required />
        </div>
        <div>
          <label style="display:block; font-size:12px; color:var(--muted); margin-bottom:6px;">Senha Local</label>
          <input id="auth-pass" type="password" placeholder="••••••" autocomplete="current-password" required />
        </div>
        <div id="auth-err" style="font-size:12px; color:var(--rose);"></div>
        <button class="btn-primary" type="submit" id="auth-btn" style="width:100%;">Entrar no Núcleo</button>
      </form>
    </div>
  </div>

  <!-- MAIN SPATIAL HUD -->
  <div id="hud-root" class="hidden">
    <!-- Top Floating Bar -->
    <header class="hud-header">
      <div class="hud-group">
        <button type="button" class="hud-btn" id="btn-menu-toggle" onclick="toggleDrawer()">
          <span style="color:var(--gold); font-size:15px; line-height:1;">&#9776;</span>
          <span class="font-display" style="font-weight:600;">Menu</span>
          <span class="mono" style="font-size:10px; color:var(--muted); border-left:1px solid rgba(255,255,255,0.12); padding-left:7px;">Aegis · M</span>
        </button>

        <button type="button" class="hud-btn active hidden" id="btn-return-core" onclick="openModule(null)">
          <span>Núcleo 3D</span>
        </button>
      </div>

      <div class="hud-group">
        <div class="hud-telemetry-text mono" id="top-telemetry">
          <span id="hdr-host">Local</span>
          <span>·</span>
          <span id="hdr-cpu">CPU —</span>
          <span>·</span>
          <span id="hdr-ram">RAM —</span>
          <span>·</span>
          <span id="hdr-clock">--:--</span>
        </div>

        <button type="button" class="hud-btn subtle hidden" id="btn-restore-screen" onclick="setScreenMinimized(false)">
          <span>Abrir Tela</span>
        </button>

        <button type="button" class="hud-btn subtle" id="btn-activity" onclick="toggleThinkingPanel()">
          <span class="mono" id="activity-label">Atividade · Auto</span>
        </button>
      </div>
    </header>

    <!-- Hidden 3D Spatial Menu Drawer -->
    <div id="drawer-backdrop" class="drawer-backdrop hidden" onclick="toggleDrawer(false)"></div>
    <aside id="spatial-drawer" class="drawer-shell spatial-drawer-3d hidden">
      <div class="drawer-head">
        <div>
          <div class="font-display" style="font-size:17px; font-weight:700; color:#F8FAFC;">Aegis</div>
          <div class="mono" style="font-size:10.5px; color:var(--gold);" id="drawer-env-label">Núcleo Nativo v${version}</div>
        </div>
        <button type="button" class="btn-ghost" onclick="toggleDrawer(false)">Fechar</button>
      </div>

      <nav class="drawer-nav">
        <button type="button" class="nav-card active" data-mod="core" onclick="openModule(null)">
          <div class="nav-card-title">Núcleo 3D &amp; Comando</div>
          <div class="nav-card-sub">Holograma interativo, voz e telas flutuantes</div>
        </button>
        <button type="button" class="nav-card hidden" id="nav-android" data-mod="android" onclick="openModule('android')">
          <div class="nav-card-title">Sistema Android &amp; Permissões</div>
          <div class="nav-card-sub">Acessibilidade, notificações, /sdcard e pareamento</div>
        </button>
        <button type="button" class="nav-card" id="nav-sys" data-mod="sys" onclick="openModule('sys')">
          <div class="nav-card-title">Terminal &amp; Arquivos Locais</div>
          <div class="nav-card-sub">Shell nativo, pastas e editor embutido</div>
        </button>
        <button type="button" class="nav-card" id="nav-web" data-mod="web" onclick="openModule('web')">
          <div class="nav-card-title">Navegação Web &amp; Cofre AES-256</div>
          <div class="nav-card-sub">Automação em portais e credenciais seguras</div>
        </button>
        <button type="button" class="nav-card" id="nav-mem" data-mod="mem" onclick="openModule('mem')">
          <div class="nav-card-title">Memória Persistente</div>
          <div class="nav-card-sub">Fatos fixados, preferências e histórico</div>
        </button>
        <button type="button" class="nav-card" id="nav-cloud" data-mod="cloud" onclick="openModule('cloud')">
          <div class="nav-card-title">Google Workspace &amp; Drive</div>
          <div class="nav-card-sub">Arquivos sincronizados e visualização direta</div>
        </button>
        <button type="button" class="nav-card" id="nav-usage" data-mod="usage" onclick="openModule('usage')">
          <div class="nav-card-title">Consumo &amp; Modelos IA</div>
          <div class="nav-card-sub">Tokens acumulados e roteamento inteligente</div>
        </button>
      </nav>

      <div class="drawer-foot">
        <div>
          <div style="font-weight:600; color:#F8FAFC;" id="sb-user">Operador Local</div>
          <div class="mono" style="font-size:11px; color:var(--muted);" id="sb-tokens">0 tokens · 0 req</div>
        </div>
        <button type="button" class="btn-ghost" id="btn-logout" onclick="logoutLocal()" style="width:100%;">Encerrar Sessão</button>
      </div>
    </aside>

    <!-- Live Thinking & Activity Popover -->
    <div id="thinking-panel" class="thinking-popover spatial-panel hidden">
      <div class="module-head" style="padding:11px 14px;">
        <div>
          <div class="font-display" style="font-size:13px; font-weight:600; color:var(--gold-soft);">Pensamento &amp; Atividade</div>
          <div class="mono" style="font-size:10.5px; color:var(--muted);" id="thinking-sub">Núcleo pronto em espera</div>
        </div>
        <button type="button" class="btn-ghost" style="min-height:30px; padding:4px 10px;" onclick="toggleThinkingPanel(false)">Fechar</button>
      </div>
      <div id="thinking-trace" class="thinking-body">
        <div class="trace-item" style="color:var(--muted);">Envie um comando abaixo para acompanhar cada etapa do raciocínio e das ferramentas locais em tempo real.</div>
      </div>
    </div>

    <!-- Subtle Floating Core Caption (when screen minimized/closed) -->
    <div id="core-caption-wrap" class="core-caption">
      <div id="core-caption-text" class="core-caption-text" onclick="openConversationScreen()">
        Núcleo Holográfico Aegis pronto · Toque no núcleo para falar ou digite uma diretriz abaixo.
      </div>
    </div>

    <!-- Floating Holographic Conversation / Drawn Screen (Right of 3D Core) -->
    <section id="holo-screen" class="holo-stage-right holo-screen-frame hidden">
      <div class="holo-screen-head">
        <div style="min-width:0;">
          <div class="font-display" id="holo-screen-title" style="font-size:13.5px; font-weight:600; color:var(--gold-soft);">Console Holográfico Aegis</div>
          <div class="mono" id="holo-screen-meta" style="font-size:10.5px; color:var(--muted);">Núcleo Local Nativo</div>
        </div>
        <div style="display:flex; gap:6px; shrink:0;">
          <button type="button" class="btn-ghost" style="min-height:30px; padding:4px 10px;" onclick="quickPrompt('Verifique CPU, RAM e disco local e resuma.')">Diagnóstico</button>
          <button type="button" class="btn-ghost" style="min-height:30px; padding:4px 10px;" onclick="setScreenMinimized(true)">Minimizar</button>
        </div>
      </div>
      <div id="chat-log" class="chat-scroll">
        <div class="msg-card">
          <div class="msg-meta"><strong style="color:var(--gold);">Aegis</strong><span>·</span><span class="mono">Núcleo Holográfico Local</span></div>
          <pre>Interface holográfica nativa conectada. Comande arquivos locais, terminal, navegação web, Google Workspace e dispositivos Android diretamente por texto ou voz.</pre>
        </div>
      </div>
    </section>

    <!-- MODULE: ANDROID NATIVE CONTROL (Shown in Android APK) -->
    <section id="mod-android" class="module-overlay spatial-panel hidden">
      <div class="module-head">
        <div>
          <div class="font-display" style="font-size:15px; font-weight:700; color:var(--gold-soft);">Controle Nativo do Sistema Android</div>
          <div class="mono" id="and-status-line" style="font-size:11px; color:var(--emerald);">Verificando serviços Android...</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button type="button" class="btn-ghost" onclick="refreshAndroidStatus()">Atualizar</button>
          <button type="button" class="btn-primary" onclick="androidOpenRemoteHud()">Abrir HUD Nuvem</button>
        </div>
      </div>
      <div class="module-grid">
        <div class="sub-panel">
          <div class="sub-head"><span>1. Conexão com Orquestrador Aegis (Nuvem ou PC)</span></div>
          <div class="sub-body" style="display:flex; flex-direction:column; gap:12px;">
            <div>
              <label style="display:block; font-size:11.5px; color:var(--muted); margin-bottom:5px;">URL do Servidor Aegis</label>
              <input id="and-server-url" placeholder="https://seu-servidor-aegis.run.app ou http://192.168.x.x:3847" />
            </div>
            <div>
              <label style="display:block; font-size:11.5px; color:var(--muted); margin-bottom:5px;">Código de Pareamento (6 dígitos)</label>
              <input id="and-pair-code" class="mono" placeholder="Ex: A7K92P" />
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button type="button" class="btn-primary" style="flex:1;" onclick="androidConnectService()">Conectar &amp; Ativar Serviço</button>
              <button type="button" class="btn-danger" onclick="androidStopService()">Pausar</button>
            </div>
            <div id="and-connect-msg" class="mono" style="font-size:11.5px; color:var(--cyan);"></div>
          </div>
        </div>
        <div class="sub-panel">
          <div class="sub-head"><span>2. Permissões de Nível de Sistema</span></div>
          <div class="sub-body" style="display:flex; flex-direction:column; gap:10px;">
            <div class="row-item">
              <div>
                <div style="font-weight:600;">Acessibilidade (Toques, Gestos e Tela)</div>
                <div class="mono" id="and-perm-acc" style="font-size:11px; color:var(--muted);">Verificando...</div>
              </div>
              <button type="button" class="btn-ghost" onclick="androidCall('openAccessibilitySettings')">Ativar</button>
            </div>
            <div class="row-item">
              <div>
                <div style="font-weight:600;">Leitor de Notificações</div>
                <div class="mono" id="and-perm-notif" style="font-size:11px; color:var(--muted);">Verificando...</div>
              </div>
              <button type="button" class="btn-ghost" onclick="androidCall('openNotificationSettings')">Ativar</button>
            </div>
            <div class="row-item">
              <div>
                <div style="font-weight:600;">Acesso Total aos Arquivos (/sdcard)</div>
                <div class="mono" id="and-perm-files" style="font-size:11px; color:var(--muted);">Verificando...</div>
              </div>
              <button type="button" class="btn-ghost" onclick="androidCall('openFilesPermission')">Conceder</button>
            </div>
            <div class="row-item">
              <div>
                <div style="font-weight:600;">Manter Sempre Online (Bateria)</div>
                <div class="mono" id="and-perm-batt" style="font-size:11px; color:var(--muted);">Evita pausa em segundo plano</div>
              </div>
              <button type="button" class="btn-ghost" onclick="androidCall('openBatterySettings')">Configurar</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- MODULE: TERMINAL & LOCAL FILES -->
    <section id="mod-sys" class="module-overlay spatial-panel hidden">
      <div class="module-head">
        <div class="font-display" style="font-size:15px; font-weight:700; color:var(--gold-soft);">Terminal &amp; Arquivos Locais</div>
        <div style="display:flex; gap:8px;">
          <button type="button" class="btn-ghost" onclick="runPreset('free -h')">free -h</button>
          <button type="button" class="btn-ghost" onclick="runPreset('df -h')">df -h</button>
        </div>
      </div>
      <div class="module-grid">
        <div class="sub-panel">
          <div class="sub-head"><span>Terminal Nativo</span></div>
          <div id="sh-log" class="sub-body mono" style="font-size:12px;"></div>
          <form style="display:flex; gap:8px; padding:10px 12px; border-top:1px solid var(--border);" onsubmit="runShell(event)">
            <input id="sh-input" class="mono" placeholder="Comando shell..." />
            <button class="btn-primary" type="submit">Rodar</button>
          </form>
        </div>
        <div class="sub-panel">
          <div class="sub-head">
            <span class="mono" id="cwd-label" style="overflow:hidden; text-overflow:ellipsis;">~</span>
            <div style="display:flex; gap:6px;">
              <button type="button" class="btn-ghost hidden" id="local-back-btn" onclick="closeLocalViewer()">Arquivos</button>
              <button type="button" class="btn-ghost" onclick="goParentDir()">Subir</button>
              <button type="button" class="btn-ghost" onclick="loadFiles()">Atualizar</button>
            </div>
          </div>
          <div id="file-list" class="sub-body"></div>
          <div id="local-viewer" class="sub-body hidden" style="display:flex; flex-direction:column; gap:10px;"></div>
        </div>
      </div>
    </section>

    <!-- MODULE: WEB AUTOMATION & VAULT -->
    <section id="mod-web" class="module-overlay spatial-panel hidden">
      <div class="module-head">
        <div class="font-display" style="font-size:15px; font-weight:700; color:var(--gold-soft);">Navegação Web &amp; Cofre AES-256</div>
        <span class="mono" id="web-status" style="font-size:11.5px; color:var(--muted);">Aguardando URL</span>
      </div>
      <div class="module-grid">
        <div class="sub-panel">
          <div class="sub-head"><span>Navegador Autônomo</span></div>
          <form style="display:flex; gap:8px; padding:10px 12px; border-bottom:1px solid var(--border);" onsubmit="navWeb(event)">
            <input id="web-url" placeholder="https://..." />
            <button class="btn-primary" type="submit">Acessar</button>
          </form>
          <div id="web-preview" class="sub-body" style="font-size:12.5px;"><pre style="color:var(--muted);">Informe uma URL ou peça ao Aegis no comando abaixo para navegar, logar e extrair anexos.</pre></div>
        </div>
        <div class="sub-panel">
          <div class="sub-head"><span>Cofre Criptografado Local</span></div>
          <form style="padding:12px; border-bottom:1px solid var(--border); display:flex; flex-direction:column; gap:8px;" onsubmit="saveCred(event)">
            <input id="cr-site" placeholder="Nome do site (ex: Portal RH)" required />
            <input id="cr-url" placeholder="URL de login (https://...)" required />
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
              <input id="cr-user" placeholder="Usuário / e-mail" required />
              <input id="cr-pass" type="password" placeholder="Senha" required />
            </div>
            <button class="btn-primary" type="submit">Salvar no Cofre</button>
          </form>
          <div id="cred-list" class="sub-body"></div>
        </div>
      </div>
    </section>

    <!-- MODULE: MEMORY -->
    <section id="mod-mem" class="module-overlay spatial-panel hidden">
      <div class="module-head">
        <div class="font-display" style="font-size:15px; font-weight:700; color:var(--gold-soft);">Memória Persistente Local</div>
      </div>
      <div class="module-grid">
        <div class="sub-panel">
          <div class="sub-head"><span>Fatos &amp; Preferências</span></div>
          <form style="display:flex; gap:8px; padding:10px 12px; border-bottom:1px solid var(--border);" onsubmit="addFact(event)">
            <input id="fact-input" placeholder="Nova memória permanente..." />
            <button class="btn-primary" type="submit">Salvar</button>
          </form>
          <div id="facts-list" class="sub-body"></div>
        </div>
        <div class="sub-panel">
          <div class="sub-head"><span>Histórico Recente</span></div>
          <div id="events-list" class="sub-body"></div>
        </div>
      </div>
    </section>

    <!-- MODULE: GOOGLE DRIVE & WORKSPACE -->
    <section id="mod-cloud" class="module-overlay spatial-panel hidden">
      <div class="module-head">
        <div class="font-display" style="font-size:15px; font-weight:700; color:var(--gold-soft);">Google Workspace &amp; Drive</div>
        <button type="button" class="btn-ghost" onclick="loadGDrive('root', 'Meu Drive', true)">Raiz do Drive</button>
      </div>
      <div class="module-grid">
        <div class="sub-panel">
          <div class="sub-head"><span>Estrutura de Pastas</span></div>
          <div id="cloud-google" style="padding:10px 14px; border-bottom:1px solid var(--border); font-size:12px;">Carregando...</div>
          <div id="gdrive-bread" style="padding:8px 14px; border-bottom:1px solid var(--border); font-size:11.5px; color:var(--cyan);"></div>
          <div id="gdrive-list" class="sub-body"></div>
        </div>
        <div class="sub-panel">
          <div class="sub-head">
            <span id="gdrive-file-title">Visualizador &amp; Editor</span>
            <a id="gdrive-ext-link" href="#" target="_blank" rel="noopener noreferrer" class="hidden" style="font-size:11.5px; color:var(--cyan);">Abrir no Drive</a>
          </div>
          <div id="gdrive-viewer" class="sub-body" style="display:flex; flex-direction:column; gap:10px;">
            <pre style="color:var(--muted);">Sincronize sua conta Google pela interface web principal ou selecione um arquivo ao lado.</pre>
          </div>
        </div>
      </div>
    </section>

    <!-- MODULE: USAGE & MODELS -->
    <section id="mod-usage" class="module-overlay spatial-panel hidden">
      <div class="module-head">
        <div class="font-display" style="font-size:15px; font-weight:700; color:var(--gold-soft);">Consumo &amp; Roteamento de Modelos</div>
        <button type="button" class="btn-ghost" onclick="loadUsage()">Atualizar</button>
      </div>
      <div class="module-grid">
        <div class="sub-panel">
          <div class="sub-head"><span>Resumo por Modelo</span></div>
          <div id="usage-models" class="sub-body"></div>
        </div>
        <div class="sub-panel">
          <div class="sub-head"><span>Chamadas Recentes</span></div>
          <div id="usage-recent" class="sub-body"></div>
        </div>
      </div>
    </section>

    <!-- Floating Bottom Holographic Command Dock -->
    <div class="dock-wrap">
      <form class="dock-form holo-dock" onsubmit="sendCmd(event)">
        <button type="button" class="btn-mic" id="btn-mic" onclick="toggleVoiceInput()" title="Comando por Voz">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
        </button>

        <input id="cmd-input" class="dock-input" placeholder="Fale ou digite uma diretriz para o Aegis..." autocomplete="off" />

        <div class="model-select-wrap" style="width:155px; flex-shrink:0;">
          <select id="model-select" style="padding:7px 8px; font-size:11.5px; border-radius:9px;">
            <option value="auto">Modelo: Auto</option>
            <option value="gemini-3.1-flash-lite">Flash Lite</option>
            <option value="gemini-4-hydrogen">Hydrogen</option>
            <option value="gemini-4-argon">Argon</option>
            <option value="gemini-4-carbon">Carbon</option>
          </select>
        </div>

        <button class="btn-primary" type="submit" id="cmd-btn">Executar</button>
      </form>
    </div>
  </div>

  <!-- Confirmation Modal -->
  <div id="auth-modal" class="modal-bg hidden">
    <div class="modal-card spatial-panel">
      <div class="module-head" style="color:var(--gold);">Confirmação de Segurança Aegis</div>
      <div style="padding:16px; font-size:13px;">
        <div id="auth-desc" style="margin-bottom:10px;"></div>
        <pre id="auth-cmd" class="mono" style="background:rgba(5,8,15,0.92); padding:10px 12px; border-radius:10px; color:var(--gold-soft); border:1px solid rgba(245,158,11,0.25);"></pre>
      </div>
      <div style="padding:12px 16px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:10px;">
        <button type="button" class="btn-ghost" onclick="resolveModal(false)">Cancelar</button>
        <button type="button" class="btn-primary" onclick="resolveModal(true)">Confirmar</button>
      </div>
    </div>
  </div>

  <script>
    const PLATFORM_MODE = '${mode}';
    const IS_ANDROID_NATIVE = typeof window.AegisAndroid !== 'undefined' || PLATFORM_MODE === 'android';

    // =========================================================================
    // 1. 60FPS INTERACTIVE 3D HOLOGRAPHIC NEURAL CORE ENGINE
    //    (Fibonacci 3D Neural Lattice + Synaptic Arcs + 3 Gyroscopic Rings +
    //     72-Bar Reactive Corona + Expanding Shockwaves + Magnetic Parallax)
    // =========================================================================
    const CoreEngine = (() => {
      const canvas = document.getElementById('aegis-core-canvas');
      const ctx = canvas.getContext('2d');
      const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      let width = window.innerWidth;
      let height = window.innerHeight;
      let dpr = Math.min(window.devicePixelRatio || 1, 2);

      let coreState = 'idle'; // idle | listening | thinking | executing | speaking
      let targetOffsetX = 0;
      let currentOffsetX = 0;
      let mouseX = 0;
      let mouseY = 0;
      let smoothMX = 0;
      let smoothMY = 0;
      let audioEnergy = 0;
      let targetEnergy = 0;

      const shockwaves = [];

      // 190 Fibonacci sphere nodes in 3D space
      const NODES = [];
      const N = 190;
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < N; i++) {
        const y = 1 - (i / (N - 1)) * 2;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = goldenAngle * i;
        NODES.push({
          x: Math.cos(theta) * r,
          y,
          z: Math.sin(theta) * r,
          phase: Math.random() * Math.PI * 2,
        });
      }

      // 85 Starfield parallax particles
      const STARS = Array.from({ length: 85 }, () => ({
        x: (Math.random() - 0.5) * 2,
        y: (Math.random() - 0.5) * 2,
        z: 0.25 + Math.random() * 0.95,
        size: 0.6 + Math.random() * 1.5,
      }));

      function resize() {
        width = window.innerWidth;
        height = window.innerHeight;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      window.addEventListener('resize', resize);
      window.addEventListener('pointermove', (e) => {
        mouseX = (e.clientX / Math.max(1, width) - 0.5) * 2;
        mouseY = (e.clientY / Math.max(1, height) - 0.5) * 2;
      });
      resize();

      function triggerPulse(colorHex) {
        shockwaves.push({ r: 0.35, alpha: 0.88, color: colorHex || '#F59E0B' });
        targetEnergy = Math.min(1, targetEnergy + 0.65);
      }

      function setState(st) {
        if (coreState !== st) {
          coreState = st;
          const col = st === 'thinking' ? '#38BDF8' : st === 'executing' ? '#34D399' : '#F59E0B';
          triggerPulse(col);
        }
      }

      function setSplitOffset(hasRightPanel) {
        targetOffsetX = hasRightPanel && width > 920 ? -width * 0.20 : 0;
      }

      function paletteForState() {
        if (coreState === 'thinking') {
          return { main: [56, 189, 248], glow: [245, 158, 11], hot: [224, 242, 254] };
        }
        if (coreState === 'executing') {
          return { main: [52, 211, 153], glow: [245, 158, 11], hot: [209, 250, 229] };
        }
        if (coreState === 'listening') {
          return { main: [253, 224, 71], glow: [245, 158, 11], hot: [255, 251, 235] };
        }
        return { main: [245, 158, 11], glow: [251, 191, 36], hot: [254, 243, 199] };
      }

      function rot3D(x, y, z, ax, ay) {
        const cy = Math.cos(ay), sy = Math.sin(ay);
        const x1 = x * cy - z * sy;
        const z1 = x * sy + z * cy;
        const cx = Math.cos(ax), sx = Math.sin(ax);
        const y2 = y * cx - z1 * sx;
        const z2 = y * sx + z1 * cx;
        return { x: x1, y: y2, z: z2 };
      }

      function drawRing3D(cx, cy, radius, tiltX, tiltY, spin, ticks, colorStr, lineW, dashed) {
        ctx.save();
        ctx.beginPath();
        const segs = 96;
        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2 + spin;
          const p = rot3D(Math.cos(a), Math.sin(a), 0, tiltX, tiltY);
          const persp = 3.2 / (3.2 - p.z * 0.55);
          const sx = cx + p.x * radius * persp;
          const sy = cy + p.y * radius * persp;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.strokeStyle = colorStr;
        ctx.lineWidth = lineW;
        if (dashed) ctx.setLineDash([12, 9]);
        ctx.stroke();
        ctx.setLineDash([]);

        if (ticks > 0) {
          ctx.beginPath();
          for (let i = 0; i < ticks; i++) {
            const a = (i / ticks) * Math.PI * 2 + spin;
            const inner = i % 4 === 0 ? 0.90 : 0.945;
            const p0 = rot3D(Math.cos(a) * inner, Math.sin(a) * inner, 0, tiltX, tiltY);
            const p1 = rot3D(Math.cos(a), Math.sin(a), 0, tiltX, tiltY);
            const s0 = 3.2 / (3.2 - p0.z * 0.55);
            const s1 = 3.2 / (3.2 - p1.z * 0.55);
            ctx.moveTo(cx + p0.x * radius * s0, cy + p0.y * radius * s0);
            ctx.lineTo(cx + p1.x * radius * s1, cy + p1.y * radius * s1);
          }
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        ctx.restore();
      }

      let t = 0;
      function frame() {
        const speed = coreState === 'thinking' ? 0.022 : coreState === 'listening' ? 0.018 : 0.0085;
        if (!reducedMotion) t += speed;

        smoothMX += (mouseX - smoothMX) * 0.06;
        smoothMY += (mouseY - smoothMY) * 0.06;
        currentOffsetX += (targetOffsetX - currentOffsetX) * 0.08;

        const baseTarget = coreState === 'listening' ? 0.65 : coreState === 'thinking' ? 0.50 : coreState === 'executing' ? 0.42 : 0.10;
        targetEnergy += (baseTarget - targetEnergy) * 0.05;
        audioEnergy += (targetEnergy - audioEnergy) * 0.14;

        ctx.clearRect(0, 0, width, height);

        const pal = paletteForState();
        const cx = width * 0.5 + currentOffsetX + smoothMX * 14;
        const cy = height * 0.48 + smoothMY * 10;
        const baseR = Math.min(width, height) * (width < 700 ? 0.24 : 0.21);

        // 1. Parallax Starfield
        for (const s of STARS) {
          const sx = width * 0.5 + (s.x + smoothMX * 0.05 * s.z) * width * 0.55;
          const sy = height * 0.5 + (s.y + smoothMY * 0.05 * s.z) * height * 0.55;
          const twinkle = 0.22 + 0.35 * Math.sin(t * 2.4 + s.x * 11);
          ctx.fillStyle = 'rgba(' + pal.glow[0] + ',' + pal.glow[1] + ',' + pal.glow[2] + ',' + (twinkle * s.z).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(sx, sy, s.size, 0, Math.PI * 2);
          ctx.fill();
        }

        // 2. Volumetric Core Halo Bloom
        const pulse = 1 + Math.sin(t * 2.8) * 0.035 + audioEnergy * 0.09;
        const halo = ctx.createRadialGradient(cx, cy, baseR * 0.05, cx, cy, baseR * 2.35 * pulse);
        halo.addColorStop(0, 'rgba(' + pal.hot[0] + ',' + pal.hot[1] + ',' + pal.hot[2] + ',0.44)');
        halo.addColorStop(0.24, 'rgba(' + pal.main[0] + ',' + pal.main[1] + ',' + pal.main[2] + ',0.28)');
        halo.addColorStop(0.55, 'rgba(' + pal.glow[0] + ',' + pal.glow[1] + ',' + pal.glow[2] + ',0.08)');
        halo.addColorStop(1, 'rgba(5,7,11,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(cx, cy, baseR * 2.35 * pulse, 0, Math.PI * 2);
        ctx.fill();

        // 3. Expanding Shockwave Ripples
        for (let i = shockwaves.length - 1; i >= 0; i--) {
          const w = shockwaves[i];
          w.r += 0.024;
          w.alpha *= 0.945;
          if (w.alpha < 0.015) { shockwaves.splice(i, 1); continue; }
          ctx.save();
          ctx.strokeStyle = w.color;
          ctx.globalAlpha = w.alpha;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(cx, cy, baseR * w.r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // 4. Three Counter-Rotating 3D Gyroscopic Telemetry Rings
        drawRing3D(cx, cy, baseR * 1.48, 1.12 + smoothMY * 0.25, 0.32 + smoothMX * 0.25, t * 0.7, 48,
          'rgba(' + pal.main[0] + ',' + pal.main[1] + ',' + pal.main[2] + ',0.42)', 1.5, false);
        drawRing3D(cx, cy, baseR * 1.24, -0.78 + smoothMY * 0.2, 0.95 - smoothMX * 0.2, -t * 1.15, 36,
          'rgba(56,189,248,0.34)', 1.25, true);
        drawRing3D(cx, cy, baseR * 1.68, 0.42 - smoothMY * 0.18, -0.62 + smoothMX * 0.2, t * 0.42, 0,
          'rgba(' + pal.glow[0] + ',' + pal.glow[1] + ',' + pal.glow[2] + ',0.22)', 1.1, true);

        // 5. 72-Bar Reactive Audio / Neural Corona Ring
        const bars = 72;
        ctx.save();
        for (let i = 0; i < bars; i++) {
          const a = (i / bars) * Math.PI * 2 + t * 0.25;
          const wave = Math.abs(Math.sin(t * 4.5 + i * 0.45)) * (0.28 + audioEnergy * 1.25);
          const r0 = baseR * 1.04;
          const r1 = r0 + baseR * (0.045 + wave * 0.16);
          ctx.strokeStyle = 'rgba(' + pal.main[0] + ',' + pal.main[1] + ',' + pal.main[2] + ',' + (0.25 + wave * 0.45).toFixed(2) + ')';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
          ctx.stroke();
        }
        ctx.restore();

        // 6. Project 3D Neural Lattice Nodes + Synaptic Energy Filaments
        const ax = t * 0.45 + smoothMY * 0.55;
        const ay = t * 0.72 + smoothMX * 0.65;
        const projected = [];
        for (let i = 0; i < NODES.length; i++) {
          const n = NODES[i];
          const breathe = 1 + Math.sin(t * 3.1 + n.phase) * (0.04 + audioEnergy * 0.08);
          const p = rot3D(n.x * breathe, n.y * breathe, n.z * breathe, ax, ay);
          const scale = 3.0 / (3.0 - p.z * 0.85);
          projected.push({
            sx: cx + p.x * baseR * 0.84 * scale,
            sy: cy + p.y * baseR * 0.84 * scale,
            z: p.z,
            scale,
          });
        }

        // Synaptic filaments (front hemisphere for crisp depth)
        ctx.lineWidth = 0.85;
        for (let i = 0; i < projected.length; i += 2) {
          const a = projected[i];
          if (a.z < -0.25) continue;
          for (let j = i + 1; j < Math.min(i + 14, projected.length); j++) {
            const b = projected[j];
            const dx = a.sx - b.sx, dy = a.sy - b.sy;
            const d2 = dx * dx + dy * dy;
            const maxD = baseR * 0.34;
            if (d2 < maxD * maxD) {
              const alpha = (1 - Math.sqrt(d2) / maxD) * 0.38 * ((a.z + 1) * 0.5);
              ctx.strokeStyle = 'rgba(' + pal.glow[0] + ',' + pal.glow[1] + ',' + pal.glow[2] + ',' + alpha.toFixed(3) + ')';
              ctx.beginPath();
              ctx.moveTo(a.sx, a.sy);
              ctx.lineTo(b.sx, b.sy);
              ctx.stroke();
            }
          }
        }

        // Render sorted lattice nodes
        for (let i = 0; i < projected.length; i++) {
          const p = projected[i];
          const depthAlpha = Math.max(0.12, Math.min(0.95, (p.z + 1.15) * 0.48));
          const rad = (1.1 + p.scale * 1.15) * (p.z > 0.4 ? 1.15 : 0.85);
          ctx.fillStyle = p.z > 0.55
            ? 'rgba(' + pal.hot[0] + ',' + pal.hot[1] + ',' + pal.hot[2] + ',' + depthAlpha.toFixed(2) + ')'
            : 'rgba(' + pal.main[0] + ',' + pal.main[1] + ',' + pal.main[2] + ',' + depthAlpha.toFixed(2) + ')';
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, rad, 0, Math.PI * 2);
          ctx.fill();
        }

        // 7. Inner Incandescent Plasma Nucleus
        const nucR = baseR * (0.38 + audioEnergy * 0.07);
        const nuc = ctx.createRadialGradient(cx, cy, 2, cx, cy, nucR);
        nuc.addColorStop(0, 'rgba(255,252,235,0.92)');
        nuc.addColorStop(0.45, 'rgba(' + pal.main[0] + ',' + pal.main[1] + ',' + pal.main[2] + ',0.68)');
        nuc.addColorStop(1, 'rgba(' + pal.main[0] + ',' + pal.main[1] + ',' + pal.main[2] + ',0)');
        ctx.fillStyle = nuc;
        ctx.beginPath();
        ctx.arc(cx, cy, nucR, 0, Math.PI * 2);
        ctx.fill();

        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);

      return { setState, triggerPulse, setSplitOffset };
    })();

    // =========================================================================
    // 2. SPATIAL HUD STATE, VOICE & API BRIDGE (DESKTOP DAEMON + ANDROID APK)
    // =========================================================================
    let localToken = localStorage.getItem('aegis_local_token') || '';
    let needsSetup = false;
    let currentDir = '.';
    let parentDir = '.';
    let aiBusy = false;
    let modalResolve = null;
    let activeModule = null;
    let screenVisible = false;
    let drawerOpen = false;
    let thinkingOpen = false;
    const thinkingEntries = [];

    function esc(s) {
      return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function addTrace(stage, detail) {
      const time = new Date().toLocaleTimeString('pt-BR');
      thinkingEntries.unshift({ stage, detail, time });
      if (thinkingEntries.length > 30) thinkingEntries.pop();
      document.getElementById('thinking-sub').textContent = stage + ' · ' + time;
      document.getElementById('thinking-trace').innerHTML = thinkingEntries.map((item) =>
        '<div class="trace-item">' +
          '<div class="mono" style="font-size:10.5px; color:var(--gold); display:flex; justify-content:space-between;">' +
            '<span>' + esc(item.stage) + '</span><span>' + esc(item.time) + '</span>' +
          '</div>' +
          '<div style="color:#CBD5E1; margin-top:4px; line-height:1.45;">' + esc(item.detail) + '</div>' +
        '</div>'
      ).join('');
    }

    function setActivityState(busy, label) {
      const btn = document.getElementById('btn-activity');
      document.getElementById('activity-label').textContent = label;
      if (busy) btn.classList.add('escalation-sweep', 'active');
      else btn.classList.remove('escalation-sweep', 'active');
    }

    function toggleDrawer(force) {
      drawerOpen = typeof force === 'boolean' ? force : !drawerOpen;
      document.getElementById('spatial-drawer').classList.toggle('hidden', !drawerOpen);
      document.getElementById('drawer-backdrop').classList.toggle('hidden', !drawerOpen);
      document.getElementById('btn-menu-toggle').classList.toggle('active', drawerOpen);
    }

    function toggleThinkingPanel(force) {
      thinkingOpen = typeof force === 'boolean' ? force : !thinkingOpen;
      document.getElementById('thinking-panel').classList.toggle('hidden', !thinkingOpen);
    }

    function setScreenMinimized(min) {
      screenVisible = !min;
      const panel = document.getElementById('holo-screen');
      const restore = document.getElementById('btn-restore-screen');
      const caption = document.getElementById('core-caption-wrap');
      if (activeModule) {
        panel.classList.add('hidden');
        caption.classList.add('hidden');
        return;
      }
      panel.classList.toggle('hidden', !screenVisible);
      restore.classList.toggle('hidden', screenVisible);
      caption.classList.toggle('hidden', screenVisible);
      CoreEngine.setSplitOffset(screenVisible);
    }

    function openConversationScreen() {
      openModule(null);
      setScreenMinimized(false);
    }

    function openModule(modId) {
      activeModule = modId;
      toggleDrawer(false);
      document.querySelectorAll('.module-overlay').forEach((el) => el.classList.add('hidden'));
      document.querySelectorAll('.nav-card').forEach((c) => {
        c.classList.toggle('active', (modId === null && c.dataset.mod === 'core') || c.dataset.mod === modId);
      });
      document.getElementById('btn-return-core').classList.toggle('hidden', !modId);

      if (!modId) {
        document.getElementById('holo-screen').classList.toggle('hidden', !screenVisible);
        document.getElementById('core-caption-wrap').classList.toggle('hidden', screenVisible);
        CoreEngine.setSplitOffset(screenVisible);
        return;
      }

      document.getElementById('holo-screen').classList.add('hidden');
      document.getElementById('core-caption-wrap').classList.add('hidden');
      CoreEngine.setSplitOffset(false);
      const target = document.getElementById('mod-' + modId);
      if (target) target.classList.remove('hidden');

      if (modId === 'android') refreshAndroidStatus();
      if (modId === 'sys' && !IS_ANDROID_NATIVE) loadFiles(currentDir);
      if (modId === 'mem' && !IS_ANDROID_NATIVE) loadMem();
      if (modId === 'web' && !IS_ANDROID_NATIVE) loadCreds();
      if (modId === 'cloud' && !IS_ANDROID_NATIVE) loadConnections();
      if (modId === 'usage' && !IS_ANDROID_NATIVE) loadUsage();
    }

    // Keyboard shortcuts matching Web UI (M, Ctrl+K, Esc)
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggleDrawer();
      } else if (!inInput && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleDrawer();
      } else if (e.key === 'Escape') {
        if (thinkingOpen) toggleThinkingPanel(false);
        else if (drawerOpen) toggleDrawer(false);
        else if (activeModule) openModule(null);
      }
    });

    // Voice Command (Web Speech API)
    let recognition = null;
    let isListening = false;
    function toggleVoiceInput() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        CoreEngine.triggerPulse('#F59E0B');
        document.getElementById('cmd-input').focus();
        document.getElementById('core-caption-text').textContent = 'Digite sua diretriz abaixo (reconhecimento de voz indisponível neste navegador).';
        return;
      }
      if (isListening && recognition) {
        recognition.stop();
        return;
      }
      recognition = new SR();
      recognition.lang = 'pt-BR';
      recognition.interimResults = true;
      recognition.onstart = () => {
        isListening = true;
        document.getElementById('btn-mic').classList.add('listening');
        CoreEngine.setState('listening');
        document.getElementById('core-caption-text').textContent = 'Ouvindo... fale sua diretriz para o Aegis.';
      };
      recognition.onresult = (ev) => {
        let text = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          text += ev.results[i][0].transcript;
        }
        document.getElementById('cmd-input').value = text;
        if (ev.results[ev.results.length - 1].isFinal && text.trim()) {
          sendCmd(new Event('submit'));
        }
      };
      recognition.onerror = () => {
        isListening = false;
        document.getElementById('btn-mic').classList.remove('listening');
        CoreEngine.setState('idle');
      };
      recognition.onend = () => {
        isListening = false;
        document.getElementById('btn-mic').classList.remove('listening');
        if (!aiBusy) CoreEngine.setState('idle');
      };
      try { recognition.start(); } catch {}
    }

    function onCoreTap() {
      CoreEngine.triggerPulse('#FBBF24');
      if (!activeModule && !drawerOpen) {
        toggleVoiceInput();
      }
    }

    // =========================================================================
    // 3. ANDROID NATIVE BRIDGE HANDLERS (window.AegisAndroid)
    // =========================================================================
    function androidCall(methodName) {
      if (window.AegisAndroid && typeof window.AegisAndroid[methodName] === 'function') {
        try {
          window.AegisAndroid[methodName]();
          setTimeout(refreshAndroidStatus, 800);
        } catch (err) {
          document.getElementById('and-connect-msg').textContent = 'Erro: ' + err.message;
        }
      }
    }

    function refreshAndroidStatus() {
      if (!window.AegisAndroid || typeof window.AegisAndroid.getStatusJson !== 'function') return;
      try {
        const s = JSON.parse(window.AegisAndroid.getStatusJson());
        document.getElementById('hdr-host').textContent = (s.model || 'Android') + ' · API ' + (s.sdkInt || '');
        document.getElementById('hdr-cpu').textContent = 'Bateria ' + (s.batteryPercent >= 0 ? s.batteryPercent + '%' : '—');
        document.getElementById('hdr-ram').textContent = s.serviceRunning ? 'Serviço ATIVO' : 'Em espera';
        document.getElementById('and-status-line').textContent =
          (s.serviceRunning ? 'Serviço Nativo ATIVO · ' : 'Serviço parado · ') +
          (s.connectionState || 'Pronto para parear') +
          (s.lastError ? ' (' + s.lastError + ')' : '');
        const srvInput = document.getElementById('and-server-url');
        const codeInput = document.getElementById('and-pair-code');
        if (srvInput && !srvInput.value && s.serverOrigin) srvInput.value = s.serverOrigin;
        if (codeInput && !codeInput.value && s.pairingCode) codeInput.value = s.pairingCode;

        document.getElementById('and-perm-acc').textContent = s.accessibilityEnabled ? 'ATIVO — Controle de tela liberado' : 'Inativo — toque em Ativar';
        document.getElementById('and-perm-acc').style.color = s.accessibilityEnabled ? 'var(--emerald)' : 'var(--gold)';
        document.getElementById('and-perm-notif').textContent = s.notificationEnabled ? 'ATIVO — Leitura de notificações ativa' : 'Inativo — toque em Ativar';
        document.getElementById('and-perm-notif').style.color = s.notificationEnabled ? 'var(--emerald)' : 'var(--gold)';
        document.getElementById('and-perm-files').textContent = s.storageGranted ? 'ATIVO — Acesso completo a /sdcard' : 'Pendente — toque em Conceder';
        document.getElementById('and-perm-files').style.color = s.storageGranted ? 'var(--emerald)' : 'var(--gold)';
      } catch {}
    }

    function androidConnectService() {
      if (!window.AegisAndroid) return;
      const origin = document.getElementById('and-server-url').value.trim();
      const code = document.getElementById('and-pair-code').value.trim();
      CoreEngine.setState('executing');
      try {
        const res = JSON.parse(window.AegisAndroid.connectAndStart(origin, code));
        document.getElementById('and-connect-msg').textContent = res.message || (res.ok ? 'Serviço iniciado!' : 'Verifique a URL.');
        addTrace('Android Service', res.message || 'Conectando ao servidor Aegis...');
        setTimeout(() => { CoreEngine.setState('idle'); refreshAndroidStatus(); }, 1000);
      } catch (err) {
        document.getElementById('and-connect-msg').textContent = 'Falha: ' + err.message;
        CoreEngine.setState('idle');
      }
    }

    function androidStopService() {
      if (!window.AegisAndroid) return;
      try {
        window.AegisAndroid.stopService();
        document.getElementById('and-connect-msg').textContent = 'Serviço em segundo plano pausado.';
        setTimeout(refreshAndroidStatus, 400);
      } catch {}
    }

    function androidOpenRemoteHud() {
      if (!window.AegisAndroid) return;
      const origin = document.getElementById('and-server-url').value.trim();
      window.AegisAndroid.openRemoteHud(origin);
    }

    // =========================================================================
    // 4. DESKTOP LOCAL DAEMON API CLIENT (127.0.0.1:3847)
    // =========================================================================
    async function apiFetch(url, opts = {}) {
      const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      if (localToken) {
        headers['X-Aegis-Local-Token'] = localToken;
        headers['Authorization'] = 'Bearer ' + localToken;
      }
      const r = await fetch(url, Object.assign({}, opts, { headers }));
      if (r.status === 401) {
        localToken = '';
        localStorage.removeItem('aegis_local_token');
        showLogin();
      }
      return r;
    }

    function showLogin() {
      document.getElementById('login-screen').classList.remove('hidden');
      document.getElementById('hud-root').classList.add('hidden');
    }

    function showApp(username) {
      document.getElementById('sb-user').textContent = username || 'Operador Local';
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('hud-root').classList.remove('hidden');
      CoreEngine.triggerPulse('#F59E0B');
      if (IS_ANDROID_NATIVE) {
        document.getElementById('nav-android').classList.remove('hidden');
        document.getElementById('drawer-env-label').textContent = 'Android Nativo · v${version}';
        document.getElementById('btn-logout').classList.add('hidden');
        document.getElementById('core-caption-text').textContent =
          'Aegis Android Nativo pronto · Abra o Menu para parear, ativar Acessibilidade ou abrir a HUD na nuvem.';
        refreshAndroidStatus();
      } else {
        pollTelemetry();
        loadUsage();
      }
    }

    async function checkAuth() {
      if (IS_ANDROID_NATIVE) {
        showApp('Android Nativo');
        return;
      }
      try {
        const s = await (await fetch('/auth/status', { headers: localToken ? { 'X-Aegis-Local-Token': localToken } : {} })).json();
        needsSetup = Boolean(s.needsSetup);
        document.getElementById('login-title').textContent = needsSetup ? 'Configurar Operador Local' : 'Entrar no Aegis Desktop';
        document.getElementById('auth-btn').textContent = needsSetup ? 'Criar Conta Local' : 'Entrar no Núcleo';
        if (s.authenticated) showApp(s.username);
        else showLogin();
      } catch {
        showLogin();
      }
    }

    async function submitAuth(e) {
      e.preventDefault();
      const username = document.getElementById('auth-user').value.trim();
      const password = document.getElementById('auth-pass').value;
      const errEl = document.getElementById('auth-err');
      errEl.textContent = '';
      const r = await fetch(needsSetup ? '/auth/setup' : '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const d = await r.json();
      if (!r.ok) { errEl.textContent = d.error || 'Falha na autenticação.'; return; }
      localToken = d.token;
      localStorage.setItem('aegis_local_token', localToken);
      showApp(d.username);
    }

    async function logoutLocal() {
      await apiFetch('/auth/logout', { method: 'POST' });
      localToken = '';
      localStorage.removeItem('aegis_local_token');
      checkAuth();
    }

    function askAuth(desc, command) {
      document.getElementById('auth-desc').textContent = desc;
      document.getElementById('auth-cmd').textContent = command;
      document.getElementById('auth-modal').classList.remove('hidden');
      return new Promise((resolve) => { modalResolve = resolve; });
    }
    function resolveModal(ok) {
      document.getElementById('auth-modal').classList.add('hidden');
      if (modalResolve) { modalResolve(ok); modalResolve = null; }
    }

    async function pollTelemetry() {
      if (IS_ANDROID_NATIVE) { refreshAndroidStatus(); return; }
      if (!localToken) return;
      try {
        const s = await (await apiFetch('/status')).json();
        if (s.error) return;
        const ramUsed = s.totalMemMb - s.freeMemMb;
        document.getElementById('hdr-host').textContent = s.hostname + ' · ' + s.arch;
        document.getElementById('hdr-cpu').textContent = 'CPU ' + (s.loadAvg[0] || 0);
        document.getElementById('hdr-ram').textContent = ramUsed + '/' + s.totalMemMb + ' MB';
      } catch {}
    }

    async function loadUsage() {
      if (IS_ANDROID_NATIVE || !localToken) return;
      try {
        const u = await (await apiFetch('/usage')).json();
        if (!u.totals) return;
        document.getElementById('sb-tokens').textContent = u.totals.totalTokens + ' tokens · ' + u.totals.requests + ' req';
        document.getElementById('usage-models').innerHTML = (u.byModel || []).map((m) =>
          '<div class="row-item"><div><strong>' + esc(m.model) + '</strong></div><div class="mono" style="color:var(--gold-soft);">' + m.requests + ' req · ' + m.totalTokens + ' tok</div></div>'
        ).join('') || '<div style="color:var(--muted); font-size:12.5px;">Nenhuma requisição registrada ainda.</div>';
        document.getElementById('usage-recent').innerHTML = (u.recent || []).map((r) =>
          '<div class="row-item"><div><div>' + esc(r.model) + ' (' + esc(r.mode) + ')</div><div style="font-size:11px; color:var(--muted);">' + esc(r.reason) + '</div></div><div class="mono">' + r.totalTokens + ' tok · ' + r.latencyMs + 'ms</div></div>'
        ).join('') || '<div style="color:var(--muted); font-size:12.5px;">Sem histórico ainda.</div>';
      } catch {}
    }

    function quickPrompt(t) {
      document.getElementById('cmd-input').value = t;
      sendCmd(new Event('submit'));
    }

    async function sendCmd(e) {
      e.preventDefault();
      const inp = document.getElementById('cmd-input');
      const prompt = inp.value.trim();
      if (!prompt || aiBusy) return;
      inp.value = '';

      if (IS_ANDROID_NATIVE) {
        openConversationScreen();
        const log = document.getElementById('chat-log');
        log.innerHTML += '<div class="msg-card user"><div class="msg-meta"><strong>Você</strong></div><pre>' + esc(prompt) + '</pre></div>';
        CoreEngine.triggerPulse('#38BDF8');
        if (/acessibilidade|accessibility/i.test(prompt)) {
          androidCall('openAccessibilitySettings');
          log.innerHTML += '<div class="msg-card"><div class="msg-meta"><strong style="color:var(--gold);">Aegis Android</strong></div><pre>Abrindo configurações de Acessibilidade do Android...</pre></div>';
        } else if (/notifica/i.test(prompt)) {
          androidCall('openNotificationSettings');
          log.innerHTML += '<div class="msg-card"><div class="msg-meta"><strong style="color:var(--gold);">Aegis Android</strong></div><pre>Abrindo permissões de Notificações do Android...</pre></div>';
        } else if (/nuvem|hud|servidor|web/i.test(prompt)) {
          log.innerHTML += '<div class="msg-card"><div class="msg-meta"><strong style="color:var(--gold);">Aegis Android</strong></div><pre>Carregando HUD completa do servidor Aegis...</pre></div>';
          androidOpenRemoteHud();
        } else {
          log.innerHTML += '<div class="msg-card"><div class="msg-meta"><strong style="color:var(--gold);">Aegis Android</strong></div><pre>Para conversar com o Gemini na nuvem ou controlar seu PC, abra Menu -> Sistema Android &amp; Permissões -> clique em "Abrir HUD Nuvem" ou conecte seu código de pareamento.</pre></div>';
        }
        log.scrollTop = log.scrollHeight;
        return;
      }

      aiBusy = true;
      openConversationScreen();
      CoreEngine.setState('thinking');
      setActivityState(true, 'Analisando diretriz...');
      addTrace('Diretriz Recebida', prompt);
      document.getElementById('cmd-btn').textContent = 'Pensando...';
      document.getElementById('cmd-btn').disabled = true;

      const log = document.getElementById('chat-log');
      log.innerHTML += '<div class="msg-card user"><div class="msg-meta"><strong>Você</strong></div><pre>' + esc(prompt) + '</pre></div>';
      log.scrollTop = log.scrollHeight;

      try {
        const modelPreference = document.getElementById('model-select').value;
        const r = await apiFetch('/command', { method: 'POST', body: JSON.stringify({ prompt, modelPreference }) });
        const d = await r.json();
        CoreEngine.setState('executing');
        const modelUsed = d.usage?.model || modelPreference;
        const uMeta = d.usage ? ' · ' + esc(d.usage.model) + ' · ' + d.usage.totalTokens + ' tok · ' + d.usage.latencyMs + 'ms' : '';
        addTrace('Resposta (' + modelUsed + ')', (d.reply || d.error || 'Concluído.').slice(0, 220));
        setActivityState(false, 'Pensamento · ' + modelUsed.replace('gemini-', ''));

        document.getElementById('holo-screen-meta').textContent = modelUsed + (d.usage ? ' · ' + d.usage.latencyMs + 'ms' : '');
        document.getElementById('core-caption-text').textContent = (d.reply || d.error || 'Concluído.').slice(0, 150);

        log.innerHTML += '<div class="msg-card"><div class="msg-meta"><strong style="color:var(--gold);">Aegis</strong><span class="mono">' + uMeta + '</span></div><pre>' + esc(d.reply || d.error || 'Concluído.') + '</pre></div>';

        for (const p of (d.pendingConfirmations || [])) {
          const ok = await askAuth('Confirmação necessária:', p.command);
          if (ok) {
            CoreEngine.setState('executing');
            addTrace('Ação Confirmada', p.command);
            const er = await apiFetch('/command', {
              method: 'POST',
              body: JSON.stringify(p.type === 'web_login' ? { confirmedWebLogin: p.payload } : { confirmedCommand: p.command }),
            });
            const ed = await er.json();
            const text = (ed.summary ? ed.summary + '\\n\\nSaída:\\n' : '') + (ed.stdout || ed.stderr || 'Executado.');
            log.innerHTML += '<div class="msg-card" style="border-color:rgba(52,211,153,0.4);"><div class="msg-meta" style="color:var(--emerald);">Execução Confirmada</div><pre class="mono">' + esc(text) + '</pre></div>';
          }
        }
        loadUsage();
      } catch (err) {
        addTrace('Erro', err.message);
        setActivityState(false, 'Atividade · Erro');
        log.innerHTML += '<div class="msg-card" style="border-color:rgba(251,113,133,0.45);"><div class="msg-meta" style="color:var(--rose);">Erro</div><pre>' + esc(err.message) + '</pre></div>';
      } finally {
        aiBusy = false;
        CoreEngine.setState('idle');
        document.getElementById('cmd-btn').textContent = 'Executar';
        document.getElementById('cmd-btn').disabled = false;
        log.scrollTop = log.scrollHeight;
      }
    }

    // Embedded File Viewer & Editor
    const activeBlobUrls = { local: null, gdrive: null };
    let currentLocalFile = null;
    let currentGDriveFile = null;

    function setBlobUrl(slot, blob) {
      if (activeBlobUrls[slot]) URL.revokeObjectURL(activeBlobUrls[slot]);
      activeBlobUrls[slot] = URL.createObjectURL(blob);
      return activeBlobUrls[slot];
    }

    async function fetchMediaBlobUrl(slot, url) {
      const headers = {};
      if (localToken) headers['X-Aegis-Local-Token'] = localToken;
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return setBlobUrl(slot, await r.blob());
    }

    function renderEmbeddedViewerHtml(prefix, file, mediaUrl) {
      const editable = Boolean(file.editable);
      const isCsv = /\\.(csv|tsv)$/i.test(file.name || '') || file.mimeType === 'text/csv';
      let bar = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:8px;">';
      bar += '<div style="display:flex;gap:6px;">';
      bar += '<button type="button" class="btn-ghost" onclick="switchViewMode(\\'' + prefix + '\\', \\'preview\\')">Visualizar</button>';
      if (editable) bar += '<button type="button" class="btn-ghost" onclick="switchViewMode(\\'' + prefix + '\\', \\'edit\\')">Editor</button>';
      bar += '</div>';
      if (editable) bar += '<button type="button" class="btn-primary" onclick="saveCurrentFile(\\'' + prefix + '\\')">Salvar</button>';
      bar += '</div>';

      let previewHtml = '';
      if (file.kind === 'pdf' || (file.kind === 'slides' && mediaUrl)) {
        previewHtml = '<iframe src="' + mediaUrl + '" style="width:100%;height:100%;min-height:340px;border:0;background:#fff;border-radius:8px;"></iframe>';
      } else if (file.kind === 'image' && mediaUrl) {
        previewHtml = '<div style="display:flex;justify-content:center;align-items:center;height:100%;overflow:auto;"><img src="' + mediaUrl + '" style="max-width:100%;max-height:380px;border-radius:8px;" /></div>';
      } else if (file.kind === 'audio' && mediaUrl) {
        previewHtml = '<div style="padding:20px;text-align:center;"><audio controls src="' + mediaUrl + '" style="width:100%;max-width:400px;"></audio></div>';
      } else if (file.kind === 'video' && mediaUrl) {
        previewHtml = '<div style="display:flex;justify-content:center;"><video controls src="' + mediaUrl + '" style="max-width:100%;max-height:380px;border-radius:8px;"></video></div>';
      } else if (isCsv && file.textContent) {
        const rows = file.textContent.split(/\\r?\\n/).filter(Boolean).slice(0, 120).map((r) => r.split(','));
        previewHtml = '<div style="overflow:auto;max-height:360px;"><table style="width:100%;border-collapse:collapse;font-size:12px;">' + rows.map((row, ri) => '<tr>' + row.map((c) => '<td style="border:1px solid var(--border);padding:5px 8px;' + (ri === 0 ? 'font-weight:700;color:var(--gold);' : '') + '">' + esc(c) + '</td>').join('') + '</tr>').join('') + '</table></div>';
      } else if (file.textContent || file.content) {
        previewHtml = '<pre class="mono" style="font-size:12px;line-height:1.6;">' + esc(file.textContent ?? file.content) + '</pre>';
      } else {
        previewHtml = '<div style="color:var(--muted);font-size:12.5px;">Tipo: ' + esc(file.mimeType || 'binário') + '</div>';
      }

      const editVal = esc(file.textContent ?? file.content ?? '');
      const editHtml = editable
        ? '<textarea id="' + prefix + '-editor" class="mono" style="flex:1;min-height:320px;font-size:12px;line-height:1.6;resize:none;">' + editVal + '</textarea>'
        : '';

      return bar + '<div id="' + prefix + '-preview-box" style="flex:1;min-height:0;overflow:auto;">' + previewHtml + '</div><div id="' + prefix + '-edit-box" class="hidden" style="flex:1;min-height:0;display:flex;flex-direction:column;">' + editHtml + '</div>';
    }

    function switchViewMode(prefix, mode) {
      const p = document.getElementById(prefix + '-preview-box');
      const e = document.getElementById(prefix + '-edit-box');
      if (!p || !e) return;
      p.classList.toggle('hidden', mode === 'edit');
      e.classList.toggle('hidden', mode !== 'edit');
    }

    async function saveCurrentFile(prefix) {
      const ed = document.getElementById(prefix + '-editor');
      if (!ed) return;
      const newContent = ed.value;
      if (prefix === 'local' && currentLocalFile) {
        if (!(await askAuth('Salvar alterações no arquivo local?', currentLocalFile.path))) return;
        const r = await (await apiFetch('/file/save', { method: 'POST', body: JSON.stringify({ path: currentLocalFile.path, content: newContent }) })).json();
        if (!r.error) { currentLocalFile.content = newContent; openLocalFile(currentLocalFile.path); }
      } else if (prefix === 'gdrive' && currentGDriveFile) {
        if (!(await askAuth('Salvar alterações no Google Drive?', currentGDriveFile.name))) return;
        const r = await (await apiFetch('/google/drive/save', { method: 'POST', body: JSON.stringify({ id: currentGDriveFile.id, kind: currentGDriveFile.kind, mimeType: currentGDriveFile.mimeType, content: newContent }) })).json();
        if (!r.error) openGFile(currentGDriveFile.id);
      }
    }

    function closeLocalViewer() {
      document.getElementById('local-viewer').classList.add('hidden');
      document.getElementById('file-list').classList.remove('hidden');
      document.getElementById('local-back-btn').classList.add('hidden');
      currentLocalFile = null;
    }

    async function openLocalFile(fullPath) {
      document.getElementById('file-list').classList.add('hidden');
      const viewer = document.getElementById('local-viewer');
      viewer.classList.remove('hidden');
      document.getElementById('local-back-btn').classList.remove('hidden');
      viewer.innerHTML = '<span class="mono" style="color:var(--muted);">Abrindo arquivo...</span>';
      const d = await (await apiFetch('/file?path=' + encodeURIComponent(fullPath))).json();
      if (d.error) { viewer.innerHTML = '<div style="color:var(--rose);">' + esc(d.error) + '</div>'; return; }
      currentLocalFile = d;
      let mediaUrl = null;
      if (d.kind === 'pdf' || d.kind === 'image' || d.kind === 'audio' || d.kind === 'video') {
        try { mediaUrl = await fetchMediaBlobUrl('local', '/file/media?path=' + encodeURIComponent(fullPath)); } catch {}
      }
      viewer.innerHTML = renderEmbeddedViewerHtml('local', d, mediaUrl);
    }

    async function loadFiles(dirPath = currentDir) {
      closeLocalViewer();
      const f = await (await apiFetch('/files?path=' + encodeURIComponent(dirPath))).json();
      if (f.error) return;
      currentDir = f.dir; parentDir = f.parentDir || '.';
      document.getElementById('cwd-label').textContent = f.dir;
      document.getElementById('file-list').innerHTML = (f.entries || []).map((x) => {
        const sp = esc(x.fullPath).replace(/'/g, '&#39;');
        if (x.type === 'directory') return '<div class="row-item" style="cursor:pointer;" onclick="loadFiles(\\'' + sp + '\\')"><span class="mono" style="color:var(--gold);">[DIR] ' + esc(x.name) + '</span><span class="mono" style="color:var(--muted);">abrir</span></div>';
        return '<div class="row-item" style="cursor:pointer;" onclick="openLocalFile(\\'' + sp + '\\')"><span class="mono">' + esc(x.name) + '</span><span class="mono" style="color:var(--muted);">' + x.sizeBytes + ' B</span></div>';
      }).join('');
    }
    function goParentDir() { loadFiles(parentDir); }
    function runPreset(c) { document.getElementById('sh-input').value = c; runShell(new Event('submit')); }
    async function runShell(e) {
      e.preventDefault();
      const inp = document.getElementById('sh-input');
      const command = inp.value.trim();
      if (!command) return;
      inp.value = '';
      const box = document.getElementById('sh-log');
      box.innerHTML += '<div style="color:var(--gold);margin-top:6px;">$ ' + esc(command) + '</div>';
      let r = await (await apiFetch('/exec', { method: 'POST', body: JSON.stringify({ command, confirmed: false }) })).json();
      if (r.requiresConfirmation) {
        if (!(await askAuth('Este comando altera estado local:', command))) return;
        r = await (await apiFetch('/exec', { method: 'POST', body: JSON.stringify({ command, confirmed: true }) })).json();
      }
      box.innerHTML += '<pre>' + esc(r.stdout || r.stderr || 'OK') + '</pre>';
      box.scrollTop = box.scrollHeight;
    }

    async function loadMem() {
      const m = await (await apiFetch('/memory')).json();
      document.getElementById('facts-list').innerHTML = (m.facts || []).map((f) =>
        '<div class="row-item"><div>' + esc(f.content) + '</div><button type="button" class="btn-danger" onclick="delFact(' + f.id + ')">Remover</button></div>'
      ).join('') || '<div style="color:var(--muted);">Sem fatos salvos.</div>';
      document.getElementById('events-list').innerHTML = (m.recent || []).slice().reverse().map((ev) =>
        '<div class="row-item"><div><div class="mono" style="font-size:11px;color:var(--gold);">' + esc(ev.role || 'evento') + '</div><div>' + esc(ev.content || ev.command || ev.filename || '') + '</div></div></div>'
      ).join('') || '<div style="color:var(--muted);">Sem eventos.</div>';
    }
    async function addFact(e) {
      e.preventDefault();
      const inp = document.getElementById('fact-input');
      if (!inp.value.trim()) return;
      await apiFetch('/memory/facts', { method: 'POST', body: JSON.stringify({ fact: inp.value.trim() }) });
      inp.value = ''; loadMem();
    }
    async function delFact(id) { await apiFetch('/memory/facts?id=' + id, { method: 'DELETE' }); loadMem(); }

    async function navWeb(e) {
      e.preventDefault();
      const url = document.getElementById('web-url').value.trim();
      if (!url) return;
      document.getElementById('web-status').textContent = 'Carregando...';
      const d = await (await apiFetch('/web/navigate', { method: 'POST', body: JSON.stringify({ url }) })).json();
      if (d.error) { document.getElementById('web-status').textContent = d.error; return; }
      const s = d.snapshot;
      document.getElementById('web-status').textContent = 'HTTP ' + s.status + ' · ' + s.cookieCount + ' cookies';
      document.getElementById('web-preview').innerHTML = '<div style="margin-bottom:8px;"><strong>' + esc(s.title) + '</strong><div class="mono" style="font-size:11px;color:var(--muted);">' + esc(s.url) + '</div></div><pre>' + esc(s.textPreview) + '</pre>';
    }
    async function loadCreds() {
      const d = await (await apiFetch('/web/credentials')).json();
      document.getElementById('cred-list').innerHTML = (d.credentials || []).map((c) =>
        '<div class="row-item"><div><strong>' + esc(c.siteName) + '</strong><div class="mono" style="font-size:11px;color:var(--muted);">' + esc(c.username) + ' · ' + esc(c.loginUrl) + '</div></div><div style="display:flex;gap:6px;"><button type="button" class="btn-ghost" onclick="testCredLogin(' + c.id + ')">Logar</button><button type="button" class="btn-danger" onclick="delCred(' + c.id + ')">Excluir</button></div></div>'
      ).join('') || '<div style="color:var(--muted);">Nenhuma credencial salva.</div>';
    }
    async function saveCred(e) {
      e.preventDefault();
      await apiFetch('/web/credentials', {
        method: 'POST',
        body: JSON.stringify({
          siteName: document.getElementById('cr-site').value,
          loginUrl: document.getElementById('cr-url').value,
          username: document.getElementById('cr-user').value,
          password: document.getElementById('cr-pass').value,
        }),
      });
      e.target.reset(); loadCreds();
    }
    async function delCred(id) { await apiFetch('/web/credentials?id=' + id, { method: 'DELETE' }); loadCreds(); }
    async function testCredLogin(id) {
      const ok = await askAuth('Autenticar automaticamente usando a credencial salva?', 'Cofre ID #' + id);
      if (!ok) return;
      const d = await (await apiFetch('/web/login', { method: 'POST', body: JSON.stringify({ credentialId: id }) })).json();
      if (d.snapshot) {
        document.getElementById('web-status').textContent = 'Logado · HTTP ' + d.snapshot.status;
        document.getElementById('web-preview').innerHTML = '<strong>' + esc(d.snapshot.title) + '</strong><pre style="margin-top:8px;">' + esc(d.snapshot.textPreview) + '</pre>';
      }
    }

    let gBread = [{ id: 'root', name: 'Meu Drive' }];
    async function loadConnections() {
      const c = await (await apiFetch('/connections')).json();
      const box = document.getElementById('cloud-google');
      if (c.google?.connected) {
        box.innerHTML = '<span>Conectado como <strong>' + esc(c.google.email) + '</strong></span> <button type="button" class="btn-danger" style="margin-left:10px;" onclick="clearConn(\\'google\\')">Desconectar</button>';
        loadGDrive('root', 'Meu Drive', true);
      } else {
        box.innerHTML = '<span style="color:var(--muted);">Sincronize sua conta Google pela interface web principal (botão Local / Nuvem no topo).</span>';
        document.getElementById('gdrive-list').innerHTML = '';
        document.getElementById('gdrive-bread').textContent = '';
      }
    }
    async function loadGDrive(folderId, folderName, reset = false) {
      if (reset) gBread = [{ id: 'root', name: 'Meu Drive' }];
      else {
        const idx = gBread.findIndex((b) => b.id === folderId);
        if (idx >= 0) gBread = gBread.slice(0, idx + 1);
        else gBread.push({ id: folderId, name: folderName || folderId });
      }
      document.getElementById('gdrive-bread').innerHTML = gBread.map((b) =>
        '<span style="cursor:pointer;text-decoration:underline;" onclick="loadGDrive(\\'' + esc(b.id) + '\\', \\'' + esc(b.name).replace(/'/g, '&#39;') + '\\')">' + esc(b.name) + '</span>'
      ).join(' / ');
      const d = await (await apiFetch('/google/drive/folder?folderId=' + encodeURIComponent(folderId))).json();
      if (d.error) { document.getElementById('gdrive-list').innerHTML = '<div style="color:var(--rose);">' + esc(d.error) + '</div>'; return; }
      document.getElementById('gdrive-list').innerHTML = (d.files || []).map((f) => {
        const isDir = f.mimeType === 'application/vnd.google-apps.folder';
        const safeName = esc(f.name).replace(/'/g, '&#39;');
        if (isDir) return '<div class="row-item" style="cursor:pointer;" onclick="loadGDrive(\\'' + esc(f.id) + '\\', \\'' + safeName + '\\')"><span class="mono" style="color:var(--gold);">[PASTA] ' + esc(f.name) + '</span><span class="mono" style="color:var(--muted);">abrir</span></div>';
        return '<div class="row-item" style="cursor:pointer;" onclick="openGFile(\\'' + esc(f.id) + '\\')"><span class="mono">' + esc(f.name) + '</span><span class="mono" style="color:var(--muted);">abrir</span></div>';
      }).join('') || '<div style="color:var(--muted);">Pasta vazia.</div>';
    }
    async function openGFile(id) {
      const viewer = document.getElementById('gdrive-viewer');
      viewer.innerHTML = '<span class="mono" style="color:var(--muted);">Carregando arquivo...</span>';
      const d = await (await apiFetch('/google/drive/file?id=' + encodeURIComponent(id))).json();
      if (d.error || !d.file) { viewer.innerHTML = '<div style="color:var(--rose);">' + esc(d.error || 'Erro') + '</div>'; return; }
      const f = d.file;
      currentGDriveFile = f;
      document.getElementById('gdrive-file-title').textContent = f.name;
      const ext = document.getElementById('gdrive-ext-link');
      if (f.webViewLink) { ext.href = f.webViewLink; ext.classList.remove('hidden'); } else { ext.classList.add('hidden'); }
      let mediaUrl = null;
      if (f.kind === 'pdf' || f.kind === 'image' || f.kind === 'audio' || f.kind === 'video' || f.kind === 'slides') {
        try {
          const qs = f.defaultExportMime ? '&exportMime=' + encodeURIComponent(f.defaultExportMime) : '';
          mediaUrl = await fetchMediaBlobUrl('gdrive', '/google/drive/media?id=' + encodeURIComponent(f.id) + qs);
        } catch {}
      }
      viewer.innerHTML = renderEmbeddedViewerHtml('gdrive', f, mediaUrl);
    }
    async function clearConn(provider) {
      await apiFetch('/connections', { method: 'POST', body: JSON.stringify({ provider, token: null }) });
      loadConnections();
    }

    setInterval(() => {
      document.getElementById('hdr-clock').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }, 1000);
    setInterval(pollTelemetry, 4500);
    checkAuth();
  </script>
</body>
</html>`;
}
