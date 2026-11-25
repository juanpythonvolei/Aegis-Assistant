import {
  Brain,
  History,
  Pin,
  PinOff,
  Play,
  Plus,
  Search,
  Trash2,
  Zap,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import type { InteractionRecord, MemoryFact, ProactiveRule } from '../types';

interface MemoryViewProps {
  accessToken: string | null;
  userEmail?: string;
  onSweepResult: (reply: string) => void;
}

export const MemoryView: React.FC<MemoryViewProps> = ({
  accessToken,
  userEmail,
  onSweepResult,
}) => {
  const [tab, setTab] = useState<'facts' | 'interactions' | 'proactive'>('facts');
  const [query, setQuery] = useState('');
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [interactions, setInteractions] = useState<InteractionRecord[]>([]);
  const [rules, setRules] = useState<ProactiveRule[]>([]);
  const [stats, setStats] = useState({
    totalInteractions: 0,
    totalFacts: 0,
    pinnedFacts: 0,
    activeRules: 0,
  });

  // New fact form
  const [newFactContent, setNewFactContent] = useState('');
  const [newFactCat, setNewFactCat] = useState<MemoryFact['category']>('preference');

  // New proactive rule form
  const [ruleTitle, setRuleTitle] = useState('');
  const [ruleType, setRuleType] = useState<ProactiveRule['trigger_type']>('filesystem');
  const [ruleCondition, setRuleCondition] = useState('');
  const [rulePrompt, setRulePrompt] = useState('');
  const [runningRuleId, setRunningRuleId] = useState<number | null>(null);

  const loadAll = async (q = query) => {
    const [memRes, rulesRes] = await Promise.all([
      apiFetch(`/api/memory?q=${encodeURIComponent(q)}`),
      apiFetch('/api/proactive/rules'),
    ]);
    if (memRes.ok) {
      const m = await memRes.json();
      setFacts(m.facts || []);
      setInteractions(m.interactions || []);
      if (m.stats) setStats(m.stats);
    }
    if (rulesRes.ok) {
      const r = await rulesRes.json();
      setRules(r.rules || []);
    }
  };

  useEffect(() => {
    loadAll('');
  }, []);

  const handleAddFact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFactContent.trim()) return;
    const res = await apiFetch('/api/memory/facts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: newFactCat, content: newFactContent.trim(), pinned: false }),
    });
    if (res.ok) {
      setNewFactContent('');
      await loadAll(query);
    }
  };

  const handleTogglePin = async (id: number) => {
    await apiFetch(`/api/memory/facts/${id}/pin`, { method: 'PATCH' });
    await loadAll(query);
  };

  const handleDeleteFact = async (id: number) => {
    await apiFetch(`/api/memory/facts/${id}`, { method: 'DELETE' });
    await loadAll(query);
  };

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleTitle.trim() || !rulePrompt.trim()) return;
    const res = await apiFetch('/api/proactive/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: ruleTitle.trim(),
        triggerType: ruleType,
        conditionSpec: ruleCondition.trim() || 'manual',
        actionPrompt: rulePrompt.trim(),
      }),
    });
    if (res.ok) {
      setRuleTitle('');
      setRuleCondition('');
      setRulePrompt('');
      await loadAll(query);
    }
  };

  const handleToggleRule = async (id: number) => {
    await apiFetch(`/api/proactive/rules/${id}`, { method: 'PATCH' });
    await loadAll(query);
  };

  const handleDeleteRule = async (id: number) => {
    await apiFetch(`/api/proactive/rules/${id}`, { method: 'DELETE' });
    await loadAll(query);
  };

  const handleRunRule = async (ruleId: number) => {
    setRunningRuleId(ruleId);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const res = await apiFetch('/api/assistant/proactive-sweep', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ruleId, userEmail }),
      });
      const data = await res.json();
      if (data.reply) {
        onSweepResult(data.reply);
      }
      await loadAll(query);
    } finally {
      setRunningRuleId(null);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header & Metrics Strip */}
      <div className="border-b border-amber-500/14 bg-[#0D1017]/90 px-6 py-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-amber-50">Memória Persistente &amp; Automação</h2>
            <p className="text-xs text-slate-400">
              Banco local SQLite registrando interações, fatos aprendidos e gatilhos proativos.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="spatial-card rounded-xl px-3.5 py-2">
              <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-500 block">Interações</span>
              <span className="font-mono text-sm font-semibold text-amber-50 tabular-nums">
                {stats.totalInteractions}
              </span>
            </div>
            <div className="spatial-card rounded-xl px-3.5 py-2">
              <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-500 block">Fatos</span>
              <span className="font-mono text-sm font-semibold text-amber-50 tabular-nums">
                {stats.totalFacts}
              </span>
            </div>
            <div className="spatial-card rounded-xl px-3.5 py-2">
              <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-500 block">Fixados</span>
              <span className="font-mono text-sm font-semibold text-amber-400 tabular-nums">
                {stats.pinnedFacts}
              </span>
            </div>
            <div className="spatial-card rounded-xl px-3.5 py-2">
              <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-500 block">Regras Ativas</span>
              <span className="font-mono text-sm font-semibold text-emerald-400 tabular-nums">
                {stats.activeRules}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-1 rounded-xl bg-[#141822] p-1 border border-amber-500/18">
            <button
              type="button"
              onClick={() => setTab('facts')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap shrink-0 ${
                tab === 'facts' ? 'bg-amber-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-amber-100'
              }`}
            >
              <Brain className="h-3.5 w-3.5" />
              <span>Fatos &amp; Preferências</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('interactions')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap shrink-0 ${
                tab === 'interactions'
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-amber-100'
              }`}
            >
              <History className="h-3.5 w-3.5" />
              <span>Registro de Interações</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('proactive')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap shrink-0 ${
                tab === 'proactive'
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-amber-100'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              <span>Regras Proativas</span>
            </button>
          </div>

          {tab === 'facts' && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-[#0D111A] px-3 py-1.5">
              <Search className="h-3.5 w-3.5 text-amber-400/70" />
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  loadAll(e.target.value);
                }}
                placeholder="Filtrar memórias..."
                className="bg-transparent text-xs text-amber-50 placeholder:text-slate-500 focus:outline-none w-48"
              />
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 bg-[#07090F]">
        {tab === 'facts' && (
          <div className="max-w-4xl space-y-6">
            <form
              onSubmit={handleAddFact}
              className="spatial-card flex flex-wrap items-center gap-3 rounded-2xl p-4"
            >
              <select
                value={newFactCat}
                onChange={(e) => setNewFactCat(e.target.value as MemoryFact['category'])}
                className="rounded-lg border border-white/10 bg-[#080A10] px-3 py-2 text-xs text-slate-200 focus:outline-none"
              >
                <option value="preference">Preferência</option>
                <option value="fact">Fato</option>
                <option value="system">Sistema</option>
                <option value="contact">Contato</option>
                <option value="workflow">Fluxo de Trabalho</option>
              </select>
              <input
                type="text"
                value={newFactContent}
                onChange={(e) => setNewFactContent(e.target.value)}
                placeholder="Registrar nova instrução ou fato permanente na memória..."
                className="flex-1 min-w-[240px] rounded-lg border border-white/10 bg-[#080A10] px-3 py-2 text-xs text-amber-50 placeholder:text-slate-500 focus:outline-none focus:border-amber-500/60"
              />
              <button
                type="submit"
                disabled={!newFactContent.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Salvar Memória</span>
              </button>
            </form>

            <div className="spatial-card divide-y divide-white/8 rounded-2xl overflow-hidden">
              {facts.length === 0 ? (
                <div className="p-6 text-xs text-slate-500">Nenhuma memória encontrada.</div>
              ) : (
                facts.map((fact) => (
                  <div key={fact.id} className="flex items-start justify-between gap-4 px-5 py-3.5">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="font-mono text-sky-400">{fact.category}</span>
                        <span aria-hidden="true">·</span>
                        <span>origem: {fact.source}</span>
                        {fact.pinned === 1 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-400 font-medium">Fixado</span>
                          </>
                        )}
                      </div>
                      <p className="text-sm text-slate-200 leading-relaxed">{fact.content}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleTogglePin(fact.id)}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-white/6 hover:text-sky-400 transition-colors"
                        title={fact.pinned ? 'Desafixar' : 'Fixar memória'}
                      >
                        {fact.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteFact(fact.id)}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-white/6 hover:text-rose-400 transition-colors"
                        title="Excluir memória"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'interactions' && (
          <div className="max-w-4xl spatial-card divide-y divide-white/8 rounded-2xl overflow-hidden">
            {interactions.length === 0 ? (
              <div className="p-6 text-xs text-slate-500">Nenhuma interação registrada ainda.</div>
            ) : (
              interactions.map((item) => (
                <div key={item.id} className="px-5 py-3.5 space-y-1">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-amber-300">{item.role}</span>
                      <span aria-hidden="true">·</span>
                      <span>sessão {item.session_id}</span>
                    </div>
                    <span className="font-mono tabular-nums">{item.created_at}</span>
                  </div>
                  <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed line-clamp-4">
                    {item.content}
                  </p>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'proactive' && (
          <div className="max-w-4xl space-y-6">
            <form
              onSubmit={handleAddRule}
              className="spatial-card rounded-2xl p-5 space-y-3"
            >
              <h3 className="text-sm font-semibold text-amber-50">Nova Regra de Automação Proativa</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  value={ruleTitle}
                  onChange={(e) => setRuleTitle(e.target.value)}
                  placeholder="Título da regra"
                  className="rounded-lg border border-white/10 bg-[#0A0D12] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                />
                <select
                  value={ruleType}
                  onChange={(e) => setRuleType(e.target.value as ProactiveRule['trigger_type'])}
                  className="rounded-lg border border-white/10 bg-[#0A0D12] px-3 py-2 text-xs text-slate-200 focus:outline-none"
                >
                  <option value="filesystem">Monitoramento de Pasta Linux</option>
                  <option value="workspace_email">Triagem Gmail / Workspace</option>
                  <option value="schedule">Rotina Agendada</option>
                  <option value="manual">Gatilho Sob Demanda</option>
                </select>
                <input
                  type="text"
                  value={ruleCondition}
                  onChange={(e) => setRuleCondition(e.target.value)}
                  placeholder="Condição (ex: ~/Downloads)"
                  className="rounded-lg border border-white/10 bg-[#0A0D12] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                />
              </div>
              <textarea
                rows={2}
                value={rulePrompt}
                onChange={(e) => setRulePrompt(e.target.value)}
                placeholder="O que o Aegis deve analisar e propor proativamente quando essa regra rodar?"
                className="w-full rounded-lg border border-white/10 bg-[#0A0D12] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!ruleTitle.trim() || !rulePrompt.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Criar Regra</span>
                </button>
              </div>
            </form>

            <div className="divide-y divide-white/8 rounded-xl border border-white/8 bg-[#11161F]">
              {rules.map((rule) => (
                <div key={rule.id} className="p-5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-medium text-slate-100">{rule.title}</h4>
                      <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                        <span className="font-mono text-sky-400">{rule.trigger_type}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{rule.condition_spec}</span>
                        {rule.last_run_at && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">última execução: {rule.last_run_at}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleRule(rule.id)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                          rule.enabled
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : 'border-white/10 bg-[#0A0D12] text-slate-400'
                        }`}
                      >
                        {rule.enabled ? 'Ativa' : 'Pausada'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRunRule(rule.id)}
                        disabled={runningRuleId === rule.id}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-sky-500 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Play className="h-3 w-3" />
                        <span>{runningRuleId === rule.id ? 'Executando...' : 'Executar Agora'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRule(rule.id)}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-white/6 hover:text-rose-400 transition-colors"
                        title="Excluir regra"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{rule.action_prompt}</p>
                  {rule.last_result && (
                    <p className="text-xs text-slate-400 font-mono bg-[#0A0D12] rounded-lg p-2.5 border border-white/6">
                      Último resultado: {rule.last_result}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
