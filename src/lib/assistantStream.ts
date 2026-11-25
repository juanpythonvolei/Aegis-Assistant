import { apiFetch } from './apiClient';
import type {
  BackgroundJobItem,
  ComplexityTier,
  ExecutedStep,
  HolographicScreenSpec,
  LiveModelRoutingState,
  ModelPreference,
  PendingConfirmation,
  ThinkingTraceEntry,
  TurnUsageStats,
} from '../types';

export interface AssistantStreamResult {
  reply: string;
  steps: ExecutedStep[];
  pendingConfirmations: PendingConfirmation[];
  screens?: HolographicScreenSpec[];
  cameraAction?: 'enable' | 'disable';
  usage?: TurnUsageStats;
  thinkingTrace?: ThinkingTraceEntry[];
  backgroundJob?: BackgroundJobItem;
  ackMessage?: string;
}

export interface StreamAssistantParams {
  prompt: string;
  sessionId: string;
  mode: 'reactive' | 'proactive';
  modelPreference: ModelPreference;
  userEmail?: string;
  accessToken?: string | null;
  onRoutingState?: (state: LiveModelRoutingState) => void;
  onTraceUpdate?: (entries: ThinkingTraceEntry[]) => void;
}

const MODEL_SHORT_LABELS: Record<string, string> = {
  'gemini-3.1-flash-lite': 'Flash Lite',
  'gemini-4-hydrogen': '4 Hydrogen',
  'gemini-4-neon': '4 Neon',
  'gemini-4-argon': '4 Argon',
  'gemini-4-carbon': '4 Carbon',
  'gemini-3.8-live': 'Live 3.8',
  auto: 'Auto',
};

const TIER_LABELS: Record<ComplexityTier | 'live', string> = {
  lite: 'Econômico',
  balanced: 'Balanceado',
  advanced: 'Avançado',
  deep: 'Profundo',
  live: 'Voz ao Vivo',
};

export function formatModelShortName(model: string): string {
  return MODEL_SHORT_LABELS[model] || model;
}

export function formatTierLabel(tier: ComplexityTier | 'live'): string {
  return TIER_LABELS[tier] || tier;
}

export async function streamAssistantTurn(params: StreamAssistantParams): Promise<AssistantStreamResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (params.accessToken) {
    headers.Authorization = `Bearer ${params.accessToken}`;
  }

  let traceSeq = 0;
  const trace: ThinkingTraceEntry[] = [];
  const nextId = (prefix: string) => `${prefix}-${Date.now()}-${++traceSeq}`;
  const emitTrace = () => {
    params.onTraceUpdate?.(trace.map((e) => ({ ...e })));
  };

  const initialRoutingEntry: ThinkingTraceEntry = {
    id: nextId('route'),
    kind: 'routing',
    title: 'Analisando diretriz e planejando subagentes',
    detail:
      params.modelPreference === 'auto'
        ? 'Decompondo trabalho bruto para modelos leves e selecionando o Curador Sênior...'
        : `Preparando execução com curadoria em ${formatModelShortName(params.modelPreference)}...`,
    model: 'gemini-3.1-flash-lite',
    role: 'decomposer',
    status: 'running',
    timestamp: new Date().toISOString(),
  };
  trace.push(initialRoutingEntry);
  emitTrace();

  params.onRoutingState?.({
    phase: 'analyzing',
    activeModel: params.modelPreference === 'auto' ? 'auto' : params.modelPreference,
    tier: 'lite',
    routingMode: params.modelPreference === 'auto' ? 'auto' : 'manual',
    reason:
      params.modelPreference === 'auto'
        ? 'Decompondo missão para subagentes trabalhadores...'
        : `Preparando ${formatModelShortName(params.modelPreference)}...`,
  });

  const res = await apiFetch('/api/assistant/chat-stream', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt: params.prompt,
      sessionId: params.sessionId,
      mode: params.mode,
      modelPreference: params.modelPreference,
      userEmail: params.userEmail,
    }),
  });

  if (!res.ok) {
    const errPayload = await res.json().catch(() => ({ error: 'Falha ao comunicar com o Aegis.' }));
    initialRoutingEntry.status = 'error';
    initialRoutingEntry.detail = errPayload.error || 'Falha ao processar solicitação.';
    emitTrace();
    throw new Error(errPayload.error || 'Falha ao processar solicitação.');
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream') || !res.body) {
    const json = (await res.json()) as AssistantStreamResult;
    initialRoutingEntry.status = 'done';
    emitTrace();
    if (json.usage) {
      params.onRoutingState?.({
        phase: 'ready',
        activeModel: json.usage.model,
        curatorModel: json.usage.curatorModel,
        workerCount: json.usage.subtasksCount,
        tier: json.usage.complexityTier,
        routingMode: json.usage.routingMode,
        reason: json.usage.routingReason,
      });
    }
    return { ...json, thinkingTrace: [...trace] };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let finalResult: AssistantStreamResult | null = null;
  let streamError: string | null = null;
  let lastKnownModel: string = params.modelPreference === 'auto' ? 'gemini-4-hydrogen' : params.modelPreference;
  let lastKnownTier: ComplexityTier = 'balanced';
  let lastKnownRoutingMode: 'auto' | 'manual' = params.modelPreference === 'auto' ? 'auto' : 'manual';
  let plannedCuratorModel: string | undefined;
  let plannedWorkerCount = 0;

  const markRoutingDone = () => {
    for (const item of trace) {
      if (item.kind === 'routing' && item.status === 'running') {
        item.status = 'done';
      }
    }
  };

  const processBlock = (rawBlock: string) => {
    const lines = rawBlock.split('\n');
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length === 0) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
    } catch {
      return;
    }

    if (eventName === 'routing_analyzing') {
      const reason = String(payload.reason || 'Decompondo a missão em sub-tarefas...');
      initialRoutingEntry.detail = reason;
      emitTrace();
      params.onRoutingState?.({
        phase: 'analyzing',
        activeModel: String(payload.model || 'gemini-3.1-flash-lite'),
        tier: 'lite',
        routingMode: lastKnownRoutingMode,
        reason,
      });
    } else if (eventName === 'plan_created') {
      markRoutingDone();
      const subtasks = Array.isArray(payload.subtasks)
        ? (payload.subtasks as Array<{
            subagent: string;
            label: string;
            model: string;
            objective: string;
          }>)
        : [];
      plannedCuratorModel = String(payload.curatorModel || lastKnownModel);
      plannedWorkerCount = subtasks.length;
      const curatorTier = (payload.curatorTier as ComplexityTier) || 'balanced';
      const rationale = String(
        payload.planRationale || `Tarefa subdividida em ${subtasks.length} sub-tarefa(s) de trabalho bruto.`
      );

      trace.push({
        id: nextId('plan'),
        kind: 'plan',
        title: `Plano de Execução · ${subtasks.length} ${subtasks.length === 1 ? 'Trabalhador' : 'Trabalhadores'} → Curador ${formatModelShortName(plannedCuratorModel)}`,
        detail: rationale,
        model: plannedCuratorModel,
        role: 'decomposer',
        status: 'done',
        timestamp: new Date().toISOString(),
        subtasks,
      });
      emitTrace();

      params.onRoutingState?.({
        phase: 'planning',
        activeModel: subtasks[0]?.model || 'gemini-3.1-flash-lite',
        curatorModel: plannedCuratorModel,
        workerCount: plannedWorkerCount,
        tier: curatorTier,
        routingMode: lastKnownRoutingMode,
        reason: rationale,
      });
    } else if (eventName === 'thought') {
      const text = String(payload.text || '').trim();
      if (text) {
        const role = (payload.role as 'decomposer' | 'worker' | 'curator') || 'curator';
        trace.push({
          id: nextId('thought'),
          kind: 'thought',
          title: String(payload.source || (role === 'curator' ? 'Curador Sênior' : 'Raciocínio')),
          detail: text,
          model: payload.model ? String(payload.model) : lastKnownModel,
          role,
          status: 'done',
          timestamp: new Date().toISOString(),
        });
        emitTrace();
      }
    } else if (eventName === 'model_selected') {
      markRoutingDone();
      const escalatedFrom = payload.escalatedFrom ? String(payload.escalatedFrom) : undefined;
      lastKnownModel = String(payload.model || 'gemini-4-hydrogen');
      lastKnownTier = (payload.tier as ComplexityTier) || 'balanced';
      lastKnownRoutingMode = payload.routingMode === 'manual' ? 'manual' : 'auto';
      trace.push({
        id: nextId('select'),
        kind: 'routing',
        title: `Modelo selecionado: ${formatModelShortName(lastKnownModel)}`,
        detail: payload.reason ? String(payload.reason) : undefined,
        model: lastKnownModel,
        role: 'system',
        status: 'done',
        timestamp: new Date().toISOString(),
      });
      emitTrace();

      params.onRoutingState?.({
        phase: escalatedFrom ? 'escalating' : 'invoking',
        activeModel: lastKnownModel,
        previousModel: escalatedFrom,
        curatorModel: plannedCuratorModel || lastKnownModel,
        workerCount: plannedWorkerCount,
        tier: lastKnownTier,
        routingMode: lastKnownRoutingMode,
        reason: payload.reason ? String(payload.reason) : undefined,
      });
    } else if (eventName === 'subagent_start') {
      markRoutingDone();
      const subId = String(payload.subagent || 'worker');
      const subLabel = String(payload.label || subId);
      const subModel = String(payload.model || 'gemini-3.1-flash-lite');
      const objective = String(payload.objective || '');

      trace.push({
        id: nextId(`worker-${subId}`),
        kind: 'worker',
        title: subLabel,
        detail: objective,
        model: subModel,
        role: 'worker',
        subagent: subId,
        status: 'running',
        timestamp: new Date().toISOString(),
      });
      emitTrace();

      params.onRoutingState?.({
        phase: 'subagent',
        activeModel: subModel,
        curatorModel: plannedCuratorModel,
        workerCount: plannedWorkerCount,
        tier: lastKnownTier,
        routingMode: lastKnownRoutingMode,
        activeSubagent: subLabel,
        reason: objective ? `${subLabel}: ${objective}` : `Executando trabalho bruto (${subLabel})...`,
      });
    } else if (eventName === 'subagent_done') {
      const subId = String(payload.subagent || '');
      const subLabel = String(payload.label || subId || 'Subagente');
      const latencyMs = Number(payload.latencyMs || 0);
      const summary = String(payload.summary || '');
      const status = payload.status === 'error' ? 'error' : 'done';
      const subModel = payload.model ? String(payload.model) : undefined;

      // Update matching running worker entry
      for (let i = trace.length - 1; i >= 0; i--) {
        const entry = trace[i];
        if (entry.kind === 'worker' && entry.status === 'running' && (entry.subagent === subId || entry.title === subLabel)) {
          entry.status = status;
          entry.latencyMs = latencyMs;
          if (subModel) entry.model = subModel;
          if (summary) {
            entry.detail = entry.detail ? `${entry.detail}\n\nResultado bruto:\n${summary}` : summary;
          }
          break;
        }
      }
      emitTrace();

      params.onRoutingState?.({
        phase: 'subagent',
        activeModel: subModel || lastKnownModel,
        curatorModel: plannedCuratorModel,
        workerCount: plannedWorkerCount,
        tier: lastKnownTier,
        routingMode: lastKnownRoutingMode,
        activeSubagent: subLabel,
        reason: `${subLabel} concluiu trabalho bruto em ${latencyMs}ms`,
      });
    } else if (eventName === 'curator_start') {
      markRoutingDone();
      lastKnownModel = String(payload.model || plannedCuratorModel || 'gemini-4-hydrogen');
      lastKnownTier = (payload.tier as ComplexityTier) || 'balanced';
      plannedCuratorModel = lastKnownModel;
      const workerCount = Number(payload.workerCount || plannedWorkerCount || 0);
      const reason = String(
        payload.reason || `Curadoria sênior revisando ${workerCount} subagente(s) e refinando a resposta...`
      );

      trace.push({
        id: nextId('curator'),
        kind: 'curator',
        title: `Curador Sênior · ${formatModelShortName(lastKnownModel)}`,
        detail: reason,
        model: lastKnownModel,
        role: 'curator',
        status: 'running',
        timestamp: new Date().toISOString(),
      });
      emitTrace();

      params.onRoutingState?.({
        phase: 'curating',
        activeModel: lastKnownModel,
        curatorModel: lastKnownModel,
        workerCount,
        tier: lastKnownTier,
        routingMode: lastKnownRoutingMode,
        reason,
      });
    } else if (eventName === 'tool_start') {
      const toolName = String(payload.tool || 'ferramenta');
      const toolModel = String(payload.model || lastKnownModel);
      const toolReason = payload.reason ? String(payload.reason) : `Executando ${toolName}...`;

      trace.push({
        id: nextId(`tool-${toolName}`),
        kind: 'tool',
        title: toolName,
        detail: toolReason,
        model: toolModel,
        role: 'system',
        status: 'running',
        timestamp: new Date().toISOString(),
      });
      emitTrace();

      params.onRoutingState?.({
        phase: plannedCuratorModel && toolModel === plannedCuratorModel ? 'curating' : 'invoking',
        activeModel: toolModel,
        curatorModel: plannedCuratorModel,
        workerCount: plannedWorkerCount,
        tier: (payload.tier as ComplexityTier) || lastKnownTier,
        routingMode: payload.routingMode === 'manual' ? 'manual' : lastKnownRoutingMode,
        activeTool: toolName,
        reason: toolReason,
      });
    } else if (eventName === 'tool_done') {
      const toolName = String(payload.tool || 'ferramenta');
      const status = payload.status === 'error' ? 'error' : 'done';
      const summary = String(payload.summary || 'Concluído');
      const sub = payload.subagent ? String(payload.subagent) : undefined;

      for (let i = trace.length - 1; i >= 0; i--) {
        const entry = trace[i];
        if (entry.kind === 'tool' && entry.status === 'running' && entry.title === toolName) {
          entry.status = status;
          entry.detail = sub ? `${sub} · ${summary}` : summary;
          break;
        }
      }
      emitTrace();
    } else if (eventName === 'code_evolution') {
      const capName = String(payload.capabilityName || 'nova_funcao');
      const phase = String(payload.phase || 'synthesizing');
      const msg = String(payload.message || `Auto-evolução: ${capName}`);

      trace.push({
        id: nextId('evo'),
        kind: 'evolution',
        title: `Auto-Evolução · ${capName}`,
        detail: msg,
        model: lastKnownModel,
        role: 'system',
        status: phase === 'failed' ? 'error' : phase === 'verified' ? 'done' : 'running',
        timestamp: new Date().toISOString(),
      });
      emitTrace();

      params.onRoutingState?.({
        phase: phase === 'synthesizing' ? 'evolving' : 'invoking',
        activeModel: lastKnownModel,
        curatorModel: plannedCuratorModel,
        workerCount: plannedWorkerCount,
        tier: lastKnownTier,
        routingMode: lastKnownRoutingMode,
        evolvingCapability: capName,
        reason: msg,
      });
    } else if (eventName === 'model_escalated') {
      const direction = payload.direction === 'fallback' ? 'fallback' : 'up';
      const fromModel = String(payload.fromModel || '');
      lastKnownModel = String(payload.toModel || 'gemini-4-neon');
      lastKnownTier = (payload.toTier as ComplexityTier) || 'advanced';
      const reason = payload.reason ? String(payload.reason) : 'Escalonamento automático de modelo.';

      trace.push({
        id: nextId('esc'),
        kind: 'escalation',
        title:
          direction === 'fallback'
            ? `Fallback: ${formatModelShortName(fromModel)} → ${formatModelShortName(lastKnownModel)}`
            : `Escalonamento: ${formatModelShortName(fromModel)} → ${formatModelShortName(lastKnownModel)}`,
        detail: reason,
        model: lastKnownModel,
        role: 'curator',
        status: 'done',
        timestamp: new Date().toISOString(),
      });
      emitTrace();

      params.onRoutingState?.({
        phase: direction === 'fallback' ? 'fallback' : 'escalating',
        activeModel: lastKnownModel,
        previousModel: fromModel,
        curatorModel: lastKnownModel,
        workerCount: plannedWorkerCount,
        tier: lastKnownTier,
        routingMode: 'auto',
        reason,
      });
    } else if (eventName === 'done') {
      for (const item of trace) {
        if (item.status === 'running') {
          item.status = 'done';
        }
      }
      emitTrace();

      finalResult = {
        ...(payload as unknown as AssistantStreamResult),
        thinkingTrace: trace.map((e) => ({ ...e })),
      };
      if (finalResult.usage) {
        params.onRoutingState?.({
          phase: 'ready',
          activeModel: finalResult.usage.model,
          curatorModel: finalResult.usage.curatorModel || finalResult.usage.model,
          workerCount: finalResult.usage.subtasksCount,
          tier: finalResult.usage.complexityTier,
          routingMode: finalResult.usage.routingMode,
          reason: finalResult.usage.routingReason,
        });
      }
    } else if (eventName === 'background_started') {
      markRoutingDone();
      const job = payload.job as BackgroundJobItem;
      const ackMessage = String(
        payload.ackMessage ||
          'Tarefa iniciada em segundo plano para não travar o chat. Assim que concluir, eu te aviso por aqui.'
      );
      trace.push({
        id: nextId('bg'),
        kind: 'routing',
        title: 'Movido para Segundo Plano',
        detail: String(payload.reason || job?.latestActivity || 'Execução assíncrona ativa'),
        model: job?.activeModel || lastKnownModel,
        role: 'system',
        status: 'done',
        timestamp: new Date().toISOString(),
      });
      emitTrace();
      params.onRoutingState?.({
        phase: 'ready',
        activeModel: job?.activeModel || lastKnownModel,
        tier: lastKnownTier,
        routingMode: lastKnownRoutingMode,
        reason: 'Tarefa ativa em segundo plano · Chat liberado',
      });
      finalResult = {
        reply: ackMessage,
        ackMessage,
        steps: [],
        pendingConfirmations: [],
        backgroundJob: job,
        thinkingTrace: trace.map((e) => ({ ...e })),
      };
    } else if (eventName === 'error') {
      streamError = String(payload.error || 'Erro ao processar solicitação.');
      for (const item of trace) {
        if (item.status === 'running') {
          item.status = 'error';
        }
      }
      emitTrace();
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    let sepIdx = buffer.indexOf('\n\n');
    while (sepIdx !== -1) {
      const block = buffer.slice(0, sepIdx).trim();
      buffer = buffer.slice(sepIdx + 2);
      if (block) processBlock(block);
      sepIdx = buffer.indexOf('\n\n');
    }
  }

  if (buffer.trim()) {
    processBlock(buffer.trim());
  }

  if (streamError) {
    throw new Error(streamError);
  }

  // Resilient non-streaming fallback if a proxy/network layer ever closes an SSE stream prematurely
  if (!finalResult) {
    const fallbackRes = await apiFetch('/api/assistant/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(params.accessToken ? { Authorization: `Bearer ${params.accessToken}` } : {}),
      },
      body: JSON.stringify({
        prompt: params.prompt,
        sessionId: params.sessionId,
        mode: params.mode,
        modelPreference: params.modelPreference,
        userEmail: params.userEmail,
      }),
    });
    const fallbackData = await fallbackRes.json().catch(() => ({ error: 'Falha ao obter resposta do assistente.' }));
    if (!fallbackRes.ok) {
      throw new Error(fallbackData.error || 'Falha ao processar solicitação no assistente.');
    }
    for (const item of trace) {
      if (item.status === 'running') item.status = 'done';
    }
    emitTrace();
    finalResult = {
      ...(fallbackData as AssistantStreamResult),
      thinkingTrace: trace.map((e) => ({ ...e })),
    };
    if (finalResult.usage) {
      params.onRoutingState?.({
        phase: 'ready',
        activeModel: finalResult.usage.model,
        curatorModel: finalResult.usage.curatorModel || finalResult.usage.model,
        workerCount: finalResult.usage.subtasksCount,
        tier: finalResult.usage.complexityTier,
        routingMode: finalResult.usage.routingMode,
        reason: finalResult.usage.routingReason,
      });
    }
  }

  return finalResult;
}

