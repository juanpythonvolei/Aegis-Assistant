import { Activity, Cpu, RefreshCw, Zap } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import type { ModelPreference, UsageSummary } from '../types';

interface UsageViewProps {
  modelPreference: ModelPreference;
  onChangeModelPreference: (m: ModelPreference) => void;
}

const MODEL_CATALOG: Array<{
  id: ModelPreference;
  name: string;
  tier: string;
  desc: string;
}> = [
  {
    id: 'auto',
    name: 'Escalonamento Automático Inteligente',
    tier: 'Adaptativo',
    desc: 'Avalia complexidade semântica e escala automaticamente entre Flash Lite, Hydrogen, Neon e Carbon — inclusive no meio de tarefas multi-etapas.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    tier: 'Econômico',
    desc: 'Maior limite de chamadas e menor gasto de tokens para leituras rápidas, status do sistema e comandos diretos.',
  },
  {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen',
    tier: 'Balanceado',
    desc: 'Equilíbrio entre velocidade, ferramentas Google Workspace, telas holográficas e navegação web.',
  },
  {
    id: 'gemini-4-neon',
    name: 'Gemini 4 Neon',
    tier: 'Avançado',
    desc: 'Programação, scripts, artefatos HTML/SVG complexos, matemática/STEM e correlação multi-etapas.',
  },
  {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon',
    tier: 'Intermediário+',
    desc: 'Alternativa de alto raciocínio e etapa intermediária na escada automática de fallback.',
  },
  {
    id: 'gemini-4-carbon',
    name: 'Gemini 4 Carbon',
    tier: 'Profundo',
    desc: 'Arquitetura de sistemas, auditoria de segurança e depuração de causa raiz (com fallback resiliente automático).',
  },
];

export const UsageView: React.FC<UsageViewProps> = ({ modelPreference, onChangeModelPreference }) => {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const loadUsage = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/usage');
      if (res.ok) {
        setUsage(await res.json());
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsage();
  }, []);

  const totals = usage?.totals;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-amber-500/14 bg-[#0D1017]/90 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-amber-50">Monitoramento de Tokens &amp; Seleção de Modelos</h2>
          <p className="text-xs text-slate-400">
            Telemetria real capturada a partir de cada chamada Gemini e configuração do roteador inteligente.
          </p>
        </div>
        <button
          type="button"
          onClick={loadUsage}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/22 bg-[#161922] px-3 py-1.5 text-xs font-medium text-amber-100 hover:border-amber-400/45 transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 text-amber-400 ${loading ? 'animate-spin' : ''}`} />
          <span>Atualizar Métricas</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#07090F]">
        {/* KPI Totals */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="spatial-card rounded-2xl p-4">
            <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-amber-400/75">Requisições Totais</span>
            <p className="mt-1 font-mono text-2xl font-semibold text-amber-50 tabular-nums">
              {totals?.requests ?? 0}
            </p>
            <p className="mt-1 text-[11px] font-mono text-slate-500 tabular-nums">
              {totals?.todayRequests ?? 0} hoje
            </p>
          </div>
          <div className="spatial-card rounded-2xl p-4">
            <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-amber-400/75">Total de Tokens</span>
            <p className="mt-1 font-mono text-2xl font-semibold text-amber-300 tabular-nums">
              {(totals?.totalTokens ?? 0).toLocaleString('pt-BR')}
            </p>
            <p className="mt-1 text-[11px] font-mono text-slate-500 tabular-nums">
              Entrada {(totals?.promptTokens ?? 0).toLocaleString('pt-BR')} · Saída {(totals?.outputTokens ?? 0).toLocaleString('pt-BR')}
            </p>
          </div>
          <div className="spatial-card rounded-2xl p-4">
            <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-amber-400/75">Latência Média</span>
            <p className="mt-1 font-mono text-2xl font-semibold text-amber-50 tabular-nums">
              {totals?.avgLatencyMs ?? 0} ms
            </p>
            <p className="mt-1 text-[11px] font-mono text-slate-500 tabular-nums">
              Tempo fim-a-fim por turno
            </p>
          </div>
          <div className="spatial-card rounded-2xl p-4">
            <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-amber-400/75">Ferramentas Executadas</span>
            <p className="mt-1 font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
              {totals?.totalToolCalls ?? 0}
            </p>
            <p className="mt-1 text-[11px] font-mono text-slate-500 tabular-nums">
              Sistema · Telas 3D · Web · Google
            </p>
          </div>
        </div>

        {/* Model Selector Cards */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-50">
            <Cpu className="h-4 w-4 text-amber-400" />
            <span>Preferência Padrão de Modelo</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {MODEL_CATALOG.map((item) => {
              const selected = modelPreference === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChangeModelPreference(item.id)}
                  className={`spatial-card text-left rounded-2xl p-4 transition-all space-y-1.5 ${
                    selected
                      ? '!border-amber-400/65 !bg-amber-500/12 shadow-[0_0_24px_rgba(245,158,11,0.18)]'
                      : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-amber-50">{item.name}</span>
                    <span className="text-[11px] font-mono text-amber-400">{item.tier}</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{item.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Usage By Model & Recent Log */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="spatial-card rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 border-b border-amber-500/14 px-5 py-3 text-sm font-medium text-amber-50 bg-[#0F131C]">
              <Zap className="h-4 w-4 text-amber-400" />
              <span>Distribuição por Modelo</span>
            </div>
            <div className="divide-y divide-white/6">
              {!usage?.byModel.length ? (
                <div className="p-5 text-xs text-slate-500">Nenhuma chamada registrada ainda.</div>
              ) : (
                usage.byModel.map((m) => (
                  <div key={m.model} className="px-5 py-3 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <p className="font-mono font-medium text-amber-50">{m.model}</p>
                      <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                        Média {m.avgLatencyMs} ms · Entrada {m.promptTokens.toLocaleString('pt-BR')} · Saída{' '}
                        {m.outputTokens.toLocaleString('pt-BR')}
                      </p>
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      <p className="text-slate-200">{m.requests} req</p>
                      <p className="text-[11px] text-amber-400">{m.totalTokens.toLocaleString('pt-BR')} tokens</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="spatial-card rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 border-b border-amber-500/14 px-5 py-3 text-sm font-medium text-amber-50 bg-[#0F131C]">
              <Activity className="h-4 w-4 text-amber-400" />
              <span>Histórico Recente de Chamadas</span>
            </div>
            <div className="divide-y divide-white/6 max-h-96 overflow-y-auto">
              {!usage?.recent.length ? (
                <div className="p-5 text-xs text-slate-500">Sem histórico de chamadas ainda.</div>
              ) : (
                usage.recent.map((r) => (
                  <div key={r.id} className="px-5 py-3 space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-amber-50">
                        {r.model} · {r.routing_mode === 'auto' ? 'Auto' : 'Manual'}
                      </span>
                      <span className="font-mono text-amber-400 tabular-nums">
                        {r.total_tokens.toLocaleString('pt-BR')} tok · {r.latency_ms} ms
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">{r.routing_reason}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
