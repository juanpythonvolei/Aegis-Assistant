import {
  ArrowRight,
  ArrowUpRight,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Cpu,
  GitBranch,
  Loader2,
  Network,
  Settings,
  Sparkles,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { formatModelShortName } from '../lib/assistantStream';
import type { LiveModelRoutingState, ThinkingTraceEntry, TurnUsageStats } from '../types';

interface ThinkingActivityPanelProps {
  open: boolean;
  isBusy: boolean;
  routingState: LiveModelRoutingState;
  trace: ThinkingTraceEntry[];
  lastUsage: TurnUsageStats | null;
  onClose: () => void;
  onOpenModelsSettings: () => void;
}

export const ThinkingActivityPanel: React.FC<ThinkingActivityPanelProps> = ({
  open,
  isBusy,
  routingState,
  trace,
  lastUsage,
  onClose,
  onOpenModelsSettings,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  // Auto-scroll to latest step while streaming
  useEffect(() => {
    if (open && isBusy && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, isBusy, trace.length]);

  if (!open) return null;

  const toggleExpand = (id: string, defaultExpanded: boolean) => {
    setExpandedIds((prev) => {
      const current = prev[id] !== undefined ? prev[id] : defaultExpanded;
      return { ...prev, [id]: !current };
    });
  };

  const planEntry = trace.find((t) => t.kind === 'plan');
  const workerEntries = trace.filter((t) => t.kind === 'worker');
  const completedWorkers = workerEntries.filter((w) => w.status === 'done').length;
  const curatorModelLabel = routingState.curatorModel
    ? formatModelShortName(routingState.curatorModel)
    : lastUsage?.curatorModel
    ? formatModelShortName(lastUsage.curatorModel)
    : routingState.activeModel !== 'auto'
    ? formatModelShortName(routingState.activeModel)
    : null;

  const uniqueWorkerModels = Array.from(
    new Set(
      [
        ...(planEntry?.subtasks?.map((s) => s.model) || []),
        ...workerEntries.map((w) => w.model || '').filter(Boolean),
        ...(lastUsage?.workerModels || []),
      ].filter(Boolean)
    )
  ).map(formatModelShortName);

  return (
    <>
      {/* Click-outside backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Interactive Live Thinking & Activity Inspector */}
      <aside
        role="dialog"
        aria-label="Atividade de Pensamento e Subagentes"
        onClick={(e) => e.stopPropagation()}
        className="fixed top-16 right-4 sm:right-6 z-50 w-[min(94vw,470px)] max-h-[min(78vh,660px)] flex flex-col overflow-hidden rounded-2xl border border-amber-500/32 bg-[#080C15]/98 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.85)] select-text"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#0C111E] px-4 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-lg border shrink-0 ${
                isBusy
                  ? 'border-amber-400/50 bg-amber-500/15 text-amber-300'
                  : 'border-white/12 bg-white/5 text-amber-400'
              }`}
            >
              {isBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Brain className="h-3.5 w-3.5" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-slate-100 truncate">
                  {isBusy ? 'Pensando e Orquestrando...' : 'Pensamento & Atividade'}
                </h3>
                {trace.length > 0 && (
                  <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                    {trace.length} {trace.length === 1 ? 'evento' : 'eventos'}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                {routingState.reason || 'Subagentes leves no trabalho bruto · Modelo maior na curadoria'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/8 hover:text-slate-100 transition-colors cursor-pointer"
            aria-label="Fechar inspetor de pensamento"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Worker -> Curator Pipeline Strip */}
        {(uniqueWorkerModels.length > 0 || curatorModelLabel) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 bg-[#0A0F1B] px-4 py-2 text-[10px] font-mono">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-slate-400">Trabalho Bruto:</span>
              <span className="text-amber-300 font-medium truncate">
                {uniqueWorkerModels.length > 0 ? uniqueWorkerModels.join(' + ') : 'Flash Lite'}
                {workerEntries.length > 0 ? ` (${completedWorkers}/${workerEntries.length})` : ''}
              </span>
            </div>
            <ArrowRight className="h-3 w-3 text-slate-500 shrink-0" />
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-slate-400">Curador:</span>
              <span className="text-sky-300 font-medium truncate">
                {curatorModelLabel || 'Auto'}
              </span>
            </div>
          </div>
        )}

        {/* Timeline Body */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-3.5 space-y-2.5"
        >
          {trace.length === 0 ? (
            <div className="py-8 text-center space-y-2.5">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-400">
                <Sparkles className="h-5 w-5" />
              </div>
              <p className="text-xs font-medium text-slate-200">
                Inspetor de Pensamento em Tempo Real
              </p>
              <p className="text-[11px] leading-relaxed text-slate-400 max-w-xs mx-auto">
                Envie um comando para acompanhar aqui a subdivisão em subagentes leves (trabalho bruto),
                cada ferramenta acionada, o raciocínio do Gemini e a revisão final do Curador Sênior.
              </p>
            </div>
          ) : (
            trace.map((entry, idx) => {
              const isLast = idx === trace.length - 1;
              const defaultExpanded =
                entry.kind === 'plan' ||
                (entry.kind === 'thought' && (isBusy || isLast)) ||
                (entry.kind === 'worker' && entry.status === 'running');
              const isExpanded =
                expandedIds[entry.id] !== undefined ? expandedIds[entry.id] : defaultExpanded;

              // Status indicator icon
              const statusIcon =
                entry.status === 'running' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400 shrink-0" />
                ) : entry.status === 'error' ? (
                  <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                );

              // PLAN CARD
              if (entry.kind === 'plan') {
                return (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-amber-500/28 bg-[#0E1422] p-3 space-y-2"
                  >
                    <button
                      type="button"
                      onClick={() => toggleExpand(entry.id, defaultExpanded)}
                      className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <GitBranch className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        <span className="text-xs font-semibold text-amber-100 truncate">
                          {entry.title}
                        </span>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      )}
                    </button>

                    {entry.detail && (
                      <p className="text-[11px] leading-relaxed text-slate-300">
                        {entry.detail}
                      </p>
                    )}

                    {isExpanded && entry.subtasks && entry.subtasks.length > 0 && (
                      <div className="space-y-1.5 pt-1 border-t border-white/8">
                        {entry.subtasks.map((st, sIdx) => (
                          <div
                            key={`${entry.id}-st-${sIdx}`}
                            className="flex items-start justify-between gap-2 rounded-lg bg-[#090D18] px-2.5 py-2 border border-white/6"
                          >
                            <div className="min-w-0 space-y-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[10px] text-amber-400 tabular-nums">
                                  #{sIdx + 1}
                                </span>
                                <span className="text-[11px] font-medium text-slate-200 truncate">
                                  {st.label}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400 leading-snug">
                                {st.objective}
                              </p>
                            </div>
                            <span className="font-mono text-[10px] text-slate-400 shrink-0">
                              {formatModelShortName(st.model)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              // THOUGHT CARD (Live Gemini Thinking)
              if (entry.kind === 'thought') {
                const isCuratorThought = entry.role === 'curator';
                return (
                  <div
                    key={entry.id}
                    className={`rounded-xl border-l-2 pl-3 pr-2.5 py-2 transition-colors ${
                      isCuratorThought
                        ? 'border-sky-400/70 bg-sky-500/6'
                        : 'border-amber-400/60 bg-amber-500/5'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleExpand(entry.id, defaultExpanded)}
                      className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Brain
                          className={`h-3.5 w-3.5 shrink-0 ${
                            isCuratorThought ? 'text-sky-400' : 'text-amber-400'
                          }`}
                        />
                        <span className="text-[11px] font-medium text-slate-200 truncate">
                          Pensamento · {entry.title}
                        </span>
                        {entry.model && (
                          <span className="font-mono text-[10px] text-slate-400 shrink-0">
                            {formatModelShortName(entry.model)}
                          </span>
                        )}
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      )}
                    </button>

                    {isExpanded && entry.detail && (
                      <div className="mt-2 text-[11.5px] leading-relaxed text-slate-300 whitespace-pre-wrap max-h-56 overflow-y-auto pr-1">
                        {entry.detail}
                      </div>
                    )}
                  </div>
                );
              }

              // WORKER SUBAGENT CARD
              if (entry.kind === 'worker') {
                return (
                  <div
                    key={entry.id}
                    className={`rounded-xl border p-2.5 transition-colors ${
                      entry.status === 'running'
                        ? 'border-amber-400/45 bg-[#121623]'
                        : entry.status === 'error'
                        ? 'border-rose-500/35 bg-[#190F14]'
                        : 'border-white/10 bg-[#0C111D]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleExpand(entry.id, defaultExpanded)}
                      className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {statusIcon}
                        <Network className="h-3.5 w-3.5 text-amber-400/90 shrink-0" />
                        <span className="text-xs font-medium text-slate-100 truncate">
                          {entry.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 font-mono text-[10px]">
                        {entry.model && (
                          <span className="text-amber-300/90">
                            {formatModelShortName(entry.model)}
                          </span>
                        )}
                        {typeof entry.latencyMs === 'number' && entry.latencyMs > 0 && (
                          <span className="text-slate-400 tabular-nums">
                            {entry.latencyMs}ms
                          </span>
                        )}
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                        )}
                      </div>
                    </button>

                    {isExpanded && entry.detail && (
                      <div className="mt-2 pt-2 border-t border-white/8 text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap max-h-44 overflow-y-auto">
                        {entry.detail}
                      </div>
                    )}
                  </div>
                );
              }

              // CURATOR PHASE CARD
              if (entry.kind === 'curator') {
                return (
                  <div
                    key={entry.id}
                    className={`rounded-xl border p-3 space-y-1 ${
                      entry.status === 'running'
                        ? 'border-sky-400/55 bg-[#0C1626]'
                        : 'border-sky-500/30 bg-[#0A1220]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {statusIcon}
                        <Sparkles className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                        <span className="text-xs font-semibold text-sky-100 truncate">
                          {entry.title}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-sky-300/90 shrink-0">
                        Curadoria
                      </span>
                    </div>
                    {entry.detail && (
                      <p className="text-[11px] leading-relaxed text-slate-300 pl-5">
                        {entry.detail}
                      </p>
                    )}
                  </div>
                );
              }

              // TOOL CALL ROW
              if (entry.kind === 'tool') {
                return (
                  <div
                    key={entry.id}
                    className="flex items-start gap-2 rounded-lg border border-white/8 bg-[#0A0F1A] px-2.5 py-2"
                  >
                    <div className="mt-0.5">{statusIcon}</div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Wrench className="h-3 w-3 text-slate-400 shrink-0" />
                          <span className="font-mono text-[11px] text-slate-200 truncate">
                            {entry.title}
                          </span>
                        </div>
                        {entry.model && (
                          <span className="font-mono text-[10px] text-slate-500 shrink-0">
                            {formatModelShortName(entry.model)}
                          </span>
                        )}
                      </div>
                      {entry.detail && (
                        <p className="text-[11px] text-slate-400 leading-snug break-words">
                          {entry.detail}
                        </p>
                      )}
                    </div>
                  </div>
                );
              }

              // ESCALATION / EVOLUTION / ROUTING ROW
              const RowIcon =
                entry.kind === 'evolution'
                  ? Code2
                  : entry.kind === 'escalation'
                  ? ArrowUpRight
                  : Cpu;
              return (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 rounded-lg border border-white/8 bg-[#0B101C] px-2.5 py-2"
                >
                  <div className="mt-0.5">{statusIcon}</div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <RowIcon className="h-3 w-3 text-amber-400 shrink-0" />
                      <span className="text-[11px] font-medium text-slate-200 truncate">
                        {entry.title}
                      </span>
                    </div>
                    {entry.detail && (
                      <p className="text-[11px] text-slate-400 leading-snug">
                        {entry.detail}
                      </p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer: Token Metrics & Models Settings Link */}
        <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-[#0B101B] px-4 py-2.5">
          <div className="font-mono text-[10px] text-slate-400 tabular-nums truncate">
            {lastUsage ? (
              <span>
                {lastUsage.totalTokens.toLocaleString('pt-BR')} tok
                {lastUsage.thoughtsTokens > 0
                  ? ` · ${lastUsage.thoughtsTokens.toLocaleString('pt-BR')} pensamento`
                  : ''}
                {lastUsage.latencyMs > 0 ? ` · ${(lastUsage.latencyMs / 1000).toFixed(1)}s` : ''}
              </span>
            ) : (
              <span>Pipeline Multi-Agente Ativo</span>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenModelsSettings();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 hover:border-amber-400/50 hover:text-amber-200 transition-colors shrink-0 cursor-pointer"
          >
            <Settings className="h-3 w-3 text-amber-400" />
            <span>Modelos & Consumo</span>
          </button>
        </div>
      </aside>
    </>
  );
};
