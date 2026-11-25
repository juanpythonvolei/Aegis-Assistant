import {
  CheckCircle2,
  Clock,
  Cpu,
  FolderKanban,
  Loader2,
  Send,
  ShieldAlert,
  Sparkles,
  Wrench,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import { streamAssistantTurn } from '../lib/assistantStream';
import {
  confirmLocalAction,
  probeLocalDaemon,
  runLocalAssistantTurn,
  type ExecutionMode,
} from '../lib/localEngine';
import type {
  BackgroundJobItem,
  ChatMessage,
  ConfirmationModalRequest,
  HolographicScreenSpec,
  LiveModelRoutingState,
  ModelPreference,
  PendingConfirmation,
  ThinkingTraceEntry,
  TurnUsageStats,
} from '../types';

interface CommandViewProps {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  accessToken: string | null;
  userEmail?: string;
  modelPreference: ModelPreference;
  executionMode?: ExecutionMode;
  localAuthed?: boolean;
  onOpenLocalSettings?: () => void;
  onOpenModelSettings?: () => void;
  onUsageUpdated?: () => void;
  onRequestConfirm: (req: ConfirmationModalRequest) => void;
  onOpenMinimalHud: () => void;
  onScreensDrawn?: (screens: HolographicScreenSpec[]) => void;
  onRoutingStateChange?: (state: LiveModelRoutingState) => void;
  onTraceUpdate?: (entries: ThinkingTraceEntry[]) => void;
  onTurnUsage?: (usage: TurnUsageStats) => void;
  onBackgroundJobStarted?: (job: BackgroundJobItem) => void;
}

const QUICK_PROMPTS = [
  'Orquestre um diagnóstico completo da máquina local e projete uma tela holográfica com recomendações',
  'Avalie se você tem uma função para analisar CSV e gerar estatísticas; se não tiver, crie no seu próprio código e teste',
  'Acesse https://news.ycombinator.com usando o subagente web e resuma os 5 principais destaques atuais',
  'Inspecione meus arquivos locais e proponha automações proativas para manter tudo organizado',
];

export const CommandView: React.FC<CommandViewProps> = ({
  messages,
  setMessages,
  accessToken,
  userEmail,
  modelPreference,
  executionMode = 'cloud',
  localAuthed = false,
  onOpenLocalSettings,
  onOpenModelSettings,
  onUsageUpdated,
  onRequestConfirm,
  onOpenMinimalHud,
  onScreensDrawn,
  onRoutingStateChange,
  onTraceUpdate,
  onTurnUsage,
  onBackgroundJobStarted,
}) => {
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'reactive' | 'proactive'>('reactive');
  const [targetBridge, setTargetBridge] = useState<'server' | 'local-daemon'>(
    executionMode === 'local' ? 'local-daemon' : 'server'
  );
  const [localDaemonOnline, setLocalDaemonOnline] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [resolvedIds, setResolvedIds] = useState<Record<string, 'confirmed' | 'cancelled'>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTargetBridge(executionMode === 'local' ? 'local-daemon' : 'server');
  }, [executionMode]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const checkLocalDaemon = async () => {
    const h = await probeLocalDaemon();
    setLocalDaemonOnline(h.online);
  };

  useEffect(() => {
    if (targetBridge === 'local-daemon') {
      void checkLocalDaemon();
    }
  }, [targetBridge]);

  const handleConfirmPending = (pending: PendingConfirmation) => {
    let detailsFormatted = pending.payload_json;
    try {
      detailsFormatted = JSON.stringify(JSON.parse(pending.payload_json), null, 2);
    } catch {
      // keep raw
    }

    onRequestConfirm({
      id: pending.id,
      title: 'Confirmar Ação do Assistente',
      summary: pending.summary,
      actionType: pending.action_type,
      target: pending.target,
      details: detailsFormatted,
      onConfirm: async () => {
        if (
          pending.action_type === 'local_daemon_command' ||
          pending.action_type === 'local_google_upload'
        ) {
          const data = await confirmLocalAction({
            payloadJson: pending.payload_json,
            googleToken: accessToken,
          });
          setResolvedIds((prev) => ({ ...prev, [pending.id]: 'confirmed' }));
          const outText = [
            data.summary,
            data.stdout ? `Saída padrão (stdout):\n${data.stdout}` : '',
            data.stderr ? `Erros (stderr):\n${data.stderr}` : '',
          ]
            .filter(Boolean)
            .join('\n\n');
          setMessages((prev) => [
            ...prev,
            {
              id: `confirm-daemon-${Date.now()}`,
              role: 'assistant',
              content: outText || 'Execução local concluída.',
              timestamp: new Date().toISOString(),
            },
          ]);
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
        setResolvedIds((prev) => ({ ...prev, [pending.id]: 'confirmed' }));
        onUsageUpdated?.();

        const rawStdout = data.result?.stdout ? `Saída da máquina (stdout):\n${data.result.stdout}` : '';
        const rawStderr = data.result?.stderr ? `Saída de erro (stderr):\n${data.result.stderr}` : '';
        const textParts = [
          data.ok ? `Ação confirmada e executada: ${data.message}` : `Falha ao executar ação: ${data.message}`,
          data.summary ? `Resultado: ${data.summary}` : '',
          rawStdout,
          rawStderr,
        ].filter(Boolean);

        setMessages((prev) => [
          ...prev,
          {
            id: `confirm-${Date.now()}`,
            role: data.ok && (data.summary || rawStdout) ? 'assistant' : 'system',
            content: textParts.join('\n\n'),
            timestamp: new Date().toISOString(),
          },
        ]);
      },
      onCancel: async () => {
        if (
          pending.action_type !== 'local_daemon_command' &&
          pending.action_type !== 'local_google_upload'
        ) {
          await apiFetch('/api/actions/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirmationId: pending.id }),
          });
        }
        setResolvedIds((prev) => ({ ...prev, [pending.id]: 'cancelled' }));
        setMessages((prev) => [
          ...prev,
          {
            id: `cancel-${Date.now()}`,
            role: 'system',
            content: `Ação cancelada pelo usuário: ${pending.summary}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      },
    });
  };

  const sendCommand = async (customText?: string) => {
    const text = (customText ?? prompt).trim();
    if (!text || loading) return;

    if (!customText) setPrompt('');

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: mode === 'proactive' ? 'proactive' : 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      if (targetBridge === 'local-daemon') {
        const localData = await runLocalAssistantTurn({
          prompt: text,
          modelPreference,
          googleToken: accessToken,
          googleEmail: userEmail,
        });

        setMessages((prev) => [
          ...prev,
          {
            id: `daemon-${Date.now()}`,
            role: 'assistant',
            content: localData.reply,
            timestamp: new Date().toISOString(),
            steps: localData.steps,
            pendingConfirmations: localData.pendingConfirmations,
            screens: localData.screens,
            usage: localData.usage,
            thinkingTrace: localData.thinkingTrace,
          },
        ]);
        if (localData.thinkingTrace) onTraceUpdate?.(localData.thinkingTrace);
        if (localData.usage) onTurnUsage?.(localData.usage);
        if (localData.screens.length > 0) onScreensDrawn?.(localData.screens);
        return;
      }

      const data = await streamAssistantTurn({
        prompt: text,
        sessionId: 'primary-hud',
        mode,
        modelPreference,
        userEmail,
        accessToken,
        onRoutingState: onRoutingStateChange,
        onTraceUpdate,
      });

      if (data.backgroundJob) {
        onBackgroundJobStarted?.(data.backgroundJob);
        setMessages((prev) => [
          ...prev,
          {
            id: `asst-bg-${data.backgroundJob!.id}`,
            role: 'assistant',
            modality: 'text',
            content:
              data.ackMessage ||
              data.reply ||
              'Tarefa iniciada em segundo plano. Pode continuar conversando normalmente.',
            timestamp: new Date().toISOString(),
            thinkingTrace: data.thinkingTrace,
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `asst-${Date.now()}`,
          role: 'assistant',
          modality: 'text',
          content: data.reply,
          timestamp: new Date().toISOString(),
          steps: data.steps,
          pendingConfirmations: data.pendingConfirmations,
          screens: data.screens,
          usage: data.usage,
          thinkingTrace: data.thinkingTrace,
        },
      ]);
      if (data.usage) {
        onTurnUsage?.(data.usage);
      }
      if (Array.isArray(data.screens) && data.screens.length > 0) {
        onScreensDrawn?.(data.screens as HolographicScreenSpec[]);
      }
      onUsageUpdated?.();
    } catch (err: unknown) {
      onRoutingStateChange?.({
        phase: 'idle',
        activeModel: modelPreference,
        tier: 'lite',
        routingMode: modelPreference === 'auto' ? 'auto' : 'manual',
      });
      const msg = err instanceof Error ? err.message : 'Erro de comunicação.';
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'system',
          content: `Erro: ${msg}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const runProactiveSweep = async () => {
    if (loading) return;
    setLoading(true);
    setMessages((prev) => [
      ...prev,
      {
        id: `sweep-req-${Date.now()}`,
        role: 'proactive',
        content: 'Executando varredura proativa nas regras ativas (Linux local + Google Workspace)...',
        timestamp: new Date().toISOString(),
      },
    ]);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const res = await apiFetch('/api/assistant/proactive-sweep', {
        method: 'POST',
        headers,
        body: JSON.stringify({ userEmail, modelPreference }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha na varredura proativa.');

      setMessages((prev) => [
        ...prev,
        {
          id: `sweep-res-${Date.now()}`,
          role: 'assistant',
          content: data.reply,
          timestamp: new Date().toISOString(),
          steps: data.steps,
          pendingConfirmations: data.pendingConfirmations,
          usage: data.usage,
        },
      ]);
      onUsageUpdated?.();
    } catch (err: unknown) {
      setMessages((prev) => [
        ...prev,
        {
          id: `sweep-err-${Date.now()}`,
          role: 'system',
          content: `Erro na varredura proativa: ${err instanceof Error ? err.message : 'desconhecido'}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Workspace Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-6 py-3 bg-[#0D1118]">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1 rounded-lg bg-[#161D28] p-1 border border-white/8">
            <button
              type="button"
              onClick={() => setMode('reactive')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'reactive'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Reativo
            </button>
            <button
              type="button"
              onClick={() => setMode('proactive')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'proactive'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Proativo
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-[#161D28] p-1 border border-white/8">
            <button
              type="button"
              onClick={() => setTargetBridge('server')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                targetBridge === 'server'
                  ? 'bg-white/10 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Núcleo Integrado
            </button>
            <button
              type="button"
              onClick={() => setTargetBridge('local-daemon')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                targetBridge === 'local-daemon'
                  ? 'bg-white/10 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Daemon Local (:3847)
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenModelSettings}
            title="Configurar modelos e monitoramento em Configurações"
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#161D28] px-3 py-1.5 text-xs text-slate-300 hover:border-amber-500/40 hover:text-amber-200 transition-colors cursor-pointer"
          >
            <Cpu className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span>{modelPreference === 'auto' ? 'Auto (Escalonamento)' : modelPreference}</span>
          </button>

          {targetBridge === 'local-daemon' && (
            <button
              type="button"
              onClick={onOpenLocalSettings}
              className="text-xs text-slate-300 hover:text-amber-200 underline decoration-dotted cursor-pointer"
            >
              {localAuthed
                ? 'Aegis Local autenticado · Sync Google pronto'
                : localDaemonOnline === true
                ? 'Daemon detectado — clique para desbloquear'
                : localDaemonOnline === false
                ? 'Daemon offline nesta máquina'
                : 'Verificando daemon...'}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={runProactiveSweep}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/12 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/22 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Varredura Proativa</span>
          </button>
          <button
            type="button"
            onClick={onOpenMinimalHud}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#141B29] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/40 transition-colors whitespace-nowrap shrink-0"
          >
            <span>Voltar ao Núcleo 3D</span>
          </button>
        </div>
      </div>

      {/* Conversation Stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-3xl pt-8 space-y-8">
            <div className="space-y-2.5">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-100 text-balance">
                Orquestrador Autônomo Aegis
              </h2>
              <p className="text-sm leading-relaxed text-slate-400 max-w-2xl">
                Coordenação inteligente de subagentes locais, web, projeção visual e nuvem — com escalonamento
                automático de modelos e auto-evolução de código para superar limitações criando novas funções.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => sendCommand(q)}
                  className="text-left rounded-xl border border-white/8 bg-[#11161F] p-4 hover:border-sky-500/40 hover:bg-[#141B26] transition-colors"
                >
                  <div className="flex items-center gap-2 text-xs text-sky-400 mb-1.5">
                    <FolderKanban className="h-3.5 w-3.5" />
                    <span>Ação sugerida</span>
                  </div>
                  <p className="text-sm text-slate-200 leading-snug">{q}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.map((msg) => (
              <div key={msg.id} className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-200">
                    {msg.role === 'user'
                      ? 'Você'
                      : msg.role === 'proactive'
                      ? 'Execução Proativa'
                      : msg.role === 'system'
                      ? 'Registro do Sistema'
                      : 'Aegis'}
                  </span>
                  {msg.modality === 'voice' && (
                    <span className="font-mono text-[10px] uppercase text-amber-400">VOZ AO VIVO</span>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {new Date(msg.timestamp).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  {msg.usage && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-amber-400 tabular-nums" title={msg.usage.routingReason}>
                        {msg.usage.escalationTrail && msg.usage.escalationTrail.length > 0
                          ? `${msg.usage.escalationTrail[0].fromModel} → ${msg.usage.model}`
                          : msg.usage.model}{' '}
                        ({msg.usage.routingMode === 'auto' ? 'Auto' : 'Manual'})
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-slate-400 tabular-nums">
                        {msg.usage.totalTokens.toLocaleString('pt-BR')} tokens ({msg.usage.promptTokens}↑ /{' '}
                        {msg.usage.outputTokens}↓) · {msg.usage.latencyMs} ms
                      </span>
                    </>
                  )}
                </div>

                <div
                  className={`spatial-card rounded-xl px-4 py-3.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'border-amber-500/35 bg-amber-500/10 text-slate-100'
                      : msg.role === 'system'
                      ? 'border-white/8 bg-[#0E131B] text-slate-300 font-mono text-xs'
                      : 'text-slate-200'
                  }`}
                >
                  {msg.content}
                </div>

                {msg.steps && msg.steps.length > 0 && (
                  <div className="space-y-1.5 pl-1">
                    {msg.steps.map((step, idx) => {
                      const stepObj = step.result as { stdout?: string; stderr?: string } | undefined;
                      return (
                        <div
                          key={`${msg.id}-step-${idx}`}
                          className="space-y-1 text-xs text-slate-400 py-1 border-b border-white/5 last:border-b-0"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <Wrench className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                              <span className="font-mono text-slate-300 truncate">{step.tool}</span>
                              <span className="text-slate-500 truncate">
                                {Object.keys(step.args).length > 0 ? JSON.stringify(step.args) : ''}
                              </span>
                            </div>
                            <span
                              className={`whitespace-nowrap shrink-0 font-mono ${
                                step.status === 'executed'
                                  ? 'text-emerald-400'
                                  : step.status === 'awaiting_confirmation'
                                  ? 'text-amber-400'
                                  : 'text-rose-400'
                              }`}
                            >
                              {step.status === 'executed'
                                ? 'Executado'
                                : step.status === 'awaiting_confirmation'
                                ? 'Aguardando confirmação'
                                : 'Erro'}
                            </span>
                          </div>
                          {(stepObj?.stdout || stepObj?.stderr) && (
                            <pre className="rounded-lg border border-white/6 bg-[#090D14] px-3 py-2 font-mono text-[11px] text-slate-300 max-h-36 overflow-y-auto whitespace-pre-wrap">
                              {stepObj.stdout || stepObj.stderr}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {msg.pendingConfirmations && msg.pendingConfirmations.length > 0 && (
                  <div className="space-y-2 pt-1">
                    {msg.pendingConfirmations.map((pending) => {
                      const state = resolvedIds[pending.id];
                      return (
                        <div
                          key={pending.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/8 px-4 py-3"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {state === 'confirmed' ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                            ) : state === 'cancelled' ? (
                              <Clock className="h-4 w-4 text-slate-400 shrink-0" />
                            ) : (
                              <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-slate-100">{pending.summary}</p>
                              <p className="text-[11px] font-mono text-slate-400 truncate">
                                {pending.action_type} · {pending.target}
                              </p>
                            </div>
                          </div>

                          {state ? (
                            <span className="text-xs font-medium text-slate-300 whitespace-nowrap shrink-0">
                              {state === 'confirmed' ? 'Confirmado' : 'Cancelado'}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleConfirmPending(pending)}
                              className="px-3.5 py-1.5 rounded-lg bg-amber-400 text-xs font-semibold text-slate-950 hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0"
                            >
                              Revisar e Confirmar
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2.5 text-xs text-sky-400 py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Processando ferramentas Linux, navegação web e integrações Cloud...</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Command Input Bar */}
      <div className="border-t border-white/8 bg-[#0D1118] px-6 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendCommand();
          }}
          className="mx-auto max-w-3xl flex items-end gap-3"
        >
          <div className="flex-1 rounded-xl border border-white/10 bg-[#11161F] focus-within:border-sky-500/60 transition-colors px-4 py-2.5">
            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendCommand();
                }
              }}
              placeholder={
                mode === 'proactive'
                  ? 'Descreva um objetivo para o Aegis investigar e propor ações proativas...'
                  : 'Dê uma instrução para o Aegis (Linux local, navegação web ou Google Workspace)...'
              }
              className="w-full resize-none bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-sky-500 px-5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Enviar</span>
          </button>
        </form>
        <div className="mx-auto max-w-3xl mt-2 flex items-center justify-between text-[11px] text-slate-500">
          <div className="flex items-center gap-2">
            <Cpu className="h-3 w-3" />
            <span>
              Modo do modelo: {modelPreference === 'auto' ? 'Automático Inteligente' : modelPreference} · Memória SQLite
              ativa
            </span>
          </div>
          <span>Enter envia · Shift+Enter quebra linha</span>
        </div>
      </div>
    </div>
  );
};
