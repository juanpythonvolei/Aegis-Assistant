import {
  Calendar,
  CheckCircle2,
  Cloud,
  Download,
  FolderSync,
  HardDrive,
  Laptop,
  ListTodo,
  Loader2,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import {
  getLocalDaemonUrl,
  loginLocalOperator,
  logoutLocalOperator,
  setLocalDaemonUrl,
  setupLocalOperator,
  type ExecutionMode,
  type LocalAuthStatus,
  type LocalDaemonHealth,
  type LocalGoogleSyncStatus,
} from '../lib/localEngine';

interface LocalOperationPopoverProps {
  open: boolean;
  executionMode: ExecutionMode;
  health: LocalDaemonHealth;
  authStatus: LocalAuthStatus | null;
  syncStatus: LocalGoogleSyncStatus | null;
  probing: boolean;
  syncingGoogle: boolean;
  syncFeedback: string | null;
  googleConnectedInWeb: boolean;
  googleEmail?: string | null;
  loggingInGoogle: boolean;
  onClose: () => void;
  onChangeMode: (mode: ExecutionMode) => void;
  onProbe: (customUrl?: string) => Promise<void>;
  onLocalAuthenticated: () => Promise<void>;
  onSyncGoogleNow: () => Promise<void>;
  onGoogleLogin: () => Promise<void>;
  onOpenNativeInstallers: () => void;
}

export const LocalOperationPopover: React.FC<LocalOperationPopoverProps> = ({
  open,
  executionMode,
  health,
  authStatus,
  syncStatus,
  probing,
  syncingGoogle,
  syncFeedback,
  googleConnectedInWeb,
  googleEmail,
  loggingInGoogle,
  onClose,
  onChangeMode,
  onProbe,
  onLocalAuthenticated,
  onSyncGoogleNow,
  onGoogleLogin,
  onOpenNativeInstallers,
}) => {
  const [urlInput, setUrlInput] = useState(getLocalDaemonUrl());
  const [urlError, setUrlError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authErr, setAuthErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUrlInput(getLocalDaemonUrl());
      setUrlError(null);
      setAuthErr(null);
    }
  }, [open]);

  if (!open) return null;

  const isLocalReady = health.online && Boolean(authStatus?.authenticated);

  const handleApplyUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setUrlError(null);
    try {
      const normalized = setLocalDaemonUrl(urlInput);
      setUrlInput(normalized);
      await onProbe(normalized);
    } catch (err: unknown) {
      setUrlError(err instanceof Error ? err.message : 'Endereço inválido.');
    }
  };

  const handleLocalAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setAuthBusy(true);
    setAuthErr(null);
    try {
      if (authStatus?.needsSetup) {
        await setupLocalOperator(username, password);
      } else {
        await loginLocalOperator(username, password);
      }
      setPassword('');
      await onLocalAuthenticated();
    } catch (err: unknown) {
      setAuthErr(err instanceof Error ? err.message : 'Erro na autenticação local.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLocalLogout = async () => {
    await logoutLocalOperator();
    onChangeMode('cloud');
    await onProbe();
  };

  return (
    <div
      className="fixed top-16 right-4 sm:right-6 z-50 w-[calc(100vw-2rem)] max-w-[400px] rounded-2xl border border-amber-500/35 bg-[#090E18]/98 shadow-[0_24px_70px_-15px_rgba(0,0,0,0.88)] overflow-hidden select-text"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#0D1322] px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Laptop className="h-4 w-4 text-amber-400 shrink-0" />
          <div className="min-w-0">
            <h3 className="font-display text-xs font-semibold text-slate-100 truncate">
              Operação Local &amp; Sync Google
            </h3>
            <p className="text-[10px] font-mono text-slate-400 truncate">
              {health.online
                ? `${health.host || 'localhost'} · ${health.platform || 'OS'} · v${health.version || '2.1'}`
                : 'Daemon local (127.0.0.1:3847) não detectado'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-slate-400 hover:bg-white/8 hover:text-white cursor-pointer"
          aria-label="Fechar painel local"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-4 space-y-4 max-h-[calc(100vh-7rem)] overflow-y-auto">
        {/* Execution Mode Switcher */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Onde o Aegis executa suas diretrizes
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onChangeMode('cloud')}
              className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium transition-all cursor-pointer ${
                executionMode === 'cloud'
                  ? 'border-amber-400/70 bg-amber-500/18 text-amber-100'
                  : 'border-white/10 bg-[#0E1422] text-slate-400 hover:border-white/20 hover:text-slate-200'
              }`}
            >
              <Cloud className="h-3.5 w-3.5" />
              <span>Nuvem</span>
            </button>
            <button
              type="button"
              disabled={!isLocalReady}
              onClick={() => onChangeMode('local')}
              title={
                isLocalReady
                  ? 'Executar orquestração diretamente no seu computador'
                  : 'Conecte e autentique o daemon local abaixo primeiro'
              }
              className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium transition-all ${
                executionMode === 'local'
                  ? 'border-emerald-400/75 bg-emerald-500/18 text-emerald-100 cursor-pointer'
                  : isLocalReady
                  ? 'border-white/10 bg-[#0E1422] text-slate-300 hover:border-emerald-500/45 hover:text-emerald-200 cursor-pointer'
                  : 'border-white/8 bg-[#0B0F19] text-slate-600 cursor-not-allowed'
              }`}
            >
              <Laptop className="h-3.5 w-3.5" />
              <span>Local (PC)</span>
            </button>
          </div>
        </div>

        {/* Loopback Address & Detection */}
        <form onSubmit={handleApplyUrl} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="aegis-local-url"
              className="text-[10px] font-mono uppercase tracking-wider text-slate-400"
            >
              Endereço Loopback do Daemon
            </label>
            <span
              className={`text-[10px] font-mono ${
                health.online ? 'text-emerald-400' : 'text-amber-400/80'
              }`}
            >
              {probing ? 'Verificando...' : health.online ? 'Online' : 'Offline'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="aegis-local-url"
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="http://127.0.0.1:3847"
              className="flex-1 rounded-xl border border-white/12 bg-[#060A12] px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={probing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/12 bg-[#121A2B] px-3 py-2 text-xs font-medium text-slate-200 hover:border-amber-400/60 hover:text-amber-200 disabled:opacity-50 cursor-pointer shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${probing ? 'animate-spin' : ''}`} />
              <span>Detectar</span>
            </button>
          </div>
          {urlError && <p className="text-[11px] text-rose-300">{urlError}</p>}
        </form>

        {/* Local Daemon Offline CTA */}
        {!health.online && (
          <div className="rounded-xl border border-amber-500/28 bg-amber-500/8 p-3.5 space-y-2.5">
            <p className="text-xs text-amber-100 leading-relaxed">
              Para operar o Aegis diretamente no seu computador com acesso completo a arquivos, terminal e
              sincronização Google offline, instale o aplicativo nativo (Linux <code className="text-amber-300">.deb</code> ou Windows <code className="text-sky-300">.exe</code>).
            </p>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenNativeInstallers();
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Baixar App Nativo (Linux · Windows)</span>
            </button>
          </div>
        )}

        {/* Local Operator Auth Form (when daemon is online but locked) */}
        {health.online && !authStatus?.authenticated && (
          <form
            onSubmit={handleLocalAuthSubmit}
            className="rounded-xl border border-white/12 bg-[#0D1322] p-3.5 space-y-2.5"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-amber-200">
              <Lock className="h-3.5 w-3.5 text-amber-400" />
              <span>
                {authStatus?.needsSetup
                  ? 'Criar operador do Aegis Local'
                  : 'Desbloquear Aegis Local nesta máquina'}
              </span>
            </div>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={authStatus?.username || 'Usuário local'}
              autoComplete="username"
              className="w-full rounded-lg border border-white/10 bg-[#060A12] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Senha local"
              autoComplete={authStatus?.needsSetup ? 'new-password' : 'current-password'}
              className="w-full rounded-lg border border-white/10 bg-[#060A12] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
            />
            {authErr && <p className="text-[11px] text-rose-300">{authErr}</p>}
            <button
              type="submit"
              disabled={authBusy || !username.trim() || !password}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 cursor-pointer"
            >
              {authBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              <span>{authStatus?.needsSetup ? 'Criar & Conectar Local' : 'Entrar no Aegis Local'}</span>
            </button>
          </form>
        )}

        {/* Authenticated Local Status + Google Workspace Sync Section */}
        {isLocalReady && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-3 py-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span className="text-emerald-200 truncate">
                  Operador: <strong className="font-mono">{authStatus?.username || 'local'}</strong>
                </span>
              </div>
              <button
                type="button"
                onClick={() => void handleLocalLogout()}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-300 cursor-pointer shrink-0"
                title="Encerrar sessão local"
              >
                <LogOut className="h-3 w-3" />
                <span>Sair</span>
              </button>
            </div>

            {!health.hasApiKey && (
              <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                Defina <code className="font-mono text-amber-100">GEMINI_API_KEY</code> no arquivo{' '}
                <code className="font-mono text-amber-100">~/.config/aegis/aegis.env</code> para raciocínio IA 100% local.
              </div>
            )}

            {/* Google Workspace ↔ Local Sync Card */}
            <div className="rounded-xl border border-white/10 bg-[#0D1322] p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FolderSync className="h-4 w-4 text-sky-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-100 truncate">
                      Sincronização Google ↔ Local
                    </p>
                    <p className="text-[10px] font-mono text-slate-400 truncate">
                      {syncStatus?.email || health.googleEmail || googleEmail || 'Conta Google não vinculada'}
                    </p>
                  </div>
                </div>
                {(syncStatus?.connected || health.googleConnected) && (
                  <span className="text-[10px] font-mono text-emerald-400 shrink-0">Vinculado</span>
                )}
              </div>

              {!googleConnectedInWeb ? (
                <button
                  type="button"
                  disabled={loggingInGoogle}
                  onClick={() => void onGoogleLogin()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-sky-500/45 bg-sky-500/15 px-3 py-2 text-xs font-medium text-sky-200 hover:bg-sky-500/25 disabled:opacity-50 cursor-pointer"
                >
                  {loggingInGoogle ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
                  <span>Conectar Conta Google para Sincronizar</span>
                </button>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-1.5 text-center">
                    <div className="rounded-lg border border-white/8 bg-[#070B13] py-2 px-1">
                      <HardDrive className="h-3 w-3 text-amber-400 mx-auto mb-1" />
                      <div className="font-mono text-xs font-semibold text-slate-100 tabular-nums">
                        {syncStatus?.counts.drive ?? 0}
                      </div>
                      <div className="text-[9px] text-slate-500">Drive</div>
                    </div>
                    <div className="rounded-lg border border-white/8 bg-[#070B13] py-2 px-1">
                      <Mail className="h-3 w-3 text-rose-400 mx-auto mb-1" />
                      <div className="font-mono text-xs font-semibold text-slate-100 tabular-nums">
                        {syncStatus?.counts.gmail ?? 0}
                      </div>
                      <div className="text-[9px] text-slate-500">Gmail</div>
                    </div>
                    <div className="rounded-lg border border-white/8 bg-[#070B13] py-2 px-1">
                      <Calendar className="h-3 w-3 text-sky-400 mx-auto mb-1" />
                      <div className="font-mono text-xs font-semibold text-slate-100 tabular-nums">
                        {syncStatus?.counts.calendar ?? 0}
                      </div>
                      <div className="text-[9px] text-slate-500">Agenda</div>
                    </div>
                    <div className="rounded-lg border border-white/8 bg-[#070B13] py-2 px-1">
                      <ListTodo className="h-3 w-3 text-emerald-400 mx-auto mb-1" />
                      <div className="font-mono text-xs font-semibold text-slate-100 tabular-nums">
                        {syncStatus?.counts.tasks ?? 0}
                      </div>
                      <div className="text-[9px] text-slate-500">Tarefas</div>
                    </div>
                  </div>

                  <div className="text-[10px] font-mono text-slate-400 space-y-0.5">
                    <div className="truncate">
                      Pasta local: <span className="text-slate-200">{syncStatus?.syncDir || health.syncDir || '~/AegisGoogleSync'}</span>
                    </div>
                    {syncStatus?.lastSyncAt && (
                      <div>
                        Última sync:{' '}
                        <span className="text-slate-200">
                          {new Date(syncStatus.lastSyncAt).toLocaleString('pt-BR')}
                        </span>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={syncingGoogle}
                    onClick={() => void onSyncGoogleNow()}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 cursor-pointer"
                  >
                    {syncingGoogle ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FolderSync className="h-3.5 w-3.5" />
                    )}
                    <span>Sincronizar Google + Memória → Local</span>
                  </button>
                </>
              )}

              {syncFeedback && (
                <p className="text-[11px] text-emerald-300 leading-snug">{syncFeedback}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
