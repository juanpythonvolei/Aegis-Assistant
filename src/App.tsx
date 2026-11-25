import type { User } from 'firebase/auth';
import {
  ArrowDownRight,
  ArrowUpRight,
  Brain,
  Camera,
  CameraOff,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cloud,
  Code2,
  GitBranch,
  Laptop,
  Layers,
  Loader2,
  Menu,
  MessageSquare,
  Mic,
  MicOff,
  Network,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CommandView } from './components/CommandView';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { DevicesMeshView } from './components/DevicesMeshView';
import { HolographicScreenDeck } from './components/HolographicScreenDeck';
import { JarvisHologramCore } from './components/JarvisHologramCore';
import { LocalOperationPopover } from './components/LocalOperationPopover';
import { LoginScreen } from './components/LoginScreen';
import { MemoryView } from './components/MemoryView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OrchestratorEvolutionView } from './components/OrchestratorEvolutionView';
import { SettingsView, type SettingsTabId } from './components/SettingsView';
import {
  SPATIAL_MODULES,
  SpatialMenuDrawer,
  type SpatialModuleId,
} from './components/SpatialMenuDrawer';
import { TerminalView } from './components/TerminalView';
import { ThinkingActivityPanel } from './components/ThinkingActivityPanel';
import { WebAutomationView } from './components/WebAutomationView';
import { useAegisLive } from './hooks/useAegisLive';
import { apiFetch, setAegisSessionToken } from './lib/apiClient';
import {
  formatModelShortName,
  formatTierLabel,
  streamAssistantTurn,
} from './lib/assistantStream';
import { getAccessToken, googleSignIn, initAuth, logout } from './lib/firebaseAuth';
import {
  confirmLocalAction,
  DEFAULT_LOCAL_DAEMON_URL,
  getLocalAuthStatus,
  getLocalGoogleSyncStatus,
  probeLocalDaemon,
  runLocalAssistantTurn,
  syncGoogleToLocalDaemon,
  syncMemoryFactsToLocal,
  type ExecutionMode,
  type LocalAuthStatus,
  type LocalDaemonHealth,
  type LocalGoogleSyncStatus,
} from './lib/localEngine';
import type {
  AegisCoreState,
  AegisUser,
  BackgroundJobItem,
  ChatMessage,
  ConfirmationModalRequest,
  HolographicScreenSpec,
  LiveModelRoutingState,
  ModelPreference,
  PendingConfirmation,
  ThinkingTraceEntry,
  TurnUsageStats,
} from './types';

const STATE_LABELS: Record<AegisCoreState, string> = {
  idle: 'Núcleo em Prontidão',
  listening: 'Escutando em Tempo Real',
  thinking: 'Processando Diretriz',
  speaking: 'Transmitindo Voz',
  seeing: 'Visão Óptica Ativa',
};

const QUICK_DIRECTIVES = [
  'Orquestre um diagnóstico local e projete uma tela holográfica executiva',
  'Crie uma nova função no seu próprio código para calcular métricas de um CSV',
  'Olhe pela minha câmera e descreva o que você vê',
];

export default function App() {
  // Hidden menus & spatial module overlay state
  const [menuDrawerOpen, setMenuDrawerOpen] = useState(false);
  const [activeModule, setActiveModule] = useState<SpatialModuleId | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('models');

  // Unified hybrid conversation state (Voice Live + Text Chat)
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [textBusy, setTextBusy] = useState(false);
  const [floatingReply, setFloatingReply] = useState<{
    role: 'user' | 'assistant';
    text: string;
    model?: string;
  } | null>(null);

  // Floating holographic screens drawn by Aegis
  const [drawnScreens, setDrawnScreens] = useState<HolographicScreenSpec[]>([]);
  const [activeScreenId, setActiveScreenId] = useState<string | null>(null);
  const [screensMinimized, setScreensMinimized] = useState(false);

  // Confirmations, AI routing & live thinking activity inspector
  const [confirmRequest, setConfirmRequest] = useState<ConfirmationModalRequest | null>(null);
  const [modelPreference, setModelPreference] = useState<ModelPreference>('auto');
  const [routingState, setRoutingState] = useState<LiveModelRoutingState>({
    phase: 'idle',
    activeModel: 'auto',
    tier: 'lite',
    routingMode: 'auto',
  });
  const [thinkingTrace, setThinkingTrace] = useState<ThinkingTraceEntry[]>([]);
  const [thinkingPanelOpen, setThinkingPanelOpen] = useState(false);
  const [lastTurnUsage, setLastTurnUsage] = useState<TurnUsageStats | null>(null);

  // Non-blocking background execution queue ("Segundo Plano")
  const [backgroundJobs, setBackgroundJobs] = useState<BackgroundJobItem[]>([]);
  const [bgJobsOpen, setBgJobsOpen] = useState(false);
  const announcedJobIdsRef = useRef<Set<string>>(new Set());

  // App Operator Session & Auth Gate
  const [authLoading, setAuthLoading] = useState(true);
  const [aegisUser, setAegisUser] = useState<AegisUser | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [sessionTokens, setSessionTokens] = useState(0);
  const [sessionRequests, setSessionRequests] = useState(0);

  // Firebase Auth & Google Workspace in-memory token state
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Local Operation Mode & Google ↔ Local Sync state
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('cloud');
  const [localPopoverOpen, setLocalPopoverOpen] = useState(false);
  const [localHealth, setLocalHealth] = useState<LocalDaemonHealth>({
    online: false,
    url: DEFAULT_LOCAL_DAEMON_URL,
  });
  const [localAuthStatus, setLocalAuthStatus] = useState<LocalAuthStatus | null>(null);
  const [localSyncStatus, setLocalSyncStatus] = useState<LocalGoogleSyncStatus | null>(null);
  const [probingLocal, setProbingLocal] = useState(false);
  const [syncingLocalGoogle, setSyncingLocalGoogle] = useState(false);
  const [localSyncFeedback, setLocalSyncFeedback] = useState<string | null>(null);
  const lastAutoSyncedTokenRef = useRef<string | null>(null);

  // Camera preview video element
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const refreshAuthAndUsage = useCallback(async () => {
    try {
      const meRes = await apiFetch('/api/auth/me');
      if (meRes.ok) {
        const me = await meRes.json();
        setAegisUser(me.authenticated ? me.user : null);
        setNeedsSetup(Boolean(me.needsSetup));
        if (me.authenticated) {
          const uRes = await apiFetch('/api/usage');
          if (uRes.ok) {
            const u = await uRes.json();
            setSessionTokens(u.totals?.totalTokens ?? 0);
            setSessionRequests(u.totals?.requests ?? 0);
          }
        }
      }
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const pushDrawnScreens = useCallback((incoming: HolographicScreenSpec[]) => {
    if (!incoming || incoming.length === 0) return;
    setDrawnScreens((prev) => [...prev, ...incoming]);
    setActiveScreenId(incoming[incoming.length - 1].id);
    setScreensMinimized(false);
    setActiveModule(null); // Return focus over the 3D core where drawn screens float
  }, []);

  const handleProbeLocal = useCallback(async (customUrl?: string) => {
    setProbingLocal(true);
    try {
      const health = await probeLocalDaemon(customUrl);
      setLocalHealth(health);
      if (health.online) {
        try {
          const authSt = await getLocalAuthStatus();
          setLocalAuthStatus(authSt);
          if (authSt.authenticated) {
            try {
              const gSt = await getLocalGoogleSyncStatus();
              setLocalSyncStatus(gSt);
            } catch {
              // ignore if sync status not yet populated
            }
          } else {
            setLocalSyncStatus(null);
            setExecutionMode((prev) => (prev === 'local' ? 'cloud' : prev));
          }
        } catch {
          setLocalAuthStatus(null);
        }
      } else {
        setLocalAuthStatus(null);
        setLocalSyncStatus(null);
        setExecutionMode((prev) => (prev === 'local' ? 'cloud' : prev));
      }
    } finally {
      setProbingLocal(false);
    }
  }, []);

  const handleSyncGoogleToLocal = useCallback(
    async (tokenOverride?: string, emailOverride?: string) => {
      const tok = tokenOverride || accessToken;
      const email = emailOverride || googleUser?.email || aegisUser?.email;
      if (!tok) {
        setLocalSyncFeedback('Conecte sua conta Google primeiro para sincronizar.');
        return;
      }
      setSyncingLocalGoogle(true);
      setLocalSyncFeedback(null);
      try {
        const gStatus = await syncGoogleToLocalDaemon(tok, email);
        setLocalSyncStatus(gStatus);

        let memNote = '';
        try {
          const memRes = await apiFetch('/api/memory');
          if (memRes.ok) {
            const memData = await memRes.json();
            const rawFacts = Array.isArray(memData.facts) ? memData.facts : [];
            if (rawFacts.length > 0) {
              const mSync = await syncMemoryFactsToLocal(rawFacts);
              memNote = ` · ${mSync.totalLocalFacts} memórias sincronizadas`;
            }
          }
        } catch {
          // memory sync is best-effort
        }

        setLocalSyncFeedback(
          `Sincronizado: ${gStatus.counts.drive} Drive, ${gStatus.counts.gmail} Gmail, ${gStatus.counts.calendar} Agenda, ${gStatus.counts.tasks} Tarefas${memNote}.`
        );
        const h = await probeLocalDaemon();
        setLocalHealth(h);
      } catch (err: unknown) {
        setLocalSyncFeedback(
          err instanceof Error ? err.message : 'Falha na sincronização Google → Local.'
        );
      } finally {
        setSyncingLocalGoogle(false);
      }
    },
    [accessToken, googleUser?.email, aegisUser?.email]
  );

  const openPendingConfirmation = useCallback(
    (pending: PendingConfirmation) => {
      const isLocalAction =
        pending.action_type === 'local_daemon_command' ||
        pending.action_type === 'local_google_upload';

      setConfirmRequest({
        id: pending.id,
        title: isLocalAction ? 'Confirmação de Ação Local' : 'Confirmação de Ação Crítica',
        summary: pending.summary,
        actionType: pending.action_type,
        target: pending.target,
        details: pending.payload_json,
        onConfirm: async () => {
          if (isLocalAction) {
            const res = await confirmLocalAction({
              payloadJson: pending.payload_json,
              googleToken: accessToken,
            });
            const summaryMsg = [
              res.summary,
              res.stdout ? `Saída padrão (stdout):\n${res.stdout}` : '',
              res.stderr ? `Erros (stderr):\n${res.stderr}` : '',
            ]
              .filter(Boolean)
              .join('\n\n');
            setMessages((prev) => [
              ...prev,
              {
                id: `conf-local-${Date.now()}`,
                role: 'assistant',
                content: summaryMsg,
                timestamp: new Date().toISOString(),
              },
            ]);
            setFloatingReply({ role: 'assistant', text: summaryMsg });
            return;
          }

          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
          const res = await apiFetch('/api/actions/confirm', {
            method: 'POST',
            headers,
            body: JSON.stringify({ confirmationId: pending.id }),
          });
          const data = await res.json();
          const summaryMsg = data.summary ? `${data.message}\n\n${data.summary}` : data.message || 'Ação concluída.';
          setMessages((prev) => [
            ...prev,
            {
              id: `conf-${Date.now()}`,
              role: 'assistant',
              content: summaryMsg,
              timestamp: new Date().toISOString(),
            },
          ]);
          setFloatingReply({ role: 'assistant', text: summaryMsg });
          void refreshAuthAndUsage();
        },
        onCancel: async () => {
          if (isLocalAction) return;
          await apiFetch('/api/actions/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirmationId: pending.id }),
          });
        },
      });
    },
    [accessToken, refreshAuthAndUsage]
  );

  // Hybrid Real-Time Gemini Live API (Voice + On-demand Vision)
  const live = useAegisLive({
    googleToken: accessToken,
    userEmail: googleUser?.email || aegisUser?.email,
    onUserTranscript: (text) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `voice-u-${Date.now()}`,
          role: 'user',
          modality: 'voice',
          content: text,
          timestamp: new Date().toISOString(),
        },
      ]);
    },
    onAssistantTranscript: (text) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `voice-a-${Date.now()}`,
          role: 'assistant',
          modality: 'voice',
          content: text,
          timestamp: new Date().toISOString(),
        },
      ]);
      setFloatingReply({ role: 'assistant', text, model: 'gemini-3.8-live' });
    },
    onDrawnScreen: (screen) => {
      pushDrawnScreens([screen]);
    },
    onConfirmationRequired: (pending) => {
      openPendingConfirmation(pending);
    },
  });

  useEffect(() => {
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = live.cameraStream;
    }
  }, [live.cameraStream]);

  useEffect(() => {
    void refreshAuthAndUsage();
    const unsub = initAuth(
      (authedUser, token) => {
        setGoogleUser(authedUser);
        setAccessToken(token);
      },
      (maybeUser) => {
        setGoogleUser(maybeUser);
        setAccessToken(getAccessToken());
      }
    );
    return () => unsub();
  }, [refreshAuthAndUsage]);

  // Silently probe local daemon when user enters the app
  useEffect(() => {
    if (aegisUser) {
      void handleProbeLocal();
    }
  }, [aegisUser, handleProbeLocal]);

  // Auto-sync Google Workspace & Memory whenever user signs into Google while Local Daemon is unlocked
  useEffect(() => {
    if (
      accessToken &&
      localHealth.online &&
      localAuthStatus?.authenticated &&
      lastAutoSyncedTokenRef.current !== accessToken
    ) {
      lastAutoSyncedTokenRef.current = accessToken;
      void handleSyncGoogleToLocal(accessToken, googleUser?.email || aegisUser?.email);
    }
  }, [
    accessToken,
    localHealth.online,
    localAuthStatus?.authenticated,
    googleUser?.email,
    aegisUser?.email,
    handleSyncGoogleToLocal,
  ]);

  // Non-blocking background jobs synchronization & automatic chat delivery
  const registerBackgroundJob = useCallback((job: BackgroundJobItem) => {
    setBackgroundJobs((prev) => [job, ...prev.filter((j) => j.id !== job.id)].slice(0, 15));
  }, []);

  const pollBackgroundJobs = useCallback(async () => {
    if (!aegisUser) return;
    try {
      const res = await apiFetch('/api/assistant/jobs');
      if (!res.ok) return;
      const data = await res.json();
      const jobs = (Array.isArray(data.jobs) ? data.jobs : []) as BackgroundJobItem[];
      setBackgroundJobs(jobs);

      for (const job of jobs) {
        if ((job.status === 'completed' || job.status === 'error') && !job.announced && !announcedJobIdsRef.current.has(job.id)) {
          announcedJobIdsRef.current.add(job.id);
          void apiFetch(`/api/assistant/jobs/${encodeURIComponent(job.id)}/ack`, { method: 'POST' });

          if (job.status === 'completed' && job.result) {
            const replyBody = `**[Concluído em segundo plano — "${job.title}"]**\n\n${job.result.reply || 'Operação concluída.'}`;
            const doneMsg: ChatMessage = {
              id: `bg-done-${job.id}`,
              role: 'assistant',
              modality: 'text',
              content: replyBody,
              timestamp: job.completedAt || new Date().toISOString(),
              steps: job.result.steps,
              pendingConfirmations: job.result.pendingConfirmations,
              screens: job.result.screens,
              usage: job.result.usage,
              thinkingTrace: job.trace,
            };
            setMessages((prev) => [...prev, doneMsg]);
            setFloatingReply({
              role: 'assistant',
              text: replyBody,
              model: job.result.usage?.model ? `${job.result.usage.model} · 2º Plano` : '2º Plano',
            });
            if (job.trace && job.trace.length > 0) {
              setThinkingTrace(job.trace);
            }
            if (job.result.usage) {
              setLastTurnUsage(job.result.usage);
            }
            if (Array.isArray(job.result.screens) && job.result.screens.length > 0) {
              pushDrawnScreens(job.result.screens);
            }
            if (Array.isArray(job.result.pendingConfirmations) && job.result.pendingConfirmations.length > 0) {
              openPendingConfirmation(job.result.pendingConfirmations[0]);
            }
            void refreshAuthAndUsage();
          } else if (job.status === 'error') {
            const errBody = `**[Erro em segundo plano — "${job.title}"]**\n\n${job.error || 'Falha durante a execução em segundo plano.'}`;
            setMessages((prev) => [
              ...prev,
              {
                id: `bg-err-${job.id}`,
                role: 'system',
                content: errBody,
                timestamp: job.completedAt || new Date().toISOString(),
              },
            ]);
            setFloatingReply({ role: 'assistant', text: errBody });
          }
        }
      }
    } catch {
      // ignore transient network errors while polling
    }
  }, [aegisUser, openPendingConfirmation, pushDrawnScreens, refreshAuthAndUsage]);

  useEffect(() => {
    if (!aegisUser) return;
    void pollBackgroundJobs();
  }, [aegisUser, pollBackgroundJobs]);

  const hasRunningBackgroundJobs = backgroundJobs.some((j) => j.status === 'running');
  useEffect(() => {
    if (!aegisUser || !hasRunningBackgroundJobs) return;
    const timer = setInterval(() => {
      void pollBackgroundJobs();
    }, 2_500);
    return () => clearInterval(timer);
  }, [aegisUser, hasRunningBackgroundJobs, pollBackgroundJobs]);

  // Global keyboard shortcuts: Ctrl+K / M opens hidden spatial menu; Esc returns to 3D core
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inEditable =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMenuDrawerOpen((v) => !v);
      } else if (!inEditable && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setMenuDrawerOpen((v) => !v);
      } else if (e.key === 'Escape') {
        if (bgJobsOpen) {
          setBgJobsOpen(false);
        } else if (localPopoverOpen) {
          setLocalPopoverOpen(false);
        } else if (thinkingPanelOpen) {
          setThinkingPanelOpen(false);
        } else if (menuDrawerOpen) {
          setMenuDrawerOpen(false);
        } else if (activeModule) {
          setActiveModule(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeModule, bgJobsOpen, localPopoverOpen, menuDrawerOpen, thinkingPanelOpen]);

  const handleGoogleLogin = async () => {
    setLoggingIn(true);
    setAuthError(null);
    try {
      const res = await googleSignIn();
      setGoogleUser(res.user);
      setAccessToken(res.accessToken);
      if (res.user.email && res.accessToken) {
        const ssoRes = await apiFetch('/api/auth/google-sso', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${res.accessToken}`,
          },
          body: JSON.stringify({
            displayName: res.user.displayName || res.user.email,
          }),
        });
        if (ssoRes.ok) {
          const ssoData = await ssoRes.json();
          setAegisSessionToken(ssoData.sessionToken);
          setAegisUser(ssoData.user);
          await refreshAuthAndUsage();
        } else {
          const errData = await ssoRes.json().catch(() => ({}));
          setAuthError(errData.error || 'Falha ao validar sessão Google no servidor.');
        }
      }
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Falha na autenticação Google.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleGoogleDisconnect = async () => {
    await logout();
    setGoogleUser(null);
    setAccessToken(null);
  };

  const handleAppLogout = async () => {
    live.disconnect();
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setAegisSessionToken(null);
    setAegisUser(null);
    await logout();
    setGoogleUser(null);
    setAccessToken(null);
  };

  const handleSendCommand = async (rawPrompt: string) => {
    const prompt = rawPrompt.trim();
    if (!prompt || textBusy) return;
    setInputText('');

    const userMsg: ChatMessage = {
      id: `txt-u-${Date.now()}`,
      role: 'user',
      modality: 'text',
      content: prompt,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setFloatingReply({ role: 'user', text: prompt });

    // Hybrid mode: if Gemini Live API is connected, inject directly into the real-time session
    if (live.status === 'connected') {
      const sent = live.sendLiveText(prompt);
      if (sent) return;
    }

    // Standard auto-routed Worker + Curator Gemini agent (Local Daemon OR Cloud Server SSE)
    setTextBusy(true);
    setThinkingTrace([]);
    setLastTurnUsage(null);
    try {
      if (executionMode === 'local' && localHealth.online && localAuthStatus?.authenticated) {
        setRoutingState({
          phase: 'subagent',
          activeModel: modelPreference === 'auto' ? 'gemini-3.1-flash-lite' : modelPreference,
          tier: 'lite',
          routingMode: modelPreference === 'auto' ? 'auto' : 'manual',
          activeSubagent: `Local · ${localHealth.host || 'PC'}`,
          reason: 'Executando diretamente no Aegis Local com sincronização Google ativa',
        });

        const localData = await runLocalAssistantTurn({
          prompt,
          modelPreference,
          googleToken: accessToken,
          googleEmail: googleUser?.email || aegisUser?.email,
        });

        const assistantMsg: ChatMessage = {
          id: `txt-local-a-${Date.now()}`,
          role: 'assistant',
          modality: 'text',
          content: localData.reply,
          timestamp: new Date().toISOString(),
          steps: localData.steps,
          pendingConfirmations: localData.pendingConfirmations,
          screens: localData.screens,
          usage: localData.usage,
          thinkingTrace: localData.thinkingTrace,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        if (localData.thinkingTrace) {
          setThinkingTrace(localData.thinkingTrace);
        }
        if (localData.usage) {
          setLastTurnUsage(localData.usage);
        }
        setRoutingState({
          phase: 'ready',
          activeModel: localData.usage?.model || modelPreference,
          tier: localData.usage?.complexityTier || 'lite',
          routingMode: localData.usage?.routingMode || 'auto',
          reason: localData.usage?.routingReason || 'Concluído no Aegis Local',
        });
        setFloatingReply({
          role: 'assistant',
          text: assistantMsg.content,
          model: localData.usage?.model ? `${localData.usage.model} · Local` : 'Aegis Local',
        });
        if (localData.screens.length > 0) {
          pushDrawnScreens(localData.screens);
        }
        if (localData.pendingConfirmations.length > 0) {
          openPendingConfirmation(localData.pendingConfirmations[0]);
        }
        return;
      }

      const data = await streamAssistantTurn({
        prompt,
        sessionId: 'holo-core',
        mode: 'reactive',
        modelPreference,
        userEmail: googleUser?.email || aegisUser?.email,
        accessToken,
        onRoutingState: (nextState) => {
          setRoutingState(nextState);
        },
        onTraceUpdate: (nextTrace) => {
          setThinkingTrace(nextTrace);
        },
      });

      if (data.backgroundJob) {
        registerBackgroundJob(data.backgroundJob);
        const ackText =
          data.ackMessage ||
          data.reply ||
          'Tarefa iniciada em segundo plano. Pode continuar conversando comigo normalmente.';
        const bgAckMsg: ChatMessage = {
          id: `txt-bg-${data.backgroundJob.id}`,
          role: 'assistant',
          modality: 'text',
          content: ackText,
          timestamp: new Date().toISOString(),
          thinkingTrace: data.thinkingTrace,
        };
        setMessages((prev) => [...prev, bgAckMsg]);
        setFloatingReply({
          role: 'assistant',
          text: ackText,
          model: 'Segundo Plano',
        });
        return;
      }

      const assistantMsg: ChatMessage = {
        id: `txt-a-${Date.now()}`,
        role: 'assistant',
        modality: 'text',
        content: data.reply || 'Operação concluída.',
        timestamp: new Date().toISOString(),
        steps: data.steps,
        pendingConfirmations: data.pendingConfirmations,
        screens: data.screens,
        usage: data.usage,
        thinkingTrace: data.thinkingTrace,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      if (data.usage) {
        setLastTurnUsage(data.usage);
      }
      setFloatingReply({
        role: 'assistant',
        text: assistantMsg.content,
        model: data.usage?.model,
      });

      if (Array.isArray(data.screens) && data.screens.length > 0) {
        pushDrawnScreens(data.screens as HolographicScreenSpec[]);
      }

      if (data.cameraAction === 'enable') {
        void live.toggleCamera();
      } else if (data.cameraAction === 'disable') {
        live.stopCamera();
      }

      if (Array.isArray(data.pendingConfirmations) && data.pendingConfirmations.length > 0) {
        openPendingConfirmation(data.pendingConfirmations[0] as PendingConfirmation);
      }

      void refreshAuthAndUsage();
    } catch (err: unknown) {
      const errText = err instanceof Error ? err.message : 'Erro ao comunicar com o Aegis.';
      setFloatingReply({ role: 'assistant', text: errText });
      setRoutingState((prev) => ({
        ...prev,
        phase: 'idle',
      }));
    } finally {
      setTextBusy(false);
    }
  };

  const handleSaveLocalFileFromScreen = async (filePath: string, content: string) => {
    const res = await apiFetch('/api/linux/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content }),
    });
    const data = await res.json();
    setFloatingReply({
      role: 'assistant',
      text: res.ok ? `Arquivo "${filePath}" salvo com sucesso.` : data.error || 'Erro ao salvar arquivo.',
    });
  };

  const handleNavigateWebFromScreen = async (url: string) => {
    setTextBusy(true);
    try {
      const res = await apiFetch('/api/web/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (res.ok && data.snapshot) {
        const snap = data.snapshot;
        pushDrawnScreens([
          {
            id: `scr-web-${Date.now()}`,
            kind: 'web_canvas',
            title: snap.title || snap.url,
            subtitle: snap.url,
            createdAt: new Date().toISOString(),
            webUrl: snap.url,
            webTitle: snap.title,
            webText: snap.textPreview,
            webHeadings: snap.headings,
            webLinks: snap.links,
            webTables: snap.tables,
          },
        ]);
      }
    } finally {
      setTextBusy(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#05070B] text-xs font-mono text-amber-300/80">
        Inicializando Núcleo Holográfico Aegis...
      </div>
    );
  }

  if (!aegisUser) {
    return (
      <LoginScreen
        needsSetup={needsSetup}
        onAuthenticated={(u) => {
          setAegisUser(u);
          void refreshAuthAndUsage();
        }}
        onGoogleLogin={handleGoogleLogin}
        loggingInGoogle={loggingIn}
        authError={authError}
      />
    );
  }

  const effectiveCoreState: AegisCoreState = textBusy ? 'thinking' : live.derivedCoreState;
  const activeModuleMeta = SPATIAL_MODULES.find((m) => m.id === activeModule) || null;
  const hasVisibleFloatingScreen = drawnScreens.length > 0 && !screensMinimized && !activeModule;
  const activeCaption = live.liveCaption || floatingReply;

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#05070B] text-slate-100 select-none">
      {/* FULL-VIEWPORT 3D JARVIS GOLDEN-AMBER NEURAL CORE */}
      <JarvisHologramCore
        coreState={effectiveCoreState}
        audioLevelRef={live.audioLevelRef}
        hasFloatingScreen={hasVisibleFloatingScreen}
        onCoreClick={() => {
          if (!menuDrawerOpen && !activeModule && drawnScreens.length === 0) {
            void live.toggleVoice();
          }
        }}
      />

      {/* TOP MINIMAL DISCREET BAR (ALWAYS ABOVE MODULES & CANVAS, NO BACKDROP-BLUR OVER WEBGL) */}
      <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-2 px-4 sm:px-6 py-3.5">
        {/* Accessible Hidden-Menu Trigger */}
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuDrawerOpen((v) => !v);
            }}
            aria-expanded={menuDrawerOpen}
            aria-label="Abrir ou fechar Menu Espacial"
            className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-medium transition-all shadow-lg cursor-pointer ${
              menuDrawerOpen
                ? 'border-amber-400 bg-amber-500/20 text-amber-100'
                : 'border-amber-500/35 bg-[#0A0E17]/94 text-slate-100 hover:border-amber-400/70 hover:text-amber-200'
            }`}
            title="Abrir Menu Espacial (M ou Ctrl+K)"
          >
            {menuDrawerOpen ? (
              <X className="h-4 w-4 text-amber-300" />
            ) : (
              <Menu className="h-4 w-4 text-amber-400" />
            )}
            <span className="font-display font-semibold tracking-tight">Menu</span>
            <span className="hidden md:inline font-mono text-[10px] text-slate-400 border-l border-white/12 pl-2">
              Aegis · M
            </span>
          </button>

          {activeModule && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveModule(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/35 bg-amber-500/16 px-3 py-2 text-xs font-medium text-amber-200 hover:bg-amber-500/26 transition-colors cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Núcleo 3D</span>
            </button>
          )}
        </div>

        {/* Right: Real-Time Model Escalation Indicator + Minimized Screens + Core State */}
        <div className="pointer-events-auto flex items-center gap-2 min-w-0">
          {drawnScreens.length > 0 && (screensMinimized || activeModule) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveModule(null);
                setScreensMinimized(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-[#0F1522]/94 px-3 py-2 text-xs font-medium text-amber-200 hover:border-amber-400 transition-colors shrink-0 cursor-pointer"
            >
              <Layers className="h-3.5 w-3.5 text-amber-400" />
              <span className="hidden md:inline">
                {drawnScreens.length} {drawnScreens.length === 1 ? 'Tela' : 'Telas'}
              </span>
            </button>
          )}

          {/* LIVE THINKING ACTIVITY, WORKER SUBAGENTS & SENIOR CURATOR INSPECTOR TRIGGER */}
          {(() => {
            const isActiveTransition =
              textBusy ||
              routingState.phase === 'analyzing' ||
              routingState.phase === 'planning' ||
              routingState.phase === 'invoking' ||
              routingState.phase === 'escalating' ||
              routingState.phase === 'fallback' ||
              routingState.phase === 'subagent' ||
              routingState.phase === 'curating' ||
              routingState.phase === 'evolving';
            const isLiveVoice = live.status === 'connected' && !textBusy && !isActiveTransition;

            const currentLabel = isLiveVoice
              ? 'Live 3.8'
              : routingState.activeModel === 'auto'
              ? modelPreference === 'auto'
                ? 'Auto'
                : formatModelShortName(modelPreference)
              : formatModelShortName(routingState.activeModel);

            const prevLabel = routingState.previousModel
              ? formatModelShortName(routingState.previousModel)
              : null;

            const borderTone = thinkingPanelOpen
              ? 'border-amber-400 bg-[#141A29]/98 text-amber-100 shadow-[0_0_24px_-6px_rgba(245,158,11,0.5)]'
              : routingState.phase === 'evolving'
              ? 'border-emerald-400/65 bg-[#0A1A14]/95 text-emerald-200 shadow-[0_0_20px_-6px_rgba(52,211,153,0.45)]'
              : routingState.phase === 'curating'
              ? 'border-sky-400/70 bg-[#0B1627]/95 text-sky-100 shadow-[0_0_20px_-6px_rgba(56,189,248,0.45)]'
              : routingState.phase === 'subagent' || routingState.phase === 'planning'
              ? 'border-amber-400/70 bg-[#18130B]/95 text-amber-100 shadow-[0_0_20px_-6px_rgba(245,158,11,0.45)]'
              : routingState.phase === 'escalating'
              ? 'border-sky-400/65 bg-[#0C1524]/95 text-sky-200 shadow-[0_0_20px_-6px_rgba(56,189,248,0.45)]'
              : routingState.phase === 'fallback'
              ? 'border-amber-400/65 bg-[#191309]/95 text-amber-200'
              : isActiveTransition
              ? 'border-amber-400/55 bg-[#121622]/95 text-amber-100'
              : isLiveVoice
              ? 'border-amber-500/40 bg-[#14120C]/92 text-amber-200'
              : 'border-white/12 bg-[#0A0E17]/90 text-slate-300 hover:border-amber-500/45 hover:text-amber-100';

            return (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLocalPopoverOpen(false);
                  setThinkingPanelOpen((v) => !v);
                }}
                aria-expanded={thinkingPanelOpen}
                title={
                  routingState.reason ||
                  'Clique para ver o pensamento e a atividade dos subagentes em tempo real'
                }
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-mono transition-all cursor-pointer max-w-[270px] sm:max-w-[400px] ${borderTone} ${
                  isActiveTransition ? 'escalation-sweep-bar' : ''
                }`}
              >
                {routingState.phase === 'analyzing' ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400 shrink-0" />
                    <span className="truncate">Decompondo tarefa...</span>
                  </>
                ) : routingState.phase === 'planning' ? (
                  <>
                    <GitBranch className="h-3.5 w-3.5 text-amber-400 shrink-0 animate-pulse" />
                    <span className="truncate">
                      Subdividindo · {routingState.workerCount || 1}{' '}
                      {(routingState.workerCount || 1) === 1 ? 'trabalhador' : 'trabalhadores'}
                    </span>
                  </>
                ) : routingState.phase === 'evolving' ? (
                  <>
                    <Code2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 animate-pulse" />
                    <span className="truncate">
                      Auto-Evolução · {routingState.evolvingCapability || 'código'}
                    </span>
                  </>
                ) : routingState.phase === 'subagent' ? (
                  <>
                    <Network className="h-3.5 w-3.5 text-amber-400 shrink-0 animate-pulse" />
                    <span className="truncate">
                      {currentLabel} · {routingState.activeSubagent || 'Trabalhador'}
                    </span>
                  </>
                ) : routingState.phase === 'curating' ? (
                  <>
                    <Sparkles className="h-3.5 w-3.5 text-sky-400 shrink-0 animate-pulse" />
                    <span className="truncate">
                      Curadoria · {currentLabel}
                      {routingState.activeTool ? ` · ${routingState.activeTool}` : ''}
                    </span>
                  </>
                ) : routingState.phase === 'escalating' ? (
                  <>
                    <ArrowUpRight className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                    <span className="truncate">
                      {prevLabel ? `${prevLabel} → ${currentLabel}` : `Escalonando → ${currentLabel}`}
                    </span>
                    <span className="hidden lg:inline text-[10px] text-sky-300/80 shrink-0">
                      · {formatTierLabel(routingState.tier)}
                    </span>
                  </>
                ) : routingState.phase === 'fallback' ? (
                  <>
                    <ArrowDownRight className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <span className="truncate">
                      {prevLabel ? `${prevLabel} → ${currentLabel}` : `Fallback → ${currentLabel}`}
                    </span>
                  </>
                ) : routingState.phase === 'invoking' ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400 shrink-0" />
                    <span className="truncate">
                      {currentLabel}
                      {routingState.activeTool ? ` · ${routingState.activeTool}` : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <Brain className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <span className="truncate">
                      {isLiveVoice
                        ? 'Live 3.8 · Voz'
                        : thinkingTrace.length > 0
                        ? `Pensamento · ${currentLabel}`
                        : modelPreference === 'auto'
                        ? 'Atividade · Auto'
                        : `Atividade · ${formatModelShortName(modelPreference)}`}
                    </span>
                  </>
                )}

                {thinkingTrace.length > 0 && (
                  <span className="hidden sm:inline font-mono text-[10px] text-slate-400 border-l border-white/12 pl-1.5 tabular-nums shrink-0">
                    {thinkingTrace.length}
                  </span>
                )}
                {thinkingPanelOpen ? (
                  <ChevronUp className="h-3 w-3 text-slate-400 shrink-0" />
                ) : (
                  <ChevronDown className="h-3 w-3 text-slate-400 shrink-0" />
                )}
              </button>
            );
          })()}

          {/* BACKGROUND EXECUTION ("SEGUNDO PLANO") TRACKER */}
          {backgroundJobs.length > 0 && (() => {
            const runningCount = backgroundJobs.filter((j) => j.status === 'running').length;
            return (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setThinkingPanelOpen(false);
                  setLocalPopoverOpen(false);
                  setBgJobsOpen((v) => !v);
                }}
                aria-expanded={bgJobsOpen}
                title="Tarefas executando em segundo plano (sem travar o chat)"
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-mono transition-all cursor-pointer shrink-0 ${
                  runningCount > 0
                    ? 'border-sky-400/70 bg-[#0B1726]/95 text-sky-200 shadow-[0_0_18px_-6px_rgba(56,189,248,0.45)]'
                    : bgJobsOpen
                    ? 'border-amber-400 bg-[#141A29]/98 text-amber-100'
                    : 'border-white/12 bg-[#0A0E17]/90 text-slate-300 hover:border-sky-400/50'
                }`}
              >
                {runningCount > 0 ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400 shrink-0" />
                ) : (
                  <Clock className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                )}
                <span className="hidden sm:inline">
                  {runningCount > 0 ? `2º Plano (${runningCount})` : `2º Plano`}
                </span>
              </button>
            );
          })()}

          {/* LOCAL OPERATION + GOOGLE SYNC QUICK SWITCHER */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setThinkingPanelOpen(false);
              setBgJobsOpen(false);
              setLocalPopoverOpen((v) => !v);
              if (!localPopoverOpen) {
                void handleProbeLocal();
              }
            }}
            aria-expanded={localPopoverOpen}
            title={
              executionMode === 'local'
                ? `Operando localmente em ${localHealth.host || '127.0.0.1:3847'}`
                : 'Alternar entre Nuvem e Aegis Local com sincronização Google'
            }
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-mono transition-all cursor-pointer shrink-0 ${
              executionMode === 'local'
                ? 'border-emerald-400/70 bg-emerald-500/18 text-emerald-200 shadow-[0_0_18px_-6px_rgba(52,211,153,0.45)]'
                : localPopoverOpen
                ? 'border-amber-400 bg-[#141A29]/98 text-amber-100'
                : localHealth.online
                ? 'border-emerald-500/35 bg-[#0A1315]/90 text-emerald-200/90 hover:border-emerald-400/60'
                : 'border-white/12 bg-[#0A0E17]/90 text-slate-300 hover:border-amber-500/45 hover:text-amber-100'
            }`}
          >
            {executionMode === 'local' ? (
              <Laptop className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            ) : (
              <Cloud className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            )}
            <span className="hidden sm:inline">
              {executionMode === 'local'
                ? `Local · ${localHealth.host || 'PC'}`
                : localHealth.online
                ? 'Nuvem (Local OK)'
                : 'Nuvem'}
            </span>
          </button>

          <div className="hidden lg:flex items-center gap-2 rounded-xl border border-white/10 bg-[#0A0E17]/90 px-3 py-2 text-[11px] font-mono text-amber-300/90 shrink-0">
            <span>{STATE_LABELS[effectiveCoreState]}</span>
          </div>
        </div>
      </header>

      {/* BACKGROUND JOBS FLOATING POPOVER */}
      {bgJobsOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed top-16 right-4 sm:right-6 z-50 w-[340px] sm:w-[400px] max-h-[68vh] flex flex-col rounded-2xl border border-sky-400/35 bg-[#0A0F1A]/98 shadow-2xl overflow-hidden select-text"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 bg-[#0E1525]">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-sky-400" />
              <span className="text-xs font-semibold text-slate-100">Execução em Segundo Plano</span>
            </div>
            <button
              type="button"
              onClick={() => setBgJobsOpen(false)}
              className="text-slate-400 hover:text-white cursor-pointer"
              aria-label="Fechar painel de segundo plano"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-white/6 p-2 space-y-1.5">
            {backgroundJobs.length === 0 ? (
              <p className="px-3 py-4 text-xs text-slate-400 text-center">
                Nenhuma tarefa em segundo plano no momento.
              </p>
            ) : (
              backgroundJobs.map((job) => (
                <div
                  key={job.id}
                  className="rounded-xl border border-white/8 bg-[#0E1422] p-3 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {job.status === 'running' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400 shrink-0" />
                      ) : job.status === 'completed' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <X className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                      )}
                      <span className="text-xs font-medium text-slate-100 truncate">{job.title}</span>
                    </div>
                    {job.status !== 'running' && (
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/assistant/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
                          setBackgroundJobs((prev) => prev.filter((j) => j.id !== job.id));
                        }}
                        className="text-slate-500 hover:text-slate-200 cursor-pointer shrink-0"
                        title="Remover da lista"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">{job.latestActivity}</p>
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
                    <span className="text-sky-300/80">{formatModelShortName(job.activeModel)}</span>
                    <span>
                      {job.status === 'running'
                        ? 'Executando...'
                        : job.status === 'completed'
                        ? 'Entregue no chat'
                        : 'Falhou'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* LOCAL OPERATION + GOOGLE WORKSPACE SYNC POPOVER */}
      <LocalOperationPopover
        open={localPopoverOpen}
        executionMode={executionMode}
        health={localHealth}
        authStatus={localAuthStatus}
        syncStatus={localSyncStatus}
        probing={probingLocal}
        syncingGoogle={syncingLocalGoogle}
        syncFeedback={localSyncFeedback}
        googleConnectedInWeb={Boolean(accessToken)}
        googleEmail={googleUser?.email || aegisUser?.email}
        loggingInGoogle={loggingIn}
        onClose={() => setLocalPopoverOpen(false)}
        onChangeMode={(mode) => {
          setExecutionMode(mode);
          setLocalPopoverOpen(false);
        }}
        onProbe={handleProbeLocal}
        onLocalAuthenticated={async () => {
          await handleProbeLocal();
          setExecutionMode('local');
          if (accessToken) {
            await handleSyncGoogleToLocal(accessToken, googleUser?.email || aegisUser?.email);
          }
        }}
        onSyncGoogleNow={() => handleSyncGoogleToLocal()}
        onGoogleLogin={handleGoogleLogin}
        onOpenNativeInstallers={() => {
          setSettingsTab('local_agent');
          setActiveModule('settings');
        }}
      />

      {/* INTERACTIVE LIVE THINKING & SUBAGENT ACTIVITY INSPECTOR */}
      <ThinkingActivityPanel
        open={thinkingPanelOpen}
        isBusy={textBusy}
        routingState={routingState}
        trace={thinkingTrace}
        lastUsage={lastTurnUsage}
        onClose={() => setThinkingPanelOpen(false)}
        onOpenModelsSettings={() => {
          setSettingsTab('models');
          setActiveModule('settings');
        }}
      />

      {/* ON-DEMAND CAMERA VISION VIEWFINDER (ONLY VISIBLE WHEN CAMERA IS ENABLED) */}
      {live.cameraActive && (
        <div className="fixed top-20 right-5 z-30 w-44 sm:w-52 overflow-hidden rounded-xl border border-sky-400/50 bg-[#070B12] shadow-2xl">
          <div className="flex items-center justify-between border-b border-sky-400/25 bg-[#0A111D] px-2.5 py-1.5 text-[10px] font-mono text-sky-300">
            <span>VISÃO ÓPTICA · 1 FPS</span>
            <button
              type="button"
              onClick={live.stopCamera}
              className="text-slate-400 hover:text-rose-300"
              aria-label="Desligar câmera"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <video
            ref={previewVideoRef}
            autoPlay
            muted
            playsInline
            className="h-28 sm:h-32 w-full object-cover"
          />
        </div>
      )}

      {/* FLOATING HOLOGRAPHIC SCREENS DRAWN BY AEGIS OVER THE 3D CORE */}
      {!activeModule && (
        <HolographicScreenDeck
          screens={drawnScreens}
          activeScreenId={activeScreenId}
          minimized={screensMinimized}
          accessToken={accessToken}
          onSelectScreen={setActiveScreenId}
          onCloseScreen={(id) => {
            setDrawnScreens((prev) => {
              const next = prev.filter((s) => s.id !== id);
              if (activeScreenId === id) {
                setActiveScreenId(next[next.length - 1]?.id || null);
              }
              return next;
            });
          }}
          onToggleMinimize={() => setScreensMinimized((v) => !v)}
          onSaveLocalFile={handleSaveLocalFileFromScreen}
          onNavigateWebUrl={handleNavigateWebFromScreen}
        />
      )}

      {/* FLOATING RESPONSE / LIVE TRANSCRIPT OVERLAY ABOVE THE DOCK */}
      {!activeModule && !hasVisibleFloatingScreen && (activeCaption || live.liveError) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-28 z-20 flex justify-center px-4">
          <div className="pointer-events-auto max-w-2xl w-full rounded-2xl border border-amber-500/24 bg-[#090D16]/94 px-4 py-3 shadow-2xl select-text">
            {live.liveError ? (
              <div className="flex items-center justify-between gap-3 text-xs text-rose-300">
                <span>{live.liveError}</span>
                <button
                  type="button"
                  onClick={() => {
                    live.clearError();
                    setFloatingReply(null);
                  }}
                  className="text-slate-400 hover:text-white cursor-pointer"
                  aria-label="Fechar erro"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              activeCaption && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-[10px] font-mono uppercase tracking-wider">
                    <span className={activeCaption.role === 'user' ? 'text-sky-300' : 'text-amber-400'}>
                      {activeCaption.role === 'user' ? 'Você' : 'Aegis'}
                      {'model' in activeCaption && activeCaption.model ? ` · ${activeCaption.model}` : ''}
                    </span>
                    <div className="flex items-center gap-2.5">
                      {thinkingTrace.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setThinkingPanelOpen(true)}
                          className="inline-flex items-center gap-1 text-amber-300/90 hover:text-amber-200 transition-colors cursor-pointer"
                        >
                          <Brain className="h-3 w-3" />
                          <span>Ver pensamento</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setActiveModule('command')}
                        className="inline-flex items-center gap-1 text-slate-400 hover:text-amber-200 transition-colors cursor-pointer"
                      >
                        <MessageSquare className="h-3 w-3" />
                        <span>Histórico</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setFloatingReply(null)}
                        className="text-slate-500 hover:text-white cursor-pointer"
                        aria-label="Ocultar legenda"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs sm:text-[13px] leading-relaxed text-slate-100 max-h-36 overflow-y-auto whitespace-pre-wrap">
                    {activeCaption.text}
                  </p>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* BOTTOM-CENTER HYBRID MULTIMODAL DOCK (VOICE LIVE + CAMERA VISION + TEXT) */}
      {!activeModule && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex flex-col items-center gap-2.5 px-4">
          {/* Subtle quick prompt hints only when completely idle and clean */}
          {messages.length === 0 && drawnScreens.length === 0 && live.status === 'disconnected' && !floatingReply && (
            <div className="pointer-events-auto hidden md:flex flex-wrap items-center justify-center gap-2 max-w-3xl">
              {QUICK_DIRECTIVES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void handleSendCommand(q)}
                  className="rounded-lg border border-amber-500/20 bg-[#0A0E17]/88 px-3 py-1.5 text-[11px] text-slate-300 hover:border-amber-400/50 hover:text-amber-200 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSendCommand(inputText);
            }}
            className="holo-dock pointer-events-auto flex w-full max-w-2xl items-center gap-2 rounded-2xl px-3 py-2"
          >
            {/* Real-Time Voice Live Toggle */}
            <button
              type="button"
              onClick={() => void live.toggleVoice()}
              title={
                live.status === 'connected'
                  ? 'Encerrar conversa por voz em tempo real'
                  : 'Conversar por voz em tempo real (Gemini Live API)'
              }
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                live.status === 'connected'
                  ? 'border-amber-400 bg-amber-500 text-slate-950'
                  : live.status === 'connecting'
                  ? 'border-amber-500/50 bg-amber-500/20 text-amber-300'
                  : 'border-white/12 bg-[#121826] text-amber-300 hover:border-amber-400/55'
              }`}
            >
              {live.status === 'connecting' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : live.status === 'connected' ? (
                <Mic className="h-4 w-4" />
              ) : (
                <MicOff className="h-4 w-4" />
              )}
            </button>

            {/* On-Demand Camera Vision Toggle */}
            <button
              type="button"
              onClick={() => void live.toggleCamera()}
              title={
                live.cameraActive
                  ? 'Desligar visão por câmera'
                  : 'Ativar câmera para o Aegis enxergar você ou objetos'
              }
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                live.cameraActive
                  ? 'border-sky-400 bg-sky-400 text-slate-950'
                  : 'border-white/12 bg-[#121826] text-slate-300 hover:border-sky-400/55 hover:text-sky-300'
              }`}
            >
              {live.cameraActive ? <Camera className="h-4 w-4" /> : <CameraOff className="h-4 w-4" />}
            </button>

            {/* Hybrid Text Command Input */}
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={
                live.status === 'connected'
                  ? 'Fale livremente ou digite para o Aegis ao vivo...'
                  : 'Fale com o Aegis, peça para desenhar uma tela ou execute no sistema...'
              }
              className="flex-1 bg-transparent px-2 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none select-text"
            />

            <button
              type="submit"
              disabled={!inputText.trim() || textBusy}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-amber-500 px-4 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-40 transition-colors"
            >
              {textBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">Enviar</span>
            </button>
          </form>
        </div>
      )}

      {/* ELEVATED 3D SPATIAL MODULE STAGE (WHEN USER OPENS A MODULE FROM HIDDEN MENU) */}
      {activeModule && activeModuleMeta && (
        <div className="fixed inset-x-3 sm:inset-x-6 top-18 bottom-4 z-30 spatial-stage flex flex-col">
          <div className="spatial-panel flex-1 min-h-0 flex flex-col rounded-2xl overflow-hidden select-text">
            {/* Spatial Module Header */}
            <div className="flex items-center justify-between gap-4 border-b border-amber-500/20 bg-[#0A0E18] px-5 py-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/35 bg-amber-500/15 text-amber-300 shrink-0">
                  <activeModuleMeta.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-display text-sm sm:text-base font-semibold text-slate-100 truncate">
                    {activeModuleMeta.label}
                  </h2>
                  <p className="text-[11px] text-slate-400 truncate hidden sm:block">
                    {activeModuleMeta.subtitle}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setMenuDrawerOpen(true)}
                  className="rounded-lg border border-white/10 bg-[#121826] px-3 py-1.5 text-xs text-slate-300 hover:border-amber-500/40 hover:text-amber-200 transition-colors"
                >
                  Trocar Módulo
                </button>
                <button
                  type="button"
                  onClick={() => setActiveModule(null)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/14 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/22 transition-colors"
                  title="Voltar ao Núcleo 3D (Esc)"
                >
                  <X className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Fechar</span>
                </button>
              </div>
            </div>

            {/* Active Module Body */}
            <div className="flex-1 min-h-0 overflow-hidden bg-[#070B12]">
              {activeModule === 'command' && (
                <CommandView
                  messages={messages}
                  setMessages={setMessages}
                  accessToken={accessToken}
                  userEmail={googleUser?.email || aegisUser.email}
                  modelPreference={modelPreference}
                  executionMode={executionMode}
                  localAuthed={Boolean(localHealth.online && localAuthStatus?.authenticated)}
                  onOpenLocalSettings={() => setLocalPopoverOpen(true)}
                  onOpenModelSettings={() => {
                    setSettingsTab('models');
                    setActiveModule('settings');
                  }}
                  onUsageUpdated={refreshAuthAndUsage}
                  onRequestConfirm={setConfirmRequest}
                  onOpenMinimalHud={() => setActiveModule(null)}
                  onScreensDrawn={pushDrawnScreens}
                  onRoutingStateChange={setRoutingState}
                  onTraceUpdate={setThinkingTrace}
                  onTurnUsage={setLastTurnUsage}
                  onBackgroundJobStarted={registerBackgroundJob}
                />
              )}
              {activeModule === 'orchestrator' && (
                <OrchestratorEvolutionView
                  onSendDirectiveToOrchestrator={(directive) => {
                    setActiveModule(null);
                    void handleSendCommand(directive);
                  }}
                />
              )}
              {activeModule === 'devices' && (
                <DevicesMeshView
                  onRequestConfirm={setConfirmRequest}
                  onAskOrchestrator={(directive) => {
                    setActiveModule(null);
                    void handleSendCommand(directive);
                  }}
                />
              )}
              {activeModule === 'terminal' && <TerminalView onRequestConfirm={setConfirmRequest} />}
              {activeModule === 'web' && (
                <WebAutomationView
                  accessToken={accessToken}
                  onRequestConfirm={setConfirmRequest}
                  onAskOrchestrator={(directive) => {
                    setActiveModule(null);
                    void handleSendCommand(directive);
                  }}
                />
              )}
              {activeModule === 'memory' && (
                <MemoryView
                  accessToken={accessToken}
                  userEmail={googleUser?.email || aegisUser.email}
                  onSweepResult={(reply) => {
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: `proactive-res-${Date.now()}`,
                        role: 'assistant',
                        content: reply,
                        timestamp: new Date().toISOString(),
                      },
                    ]);
                    setFloatingReply({ role: 'assistant', text: reply });
                    setActiveModule(null);
                  }}
                />
              )}
              {activeModule === 'settings' && (
                <SettingsView
                  initialTab={settingsTab}
                  accessToken={accessToken}
                  googleUser={googleUser}
                  userEmail={googleUser?.email || aegisUser.email}
                  loggingInGoogle={loggingIn}
                  modelPreference={modelPreference}
                  onChangeModelPreference={setModelPreference}
                  onGoogleLogin={handleGoogleLogin}
                  onGoogleDisconnect={handleGoogleDisconnect}
                  onRequestConfirm={setConfirmRequest}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* HIDDEN-BY-DEFAULT 3D SPATIAL MENU DRAWER */}
      <SpatialMenuDrawer
        isOpen={menuDrawerOpen}
        activeModule={activeModule}
        aegisUser={aegisUser}
        accessToken={accessToken}
        sessionTokens={sessionTokens}
        sessionRequests={sessionRequests}
        onCloseDrawer={() => setMenuDrawerOpen(false)}
        onSelectModule={(id) => setActiveModule(id)}
        onReturnToCore={() => setActiveModule(null)}
        onLogout={handleAppLogout}
      />

      <OfflineIndicator />
      <ConfirmationDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  );
}
