import {
  Check,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileCode2,
  GitBranch,
  HardDrive,
  Laptop,
  Link2,
  Loader2,
  Monitor,
  Package,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import { probeLocalDaemon } from '../lib/localEngine';
import type { BundleFile } from '../types';

interface NativeArtifactMeta {
  id: string;
  os: 'linux' | 'windows' | 'android';
  filename: string;
  title: string;
  subtitle: string;
  format: string;
  architecture: string;
  downloadUrl: string;
  sizeBytes: number | null;
  sha256: string | null;
  compiledOnServer: boolean;
  source?: 'server_compiled' | 'github_release' | 'build_kit';
  releaseTag?: string | null;
  installSteps: string[];
  capabilities: string[];
}

interface GithubReleaseSyncInfo {
  repo: string | null;
  status: 'unconfigured' | 'linked' | 'no_releases' | 'error';
  releaseTag: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  syncedAssetsCount: number;
  message: string;
}

interface CatalogResponse {
  version: string;
  builtAt: string;
  githubSync?: GithubReleaseSyncInfo;
  artifacts: NativeArtifactMeta[];
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const LinuxInstallerView: React.FC = () => {
  const [osTab, setOsTab] = useState<'linux' | 'windows' | 'android'>('linux');
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [githubRepoInput, setGithubRepoInput] = useState('');
  const [savingGithubRepo, setSavingGithubRepo] = useState(false);
  const [githubRepoFeedback, setGithubRepoFeedback] = useState<string | null>(null);

  const [files, setFiles] = useState<BundleFile[]>([]);
  const [selectedName, setSelectedName] = useState('aegis-daemon.mjs');
  const [showInspector, setShowInspector] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [daemonCheck, setDaemonCheck] = useState<{
    state: 'idle' | 'checking' | 'online' | 'offline';
    detail?: string;
  }>({ state: 'idle' });

  // Android pre-configured pairing code generator
  const [androidLabel, setAndroidLabel] = useState('Meu Android');
  const [androidPairCode, setAndroidPairCode] = useState<string | null>(null);
  const [generatingAndroidCode, setGeneratingAndroidCode] = useState(false);

  const loadCatalog = async (refresh = false) => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const res = await fetch(refresh ? '/api/installers/catalog?refresh=1' : '/api/installers/catalog');
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as CatalogResponse;
      setCatalog(data);
      if (data.githubSync?.repo) {
        setGithubRepoInput(data.githubSync.repo);
      }
    } catch (err: unknown) {
      setCatalogError(err instanceof Error ? err.message : 'Falha ao carregar catálogo de aplicativos nativos.');
    } finally {
      setCatalogLoading(false);
    }
  };

  useEffect(() => {
    void loadCatalog();
    fetch('/api/installer/files')
      .then((r) => r.json())
      .then((d) => {
        if (d.files) setFiles(d.files);
      })
      .catch(() => {});
  }, []);

  const handleSaveGithubRepo = async (repoValue: string) => {
    setSavingGithubRepo(true);
    setGithubRepoFeedback(null);
    try {
      const res = await apiFetch('/api/installers/github-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: repoValue.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; catalog?: CatalogResponse };
      if (!res.ok) {
        setGithubRepoFeedback(data.error || 'Falha ao vincular repositório GitHub.');
        return;
      }
      if (data.catalog) {
        setCatalog(data.catalog);
        setGithubRepoInput(data.catalog.githubSync?.repo || '');
        setGithubRepoFeedback(data.catalog.githubSync?.message || 'Repositório sincronizado.');
      }
    } catch (err: unknown) {
      setGithubRepoFeedback(err instanceof Error ? err.message : 'Erro de rede ao salvar repositório.');
    } finally {
      setSavingGithubRepo(false);
    }
  };

  const copyText = (key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const checkLocalDaemon = async () => {
    setDaemonCheck({ state: 'checking' });
    const health = await probeLocalDaemon();
    if (health.online) {
      const syncInfo = health.googleConnected
        ? `Google sincronizado (${health.googleEmail || 'ativo'}) · Pasta: ${health.syncDir || '~/AegisGoogleSync'}`
        : `Google ainda não sincronizado · Pasta: ${health.syncDir || '~/AegisGoogleSync'}`;
      setDaemonCheck({
        state: 'online',
        detail: `Aegis Local v${health.version || '2.1'} ativo em ${health.host || 'localhost'} (${health.platform || 'OS'} · :3847) — ${syncInfo}. Use o botão "Nuvem / Local" no topo da HUD para operar localmente.`,
      });
    } else {
      setDaemonCheck({
        state: 'offline',
        detail: 'Aplicativo nativo local (127.0.0.1:3847) não detectado nesta máquina ainda. Instale o pacote do seu sistema abaixo.',
      });
    }
  };

  const handleGenerateAndroidPairCode = async () => {
    setGeneratingAndroidCode(true);
    try {
      const res = await apiFetch('/api/devices/pairing-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: androidLabel.trim() || 'Meu Android',
          platform: 'android',
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { code: string };
        setAndroidPairCode(data.code);
      }
    } finally {
      setGeneratingAndroidCode(false);
    }
  };

  const visibleArtifacts = useMemo(() => {
    if (!catalog) return [];
    return catalog.artifacts.filter((a) => a.os === osTab);
  }, [catalog, osTab]);

  const activeFile = files.find((f) => f.name === selectedName) || files[0];
  const ghSync = catalog?.githubSync;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#070B12]">
      {/* Header */}
      <div className="border-b border-amber-500/18 bg-[#0A0F18] px-5 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-100">
            Aplicativos Nativos do Sistema Operacional
          </h2>
          <p className="text-xs text-slate-400">
            Instaladores reais para Linux (<code className="text-amber-300">.deb</code> + binário ELF), Windows (<code className="text-sky-300">AegisDesktop.exe</code>) e Android (<code className="text-emerald-300">Kotlin / .APK</code>) — aplicativos do próprio sistema, não webapps.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void checkLocalDaemon()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/12 px-3.5 py-2 text-xs font-medium text-amber-200 hover:bg-amber-500/20 transition-colors cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${daemonCheck.state === 'checking' ? 'animate-spin' : ''}`} />
            <span>Detectar App Local</span>
          </button>
          <button
            type="button"
            onClick={() => setShowInspector((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/12 bg-[#141B29] px-3.5 py-2 text-xs font-medium text-slate-300 hover:border-amber-500/40 transition-colors cursor-pointer"
          >
            <FileCode2 className="h-3.5 w-3.5 text-amber-400" />
            <span>{showInspector ? 'Ocultar Código-Fonte' : 'Auditar Código-Fonte'}</span>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
        {daemonCheck.state !== 'idle' && (
          <div
            className={`rounded-xl border px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-3 ${
              daemonCheck.state === 'online'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'border-amber-500/35 bg-amber-500/8 text-amber-200'
            }`}
          >
            <span>{daemonCheck.detail}</span>
            {daemonCheck.state === 'online' && (
              <a
                href="http://127.0.0.1:3847"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-emerald-500 px-3 py-1.5 font-semibold text-slate-950 hover:bg-emerald-400 shrink-0"
              >
                Abrir App Local (3847)
              </a>
            )}
          </div>
        )}

        {/* GitHub Releases Auto-Link Panel */}
        <div className="rounded-2xl border border-sky-500/25 bg-[#0A111D] p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <GitBranch className="h-4 w-4 text-sky-400 shrink-0" />
                <span className="font-display text-sm font-semibold text-slate-100">
                  Compilação Automática & Releases do GitHub (.APK / .EXE / .AppImage)
                </span>
                {ghSync?.status === 'linked' && ghSync.syncedAssetsCount > 0 && (
                  <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-300 border border-emerald-500/35 bg-emerald-500/12 px-2 py-0.5 rounded">
                    {ghSync.releaseTag} · {ghSync.syncedAssetsCount} binário(s) vinculado(s)
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Linux (<code className="text-amber-300">.deb</code> / ELF) já é compilado diretamente neste servidor. Para vincular o <strong className="text-slate-200">.APK Android</strong> e o <strong className="text-slate-200">.EXE Windows</strong> compilados pelo workflow <code className="text-sky-300">.github/workflows/release-all-apps.yml</code> diretamente aos botões abaixo, informe seu repositório GitHub:
              </p>
            </div>
            {ghSync?.releaseUrl && (
              <a
                href={ghSync.releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-[11px] font-medium text-sky-200 hover:bg-sky-500/20 shrink-0"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Abrir no GitHub</span>
              </a>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={githubRepoInput}
              onChange={(e) => setGithubRepoInput(e.target.value)}
              placeholder="usuario/repositorio ou https://github.com/usuario/repositorio"
              className="flex-1 min-w-[240px] rounded-xl border border-white/12 bg-[#060910] px-3.5 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
            />
            <button
              type="button"
              disabled={savingGithubRepo}
              onClick={() => void handleSaveGithubRepo(githubRepoInput)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 cursor-pointer"
            >
              {savingGithubRepo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              <span>Vincular & Sincronizar</span>
            </button>
            {ghSync?.repo && (
              <button
                type="button"
                disabled={catalogLoading}
                onClick={() => void loadCatalog(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/12 bg-[#141B29] px-3 py-2 text-xs font-medium text-slate-200 hover:border-sky-400/50 cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${catalogLoading ? 'animate-spin' : ''}`} />
                <span>Atualizar</span>
              </button>
            )}
          </div>

          {(githubRepoFeedback || ghSync?.message) && (
            <p
              className={`text-[11px] leading-relaxed ${
                ghSync?.status === 'linked' && ghSync.syncedAssetsCount > 0
                  ? 'text-emerald-300'
                  : ghSync?.status === 'error'
                  ? 'text-rose-300'
                  : 'text-slate-400'
              }`}
            >
              {githubRepoFeedback || ghSync?.message}
            </p>
          )}
        </div>

        {/* OS Platform Tabs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(
            [
              {
                id: 'linux',
                label: 'Linux Nativo',
                detail: 'Pacote .deb + ELF x86_64 + systemd',
                icon: Terminal,
              },
              {
                id: 'windows',
                label: 'Windows 10 / 11',
                detail: 'AegisDesktop.exe (C# WinForms + Bandeja)',
                icon: Monitor,
              },
              {
                id: 'android',
                label: 'Android Nativo',
                detail: 'App Kotlin (.apk) + AccessibilityService',
                icon: Smartphone,
              },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = osTab === tab.id;
            const hasCompiled = catalog?.artifacts.some((a) => a.os === tab.id && a.compiledOnServer);
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setOsTab(tab.id)}
                className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition-all cursor-pointer ${
                  active
                    ? 'border-amber-400/70 bg-amber-500/14 shadow-[0_0_24px_rgba(245,158,11,0.12)]'
                    : 'border-white/10 bg-[#0C1220] hover:border-amber-500/35'
                }`}
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                    active
                      ? 'border-amber-400/50 bg-amber-500/20 text-amber-300'
                      : 'border-white/10 bg-[#070B12] text-slate-400'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-display text-sm font-semibold ${active ? 'text-amber-100' : 'text-slate-200'}`}>
                      {tab.label}
                    </span>
                    {hasCompiled && (
                      <span className="font-mono text-[9px] uppercase text-emerald-300">
                        Compilado
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">{tab.detail}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Android Optional Pre-Pairing Bar */}
        {osTab === 'android' && (
          <div className="rounded-2xl border border-emerald-500/28 bg-[#0A1318] p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-emerald-300">
                  Pré-configurar Código de Pareamento dentro do App Android (opcional)
                </p>
                <p className="text-[11px] text-slate-400">
                  Gere um código de 6 dígitos antes de baixar o projeto Android: ele já vem gravado em <code className="text-slate-200">AegisConfig.kt</code> junto com a URL deste servidor (ou digite o código ao abrir o <code className="text-slate-200">.APK</code>).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={androidLabel}
                  onChange={(e) => setAndroidLabel(e.target.value)}
                  placeholder="Nome do aparelho"
                  className="rounded-xl border border-white/12 bg-[#060B11] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={generatingAndroidCode}
                  onClick={() => void handleGenerateAndroidPairCode()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 cursor-pointer"
                >
                  {generatingAndroidCode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  <span>Gerar & Embutir Código</span>
                </button>
              </div>
            </div>
            {androidPairCode && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/12 px-3.5 py-2 text-xs">
                <span className="text-emerald-200">
                  Código <strong className="font-mono text-white tracking-widest">{androidPairCode}</strong> pronto para uso no app Android!
                </span>
                <button
                  type="button"
                  onClick={() => copyText('android-code', androidPairCode)}
                  className="inline-flex items-center gap-1 text-emerald-200 hover:text-white cursor-pointer"
                >
                  {copiedKey === 'android-code' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedKey === 'android-code' ? 'Copiado' : 'Copiar'}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Loading / Error State */}
        {catalogLoading ? (
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#0B101C] p-6 text-xs text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
            <span>Compilando binário ELF nativo Linux e verificando pacotes assinados (SHA-256)...</span>
          </div>
        ) : catalogError ? (
          <div className="rounded-2xl border border-rose-500/35 bg-rose-500/10 p-5 text-xs text-rose-200 flex items-center justify-between gap-3">
            <span>{catalogError}</span>
            <button
              type="button"
              onClick={() => void loadCatalog(true)}
              className="rounded-lg bg-rose-500 px-3 py-1.5 font-semibold text-slate-950 cursor-pointer"
            >
              Tentar novamente
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleArtifacts.map((art, index) => {
              const isExternal = /^https?:\/\//i.test(art.downloadUrl);
              const downloadHref =
                !isExternal && art.os === 'android' && androidPairCode
                  ? `${art.downloadUrl}?code=${encodeURIComponent(androidPairCode)}`
                  : art.downloadUrl;
              const isPrimary = index === 0;
              const stepsText = art.installSteps.join('\n');

              return (
                <div
                  key={art.id}
                  className={`rounded-2xl border p-5 space-y-4 ${
                    isPrimary
                      ? 'border-amber-500/40 bg-[#0B111E]'
                      : 'border-white/10 bg-[#0A0F1A]'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Package className="h-4 w-4 text-amber-400 shrink-0" />
                        <h3 className="font-display text-sm sm:text-base font-semibold text-slate-100">
                          {art.title}
                        </h3>
                        {art.source === 'github_release' ? (
                          <span className="font-mono text-[10px] uppercase tracking-wider text-sky-300 border border-sky-500/40 bg-sky-500/12 px-2 py-0.5 rounded">
                            Binário Compilado · GitHub Release
                          </span>
                        ) : art.compiledOnServer ? (
                          <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-300 border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 rounded">
                            Compilado no Servidor
                          </span>
                        ) : (
                          <span className="font-mono text-[10px] uppercase tracking-wider text-amber-300 border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 rounded">
                            Kit Nativo Pronto p/ Build
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">{art.subtitle}</p>
                    </div>

                    <a
                      href={downloadHref}
                      download={isExternal ? undefined : art.filename}
                      target={isExternal ? '_blank' : undefined}
                      rel={isExternal ? 'noopener noreferrer' : undefined}
                      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        isPrimary
                          ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                          : 'border border-amber-500/40 bg-amber-500/12 text-amber-200 hover:bg-amber-500/22'
                      }`}
                    >
                      <Download className="h-4 w-4" />
                      <span>Baixar {art.filename}</span>
                    </a>
                  </div>

                  {/* Verified Technical Specs */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px] font-mono">
                    <div className="rounded-xl border border-white/8 bg-[#060910] px-3 py-2">
                      <span className="text-slate-500 block">Formato / Arquitetura</span>
                      <span className="text-slate-200">{art.format} · {art.architecture}</span>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-[#060910] px-3 py-2">
                      <span className="text-slate-500 block">Tamanho Verificado</span>
                      <span className="text-amber-300">{formatBytes(art.sizeBytes)}</span>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-[#060910] px-3 py-2">
                      <span className="text-slate-500 block">
                        {art.source === 'github_release' ? 'Release' : 'SHA-256'}
                      </span>
                      <span className="text-slate-300 truncate block" title={art.sha256 || art.releaseTag || ''}>
                        {art.sha256
                          ? `${art.sha256.slice(0, 18)}…`
                          : art.releaseTag
                          ? `${art.releaseTag} (GitHub)`
                          : 'Gerado sob demanda'}
                      </span>
                    </div>
                  </div>

                  {/* Capabilities & Steps */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 block">
                        Recursos Nativos do Sistema Operacional
                      </span>
                      <ul className="space-y-1.5 text-xs text-slate-300">
                        {art.capabilities.map((cap, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                            <span>{cap}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                          Como Instalar
                        </span>
                        <button
                          type="button"
                          onClick={() => copyText(art.id, stepsText)}
                          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-amber-300 cursor-pointer"
                        >
                          {copiedKey === art.id ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                          <span>{copiedKey === art.id ? 'Copiado' : 'Copiar comandos'}</span>
                        </button>
                      </div>
                      <div className="rounded-xl border border-white/8 bg-[#060910] p-3 font-mono text-[11px] text-slate-200 space-y-1">
                        {art.installSteps.map((st, idx) => (
                          <div key={idx} className="leading-relaxed">
                            <span className="text-amber-400/80 select-none">{idx + 1}. </span>
                            <span>{st}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Architectural Guarantees */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-white/10 bg-[#0B101C] p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
              <Cpu className="h-4 w-4" />
              <span>Aplicativos Nativos Reais</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Linux recebe pacote <code className="text-slate-200">.deb</code> real com binário C ELF; Windows compila <code className="text-slate-200">AegisDesktop.exe</code> nativo na bandeja; Android traz app Kotlin completo com serviços de sistema.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0B101C] p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
              <ShieldCheck className="h-4 w-4" />
              <span>Autonomia + Proteção Destrutiva</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Os aplicativos locais acessam arquivos, aplicativos e ponte ADB livremente, pedindo confirmação explícita apenas em operações destrutivas.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0B101C] p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-sky-300">
              <HardDrive className="h-4 w-4" />
              <span>Visibilidade Unificada em Malha</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Depois de instalados, Linux, Windows e Android sincronizam telemetria, arquivos e ações diretamente com o Orquestrador Aegis na nuvem ou localmente.
            </p>
          </div>
        </div>

        {/* Optional Runtime Source Inspector */}
        {showInspector && files.length > 0 && (
          <div className="rounded-2xl border border-white/10 overflow-hidden grid grid-cols-1 lg:grid-cols-12 bg-[#090D16]">
            <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-white/8 divide-y divide-white/6">
              {files.map((file) => (
                <button
                  key={file.name}
                  type="button"
                  onClick={() => setSelectedName(file.name)}
                  className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                    activeFile?.name === file.name ? 'bg-amber-500/12' : 'hover:bg-white/4'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Laptop className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <span className="font-mono text-xs font-medium text-slate-100">{file.name}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 leading-snug">{file.description}</p>
                </button>
              ))}
            </div>

            <div className="lg:col-span-8 flex flex-col bg-[#060910]">
              {activeFile && (
                <>
                  <div className="flex items-center justify-between border-b border-white/8 px-4 py-2.5 bg-[#0C111C]">
                    <span className="font-mono text-xs text-slate-300">{activeFile.pathInPackage}</span>
                    <button
                      type="button"
                      onClick={() => copyText(activeFile.name, activeFile.content)}
                      className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-amber-200 transition-colors cursor-pointer"
                    >
                      {copiedKey === activeFile.name ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      <span>{copiedKey === activeFile.name ? 'Copiado' : 'Copiar código'}</span>
                    </button>
                  </div>
                  <pre className="p-4 font-mono text-xs text-slate-300 overflow-auto max-h-[380px] leading-relaxed">
                    {activeFile.content}
                  </pre>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
