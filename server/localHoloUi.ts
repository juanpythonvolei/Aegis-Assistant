// Shared 100% offline-capable 3D Holographic Local HUD UI for Aegis Native Apps
// (Linux .deb / .AppImage / .tar.gz, Windows .exe, and Android APK WebView).
// Zero external CDN dependencies — full visual, animation, icon, and technical parity
// with the Aegis Web HUD (3D Plasma Core, Spatial 3D Menu Drawer, Thinking & Escalation
// Activity Stream, Subagent Worker->Curator Pipeline, Background Jobs, and Google Workspace OAuth).

export interface LocalHoloUiOptions {
  platformMode?: 'desktop' | 'android';
  appVersion?: string;
  defaultCloudOrigin?: string;
}

export function getLocalHoloUiHtml(options?: LocalHoloUiOptions): string {
  const platformMode = options?.platformMode === 'android' ? 'android' : 'desktop';
  const appVersion = options?.appVersion || '2.1.0';
  const defaultCloudOrigin = (
    options?.defaultCloudOrigin ||
    process.env.APP_URL ||
    'https://ais-pre-gamd6ug3axhvddvr55mbne-702819737353.us-east1.run.app'
  ).replace(/\/+$/, '');

  const isAndroid = platformMode === 'android';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<title>Aegis ${isAndroid ? 'Android' : 'Desktop'} — Núcleo Holográfico Local v${appVersion}</title>
<style>
  :root {
    --bg: #05070b;
    --bg-deep: #030508;
    --surface: rgba(11, 15, 23, 0.84);
    --surface-solid: #0b0f17;
    --surface-2: rgba(17, 23, 35, 0.88);
    --amber: #f59e0b;
    --amber-hi: #fbbf24;
    --amber-soft: #fde68a;
    --amber-dim: rgba(245, 158, 11, 0.16);
    --cyan: #38bdf8;
    --cyan-soft: #bae6fd;
    --cyan-dim: rgba(56, 189, 248, 0.14);
    --emerald: #34d399;
    --emerald-dim: rgba(52, 211, 153, 0.14);
    --rose: #fb7185;
    --rose-dim: rgba(251, 113, 133, 0.14);
    --violet: #a78bfa;
    --text: #f3f4f6;
    --text-2: #cbd5e1;
    --muted: #94a3b8;
    --muted-2: #64748b;
    --border: rgba(255, 255, 255, 0.1);
    --border-amber: rgba(245, 158, 11, 0.32);
    --border-cyan: rgba(56, 189, 248, 0.3);
    --font-sans: "Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    --font-mono: "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 100%; height: 100%; overflow: hidden;
    background: var(--bg); color: var(--text);
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
    color-scheme: dark;
  }

  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(251, 191, 36, 0.24); border-radius: 999px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(251, 191, 36, 0.45); }

  /* ===== Ambient Holographic Backdrop ===== */
  .ambient-backdrop {
    position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background:
      radial-gradient(ellipse 68% 54% at 50% 45%, rgba(245, 158, 11, 0.08), transparent 70%),
      radial-gradient(ellipse 46% 38% at 78% 18%, rgba(56, 189, 248, 0.06), transparent 65%),
      radial-gradient(ellipse 40% 35% at 18% 82%, rgba(245, 158, 11, 0.05), transparent 65%);
  }
  .ambient-grid {
    position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: 0.26;
    background-image:
      linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
    background-size: 48px 48px;
    mask-image: radial-gradient(circle at 50% 48%, rgba(0,0,0,0.85), transparent 78%);
    -webkit-mask-image: radial-gradient(circle at 50% 48%, rgba(0,0,0,0.85), transparent 78%);
  }

  /* ===== 3D Holographic Core Layer ===== */
  #core-stage {
    position: fixed; inset: 0; z-index: 1;
    transition: transform 0.72s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.55s ease, filter 0.55s ease;
    will-change: transform, opacity;
  }
  #core-stage.dimmed {
    opacity: 0.32;
    transform: scale(0.88);
    filter: blur(1.5px);
  }
  #core-stage.shifted-left {
    transform: translateX(-20%) scale(0.86);
  }
  #aegis-core-canvas {
    width: 100%; height: 100%; display: block;
  }

  /* ===== 3D Spatial Animations (1:1 Web Parity) ===== */
  .spatial-stage {
    perspective: 1400px;
    perspective-origin: 50% 44%;
  }

  @keyframes spatial-panel-in {
    0% {
      opacity: 0;
      transform: translate3d(0, 26px, -70px) rotateX(6deg) scale(0.96);
    }
    100% {
      opacity: 1;
      transform: translate3d(0, 0, 0) rotateX(0deg) scale(1);
    }
  }
  .spatial-panel {
    position: relative;
    background: linear-gradient(155deg, rgba(13, 18, 28, 0.92), rgba(7, 10, 16, 0.94));
    border: 1px solid rgba(251, 191, 36, 0.22);
    border-radius: 26px;
    box-shadow:
      0 34px 90px -24px rgba(0, 0, 0, 0.92),
      0 0 0 1px rgba(255, 255, 255, 0.05) inset,
      0 1px 0 rgba(251, 191, 36, 0.22) inset,
      0 0 42px -18px rgba(245, 158, 11, 0.26);
    backdrop-filter: blur(22px) saturate(135%);
    -webkit-backdrop-filter: blur(22px) saturate(135%);
    animation: spatial-panel-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
    transform-style: preserve-3d;
  }

  .spatial-card {
    position: relative;
    background: linear-gradient(155deg, rgba(19, 25, 39, 0.78), rgba(10, 14, 22, 0.86));
    border: 1px solid rgba(255, 255, 255, 0.085);
    border-radius: 16px;
    box-shadow:
      0 14px 32px -18px rgba(0, 0, 0, 0.85),
      0 1px 0 rgba(255, 255, 255, 0.06) inset;
    transition: transform 0.26s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.26s ease, box-shadow 0.26s ease, background 0.26s ease;
  }
  .spatial-card:hover {
    border-color: rgba(251, 191, 36, 0.34);
    box-shadow:
      0 20px 38px -18px rgba(0, 0, 0, 0.9),
      0 0 26px -12px rgba(245, 158, 11, 0.32),
      0 1px 0 rgba(251, 191, 36, 0.16) inset;
    transform: translateY(-2px);
  }

  @keyframes spatial-drawer-in {
    0% {
      opacity: 0;
      transform: translate3d(-34px, 0, -40px) rotateY(9deg);
    }
    100% {
      opacity: 1;
      transform: translate3d(0, 0, 0) rotateY(0deg);
    }
  }
  .spatial-drawer-3d {
    transform-origin: left center;
    animation: spatial-drawer-in 0.32s cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  @keyframes drawer-item-in {
    0% { opacity: 0; transform: translate3d(-16px, 8px, 0) scale(0.97); }
    100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
  }
  .drawer-stagger {
    animation: drawer-item-in 0.34s cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  @keyframes popover-in {
    0% { opacity: 0; transform: translate3d(0, -10px, 0) scale(0.96); }
    100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
  }
  .popover-anim {
    animation: popover-in 0.24s cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  @keyframes escalation-sweep {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(260%); }
  }
  .escalation-sweep-bar {
    position: relative;
    overflow: hidden;
  }
  .escalation-sweep-bar::after {
    content: "";
    position: absolute;
    inset: 0;
    width: 45%;
    background: linear-gradient(90deg, transparent, rgba(251, 191, 36, 0.38), rgba(56, 189, 248, 0.28), transparent);
    animation: escalation-sweep 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    pointer-events: none;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { animation: spin 1s linear infinite; }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.45; transform: scale(0.84); }
  }
  .pulse-dot { animation: pulse-dot 1.7s ease-in-out infinite; }

  /* ===== Top Minimal Discreet Bar ===== */
  .topbar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 30;
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px; pointer-events: none; gap: 10px;
  }
  .topbar-group {
    display: flex; align-items: center; gap: 8px; pointer-events: auto;
    flex-wrap: wrap;
  }

  .hud-pill {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 8px 13px; border-radius: 999px;
    background: rgba(8, 12, 20, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.11);
    color: #e2e8f0; font-size: 12px; font-weight: 600;
    cursor: pointer; backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    transition: all 0.2s cubic-bezier(0.22, 1, 0.36, 1);
    box-shadow: 0 10px 26px -14px rgba(0, 0, 0, 0.9), 0 1px 0 rgba(255,255,255,0.06) inset;
    user-select: none; white-space: nowrap;
  }
  .hud-pill:hover {
    border-color: rgba(251, 191, 36, 0.42);
    background: rgba(16, 22, 34, 0.9);
    color: #fff;
    transform: translateY(-1px);
  }
  .hud-pill.amber {
    border-color: rgba(245, 158, 11, 0.36);
    background: rgba(245, 158, 11, 0.12);
    color: var(--amber-soft);
  }
  .hud-pill.cyan {
    border-color: rgba(56, 189, 248, 0.38);
    background: rgba(56, 189, 248, 0.12);
    color: var(--cyan-soft);
  }
  .hud-pill.emerald {
    border-color: rgba(52, 211, 153, 0.36);
    background: rgba(52, 211, 153, 0.11);
    color: #a7f3d0;
  }
  .hud-pill.rose {
    border-color: rgba(251, 113, 133, 0.38);
    background: rgba(251, 113, 133, 0.12);
    color: #fecdd3;
  }
  .kbd-chip {
    font-family: var(--font-mono); font-size: 10px;
    padding: 1px 5px; border-radius: 5px;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.1);
    color: var(--muted);
  }
  .badge-count {
    font-family: var(--font-mono); font-size: 10px;
    padding: 1px 6px; border-radius: 999px;
    background: rgba(255,255,255,0.1); color: #fff;
  }
  .dot {
    width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
  }
  .dot.amber { background: var(--amber-hi); box-shadow: 0 0 10px var(--amber); }
  .dot.cyan { background: var(--cyan); box-shadow: 0 0 10px var(--cyan); }
  .dot.emerald { background: var(--emerald); box-shadow: 0 0 10px var(--emerald); }
  .dot.rose { background: var(--rose); box-shadow: 0 0 10px var(--rose); }

  .svg-ico {
    width: 15px; height: 15px; display: inline-block; flex-shrink: 0;
    stroke: currentColor; fill: none; stroke-width: 1.9;
    stroke-linecap: round; stroke-linejoin: round;
  }
  .svg-ico.sm { width: 13px; height: 13px; }
  .svg-ico.lg { width: 18px; height: 18px; }

  /* ===== Floating Popovers (Thinking, Jobs, Local+Google) ===== */
  .popover-layer {
    position: fixed; top: 64px; right: 20px; z-index: 45;
    width: min(460px, calc(100vw - 24px));
    max-height: calc(100vh - 140px);
    display: none; flex-direction: column;
    overflow: hidden;
    background: linear-gradient(155deg, rgba(12, 16, 26, 0.96), rgba(6, 9, 15, 0.97));
    border: 1px solid rgba(251, 191, 36, 0.26);
    border-radius: 22px;
    box-shadow: 0 32px 80px -20px rgba(0,0,0,0.95), 0 0 40px -16px rgba(245, 158, 11, 0.22);
    backdrop-filter: blur(26px);
    -webkit-backdrop-filter: blur(26px);
  }
  .popover-layer.open { display: flex; }
  .popover-head {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 13px 16px; border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  .popover-body {
    padding: 12px 14px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 10px;
  }
  .popover-foot {
    padding: 10px 14px; border-top: 1px solid rgba(255,255,255,0.08);
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    background: rgba(255,255,255,0.02); font-size: 11px; color: var(--muted);
  }

  /* ===== 3D Spatial Menu Drawer ===== */
  .drawer-backdrop {
    position: fixed; inset: 0; z-index: 50;
    background: rgba(3, 5, 10, 0.62);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    display: none;
  }
  .drawer-backdrop.open { display: block; }
  .drawer-shell {
    position: fixed; top: 14px; bottom: 14px; left: 14px; z-index: 55;
    width: min(355px, calc(100vw - 28px));
    display: none; flex-direction: column; overflow: hidden;
    background: linear-gradient(160deg, rgba(13, 18, 28, 0.96), rgba(6, 9, 15, 0.97));
    border: 1px solid rgba(251, 191, 36, 0.26);
    border-radius: 26px;
    box-shadow: 0 36px 90px -20px rgba(0, 0, 0, 0.95), 0 0 42px -18px rgba(245, 158, 11, 0.28);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
  }
  .drawer-shell.open { display: flex; }
  .drawer-header {
    padding: 18px 18px 14px; border-bottom: 1px solid rgba(255,255,255,0.08);
    display: flex; align-items: center; justify-content: space-between;
  }
  .drawer-brand {
    display: flex; align-items: center; gap: 11px;
  }
  .brand-orb {
    width: 38px; height: 38px; border-radius: 13px;
    display: grid; place-items: center;
    background: radial-gradient(circle at 32% 30%, rgba(251, 191, 36, 0.34), rgba(245, 158, 11, 0.08));
    border: 1px solid rgba(251, 191, 36, 0.45);
    color: var(--amber-hi);
    box-shadow: 0 0 24px -6px rgba(245, 158, 11, 0.55);
  }
  .drawer-nav {
    flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;
  }
  .nav-card {
    display: flex; align-items: center; gap: 12px; width: 100%;
    padding: 11px 12px; border-radius: 16px; text-align: left;
    background: rgba(255,255,255,0.025);
    border: 1px solid rgba(255,255,255,0.06);
    color: var(--text); cursor: pointer;
    transition: all 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .nav-card:hover {
    background: rgba(245, 158, 11, 0.09);
    border-color: rgba(251, 191, 36, 0.35);
    transform: translateX(4px);
  }
  .nav-card.active {
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(56, 189, 248, 0.08));
    border-color: rgba(251, 191, 36, 0.48);
    box-shadow: 0 0 24px -12px rgba(245, 158, 11, 0.55);
  }
  .nav-ico-box {
    width: 36px; height: 36px; border-radius: 11px; flex-shrink: 0;
    display: grid; place-items: center;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.09);
    color: var(--amber-hi);
  }
  .nav-card.active .nav-ico-box {
    background: rgba(245, 158, 11, 0.2);
    border-color: rgba(251, 191, 36, 0.45);
  }
  .nav-title { font-size: 13px; font-weight: 600; color: #f8fafc; line-height: 1.25; }
  .nav-sub { font-size: 11px; color: var(--muted); line-height: 1.3; margin-top: 2px; }
  .drawer-footer {
    padding: 12px 14px; border-top: 1px solid rgba(255,255,255,0.08);
    background: rgba(0,0,0,0.28); display: flex; flex-direction: column; gap: 9px;
  }

  /* ===== Elevated 3D Spatial Module Stage ===== */
  #module-stage {
    position: fixed; inset: 66px 20px 104px 20px; z-index: 20;
    display: none; justify-content: center; align-items: stretch;
    pointer-events: none;
  }
  #module-stage.open { display: flex; }
  .module-shell {
    width: min(1120px, 100%); height: 100%;
    display: flex; flex-direction: column; overflow: hidden;
    pointer-events: auto;
  }
  .module-header {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 15px 20px; border-bottom: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.015);
  }
  .module-body {
    flex: 1; overflow-y: auto; padding: 18px 20px;
    display: flex; flex-direction: column; gap: 14px;
  }

  /* ===== Holographic Screen Deck ===== */
  #holo-deck {
    position: fixed; top: 72px; right: 20px; bottom: 110px; z-index: 16;
    width: min(460px, calc(100vw - 32px));
    display: none; flex-direction: column; gap: 12px;
    overflow-y: auto; padding-right: 4px;
  }
  #holo-deck.open { display: flex; }
  .holo-screen-frame {
    position: relative; overflow: hidden;
    background: linear-gradient(155deg, rgba(10, 15, 24, 0.92), rgba(5, 8, 14, 0.94));
    border: 1px solid rgba(56, 189, 248, 0.32);
    border-radius: 20px;
    box-shadow: 0 24px 60px -20px rgba(0,0,0,0.92), 0 0 32px -16px rgba(56, 189, 248, 0.35);
    backdrop-filter: blur(20px);
    animation: spatial-panel-in 0.36s cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  /* ===== Floating Caption & Bottom Holo Dock ===== */
  .dock-wrap {
    position: fixed; left: 0; right: 0; bottom: 18px; z-index: 25;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    padding: 0 16px; pointer-events: none;
  }
  .caption-card {
    width: min(680px, 100%); pointer-events: auto;
    padding: 12px 15px; border-radius: 18px;
    background: rgba(9, 13, 22, 0.9);
    border: 1px solid rgba(251, 191, 36, 0.28);
    box-shadow: 0 22px 54px -16px rgba(0, 0, 0, 0.92), 0 0 26px -12px rgba(245, 158, 11, 0.28);
    backdrop-filter: blur(22px);
    display: none; flex-direction: column; gap: 8px;
    animation: popover-in 0.25s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .caption-card.open { display: flex; }

  .quick-chips {
    display: flex; align-items: center; justify-content: center; flex-wrap: wrap;
    gap: 7px; pointer-events: auto; max-width: 720px;
  }
  .chip-btn {
    padding: 6px 12px; border-radius: 999px; font-size: 11.5px; font-weight: 500;
    background: rgba(10, 14, 22, 0.72); color: #cbd5e1;
    border: 1px solid rgba(255,255,255,0.1); cursor: pointer;
    backdrop-filter: blur(12px); transition: all 0.2s ease;
  }
  .chip-btn:hover {
    border-color: rgba(251, 191, 36, 0.45); color: var(--amber-soft);
    background: rgba(245, 158, 11, 0.12); transform: translateY(-1px);
  }

  .holo-dock {
    width: min(740px, 100%); pointer-events: auto;
    display: flex; align-items: center; gap: 8px;
    padding: 7px 8px 7px 10px; border-radius: 999px;
    background: linear-gradient(180deg, rgba(14, 19, 30, 0.9), rgba(8, 11, 18, 0.94));
    border: 1px solid rgba(251, 191, 36, 0.28);
    box-shadow:
      0 22px 60px -14px rgba(0, 0, 0, 0.96),
      0 0 36px -14px rgba(245, 158, 11, 0.26),
      0 1px 0 rgba(255, 255, 255, 0.08) inset;
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }
  .holo-dock:focus-within {
    border-color: rgba(251, 191, 36, 0.62);
    box-shadow:
      0 22px 60px -14px rgba(0, 0, 0, 0.96),
      0 0 42px -10px rgba(245, 158, 11, 0.4);
  }
  .dock-input {
    flex: 1; min-width: 0; background: transparent; border: none; outline: none;
    color: #fff; font-size: 13.5px; padding: 8px 6px; font-family: var(--font-sans);
  }
  .dock-input::placeholder { color: #64748b; }

  .icon-btn {
    width: 36px; height: 36px; border-radius: 999px; flex-shrink: 0;
    display: grid; place-items: center; cursor: pointer;
    background: rgba(255,255,255,0.05); color: #cbd5e1;
    border: 1px solid rgba(255,255,255,0.09);
    transition: all 0.2s ease;
  }
  .icon-btn:hover {
    background: rgba(255,255,255,0.12); color: #fff;
    border-color: rgba(251, 191, 36, 0.35);
  }
  .icon-btn.active-amber {
    background: rgba(245, 158, 11, 0.22); color: var(--amber-hi);
    border-color: rgba(251, 191, 36, 0.55);
  }
  .icon-btn.active-cyan {
    background: rgba(56, 189, 248, 0.2); color: var(--cyan);
    border-color: rgba(56, 189, 248, 0.5);
  }
  .icon-btn.active-rose {
    background: rgba(251, 113, 133, 0.22); color: var(--rose);
    border-color: rgba(251, 113, 133, 0.55);
  }

  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    padding: 9px 15px; border-radius: 12px; font-size: 12.5px; font-weight: 600;
    cursor: pointer; border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.06); color: #f1f5f9;
    transition: all 0.2s ease; font-family: var(--font-sans); white-space: nowrap;
  }
  .btn:hover:not(:disabled) {
    background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.22);
    transform: translateY(-1px);
  }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn.primary {
    background: linear-gradient(135deg, #f59e0b, #d97706);
    border-color: rgba(251, 191, 36, 0.65); color: #05070b; font-weight: 700;
    box-shadow: 0 10px 24px -10px rgba(245, 158, 11, 0.65);
  }
  .btn.primary:hover:not(:disabled) {
    background: linear-gradient(135deg, #fbbf24, #f59e0b);
    box-shadow: 0 14px 28px -10px rgba(245, 158, 11, 0.8);
  }
  .btn.cyan {
    background: rgba(56, 189, 248, 0.14); border-color: rgba(56, 189, 248, 0.42); color: var(--cyan-soft);
  }
  .btn.emerald {
    background: rgba(52, 211, 153, 0.14); border-color: rgba(52, 211, 153, 0.42); color: #a7f3d0;
  }
  .btn.danger {
    background: rgba(251, 113, 133, 0.14); border-color: rgba(251, 113, 133, 0.42); color: #fecdd3;
  }
  .btn.sm { padding: 6px 10px; font-size: 11.5px; border-radius: 9px; }
  .btn.pill { border-radius: 999px; }

  /* Official Google Sign-In Button */
  .gsi-material-button {
    display: inline-flex; align-items: center; justify-content: center; gap: 11px;
    background: #131314; border: 1px solid #8e918f; border-radius: 999px;
    color: #e3e3e3; font-size: 13.5px; font-weight: 600;
    padding: 10px 18px; cursor: pointer; transition: all 0.2s ease;
    box-shadow: 0 8px 22px -12px rgba(0, 0, 0, 0.9);
  }
  .gsi-material-button:hover {
    background: #1e2024; border-color: #c4c7c5; transform: translateY(-1px);
  }

  /* ===== Form Inputs & Typography Helpers ===== */
  .inp, .sel, .txt {
    width: 100%; background: rgba(5, 8, 14, 0.86); color: #f8fafc;
    border: 1px solid rgba(255,255,255,0.12); border-radius: 12px;
    padding: 9px 12px; font-size: 13px; outline: none; font-family: var(--font-sans);
    transition: border-color 0.2s ease;
  }
  .inp:focus, .sel:focus, .txt:focus { border-color: rgba(251, 191, 36, 0.55); }
  .mono { font-family: var(--font-mono); }

  .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
  .grid-5 { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
  @media (max-width: 860px) {
    .grid-3, .grid-4, .grid-5 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 600px) {
    .grid-2, .grid-3, .grid-4, .grid-5 { grid-template-columns: 1fr; }
    .topbar { padding: 10px 12px; }
    #module-stage { inset: 58px 8px 94px 8px; }
    .hide-sm { display: none !important; }
  }

  .tag {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 600;
    background: rgba(255,255,255,0.06); color: var(--text-2);
    border: 1px solid rgba(255,255,255,0.1); white-space: nowrap;
  }
  .tag.amber { background: var(--amber-dim); color: var(--amber-soft); border-color: var(--border-amber); }
  .tag.cyan { background: var(--cyan-dim); color: var(--cyan-soft); border-color: var(--border-cyan); }
  .tag.emerald { background: var(--emerald-dim); color: #a7f3d0; border-color: rgba(52, 211, 153, 0.34); }
  .tag.rose { background: var(--rose-dim); color: #fecdd3; border-color: rgba(251, 113, 133, 0.34); }

  /* ===== Chat & Trace Items ===== */
  .chat-msg {
    padding: 13px 15px; border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(15, 20, 31, 0.72);
    display: flex; flex-direction: column; gap: 8px;
  }
  .chat-msg.user {
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.14), rgba(245, 158, 11, 0.05));
    border-color: rgba(251, 191, 36, 0.32);
    align-self: flex-end; max-width: 86%;
  }
  .chat-msg.assistant { align-self: flex-start; width: 100%; }
  .chat-content {
    font-size: 13.5px; line-height: 1.58; color: #f1f5f9; white-space: pre-wrap; word-break: break-word;
  }

  .trace-card {
    border-radius: 14px; border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.028); overflow: hidden;
  }
  .trace-card.thought-worker { border-left: 3px solid var(--amber); background: rgba(245, 158, 11, 0.05); }
  .trace-card.thought-curator { border-left: 3px solid var(--cyan); background: rgba(56, 189, 248, 0.05); }
  .trace-card.plan { border-color: rgba(251, 191, 36, 0.25); background: rgba(245, 158, 11, 0.06); }
  .trace-card.skipped { border-color: rgba(52, 211, 153, 0.3); background: rgba(52, 211, 153, 0.06); }
  .trace-card.escalated { border-color: rgba(251, 191, 36, 0.4); background: rgba(245, 158, 11, 0.09); }
  .trace-head {
    width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 9px 11px; background: transparent; border: none; color: #e2e8f0;
    cursor: pointer; text-align: left; font-size: 12px; font-weight: 600;
  }
  .trace-body {
    padding: 0 11px 10px; font-size: 11.8px; color: #cbd5e1; line-height: 1.5;
    white-space: pre-wrap; word-break: break-word; border-top: 1px solid rgba(255,255,255,0.05);
    padding-top: 8px;
  }

  .pipeline-strip {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 9px 12px; border-radius: 13px;
    background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.08);
    font-size: 11px;
  }

  .tab-bar {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 4px; border-radius: 13px;
    background: rgba(0,0,0,0.38); border: 1px solid rgba(255,255,255,0.08);
  }
  .tab-btn {
    padding: 7px 12px; border-radius: 9px; font-size: 12px; font-weight: 600;
    border: none; background: transparent; color: var(--muted); cursor: pointer;
    transition: all 0.2s ease; display: inline-flex; align-items: center; gap: 6px;
  }
  .tab-btn.active {
    background: rgba(245, 158, 11, 0.18); color: var(--amber-soft);
    box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.34) inset;
  }

  /* ===== Auth Lock Overlay ===== */
  #auth-overlay {
    position: fixed; inset: 0; z-index: 80;
    display: none; place-items: center; padding: 20px;
    background: radial-gradient(circle at 50% 42%, rgba(12, 16, 26, 0.72), rgba(4, 6, 10, 0.94));
    backdrop-filter: blur(18px);
  }
  #auth-overlay.open { display: grid; }
  .auth-card {
    width: min(420px, 100%); padding: 26px;
  }

  /* ===== Confirmation Modal ===== */
  #confirm-overlay {
    position: fixed; inset: 0; z-index: 90;
    display: none; place-items: center; padding: 20px;
    background: rgba(3, 5, 10, 0.78); backdrop-filter: blur(12px);
  }
  #confirm-overlay.open { display: grid; }

  .toast-wrap {
    position: fixed; bottom: 92px; left: 50%; transform: translateX(-50%);
    z-index: 95; display: flex; flex-direction: column; gap: 6px; pointer-events: none;
  }
  .toast {
    padding: 9px 15px; border-radius: 999px; font-size: 12px; font-weight: 600;
    background: rgba(11, 16, 26, 0.96); border: 1px solid rgba(251, 191, 36, 0.42);
    color: var(--amber-soft); box-shadow: 0 14px 36px rgba(0,0,0,0.85);
    animation: popover-in 0.22s ease both;
  }

  @media (prefers-reduced-motion: reduce) {
    .spatial-panel, .spatial-drawer-3d, .drawer-stagger, .popover-anim, .spin, .pulse-dot { animation: none !important; }
    .escalation-sweep-bar::after { animation: none !important; display: none; }
    .spatial-card:hover, .hud-pill:hover, .nav-card:hover { transform: none !important; }
  }
</style>
</head>
<body>
  <div class="ambient-backdrop"></div>
  <div class="ambient-grid"></div>

  <!-- 3D Holographic Plasma & Neural Core -->
  <div id="core-stage">
    <canvas id="aegis-core-canvas"></canvas>
  </div>

  <!-- Top Minimal Discreet Bar -->
  <header class="topbar">
    <div class="topbar-group">
      <button id="btn-open-menu" class="hud-pill" title="Abrir Menu Espacial (Atalho: M)">
        <span id="ico-menu-slot"></span>
        <span>Aegis</span>
        <span class="kbd-chip hide-sm">M</span>
      </button>
      <button id="btn-return-core" class="hud-pill amber" style="display:none;" title="Voltar ao Núcleo 3D">
        <span id="ico-core-slot"></span>
        <span>Núcleo 3D</span>
      </button>
      <button id="btn-toggle-deck" class="hud-pill cyan" style="display:none;" title="Telas Holográficas">
        <span id="ico-deck-slot"></span>
        <span id="deck-count-label">0 Telas</span>
      </button>
    </div>

    <div class="topbar-group">
      <!-- Live Thinking & Escalation Trigger Pill -->
      <button id="btn-thinking" class="hud-pill" title="Atividade de Pensamento, Subagentes e Escalonamento">
        <span id="thinking-ico-slot"></span>
        <span id="thinking-label">Orquestração</span>
        <span id="thinking-count" class="badge-count" style="display:none;">0</span>
        <span id="thinking-chev-slot"></span>
      </button>

      <!-- Background Jobs Pill -->
      <button id="btn-jobs" class="hud-pill" title="Tarefas em Segundo Plano">
        <span id="jobs-ico-slot"></span>
        <span id="jobs-label" class="hide-sm">2º Plano</span>
        <span id="jobs-count" class="badge-count" style="display:none;">0</span>
      </button>

      <!-- Local + Google Sync Pill -->
      <button id="btn-google-pill" class="hud-pill amber" title="Status Local & Conexão Google Workspace">
        <span id="google-dot" class="dot amber"></span>
        <span id="google-pill-label">${isAndroid ? 'Android' : 'Local'} · Google</span>
      </button>

      <!-- Core State Pill -->
      <div id="core-state-pill" class="hud-pill hide-sm" style="cursor:default;">
        <span id="core-state-dot" class="dot amber"></span>
        <span id="core-state-label">Em Espera</span>
      </div>
    </div>
  </header>

  <!-- Floating Popover: Thinking & Subagent Activity Panel -->
  <section id="popover-thinking" class="popover-layer popover-anim">
    <div class="popover-head">
      <div style="display:flex;align-items:center;gap:9px;">
        <span id="pop-think-ico" style="color:var(--amber-hi);"></span>
        <div>
          <div style="font-size:13px;font-weight:700;color:#fff;">Atividade de Pensamento & Subagentes</div>
          <div id="pop-think-sub" style="font-size:11px;color:var(--muted);">Flash Lite (Trabalho Bruto) → Curadoria Seletiva</div>
        </div>
      </div>
      <button class="icon-btn" onclick="closeAllPopovers()" title="Fechar" id="pop-think-close"></button>
    </div>
    <div class="popover-body" id="thinking-body"></div>
    <div class="popover-foot">
      <span id="thinking-foot-metrics">Pronto para orquestrar</span>
      <button class="btn sm amber" onclick="openModule('orchestrator'); closeAllPopovers();" style="border-color:var(--border-amber);color:var(--amber-soft);">
        Modelos & Consumo
      </button>
    </div>
  </section>

  <!-- Floating Popover: Background Jobs -->
  <section id="popover-jobs" class="popover-layer popover-anim">
    <div class="popover-head">
      <div style="display:flex;align-items:center;gap:9px;">
        <span id="pop-jobs-ico" style="color:var(--cyan);"></span>
        <div>
          <div style="font-size:13px;font-weight:700;color:#fff;">Tarefas em Segundo Plano</div>
          <div style="font-size:11px;color:var(--muted);">Execução assíncrona sem travar o chat</div>
        </div>
      </div>
      <button class="icon-btn" onclick="closeAllPopovers()" title="Fechar" id="pop-jobs-close"></button>
    </div>
    <div class="popover-body" id="jobs-body"></div>
    <div class="popover-foot">
      <span id="jobs-foot-info">Atualização automática ativa</span>
      <button class="btn sm" onclick="refreshJobs()">Atualizar</button>
    </div>
  </section>

  <!-- Floating Popover: Local Engine & Google Account -->
  <section id="popover-google" class="popover-layer popover-anim">
    <div class="popover-head">
      <div style="display:flex;align-items:center;gap:9px;">
        <span id="pop-google-ico" style="color:var(--emerald);"></span>
        <div>
          <div style="font-size:13px;font-weight:700;color:#fff;">Motor Local & Conta Google</div>
          <div id="pop-google-sub" style="font-size:11px;color:var(--muted);">Aegis ${isAndroid ? 'Android Nativo' : 'Daemon 127.0.0.1:3847'} v${appVersion}</div>
        </div>
      </div>
      <button class="icon-btn" onclick="closeAllPopovers()" title="Fechar" id="pop-google-close"></button>
    </div>
    <div class="popover-body" id="google-popover-body"></div>
  </section>

  <!-- 3D Spatial Menu Drawer -->
  <div id="drawer-backdrop" class="drawer-backdrop" onclick="toggleDrawer(false)"></div>
  <aside id="spatial-drawer" class="drawer-shell spatial-drawer-3d">
    <div class="drawer-header">
      <div class="drawer-brand">
        <div class="brand-orb" id="drawer-brand-ico"></div>
        <div>
          <div style="font-size:15px;font-weight:800;letter-spacing:0.06em;color:#fff;">AEGIS</div>
          <div style="font-size:11px;color:var(--amber-soft);">${isAndroid ? 'Android Local + Nuvem' : 'Assistente Local + Google'} · v${appVersion}</div>
        </div>
      </div>
      <button class="icon-btn" onclick="toggleDrawer(false)" title="Fechar (Esc)" id="drawer-close-ico"></button>
    </div>
    <nav class="drawer-nav" id="drawer-nav"></nav>
    <div class="drawer-footer" id="drawer-footer"></div>
  </aside>

  <!-- Holographic Screen Deck -->
  <aside id="holo-deck"></aside>

  <!-- Elevated 3D Spatial Module Stage -->
  <main id="module-stage" class="spatial-stage">
    <div class="spatial-panel module-shell">
      <div class="module-header">
        <div style="display:flex;align-items:center;gap:12px;">
          <div class="nav-ico-box" id="module-ico-slot" style="background:var(--amber-dim);border-color:var(--border-amber);"></div>
          <div>
            <h2 id="module-title" style="font-size:15.5px;font-weight:700;color:#fff;">Módulo</h2>
            <div id="module-subtitle" style="font-size:11.5px;color:var(--muted);"></div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="btn sm" onclick="closeModule()">Núcleo 3D</button>
          <button class="icon-btn" onclick="closeModule()" title="Fechar módulo" id="module-close-ico"></button>
        </div>
      </div>
      <div class="module-body" id="module-body"></div>
    </div>
  </main>

  <!-- Bottom Floating Caption + Holo Command Dock -->
  <footer class="dock-wrap">
    <div id="caption-card" class="caption-card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;" id="caption-badges"></div>
        <div style="display:flex;align-items:center;gap:6px;">
          <button class="btn sm" onclick="togglePopover('thinking')">Ver pensamento</button>
          <button class="btn sm" onclick="openModule('command')">Histórico</button>
          <button class="icon-btn" style="width:26px;height:26px;" onclick="hideCaption()" id="caption-close-ico"></button>
        </div>
      </div>
      <div id="caption-text" style="font-size:13px;line-height:1.5;color:#f1f5f9;max-height:130px;overflow-y:auto;white-space:pre-wrap;"></div>
    </div>

    <div id="quick-chips" class="quick-chips">
      <button class="chip-btn" onclick="sendPrompt('Analise CPU, RAM, disco e processos mais pesados desta máquina e crie um resumo claro')">Saúde da Máquina</button>
      <button class="chip-btn" onclick="sendPrompt('Resuma meus e-mails recentes, compromissos da agenda e arquivos do Google Drive')">Resumo Google Workspace</button>
      <button class="chip-btn" onclick="sendPrompt('Monte um plano detalhado em etapas para organizar meus projetos e otimizar minha rotina', true)">Tarefa em 2º Plano</button>
      <button class="chip-btn" onclick="openModule('settings')">Conectar Google</button>
    </div>

    <form id="dock-form" class="holo-dock" onsubmit="handleDockSubmit(event)">
      <button type="button" id="btn-mic" class="icon-btn" onclick="toggleVoiceInput()" title="Comando por Voz"></button>
      <button type="button" id="btn-bg-mode" class="icon-btn" onclick="toggleForceBackground()" title="Forçar execução em 2º Plano (não trava o chat)"></button>
      <select id="dock-model-sel" class="sel hide-sm" onchange="setModelPreference(this.value)" title="Política de Modelos"
        style="width:auto;padding:6px 9px;border-radius:999px;font-size:11.5px;background:rgba(255,255,255,0.05);border-color:rgba(255,255,255,0.1);">
        <option value="auto">Auto (Smart)</option>
        <option value="gemini-3.1-flash-lite">Eco (Lite)</option>
        <option value="gemini-4-hydrogen">Flash</option>
        <option value="gemini-4-argon">Pro</option>
      </select>
      <input id="dock-input" class="dock-input" type="text" autocomplete="off"
        placeholder="Fale ou digite um comando para o Aegis (local + Google Workspace)..." />
      <button type="submit" id="btn-send" class="btn primary pill" style="padding:8px 16px;">
        <span id="send-ico-slot"></span>
        <span>Enviar</span>
      </button>
    </form>
  </footer>

  <!-- Local Auth Setup / Login Gate -->
  <div id="auth-overlay" class="spatial-stage">
    <div class="spatial-panel auth-card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
        <div class="brand-orb" id="auth-brand-ico" style="width:44px;height:44px;"></div>
        <div>
          <div id="auth-title" style="font-size:17px;font-weight:800;letter-spacing:0.05em;color:#fff;">AEGIS LOCAL</div>
          <div id="auth-subtitle" style="font-size:12px;color:var(--amber-soft);">Autenticação criptografada do operador</div>
        </div>
      </div>
      <form id="auth-form" onsubmit="handleAuthSubmit(event)" style="display:flex;flex-direction:column;gap:12px;">
        <div>
          <label style="display:block;font-size:11.5px;color:var(--muted);margin-bottom:5px;">Usuário Local</label>
          <input id="auth-user" class="inp" type="text" required placeholder="operador" autocomplete="username" />
        </div>
        <div>
          <label style="display:block;font-size:11.5px;color:var(--muted);margin-bottom:5px;">Senha</label>
          <input id="auth-pass" class="inp" type="password" required placeholder="Mínimo 4 caracteres" autocomplete="current-password" />
        </div>
        <label id="auth-bio-wrap" style="display:none;align-items:center;gap:9px;font-size:12px;color:#e2e8f0;padding:9px 11px;border-radius:11px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);cursor:pointer;">
          <input id="auth-bio-check" type="checkbox" checked style="width:16px;height:16px;accent-color:#38bdf8;" />
          <span>Habilitar desbloqueio por impressão digital</span>
        </label>
        <div id="auth-error" style="display:none;font-size:12px;color:var(--rose);padding:8px 10px;border-radius:10px;background:var(--rose-dim);border:1px solid rgba(251,113,133,0.3);"></div>
        <button type="submit" id="auth-submit-btn" class="btn primary" style="width:100%;padding:11px;">Entrar no Núcleo</button>
      </form>
      <button type="button" id="auth-bio-btn" class="btn cyan" onclick="triggerAndroidBiometric()" style="display:none;width:100%;padding:11px;margin-top:10px;justify-content:center;">
        <span id="auth-bio-ico-slot"></span>
        <span>Desbloquear com Impressão Digital</span>
      </button>
      <div id="auth-footer" style="margin-top:14px;font-size:11px;color:var(--muted);line-height:1.45;">
        Execução 100% local em <span class="mono" style="color:var(--amber-soft);">127.0.0.1:3847</span> com cofre AES-256-GCM e sincronização opcional com Google Workspace.
      </div>
    </div>
  </div>

  <!-- Action Confirmation Modal -->
  <div id="confirm-overlay" class="spatial-stage">
    <div class="spatial-panel" style="width:min(480px,100%);padding:22px;display:flex;flex-direction:column;gap:14px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="nav-ico-box" style="background:var(--rose-dim);border-color:rgba(251,113,133,0.4);color:var(--rose);" id="confirm-ico-slot"></div>
        <div>
          <div id="confirm-title" style="font-size:15px;font-weight:700;color:#fff;">Confirmação de Segurança</div>
          <div style="font-size:11.5px;color:var(--muted);">Ação com efeito colateral no sistema ou conta</div>
        </div>
      </div>
      <div id="confirm-detail" class="mono" style="font-size:12px;background:rgba(0,0,0,0.45);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:12px;color:var(--amber-soft);white-space:pre-wrap;word-break:break-word;"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button class="btn" onclick="resolveConfirmModal(false)">Cancelar</button>
        <button class="btn primary" onclick="resolveConfirmModal(true)">Autorizar Execução</button>
      </div>
    </div>
  </div>

  <div id="toast-wrap" class="toast-wrap"></div>

<script>
(function() {
  'use strict';

  var PLATFORM_MODE = '${platformMode}';
  var APP_VERSION = '${appVersion}';
  var DEFAULT_CLOUD_ORIGIN = '${defaultCloudOrigin}';
  var IS_ANDROID_BRIDGE = typeof window.AegisAndroid !== 'undefined';

  // ===== Crisp Lucide-Matching Inline SVG Icons =====
  var ICONS = {
    menu: '<svg class="svg-ico" viewBox="0 0 24 24"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>',
    x: '<svg class="svg-ico" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    sparkles: '<svg class="svg-ico" viewBox="0 0 24 24"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>',
    brain: '<svg class="svg-ico" viewBox="0 0 24 24"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/></svg>',
    loader: '<svg class="svg-ico spin" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>',
    gitBranch: '<svg class="svg-ico" viewBox="0 0 24 24"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>',
    network: '<svg class="svg-ico" viewBox="0 0 24 24"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></svg>',
    arrowUpRight: '<svg class="svg-ico" viewBox="0 0 24 24"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>',
    arrowDownRight: '<svg class="svg-ico" viewBox="0 0 24 24"><path d="m7 7 10 10"/><path d="M17 7v10H7"/></svg>',
    arrowRight: '<svg class="svg-ico sm" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
    clock: '<svg class="svg-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    check: '<svg class="svg-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
    xCircle: '<svg class="svg-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
    wrench: '<svg class="svg-ico" viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    cpu: '<svg class="svg-ico" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>',
    message: '<svg class="svg-ico" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    smartphone: '<svg class="svg-ico" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
    terminal: '<svg class="svg-ico" viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
    globe: '<svg class="svg-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    settings: '<svg class="svg-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    mic: '<svg class="svg-ico" viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>',
    send: '<svg class="svg-ico sm" viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
    layers: '<svg class="svg-ico" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    chevDown: '<svg class="svg-ico sm" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
    chevUp: '<svg class="svg-ico sm" viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>',
    shield: '<svg class="svg-ico" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    folder: '<svg class="svg-ico" viewBox="0 0 24 24"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>',
    file: '<svg class="svg-ico" viewBox="0 0 24 24"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>',
    key: '<svg class="svg-ico" viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>',
    cloud: '<svg class="svg-ico" viewBox="0 0 24 24"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>',
    refresh: '<svg class="svg-ico sm" viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
    logout: '<svg class="svg-ico sm" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    trash: '<svg class="svg-ico sm" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
    fingerprint: '<svg class="svg-ico" viewBox="0 0 24 24"><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/></svg>',
    googleG: '<svg width="18" height="18" viewBox="0 0 48 48" style="flex-shrink:0;"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>'
  };

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtNum(n) {
    return Number(n || 0).toLocaleString('pt-BR');
  }

  function fmtBytes(b) {
    var n = Number(b || 0);
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function toast(msg) {
    var wrap = document.getElementById('toast-wrap');
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(function() { el.remove(); }, 3400);
  }

  // ===== Global Application State =====
  var state = {
    token: localStorage.getItem('aegis_local_token') || '',
    username: '',
    needsSetup: false,
    authenticated: false,
    biometricAvailable: false,
    biometricEnabled: false,
    activeModule: null,
    activePopover: null,
    drawerOpen: false,
    forceBackground: false,
    modelPreference: 'auto',
    cloudOrigin: DEFAULT_CLOUD_ORIGIN,
    googleClientId: '',
    hasApiKey: false,
    status: null,
    usage: null,
    googleSync: null,
    messages: [],
    holoScreens: [],
    jobs: [],
    deliveredJobIds: {},
    pendingConfirm: null,
    isSending: false,
    voiceListening: false,
    coreVisualState: 'idle', // idle | listening | analyzing | subagent | escalating | curating | executing | speaking
    activity: {
      active: false,
      phase: 'idle',
      summary: 'Orquestração pronta',
      activeModel: '',
      totalSubtasks: 0,
      doneSubtasks: 0,
      curatorState: 'idle', // idle | running | applied | skipped
      curatorModel: '',
      escalated: false,
      fallbackUsed: false,
      totalTokens: 0,
      thoughtsTokens: 0,
      latencyMs: 0,
      events: []
    },
    expandedTrace: {},
    // Module-specific state
    terminalOut: '',
    currentDir: '',
    filesList: [],
    openFile: null,
    webResult: null,
    credentials: [],
    memoryData: { facts: [], recent: [] },
    adbDevices: [],
    adbOutput: '',
    meshStatus: null,
    meshOutput: '',
    meshScanning: false,
    settingsTab: 'google',
    workspaceSubTab: 'drive',
    driveFolderId: 'root',
    driveBreadcrumbs: [{ id: 'root', name: 'Meu Drive' }],
    driveItems: [],
    driveOpenFile: null
  };

  var MODULES = [
    { id: 'command', title: 'Orquestrador & Histórico', sub: 'Chat SSE em tempo real, subagentes e curadoria', icon: 'message' },
    { id: 'orchestrator', title: 'Subagentes, Escalonamento & Consumo', sub: 'Flash Lite → Curador, tokens e economia', icon: 'network' },
    { id: 'devices', title: isAndroidMode() ? 'Dispositivo Android Nativo' : 'Dispositivos & ADB Android', sub: isAndroidMode() ? 'Serviço 24/7, permissões e HUD remoto' : 'Ponte ADB USB/Wi-Fi e controle Android', icon: 'smartphone' },
    { id: 'terminal', title: 'Terminal & Máquina Local', sub: 'Shell nativo, arquivos e editor multimídia', icon: 'terminal' },
    { id: 'web', title: 'Operador Web Autônomo', sub: 'Navegação headless e cofre AES-256-GCM', icon: 'globe' },
    { id: 'memory', title: 'Memória & Autonomia', sub: 'Fatos persistentes e linha do tempo local', icon: 'brain' },
    { id: 'settings', title: 'Google Workspace & Configurações', sub: 'Conectar Google, Drive, Gmail, Agenda e API Key', icon: 'settings' }
  ];

  function isAndroidMode() {
    return PLATFORM_MODE === 'android' || IS_ANDROID_BRIDGE;
  }

  // ===== API Helper (STRICT: uses X-Aegis-Local-Token, NEVER overwrites Google Bearer!) =====
  async function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (state.token) {
      headers['X-Aegis-Local-Token'] = state.token;
    }
    var res = await fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    var text = await res.text();
    var data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
    if (res.status === 401 && !IS_ANDROID_BRIDGE) {
      state.authenticated = false;
      state.token = '';
      localStorage.removeItem('aegis_local_token');
      showAuthGate();
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    if (!res.ok) {
      throw new Error(data.error || ('Erro HTTP ' + res.status));
    }
    return data;
  }

  // ===== 60fps 3D Holographic Core Engine (Canvas 2D with 3D Projection) =====
  var corePulse = 0;
  var mouseNorm = { x: 0, y: 0, tx: 0, ty: 0 };

  function triggerCoreShockwave(intensity) {
    corePulse = Math.max(corePulse, intensity || 1.0);
  }

  function initHologramCore() {
    var canvas = document.getElementById('aegis-core-canvas');
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 0, H = 0;

    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    window.addEventListener('pointermove', function(e) {
      mouseNorm.tx = (e.clientX / Math.max(W, 1) - 0.5) * 2;
      mouseNorm.ty = (e.clientY / Math.max(H, 1) - 0.5) * 2;
    });

    // Fibonacci sphere neural nodes
    var nodes = [];
    var N = 110;
    var golden = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < N; i++) {
      var y = 1 - (i / (N - 1)) * 2;
      var r = Math.sqrt(Math.max(0, 1 - y * y));
      var theta = golden * i;
      nodes.push({ x: Math.cos(theta) * r, y: y, z: Math.sin(theta) * r, phase: Math.random() * 6.28 });
    }

    // Starfield dust
    var dust = [];
    for (var d = 0; d < 75; d++) {
      dust.push({
        angle: Math.random() * 6.28,
        dist: 1.15 + Math.random() * 2.1,
        speed: (Math.random() * 0.14 + 0.04) * (Math.random() > 0.5 ? 1 : -1),
        yOff: (Math.random() - 0.5) * 2.2,
        size: Math.random() * 1.8 + 0.6,
        cyan: Math.random() > 0.72
      });
    }

    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var t = 0;

    function getPalette() {
      var s = state.coreVisualState;
      if (s === 'curating' || s === 'escalating') return { r: 56, g: 189, b: 248, r2: 251, g2: 191, b2: 36, speed: 2.3, energy: 1.35 };
      if (s === 'subagent' || s === 'analyzing') return { r: 251, g: 191, b: 36, r2: 56, g2: 189, b2: 248, speed: 1.9, energy: 1.2 };
      if (s === 'listening') return { r: 52, g: 211, b: 153, r2: 56, g2: 189, b2: 248, speed: 1.7, energy: 1.25 };
      if (s === 'executing') return { r: 245, g: 158, b: 11, r2: 251, g2: 113, b2: 133, speed: 2.1, energy: 1.3 };
      return { r: 245, g: 158, b: 11, r2: 56, g2: 189, b2: 248, speed: 0.75, energy: 0.72 };
    }

    function frame() {
      var pal = getPalette();
      t += reducedMotion ? 0.002 : 0.011 * pal.speed;
      corePulse *= 0.94;
      mouseNorm.x += (mouseNorm.tx - mouseNorm.x) * 0.06;
      mouseNorm.y += (mouseNorm.ty - mouseNorm.y) * 0.06;

      ctx.clearRect(0, 0, W, H);

      var cx = W * 0.5 + mouseNorm.x * 16;
      var cy = H * 0.46 + mouseNorm.y * 12;
      var baseR = Math.min(W, H) * (W < 640 ? 0.21 : 0.185);
      var breathe = 1 + Math.sin(t * 2.1) * 0.025 + corePulse * 0.09;
      var R = baseR * breathe;

      // Ambient Plasma Bloom
      var gBloom = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R * 2.35);
      gBloom.addColorStop(0, 'rgba(' + pal.r + ',' + pal.g + ',' + pal.b + ',' + (0.26 + corePulse * 0.18) + ')');
      gBloom.addColorStop(0.42, 'rgba(' + pal.r2 + ',' + pal.g2 + ',' + pal.b2 + ',0.08)');
      gBloom.addColorStop(1, 'rgba(5,7,11,0)');
      ctx.fillStyle = gBloom;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 2.35, 0, Math.PI * 2);
      ctx.fill();

      // Shockwave Ring
      if (corePulse > 0.04) {
        var swR = R * (1.1 + (1 - corePulse) * 1.4);
        ctx.strokeStyle = 'rgba(' + pal.r + ',' + pal.g + ',' + pal.b + ',' + (corePulse * 0.55) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, swR, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Floating 3D Dust
      for (var dIdx = 0; dIdx < dust.length; dIdx++) {
        var pt = dust[dIdx];
        var ang = pt.angle + t * pt.speed;
        var dx = cx + Math.cos(ang) * R * pt.dist;
        var dy = cy + Math.sin(ang) * R * pt.dist * 0.56 + pt.yOff * R * 0.32;
        var alpha = 0.22 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2 + pt.angle));
        ctx.fillStyle = pt.cyan ? 'rgba(56,189,248,' + alpha + ')' : 'rgba(251,191,36,' + alpha + ')';
        ctx.beginPath();
        ctx.arc(dx, dy, pt.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3 Counter-Rotating Precision Telemetry Rings
      var rings = [
        { rad: R * 1.48, rot: t * 0.42, tilt: 0.36, color: 'rgba(' + pal.r + ',' + pal.g + ',' + pal.b + ',0.32)', segs: 3 },
        { rad: R * 1.26, rot: -t * 0.64, tilt: -0.24, color: 'rgba(' + pal.r2 + ',' + pal.g2 + ',' + pal.b2 + ',0.3)', segs: 4 },
        { rad: R * 1.68, rot: t * 0.22, tilt: 0.14, color: 'rgba(255,255,255,0.12)', segs: 6 }
      ];
      for (var ri = 0; ri < rings.length; ri++) {
        var rg = rings[ri];
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rg.tilt + mouseNorm.x * 0.08);
        ctx.scale(1, 0.92);
        ctx.strokeStyle = rg.color;
        ctx.lineWidth = ri === 0 ? 1.8 : 1.1;
        for (var s = 0; s < rg.segs; s++) {
          var a0 = rg.rot + (s * Math.PI * 2) / rg.segs;
          ctx.beginPath();
          ctx.arc(0, 0, rg.rad, a0, a0 + Math.PI / (rg.segs * 0.85));
          ctx.stroke();
        }
        // Orbital beacon dot
        var bx = Math.cos(rg.rot) * rg.rad;
        var by = Math.sin(rg.rot) * rg.rad;
        ctx.fillStyle = ri === 1 ? 'rgba(56,189,248,0.9)' : 'rgba(251,191,36,0.92)';
        ctx.beginPath();
        ctx.arc(bx, by, 2.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 72-Bar Reactive Neural Corona
      var bars = 72;
      for (var b = 0; b < bars; b++) {
        var ba = (b / bars) * Math.PI * 2 + t * 0.18;
        var wave = Math.sin(b * 0.55 + t * 4.2) * Math.cos(b * 0.25 - t * 2.8);
        var len = (6 + Math.abs(wave) * 16 * pal.energy + corePulse * 20);
        var r0 = R * 1.04;
        var r1 = r0 + len;
        ctx.strokeStyle = b % 6 === 0
          ? 'rgba(' + pal.r2 + ',' + pal.g2 + ',' + pal.b2 + ',0.55)'
          : 'rgba(' + pal.r + ',' + pal.g + ',' + pal.b + ',0.32)';
        ctx.lineWidth = b % 6 === 0 ? 1.7 : 1.1;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ba) * r0, cy + Math.sin(ba) * r0);
        ctx.lineTo(cx + Math.cos(ba) * r1, cy + Math.sin(ba) * r1);
        ctx.stroke();
      }

      // Volumetric Plasma Core Sphere
      var gCore = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.25, R * 0.08, cx, cy, R);
      gCore.addColorStop(0, 'rgba(255, 251, 235, 0.92)');
      gCore.addColorStop(0.28, 'rgba(' + pal.r + ',' + pal.g + ',' + pal.b + ',0.68)');
      gCore.addColorStop(0.72, 'rgba(' + pal.r2 + ',' + pal.g2 + ',' + pal.b2 + ',0.24)');
      gCore.addColorStop(1, 'rgba(5, 7, 11, 0.08)');
      ctx.fillStyle = gCore;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.88, 0, Math.PI * 2);
      ctx.fill();

      // 3D Projected Fibonacci Neural Lattice
      var rotY = t * 0.55 + mouseNorm.x * 0.55;
      var rotX = Math.sin(t * 0.35) * 0.32 - mouseNorm.y * 0.45;
      var cosY = Math.cos(rotY), sinY = Math.sin(rotY);
      var cosX = Math.cos(rotX), sinX = Math.sin(rotX);

      var proj = [];
      for (var ni = 0; ni < nodes.length; ni++) {
        var nd = nodes[ni];
        var x1 = nd.x * cosY - nd.z * sinY;
        var z1 = nd.z * cosY + nd.x * sinY;
        var y2 = nd.y * cosX - z1 * sinX;
        var z2 = z1 * cosX + nd.y * sinX;
        var scale = 1 / (2.55 - z2 * 0.72);
        proj.push({
          sx: cx + x1 * R * 1.82 * scale,
          sy: cy + y2 * R * 1.82 * scale,
          z: z2,
          pulse: 0.5 + 0.5 * Math.sin(t * 3.4 + nd.phase)
        });
      }

      // Connect nearby front neural nodes
      ctx.lineWidth = 0.75;
      for (var a = 0; a < proj.length; a++) {
        if (proj[a].z < -0.15) continue;
        for (var c = a + 1; c < Math.min(a + 7, proj.length); c++) {
          var dx2 = proj[a].sx - proj[c].sx;
          var dy2 = proj[a].sy - proj[c].sy;
          var distSq = dx2 * dx2 + dy2 * dy2;
          if (distSq < R * R * 0.24) {
            var lineA = Math.max(0.04, (proj[a].z + 0.4) * 0.22);
            ctx.strokeStyle = 'rgba(' + pal.r + ',' + pal.g + ',' + pal.b + ',' + lineA + ')';
            ctx.beginPath();
            ctx.moveTo(proj[a].sx, proj[a].sy);
            ctx.lineTo(proj[c].sx, proj[c].sy);
            ctx.stroke();
          }
        }
      }

      for (var pi = 0; pi < proj.length; pi++) {
        var p = proj[pi];
        var aNode = Math.max(0.14, (p.z + 1) * 0.46);
        var radNode = Math.max(1.0, (p.z + 1.3) * 1.35 + p.pulse * 0.8);
        ctx.fillStyle = pi % 7 === 0
          ? 'rgba(' + pal.r2 + ',' + pal.g2 + ',' + pal.b2 + ',' + aNode + ')'
          : 'rgba(255, 244, 214, ' + aNode + ')';
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, radNode, 0, Math.PI * 2);
        ctx.fill();
      }

      // Fresnel Rim Ring
      ctx.strokeStyle = 'rgba(' + pal.r + ',' + pal.g + ',' + pal.b + ',0.5)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.9, 0, Math.PI * 2);
      ctx.stroke();

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ===== Static Icon Boot =====
  function mountStaticIcons() {
    document.getElementById('ico-menu-slot').innerHTML = ICONS.menu;
    document.getElementById('ico-core-slot').innerHTML = ICONS.sparkles;
    document.getElementById('ico-deck-slot').innerHTML = ICONS.layers;
    document.getElementById('pop-think-ico').innerHTML = ICONS.brain;
    document.getElementById('pop-think-close').innerHTML = ICONS.x;
    document.getElementById('pop-jobs-ico').innerHTML = ICONS.clock;
    document.getElementById('pop-jobs-close').innerHTML = ICONS.x;
    document.getElementById('pop-google-ico').innerHTML = ICONS.cloud;
    document.getElementById('pop-google-close').innerHTML = ICONS.x;
    document.getElementById('drawer-brand-ico').innerHTML = ICONS.sparkles;
    document.getElementById('drawer-close-ico').innerHTML = ICONS.x;
    document.getElementById('module-close-ico').innerHTML = ICONS.x;
    document.getElementById('caption-close-ico').innerHTML = ICONS.x;
    document.getElementById('btn-mic').innerHTML = ICONS.mic;
    document.getElementById('btn-bg-mode').innerHTML = ICONS.clock;
    document.getElementById('send-ico-slot').innerHTML = ICONS.send;
    document.getElementById('auth-brand-ico').innerHTML = ICONS.shield;
    document.getElementById('confirm-ico-slot').innerHTML = ICONS.shield;
    var bioIco = document.getElementById('auth-bio-ico-slot');
    if (bioIco) bioIco.innerHTML = ICONS.fingerprint;
  }

  // ===== Core State & Topbar Sync =====
  function setCoreVisualState(nextState) {
    state.coreVisualState = nextState;
    var labels = {
      idle: 'Em Espera',
      listening: 'Ouvindo',
      analyzing: 'Analisando',
      subagent: 'Subagentes',
      escalating: 'Escalonando',
      curating: 'Curadoria',
      executing: 'Executando',
      speaking: 'Respondendo'
    };
    var dotCls = 'dot amber';
    if (nextState === 'curating' || nextState === 'escalating') dotCls = 'dot cyan pulse-dot';
    else if (nextState === 'listening') dotCls = 'dot emerald pulse-dot';
    else if (nextState === 'analyzing' || nextState === 'subagent' || nextState === 'executing') dotCls = 'dot amber pulse-dot';
    document.getElementById('core-state-dot').className = dotCls;
    document.getElementById('core-state-label').textContent = labels[nextState] || 'Em Espera';
  }

  function updateCoreBackdropClass() {
    var stage = document.getElementById('core-stage');
    stage.classList.toggle('dimmed', Boolean(state.activeModule));
    stage.classList.toggle('shifted-left', !state.activeModule && state.holoScreens.length > 0);
    document.getElementById('btn-return-core').style.display = state.activeModule ? 'inline-flex' : 'none';
    document.getElementById('quick-chips').style.display = (!state.activeModule && !state.messages.length) ? 'flex' : 'none';
  }

  function renderThinkingPill() {
    var a = state.activity;
    var btn = document.getElementById('btn-thinking');
    var ico = document.getElementById('thinking-ico-slot');
    var lbl = document.getElementById('thinking-label');
    var cnt = document.getElementById('thinking-count');
    var chev = document.getElementById('thinking-chev-slot');

    btn.className = 'hud-pill';
    if (a.active) btn.classList.add('escalation-sweep-bar');

    if (a.phase === 'escalating') {
      btn.classList.add('amber');
      ico.innerHTML = ICONS.arrowUpRight;
      lbl.textContent = 'Escalonando';
    } else if (a.phase === 'fallback') {
      btn.classList.add('rose');
      ico.innerHTML = ICONS.arrowDownRight;
      lbl.textContent = 'Fallback';
    } else if (a.phase === 'curating') {
      btn.classList.add('cyan');
      ico.innerHTML = ICONS.sparkles;
      lbl.textContent = 'Curadoria';
    } else if (a.phase === 'subagent') {
      btn.classList.add('amber');
      ico.innerHTML = ICONS.gitBranch;
      lbl.textContent = a.totalSubtasks ? ('Subagentes (' + a.doneSubtasks + '/' + a.totalSubtasks + ')') : 'Subagentes';
    } else if (a.phase === 'planning' || a.phase === 'analyzing') {
      btn.classList.add('amber');
      ico.innerHTML = ICONS.loader;
      lbl.textContent = a.phase === 'planning' ? 'Planejando' : 'Pensando';
    } else if (a.phase === 'invoking') {
      btn.classList.add('cyan');
      ico.innerHTML = ICONS.wrench;
      lbl.textContent = 'Ferramentas';
    } else if (a.curatorState === 'skipped' && a.events.length) {
      btn.classList.add('emerald');
      ico.innerHTML = ICONS.check;
      lbl.textContent = 'Curadoria dispensada';
    } else {
      ico.innerHTML = ICONS.brain;
      lbl.textContent = a.events.length ? 'Ver pensamento' : 'Orquestração';
    }

    if (a.events.length > 0) {
      cnt.style.display = 'inline-block';
      cnt.textContent = String(a.events.length);
    } else {
      cnt.style.display = 'none';
    }
    chev.innerHTML = state.activePopover === 'thinking' ? ICONS.chevUp : ICONS.chevDown;
  }

  function renderThinkingPanel() {
    renderThinkingPill();
    var body = document.getElementById('thinking-body');
    var a = state.activity;

    var html = '';
    // Pipeline Strip (Worker -> Curator)
    var workerBadge = a.totalSubtasks > 0
      ? '<span class="tag amber">' + ICONS.gitBranch + ' Trabalho Bruto: Flash Lite (' + a.doneSubtasks + '/' + a.totalSubtasks + ')</span>'
      : '<span class="tag">Trabalho Bruto: Flash Lite</span>';

    var curBadge = '<span class="tag">Curador: Aguardando</span>';
    if (a.curatorState === 'running') {
      curBadge = '<span class="tag cyan">' + ICONS.loader + ' Curador: ' + esc(a.curatorModel || 'Flash/Pro') + '</span>';
    } else if (a.curatorState === 'applied') {
      curBadge = '<span class="tag cyan">' + ICONS.sparkles + ' Curado: ' + esc(a.curatorModel || 'Flash/Pro') + '</span>';
    } else if (a.curatorState === 'skipped') {
      curBadge = '<span class="tag emerald">' + ICONS.check + ' Curador: Dispensado</span>';
    }

    html += '<div class="pipeline-strip">' + workerBadge + ICONS.arrowRight + curBadge + '</div>';

    if (!a.events.length) {
      html += '<div class="spatial-card" style="padding:16px;text-align:center;color:var(--muted);font-size:12px;line-height:1.55;">'
        + 'Envie um comando para acompanhar ao vivo o <strong>plano de subtarefas</strong>, o <strong>trabalho bruto dos subagentes Flash Lite</strong>, o <strong>raciocínio interno</strong> e o <strong>gate de curadoria/escalonamento</strong>.'
        + '</div>';
    } else {
      for (var i = 0; i < a.events.length; i++) {
        var ev = a.events[i];
        var key = 'ev_' + i;
        var expanded = Boolean(state.expandedTrace[key] || ev.kind === 'plan' || (i === a.events.length - 1 && ev.detail));
        var cardCls = 'trace-card';
        var ico = ICONS.brain;
        if (ev.kind === 'plan') { cardCls += ' plan'; ico = ICONS.gitBranch; }
        else if (ev.kind === 'thought') {
          cardCls += ev.role === 'curator' ? ' thought-curator' : ' thought-worker';
          ico = ICONS.brain;
        }
        else if (ev.kind === 'curation_skipped' || (ev.kind === 'curator' && ev.status === 'skipped')) { cardCls += ' skipped'; ico = ICONS.check; }
        else if (ev.kind === 'escalation' || ev.kind === 'escalated') { cardCls += ' escalated'; ico = ICONS.arrowUpRight; }
        else if (ev.kind === 'fallback') { cardCls += ' escalated'; ico = ICONS.arrowDownRight; }
        else if (ev.kind === 'tool') { ico = ICONS.wrench; }
        else if (ev.kind === 'worker' || ev.kind === 'worker_done' || ev.kind === 'worker_start') { ico = ev.status === 'running' ? ICONS.loader : ICONS.cpu; }
        else if (ev.kind === 'curator' || ev.kind === 'curator_start' || ev.kind === 'curator_done') { ico = ev.status === 'running' ? ICONS.loader : ICONS.sparkles; }

        html += '<div class="' + cardCls + '">';
        html += '<button class="trace-head" onclick="toggleTraceKey(\\'' + key + '\\')">';
        html += '<span style="display:flex;align-items:center;gap:7px;min-width:0;">' + ico + '<span style="overflow:hidden;text-overflow:ellipsis;">' + esc(ev.title || ev.message || ev.kind) + '</span></span>';
        html += '<span style="display:flex;align-items:center;gap:6px;flex-shrink:0;">';
        if (ev.model) html += '<span class="tag" style="font-size:10px;padding:1px 6px;">' + esc(ev.model) + '</span>';
        if (ev.latencyMs) html += '<span class="mono" style="font-size:10px;color:var(--muted);">' + ev.latencyMs + 'ms</span>';
        if (ev.detail || (ev.subtasks && ev.subtasks.length)) html += (expanded ? ICONS.chevUp : ICONS.chevDown);
        html += '</span></button>';

        if (expanded) {
          if (ev.subtasks && ev.subtasks.length) {
            html += '<div class="trace-body">';
            for (var si = 0; si < ev.subtasks.length; si++) {
              var st = ev.subtasks[si];
              html += '<div style="display:flex;align-items:flex-start;gap:7px;margin-bottom:5px;">'
                + '<span class="tag amber" style="font-size:10px;">#' + (si + 1) + '</span>'
                + '<span><strong>' + esc(st.label || st.title || st.id) + '</strong>' + (st.objective ? ' — ' + esc(st.objective) : '') + '</span>'
                + '</div>';
            }
            html += '</div>';
          } else if (ev.detail) {
            html += '<div class="trace-body">' + esc(ev.detail) + '</div>';
          }
        }
        html += '</div>';
      }
    }

    body.innerHTML = html;
    var foot = document.getElementById('thinking-foot-metrics');
    if (a.totalTokens || a.latencyMs) {
      foot.textContent = fmtNum(a.totalTokens) + ' tokens' + (a.thoughtsTokens ? ' (' + fmtNum(a.thoughtsTokens) + ' pensamento)' : '') + (a.latencyMs ? ' · ' + a.latencyMs + 'ms' : '');
    } else {
      foot.textContent = a.summary || 'Pronto';
    }
  }

  window.toggleTraceKey = function(k) {
    state.expandedTrace[k] = !state.expandedTrace[k];
    renderThinkingPanel();
  };

  // ===== Background Jobs UI & Polling =====
  function renderJobsUI() {
    var running = state.jobs.filter(function(j) { return j.status === 'running' || j.status === 'queued'; });
    var btn = document.getElementById('btn-jobs');
    var ico = document.getElementById('jobs-ico-slot');
    var cnt = document.getElementById('jobs-count');

    btn.className = 'hud-pill' + (running.length ? ' cyan escalation-sweep-bar' : '');
    ico.innerHTML = running.length ? ICONS.loader : ICONS.clock;
    if (state.jobs.length) {
      cnt.style.display = 'inline-block';
      cnt.textContent = running.length ? (running.length + ' ativa') : String(state.jobs.length);
    } else {
      cnt.style.display = 'none';
    }

    var body = document.getElementById('jobs-body');
    if (!state.jobs.length) {
      body.innerHTML = '<div class="spatial-card" style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">'
        + 'Nenhuma tarefa em segundo plano. Ative o ícone de relógio na barra de comando ou envie uma demanda complexa para rodar sem travar o chat.'
        + '</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < state.jobs.length; i++) {
      var j = state.jobs[i];
      var statusTag = j.status === 'running'
        ? '<span class="tag cyan">' + ICONS.loader + ' Em execução</span>'
        : j.status === 'completed'
        ? '<span class="tag emerald">' + ICONS.check + ' Concluída</span>'
        : '<span class="tag rose">' + ICONS.xCircle + ' Erro</span>';

      html += '<div class="spatial-card" style="padding:12px;display:flex;flex-direction:column;gap:8px;">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">'
        + statusTag
        + '<span class="mono" style="font-size:10.5px;color:var(--muted);">' + esc(j.activeModel || 'auto') + '</span></div>';
      html += '<div style="font-size:12.5px;font-weight:600;color:#fff;">' + esc(j.title || j.prompt) + '</div>';
      html += '<div style="font-size:11.5px;color:var(--muted);">' + esc(j.latestActivity || j.progress || (j.status === 'completed' ? 'Resultado entregue ao chat.' : 'Processando...')) + '</div>';
      html += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">';
      var jTrace = j.thinkingTrace || j.trace || [];
      if (jTrace.length) {
        html += '<button class="btn sm cyan" onclick="inspectJobTrace(\\'' + esc(j.id) + '\\')">Ver pensamento (' + jTrace.length + ')</button>';
      }
      if (j.status === 'completed' && (j.reply || (j.result && j.result.reply))) {
        html += '<button class="btn sm" onclick="openJobReply(\\'' + esc(j.id) + '\\')">Ver resposta</button>';
      }
      html += '<button class="btn sm danger" style="margin-left:auto;" onclick="deleteJob(\\'' + esc(j.id) + '\\')">' + ICONS.trash + '</button>';
      html += '</div></div>';
    }
    body.innerHTML = html;
  }

  window.inspectJobTrace = function(jobId) {
    var job = state.jobs.find(function(x) { return x.id === jobId; });
    if (!job) return;
    loadTraceIntoActivity(job.thinkingTrace || job.trace || [], job.usage || job.result || {});
    togglePopover('thinking', true);
  };

  window.openJobReply = function(jobId) {
    var job = state.jobs.find(function(x) { return x.id === jobId; });
    if (!job) return;
    var replyText = job.reply || (job.result && job.result.reply) || '';
    if (!replyText) return;
    showCaption(replyText, job.usage || job.result || {});
    closeAllPopovers();
  };

  window.deleteJob = async function(jobId) {
    try {
      await api('/jobs/' + encodeURIComponent(jobId), { method: 'DELETE' });
      state.jobs = state.jobs.filter(function(j) { return j.id !== jobId; });
      renderJobsUI();
    } catch (e) { toast(e.message); }
  };

  window.refreshJobs = async function() {
    if (!state.authenticated || IS_ANDROID_BRIDGE) return;
    try {
      var data = await api('/jobs');
      var list = Array.isArray(data.jobs) ? data.jobs : [];
      state.jobs = list;

      for (var i = 0; i < list.length; i++) {
        var job = list[i];
        if ((job.status === 'completed' || job.status === 'failed') && !state.deliveredJobIds[job.id]) {
          state.deliveredJobIds[job.id] = true;
          if (job.status === 'completed' && (job.reply || job.result)) {
            var payload = job.result || {
              reply: job.reply,
              usage: job.usage,
              screens: job.screens,
              thinkingTrace: job.thinkingTrace,
              pendingConfirmations: job.pendingConfirmations
            };
            pushAssistantMessage(payload, '2º Plano concluído: ' + (job.title || job.prompt));
            if (Array.isArray(payload.pendingConfirmations) && payload.pendingConfirmations.length) {
              openConfirmModal(payload.pendingConfirmations[0]);
            }
            triggerCoreShockwave(0.95);
            toast('Tarefa em 2º plano concluída!');
          } else if (job.status === 'failed') {
            toast('Falha na tarefa em 2º plano: ' + (job.error || 'erro'));
          }
        }
      }
      renderJobsUI();
    } catch (e) {}
  };

  // ===== Google Account & Local Status Popover =====
  function renderGooglePillAndPopover() {
    var connected = Boolean(state.googleSync && state.googleSync.connected) || Boolean(state.status && state.status.googleConnected);
    var email = (state.googleSync && state.googleSync.email) || (state.status && state.status.googleEmail) || '';
    var pill = document.getElementById('btn-google-pill');
    var dot = document.getElementById('google-dot');
    var lbl = document.getElementById('google-pill-label');

    if (connected) {
      pill.className = 'hud-pill emerald';
      dot.className = 'dot emerald';
      lbl.textContent = (isAndroidMode() ? 'Android' : 'Local') + ' · Google ✓';
    } else {
      pill.className = 'hud-pill amber';
      dot.className = 'dot amber';
      lbl.textContent = (isAndroidMode() ? 'Android' : 'Local') + ' · Conectar Google';
    }

    var body = document.getElementById('google-popover-body');
    var st = state.status || {};
    var counts = (state.googleSync && state.googleSync.counts) || st.googleCounts || { drive: 0, gmail: 0, calendar: 0, tasks: 0 };

    var html = '';
    if (!IS_ANDROID_BRIDGE) {
      html += '<div class="grid-3">'
        + '<div class="spatial-card" style="padding:10px;"><div style="font-size:10.5px;color:var(--muted);">CPU</div><div class="mono" style="font-size:14px;font-weight:700;color:var(--amber-hi);">' + (st.cpuUsagePercent != null ? st.cpuUsagePercent + '%' : '--') + '</div></div>'
        + '<div class="spatial-card" style="padding:10px;"><div style="font-size:10.5px;color:var(--muted);">RAM</div><div class="mono" style="font-size:14px;font-weight:700;color:var(--cyan);">' + (st.ramUsagePercent != null ? st.ramUsagePercent + '%' : '--') + '</div></div>'
        + '<div class="spatial-card" style="padding:10px;"><div style="font-size:10.5px;color:var(--muted);">Gemini Key</div><div style="font-size:12px;font-weight:700;color:' + (state.hasApiKey ? 'var(--emerald)' : 'var(--rose)') + ';">' + (state.hasApiKey ? 'Ativa ✓' : 'Configurar') + '</div></div>'
        + '</div>';
    }

    html += '<div class="spatial-card" style="padding:14px;display:flex;flex-direction:column;gap:11px;">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">'
      + '<div style="display:flex;align-items:center;gap:9px;">' + ICONS.googleG
      + '<div><div style="font-size:13px;font-weight:700;color:#fff;">Google Workspace</div>'
      + '<div style="font-size:11px;color:var(--muted);">' + (connected ? esc(email || 'Conta Google conectada') : 'Drive, Gmail, Agenda e Tarefas no app local') + '</div></div></div>'
      + (connected ? '<span class="tag emerald">Conectado</span>' : '<span class="tag amber">Offline</span>')
      + '</div>';

    if (connected) {
      if (!IS_ANDROID_BRIDGE) {
        html += '<div class="grid-4" style="gap:7px;">'
          + '<div style="padding:7px;border-radius:10px;background:rgba(255,255,255,0.03);text-align:center;"><div class="mono" style="font-size:14px;font-weight:700;color:#fff;">' + counts.drive + '</div><div style="font-size:10px;color:var(--muted);">Drive</div></div>'
          + '<div style="padding:7px;border-radius:10px;background:rgba(255,255,255,0.03);text-align:center;"><div class="mono" style="font-size:14px;font-weight:700;color:#fff;">' + counts.gmail + '</div><div style="font-size:10px;color:var(--muted);">Gmail</div></div>'
          + '<div style="padding:7px;border-radius:10px;background:rgba(255,255,255,0.03);text-align:center;"><div class="mono" style="font-size:14px;font-weight:700;color:#fff;">' + counts.calendar + '</div><div style="font-size:10px;color:var(--muted);">Agenda</div></div>'
          + '<div style="padding:7px;border-radius:10px;background:rgba(255,255,255,0.03);text-align:center;"><div class="mono" style="font-size:14px;font-weight:700;color:#fff;">' + counts.tasks + '</div><div style="font-size:10px;color:var(--muted);">Tarefas</div></div>'
          + '</div>';
      }
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
        + (!IS_ANDROID_BRIDGE ? '<button class="btn sm emerald" onclick="syncGoogleNow()">' + ICONS.refresh + ' Sincronizar</button>' : '<button class="btn sm cyan" onclick="openRemoteHudExternal()">Abrir HUD Web</button>')
        + '<button class="btn sm cyan" onclick="openModule(\\'settings\\'); closeAllPopovers();">' + (IS_ANDROID_BRIDGE ? 'Configurações' : 'Explorar Drive & Gmail') + '</button>'
        + '<button class="btn sm danger" style="margin-left:auto;" onclick="disconnectGoogle()">Desconectar</button>'
        + '</div>';
    } else {
      html += '<button class="gsi-material-button" style="width:100%;" onclick="connectGoogleOneClick()">' + ICONS.googleG + '<span>Conectar com Google (1 Clique)</span></button>';
      html += '<div style="display:flex;gap:8px;">'
        + (IS_ANDROID_BRIDGE
          ? '<button class="btn sm cyan" style="flex:1;" onclick="openRemoteHudExternal()">Abrir HUD Web (Navegador)</button>'
          : '<button class="btn sm" style="flex:1;" onclick="openModule(\\'settings\\'); closeAllPopovers();">OAuth Client ID / Token</button>')
        + '</div>';
    }
    html += '</div>';

    if (!state.hasApiKey && !IS_ANDROID_BRIDGE) {
      html += '<div class="spatial-card" style="padding:12px;border-color:rgba(251,191,36,0.35);background:rgba(245,158,11,0.08);font-size:12px;color:var(--amber-soft);display:flex;align-items:center;justify-content:space-between;gap:10px;">'
        + '<span>Defina sua GEMINI_API_KEY para ativar os subagentes locais.</span>'
        + '<button class="btn sm primary" onclick="state.settingsTab=\\'system\\'; openModule(\\'settings\\'); closeAllPopovers();">Configurar</button>'
        + '</div>';
    }

    body.innerHTML = html;
  }

  window.openRemoteHudExternal = function(customOrigin) {
    var origin = (customOrigin || state.cloudOrigin || DEFAULT_CLOUD_ORIGIN || '').trim().replace(/\\/+$/, '');
    if (!origin) {
      toast('Informe a URL do Aegis Web.');
      return;
    }
    if (IS_ANDROID_BRIDGE && window.AegisAndroid && window.AegisAndroid.openRemoteHud) {
      window.AegisAndroid.openRemoteHud(origin);
      return;
    }
    window.open(origin, '_blank');
  };

  // ===== Google OAuth 1-Click & Direct Popup Flow =====
  window.connectGoogleOneClick = function() {
    var origin = (state.cloudOrigin || DEFAULT_CLOUD_ORIGIN || '').replace(/\\/+$/, '');
    if (!origin) {
      state.settingsTab = 'google';
      openModule('settings');
      toast('Informe a URL do Aegis Web ou seu Google OAuth Client ID.');
      return;
    }
    if (IS_ANDROID_BRIDGE && window.AegisAndroid) {
      if (window.AegisAndroid.connectGoogleWorkspace) {
        toast('Abrindo login Google seguro no navegador...');
        window.AegisAndroid.connectGoogleWorkspace(origin);
        return;
      }
      if (window.AegisAndroid.openRemoteHud) {
        window.AegisAndroid.openRemoteHud(origin);
        return;
      }
    }
    var returnTo = window.location.origin + '/google/oauth/receive';
    var url = origin + '/?aegis_local_google_connect=1&return_to=' + encodeURIComponent(returnTo);
    var popup = window.open(url, 'aegis_google_oauth', 'width=540,height=680,menubar=no,toolbar=no');
    if (!popup) {
      window.location.href = url;
    } else {
      toast('Conclua o login Google na janela aberta...');
    }
  };

  window.onAndroidGoogleConnected = function(email) {
    refreshStatusAndGoogle();
    loadMeshStatus();
    if (state.activeModule === 'settings' || state.activeModule === 'devices') renderModuleContent();
    toast('Conta Google conectada' + (email ? ': ' + email : '!'));
  };

  window.connectGoogleDirectClientId = function() {
    var cid = (state.googleClientId || '').trim();
    if (!cid) {
      toast('Salve um Google OAuth Client ID primeiro.');
      return;
    }
    var redirectUri = window.location.origin + '/google/oauth/receive';
    var scopes = [
      'openid', 'email', 'profile',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/tasks'
    ].join(' ');
    var authUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
      + '?client_id=' + encodeURIComponent(cid)
      + '&redirect_uri=' + encodeURIComponent(redirectUri)
      + '&response_type=token'
      + '&include_granted_scopes=true'
      + '&prompt=consent'
      + '&scope=' + encodeURIComponent(scopes);
    var popup = window.open(authUrl, 'aegis_google_direct_oauth', 'width=540,height=680');
    if (!popup) window.location.href = authUrl;
  };

  window.addEventListener('message', function(ev) {
    if (ev && ev.data && ev.data.type === 'aegis-google-oauth-complete') {
      toast('Conta Google conectada e sincronizada!');
      refreshStatusAndGoogle().then(function() {
        if (state.activeModule === 'settings') renderModuleContent();
      });
    }
  });

  window.syncGoogleNow = async function() {
    try {
      toast('Sincronizando Google Workspace...');
      await api('/google/sync', { method: 'POST', body: {} });
      await refreshStatusAndGoogle();
      if (state.activeModule === 'settings') renderModuleContent();
      toast('Google Workspace sincronizado!');
    } catch (e) { toast(e.message); }
  };

  window.disconnectGoogle = async function() {
    try {
      if (IS_ANDROID_BRIDGE && window.AegisAndroid && window.AegisAndroid.disconnectGoogle) {
        window.AegisAndroid.disconnectGoogle();
        await refreshStatusAndGoogle();
        if (state.activeModule === 'settings' || state.activeModule === 'devices') renderModuleContent();
        toast('Conta Google desconectada.');
        return;
      }
      await api('/connections', { method: 'POST', body: { provider: 'google', token: null } });
      await refreshStatusAndGoogle();
      if (state.activeModule === 'settings') renderModuleContent();
      toast('Conta Google desconectada.');
    } catch (e) { toast(e.message); }
  };

  // ===== Popovers & Drawer Controls =====
  window.closeAllPopovers = function() {
    state.activePopover = null;
    document.getElementById('popover-thinking').classList.remove('open');
    document.getElementById('popover-jobs').classList.remove('open');
    document.getElementById('popover-google').classList.remove('open');
    renderThinkingPill();
  };

  window.togglePopover = function(name, forceOpen) {
    var targetId = 'popover-' + name;
    var isSame = state.activePopover === name;
    closeAllPopovers();
    if (!isSame || forceOpen) {
      state.activePopover = name;
      document.getElementById(targetId).classList.add('open');
      if (name === 'thinking') renderThinkingPanel();
      if (name === 'jobs') { refreshJobs(); renderJobsUI(); }
      if (name === 'google') { refreshStatusAndGoogle(); renderGooglePillAndPopover(); }
    }
    renderThinkingPill();
  };

  window.toggleDrawer = function(force) {
    state.drawerOpen = typeof force === 'boolean' ? force : !state.drawerOpen;
    document.getElementById('drawer-backdrop').classList.toggle('open', state.drawerOpen);
    document.getElementById('spatial-drawer').classList.toggle('open', state.drawerOpen);
    if (state.drawerOpen) {
      closeAllPopovers();
      renderDrawer();
    }
  };

  function renderDrawer() {
    var nav = document.getElementById('drawer-nav');
    var html = '';
    for (var i = 0; i < MODULES.length; i++) {
      var m = MODULES[i];
      var act = state.activeModule === m.id ? ' active' : '';
      html += '<button class="nav-card drawer-stagger' + act + '" style="animation-delay:' + (i * 42) + 'ms;" onclick="openModule(\\'' + m.id + '\\'); toggleDrawer(false);">'
        + '<div class="nav-ico-box">' + (ICONS[m.icon] || ICONS.sparkles) + '</div>'
        + '<div style="min-width:0;flex:1;">'
        + '<div class="nav-title">' + esc(m.title) + '</div>'
        + '<div class="nav-sub">' + esc(m.sub) + '</div>'
        + '</div></button>';
    }
    nav.innerHTML = html;

    var tot = (state.usage && state.usage.totals) || {};
    var gConn = Boolean(state.googleSync && state.googleSync.connected);
    var foot = document.getElementById('drawer-footer');
    foot.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;font-size:11.5px;">'
      + '<span style="color:#e2e8f0;font-weight:600;">' + esc(state.username || (isAndroidMode() ? 'Android Local' : 'Operador')) + '</span>'
      + '<span class="tag ' + (gConn ? 'emerald' : 'amber') + '">' + (gConn ? 'Google Conectado' : 'Google Offline') + '</span>'
      + '</div>'
      + '<div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--muted);">'
      + '<span class="mono">' + (IS_ANDROID_BRIDGE ? (state.biometricEnabled ? 'Biometria ativa ✓' : 'Login local ativo') : (fmtNum(tot.totalTokens || 0) + ' tokens · ' + (tot.curationsSkipped || 0) + ' economias')) + '</span>'
      + '<button class="btn sm danger" onclick="logoutLocal()">' + ICONS.logout + (IS_ANDROID_BRIDGE ? ' Bloquear' : ' Sair') + '</button>'
      + '</div>';
  }

  // ===== Module Stage Navigation =====
  window.openModule = function(id) {
    state.activeModule = id;
    var mod = MODULES.find(function(m) { return m.id === id; }) || MODULES[0];
    document.getElementById('module-ico-slot').innerHTML = ICONS[mod.icon] || ICONS.sparkles;
    document.getElementById('module-title').textContent = mod.title;
    document.getElementById('module-subtitle').textContent = mod.sub;
    var stage = document.getElementById('module-stage');
    stage.classList.add('open');
    updateCoreBackdropClass();
    renderModuleContent();

    if (id === 'orchestrator') refreshUsage().then(renderModuleContent);
    if (id === 'terminal' && !state.filesList.length) loadLocalFiles('');
    if (id === 'web') loadCredentials();
    if (id === 'memory') loadMemory();
    if (id === 'devices') {
      loadMeshStatus();
      if (!IS_ANDROID_BRIDGE) loadAdbDevices();
    }
    if (id === 'settings') {
      refreshStatusAndGoogle().then(function() {
        if (state.googleSync && state.googleSync.connected && !state.driveItems.length) {
          loadDriveFolder('root');
        }
        renderModuleContent();
      });
    }
  };

  window.closeModule = function() {
    state.activeModule = null;
    document.getElementById('module-stage').classList.remove('open');
    updateCoreBackdropClass();
  };

  // ===== Caption & Holographic Screen Deck =====
  function showCaption(text, meta) {
    if (state.activeModule === 'command') return;
    var card = document.getElementById('caption-card');
    var badges = document.getElementById('caption-badges');
    var body = document.getElementById('caption-text');
    var bHtml = '<span class="tag amber">' + ICONS.sparkles + ' Aegis</span>';
    if (meta && meta.model) bHtml += '<span class="tag">' + esc(meta.model) + '</span>';
    if (meta && meta.curationSkipped) bHtml += '<span class="tag emerald">Curadoria dispensada</span>';
    else if (meta && meta.curatorModel) bHtml += '<span class="tag cyan">Curado: ' + esc(meta.curatorModel) + '</span>';
    if (meta && meta.totalTokens) bHtml += '<span class="tag mono">' + fmtNum(meta.totalTokens) + ' tok</span>';
    badges.innerHTML = bHtml;
    body.textContent = text || '';
    card.classList.add('open');
  }

  window.hideCaption = function() {
    document.getElementById('caption-card').classList.remove('open');
  };

  function addHoloScreen(screen) {
    if (!screen || !screen.title) return;
    state.holoScreens.unshift({
      id: 'scr_' + Date.now(),
      title: screen.title,
      subtitle: screen.subtitle || '',
      content: screen.content || screen.html || ''
    });
    if (state.holoScreens.length > 6) state.holoScreens.pop();
    renderHoloDeck();
  }

  function renderHoloDeck() {
    var deck = document.getElementById('holo-deck');
    var btn = document.getElementById('btn-toggle-deck');
    document.getElementById('deck-count-label').textContent = state.holoScreens.length + (state.holoScreens.length === 1 ? ' Tela' : ' Telas');
    btn.style.display = state.holoScreens.length ? 'inline-flex' : 'none';
    if (!state.holoScreens.length || state.activeModule) {
      deck.classList.remove('open');
    } else {
      deck.classList.add('open');
    }
    var html = '';
    for (var i = 0; i < state.holoScreens.length; i++) {
      var s = state.holoScreens[i];
      html += '<div class="holo-screen-frame">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(56,189,248,0.2);">'
        + '<div><div style="font-size:13px;font-weight:700;color:var(--cyan-soft);">' + esc(s.title) + '</div>'
        + (s.subtitle ? '<div style="font-size:11px;color:var(--muted);">' + esc(s.subtitle) + '</div>' : '')
        + '</div>'
        + '<button class="icon-btn" style="width:28px;height:28px;" onclick="removeHoloScreen(\\'' + esc(s.id) + '\\')">' + ICONS.x + '</button>'
        + '</div>'
        + '<div style="padding:13px 14px;font-size:12.5px;line-height:1.55;color:#e2e8f0;white-space:pre-wrap;">' + esc(s.content) + '</div>'
        + '</div>';
    }
    deck.innerHTML = html;
    updateCoreBackdropClass();
  }

  window.removeHoloScreen = function(id) {
    state.holoScreens = state.holoScreens.filter(function(s) { return s.id !== id; });
    renderHoloDeck();
  };

  // ===== Real-Time SSE Orchestrator & Activity Stream =====
  function resetActivity(promptText) {
    state.expandedTrace = {};
    state.activity = {
      active: true,
      phase: 'analyzing',
      summary: 'Analisando demanda: ' + String(promptText || '').slice(0, 60),
      activeModel: '',
      totalSubtasks: 0,
      doneSubtasks: 0,
      curatorState: 'idle',
      curatorModel: '',
      escalated: false,
      fallbackUsed: false,
      totalTokens: 0,
      thoughtsTokens: 0,
      latencyMs: 0,
      events: []
    };
    setCoreVisualState('analyzing');
    renderThinkingPanel();
  }

  function syncActivityCountsFromEvents() {
    var a = state.activity;
    var planEv = null;
    var workersDone = 0;
    for (var i = 0; i < a.events.length; i++) {
      var e = a.events[i];
      if (e.kind === 'plan' && Array.isArray(e.subtasks)) planEv = e;
      if (e.kind === 'worker' && e.status === 'done') workersDone++;
      if (e.kind === 'curator') {
        if (e.status === 'skipped') a.curatorState = 'skipped';
        else if (e.status === 'running') { a.curatorState = 'running'; if (e.model) a.curatorModel = e.model; }
        else if (e.status === 'done') { a.curatorState = 'applied'; if (e.model) a.curatorModel = e.model; }
      }
      if (e.kind === 'escalation') a.escalated = true;
    }
    if (planEv) a.totalSubtasks = planEv.subtasks.length;
    a.doneSubtasks = workersDone;
  }

  function ingestTraceEvent(ev, fullTraceList) {
    var a = state.activity;
    if (Array.isArray(fullTraceList)) {
      a.events = fullTraceList.slice();
    } else if (ev) {
      if (ev.id) {
        var idx = a.events.findIndex(function(x) { return x.id === ev.id; });
        if (idx >= 0) a.events[idx] = ev;
        else a.events.push(ev);
      } else {
        a.events.push(ev);
      }
    }
    syncActivityCountsFromEvents();
    if (ev) {
      if (ev.model) a.activeModel = ev.model;
      if (ev.kind === 'plan') { a.phase = 'planning'; setCoreVisualState('analyzing'); }
      else if (ev.kind === 'worker') { a.phase = 'subagent'; setCoreVisualState('subagent'); }
      else if (ev.kind === 'escalation') { a.phase = 'escalating'; setCoreVisualState('escalating'); }
      else if (ev.kind === 'curator') {
        if (ev.status === 'running') { a.phase = 'curating'; setCoreVisualState('curating'); }
      } else if (ev.kind === 'tool') { a.phase = 'invoking'; setCoreVisualState('executing'); }
      if (ev.title || ev.message) a.summary = ev.title || ev.message;
    }
    renderThinkingPanel();
  }

  function loadTraceIntoActivity(traceList, meta) {
    resetActivity('');
    state.activity.active = false;
    state.activity.phase = 'idle';
    state.activity.events = Array.isArray(traceList) ? traceList.slice() : [];
    syncActivityCountsFromEvents();
    var u = (meta && meta.usage) ? meta.usage : (meta || {});
    state.activity.totalTokens = u.totalTokens || 0;
    state.activity.thoughtsTokens = u.thoughtsTokens || 0;
    state.activity.latencyMs = u.latencyMs || 0;
    if (u.curationSkipped) state.activity.curatorState = 'skipped';
    else if (u.curatorModel) {
      state.activity.curatorState = 'applied';
      state.activity.curatorModel = u.curatorModel;
    }
    setCoreVisualState('idle');
    renderThinkingPanel();
  }

  function pushAssistantMessage(result, prefixLabel) {
    var u = (result && result.usage) ? result.usage : (result || {});
    var traceArr = Array.isArray(result.thinkingTrace) ? result.thinkingTrace : (Array.isArray(result.trace) ? result.trace : []);
    var msg = {
      id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      role: 'assistant',
      text: (prefixLabel ? '[' + prefixLabel + ']\\n\\n' : '') + (result.reply || 'Concluído.'),
      model: u.model || result.model || '',
      curatorModel: u.curatorModel || result.curatorModel || '',
      curationSkipped: Boolean(u.curationSkipped || result.curationSkipped),
      escalated: Boolean(u.escalated || result.escalated),
      subagentCount: u.subtasksCount || result.subagentCount || 0,
      totalTokens: u.totalTokens || result.totalTokens || 0,
      thoughtsTokens: u.thoughtsTokens || result.thoughtsTokens || 0,
      latencyMs: u.latencyMs || result.latencyMs || 0,
      trace: traceArr,
      ts: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };
    state.messages.push(msg);
    var scrList = result.screens || result.holoScreens || [];
    for (var i = 0; i < scrList.length; i++) addHoloScreen(scrList[i]);
    if (result.holographicScreen) addHoloScreen(result.holographicScreen);

    showCaption(msg.text, msg);
    if (state.activeModule === 'command') renderModuleContent();
    updateCoreBackdropClass();
  }

  window.inspectMessageTrace = function(msgId) {
    var msg = state.messages.find(function(m) { return m.id === msgId; });
    if (!msg) return;
    loadTraceIntoActivity(msg.trace || [], msg);
    togglePopover('thinking', true);
  };

  window.sendPrompt = async function(promptText, forceBgOverride) {
    var text = String(promptText || '').trim();
    if (!text || state.isSending) return;

    if (IS_ANDROID_BRIDGE) {
      toast('Conecte-se ao Aegis Cloud ou abra o HUD Remoto no módulo Android.');
      openModule('devices');
      return;
    }

    var useBg = typeof forceBgOverride === 'boolean' ? forceBgOverride : state.forceBackground;
    state.isSending = true;
    document.getElementById('btn-send').disabled = true;

    state.messages.push({
      id: 'u_' + Date.now(),
      role: 'user',
      text: text,
      ts: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    });
    if (state.activeModule === 'command') renderModuleContent();
    updateCoreBackdropClass();

    triggerCoreShockwave(0.9);
    resetActivity(text);

    try {
      var headers = { 'Content-Type': 'application/json' };
      if (state.token) headers['X-Aegis-Local-Token'] = state.token;

      var res = await fetch('/command/stream', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          prompt: text,
          modelPreference: state.modelPreference,
          forceBackground: useBg
        })
      });

      if (!res.ok) {
        var errTxt = await res.text();
        throw new Error(errTxt || ('Erro HTTP ' + res.status));
      }

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var currentEvent = 'message';
      var receivedFinal = false;

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\\n');
        buffer = lines.pop() || '';

        for (var li = 0; li < lines.length; li++) {
          var line = lines[li].replace(/\\r$/, '');
          if (line.indexOf('event:') === 0) {
            currentEvent = line.slice(6).trim();
          } else if (line.indexOf('data:') === 0) {
            var payloadStr = line.slice(5).trim();
            if (!payloadStr) continue;
            var data = {};
            try { data = JSON.parse(payloadStr); } catch (e) { continue; }

            if (currentEvent === 'routing') {
              if (data.phase) state.activity.phase = data.phase;
              if (data.activeModel) state.activity.activeModel = data.activeModel;
              if (data.curatorModel) state.activity.curatorModel = data.curatorModel;
              if (data.workerCount) state.activity.totalSubtasks = data.workerCount;
              if (data.reason) state.activity.summary = data.reason;
              if (data.phase === 'curating') setCoreVisualState('curating');
              else if (data.phase === 'escalating') setCoreVisualState('escalating');
              else if (data.phase === 'subagent') setCoreVisualState('subagent');
              else if (data.phase === 'invoking') setCoreVisualState('executing');
              renderThinkingPanel();
            } else if (currentEvent === 'trace') {
              ingestTraceEvent(data.entry || data, data.trace);
            } else if (currentEvent === 'background_started') {
              toast('Executando em 2º plano sem travar o chat!');
              refreshJobs();
            } else if (currentEvent === 'final') {
              receivedFinal = true;
              var uFinal = data.usage || data;
              state.activity.active = false;
              state.activity.phase = 'idle';
              if (Array.isArray(data.thinkingTrace)) {
                state.activity.events = data.thinkingTrace.slice();
                syncActivityCountsFromEvents();
              }
              state.activity.totalTokens = uFinal.totalTokens || 0;
              state.activity.thoughtsTokens = uFinal.thoughtsTokens || 0;
              state.activity.latencyMs = uFinal.latencyMs || 0;
              if (uFinal.curationSkipped) state.activity.curatorState = 'skipped';
              else if (uFinal.curatorModel) {
                state.activity.curatorState = 'applied';
                state.activity.curatorModel = uFinal.curatorModel;
              }
              setCoreVisualState('idle');
              renderThinkingPanel();

              if (Array.isArray(data.pendingConfirmations) && data.pendingConfirmations.length) {
                openConfirmModal(data.pendingConfirmations[0]);
              } else if (data.requiresConfirmation) {
                openConfirmModal(data);
              }
              pushAssistantMessage(data);
              triggerCoreShockwave(0.75);
              refreshUsage();
              if (data.backgroundJob) refreshJobs();
            } else if (currentEvent === 'error') {
              throw new Error(data.error || 'Falha na orquestração.');
            }
          }
        }
      }

      if (!receivedFinal) {
        state.activity.active = false;
        state.activity.phase = 'idle';
        setCoreVisualState('idle');
        renderThinkingPanel();
      }
    } catch (err) {
      state.activity.active = false;
      state.activity.phase = 'idle';
      setCoreVisualState('idle');
      ingestTraceEvent({ kind: 'error', title: 'Erro: ' + err.message });
      pushAssistantMessage({ reply: 'Erro: ' + err.message, trace: state.activity.events.slice() });
      toast(err.message);
    } finally {
      state.isSending = false;
      document.getElementById('btn-send').disabled = false;
    }
  };

  window.handleDockSubmit = function(e) {
    e.preventDefault();
    var inp = document.getElementById('dock-input');
    var v = inp.value.trim();
    if (!v) return;
    inp.value = '';
    sendPrompt(v);
  };

  window.toggleForceBackground = function() {
    state.forceBackground = !state.forceBackground;
    var btn = document.getElementById('btn-bg-mode');
    btn.classList.toggle('active-cyan', state.forceBackground);
    toast(state.forceBackground ? 'Modo 2º Plano ativado para o próximo envio' : 'Modo 2º Plano automático');
  };

  // ===== Web Speech API Voice Dictation =====
  var speechRec = null;
  window.toggleVoiceInput = function() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast('Reconhecimento de voz não suportado neste navegador/WebView.');
      return;
    }
    if (state.voiceListening && speechRec) {
      speechRec.stop();
      return;
    }
    speechRec = new SR();
    speechRec.lang = 'pt-BR';
    speechRec.interimResults = true;
    state.voiceListening = true;
    document.getElementById('btn-mic').classList.add('active-rose');
    setCoreVisualState('listening');

    speechRec.onresult = function(ev) {
      var transcript = '';
      for (var i = 0; i < ev.results.length; i++) {
        transcript += ev.results[i][0].transcript;
      }
      document.getElementById('dock-input').value = transcript;
      if (ev.results[ev.results.length - 1].isFinal) {
        sendPrompt(transcript);
        document.getElementById('dock-input').value = '';
      }
    };
    speechRec.onend = function() {
      state.voiceListening = false;
      document.getElementById('btn-mic').classList.remove('active-rose');
      if (!state.isSending) setCoreVisualState('idle');
    };
    speechRec.onerror = function() {
      state.voiceListening = false;
      document.getElementById('btn-mic').classList.remove('active-rose');
      setCoreVisualState('idle');
    };
    speechRec.start();
  };

  // ===== Safety Confirmation Modal =====
  function openConfirmModal(data) {
    state.pendingConfirm = data;
    var title = 'Confirmar Ação Crítica';
    var detail = '';
    if (data.pendingCommand) {
      title = 'Confirmar Comando no Sistema Local';
      detail = data.pendingCommand;
    } else if (data.type === 'shell' || data.action_type === 'run_shell_command') {
      title = 'Confirmar Comando no Sistema Local';
      detail = (data.summary ? data.summary + '\\n\\n' : '') + (data.target || (data.payload && data.payload.command) || '');
    } else if (data.type === 'web_login' || data.pendingWebLogin) {
      title = 'Confirmar Login Web Autônomo';
      detail = (data.summary ? data.summary + '\\n\\n' : '') + JSON.stringify(data.payload || data.pendingWebLogin || {}, null, 2);
    } else if (data.type === 'google_upload' || data.pendingGoogleUpload) {
      title = 'Confirmar Upload para Google Drive';
      detail = (data.summary ? data.summary + '\\n\\n' : '') + JSON.stringify(data.payload || data.pendingGoogleUpload || {}, null, 2);
    } else {
      detail = JSON.stringify(data, null, 2);
    }
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-detail').textContent = detail;
    document.getElementById('confirm-overlay').classList.add('open');
  }

  window.resolveConfirmModal = async function(approved) {
    var data = state.pendingConfirm;
    state.pendingConfirm = null;
    document.getElementById('confirm-overlay').classList.remove('open');
    if (!approved || !data) {
      toast('Ação cancelada pelo operador.');
      return;
    }
    try {
      var body = {};
      if (data.pendingCommand) body.confirmedCommand = data.pendingCommand;
      else if (data.type === 'shell' || data.action_type === 'run_shell_command') body.confirmedCommand = (data.payload && data.payload.command) || data.target;
      else if (data.pendingWebLogin || data.type === 'web_login') body.confirmedWebLogin = data.pendingWebLogin || data.payload;
      else if (data.pendingGoogleUpload || data.type === 'google_upload') body.confirmedGoogleUpload = data.pendingGoogleUpload || data.payload;
      var res = await api('/command', { method: 'POST', body: body });
      pushAssistantMessage(res, 'Ação Autorizada');
      toast('Execução autorizada concluída.');
    } catch (e) { toast(e.message); }
  };

  // ===== Module Renderers =====
  function renderModuleContent() {
    var body = document.getElementById('module-body');
    var id = state.activeModule;
    if (id === 'command') renderCommandModule(body);
    else if (id === 'orchestrator') renderOrchestratorModule(body);
    else if (id === 'devices') renderDevicesModule(body);
    else if (id === 'terminal') renderTerminalModule(body);
    else if (id === 'web') renderWebModule(body);
    else if (id === 'memory') renderMemoryModule(body);
    else if (id === 'settings') renderSettingsModule(body);
  }

  function renderCommandModule(body) {
    if (!state.messages.length) {
      body.innerHTML = '<div class="spatial-card" style="padding:26px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px;">'
        + '<div class="brand-orb" style="width:48px;height:48px;">' + ICONS.sparkles + '</div>'
        + '<div style="font-size:15px;font-weight:700;color:#fff;">Orquestrador Multi-Agente Local</div>'
        + '<div style="font-size:12.5px;color:var(--muted);max-width:480px;line-height:1.55;">'
        + 'Cada tarefa é decomposta em subtarefas executadas por subagentes <strong>Flash Lite</strong> (trabalho bruto). A curadoria por modelos maiores só é acionada quando realmente agrega qualidade, economizando tokens.'
        + '</div>'
        + '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">'
        + '<button class="btn sm primary" onclick="sendPrompt(\\'Faça um diagnóstico completo desta máquina (CPU, RAM, disco) e sugira melhorias\\')">Diagnóstico Local</button>'
        + '<button class="btn sm cyan" onclick="sendPrompt(\\'Liste e resuma meus últimos e-mails, eventos da agenda e arquivos do Google Drive\\')">Resumo Google</button>'
        + '</div></div>';
      return;
    }

    var html = '<div style="display:flex;flex-direction:column;gap:12px;">';
    for (var i = 0; i < state.messages.length; i++) {
      var m = state.messages[i];
      html += '<div class="chat-msg ' + m.role + '">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">'
        + '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">'
        + '<span class="tag ' + (m.role === 'user' ? 'amber' : 'cyan') + '">' + (m.role === 'user' ? 'Operador' : 'Aegis') + '</span>';
      if (m.model) html += '<span class="tag mono">' + esc(m.model) + '</span>';
      if (m.subagentCount) html += '<span class="tag amber">' + m.subagentCount + ' subagentes</span>';
      if (m.curationSkipped) html += '<span class="tag emerald">Curadoria dispensada</span>';
      else if (m.curatorModel) html += '<span class="tag cyan">Curador: ' + esc(m.curatorModel) + '</span>';
      if (m.escalated) html += '<span class="tag amber">Escalonado</span>';
      if (m.totalTokens) html += '<span class="tag mono">' + fmtNum(m.totalTokens) + ' tok</span>';
      if (m.latencyMs) html += '<span class="tag mono">' + m.latencyMs + 'ms</span>';
      html += '</div><span style="font-size:10.5px;color:var(--muted);">' + esc(m.ts || '') + '</span></div>';

      html += '<div class="chat-content">' + esc(m.text) + '</div>';

      if (m.trace && m.trace.length) {
        html += '<div><button class="btn sm" onclick="inspectMessageTrace(\\'' + esc(m.id) + '\\')">'
          + ICONS.brain + ' Ver pensamento (' + m.trace.length + ' eventos)</button></div>';
      }
      html += '</div>';
    }
    html += '</div>';
    body.innerHTML = html;
    body.scrollTop = body.scrollHeight;
  }

  function renderOrchestratorModule(body) {
    var u = state.usage || {};
    var tot = u.totals || {};
    var byModel = Array.isArray(u.byModel) ? u.byModel : [];
    var recent = Array.isArray(u.recent) ? u.recent : [];

    var policies = [
      { id: 'auto', name: 'Auto Inteligente', desc: 'Decompõe em Flash Lite e só aciona Curador quando necessário' },
      { id: 'gemini-3.1-flash-lite', name: 'Econômico (Lite)', desc: 'Prioriza Flash Lite ao máximo para mínimo consumo de tokens' },
      { id: 'gemini-4-hydrogen', name: 'Flash (Equilibrado)', desc: 'Subagentes Lite com curadoria rápida em Flash' },
      { id: 'gemini-4-argon', name: 'Pro (Máxima Qualidade)', desc: 'Curadoria sênior em Pro para tarefas críticas e arquitetura' }
    ];

    var html = '';
    // Architecture Pipeline Banner
    html += '<div class="spatial-card" style="padding:16px;">'
      + '<div style="font-size:12px;font-weight:700;color:var(--amber-soft);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.06em;">Arquitetura de Escalonamento & Curadoria Seletiva</div>'
      + '<div class="grid-4">'
      + '<div style="padding:10px;border-radius:12px;background:rgba(245,158,11,0.08);border:1px solid rgba(251,191,36,0.22);"><div style="font-size:11.5px;font-weight:700;color:#fff;">1. Triagem & Plano</div><div style="font-size:11px;color:var(--muted);margin-top:3px;">Quebra a demanda em subtarefas numeradas (#1, #2, #3)</div></div>'
      + '<div style="padding:10px;border-radius:12px;background:rgba(245,158,11,0.08);border:1px solid rgba(251,191,36,0.22);"><div style="font-size:11.5px;font-weight:700;color:#fff;">2. Trabalho Bruto</div><div style="font-size:11px;color:var(--muted);margin-top:3px;">Subagentes Flash Lite executam pesquisa, rascunho e ferramentas</div></div>'
      + '<div style="padding:10px;border-radius:12px;background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.24);"><div style="font-size:11.5px;font-weight:700;color:#a7f3d0;">3. Gate de Economia</div><div style="font-size:11px;color:var(--muted);margin-top:3px;">Dispensa curador em tarefas limpas e modestas (zero desperdício)</div></div>'
      + '<div style="padding:10px;border-radius:12px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.24);"><div style="font-size:11.5px;font-weight:700;color:var(--cyan-soft);">4. Curador & Fallback</div><div style="font-size:11px;color:var(--muted);margin-top:3px;">Escala Flash → Pro sob demanda e faz fallback automático</div></div>'
      + '</div></div>';

    // Policy selector
    html += '<div class="spatial-card" style="padding:16px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
      + '<div style="font-size:13px;font-weight:700;color:#fff;">Política de Modelos Local</div>'
      + '<button class="btn sm" onclick="refreshUsage().then(renderModuleContent)">' + ICONS.refresh + ' Atualizar</button>'
      + '</div><div class="grid-4">';
    for (var pi = 0; pi < policies.length; pi++) {
      var p = policies[pi];
      var isSel = state.modelPreference === p.id;
      html += '<button class="spatial-card" onclick="setModelPreference(\\'' + p.id + '\\')" style="padding:12px;text-align:left;cursor:pointer;'
        + (isSel ? 'border-color:rgba(251,191,36,0.65);background:rgba(245,158,11,0.14);' : '') + '">'
        + '<div style="font-size:12.5px;font-weight:700;color:' + (isSel ? 'var(--amber-soft)' : '#fff') + ';">' + esc(p.name) + '</div>'
        + '<div style="font-size:11px;color:var(--muted);margin-top:4px;line-height:1.4;">' + esc(p.desc) + '</div>'
        + '</button>';
    }
    html += '</div></div>';

    // 5 KPI Cards
    html += '<div class="grid-5">'
      + '<div class="spatial-card" style="padding:13px;"><div style="font-size:11px;color:var(--muted);">Tokens Totais</div><div class="mono" style="font-size:19px;font-weight:800;color:#fff;margin-top:4px;">' + fmtNum(tot.totalTokens || 0) + '</div></div>'
      + '<div class="spatial-card" style="padding:13px;"><div style="font-size:11px;color:var(--muted);">Tokens Pensamento</div><div class="mono" style="font-size:19px;font-weight:800;color:var(--amber-hi);margin-top:4px;">' + fmtNum(tot.thoughtsTokens || 0) + '</div></div>'
      + '<div class="spatial-card" style="padding:13px;"><div style="font-size:11px;color:var(--muted);">Curadorias Economizadas</div><div class="mono" style="font-size:19px;font-weight:800;color:var(--emerald);margin-top:4px;">' + fmtNum(tot.curationsSkipped || 0) + '</div></div>'
      + '<div class="spatial-card" style="padding:13px;"><div style="font-size:11px;color:var(--muted);">Escalonamentos</div><div class="mono" style="font-size:19px;font-weight:800;color:var(--cyan);margin-top:4px;">' + fmtNum(tot.escalationsCount || 0) + '</div></div>'
      + '<div class="spatial-card" style="padding:13px;"><div style="font-size:11px;color:var(--muted);">Latência Média</div><div class="mono" style="font-size:19px;font-weight:800;color:#e2e8f0;margin-top:4px;">' + fmtNum(tot.avgLatencyMs || 0) + 'ms</div></div>'
      + '</div>';

    // By Model breakdown
    html += '<div class="grid-2">';
    html += '<div class="spatial-card" style="padding:15px;"><div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:10px;">Consumo por Modelo</div>';
    if (!byModel.length) {
      html += '<div style="font-size:12px;color:var(--muted);">Nenhum consumo registrado ainda nesta sessão local.</div>';
    } else {
      var maxTok = Math.max.apply(null, byModel.map(function(x) { return x.totalTokens || 1; }));
      for (var mi = 0; mi < byModel.length; mi++) {
        var bm = byModel[mi];
        var pct = Math.max(6, Math.round(((bm.totalTokens || 0) / maxTok) * 100));
        html += '<div style="margin-bottom:10px;">'
          + '<div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px;">'
          + '<span class="mono" style="color:#fff;">' + esc(bm.model) + '</span>'
          + '<span class="mono" style="color:var(--muted);">' + fmtNum(bm.totalTokens) + ' tok (' + bm.requests + ' req)</span></div>'
          + '<div style="height:7px;border-radius:999px;background:rgba(255,255,255,0.06);overflow:hidden;">'
          + '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,var(--amber),var(--cyan));border-radius:999px;"></div></div></div>';
      }
    }
    html += '</div>';

    // Recent turns
    html += '<div class="spatial-card" style="padding:15px;"><div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:10px;">Turnos Recentes</div>';
    if (!recent.length) {
      html += '<div style="font-size:12px;color:var(--muted);">Sem histórico recente.</div>';
    } else {
      for (var ri = 0; ri < Math.min(8, recent.length); ri++) {
        var r = recent[ri];
        html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:11.5px;">'
          + '<span class="mono" style="color:var(--amber-soft);">' + esc(r.model || 'gemini') + '</span>'
          + '<span style="color:var(--muted);">' + (r.curationSkipped ? 'Curadoria dispensada' : (r.escalated ? 'Escalonado' : 'Normal')) + '</span>'
          + '<span class="mono" style="color:#fff;">' + fmtNum(r.totalTokens || 0) + ' tok · ' + (r.latencyMs || 0) + 'ms</span>'
          + '</div>';
      }
    }
    html += '</div></div>';

    body.innerHTML = html;
  }

  window.setModelPreference = async function(pref) {
    state.modelPreference = pref;
    var sel = document.getElementById('dock-model-sel');
    if (sel) sel.value = pref;
    try {
      if (!IS_ANDROID_BRIDGE) {
        await api('/settings', { method: 'POST', body: { modelPreference: pref } });
      }
      toast('Política de modelos atualizada: ' + pref);
      if (state.activeModule === 'orchestrator') renderModuleContent();
    } catch (e) { toast(e.message); }
  };

  function fmtMeshTransportTag(tr) {
    if (tr === 'lan_p2p') return '<span class="tag emerald">Wi-Fi/LAN P2P</span>';
    if (tr === 'cloud_ws') return '<span class="tag cyan">Nuvem WS</span>';
    if (tr === 'adb_wifi') return '<span class="tag amber">ADB Wi-Fi</span>';
    if (tr === 'adb_usb') return '<span class="tag amber">ADB USB</span>';
    return '<span class="tag">' + esc(tr) + '</span>';
  }

  function renderDevicesModule(body) {
    var m = state.meshStatus;
    if (!m && IS_ANDROID_BRIDGE && window.AegisAndroid && window.AegisAndroid.getMeshStatusJson) {
      try { m = JSON.parse(window.AegisAndroid.getMeshStatusJson() || '{}'); state.meshStatus = m; } catch (e) {}
    }
    var tr = (m && m.transports) || {};
    var lanIps = (m && Array.isArray(m.lanIps) && m.lanIps.length) ? m.lanIps.join(', ') : 'Aguardando Wi-Fi...';
    var peers = (m && Array.isArray(m.peers)) ? m.peers : [];
    var secSource = (m && m.meshSecretSource) || 'none';
    var autoPairLan = m && typeof m.autoPairLan === 'boolean' ? m.autoPairLan : true;
    var cloudOk = tr.cloudWs === 'online';

    var html = '<div class="spatial-card" style="padding:16px;display:flex;flex-direction:column;gap:12px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">'
      + '<div><div style="font-size:14.5px;font-weight:700;color:#fff;">' + (IS_ANDROID_BRIDGE ? 'Conexão Automática com seu Computador' : 'Malha Automática Multi-Conexão') + '</div>'
      + '<div style="font-size:11.5px;color:var(--muted);">' + (IS_ANDROID_BRIDGE ? 'Assim que o Aegis abre no celular e no PC no mesmo Wi-Fi, ambos se encontram e se conectam sozinhos.' : 'Descoberta e pareamento automáticos no Wi-Fi local (zero configuração) + Nuvem + ADB') + '</div></div>'
      + '<div style="display:flex;gap:7px;flex-wrap:wrap;">'
      + '<button class="btn sm ' + (autoPairLan ? 'emerald' : '') + '" onclick="toggleAutoPairLan()">' + (autoPairLan ? 'Wi-Fi Auto: ON' : 'Wi-Fi Auto: OFF') + '</button>'
      + '<button class="btn sm primary" onclick="scanMeshAll()" ' + (state.meshScanning ? 'disabled' : '') + '>' + ICONS.refresh + (state.meshScanning ? ' Buscando...' : (IS_ANDROID_BRIDGE ? ' Buscar PC' : ' Escanear Malha')) + '</button>'
      + '</div></div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">'
      + '<span class="tag ' + (tr.lanDiscovery ? 'emerald' : 'amber') + '">Wi-Fi Auto · ' + (tr.lanDiscovery ? 'Procurando' : 'Standby') + '</span>'
      + '<span class="tag ' + (tr.lanP2p ? 'emerald' : 'amber') + '">P2P Direto · ' + (autoPairLan ? 'Zero-Config' : 'Chave Manual') + '</span>'
      + '<span class="tag ' + (cloudOk ? 'cyan' : 'amber') + '">Nuvem WS · ' + esc(tr.cloudWs || 'standby') + '</span>'
      + (!IS_ANDROID_BRIDGE ? '<span class="tag amber">ADB · ' + esc(tr.adbCount || state.adbDevices.length) + '</span>' : '')
      + '<span class="tag mono">IP: ' + esc(lanIps) + '</span>'
      + '</div>';

    if (!peers.length) {
      html += '<div style="font-size:12px;color:var(--muted);padding:14px;border-radius:12px;background:rgba(56,189,248,0.06);border:1px dashed rgba(56,189,248,0.28);line-height:1.55;">'
        + '<strong style="color:#e0f2fe;">Aguardando ' + (IS_ANDROID_BRIDGE ? 'seu computador' : 'outros dispositivos Aegis') + ' na rede Wi-Fi...</strong><br/>'
        + 'Basta abrir o aplicativo Aegis no ' + (IS_ANDROID_BRIDGE ? 'PC (Linux ou Windows)' : 'celular Android ou outro PC') + ' conectado ao mesmo roteador Wi-Fi. A descoberta e a troca segura de chaves acontecem automaticamente em até 3 segundos.'
        + '</div>';
    } else {
      for (var pi = 0; pi < peers.length; pi++) {
        var p = peers[pi];
        var pTransports = Array.isArray(p.transports) ? p.transports : [];
        var trHtml = '';
        for (var ti = 0; ti < pTransports.length; ti++) trHtml += fmtMeshTransportTag(pTransports[ti]) + ' ';
        var defaultPath = p.platform === 'android' ? '/sdcard' : '.';
        var isReady = Boolean(p.autoPaired || autoPairLan || secSource !== 'none' || pTransports.indexOf('cloud_ws') >= 0);
        html += '<div class="spatial-card" style="padding:13px;border-color:rgba(52,211,153,0.32);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">'
          + '<div style="min-width:180px;">'
          + '<div style="font-size:13.5px;font-weight:700;color:#fff;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">'
          + '<span>' + esc(p.name || p.id) + '</span>'
          + '<span class="tag mono">' + esc(String(p.platform || 'device').toUpperCase()) + '</span>'
          + (isReady ? '<span class="tag emerald">Pronto ✓</span>' : '')
          + '</div>'
          + '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:5px;">' + trHtml
          + (p.lanIp ? '<span class="tag mono">' + esc(p.lanIp) + '</span>' : '')
          + '</div></div>'
          + '<div style="display:flex;gap:6px;flex-wrap:wrap;">'
          + '<button class="btn sm cyan" onclick="runMeshPeerCmd(\\'' + esc(p.id) + '\\', \\'ping\\', {})">Testar Conexão</button>'
          + '<button class="btn sm" onclick="runMeshPeerCmd(\\'' + esc(p.id) + '\\', \\'telemetry\\', {})">Telemetria</button>'
          + '<button class="btn sm" onclick="runMeshPeerCmd(\\'' + esc(p.id) + '\\', \\'list_files\\', { path: \\'' + esc(defaultPath) + '\\' })">Arquivos</button>'
          + '</div></div>';
      }
    }

    html += '<div style="padding:12px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);display:flex;flex-direction:column;gap:8px;">'
      + '<div style="font-size:12px;font-weight:700;color:#fff;">Área de Transferência Instantânea (PC ↔ Android)</div>'
      + '<div style="display:flex;gap:6px;">'
      + '<input id="mesh-clip-inp" class="inp" placeholder="Enviar texto ou link direto para o outro aparelho..." />'
      + '<button class="btn sm primary" onclick="sendMeshClipboard()">Enviar</button>'
      + '</div>';
    if (m && m.recentClipboard && m.recentClipboard.text) {
      html += '<div style="font-size:11px;color:var(--emerald);display:flex;align-items:center;justify-content:space-between;gap:8px;background:rgba(16,185,129,0.08);padding:7px 9px;border-radius:9px;">'
        + '<span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">De ' + esc(m.recentClipboard.fromName || 'Peer') + ': ' + esc(String(m.recentClipboard.text).slice(0, 70)) + '</span>'
        + '<button class="btn sm" onclick="copyMeshClipboard()">Copiar</button>'
        + '</div>';
    }
    html += '</div>';

    if (state.meshOutput) {
      html += '<pre class="mono" style="font-size:11.5px;background:rgba(0,0,0,0.45);padding:12px;border-radius:12px;max-height:220px;overflow:auto;color:var(--cyan);">' + esc(state.meshOutput) + '</pre>';
    }
    html += '</div>';

    if (IS_ANDROID_BRIDGE) {
      var stJson = {};
      try { stJson = JSON.parse(window.AegisAndroid.getStatusJson() || '{}'); } catch (e) {}
      html += '<div class="spatial-card" style="padding:16px;display:flex;flex-direction:column;gap:12px;margin-top:12px;">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">'
        + '<div><div style="font-size:14px;font-weight:700;color:#fff;">Acesso Remoto (Fora do Wi-Fi) & Google Workspace</div>'
        + '<div style="font-size:11.5px;color:var(--muted);">Opcional: conecte ao Google ou ao Aegis Cloud para controlar fora de casa</div></div>'
        + '<span class="tag ' + (stJson.serviceRunning ? 'emerald' : 'amber') + '">' + (stJson.serviceRunning ? 'Serviço 24/7 Ativo' : 'Somente Wi-Fi Local') + '</span>'
        + '</div>'
        + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
        + '<button class="gsi-material-button" onclick="connectGoogleOneClick()">' + ICONS.googleG + '<span>' + (stJson.googleConnected ? ('Google: ' + esc(stJson.googleEmail || 'Conectado')) : 'Conectar Google Workspace') + '</span></button>'
        + '<button class="btn cyan" onclick="openRemoteHudExternal(document.getElementById(\\'and-origin\\') ? document.getElementById(\\'and-origin\\').value : \\'\\')">Abrir HUD Web (Chrome)</button>'
        + '</div>'
        + '<details style="border-top:1px solid rgba(255,255,255,0.08);padding-top:10px;">'
        + '<summary style="cursor:pointer;font-size:12px;color:var(--amber-soft);font-weight:600;">Opções avançadas (URL Cloud, Código Manual e Chave LAN)</summary>'
        + '<div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">'
        + '<div class="grid-2">'
        + '<div><label style="font-size:11px;color:var(--muted);">URL do Aegis Cloud</label><input id="and-origin" class="inp" value="' + esc(stJson.serverOrigin || state.cloudOrigin) + '" /></div>'
        + '<div><label style="font-size:11px;color:var(--muted);">Código de Pareamento (opcional)</label><input id="and-code" class="inp" placeholder="AEGIS-XXXX" value="' + esc(stJson.pairingCode || '') + '" /></div>'
        + '</div>'
        + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
        + '<button class="btn sm primary" onclick="androidStartBridge()">Conectar Nuvem 24/7</button>'
        + '<button class="btn sm danger" onclick="window.AegisAndroid.stopService(); renderModuleContent();">Parar Serviço</button>'
        + '</div>'
        + '<div style="display:flex;gap:6px;align-items:center;">'
        + '<input id="mesh-key-inp" type="password" class="inp" placeholder="Chave manual opcional (substitui auto-pareamento)..." />'
        + '<button class="btn sm emerald" onclick="saveMeshKeyConfig()">Salvar Chave</button>'
        + '</div></div></details>'
        + '</div>'
        + '<div class="spatial-card" style="padding:16px;margin-top:12px;"><div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:10px;">Permissões Nativas do Android</div>'
        + '<div class="grid-2">'
        + '<button class="btn" onclick="window.AegisAndroid.openAccessibilitySettings()">Acessibilidade (Automação de Tela)</button>'
        + '<button class="btn" onclick="window.AegisAndroid.openNotificationSettings()">Leitura de Notificações</button>'
        + '<button class="btn" onclick="window.AegisAndroid.openFilesPermission()">Acesso a Arquivos (/sdcard)</button>'
        + '<button class="btn" onclick="window.AegisAndroid.openBatterySettings()">Ignorar Otimização de Bateria</button>'
        + '</div></div>';
      body.innerHTML = html;
      return;
    }

    html += '<div class="spatial-card" style="padding:14px;margin-top:12px;display:flex;flex-direction:column;gap:8px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">'
      + '<div style="font-size:12.5px;font-weight:700;color:#fff;">Chave de Malha LAN Manual (Opcional)</div>'
      + '<span class="tag ' + (secSource !== 'none' ? 'emerald' : 'amber') + '">'
      + (secSource === 'custom_key' ? 'Chave Manual' : (secSource === 'google_account' ? 'Auto via Google' : (autoPairLan ? 'Auto-Pareamento Wi-Fi Ativo' : 'Somente Descoberta')))
      + '</span></div>'
      + '<div style="display:flex;gap:6px;">'
      + '<input id="mesh-key-inp" type="password" class="inp" placeholder="Opcional: defina uma senha fixa se quiser desativar o Wi-Fi Auto..." />'
      + '<button class="btn sm emerald" onclick="saveMeshKeyConfig()">Salvar</button>'
      + '</div></div>';

    html += '<div class="spatial-card" style="padding:16px;display:flex;flex-direction:column;gap:12px;margin-top:12px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;">'
      + '<div><div style="font-size:14px;font-weight:700;color:#fff;">Ponte ADB para Android (USB + Wireless mDNS)</div>'
      + '<div style="font-size:11.5px;color:var(--muted);">Complemento de baixo nível para celulares Android via cabo USB ou Depuração Sem Fio</div></div>'
      + '<button class="btn sm" onclick="loadAdbDevices()">' + ICONS.refresh + ' Escanear ADB</button>'
      + '</div>';

    if (!state.adbDevices.length) {
      html += '<div style="font-size:12px;color:var(--muted);padding:10px;border-radius:12px;background:rgba(255,255,255,0.03);">Nenhum dispositivo Android ADB detectado. Você pode usar a Malha Wi-Fi/LAN ou Nuvem acima sem cabo!</div>';
    } else {
      for (var i = 0; i < state.adbDevices.length; i++) {
        var d = state.adbDevices[i];
        html += '<div class="spatial-card" style="padding:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">'
          + '<div><div class="mono" style="font-size:13px;font-weight:700;color:#fff;">' + esc(d.serial) + '</div>'
          + '<div style="font-size:11px;color:var(--emerald);">' + esc(d.model || d.state || 'device') + '</div></div>'
          + '<div style="display:flex;gap:6px;flex-wrap:wrap;">'
          + '<button class="btn sm" onclick="runAdbCmd(\\'' + esc(d.serial) + '\\', \\'shell\\', { command: \\'dumpsys battery | head -n 12\\' })">Bateria</button>'
          + '<button class="btn sm" onclick="runAdbCmd(\\'' + esc(d.serial) + '\\', \\'shell\\', { command: \\'ls -la /sdcard\\' })">/sdcard</button>'
          + '<button class="btn sm" onclick="runAdbCmd(\\'' + esc(d.serial) + '\\', \\'keyevent\\', { keycode: 3 })">HOME</button>'
          + '</div></div>';
      }
    }
    if (state.adbOutput) {
      html += '<pre class="mono" style="font-size:11.5px;background:rgba(0,0,0,0.45);padding:12px;border-radius:12px;max-height:220px;overflow:auto;color:var(--amber-soft);">' + esc(state.adbOutput) + '</pre>';
    }
    html += '</div>';
    body.innerHTML = html;
  }

  window.loadMeshStatus = async function() {
    try {
      if (IS_ANDROID_BRIDGE && window.AegisAndroid && window.AegisAndroid.getMeshStatusJson) {
        state.meshStatus = JSON.parse(window.AegisAndroid.getMeshStatusJson() || '{}');
      } else if (!IS_ANDROID_BRIDGE) {
        state.meshStatus = await api('/mesh/status');
      }
      if (state.activeModule === 'devices') renderModuleContent();
    } catch (e) {}
  };

  window.scanMeshAll = async function() {
    state.meshScanning = true;
    if (state.activeModule === 'devices') renderModuleContent();
    try {
      if (IS_ANDROID_BRIDGE && window.AegisAndroid && window.AegisAndroid.scanLanMesh) {
        state.meshStatus = JSON.parse(window.AegisAndroid.scanLanMesh() || '{}');
      } else if (!IS_ANDROID_BRIDGE) {
        state.meshStatus = await api('/mesh/scan', { method: 'POST', body: {} });
        await loadAdbDevices();
      }
      toast('Malha escaneada: ' + ((state.meshStatus && state.meshStatus.peers) ? state.meshStatus.peers.length : 0) + ' dispositivo(s) encontrado(s).');
    } catch (e) {
      toast('Erro ao escanear malha: ' + e.message);
    } finally {
      state.meshScanning = false;
      if (state.activeModule === 'devices') renderModuleContent();
    }
  };

  window.toggleAutoPairLan = async function() {
    var cur = state.meshStatus && typeof state.meshStatus.autoPairLan === 'boolean' ? state.meshStatus.autoPairLan : true;
    var next = !cur;
    try {
      if (IS_ANDROID_BRIDGE && window.AegisAndroid && window.AegisAndroid.setAutoPairLan) {
        state.meshStatus = JSON.parse(window.AegisAndroid.setAutoPairLan(next) || '{}');
      } else if (!IS_ANDROID_BRIDGE) {
        state.meshStatus = await api('/mesh/config', { method: 'POST', body: { autoPairLan: next } });
      }
      toast(next ? 'Conexão Automática no Wi-Fi ativada!' : 'Conexão Automática no Wi-Fi pausada.');
      if (state.activeModule === 'devices') renderModuleContent();
    } catch (e) { toast(e.message); }
  };

  window.saveMeshKeyConfig = async function() {
    var inp = document.getElementById('mesh-key-inp');
    var key = inp ? inp.value.trim() : '';
    try {
      if (IS_ANDROID_BRIDGE && window.AegisAndroid && window.AegisAndroid.setMeshKey) {
        state.meshStatus = JSON.parse(window.AegisAndroid.setMeshKey(key) || '{}');
      } else {
        state.meshStatus = await api('/mesh/config', { method: 'POST', body: { meshKey: key } });
      }
      if (inp) inp.value = '';
      toast(key ? 'Chave de Malha LAN salva (HMAC-SHA256 ativo).' : 'Chave personalizada limpa.');
      if (state.activeModule === 'devices') renderModuleContent();
    } catch (e) { toast(e.message); }
  };

  window.runMeshPeerCmd = async function(peerId, commandType, payload) {
    try {
      toast('Roteando comando (' + commandType + ') pela melhor conexão...');
      var res;
      if (IS_ANDROID_BRIDGE && window.AegisAndroid && window.AegisAndroid.execPeerCommandJson) {
        res = JSON.parse(window.AegisAndroid.execPeerCommandJson(peerId, commandType, JSON.stringify(payload || {})) || '{}');
      } else {
        res = await api('/mesh/exec', { method: 'POST', body: { peerId: peerId, commandType: commandType, payload: payload || {} } });
      }
      state.meshOutput = JSON.stringify(res, null, 2);
      if (res && res.ok) {
        toast('Executado via ' + (res.transportUsed || 'auto') + '!');
      } else {
        toast((res && res.error) || 'Falha no comando remoto.');
      }
      if (state.activeModule === 'devices') renderModuleContent();
    } catch (e) {
      state.meshOutput = 'Erro: ' + e.message;
      toast(e.message);
      if (state.activeModule === 'devices') renderModuleContent();
    }
  };

  window.sendMeshClipboard = async function() {
    var inp = document.getElementById('mesh-clip-inp');
    var txt = inp ? inp.value.trim() : '';
    if (!txt) return;
    try {
      var res;
      if (IS_ANDROID_BRIDGE && window.AegisAndroid && window.AegisAndroid.syncClipboardToMesh) {
        res = JSON.parse(window.AegisAndroid.syncClipboardToMesh(txt) || '{}');
        state.meshStatus = JSON.parse(window.AegisAndroid.getMeshStatusJson() || '{}');
      } else {
        res = await api('/mesh/clipboard', { method: 'POST', body: { text: txt } });
        state.meshStatus = res;
      }
      if (inp) inp.value = '';
      toast('Área de transferência sincronizada (' + (res.delivered || 0) + ' canal/is).');
      if (state.activeModule === 'devices') renderModuleContent();
    } catch (e) { toast(e.message); }
  };

  window.copyMeshClipboard = function() {
    var txt = state.meshStatus && state.meshStatus.recentClipboard && state.meshStatus.recentClipboard.text;
    if (!txt) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function() { toast('Copiado para área de transferência!'); }).catch(function() {});
    }
  };

  window.androidStartBridge = function() {
    if (!IS_ANDROID_BRIDGE) return;
    var origin = document.getElementById('and-origin').value.trim();
    var code = document.getElementById('and-code').value.trim();
    try {
      var res = JSON.parse(window.AegisAndroid.connectAndStart(origin, code) || '{}');
      toast(res.message || (res.ok ? 'Conectado!' : 'Erro ao conectar'));
      loadMeshStatus();
      renderModuleContent();
    } catch (e) { toast('Falha: ' + e.message); }
  };

  window.loadAdbDevices = async function() {
    try {
      var data = await api('/android/devices');
      state.adbDevices = data.devices || [];
      if (state.activeModule === 'devices') renderModuleContent();
    } catch (e) { toast(e.message); }
  };

  window.runAdbCmd = async function(serial, commandType, payload) {
    try {
      var res = await api('/android/exec', { method: 'POST', body: { serial: serial, commandType: commandType, payload: payload } });
      state.adbOutput = JSON.stringify(res, null, 2);
      renderModuleContent();
    } catch (e) { toast(e.message); }
  };

  function renderTerminalModule(body) {
    var html = '<div class="grid-2">';
    // Shell Runner
    html += '<div class="spatial-card" style="padding:15px;display:flex;flex-direction:column;gap:10px;">'
      + '<div style="font-size:13px;font-weight:700;color:#fff;">Terminal Nativo Seguro</div>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;">'
      + '<button class="btn sm" onclick="execShellCmd(\\'uname -a && uptime\\')">Sistema</button>'
      + '<button class="btn sm" onclick="execShellCmd(\\'df -h\\')">Disco</button>'
      + '<button class="btn sm" onclick="execShellCmd(\\'free -h\\')">Memória</button>'
      + '<button class="btn sm" onclick="execShellCmd(\\'ps aux --sort=-%cpu | head -n 10\\')">Top CPU</button>'
      + '</div>'
      + '<form onsubmit="event.preventDefault(); execShellCmd(document.getElementById(\\'term-inp\\').value);" style="display:flex;gap:7px;">'
      + '<input id="term-inp" class="inp mono" placeholder="Digite um comando shell..." />'
      + '<button class="btn primary" type="submit">Executar</button>'
      + '</form>'
      + '<pre class="mono" style="flex:1;min-height:220px;max-height:360px;overflow:auto;background:rgba(0,0,0,0.52);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;font-size:11.5px;color:#e2e8f0;white-space:pre-wrap;">'
      + esc(state.terminalOut || 'Pronto. Comandos destrutivos pedem confirmação explícita.')
      + '</pre></div>';

    // Local File Browser & Viewer/Editor
    html += '<div class="spatial-card" style="padding:15px;display:flex;flex-direction:column;gap:10px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">'
      + '<div style="font-size:13px;font-weight:700;color:#fff;">Arquivos Locais</div>'
      + '<div style="display:flex;gap:6px;">'
      + '<button class="btn sm" onclick="loadLocalFiles(\\'\\')">Home</button>'
      + '<button class="btn sm" onclick="goParentDir()">Subir</button>'
      + '</div></div>'
      + '<div class="mono" style="font-size:11px;color:var(--amber-soft);overflow:hidden;text-overflow:ellipsis;">' + esc(state.currentDir || '~') + '</div>';

    if (state.openFile) {
      var f = state.openFile;
      html += '<div style="display:flex;align-items:center;justify-content:space-between;">'
        + '<span style="font-size:12px;font-weight:700;color:var(--cyan-soft);">' + esc(f.name) + '</span>'
        + '<button class="btn sm" onclick="state.openFile=null; renderModuleContent();">Voltar à lista</button></div>';
      var mediaUrl = '/file/media?path=' + encodeURIComponent(f.path) + '&token=' + encodeURIComponent(state.token);
      if (f.kind === 'image') {
        html += '<img src="' + mediaUrl + '" style="max-width:100%;max-height:300px;border-radius:12px;object-fit:contain;background:#000;" />';
      } else if (f.kind === 'video') {
        html += '<video src="' + mediaUrl + '" controls style="width:100%;max-height:300px;border-radius:12px;background:#000;"></video>';
      } else if (f.kind === 'audio') {
        html += '<audio src="' + mediaUrl + '" controls style="width:100%;"></audio>';
      } else if (f.kind === 'pdf') {
        html += '<iframe src="' + mediaUrl + '" style="width:100%;height:300px;border:none;border-radius:12px;background:#fff;"></iframe>';
      } else if (f.editable) {
        html += '<textarea id="local-file-editor" class="txt mono" style="height:240px;font-size:12px;">' + esc(f.content || '') + '</textarea>'
          + '<button class="btn primary sm" onclick="saveLocalFile()">Salvar Alterações</button>';
      } else {
        html += '<div style="font-size:12px;color:var(--muted);">Arquivo binário (' + fmtBytes(f.sizeBytes) + ')</div>';
      }
    } else {
      html += '<div style="max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:5px;">';
      for (var fi = 0; fi < state.filesList.length; fi++) {
        var entry = state.filesList[fi];
        var isDir = entry.type === 'directory';
        html += '<button class="btn sm" style="justify-content:space-between;text-align:left;width:100%;" onclick="'
          + (isDir ? 'loadLocalFiles(\\'' + esc(entry.fullPath).replace(/\\\\/g, '\\\\\\\\') + '\\')' : 'openLocalFile(\\'' + esc(entry.fullPath).replace(/\\\\/g, '\\\\\\\\') + '\\')') + '">'
          + '<span style="display:flex;align-items:center;gap:7px;overflow:hidden;">' + (isDir ? ICONS.folder : ICONS.file) + '<span style="overflow:hidden;text-overflow:ellipsis;">' + esc(entry.name) + '</span></span>'
          + '<span class="mono" style="font-size:10px;color:var(--muted);">' + (isDir ? 'DIR' : fmtBytes(entry.sizeBytes)) + '</span>'
          + '</button>';
      }
      html += '</div>';
    }
    html += '</div></div>';
    body.innerHTML = html;
  }

  window.execShellCmd = async function(cmd, confirmed) {
    if (!cmd || !cmd.trim()) return;
    try {
      var res = await api('/exec', { method: 'POST', body: { command: cmd, confirmed: Boolean(confirmed) } });
      if (res.requiresConfirmation) {
        openConfirmModal({ pendingCommand: cmd });
        return;
      }
      state.terminalOut = '$ ' + cmd + '\\n' + (res.stdout || '') + (res.stderr ? '\\n[stderr]\\n' + res.stderr : '');
      renderModuleContent();
    } catch (e) { toast(e.message); }
  };

  window.loadLocalFiles = async function(dirPath) {
    try {
      var data = await api('/files?path=' + encodeURIComponent(dirPath || ''));
      state.currentDir = data.dir || '';
      state.parentDir = data.parentDir || '';
      state.filesList = data.entries || [];
      state.openFile = null;
      if (state.activeModule === 'terminal') renderModuleContent();
    } catch (e) { toast(e.message); }
  };

  window.goParentDir = function() {
    loadLocalFiles(state.parentDir || '');
  };

  window.openLocalFile = async function(fp) {
    try {
      state.openFile = await api('/file?path=' + encodeURIComponent(fp));
      renderModuleContent();
    } catch (e) { toast(e.message); }
  };

  window.saveLocalFile = async function() {
    if (!state.openFile) return;
    try {
      var content = document.getElementById('local-file-editor').value;
      await api('/file/save', { method: 'POST', body: { path: state.openFile.path, content: content } });
      state.openFile.content = content;
      toast('Arquivo salvo com sucesso!');
    } catch (e) { toast(e.message); }
  };

  function renderWebModule(body) {
    var html = '<div class="grid-2">';
    html += '<div class="spatial-card" style="padding:15px;display:flex;flex-direction:column;gap:10px;">'
      + '<div style="font-size:13px;font-weight:700;color:#fff;">Navegador Autônomo Headless</div>'
      + '<form onsubmit="event.preventDefault(); navigateWebUrl(document.getElementById(\\'web-url-inp\\').value);" style="display:flex;gap:7px;">'
      + '<input id="web-url-inp" class="inp" placeholder="https://..." />'
      + '<button class="btn primary" type="submit">Navegar</button>'
      + '</form>';
    if (state.webResult) {
      html += '<div style="font-size:12.5px;font-weight:700;color:var(--amber-soft);">' + esc(state.webResult.title || state.webResult.url) + '</div>'
        + '<pre style="max-height:280px;overflow:auto;background:rgba(0,0,0,0.45);padding:11px;border-radius:12px;font-size:11.5px;color:#e2e8f0;white-space:pre-wrap;">' + esc(state.webResult.text || state.webResult.excerpt || '') + '</pre>';
    }
    html += '</div>';

    // Credential Vault
    html += '<div class="spatial-card" style="padding:15px;display:flex;flex-direction:column;gap:10px;">'
      + '<div style="font-size:13px;font-weight:700;color:#fff;">Cofre de Credenciais (AES-256-GCM)</div>'
      + '<form onsubmit="saveCredential(event)" style="display:grid;grid-template-columns:1fr 1fr;gap:7px;">'
      + '<input id="cred-site" class="inp" placeholder="Site (ex: GitHub)" required />'
      + '<input id="cred-url" class="inp" placeholder="URL de login" required />'
      + '<input id="cred-user" class="inp" placeholder="Usuário/E-mail" required />'
      + '<input id="cred-pass" class="inp" type="password" placeholder="Senha" required />'
      + '<button class="btn primary sm" style="grid-column:span 2;" type="submit">Salvar no Cofre Criptografado</button>'
      + '</form>';
    for (var i = 0; i < state.credentials.length; i++) {
      var c = state.credentials[i];
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);">'
        + '<div><div style="font-size:12px;font-weight:600;color:#fff;">' + esc(c.siteName) + '</div>'
        + '<div style="font-size:11px;color:var(--muted);">' + esc(c.username) + ' · ' + esc(c.loginUrl) + '</div></div>'
        + '<button class="btn sm danger" onclick="deleteCredential(\\'' + esc(c.id) + '\\')">' + ICONS.trash + '</button>'
        + '</div>';
    }
    html += '</div></div>';
    body.innerHTML = html;
  }

  window.navigateWebUrl = async function(url) {
    if (!url) return;
    try {
      state.webResult = await api('/web/navigate', { method: 'POST', body: { url: url } });
      renderModuleContent();
    } catch (e) { toast(e.message); }
  };

  window.loadCredentials = async function() {
    try {
      var data = await api('/web/credentials');
      state.credentials = data.credentials || [];
      if (state.activeModule === 'web') renderModuleContent();
    } catch (e) {}
  };

  window.saveCredential = async function(e) {
    e.preventDefault();
    try {
      await api('/web/credentials', {
        method: 'POST',
        body: {
          siteName: document.getElementById('cred-site').value,
          loginUrl: document.getElementById('cred-url').value,
          username: document.getElementById('cred-user').value,
          password: document.getElementById('cred-pass').value
        }
      });
      await loadCredentials();
      toast('Credencial criptografada salva!');
    } catch (err) { toast(err.message); }
  };

  window.deleteCredential = async function(id) {
    try {
      await api('/web/credentials?id=' + encodeURIComponent(id), { method: 'DELETE' });
      await loadCredentials();
    } catch (err) { toast(err.message); }
  };

  function renderMemoryModule(body) {
    var facts = state.memoryData.facts || [];
    var recent = state.memoryData.recent || [];
    var html = '<div class="grid-2">';
    html += '<div class="spatial-card" style="padding:15px;display:flex;flex-direction:column;gap:10px;">'
      + '<div style="font-size:13px;font-weight:700;color:#fff;">Fatos Persistentes do Operador</div>'
      + '<form onsubmit="addMemoryFact(event)" style="display:flex;gap:7px;">'
      + '<input id="fact-inp" class="inp" placeholder="Ex: Prefiro respostas objetivas em português..." />'
      + '<button class="btn primary sm" type="submit">Salvar</button></form>';
    if (!facts.length) {
      html += '<div style="font-size:12px;color:var(--muted);">Nenhum fato salvo ainda.</div>';
    } else {
      for (var i = 0; i < facts.length; i++) {
        var f = facts[i];
        html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);">'
          + '<span style="font-size:12px;color:#e2e8f0;">' + esc(f.fact) + '</span>'
          + '<button class="btn sm danger" onclick="deleteMemoryFact(' + f.id + ')">' + ICONS.trash + '</button></div>';
      }
    }
    html += '</div>';

    html += '<div class="spatial-card" style="padding:15px;display:flex;flex-direction:column;gap:8px;">'
      + '<div style="font-size:13px;font-weight:700;color:#fff;">Memória Episódica Recente</div>';
    for (var ri = recent.length - 1; ri >= Math.max(0, recent.length - 12); ri--) {
      var r = recent[ri];
      html += '<div style="padding:8px;border-radius:10px;background:rgba(0,0,0,0.34);font-size:11.5px;color:var(--text-2);">'
        + '<span class="tag" style="margin-right:6px;">' + esc(r.role || 'event') + '</span>'
        + esc(String(r.content || r.command || r.action || '').slice(0, 180)) + '</div>';
    }
    html += '</div></div>';
    body.innerHTML = html;
  }

  window.loadMemory = async function() {
    try {
      state.memoryData = await api('/memory');
      if (state.activeModule === 'memory') renderModuleContent();
    } catch (e) {}
  };

  window.addMemoryFact = async function(e) {
    e.preventDefault();
    var inp = document.getElementById('fact-inp');
    if (!inp.value.trim()) return;
    try {
      var data = await api('/memory/facts', { method: 'POST', body: { fact: inp.value.trim() } });
      state.memoryData.facts = data.facts || [];
      inp.value = '';
      renderModuleContent();
    } catch (err) { toast(err.message); }
  };

  window.deleteMemoryFact = async function(id) {
    try {
      var data = await api('/memory/facts?id=' + id, { method: 'DELETE' });
      state.memoryData.facts = data.facts || [];
      renderModuleContent();
    } catch (err) { toast(err.message); }
  };

  // ===== Settings & Full Google Workspace Module =====
  function renderSettingsModule(body) {
    var html = '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">'
      + '<div class="tab-bar">'
      + '<button class="tab-btn ' + (state.settingsTab === 'google' ? 'active' : '') + '" onclick="state.settingsTab=\\'google\\'; renderModuleContent();">' + ICONS.googleG + ' Google Workspace</button>'
      + '<button class="tab-btn ' + (state.settingsTab === 'system' ? 'active' : '') + '" onclick="state.settingsTab=\\'system\\'; renderModuleContent();">' + (IS_ANDROID_BRIDGE ? (ICONS.fingerprint + ' Segurança & Biometria') : (ICONS.key + ' API Key & Ponte Nuvem')) + '</button>'
      + '</div></div>';

    if (state.settingsTab === 'google') {
      var g = state.googleSync || {};
      var connected = Boolean(g.connected);
      var snap = g.snapshot || { drive: [], gmail: [], calendar: [], tasks: [] };

      html += '<div class="spatial-card" style="padding:16px;display:flex;flex-direction:column;gap:12px;">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">'
        + '<div style="display:flex;align-items:center;gap:11px;">' + ICONS.googleG
        + '<div><div style="font-size:14px;font-weight:700;color:#fff;">' + (IS_ANDROID_BRIDGE ? 'Conexão Google no Android' : 'Conexão Google no App Local') + '</div>'
        + '<div style="font-size:11.5px;color:var(--muted);">' + (connected ? ('Conectado como ' + esc(g.email || 'Google') + (g.lastSyncAt ? ' · Última sinc.: ' + new Date(g.lastSyncAt).toLocaleTimeString('pt-BR') : '')) : (IS_ANDROID_BRIDGE ? 'Autorize sua conta Google pelo Chrome seguro para sincronizar automaticamente com o PC e a Nuvem.' : 'Conecte sua conta Google para Drive, Gmail, Agenda e Tarefas diretamente pelo aplicativo local.')) + '</div></div></div>'
        + '<div style="display:flex;gap:8px;flex-wrap:wrap;">';

      if (connected) {
        html += (IS_ANDROID_BRIDGE
          ? '<button class="btn cyan sm" onclick="openRemoteHudExternal()">Abrir HUD Web (Chrome)</button>'
          : '<button class="btn emerald sm" onclick="syncGoogleNow()">' + ICONS.refresh + ' Sincronizar Agora</button>')
          + '<button class="btn danger sm" onclick="disconnectGoogle()">Desconectar</button>';
      } else {
        html += '<button class="gsi-material-button" onclick="connectGoogleOneClick()">' + ICONS.googleG + '<span>Conectar com Google (1 Clique)</span></button>';
        if (IS_ANDROID_BRIDGE) {
          html += '<button class="btn cyan sm" onclick="openRemoteHudExternal()">Abrir HUD Web (Chrome)</button>';
        }
      }
      html += '</div></div>';

      if (!connected && !IS_ANDROID_BRIDGE) {
        html += '<div class="grid-2">'
          + '<div style="padding:12px;border-radius:14px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);display:flex;flex-direction:column;gap:8px;">'
          + '<div style="font-size:12px;font-weight:700;color:var(--amber-soft);">Opção Direta — Google OAuth Client ID</div>'
          + '<input id="g-client-id" class="inp" placeholder="xxxxx.apps.googleusercontent.com" value="' + esc(state.googleClientId) + '" />'
          + '<div style="display:flex;gap:7px;">'
          + '<button class="btn sm" onclick="saveGoogleClientId()">Salvar Client ID</button>'
          + '<button class="btn sm cyan" onclick="connectGoogleDirectClientId()">Autorizar via Google</button>'
          + '</div></div>'
          + '<div style="padding:12px;border-radius:14px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);display:flex;flex-direction:column;gap:8px;">'
          + '<div style="font-size:12px;font-weight:700;color:var(--cyan-soft);">Opção Avançada — Token OAuth Manual</div>'
          + '<input id="g-manual-token" class="inp mono" type="password" placeholder="ya29.a0..." />'
          + '<button class="btn sm emerald" onclick="connectManualGoogleToken()">Conectar & Sincronizar</button>'
          + '</div></div>';
      }
      html += '</div>';

      if (connected && !IS_ANDROID_BRIDGE) {
        html += '<div class="tab-bar">'
          + '<button class="tab-btn ' + (state.workspaceSubTab === 'drive' ? 'active' : '') + '" onclick="state.workspaceSubTab=\\'drive\\'; if(!state.driveItems.length) loadDriveFolder(\\'root\\'); renderModuleContent();">Drive (' + (g.counts ? g.counts.drive : 0) + ')</button>'
          + '<button class="tab-btn ' + (state.workspaceSubTab === 'gmail' ? 'active' : '') + '" onclick="state.workspaceSubTab=\\'gmail\\'; renderModuleContent();">Gmail (' + (g.counts ? g.counts.gmail : 0) + ')</button>'
          + '<button class="tab-btn ' + (state.workspaceSubTab === 'calendar' ? 'active' : '') + '" onclick="state.workspaceSubTab=\\'calendar\\'; renderModuleContent();">Agenda (' + (g.counts ? g.counts.calendar : 0) + ')</button>'
          + '<button class="tab-btn ' + (state.workspaceSubTab === 'tasks' ? 'active' : '') + '" onclick="state.workspaceSubTab=\\'tasks\\'; renderModuleContent();">Tarefas (' + (g.counts ? g.counts.tasks : 0) + ')</button>'
          + '</div>';

        html += '<div class="spatial-card" style="padding:15px;">';
        if (state.workspaceSubTab === 'drive') {
          html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap;">'
            + '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">';
          for (var bi = 0; bi < state.driveBreadcrumbs.length; bi++) {
            var bc = state.driveBreadcrumbs[bi];
            html += '<button class="btn sm" onclick="loadDriveFolder(\\'' + esc(bc.id) + '\\', ' + bi + ')">' + esc(bc.name) + '</button>';
          }
          html += '</div><button class="btn sm" onclick="loadDriveFolder(state.driveFolderId)">' + ICONS.refresh + '</button></div>';

          if (state.driveOpenFile) {
            var df = state.driveOpenFile;
            html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">'
              + '<span style="font-size:13px;font-weight:700;color:var(--cyan-soft);">' + esc(df.name) + '</span>'
              + '<div style="display:flex;gap:6px;">'
              + '<button class="btn sm emerald" onclick="downloadDriveToLocal(\\'' + esc(df.id) + '\\', \\'' + esc(df.name) + '\\')">Baixar p/ Máquina</button>'
              + '<button class="btn sm" onclick="state.driveOpenFile=null; renderModuleContent();">Voltar</button></div></div>';
            if (df.editable) {
              html += '<textarea id="drive-editor" class="txt mono" style="height:240px;font-size:12px;">' + esc(df.content || '') + '</textarea>'
                + '<button class="btn primary sm" style="margin-top:8px;" onclick="saveDriveFile()">Salvar no Google Drive</button>';
            } else {
              var dMedia = '/google/drive/media?id=' + encodeURIComponent(df.id) + '&token=' + encodeURIComponent(state.token);
              html += '<iframe src="' + dMedia + '" style="width:100%;height:300px;border:none;border-radius:12px;background:#fff;"></iframe>';
            }
          } else {
            var list = state.driveItems.length ? state.driveItems : (snap.drive || []);
            if (!list.length) {
              html += '<div style="font-size:12px;color:var(--muted);">Pasta vazia ou clique em atualizar.</div>';
            } else {
              html += '<div style="display:flex;flex-direction:column;gap:6px;max-height:320px;overflow-y:auto;">';
              for (var di = 0; di < list.length; di++) {
                var item = list[di];
                var isF = item.mimeType === 'application/vnd.google-apps.folder';
                html += '<button class="btn sm" style="justify-content:space-between;width:100%;text-align:left;" onclick="'
                  + (isF ? 'openDriveFolder(\\'' + esc(item.id) + '\\', \\'' + esc(item.name) + '\\')' : 'openDriveFile(\\'' + esc(item.id) + '\\')') + '">'
                  + '<span style="display:flex;align-items:center;gap:8px;overflow:hidden;">' + (isF ? ICONS.folder : ICONS.file) + '<span style="overflow:hidden;text-overflow:ellipsis;">' + esc(item.name) + '</span></span>'
                  + '<span style="font-size:10.5px;color:var(--muted);">' + (isF ? 'Pasta' : esc(String(item.mimeType || '').split('.').pop())) + '</span>'
                  + '</button>';
              }
              html += '</div>';
            }
          }
        } else if (state.workspaceSubTab === 'gmail') {
          var mails = snap.gmail || [];
          if (!mails.length) html += '<div style="font-size:12px;color:var(--muted);">Nenhum e-mail sincronizado. Clique em Sincronizar Agora.</div>';
          for (var gi = 0; gi < mails.length; gi++) {
            var em = mails[gi];
            html += '<div style="padding:10px;border-bottom:1px solid rgba(255,255,255,0.07);">'
              + '<div style="font-size:12.5px;font-weight:700;color:#fff;">' + esc(em.subject || '(Sem assunto)') + '</div>'
              + '<div style="font-size:11px;color:var(--amber-soft);">' + esc(em.from || '') + '</div>'
              + '<div style="font-size:11.5px;color:var(--muted);margin-top:3px;">' + esc(em.snippet || '') + '</div></div>';
          }
        } else if (state.workspaceSubTab === 'calendar') {
          var evs = snap.calendar || [];
          if (!evs.length) html += '<div style="font-size:12px;color:var(--muted);">Nenhum evento próximo.</div>';
          for (var ci = 0; ci < evs.length; ci++) {
            var ce = evs[ci];
            html += '<div style="padding:10px;border-bottom:1px solid rgba(255,255,255,0.07);display:flex;justify-content:space-between;gap:10px;">'
              + '<span style="font-size:12.5px;font-weight:600;color:#fff;">' + esc(ce.summary || 'Evento') + '</span>'
              + '<span class="mono" style="font-size:11px;color:var(--cyan-soft);">' + esc(ce.start || '') + '</span></div>';
          }
        } else if (state.workspaceSubTab === 'tasks') {
          var tks = snap.tasks || [];
          if (!tks.length) html += '<div style="font-size:12px;color:var(--muted);">Nenhuma tarefa encontrada.</div>';
          for (var ti = 0; ti < tks.length; ti++) {
            var tk = tks[ti];
            html += '<div style="padding:9px;border-bottom:1px solid rgba(255,255,255,0.07);display:flex;justify-content:space-between;">'
              + '<span style="font-size:12.5px;color:#fff;">' + esc(tk.title || '') + '</span>'
              + '<span class="tag ' + (tk.status === 'completed' ? 'emerald' : 'amber') + '">' + esc(tk.status || 'needsAction') + '</span></div>';
          }
        }
        html += '</div>';
      }
    } else {
      if (IS_ANDROID_BRIDGE) {
        html += '<div class="spatial-card" style="padding:16px;display:flex;flex-direction:column;gap:12px;">'
          + '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">'
          + '<div style="display:flex;align-items:center;gap:10px;">'
          + '<div class="nav-ico-box" style="background:rgba(56,189,248,0.12);border-color:rgba(56,189,248,0.35);color:var(--cyan);">' + ICONS.fingerprint + '</div>'
          + '<div><div style="font-size:14px;font-weight:700;color:#fff;">Segurança & Desbloqueio por Impressão Digital</div>'
          + '<div style="font-size:11.5px;color:var(--muted);">Operador: ' + esc(state.username || 'Local') + ' · ' + (state.biometricAvailable ? (state.biometricEnabled ? 'Impressão digital habilitada' : 'Sensor disponível (desativado)') : 'Nenhuma biometria cadastrada no Android') + '</div></div></div>'
          + '<span class="tag ' + (state.biometricEnabled ? 'emerald' : 'amber') + '">' + (state.biometricEnabled ? 'Biometria ON' : 'Somente Senha') + '</span>'
          + '</div>'
          + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
          + '<button class="btn ' + (state.biometricEnabled ? 'danger' : 'cyan') + '" onclick="toggleAndroidBiometric()">' + ICONS.fingerprint + (state.biometricEnabled ? ' Desativar Impressão Digital' : ' Ativar Impressão Digital') + '</button>'
          + '<button class="btn" onclick="logoutLocal()">' + ICONS.logout + ' Bloquear Aplicativo Agora</button>'
          + '</div></div>';
      } else {
        // System: API Key + Cloud Origin + Cloud Relay
        html += '<div class="grid-2">'
          + '<div class="spatial-card" style="padding:16px;display:flex;flex-direction:column;gap:11px;">'
          + '<div style="display:flex;align-items:center;justify-content:space-between;">'
          + '<div style="font-size:13.5px;font-weight:700;color:#fff;">Chave API Gemini & OAuth Bridge</div>'
          + '<span class="tag ' + (state.hasApiKey ? 'emerald' : 'rose') + '">' + (state.hasApiKey ? 'API Key Ativa' : 'Sem API Key') + '</span>'
          + '</div>'
          + '<div><label style="font-size:11px;color:var(--muted);">GEMINI_API_KEY (salva com permissão 0600 em ~/.config/aegis/env)</label>'
          + '<input id="set-api-key" class="inp mono" type="password" placeholder="AIzaSy... (deixe em branco para manter a atual)" /></div>'
          + '<div><label style="font-size:11px;color:var(--muted);">URL do Aegis Web (usada no botão Conectar com Google 1-Clique)</label>'
          + '<input id="set-cloud-origin" class="inp" value="' + esc(state.cloudOrigin) + '" /></div>'
          + '<button class="btn primary" onclick="saveSystemSettings()">Salvar Configurações Locais</button>'
          + '</div>'
          + '<div class="spatial-card" style="padding:16px;display:flex;flex-direction:column;gap:11px;">'
          + '<div style="font-size:13.5px;font-weight:700;color:#fff;">Ponte Remota com Aegis Cloud</div>'
          + '<div style="font-size:11.5px;color:var(--muted);line-height:1.45;">Opcional: pareie esta máquina local com o Aegis Web para enviar comandos à distância.</div>'
          + '<div><label style="font-size:11px;color:var(--muted);">URL Aegis Cloud</label><input id="bridge-url" class="inp" value="' + esc(state.cloudOrigin) + '" /></div>'
          + '<div><label style="font-size:11px;color:var(--muted);">Código de Pareamento</label><input id="bridge-code" class="inp mono" placeholder="AEGIS-XXXX" /></div>'
          + '<button class="btn cyan" onclick="startCloudBridge()">Iniciar Ponte Cloud</button>'
          + '</div></div>';
      }
    }

    body.innerHTML = html;
  }

  window.toggleAndroidBiometric = function() {
    if (!IS_ANDROID_BRIDGE || !window.AegisAndroid || !window.AegisAndroid.setBiometricEnabled) return;
    try {
      var res = JSON.parse(window.AegisAndroid.setBiometricEnabled(!state.biometricEnabled) || '{}');
      if (!res.ok) {
        toast(res.error || 'Não foi possível alterar a biometria.');
        return;
      }
      state.biometricAvailable = Boolean(res.biometricAvailable);
      state.biometricEnabled = Boolean(res.biometricEnabled);
      toast(state.biometricEnabled ? 'Desbloqueio por impressão digital ativado!' : 'Desbloqueio por impressão digital desativado.');
      renderModuleContent();
    } catch (e) { toast(e.message); }
  };

  window.saveGoogleClientId = async function() {
    var val = (document.getElementById('g-client-id').value || '').trim();
    try {
      await api('/settings', { method: 'POST', body: { googleClientId: val } });
      state.googleClientId = val;
      toast('Google Client ID salvo!');
    } catch (e) { toast(e.message); }
  };

  window.connectManualGoogleToken = async function() {
    var tok = (document.getElementById('g-manual-token').value || '').trim();
    if (!tok) return;
    try {
      await api('/google/sync', { method: 'POST', body: { token: tok } });
      await refreshStatusAndGoogle();
      renderModuleContent();
      toast('Google Workspace conectado via token!');
    } catch (e) { toast(e.message); }
  };

  window.loadDriveFolder = async function(folderId, crumbIdx) {
    try {
      state.driveFolderId = folderId || 'root';
      if (typeof crumbIdx === 'number') state.driveBreadcrumbs = state.driveBreadcrumbs.slice(0, crumbIdx + 1);
      var data = await api('/google/drive/folder?folderId=' + encodeURIComponent(state.driveFolderId));
      state.driveItems = data.files || [];
      state.driveOpenFile = null;
      if (state.activeModule === 'settings') renderModuleContent();
    } catch (e) { toast(e.message); }
  };

  window.openDriveFolder = function(id, name) {
    state.driveBreadcrumbs.push({ id: id, name: name });
    loadDriveFolder(id);
  };

  window.openDriveFile = async function(id) {
    try {
      state.driveOpenFile = await api('/google/drive/file?id=' + encodeURIComponent(id));
      renderModuleContent();
    } catch (e) { toast(e.message); }
  };

  window.saveDriveFile = async function() {
    if (!state.driveOpenFile) return;
    try {
      var content = document.getElementById('drive-editor').value;
      await api('/google/drive/save', { method: 'POST', body: { id: state.driveOpenFile.id, content: content } });
      state.driveOpenFile.content = content;
      toast('Arquivo atualizado no Google Drive!');
    } catch (e) { toast(e.message); }
  };

  window.downloadDriveToLocal = async function(fileId, fileName) {
    try {
      var res = await api('/google/sync/download', { method: 'POST', body: { fileId: fileId, fileName: fileName } });
      toast('Salvo localmente em: ' + (res.localPath || 'AegisSync'));
    } catch (e) { toast(e.message); }
  };

  window.saveSystemSettings = async function() {
    var apiKey = (document.getElementById('set-api-key').value || '').trim();
    var origin = (document.getElementById('set-cloud-origin').value || '').trim();
    try {
      var res = await api('/settings', { method: 'POST', body: { geminiApiKey: apiKey || undefined, cloudOrigin: origin } });
      state.cloudOrigin = res.cloudOrigin || DEFAULT_CLOUD_ORIGIN;
      state.hasApiKey = Boolean(res.hasApiKey);
      toast('Configurações locais salvas!');
      renderGooglePillAndPopover();
      renderModuleContent();
    } catch (e) { toast(e.message); }
  };

  window.startCloudBridge = async function() {
    var url = (document.getElementById('bridge-url').value || '').trim();
    var code = (document.getElementById('bridge-code').value || '').trim();
    try {
      var res = await api('/cloud-bridge', { method: 'POST', body: { cloudUrl: url, pairingCode: code } });
      toast(res.message || 'Ponte Cloud iniciada!');
    } catch (e) { toast(e.message); }
  };

  // ===== Auth & Bootstrap =====
  function showAuthGate(autoPromptBio) {
    document.getElementById('auth-overlay').classList.add('open');
    var titleEl = document.getElementById('auth-title');
    if (titleEl) titleEl.textContent = isAndroidMode() ? 'AEGIS ANDROID' : 'AEGIS LOCAL';
    var footEl = document.getElementById('auth-footer');
    if (footEl && isAndroidMode()) {
      footEl.innerHTML = 'Credenciais protegidas com <span class="mono" style="color:var(--amber-soft);">PBKDF2-SHA256</span> e biometria nativa do Android. Descoberta Wi-Fi automática ativa em segundo plano.';
    }
    document.getElementById('auth-subtitle').textContent = state.needsSetup
      ? 'Primeiro acesso — crie seu usuário e senha locais'
      : 'Digite suas credenciais ou use sua impressão digital';
    document.getElementById('auth-submit-btn').textContent = state.needsSetup
      ? 'Criar Conta Local & Iniciar'
      : 'Entrar no Núcleo';

    var userInp = document.getElementById('auth-user');
    if (userInp && !state.needsSetup && state.username && !userInp.value) {
      userInp.value = state.username;
    }
    var passInp = document.getElementById('auth-pass');
    if (passInp) passInp.value = '';

    var bioWrap = document.getElementById('auth-bio-wrap');
    if (bioWrap) {
      bioWrap.style.display = (IS_ANDROID_BRIDGE && state.needsSetup && state.biometricAvailable) ? 'flex' : 'none';
    }
    var bioBtn = document.getElementById('auth-bio-btn');
    if (bioBtn) {
      bioBtn.style.display = (IS_ANDROID_BRIDGE && !state.needsSetup && state.biometricEnabled) ? 'flex' : 'none';
    }
    if (autoPromptBio && IS_ANDROID_BRIDGE && !state.needsSetup && state.biometricEnabled) {
      setTimeout(function() {
        if (!state.authenticated) triggerAndroidBiometric();
      }, 380);
    }
  }

  window.triggerAndroidBiometric = function() {
    if (!IS_ANDROID_BRIDGE || !window.AegisAndroid || !window.AegisAndroid.promptBiometricAuth) return;
    var errEl = document.getElementById('auth-error');
    if (errEl) errEl.style.display = 'none';
    window.AegisAndroid.promptBiometricAuth();
  };

  window.onAndroidBiometricResult = function(ok, msg) {
    var errEl = document.getElementById('auth-error');
    if (ok) {
      state.authenticated = true;
      document.getElementById('auth-overlay').classList.remove('open');
      if (errEl) errEl.style.display = 'none';
      triggerCoreShockwave(1.0);
      bootstrapAuthedData();
      toast('Desbloqueado com impressão digital!');
    } else if (msg && errEl) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
    }
  };

  window.handleAuthSubmit = async function(e) {
    e.preventDefault();
    var u = document.getElementById('auth-user').value.trim();
    var p = document.getElementById('auth-pass').value;
    var errEl = document.getElementById('auth-error');
    errEl.style.display = 'none';
    try {
      if (IS_ANDROID_BRIDGE && window.AegisAndroid) {
        var bioChk = document.getElementById('auth-bio-check');
        var enableBio = Boolean(bioChk && bioChk.checked && state.biometricAvailable);
        var raw = state.needsSetup
          ? window.AegisAndroid.setupLocalUser(u, p, enableBio)
          : window.AegisAndroid.loginLocalUser(u, p);
        var resAnd = JSON.parse(raw || '{}');
        if (!resAnd.ok) throw new Error(resAnd.error || 'Credenciais inválidas.');
        state.needsSetup = false;
        state.username = resAnd.username || u;
        state.biometricAvailable = Boolean(resAnd.biometricAvailable);
        state.biometricEnabled = Boolean(resAnd.biometricEnabled);
        state.authenticated = true;
        document.getElementById('auth-overlay').classList.remove('open');
        triggerCoreShockwave(1.0);
        await bootstrapAuthedData();
        toast('Bem-vindo ao Aegis Android, ' + state.username + '!');
        return;
      }
      var endpoint = state.needsSetup ? '/auth/setup' : '/auth/login';
      var res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p })
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Credenciais inválidas.');
      state.token = data.token;
      state.username = data.username || u;
      state.authenticated = true;
      localStorage.setItem('aegis_local_token', data.token);
      document.getElementById('auth-overlay').classList.remove('open');
      triggerCoreShockwave(1.0);
      await bootstrapAuthedData();
      toast('Bem-vindo ao Aegis Local, ' + state.username + '!');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  };

  window.logoutLocal = async function() {
    if (!IS_ANDROID_BRIDGE) {
      try { await api('/auth/logout', { method: 'POST' }); } catch (e) {}
      state.token = '';
      localStorage.removeItem('aegis_local_token');
    }
    state.authenticated = false;
    toggleDrawer(false);
    closeModule();
    showAuthGate(false);
  };

  async function refreshStatusAndGoogle() {
    if (!state.authenticated) return;
    if (IS_ANDROID_BRIDGE && window.AegisAndroid) {
      try {
        if (window.AegisAndroid.getStatusJson) {
          state.status = JSON.parse(window.AegisAndroid.getStatusJson() || '{}');
          if (state.status && state.status.serverOrigin) state.cloudOrigin = state.status.serverOrigin;
          if (typeof state.status.biometricAvailable === 'boolean') state.biometricAvailable = state.status.biometricAvailable;
          if (typeof state.status.biometricEnabled === 'boolean') state.biometricEnabled = state.status.biometricEnabled;
        }
        if (window.AegisAndroid.getGoogleStatusJson) {
          var gAnd = JSON.parse(window.AegisAndroid.getGoogleStatusJson() || '{}');
          state.googleSync = { connected: Boolean(gAnd.connected), email: gAnd.email || '', counts: { drive: 0, gmail: 0, calendar: 0, tasks: 0 } };
        }
        renderGooglePillAndPopover();
      } catch (e) {}
      return;
    }
    try {
      var results = await Promise.all([
        api('/status'),
        api('/settings'),
        api('/google/sync/status').catch(function() { return null; })
      ]);
      state.status = results[0];
      var set = results[1] || {};
      state.modelPreference = set.modelPreference || 'auto';
      state.cloudOrigin = set.cloudOrigin || DEFAULT_CLOUD_ORIGIN;
      state.googleClientId = set.googleClientId || '';
      state.hasApiKey = Boolean(set.hasApiKey);
      state.googleSync = results[2];
      var sel = document.getElementById('dock-model-sel');
      if (sel) sel.value = state.modelPreference;
      renderGooglePillAndPopover();
    } catch (e) {}
  }

  async function refreshUsage() {
    if (!state.authenticated || IS_ANDROID_BRIDGE) return;
    try {
      state.usage = await api('/usage');
    } catch (e) {}
  }

  async function bootstrapAuthedData() {
    await Promise.all([refreshStatusAndGoogle(), refreshUsage(), refreshJobs(), loadMeshStatus()]);
    renderThinkingPanel();
    renderJobsUI();
    renderGooglePillAndPopover();
    updateCoreBackdropClass();
  }

  async function initApp() {
    mountStaticIcons();
    initHologramCore();
    renderThinkingPanel();
    renderJobsUI();
    renderGooglePillAndPopover();

    document.getElementById('btn-open-menu').onclick = function() { toggleDrawer(); };
    document.getElementById('btn-return-core').onclick = function() { closeModule(); };
    document.getElementById('btn-toggle-deck').onclick = function() {
      closeModule();
      renderHoloDeck();
    };
    document.getElementById('btn-thinking').onclick = function() { togglePopover('thinking'); };
    document.getElementById('btn-jobs').onclick = function() { togglePopover('jobs'); };
    document.getElementById('btn-google-pill').onclick = function() { togglePopover('google'); };

    // Keyboard shortcuts: M for Spatial Menu, Escape to close overlays
    window.addEventListener('keydown', function(ev) {
      var tag = (ev.target && ev.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (ev.key === 'Escape') {
        if (state.drawerOpen) toggleDrawer(false);
        else if (state.activePopover) closeAllPopovers();
        else if (state.activeModule) closeModule();
      } else if (!typing && (ev.key === 'm' || ev.key === 'M') && !ev.ctrlKey && !ev.metaKey) {
        ev.preventDefault();
        toggleDrawer();
      }
    });

    if (IS_ANDROID_BRIDGE && window.AegisAndroid) {
      try {
        var authAnd = window.AegisAndroid.getAuthStatusJson ? JSON.parse(window.AegisAndroid.getAuthStatusJson() || '{}') : { needsSetup: false };
        state.needsSetup = Boolean(authAnd.needsSetup);
        state.username = authAnd.username || '';
        state.biometricAvailable = Boolean(authAnd.biometricAvailable);
        state.biometricEnabled = Boolean(authAnd.biometricEnabled);
        updateCoreBackdropClass();
        showAuthGate(true);
      } catch (e) {
        state.authenticated = true;
        await bootstrapAuthedData();
      }
      setInterval(function() {
        if (state.authenticated && state.activeModule === 'devices') {
          loadMeshStatus();
        }
      }, 3000);
      return;
    }

    try {
      var headers = {};
      if (state.token) headers['X-Aegis-Local-Token'] = state.token;
      var res = await fetch('/auth/status', { headers: headers });
      var auth = await res.json();
      state.needsSetup = Boolean(auth.needsSetup);
      state.username = auth.username || '';
      if (auth.authenticated) {
        state.authenticated = true;
        await bootstrapAuthedData();
      } else {
        showAuthGate(false);
      }
    } catch (e) {
      toast('Aguardando daemon local em 127.0.0.1:3847...');
    }

    // Background polling loop (fast when jobs or devices module are active)
    setInterval(function() {
      if (!state.authenticated || IS_ANDROID_BRIDGE) return;
      var hasRunning = state.jobs.some(function(j) { return j.status === 'running' || j.status === 'queued'; });
      if (hasRunning || state.activePopover === 'jobs') {
        refreshJobs();
      }
      if (state.activeModule === 'devices') {
        loadMeshStatus();
      }
    }, 3000);

    setInterval(function() {
      if (!state.authenticated || IS_ANDROID_BRIDGE) return;
      refreshStatusAndGoogle();
      refreshJobs();
    }, 12000);
  }

  initApp();
})();
</script>
</body>
</html>`;
}
