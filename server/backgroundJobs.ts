import crypto from 'node:crypto';
import type { AgentRoutingProgressEvent, AgentTurnResult, ConcreteModelId } from './geminiAgent.ts';

export type BackgroundJobStatus = 'running' | 'completed' | 'error';

export interface BackgroundJobTraceItem {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  model?: string;
  role?: 'decomposer' | 'worker' | 'curator' | 'system';
  subagent?: string;
  status: 'running' | 'done' | 'error' | 'info';
  latencyMs?: number;
  timestamp: string;
}

export interface BackgroundJobRecord {
  id: string;
  userId: number;
  sessionId: string;
  prompt: string;
  title: string;
  status: BackgroundJobStatus;
  phase: string;
  activeModel: string;
  latestActivity: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  announced: boolean;
  result?: AgentTurnResult;
  error?: string;
  trace: BackgroundJobTraceItem[];
}

const jobsById = new Map<string, BackgroundJobRecord>();
const MAX_STORED_JOBS = 60;

function makeJobTitle(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 54) return cleaned;
  return `${cleaned.slice(0, 51)}...`;
}

function pruneOldJobs() {
  if (jobsById.size <= MAX_STORED_JOBS) return;
  const sorted = Array.from(jobsById.values()).sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );
  for (const job of sorted) {
    if (jobsById.size <= MAX_STORED_JOBS) break;
    if (job.status !== 'running') {
      jobsById.delete(job.id);
    }
  }
}

export function createBackgroundJob(params: {
  userId: number;
  sessionId: string;
  prompt: string;
  initialActivity?: string;
  initialModel?: string;
  initialTrace?: BackgroundJobTraceItem[];
}): BackgroundJobRecord {
  const now = new Date().toISOString();
  const job: BackgroundJobRecord = {
    id: `bg_${crypto.randomBytes(5).toString('hex')}`,
    userId: params.userId,
    sessionId: params.sessionId,
    prompt: params.prompt,
    title: makeJobTitle(params.prompt),
    status: 'running',
    phase: 'analyzing',
    activeModel: params.initialModel || 'gemini-3.1-flash-lite',
    latestActivity: params.initialActivity || 'Executando tarefa em segundo plano...',
    startedAt: now,
    updatedAt: now,
    announced: false,
    trace: params.initialTrace ? params.initialTrace.map((t) => ({ ...t })) : [],
  };
  jobsById.set(job.id, job);
  pruneOldJobs();
  return job;
}

export function applyProgressEventToJob(job: BackgroundJobRecord, ev: AgentRoutingProgressEvent): void {
  const now = new Date().toISOString();
  job.updatedAt = now;
  const nextId = (prefix: string) => `${prefix}_${Date.now()}_${job.trace.length}`;

  if (ev.event === 'routing_analyzing') {
    job.phase = 'analyzing';
    job.activeModel = ev.data.model;
    job.latestActivity = ev.data.reason;
  } else if (ev.event === 'plan_created') {
    job.phase = 'planning';
    job.activeModel = ev.data.curatorModel;
    job.latestActivity = ev.data.planRationale;
    job.trace.push({
      id: nextId('plan'),
      kind: 'plan',
      title: `Plano · ${ev.data.subtasks.length} subagente(s)`,
      detail: ev.data.planRationale,
      model: ev.data.curatorModel,
      role: 'decomposer',
      status: 'done',
      timestamp: now,
    });
  } else if (ev.event === 'subagent_start') {
    job.phase = 'subagent';
    job.activeModel = ev.data.model;
    job.latestActivity = `${ev.data.label}: ${ev.data.objective.slice(0, 90)}`;
    job.trace.push({
      id: nextId('worker'),
      kind: 'worker',
      title: ev.data.label,
      detail: ev.data.objective,
      model: ev.data.model,
      role: 'worker',
      subagent: ev.data.subagent,
      status: 'running',
      timestamp: now,
    });
  } else if (ev.event === 'subagent_done') {
    job.latestActivity = `${ev.data.label} concluído (${ev.data.latencyMs}ms)`;
    for (let i = job.trace.length - 1; i >= 0; i--) {
      const item = job.trace[i];
      if (item.kind === 'worker' && item.status === 'running' && item.subagent === ev.data.subagent) {
        item.status = ev.data.status === 'error' ? 'error' : 'done';
        item.latencyMs = ev.data.latencyMs;
        if (ev.data.summary) {
          item.detail = `${item.detail || ''}\n\n${ev.data.summary.slice(0, 600)}`.trim();
        }
        break;
      }
    }
  } else if (ev.event === 'curator_start') {
    job.phase = 'curating';
    job.activeModel = ev.data.model;
    job.latestActivity = ev.data.reason;
    job.trace.push({
      id: nextId('curator'),
      kind: 'curator',
      title: `Curadoria · ${ev.data.model}`,
      detail: ev.data.reason,
      model: ev.data.model,
      role: 'curator',
      status: 'running',
      timestamp: now,
    });
  } else if (ev.event === 'tool_start') {
    job.activeModel = ev.data.model;
    job.latestActivity = ev.data.reason || `Executando ${ev.data.tool}...`;
    job.trace.push({
      id: nextId('tool'),
      kind: 'tool',
      title: ev.data.tool,
      detail: ev.data.reason,
      model: ev.data.model,
      role: 'system',
      status: 'running',
      timestamp: now,
    });
  } else if (ev.event === 'tool_done') {
    job.latestActivity = `${ev.data.tool}: ${ev.data.summary.slice(0, 90)}`;
    for (let i = job.trace.length - 1; i >= 0; i--) {
      const item = job.trace[i];
      if (item.kind === 'tool' && item.status === 'running' && item.title === ev.data.tool) {
        item.status = ev.data.status === 'error' ? 'error' : 'done';
        item.detail = ev.data.summary;
        break;
      }
    }
  } else if (ev.event === 'thought') {
    job.trace.push({
      id: nextId('thought'),
      kind: 'thought',
      title: ev.data.source,
      detail: ev.data.text,
      model: ev.data.model,
      role: ev.data.role,
      status: 'done',
      timestamp: now,
    });
  } else if (ev.event === 'model_selected') {
    job.activeModel = ev.data.model;
    job.latestActivity = ev.data.reason;
  } else if (ev.event === 'model_escalated') {
    job.activeModel = ev.data.toModel;
    job.latestActivity = ev.data.reason;
  } else if (ev.event === 'code_evolution') {
    job.phase = 'evolving';
    job.latestActivity = ev.data.message;
  }
}

export function completeBackgroundJob(job: BackgroundJobRecord, result: AgentTurnResult): void {
  const now = new Date().toISOString();
  job.status = 'completed';
  job.phase = 'ready';
  job.activeModel = result.usage?.model || (job.activeModel as ConcreteModelId);
  job.latestActivity = 'Concluído — pronto para entrega no chat.';
  job.updatedAt = now;
  job.completedAt = now;
  job.result = result;
  for (const t of job.trace) {
    if (t.status === 'running') t.status = 'done';
  }
}

export function failBackgroundJob(job: BackgroundJobRecord, errorMessage: string): void {
  const now = new Date().toISOString();
  job.status = 'error';
  job.phase = 'error';
  job.latestActivity = errorMessage;
  job.updatedAt = now;
  job.completedAt = now;
  job.error = errorMessage;
  for (const t of job.trace) {
    if (t.status === 'running') t.status = 'error';
  }
}

export function listUserBackgroundJobs(userId: number): BackgroundJobRecord[] {
  return Array.from(jobsById.values())
    .filter((j) => j.userId === userId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 20);
}

export function acknowledgeBackgroundJob(userId: number, jobId: string): boolean {
  const job = jobsById.get(jobId);
  if (!job || job.userId !== userId) return false;
  job.announced = true;
  return true;
}

export function deleteBackgroundJob(userId: number, jobId: string): boolean {
  const job = jobsById.get(jobId);
  if (!job || job.userId !== userId) return false;
  if (job.status === 'running') return false;
  return jobsById.delete(jobId);
}
