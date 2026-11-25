import {
  Activity,
  AppWindow,
  BatteryCharging,
  Bell,
  Check,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Folder,
  HardDrive,
  Home,
  Laptop,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Send,
  Smartphone,
  Sparkles,
  Terminal,
  Trash2,
  Undo2,
  Volume2,
  Wifi,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, getAegisSessionToken } from '../lib/apiClient';
import type {
  ConfirmationModalRequest,
  DeviceCommandItem,
  DevicePlatform,
  PairedDevice,
} from '../types';
import { PWAInstallButton } from './PWAInstallButton';

interface DevicesMeshViewProps {
  onRequestConfirm: (req: ConfirmationModalRequest) => void;
  onAskOrchestrator?: (prompt: string) => void;
}

type DetailTab = 'telemetry' | 'files' | 'apps' | 'control';
type PairModeTab = 'android' | 'ios' | 'desktop';

const TRANSPORT_LABELS: Record<string, string> = {
  adb_local: 'ADB Local (USB/Wi-Fi)',
  adb_desktop_relay: 'ADB via Desktop Relay',
  termux_ws: 'Termux System Agent (Nuvem)',
  android_app_ws: 'Android Companion App',
  ios_shortcut: 'iOS PWA + Atalhos',
  desktop_ws: 'Desktop Agent (Nuvem)',
  pwa_browser: 'PWA Navegador',
};

function detectBrowserPlatform(): DevicePlatform {
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Linux/i.test(ua)) return 'linux';
  return 'web';
}

export const DevicesMeshView: React.FC<DevicesMeshViewProps> = ({
  onRequestConfirm,
  onAskOrchestrator,
}) => {
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [commands, setCommands] = useState<DeviceCommandItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailTab, setDetailTab] = useState<DetailTab>('telemetry');
  const [showPairing, setShowPairing] = useState(false);
  const [pairTab, setPairTab] = useState<PairModeTab>('android');

  // Pairing generator state
  const [pairLabel, setPairLabel] = useState('');
  const [pairInfo, setPairInfo] = useState<{
    code: string;
    platform: string;
    origin: string;
    expiresAt: number;
  } | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [issuedBrowserToken, setIssuedBrowserToken] = useState<string | null>(null);
  const [registeringSelf, setRegisteringSelf] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Remote file explorer state
  const [remotePath, setRemotePath] = useState('/sdcard');
  const [remoteEntries, setRemoteEntries] = useState<Array<{ name: string; path: string; type: string; raw?: string }>>([]);
  const [remoteFileContent, setRemoteFileContent] = useState<{ path: string; content: string } | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);

  // Remote control state
  const [shellInput, setShellInput] = useState('');
  const [appPackageInput, setAppPackageInput] = useState('com.whatsapp');
  const [ttsInput, setTtsInput] = useState('');
  const [tapX, setTapX] = useState('540');
  const [tapY, setTapY] = useState('1200');
  const [lastCmdOutput, setLastCmdOutput] = useState<string | null>(null);
  const [cmdBusy, setCmdBusy] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  const loadDevices = useCallback(async () => {
    try {
      const res = await apiFetch('/api/devices');
      if (res.ok) {
        const data = (await res.json()) as { devices: PairedDevice[] };
        setDevices(data.devices || []);
        setSelectedId((prev) => {
          if (prev && data.devices.some((d) => d.id === prev)) return prev;
          return data.devices[0]?.id || null;
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDeviceDetail = useCallback(async (id: string) => {
    const res = await apiFetch(`/api/devices/${encodeURIComponent(id)}`);
    if (res.ok) {
      const data = (await res.json()) as { device: PairedDevice; commands: DeviceCommandItem[] };
      setDevices((prev) => prev.map((d) => (d.id === id ? data.device : d)));
      setCommands(data.commands || []);
    }
  }, []);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    if (selectedId) {
      void loadDeviceDetail(selectedId);
      const dev = devices.find((d) => d.id === selectedId);
      setRemotePath(dev?.platform === 'android' ? '/sdcard' : '.');
      setRemoteEntries([]);
      setRemoteFileContent(null);
      setLastCmdOutput(null);
    }
  }, [selectedId, loadDeviceDetail]);

  // Real-time WebSocket operator subscription
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const session = getAegisSessionToken();
    const qs = new URLSearchParams({ role: 'operator' });
    if (session) qs.set('session', session);
    const ws = new WebSocket(`${proto}//${window.location.host}/api/devices/ws?${qs.toString()}`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { event?: string; data?: unknown };
        if (msg.event === 'devices_snapshot' && Array.isArray(msg.data)) {
          setDevices(msg.data as PairedDevice[]);
        } else if (msg.event === 'device_update' && msg.data) {
          const updated = msg.data as PairedDevice;
          setDevices((prev) => {
            const exists = prev.some((d) => d.id === updated.id);
            return exists ? prev.map((d) => (d.id === updated.id ? updated : d)) : [updated, ...prev];
          });
        } else if (msg.event === 'device_removed' && msg.data) {
          const removedId = (msg.data as { id?: string }).id;
          if (removedId) {
            setDevices((prev) => prev.filter((d) => d.id !== removedId));
          }
        } else if (msg.event === 'command_update' && msg.data) {
          const upd = msg.data as { deviceId?: string };
          if (upd.deviceId && upd.deviceId === selectedId) {
            void loadDeviceDetail(upd.deviceId);
          }
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }, [selectedId, loadDeviceDetail]);

  const copyText = (key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const handleGeneratePairingCode = async (platform: DevicePlatform) => {
    setGeneratingCode(true);
    try {
      const res = await apiFetch('/api/devices/pairing-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: pairLabel.trim() || (platform === 'android' ? 'Meu Android' : platform === 'ios' ? 'Meu iPhone/iPad' : 'Meu Desktop'),
          platform,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setPairInfo(data);
      }
    } finally {
      setGeneratingCode(false);
    }
  };

  const handleRegisterCurrentDevice = async () => {
    setRegisteringSelf(true);
    try {
      const platform = detectBrowserPlatform();
      const storedId = localStorage.getItem('aegis_pwa_device_id') || undefined;
      const telemetry: Record<string, unknown> = {
        userAgent: navigator.userAgent,
        language: navigator.language,
        cores: navigator.hardwareConcurrency || null,
        online: navigator.onLine,
        screen: `${window.screen.width}x${window.screen.height}`,
        standalonePwa: window.matchMedia('(display-mode: standalone)').matches,
      };

      const navAny = navigator as Navigator & {
        getBattery?: () => Promise<{ level: number; charging: boolean }>;
        connection?: { effectiveType?: string };
      };
      if (typeof navAny.getBattery === 'function') {
        try {
          const batt = await navAny.getBattery();
          telemetry.batteryPercent = Math.round(batt.level * 100);
          telemetry.charging = batt.charging;
        } catch {
          // ignore
        }
      }
      if (navAny.connection?.effectiveType) {
        telemetry.networkType = navAny.connection.effectiveType;
      }

      let storage: Record<string, unknown> = {};
      if (navigator.storage?.estimate) {
        try {
          const est = await navigator.storage.estimate();
          storage = {
            quotaMb: est.quota ? Math.round(est.quota / 1048576) : null,
            usageMb: est.usage ? Math.round(est.usage / 1048576) : null,
          };
        } catch {
          // ignore
        }
      }

      const defaultName =
        platform === 'ios'
          ? 'iPhone / iPad (Aegis PWA)'
          : platform === 'android'
          ? 'Android (Aegis PWA)'
          : `Navegador ${platform.toUpperCase()}`;

      const res = await apiFetch('/api/devices/register-browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: storedId,
          name: pairLabel.trim() || defaultName,
          platform,
          telemetry,
          storage,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { device: PairedDevice; deviceToken?: string };
        localStorage.setItem('aegis_pwa_device_id', data.device.id);
        if (data.deviceToken) {
          setIssuedBrowserToken(data.deviceToken);
        }
        await loadDevices();
        setSelectedId(data.device.id);
      }
    } finally {
      setRegisteringSelf(false);
    }
  };

  const executeDeviceCommand = async (
    deviceId: string,
    commandType: string,
    payload: Record<string, unknown>,
    confirmed = false
  ) => {
    setCmdBusy(true);
    setLastCmdOutput(null);
    try {
      const res = await apiFetch(`/api/devices/${encodeURIComponent(deviceId)}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandType, payload, confirmed }),
      });
      const data = await res.json();
      if (data.requiresConfirmation) {
        onRequestConfirm({
          id: `dev-confirm-${Date.now()}`,
          title: 'Confirmação de Comando no Dispositivo',
          summary: data.message,
          actionType: commandType,
          target: deviceId,
          details: JSON.stringify(payload, null, 2),
          onConfirm: async () => {
            await executeDeviceCommand(deviceId, commandType, payload, true);
          },
        });
        return null;
      }
      setLastCmdOutput(
        data.ok
          ? JSON.stringify(data.output ?? { ok: true }, null, 2)
          : `Erro: ${data.error || 'Falha ao executar comando.'}`
      );
      void loadDeviceDetail(deviceId);
      return data;
    } finally {
      setCmdBusy(false);
    }
  };

  const handleBrowseRemoteFiles = async (pathToOpen: string) => {
    if (!selectedId) return;
    setRemoteBusy(true);
    setRemoteFileContent(null);
    try {
      const res = await apiFetch(`/api/devices/${encodeURIComponent(selectedId)}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandType: 'list_files', payload: { path: pathToOpen } }),
      });
      const data = await res.json();
      if (data.ok && data.output) {
        setRemotePath(data.output.path || pathToOpen);
        const rawEntries = Array.isArray(data.output.entries) ? data.output.entries : [];
        const normalized = rawEntries.map((item: unknown) => {
          if (typeof item === 'string') {
            const parts = item.split(/\s+/);
            const name = parts.slice(7).join(' ') || item;
            const isDir = item.startsWith('d');
            return {
              name,
              path: `${(data.output.path || pathToOpen).replace(/\/$/, '')}/${name}`,
              type: isDir ? 'directory' : 'file',
              raw: item,
            };
          }
          const obj = item as { name?: string; path?: string; type?: string };
          return {
            name: obj.name || obj.path || 'item',
            path: obj.path || `${pathToOpen}/${obj.name || ''}`,
            type: obj.type || 'file',
          };
        });
        setRemoteEntries(normalized);
      } else {
        setLastCmdOutput(data.error || 'Não foi possível listar arquivos remotos.');
      }
    } finally {
      setRemoteBusy(false);
    }
  };

  const handleReadRemoteFile = async (fp: string) => {
    if (!selectedId) return;
    setRemoteBusy(true);
    try {
      const res = await apiFetch(`/api/devices/${encodeURIComponent(selectedId)}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandType: 'read_file', payload: { path: fp } }),
      });
      const data = await res.json();
      if (data.ok && data.output) {
        setRemoteFileContent({
          path: data.output.path || fp,
          content: String(data.output.content || ''),
        });
      } else {
        setLastCmdOutput(data.error || 'Erro ao ler arquivo remoto.');
      }
    } finally {
      setRemoteBusy(false);
    }
  };

  const handleDeleteDevice = async (dev: PairedDevice) => {
    onRequestConfirm({
      id: `del-dev-${dev.id}`,
      title: 'Desvincular Dispositivo',
      summary: `Remover "${dev.name}" da lista de dispositivos pareados?`,
      actionType: 'device_unpair',
      target: dev.name,
      onConfirm: async () => {
        await apiFetch(`/api/devices/${encodeURIComponent(dev.id)}`, { method: 'DELETE' });
        await loadDevices();
      },
    });
  };

  const selectedDevice = devices.find((d) => d.id === selectedId) || null;
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const termuxOneLiner = pairInfo
    ? `curl -fsSL "${pairInfo.origin}/api/devices/scripts/android-termux.sh?code=${pairInfo.code}" | bash`
    : `curl -fsSL "${currentOrigin}/api/devices/scripts/android-termux.sh" | bash`;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#070B12] text-slate-100">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-white/10 bg-[#0B101A] px-4 sm:px-5 py-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-xs font-mono text-slate-300">
            <span className="text-amber-300 font-semibold">{devices.length}</span>{' '}
            {devices.length === 1 ? 'dispositivo' : 'dispositivos'} ·{' '}
            <span className="text-emerald-400">
              {devices.filter((d) => d.status === 'online').length} online
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleRegisterCurrentDevice()}
            disabled={registeringSelf}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-sky-400/40 bg-sky-500/14 px-3 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-500/24 transition-colors cursor-pointer"
          >
            {registeringSelf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Smartphone className="h-3.5 w-3.5" />}
            <span>Vincular Este Aparelho</span>
          </button>

          <button
            type="button"
            onClick={() => setShowPairing((v) => !v)}
            className={`min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              showPairing
                ? 'border-amber-400 bg-amber-500 text-slate-950'
                : 'border-amber-500/45 bg-amber-500/16 text-amber-200 hover:bg-amber-500/26'
            }`}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{showPairing ? 'Ver Dispositivos' : 'Adicionar Android / iOS / PC'}</span>
          </button>

          <button
            type="button"
            onClick={() => void loadDevices()}
            className="min-h-[40px] inline-flex items-center justify-center rounded-xl border border-white/10 bg-[#121826] px-2.5 text-slate-300 hover:border-amber-500/40 hover:text-amber-200 transition-colors cursor-pointer"
            title="Atualizar lista e escanear ADB"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Content Area: Either Pairing Assistant OR Split Fleet/Inspector */}
      {showPairing ? (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 max-w-5xl mx-auto w-full">
          {/* Platform Selector Tabs */}
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'android', label: 'Android (App Nativo + ADB)' },
                { id: 'ios', label: 'iOS (iPhone / iPad · Atalhos & PWA)' },
                { id: 'desktop', label: 'Desktop Nativo (Linux .deb & Windows .exe)' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setPairTab(t.id);
                  setPairInfo(null);
                }}
                className={`min-h-[44px] rounded-xl border px-4 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                  pairTab === t.id
                    ? 'border-amber-400 bg-amber-500/18 text-amber-200'
                    : 'border-white/10 bg-[#0D1320] text-slate-300 hover:border-amber-500/35'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* One-Click Pairing Code Generator */}
          <div className="rounded-2xl border border-amber-500/25 bg-[#0C1220] p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px] space-y-1">
                <label className="block text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  Nome do dispositivo
                </label>
                <input
                  type="text"
                  value={pairLabel}
                  onChange={(e) => setPairLabel(e.target.value)}
                  placeholder={
                    pairTab === 'android'
                      ? 'Ex: Galaxy S24 / Pixel 9'
                      : pairTab === 'ios'
                      ? 'Ex: iPhone 16 Pro'
                      : 'Ex: Notebook Linux / PC Windows'
                  }
                  className="w-full min-h-[44px] rounded-xl border border-white/12 bg-[#070B12] px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  void handleGeneratePairingCode(
                    pairTab === 'android' ? 'android' : pairTab === 'ios' ? 'ios' : 'linux'
                  )
                }
                disabled={generatingCode}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {generatingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                <span>Gerar Código de Pareamento (15 min)</span>
              </button>
            </div>

            {pairInfo && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3">
                <div>
                  <span className="text-[11px] font-mono text-emerald-300 uppercase">Código ativo</span>
                  <div className="font-mono text-2xl font-bold tracking-[0.25em] text-white">
                    {pairInfo.code}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copyText('code', pairInfo.code)}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-[#0A1712] px-3 text-xs font-medium text-emerald-200 cursor-pointer"
                >
                  {copiedKey === 'code' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>Copiar Código</span>
                </button>
              </div>
            )}
          </div>

          {pairTab === 'android' && (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Method 1: Real Native Android App (Kotlin / APK) */}
              <div className="rounded-2xl border border-amber-500/35 bg-[#0B101C] p-5 space-y-3">
                <h3 className="font-display text-sm font-semibold text-amber-300">
                  Modo 1 · Aplicativo Nativo Android (Kotlin / .APK)
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Aplicativo real do Android (<code>com.aegis.agent</code>) com <strong>ForegroundService</strong>, <strong>AccessibilityService</strong> (toques, gestos e leitura de tela), <strong>NotificationListener</strong>, acesso a <code>/sdcard</code> e inicialização no boot — já pré-configurado com este servidor{pairInfo ? ` e código ${pairInfo.code}` : ''}.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <a
                    href={
                      pairInfo
                        ? `/api/installers/android/AegisAndroid-Native-2.0.0.zip?code=${encodeURIComponent(pairInfo.code)}`
                        : '/api/installers/android/AegisAndroid-Native-2.0.0.zip'
                    }
                    download="AegisAndroid-Native-2.0.0.zip"
                    className="min-h-[40px] inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors"
                  >
                    <Download className="h-4 w-4" />
                    <span>Baixar App Nativo Android (.zip / APK)</span>
                  </a>
                </div>
                <p className="text-[11px] text-slate-400">
                  Compile o <code>.apk</code> no Android Studio, com <code>./build-apk.sh</code> ou em 1 clique no GitHub Actions incluso no pacote.
                </p>
              </div>

              {/* Method 2: ADB USB / Wi-Fi + Termux */}
              <div className="rounded-2xl border border-white/10 bg-[#0B101C] p-5 space-y-3">
                <h3 className="font-display text-sm font-semibold text-sky-300">
                  Modo 2 · Ponte ADB via Desktop ou Termux / Shizuku
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Ative <strong>Depuração USB/Wi-Fi</strong> e conecte no PC rodando o <strong>Aegis Desktop</strong> (Linux <code>.deb</code> ou Windows <code>AegisDesktop.exe</code>) para controle shell completo sem instalar APK, ou use o agente direto no Termux:
                </p>
                <div className="rounded-xl border border-white/10 bg-[#060910] p-3 font-mono text-[11px] text-amber-200 break-all">
                  {termuxOneLiner}
                </div>
                <button
                  type="button"
                  onClick={() => copyText('termux', termuxOneLiner)}
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#121826] px-3 text-xs font-medium text-slate-200 hover:border-amber-500/40 cursor-pointer"
                >
                  {copiedKey === 'termux' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>Copiar Comando Termux</span>
                </button>
              </div>
            </div>
          )}

          {pairTab === 'ios' && (
            <div className="rounded-2xl border border-white/10 bg-[#0B101C] p-5 space-y-4">
              <PWAInstallButton alwaysShowGuide />
              <h3 className="font-display text-sm font-semibold text-sky-300">
                Integração iOS (iPhone & iPad) · PWA + Atalhos da Apple (Shortcuts Bridge)
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                O iOS restringe controle shell de baixo nível por política da Apple, mas o Aegis opera no iPhone/iPad combinando o <strong>App instalável no Safari</strong> com a <strong>Ponte de Atalhos da Apple (Shortcuts)</strong> para sincronizar bateria, localização, área de transferência, notas e executar comandos enfileirados pelo Aegis.
              </p>

              {issuedBrowserToken && (
                <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-emerald-300">
                      Token do Dispositivo (copie agora — exibido uma única vez):
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText('iostok', issuedBrowserToken)}
                      className="text-xs text-emerald-200 hover:underline cursor-pointer"
                    >
                      {copiedKey === 'iostok' ? 'Copiado!' : 'Copiar'}
                    </button>
                  </div>
                  <code className="block font-mono text-xs text-white break-all">{issuedBrowserToken}</code>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2 text-xs">
                <div className="rounded-xl border border-white/10 bg-[#070B13] p-3.5 space-y-2">
                  <p className="font-semibold text-amber-200">1. Enviar Telemetria do iPhone (POST)</p>
                  <code className="block font-mono text-[11px] text-sky-300 break-all">
                    {currentOrigin}/api/devices/telemetry
                  </code>
                  <p className="text-slate-400">
                    Header: <code>X-Aegis-Device-Token: SEU_TOKEN</code><br />
                    Body JSON: <code>{`{"telemetry":{"batteryPercent":85,"clipboard":"..."}}`}</code>
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#070B13] p-3.5 space-y-2">
                  <p className="font-semibold text-amber-200">2. Buscar Comandos Pendentes do Aegis (GET)</p>
                  <code className="block font-mono text-[11px] text-sky-300 break-all">
                    {currentOrigin}/api/devices/ios/poll
                  </code>
                  <p className="text-slate-400">
                    Configure uma Automação no app <strong>Atalhos</strong> (ex: ao abrir app, carregar ou horário) para ler comandos e confirmar em <code>POST /api/devices/ios/report</code>.
                  </p>
                </div>
              </div>
            </div>
          )}

          {pairTab === 'desktop' && (
            <div className="rounded-2xl border border-white/10 bg-[#0B101C] p-5 space-y-4">
              <h3 className="font-display text-sm font-semibold text-amber-300">
                Instalar Aplicativo Nativo Desktop (Linux .deb / ELF & Windows AegisDesktop.exe)
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Instale o aplicativo nativo do sistema operacional no seu computador para controle completo do PC e espelhamento automático de dispositivos Android conectados via ADB:
              </p>
              <div className="flex flex-wrap gap-2.5">
                <a
                  href="/api/installers/linux/aegis-desktop_2.0.0_amd64.deb"
                  download="aegis-desktop_2.0.0_amd64.deb"
                  className="min-h-[40px] inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                >
                  <Download className="h-4 w-4" />
                  <span>Linux (.deb · ELF x86_64)</span>
                </a>
                <a
                  href="/api/installers/linux/aegis-desktop-linux-x64.tar.gz"
                  download="aegis-desktop-linux-x64.tar.gz"
                  className="min-h-[40px] inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#121826] px-4 text-xs font-medium text-slate-200 hover:border-amber-500/40"
                >
                  <Download className="h-4 w-4 text-amber-400" />
                  <span>Linux Universal (.tar.gz)</span>
                </a>
                <a
                  href="/api/installers/windows/AegisDesktop-Windows-Native-2.0.0.zip"
                  download="AegisDesktop-Windows-Native-2.0.0.zip"
                  className="min-h-[40px] inline-flex items-center gap-2 rounded-xl border border-sky-400/40 bg-sky-500/15 px-4 text-xs font-semibold text-sky-200 hover:bg-sky-500/25"
                >
                  <Download className="h-4 w-4" />
                  <span>Windows (AegisDesktop.exe)</span>
                </a>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#060910] p-3 font-mono text-[11px] text-emerald-300 break-all">
                {`AEGIS_CLOUD_URL="${pairInfo?.origin || currentOrigin}" AEGIS_PAIR_CODE="${pairInfo?.code || 'SEU_CODIGO'}" aegis-desktop --start`}
              </div>
              <button
                type="button"
                onClick={() =>
                  copyText(
                    'desktop-relay',
                    `AEGIS_CLOUD_URL="${pairInfo?.origin || currentOrigin}" AEGIS_PAIR_CODE="${pairInfo?.code || 'SEU_CODIGO'}" aegis-desktop --start`
                  )
                }
                className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 text-xs font-medium text-amber-200 cursor-pointer"
              >
                {copiedKey === 'desktop-relay' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>Copiar Comando da Ponte Nuvem</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[300px_1fr] overflow-hidden">
          {/* Device Fleet List */}
          <aside className="border-b lg:border-b-0 lg:border-r border-white/10 bg-[#090D16] overflow-y-auto p-3 space-y-2 max-h-[220px] lg:max-h-none">
            {loading ? (
              <div className="flex items-center gap-2 p-4 text-xs text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                <span>Escaneando dispositivos e pontes ADB...</span>
              </div>
            ) : devices.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/15 p-4 text-center space-y-3">
                <Smartphone className="h-7 w-7 text-amber-400/70 mx-auto" />
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-200">Nenhum dispositivo vinculado</p>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Adicione seu Android (via ADB ou Termux), iPhone/iPad (PWA + Atalhos) ou PC Desktop para controle total e visibilidade unificada.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPairing(true)}
                  className="min-h-[40px] w-full rounded-xl bg-amber-500 px-3 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
                >
                  Configurar Primeiro Dispositivo
                </button>
              </div>
            ) : (
              devices.map((dev) => {
                const isSelected = dev.id === selectedId;
                const batt = dev.telemetry?.batteryPercent;
                return (
                  <button
                    key={dev.id}
                    type="button"
                    onClick={() => setSelectedId(dev.id)}
                    className={`w-full text-left rounded-xl border p-3 transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-amber-400/60 bg-amber-500/12'
                        : 'border-white/10 bg-[#0D1320] hover:border-amber-500/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#070B12] text-amber-300">
                          {dev.platform === 'linux' || dev.platform === 'windows' ? (
                            <Laptop className="h-4 w-4" />
                          ) : (
                            <Smartphone className="h-4 w-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-100 truncate">{dev.name}</p>
                          <p className="text-[10px] font-mono text-slate-400 truncate">
                            {dev.platform.toUpperCase()} · {TRANSPORT_LABELS[dev.transport] || dev.transport}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-mono font-semibold shrink-0 ${
                          dev.status === 'online' ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      >
                        {dev.status === 'online' ? 'ONLINE' : 'OFFLINE'}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-slate-400">
                      <span>
                        {typeof batt === 'number' ? `Bateria ${batt}%` : 'Telemetria ativa'}
                      </span>
                      <span>
                        {dev.apps.length > 0 ? `${dev.apps.length} apps` : dev.files.length > 0 ? `${dev.files.length} itens` : ''}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </aside>

          {/* Selected Device Inspector & Control Console */}
          <main className="flex flex-col min-h-0 overflow-hidden bg-[#070B12]">
            {!selectedDevice ? (
              <div className="flex flex-1 flex-col items-center justify-center p-6 text-center space-y-4">
                <div className="max-w-md space-y-3">
                  <p className="text-sm font-display font-semibold text-slate-200">
                    Selecione um dispositivo ou instale o Aegis no celular
                  </p>
                  <p className="text-xs text-slate-400">
                    Todos os dispositivos adicionados ficam imediatamente visíveis ao Orquestrador Aegis, que consegue cruzar arquivos locais, Google Drive e dados do Android/iOS em uma única missão.
                  </p>
                  <PWAInstallButton compact alwaysShowGuide />
                </div>
              </div>
            ) : (
              <>
                {/* Selected Device Subheader */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#0A0F1A] px-4 sm:px-5 py-3 shrink-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-sm font-semibold text-slate-100 truncate">
                        {selectedDevice.name}
                      </h3>
                      <span
                        className={`text-[10px] font-mono ${
                          selectedDevice.status === 'online' ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      >
                        {selectedDevice.status === 'online' ? '● CONECTADO' : '○ OFFLINE'}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-400 truncate">
                      {selectedDevice.id} · {TRANSPORT_LABELS[selectedDevice.transport] || selectedDevice.transport}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {onAskOrchestrator && (
                      <button
                        type="button"
                        onClick={() =>
                          onAskOrchestrator(
                            `Inspecione todos os dados do dispositivo "${selectedDevice.name}" (ID: ${selectedDevice.id}), verifique bateria, arquivos e notificações e projete um painel executivo.`
                          )
                        }
                        className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/14 px-3 text-xs font-medium text-amber-200 hover:bg-amber-500/24 cursor-pointer"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Analisar com Aegis</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDeleteDevice(selectedDevice)}
                      className="min-h-[38px] inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#121826] px-2.5 text-slate-400 hover:border-rose-500/40 hover:text-rose-300 cursor-pointer"
                      title="Desvincular dispositivo"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Inspector Tabs */}
                <div className="flex items-center gap-1.5 border-b border-white/10 bg-[#080C15] px-4 py-2 overflow-x-auto shrink-0">
                  {(
                    [
                      { id: 'telemetry', label: 'Telemetria & Dados', icon: Activity },
                      { id: 'files', label: 'Arquivos Remotos', icon: Folder },
                      { id: 'apps', label: 'Apps & Notificações', icon: AppWindow },
                      { id: 'control', label: 'Controle de Sistema', icon: Terminal },
                    ] as const
                  ).map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setDetailTab(tab.id)}
                        className={`min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border px-3 text-xs font-medium shrink-0 transition-colors cursor-pointer ${
                          detailTab === tab.id
                            ? 'border-amber-400/55 bg-amber-500/16 text-amber-200'
                            : 'border-transparent text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Tab Body */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                  {detailTab === 'telemetry' && (
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-xl border border-white/10 bg-[#0B101B] p-3.5">
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                            <BatteryCharging className="h-3.5 w-3.5 text-amber-400" />
                            <span>Bateria</span>
                          </div>
                          <p className="mt-1 font-mono text-xl font-semibold text-slate-100 tabular-nums">
                            {typeof selectedDevice.telemetry.batteryPercent === 'number'
                              ? `${selectedDevice.telemetry.batteryPercent}%`
                              : '—'}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {selectedDevice.telemetry.charging === true
                              ? 'Carregando'
                              : selectedDevice.telemetry.charging === false
                              ? 'Na bateria'
                              : 'Sem sensor'}
                          </p>
                        </div>

                        <div className="rounded-xl border border-white/10 bg-[#0B101B] p-3.5">
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                            <Wifi className="h-3.5 w-3.5 text-sky-400" />
                            <span>Rede / Conexão</span>
                          </div>
                          <p className="mt-1 font-mono text-sm font-semibold text-slate-100 truncate">
                            {String(
                              selectedDevice.telemetry.wifiSsid ||
                                selectedDevice.telemetry.connection ||
                                selectedDevice.telemetry.networkType ||
                                selectedDevice.transport
                            )}
                          </p>
                          <p className="text-[11px] font-mono text-slate-400 truncate">
                            {String(selectedDevice.telemetry.wifiIp || selectedDevice.telemetry.androidVersion || selectedDevice.platform)}
                          </p>
                        </div>

                        <div className="rounded-xl border border-white/10 bg-[#0B101B] p-3.5">
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                            <HardDrive className="h-3.5 w-3.5 text-emerald-400" />
                            <span>Memória / Armazenamento</span>
                          </div>
                          <p className="mt-1 font-mono text-sm font-semibold text-slate-100 tabular-nums">
                            {selectedDevice.telemetry.freeMemMb
                              ? `${selectedDevice.telemetry.freeMemMb} / ${selectedDevice.telemetry.totalMemMb} MB`
                              : selectedDevice.storage.quotaMb
                              ? `${selectedDevice.storage.usageMb || 0} / ${selectedDevice.storage.quotaMb} MB`
                              : 'Sincronizado'}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {selectedDevice.files.length} arquivos indexados
                          </p>
                        </div>

                        <div className="rounded-xl border border-white/10 bg-[#0B101B] p-3.5">
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                            <Bell className="h-3.5 w-3.5 text-amber-300" />
                            <span>Apps & Alertas</span>
                          </div>
                          <p className="mt-1 font-mono text-xl font-semibold text-slate-100 tabular-nums">
                            {selectedDevice.apps.length} / {selectedDevice.notifications.length}
                          </p>
                          <p className="text-[11px] text-slate-400">Pacotes · Notificações</p>
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-[#0B101B] p-4 space-y-2">
                        <p className="text-[11px] font-mono uppercase tracking-wider text-amber-300">
                          Snapshot Completo de Telemetria & Armazenamento
                        </p>
                        <pre className="overflow-x-auto rounded-lg bg-[#060910] p-3 font-mono text-[11px] text-slate-300 max-h-60">
                          {JSON.stringify(
                            {
                              capabilities: selectedDevice.capabilities,
                              telemetry: selectedDevice.telemetry,
                              storage: selectedDevice.storage,
                              lastSeenAt: selectedDevice.lastSeenAt,
                            },
                            null,
                            2
                          )}
                        </pre>
                      </div>
                    </div>
                  )}

                  {detailTab === 'files' && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="text"
                          value={remotePath}
                          onChange={(e) => setRemotePath(e.target.value)}
                          className="flex-1 min-w-[200px] min-h-[42px] rounded-xl border border-white/12 bg-[#0B101B] px-3 font-mono text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
                          placeholder="/sdcard"
                        />
                        <button
                          type="button"
                          onClick={() => void handleBrowseRemoteFiles(remotePath)}
                          disabled={remoteBusy}
                          className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
                        >
                          {remoteBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Folder className="h-3.5 w-3.5" />}
                          <span>Explorar Diretório</span>
                        </button>
                      </div>

                      {remoteFileContent && (
                        <div className="rounded-xl border border-amber-500/30 bg-[#0B101B] p-4 space-y-2">
                          <div className="flex items-center justify-between text-xs font-mono text-amber-300">
                            <span className="truncate">{remoteFileContent.path}</span>
                            <button
                              type="button"
                              onClick={() => setRemoteFileContent(null)}
                              className="text-slate-400 hover:text-white cursor-pointer"
                            >
                              Fechar
                            </button>
                          </div>
                          <pre className="max-h-72 overflow-auto rounded-lg bg-[#060910] p-3 font-mono text-[11px] text-slate-200 whitespace-pre-wrap">
                            {remoteFileContent.content || '(arquivo vazio)'}
                          </pre>
                        </div>
                      )}

                      <div className="rounded-xl border border-white/10 bg-[#0B101B] divide-y divide-white/5">
                        {(remoteEntries.length > 0
                          ? remoteEntries
                          : (selectedDevice.files as Array<{ name?: string; path?: string; type?: string }>)
                        ).map((entry, idx) => {
                          const name = entry.name || entry.path || `Item ${idx + 1}`;
                          const fullPath = entry.path || `${remotePath.replace(/\/$/, '')}/${name}`;
                          const isDir = entry.type === 'directory';
                          return (
                            <button
                              key={`${fullPath}-${idx}`}
                              type="button"
                              onClick={() =>
                                isDir ? void handleBrowseRemoteFiles(fullPath) : void handleReadRemoteFile(fullPath)
                              }
                              className="w-full min-h-[44px] flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-white/[0.04] transition-colors cursor-pointer"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                {isDir ? (
                                  <Folder className="h-4 w-4 text-amber-400 shrink-0" />
                                ) : (
                                  <FileText className="h-4 w-4 text-sky-400 shrink-0" />
                                )}
                                <span className="font-mono text-xs text-slate-200 truncate">{name}</span>
                              </div>
                              <ChevronRight className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                            </button>
                          );
                        })}
                        {remoteEntries.length === 0 && selectedDevice.files.length === 0 && (
                          <div className="p-5 text-center text-xs text-slate-400">
                            Clique em <strong>Explorar Diretório</strong> para ler em tempo real os arquivos do dispositivo.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {detailTab === 'apps' && (
                    <div className="grid gap-4 xl:grid-cols-2">
                      <div className="rounded-xl border border-white/10 bg-[#0B101B] p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-semibold text-amber-300">
                            Aplicativos Instalados ({selectedDevice.apps.length})
                          </h4>
                          <button
                            type="button"
                            onClick={() => void executeDeviceCommand(selectedDevice.id, 'list_packages', {})}
                            disabled={cmdBusy}
                            className="text-[11px] font-mono text-sky-300 hover:underline cursor-pointer"
                          >
                            Atualizar lista
                          </button>
                        </div>
                        <div className="max-h-72 overflow-y-auto space-y-1.5">
                          {selectedDevice.apps.length === 0 ? (
                            <p className="text-xs text-slate-400">Nenhum pacote sincronizado ainda.</p>
                          ) : (
                            selectedDevice.apps.map((app, i) => {
                              const pkg = typeof app === 'string' ? app : JSON.stringify(app);
                              return (
                                <div
                                  key={`${pkg}-${i}`}
                                  className="flex items-center justify-between gap-2 rounded-lg border border-white/8 bg-[#070B12] px-3 py-2"
                                >
                                  <span className="font-mono text-[11px] text-slate-200 truncate">{pkg}</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void executeDeviceCommand(selectedDevice.id, 'open_app', { packageName: pkg })
                                    }
                                    className="inline-flex items-center gap-1 rounded-md border border-amber-500/35 bg-amber-500/12 px-2 py-1 text-[10px] font-medium text-amber-200 hover:bg-amber-500/24 cursor-pointer shrink-0"
                                  >
                                    <Play className="h-3 w-3" />
                                    <span>Abrir</span>
                                  </button>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-[#0B101B] p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-semibold text-sky-300">
                            Notificações Recentes ({selectedDevice.notifications.length})
                          </h4>
                          <button
                            type="button"
                            onClick={() => void executeDeviceCommand(selectedDevice.id, 'notifications', {})}
                            disabled={cmdBusy}
                            className="text-[11px] font-mono text-sky-300 hover:underline cursor-pointer"
                          >
                            Sincronizar
                          </button>
                        </div>
                        <div className="max-h-72 overflow-y-auto space-y-2">
                          {selectedDevice.notifications.length === 0 ? (
                            <p className="text-xs text-slate-400">Sem notificações capturadas no último snapshot.</p>
                          ) : (
                            selectedDevice.notifications.map((n, i) => {
                              const obj = typeof n === 'object' && n ? (n as Record<string, unknown>) : { title: String(n) };
                              return (
                                <div key={i} className="rounded-lg border border-white/8 bg-[#070B12] p-2.5 space-y-0.5">
                                  <p className="text-xs font-semibold text-slate-100">
                                    {String(obj.title || obj.packageName || 'Notificação')}
                                  </p>
                                  {Boolean(obj.content) && (
                                    <p className="text-[11px] text-slate-400 line-clamp-2">{String(obj.content)}</p>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {detailTab === 'control' && (
                    <div className="space-y-4">
                      {/* Quick System Controls */}
                      <div className="rounded-xl border border-white/10 bg-[#0B101B] p-4 space-y-3">
                        <h4 className="text-xs font-semibold text-amber-300">
                          Controles Rápidos de Sistema ({selectedDevice.platform.toUpperCase()})
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void executeDeviceCommand(selectedDevice.id, 'input_keyevent', { key: 'KEYCODE_HOME' })
                            }
                            disabled={cmdBusy}
                            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-[#111726] px-3 text-xs text-slate-200 hover:border-amber-400/50 cursor-pointer"
                          >
                            <Home className="h-3.5 w-3.5 text-amber-400" />
                            <span>Home</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void executeDeviceCommand(selectedDevice.id, 'input_keyevent', { key: 'KEYCODE_BACK' })
                            }
                            disabled={cmdBusy}
                            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-[#111726] px-3 text-xs text-slate-200 hover:border-amber-400/50 cursor-pointer"
                          >
                            <Undo2 className="h-3.5 w-3.5 text-sky-400" />
                            <span>Voltar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void executeDeviceCommand(selectedDevice.id, 'input_keyevent', {
                                key: 'KEYCODE_VOLUME_UP',
                              })
                            }
                            disabled={cmdBusy}
                            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-[#111726] px-3 text-xs text-slate-200 hover:border-amber-400/50 cursor-pointer"
                          >
                            <Volume2 className="h-3.5 w-3.5 text-emerald-400" />
                            <span>Volume +</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void executeDeviceCommand(selectedDevice.id, 'notify', {
                                title: 'Aegis Orquestrador',
                                content: 'Conexão remota verificada com sucesso.',
                              })
                            }
                            disabled={cmdBusy}
                            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-[#111726] px-3 text-xs text-slate-200 hover:border-amber-400/50 cursor-pointer"
                          >
                            <Bell className="h-3.5 w-3.5 text-amber-300" />
                            <span>Enviar Notificação</span>
                          </button>
                        </div>

                        {/* Open App + Tap Coordinates + TTS */}
                        <div className="grid gap-3 md:grid-cols-3 pt-1">
                          <div className="flex gap-1.5">
                            <input
                              type="text"
                              value={appPackageInput}
                              onChange={(e) => setAppPackageInput(e.target.value)}
                              placeholder="com.whatsapp"
                              className="flex-1 min-w-0 min-h-[40px] rounded-lg border border-white/12 bg-[#060910] px-2.5 font-mono text-xs text-slate-100"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                void executeDeviceCommand(selectedDevice.id, 'open_app', {
                                  packageName: appPackageInput.trim(),
                                })
                              }
                              disabled={cmdBusy}
                              className="min-h-[40px] rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 text-xs font-medium text-amber-200 cursor-pointer"
                            >
                              Abrir App
                            </button>
                          </div>

                          <div className="flex gap-1.5">
                            <input
                              type="number"
                              value={tapX}
                              onChange={(e) => setTapX(e.target.value)}
                              placeholder="X"
                              className="w-16 min-h-[40px] rounded-lg border border-white/12 bg-[#060910] px-2 font-mono text-xs text-slate-100"
                            />
                            <input
                              type="number"
                              value={tapY}
                              onChange={(e) => setTapY(e.target.value)}
                              placeholder="Y"
                              className="w-16 min-h-[40px] rounded-lg border border-white/12 bg-[#060910] px-2 font-mono text-xs text-slate-100"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                void executeDeviceCommand(selectedDevice.id, 'input_tap', {
                                  x: Number(tapX),
                                  y: Number(tapY),
                                })
                              }
                              disabled={cmdBusy}
                              className="flex-1 min-h-[40px] rounded-lg border border-sky-400/40 bg-sky-500/14 px-3 text-xs font-medium text-sky-200 cursor-pointer"
                            >
                              Toque (X,Y)
                            </button>
                          </div>

                          <div className="flex gap-1.5">
                            <input
                              type="text"
                              value={ttsInput}
                              onChange={(e) => setTtsInput(e.target.value)}
                              placeholder="Falar texto no aparelho..."
                              className="flex-1 min-w-0 min-h-[40px] rounded-lg border border-white/12 bg-[#060910] px-2.5 text-xs text-slate-100"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                ttsInput.trim() &&
                                void executeDeviceCommand(selectedDevice.id, 'tts_speak', { text: ttsInput.trim() })
                              }
                              disabled={cmdBusy || !ttsInput.trim()}
                              className="min-h-[40px] rounded-lg border border-emerald-400/40 bg-emerald-500/14 px-3 text-xs font-medium text-emerald-200 cursor-pointer"
                            >
                              Falar
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Direct System Shell Console */}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!shellInput.trim()) return;
                          void executeDeviceCommand(selectedDevice.id, 'shell', { command: shellInput.trim() });
                          setShellInput('');
                        }}
                        className="rounded-xl border border-white/10 bg-[#0B101B] p-4 space-y-3"
                      >
                        <label className="block text-xs font-semibold text-sky-300">
                          Console Shell de Sistema (ADB / Termux / Shizuku / Desktop)
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={shellInput}
                            onChange={(e) => setShellInput(e.target.value)}
                            placeholder="Ex: dumpsys battery | head -n 12   ou   ls -la /sdcard/Download"
                            className="flex-1 min-h-[44px] rounded-xl border border-white/12 bg-[#060910] px-3 font-mono text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={cmdBusy || !shellInput.trim()}
                            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-40 cursor-pointer"
                          >
                            {cmdBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                            <span>Executar</span>
                          </button>
                        </div>

                        {lastCmdOutput && (
                          <pre className="max-h-56 overflow-auto rounded-lg border border-white/10 bg-[#05070B] p-3 font-mono text-[11px] text-emerald-200 whitespace-pre-wrap">
                            {lastCmdOutput}
                          </pre>
                        )}
                      </form>

                      {/* Recent Command History */}
                      {commands.length > 0 && (
                        <div className="rounded-xl border border-white/10 bg-[#0B101B] p-4 space-y-2">
                          <h4 className="text-xs font-semibold text-slate-300">
                            Histórico & Fila de Comandos ({commands.length})
                          </h4>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {commands.slice(0, 12).map((c) => (
                              <div
                                key={c.id}
                                className="flex items-center justify-between gap-3 rounded-lg border border-white/6 bg-[#060910] px-3 py-2 text-[11px] font-mono"
                              >
                                <span className="text-slate-200 truncate">
                                  {c.command_type} · {c.payload_json.slice(0, 70)}
                                </span>
                                <span
                                  className={
                                    c.status === 'completed'
                                      ? 'text-emerald-400'
                                      : c.status === 'error'
                                      ? 'text-rose-400'
                                      : 'text-amber-300'
                                  }
                                >
                                  {c.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
};
