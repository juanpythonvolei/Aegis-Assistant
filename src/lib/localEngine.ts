import type {
  ConcreteModelId,
  ExecutedStep,
  HolographicScreenSpec,
  ModelPreference,
  PendingConfirmation,
  ThinkingTraceEntry,
  TurnUsageStats,
} from '../types';

export type ExecutionMode = 'cloud' | 'local';

export interface LocalDaemonHealth {
  online: boolean;
  url: string;
  version?: string;
  host?: string;
  platform?: string;
  arch?: string;
  watchDir?: string;
  syncDir?: string;
  hasApiKey?: boolean;
  googleConnected?: boolean;
  googleEmail?: string | null;
  lastGoogleSyncAt?: string | null;
}

export interface LocalAuthStatus {
  needsSetup: boolean;
  authenticated: boolean;
  username: string | null;
}

export interface LocalGoogleSyncStatus {
  connected: boolean;
  email: string | null;
  lastSyncAt: string | null;
  syncDir: string;
  counts: {
    drive: number;
    gmail: number;
    calendar: number;
    tasks: number;
  };
}

export interface LocalCommandResult {
  reply: string;
  steps: ExecutedStep[];
  screens: HolographicScreenSpec[];
  pendingConfirmations: PendingConfirmation[];
  usage?: TurnUsageStats;
  thinkingTrace?: ThinkingTraceEntry[];
}

export const DEFAULT_LOCAL_DAEMON_URL = 'http://127.0.0.1:3847';

// Keep both local daemon URL preference and operator session token strictly in memory
// (never persist sensitive tokens in localStorage or sessionStorage).
let localDaemonUrl: string = DEFAULT_LOCAL_DAEMON_URL;
let localSessionToken: string | null = null;

/**
 * Restricts local daemon connections strictly to loopback addresses so OAuth tokens
 * and local session headers can never be redirected to external hosts.
 */
export function normalizeLoopbackUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_LOCAL_DAEMON_URL;
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  } catch {
    throw new Error('Endereço local inválido. Use http://127.0.0.1:3847 ou http://localhost:3847.');
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('Por segurança, o modo local aceita apenas endereços loopback (127.0.0.1 ou localhost).');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Protocolo inválido para daemon local.');
  }
  return `${parsed.protocol}//${parsed.host}`;
}

export function getLocalDaemonUrl(): string {
  return localDaemonUrl;
}

export function setLocalDaemonUrl(raw: string): string {
  const safe = normalizeLoopbackUrl(raw);
  localDaemonUrl = safe;
  return safe;
}

export function getLocalAuthToken(): string | null {
  return localSessionToken;
}

export function setLocalAuthToken(token: string | null): void {
  localSessionToken = token && token.trim() ? token.trim() : null;
}

function buildLocalHeaders(googleToken?: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (localSessionToken) {
    headers['X-Aegis-Local-Token'] = localSessionToken;
  }
  if (googleToken) {
    headers.Authorization = `Bearer ${googleToken}`;
  }
  return headers;
}

export async function probeLocalDaemon(customUrl?: string): Promise<LocalDaemonHealth> {
  const targetUrl = customUrl ? normalizeLoopbackUrl(customUrl) : localDaemonUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);
  try {
    const res = await fetch(`${targetUrl}/health`, {
      method: 'GET',
      mode: 'cors',
      signal: controller.signal,
    });
    if (!res.ok) {
      return { online: false, url: targetUrl };
    }
    const data = await res.json();
    return {
      online: true,
      url: targetUrl,
      version: data.version,
      host: data.host,
      platform: data.platform,
      arch: data.arch,
      watchDir: data.watchDir,
      syncDir: data.syncDir,
      hasApiKey: Boolean(data.hasApiKey),
      googleConnected: Boolean(data.googleConnected),
      googleEmail: data.googleEmail || null,
      lastGoogleSyncAt: data.lastGoogleSyncAt || null,
    };
  } catch {
    return { online: false, url: targetUrl };
  } finally {
    clearTimeout(timer);
  }
}

export async function getLocalAuthStatus(): Promise<LocalAuthStatus> {
  const res = await fetch(`${localDaemonUrl}/auth/status`, {
    method: 'GET',
    mode: 'cors',
    headers: localSessionToken ? { 'X-Aegis-Local-Token': localSessionToken } : {},
  });
  if (!res.ok) {
    throw new Error(`Falha ao consultar autenticação local (HTTP ${res.status}).`);
  }
  const data = await res.json();
  if (!data.authenticated && localSessionToken) {
    localSessionToken = null;
  }
  return {
    needsSetup: Boolean(data.needsSetup),
    authenticated: Boolean(data.authenticated),
    username: data.username || null,
  };
}

export async function setupLocalOperator(
  username: string,
  password: string
): Promise<{ username: string }> {
  const res = await fetch(`${localDaemonUrl}/auth/setup`, {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.trim(), password }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) {
    throw new Error(data.error || 'Falha ao criar operador local.');
  }
  localSessionToken = data.token;
  return { username: data.username || username.trim() };
}

export async function loginLocalOperator(
  username: string,
  password: string
): Promise<{ username: string }> {
  const res = await fetch(`${localDaemonUrl}/auth/login`, {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.trim(), password }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) {
    throw new Error(data.error || 'Usuário ou senha local inválidos.');
  }
  localSessionToken = data.token;
  return { username: data.username || username.trim() };
}

export async function logoutLocalOperator(): Promise<void> {
  try {
    await fetch(`${localDaemonUrl}/auth/logout`, {
      method: 'POST',
      mode: 'cors',
      headers: buildLocalHeaders(),
    });
  } catch {
    // Ignore network errors if daemon already stopped
  } finally {
    localSessionToken = null;
  }
}

export async function getLocalGoogleSyncStatus(): Promise<LocalGoogleSyncStatus> {
  const res = await fetch(`${localDaemonUrl}/google/sync/status`, {
    method: 'GET',
    mode: 'cors',
    headers: buildLocalHeaders(),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Erro ao ler sincronização Google local (HTTP ${res.status}).`);
  }
  return {
    connected: Boolean(data.connected),
    email: data.email || null,
    lastSyncAt: data.lastSyncAt || null,
    syncDir: data.syncDir || '~/AegisGoogleSync',
    counts: {
      drive: Number(data.counts?.drive || 0),
      gmail: Number(data.counts?.gmail || 0),
      calendar: Number(data.counts?.calendar || 0),
      tasks: Number(data.counts?.tasks || 0),
    },
  };
}

export async function syncGoogleToLocalDaemon(
  googleToken: string,
  email?: string
): Promise<LocalGoogleSyncStatus> {
  if (!googleToken) {
    throw new Error('Conecte sua conta Google antes de sincronizar com o Aegis Local.');
  }
  const res = await fetch(`${localDaemonUrl}/google/sync`, {
    method: 'POST',
    mode: 'cors',
    headers: buildLocalHeaders(googleToken),
    body: JSON.stringify({ email: email || 'Google User' }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Falha na sincronização Google → Local (HTTP ${res.status}).`);
  }
  return {
    connected: true,
    email: data.email || email || 'Google User',
    lastSyncAt: data.lastSyncAt || new Date().toISOString(),
    syncDir: data.syncDir || '~/AegisGoogleSync',
    counts: {
      drive: Number(data.counts?.drive || 0),
      gmail: Number(data.counts?.gmail || 0),
      calendar: Number(data.counts?.calendar || 0),
      tasks: Number(data.counts?.tasks || 0),
    },
  };
}

export async function syncMemoryFactsToLocal(
  facts: Array<string | { content: string }>
): Promise<{ added: number; totalLocalFacts: number }> {
  const res = await fetch(`${localDaemonUrl}/sync/memory`, {
    method: 'POST',
    mode: 'cors',
    headers: buildLocalHeaders(),
    body: JSON.stringify({ facts }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Falha ao sincronizar memória persistente para o daemon local.');
  }
  return {
    added: Number(data.added || 0),
    totalLocalFacts: Number(data.totalLocalFacts || 0),
  };
}

export async function runLocalAssistantTurn(params: {
  prompt: string;
  modelPreference: ModelPreference;
  googleToken?: string | null;
  googleEmail?: string;
}): Promise<LocalCommandResult> {
  const res = await fetch(`${localDaemonUrl}/command`, {
    method: 'POST',
    mode: 'cors',
    headers: buildLocalHeaders(params.googleToken),
    body: JSON.stringify({
      prompt: params.prompt,
      modelPreference: params.modelPreference,
      googleEmail: params.googleEmail,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) {
      localSessionToken = null;
      throw new Error(
        'Sessão do Aegis Local expirada ou não autenticada. Clique em "Local" no topo para fazer login no daemon.'
      );
    }
    throw new Error(data.error || `Erro ao executar no Aegis Local (HTTP ${res.status}).`);
  }

  const pendingConfirmations: PendingConfirmation[] = (data.pendingConfirmations || []).map(
    (
      p: {
        type?: string;
        command?: string;
        reason?: string;
        localPath?: string;
        fileName?: string;
        payload?: unknown;
      },
      idx: number
    ) => {
      if (p.type === 'google_upload') {
        return {
          id: `local_gup_${Date.now()}_${idx}`,
          action_type: 'local_google_upload',
          target: p.fileName || p.localPath || 'Google Drive',
          summary: p.reason || `Enviar "${p.fileName || p.localPath}" para o Google Drive`,
          payload_json: JSON.stringify({
            googleUpload: { localPath: p.localPath, fileName: p.fileName },
          }),
          status: 'pending' as const,
          created_at: new Date().toISOString(),
        };
      }
      if (p.type === 'web_login') {
        return {
          id: `local_wlogin_${Date.now()}_${idx}`,
          action_type: 'local_daemon_command',
          target: 'Autenticação Web Local',
          summary: p.reason || 'Confirmar login web no daemon local',
          payload_json: JSON.stringify({ webLogin: p.payload }),
          status: 'pending' as const,
          created_at: new Date().toISOString(),
        };
      }
      return {
        id: `local_cmd_${Date.now()}_${idx}`,
        action_type: 'local_daemon_command',
        target: p.command || 'Sistema Local',
        summary: p.command || p.reason || 'Executar comando local',
        payload_json: JSON.stringify({ command: p.command }),
        status: 'pending' as const,
        created_at: new Date().toISOString(),
      };
    }
  );

  const steps: ExecutedStep[] = Array.isArray(data.steps)
    ? data.steps
    : (data.outputs || []).map((o: { tool?: string; cmd?: string; url?: string }) => ({
        tool: o.tool || 'local',
        args: o.cmd ? { command: o.cmd } : o.url ? { url: o.url } : {},
        status: 'executed' as const,
        result: o,
      }));

  const usage: TurnUsageStats | undefined = data.usage
    ? {
        model: (data.usage.model || 'gemini-3.1-flash-lite') as ConcreteModelId,
        routingMode: data.usage.mode === 'manual' || data.usage.routingMode === 'manual' ? 'manual' : 'auto',
        routingReason: data.usage.reason || data.usage.routingReason || 'Orquestração local',
        complexityTier: data.usage.tier || data.usage.complexityTier || 'lite',
        promptTokens: Number(data.usage.promptTokens || 0),
        outputTokens: Number(data.usage.outputTokens || 0),
        thoughtsTokens: Number(data.usage.thoughtsTokens || 0),
        totalTokens: Number(data.usage.totalTokens || 0),
        latencyMs: Number(data.usage.latencyMs || 0),
        fallbackUsed: Boolean(data.usage.fallbackUsed),
        workerModels: data.usage.workerModel ? [data.usage.workerModel as ConcreteModelId] : undefined,
        curatorModel: data.usage.curatedBySenior
          ? ((data.usage.model || 'gemini-4-hydrogen') as ConcreteModelId)
          : undefined,
        subtasksCount: typeof data.usage.workerCount === 'number' ? data.usage.workerCount : undefined,
      }
    : undefined;

  return {
    reply: data.reply || 'Operação concluída localmente.',
    steps,
    screens: Array.isArray(data.screens) ? data.screens : [],
    pendingConfirmations,
    usage,
    thinkingTrace: Array.isArray(data.thinkingTrace) ? data.thinkingTrace : undefined,
  };
}

export async function confirmLocalAction(params: {
  payloadJson: string;
  googleToken?: string | null;
}): Promise<{ summary: string; stdout?: string; stderr?: string }> {
  const payload = JSON.parse(params.payloadJson) as {
    command?: string;
    webLogin?: unknown;
    googleUpload?: { localPath?: string; fileName?: string };
  };

  let body: Record<string, unknown>;
  if (payload.googleUpload) {
    body = { confirmedGoogleUpload: payload.googleUpload };
  } else if (payload.webLogin) {
    body = { confirmedWebLogin: payload.webLogin };
  } else {
    body = { confirmedCommand: payload.command };
  }

  const res = await fetch(`${localDaemonUrl}/command`, {
    method: 'POST',
    mode: 'cors',
    headers: buildLocalHeaders(params.googleToken),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Falha ao confirmar ação no daemon local.');
  }
  return {
    summary: data.summary || data.message || 'Ação local confirmada e concluída.',
    stdout: data.stdout,
    stderr: data.stderr,
  };
}
