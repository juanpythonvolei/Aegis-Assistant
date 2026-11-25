import {
  ArrowRight,
  Brain,
  CheckCircle2,
  Cloud,
  Code2,
  Cpu,
  FileText,
  Globe,
  Layers,
  Loader2,
  Network,
  Play,
  Power,
  RefreshCw,
  Smartphone,
  Sparkles,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import type { EvolvedCapability, SubagentRunRecord } from '../types';

interface OrchestratorEvolutionViewProps {
  onSendDirectiveToOrchestrator?: (prompt: string) => void;
}

const SUBAGENT_CATALOG = [
  {
    id: 'research_drafting',
    name: 'Coletor & Redator Base',
    roleLabel: 'Trabalho Bruto',
    model: 'Gemini 3.1 Flash Lite',
    scope: 'Triagem de memória, levantamento factual, síntese preliminar e rascunhos estruturados',
    icon: FileText,
  },
  {
    id: 'local_system',
    name: 'Sistema Local',
    roleLabel: 'Trabalho Bruto',
    model: 'Gemini 3.1 Flash Lite',
    scope: 'Comandos Linux/Windows, leitura/listagem de arquivos, organização e diagnósticos',
    icon: Terminal,
  },
  {
    id: 'mobile_devices',
    name: 'Dispositivos Android & iOS',
    roleLabel: 'Trabalho Bruto',
    model: 'Gemini 3.1 Flash Lite',
    scope: 'Inspeção de telemetria, arquivos, apps, notificações e ações remotas ADB/Termux/iOS',
    icon: Smartphone,
  },
  {
    id: 'workspace_cloud',
    name: 'Google Workspace',
    roleLabel: 'Trabalho Bruto',
    model: 'Gemini 3.1 Flash Lite',
    scope: 'Coleta e organização no Drive, Gmail, Calendar, Docs, Sheets e Tasks',
    icon: Cloud,
  },
  {
    id: 'web_operator',
    name: 'Operador Web',
    roleLabel: 'Trabalho Bruto',
    model: 'Gemini 4 Hydrogen',
    scope: 'Navegação em sub-menus, extração estruturada, anexos e rotinas com Cofre AES-256',
    icon: Globe,
  },
  {
    id: 'visual_designer',
    name: 'Projeção Visual',
    roleLabel: 'Trabalho Bruto',
    model: 'Gemini 4 Hydrogen',
    scope: 'Desenho dinâmico de telas holográficas, dashboards KPI e artefatos HTML/SVG',
    icon: Layers,
  },
  {
    id: 'code_architect',
    name: 'Auto-Evolução de Código',
    roleLabel: 'Trabalho Bruto',
    model: 'Gemini 4 Hydrogen',
    scope: 'Síntese, validação em sandbox e registro permanente de novas funções no Aegis',
    icon: Code2,
  },
];

const EVOLUTION_CHALLENGES = [
  'Avalie se você já tem uma função para analisar logs estruturados e calcular taxa de erros por minuto. Se não tiver, crie essa função no seu próprio código, teste-a e demonstre o resultado.',
  'Crie uma nova capacidade no seu próprio código para converter planilhas CSV em relatório JSON com estatísticas (soma, média, mínimo e máximo) e valide com dados reais.',
  'Orquestre o subagente local e o subagente visual para diagnosticar a máquina atual e projetar uma tela holográfica executiva com recomendações autônomas.',
];

export const OrchestratorEvolutionView: React.FC<OrchestratorEvolutionViewProps> = ({
  onSendDirectiveToOrchestrator,
}) => {
  const [capabilities, setCapabilities] = useState<EvolvedCapability[]>([]);
  const [runs, setRuns] = useState<SubagentRunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCapName, setSelectedCapName] = useState<string | null>(null);
  const [testArgsText, setTestArgsText] = useState('{}');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    output?: unknown;
    error?: string;
    logs?: string[];
    durationMs?: number;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [capRes, runsRes] = await Promise.all([
        apiFetch('/api/evolution/capabilities'),
        apiFetch('/api/orchestrator/runs'),
      ]);
      if (capRes.ok) {
        const capData = await capRes.json();
        const list = (capData.capabilities || []) as EvolvedCapability[];
        setCapabilities(list);
        if (list.length > 0 && !selectedCapName) {
          setSelectedCapName(list[0].name);
        }
      }
      if (runsRes.ok) {
        const runsData = await runsRes.json();
        setRuns((runsData.runs || []) as SubagentRunRecord[]);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedCapName]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedCap = capabilities.find((c) => c.name === selectedCapName) || capabilities[0] || null;

  const handleToggle = async (cap: EvolvedCapability) => {
    const res = await apiFetch(`/api/evolution/capabilities/${encodeURIComponent(cap.name)}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !cap.enabled }),
    });
    if (res.ok) {
      await loadData();
    }
  };

  const handleDelete = async (cap: EvolvedCapability) => {
    const res = await apiFetch(`/api/evolution/capabilities/${encodeURIComponent(cap.name)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      if (selectedCapName === cap.name) setSelectedCapName(null);
      setTestResult(null);
      await loadData();
    }
  };

  const handleRunTest = async (cap: EvolvedCapability) => {
    setTestRunning(true);
    setTestResult(null);
    try {
      let parsedArgs: Record<string, unknown> = {};
      if (testArgsText.trim()) {
        parsedArgs = JSON.parse(testArgsText) as Record<string, unknown>;
      }
      const res = await apiFetch(`/api/evolution/capabilities/${encodeURIComponent(cap.name)}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: parsedArgs }),
      });
      const data = await res.json();
      setTestResult(data);
      await loadData();
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : 'JSON de argumentos inválido.',
      });
    } finally {
      setTestRunning(false);
    }
  };

  const runsBySubagent = runs.reduce<Record<string, number>>((acc, r) => {
    acc[r.subagent_name] = (acc[r.subagent_name] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="h-full overflow-y-auto bg-[#070B12] p-5 sm:p-6 space-y-6">
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
        <div className="space-y-1.5 max-w-2xl">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-400">
            <Network className="h-3.5 w-3.5" />
            <span>Arquitetura Multi-Agente & Auto-Evolução</span>
          </div>
          <h3 className="font-display text-xl font-semibold text-slate-100">
            Orquestrador de Subagentes e Evolução de Código
          </h3>
          <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
            O Aegis coordena subagentes especializados em sistema local, web, nuvem e projeção visual. Diante de
            impossibilidades ou bloqueios, sintetiza novas funções validadas em sandbox diretamente em seu código.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-[#101624] px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-amber-500/40 hover:text-amber-200 transition-colors cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-amber-400' : ''}`} />
          <span>Atualizar Telemetria</span>
        </button>
      </div>

      {/* Worker -> Senior Curator Architecture Overview */}
      <section className="rounded-2xl border border-amber-500/25 bg-[#0B101C] p-4 grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-3">
        <div className="space-y-1">
          <div className="font-mono text-[10px] uppercase tracking-wider text-amber-400">
            1 · Decompositor de Missão
          </div>
          <p className="text-xs font-semibold text-slate-100">Gemini 3.1 Flash Lite</p>
          <p className="text-[11px] text-slate-400 leading-snug">
            Mesmo em tarefas modestas, divide o objetivo em 1 a 3 sub-tarefas focadas.
          </p>
        </div>

        <ArrowRight className="hidden md:block h-4 w-4 text-slate-500" />

        <div className="space-y-1">
          <div className="font-mono text-[10px] uppercase tracking-wider text-amber-300">
            2 · Subagentes Trabalhadores
          </div>
          <p className="text-xs font-semibold text-slate-100">Flash Lite / 4 Hydrogen</p>
          <p className="text-[11px] text-slate-400 leading-snug">
            Executam o trabalho bruto em paralelo: coleta, leitura, ferramentas e rascunhos.
          </p>
        </div>

        <ArrowRight className="hidden md:block h-4 w-4 text-slate-500" />

        <div className="space-y-1">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-sky-400">
            <Brain className="h-3 w-3" />
            <span>3 · Curador Sênior</span>
          </div>
          <p className="text-xs font-semibold text-slate-100">4 Hydrogen → 4 Neon → 4 Carbon</p>
          <p className="text-[11px] text-slate-400 leading-snug">
            Audita fatos, corrige lacunas, raciocina com profundidade e entrega a síntese final.
          </p>
        </div>
      </section>

      {/* Subagent Topology Grid */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400">
            Subagentes Trabalhadores Especializados ({SUBAGENT_CATALOG.length})
          </h4>
          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
            {runs.length} execuções registradas
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {SUBAGENT_CATALOG.map((sub) => {
            const Icon = sub.icon;
            const count = runsBySubagent[sub.id] || 0;
            return (
              <div
                key={sub.id}
                className="spatial-card rounded-xl p-4 flex flex-col justify-between gap-3"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/35 bg-amber-500/12 text-amber-300">
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                      {count} exec.
                    </span>
                  </div>
                  <div>
                    <h5 className="text-xs font-semibold text-slate-100">{sub.name}</h5>
                    <p className="font-mono text-[10px] text-amber-400/90 mt-0.5">
                      {sub.roleLabel} · {sub.model}
                    </p>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-400">{sub.scope}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Self-Evolving Capabilities Section */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Code2 className="h-4 w-4 text-amber-400" />
            <h4 className="text-xs font-mono uppercase tracking-wider text-slate-300">
              Capacidades Auto-Evoluídas no Código ({capabilities.length})
            </h4>
          </div>
          <span className="font-mono text-[11px] text-slate-500">
            Diretório isolado: server/evolved_skills/
          </span>
        </div>

        {capabilities.length === 0 ? (
          <div className="spatial-card rounded-2xl p-6 space-y-4">
            <div className="space-y-1.5">
              <h5 className="text-sm font-semibold text-slate-100">
                Nenhuma função sintetizada ainda
              </h5>
              <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
                Quando você pedir uma tarefa que ultrapasse as ferramentas nativas (por exemplo, um parser customizado,
                cálculo técnico específico ou automação de dados), o Aegis avaliará a impossibilidade, criará a função
                em JavaScript, testará automaticamente e passará a tê-la permanentemente.
              </p>
            </div>
            {onSendDirectiveToOrchestrator && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {EVOLUTION_CHALLENGES.map((challenge) => (
                  <button
                    key={challenge}
                    type="button"
                    onClick={() => onSendDirectiveToOrchestrator(challenge)}
                    className="text-left rounded-xl border border-amber-500/25 bg-[#0D1320] p-3.5 hover:border-amber-400/60 hover:bg-[#121A2B] transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-amber-400 mb-1.5">
                      <Sparkles className="h-3 w-3" />
                      <span>Testar Evolução / Orquestração</span>
                    </div>
                    <p className="text-xs text-slate-200 leading-snug">{challenge}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* List of Evolved Functions */}
            <div className="lg:col-span-5 space-y-2">
              {capabilities.map((cap) => {
                const isSelected = selectedCap?.name === cap.name;
                return (
                  <div
                    key={cap.id}
                    onClick={() => {
                      setSelectedCapName(cap.name);
                      setTestResult(null);
                    }}
                    className={`spatial-card rounded-xl p-3.5 cursor-pointer transition-all ${
                      isSelected ? 'border-amber-400/60 bg-amber-500/10' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-amber-300 truncate">
                            {cap.name}
                          </span>
                          <span className="font-mono text-[10px] text-slate-400">v{cap.version}</span>
                        </div>
                        <p className="text-xs text-slate-300 mt-1 line-clamp-2">{cap.description}</p>
                      </div>
                      <span
                        className={`font-mono text-[10px] shrink-0 ${
                          cap.enabled ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      >
                        {cap.enabled ? 'Ativa' : 'Pausada'}
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-[10px] font-mono text-slate-500 border-t border-white/6 pt-2">
                      <span>{cap.run_count} execuções</span>
                      <span>Teste: {cap.test_status === 'passed' ? 'Aprovado' : cap.test_status}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Selected Capability Inspector & Sandbox Runner */}
            {selectedCap && (
              <div className="lg:col-span-7 spatial-card rounded-xl p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/8 pb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h5 className="font-mono text-sm font-semibold text-amber-300">
                        {selectedCap.name}
                      </h5>
                      <span className="font-mono text-[11px] text-slate-400">
                        v{selectedCap.version} · {selectedCap.file_path}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-1">{selectedCap.description}</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      <span className="text-amber-400/90 font-medium">Motivação / Limitação superada:</span>{' '}
                      {selectedCap.limitation_reason}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleToggle(selectedCap)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                        selectedCap.enabled
                          ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-300 hover:bg-emerald-500/20'
                          : 'border-white/12 bg-[#121826] text-slate-300 hover:border-amber-500/40'
                      }`}
                    >
                      <Power className="h-3.5 w-3.5" />
                      <span>{selectedCap.enabled ? 'Ativa' : 'Ativar'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(selectedCap)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-500/35 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-500/20 transition-colors cursor-pointer"
                      title="Remover função do código"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Source Code Preview */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                    Código-Fonte Sintetizado (Sandbox VM)
                  </span>
                  <pre className="rounded-xl border border-white/10 bg-[#05080F] p-3.5 font-mono text-[11px] leading-relaxed text-amber-100/90 max-h-60 overflow-auto whitespace-pre-wrap">
                    {selectedCap.code}
                  </pre>
                </div>

                {/* Live Sandbox Test Runner */}
                <div className="space-y-2 border-t border-white/8 pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                      Testar Execução em Sandbox (JSON)
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleRunTest(selectedCap)}
                      disabled={testRunning}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      {testRunning ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      <span>Executar Teste</span>
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={testArgsText}
                    onChange={(e) => setTestArgsText(e.target.value)}
                    placeholder='{"exemplo": "valor"}'
                    className="w-full rounded-xl border border-white/10 bg-[#05080F] px-3 py-2 font-mono text-xs text-slate-200 focus:border-amber-500/50 focus:outline-none"
                  />
                  {testResult && (
                    <div
                      className={`rounded-xl border p-3 font-mono text-[11px] space-y-1 ${
                        testResult.ok
                          ? 'border-emerald-500/35 bg-emerald-500/8 text-emerald-200'
                          : 'border-rose-500/35 bg-rose-500/8 text-rose-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">
                          {testResult.ok ? 'Execução validada' : 'Falha na execução'}
                        </span>
                        {typeof testResult.durationMs === 'number' && <span>{testResult.durationMs} ms</span>}
                      </div>
                      <pre className="whitespace-pre-wrap break-all text-slate-200 max-h-40 overflow-auto">
                        {testResult.ok
                          ? JSON.stringify(testResult.output, null, 2)
                          : testResult.error || 'Erro desconhecido'}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Subagent Execution Log */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-sky-400" />
          <h4 className="text-xs font-mono uppercase tracking-wider text-slate-300">
            Histórico de Delegações de Subagentes ({runs.length})
          </h4>
        </div>

        {runs.length === 0 ? (
          <div className="rounded-xl border border-white/8 bg-[#0B101A] p-4 text-xs text-slate-400">
            Nenhuma delegação executada ainda. Ao dar uma tarefa complexa ao Aegis, as execuções dos subagentes
            aparecerão aqui com modelo, latência e resumo verificado.
          </div>
        ) : (
          <div className="space-y-2">
            {runs.slice(0, 15).map((run) => (
              <div
                key={run.id}
                className="spatial-card rounded-xl px-4 py-3 flex flex-col gap-1.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    {run.status === 'ok' ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                    )}
                    <span className="font-mono text-amber-300 font-semibold">{run.subagent_name}</span>
                    <span className="text-slate-400 truncate">· {run.objective}</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[11px] text-slate-400 shrink-0 tabular-nums">
                    <span>{run.model}</span>
                    <span>·</span>
                    <span>{run.steps_count} passos</span>
                    <span>·</span>
                    <span>{run.latency_ms} ms</span>
                  </div>
                </div>
                {run.summary && (
                  <p className="text-xs text-slate-300 leading-relaxed line-clamp-3 pl-5">
                    {run.summary}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
