import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export interface InteractionRecord {
  id: number;
  session_id: string;
  role: 'user' | 'assistant' | 'tool' | 'proactive';
  content: string;
  tool_calls_json: string | null;
  context_tags: string | null;
  created_at: string;
}

export interface MemoryFact {
  id: number;
  category: 'preference' | 'fact' | 'system' | 'contact' | 'workflow';
  content: string;
  source: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}

export interface ProactiveRule {
  id: number;
  title: string;
  trigger_type: 'filesystem' | 'workspace_email' | 'schedule' | 'manual';
  condition_spec: string;
  action_prompt: string;
  enabled: number;
  last_run_at: string | null;
  last_result: string | null;
  created_at: string;
}

export interface PendingConfirmation {
  id: string;
  action_type: string;
  target: string;
  summary: string;
  payload_json: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  created_at: string;
}

export interface LocalUserRecord {
  id: number;
  username: string;
  email: string;
  display_name: string;
  password_hash: string;
  auth_provider: 'local' | 'google';
  created_at: string;
}

export interface UsageLogRecord {
  id: number;
  session_id: string;
  model: string;
  routing_mode: 'auto' | 'manual';
  routing_reason: string;
  complexity_tier: 'lite' | 'balanced' | 'advanced' | 'deep';
  prompt_tokens: number;
  output_tokens: number;
  thoughts_tokens: number;
  total_tokens: number;
  latency_ms: number;
  tool_calls_count: number;
  status: 'ok' | 'fallback' | 'error';
  created_at: string;
}

export interface WebCredentialRecord {
  id: number;
  user_id: number;
  site_name: string;
  login_url: string;
  username: string;
  encrypted_password: string;
  iv: string;
  auth_tag: string;
  notes: string;
  last_used_at: string | null;
  created_at: string;
}

export interface EvolvedCapabilityRecord {
  id: number;
  name: string;
  description: string;
  limitation_reason: string;
  parameters_schema_json: string;
  code: string;
  file_path: string;
  version: number;
  enabled: number;
  test_status: 'passed' | 'failed' | 'untested';
  test_output: string;
  run_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubagentRunRecord {
  id: number;
  session_id: string;
  subagent_name: string;
  objective: string;
  model: string;
  status: 'ok' | 'error' | 'awaiting_confirmation';
  summary: string;
  steps_count: number;
  latency_ms: number;
  created_at: string;
}

export type DevicePlatform = 'android' | 'ios' | 'linux' | 'windows' | 'web';

export type DeviceTransport =
  | 'adb_local'
  | 'adb_desktop_relay'
  | 'termux_ws'
  | 'android_app_ws'
  | 'ios_shortcut'
  | 'desktop_ws'
  | 'pwa_browser';

export interface PairedDeviceRecord {
  id: string;
  user_id: number;
  name: string;
  platform: DevicePlatform;
  transport: DeviceTransport;
  serial_or_uid: string;
  parent_bridge_id: string | null;
  token_hash: string;
  status: 'online' | 'offline';
  capabilities_json: string;
  telemetry_json: string;
  storage_snapshot_json: string;
  apps_snapshot_json: string;
  notifications_snapshot_json: string;
  files_snapshot_json: string;
  last_seen_at: string;
  created_at: string;
}

export interface DevicePairingCodeRecord {
  code: string;
  user_id: number;
  label: string;
  platform: DevicePlatform;
  expires_at: number;
  used: number;
  created_at: string;
}

export interface DeviceCommandRecord {
  id: string;
  device_id: string;
  command_type: string;
  payload_json: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  result_json: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface WebRoutineRecord {
  id: number;
  user_id: number;
  name: string;
  site_name: string;
  credential_id: number | null;
  start_url: string;
  target_sections_json: string;
  extraction_instructions: string;
  download_attachments: number;
  file_extensions: string;
  local_folder: string;
  drive_folder: string;
  auto_organize_by_section: number;
  schedule_hint: string;
  enabled: number;
  last_run_at: string | null;
  last_status: string | null;
  last_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebRoutineRunRecord {
  id: number;
  routine_id: number | null;
  routine_name: string;
  status: 'running' | 'ok' | 'partial' | 'error';
  visited_sections_json: string;
  extracted_data_json: string;
  downloaded_files_json: string;
  drive_uploads_json: string;
  logs_json: string;
  summary: string;
  latency_ms: number;
  created_at: string;
}



const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'aegis_memory.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls_json TEXT,
    context_tags TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS memory_facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'conversation',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS proactive_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    condition_spec TEXT NOT NULL,
    action_prompt TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    last_result TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pending_confirmations (
    id TEXT PRIMARY KEY,
    action_type TEXT NOT NULL,
    target TEXT NOT NULL,
    summary TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    auth_provider TEXT NOT NULL DEFAULT 'local',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    model TEXT NOT NULL,
    routing_mode TEXT NOT NULL,
    routing_reason TEXT NOT NULL,
    complexity_tier TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    thoughts_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    tool_calls_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ok',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS web_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 0,
    site_name TEXT NOT NULL,
    login_url TEXT NOT NULL,
    username TEXT NOT NULL,
    encrypted_password TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    last_used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS evolved_capabilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    limitation_reason TEXT NOT NULL,
    parameters_schema_json TEXT NOT NULL,
    code TEXT NOT NULL,
    file_path TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    test_status TEXT NOT NULL DEFAULT 'untested',
    test_output TEXT NOT NULL DEFAULT '',
    run_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subagent_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    subagent_name TEXT NOT NULL,
    objective TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ok',
    summary TEXT NOT NULL DEFAULT '',
    steps_count INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS paired_devices (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    transport TEXT NOT NULL,
    serial_or_uid TEXT NOT NULL DEFAULT '',
    parent_bridge_id TEXT,
    token_hash TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'offline',
    capabilities_json TEXT NOT NULL DEFAULT '[]',
    telemetry_json TEXT NOT NULL DEFAULT '{}',
    storage_snapshot_json TEXT NOT NULL DEFAULT '{}',
    apps_snapshot_json TEXT NOT NULL DEFAULT '[]',
    notifications_snapshot_json TEXT NOT NULL DEFAULT '[]',
    files_snapshot_json TEXT NOT NULL DEFAULT '[]',
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS device_pairing_codes (
    code TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 0,
    label TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT 'android',
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS device_commands (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    command_type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    result_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (device_id) REFERENCES paired_devices(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS web_routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    site_name TEXT NOT NULL DEFAULT '',
    credential_id INTEGER,
    start_url TEXT NOT NULL,
    target_sections_json TEXT NOT NULL DEFAULT '[]',
    extraction_instructions TEXT NOT NULL DEFAULT '',
    download_attachments INTEGER NOT NULL DEFAULT 1,
    file_extensions TEXT NOT NULL DEFAULT 'pdf,xlsx,xls,csv,docx,zip,xml',
    local_folder TEXT NOT NULL DEFAULT 'Downloads/Portais',
    drive_folder TEXT NOT NULL DEFAULT '',
    auto_organize_by_section INTEGER NOT NULL DEFAULT 1,
    schedule_hint TEXT NOT NULL DEFAULT 'Sob demanda',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    last_status TEXT,
    last_summary TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS web_routine_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id INTEGER,
    routine_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ok',
    visited_sections_json TEXT NOT NULL DEFAULT '[]',
    extracted_data_json TEXT NOT NULL DEFAULT '[]',
    downloaded_files_json TEXT NOT NULL DEFAULT '[]',
    drive_uploads_json TEXT NOT NULL DEFAULT '[]',
    logs_json TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '',
    latency_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (routine_id) REFERENCES web_routines(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const ruleCountRow = db.prepare('SELECT COUNT(*) as count FROM proactive_rules').get() as { count: number };
if (ruleCountRow.count === 0) {
  const insertRule = db.prepare(`
    INSERT INTO proactive_rules (title, trigger_type, condition_spec, action_prompt, enabled)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertRule.run(
    'Triagem diária de e-mails e criação de tarefas',
    'workspace_email',
    'inbox:unread newer_than:2d',
    'Analise meus e-mails não lidos mais recentes no Gmail, destaque mensagens prioritárias e proponha tarefas.',
    1
  );
  insertRule.run(
    'Organização automática de Downloads locais',
    'filesystem',
    '~/Downloads (extensões mistas > 5 arquivos)',
    'Inspecione a pasta Downloads no ambiente Linux local e proponha a organização por categoria (Documentos, Imagens, Código, Dados).',
    1
  );
  insertRule.run(
    'Briefing matinal de agenda e sistema',
    'schedule',
    '08:00 (dias úteis)',
    'Verifique meus próximos eventos na agenda, tarefas pendentes e espaço em disco local para gerar um briefing executivo.',
    1
  );
}

const factCountRow = db.prepare('SELECT COUNT(*) as count FROM memory_facts').get() as { count: number };
if (factCountRow.count === 0) {
  const insertFact = db.prepare(`
    INSERT INTO memory_facts (category, content, source, pinned)
    VALUES (?, ?, ?, ?)
  `);
  insertFact.run(
    'system',
    'Ambiente principal configurado para Linux desktop com integração ativa ao Google Workspace e Gemini.',
    'bootstrap',
    1
  );
  insertFact.run(
    'preference',
    'Exigir confirmação explícita antes de mover, editar, enviar ou excluir arquivos locais, ações web ou dados em nuvem.',
    'bootstrap',
    1
  );
}

export function logInteraction(params: {
  sessionId: string;
  role: 'user' | 'assistant' | 'tool' | 'proactive';
  content: string;
  toolCalls?: unknown;
  contextTags?: string[];
}): InteractionRecord {
  const stmt = db.prepare(`
    INSERT INTO interactions (session_id, role, content, tool_calls_json, context_tags)
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    params.sessionId,
    params.role,
    params.content,
    params.toolCalls ? JSON.stringify(params.toolCalls) : null,
    params.contextTags ? params.contextTags.join(',') : null
  );
  return db.prepare('SELECT * FROM interactions WHERE id = ?').get(info.lastInsertRowid) as InteractionRecord;
}

export function getInteractions(limit = 60, sessionId?: string): InteractionRecord[] {
  if (sessionId) {
    return db
      .prepare('SELECT * FROM interactions WHERE session_id = ? ORDER BY id DESC LIMIT ?')
      .all(sessionId, limit)
      .reverse() as InteractionRecord[];
  }
  return db
    .prepare('SELECT * FROM interactions ORDER BY id DESC LIMIT ?')
    .all(limit)
    .reverse() as InteractionRecord[];
}

export function listMemoryFacts(query?: string): MemoryFact[] {
  if (query && query.trim().length > 0) {
    const like = `%${query.trim()}%`;
    return db
      .prepare('SELECT * FROM memory_facts WHERE content LIKE ? OR category LIKE ? ORDER BY pinned DESC, id DESC')
      .all(like, like) as MemoryFact[];
  }
  return db
    .prepare('SELECT * FROM memory_facts ORDER BY pinned DESC, id DESC')
    .all() as MemoryFact[];
}

export function addMemoryFact(params: {
  category: 'preference' | 'fact' | 'system' | 'contact' | 'workflow';
  content: string;
  source?: string;
  pinned?: boolean;
}): MemoryFact {
  const existing = db
    .prepare('SELECT * FROM memory_facts WHERE lower(content) = lower(?) LIMIT 1')
    .get(params.content.trim()) as MemoryFact | undefined;

  if (existing) {
    return existing;
  }

  const stmt = db.prepare(`
    INSERT INTO memory_facts (category, content, source, pinned)
    VALUES (?, ?, ?, ?)
  `);
  const info = stmt.run(
    params.category,
    params.content.trim(),
    params.source || 'assistant',
    params.pinned ? 1 : 0
  );
  return db.prepare('SELECT * FROM memory_facts WHERE id = ?').get(info.lastInsertRowid) as MemoryFact;
}

export function togglePinFact(id: number): MemoryFact | null {
  const row = db.prepare('SELECT * FROM memory_facts WHERE id = ?').get(id) as MemoryFact | undefined;
  if (!row) return null;
  const nextPinned = row.pinned ? 0 : 1;
  db.prepare("UPDATE memory_facts SET pinned = ?, updated_at = datetime('now') WHERE id = ?").run(nextPinned, id);
  return db.prepare('SELECT * FROM memory_facts WHERE id = ?').get(id) as MemoryFact;
}

export function deleteMemoryFact(id: number): boolean {
  const res = db.prepare('DELETE FROM memory_facts WHERE id = ?').run(id);
  return res.changes > 0;
}

export function searchMemoryContext(query: string, limit = 10): {
  facts: MemoryFact[];
  recentInteractions: InteractionRecord[];
} {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 6);

  const allFacts = db.prepare('SELECT * FROM memory_facts ORDER BY pinned DESC, id DESC').all() as MemoryFact[];
  const scoredFacts = allFacts
    .map((fact) => {
      const lower = fact.content.toLowerCase();
      let score = fact.pinned ? 3 : 0;
      for (const word of words) {
        if (lower.includes(word)) score += 2;
      }
      return { fact, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.fact);

  const recentInteractions = db
    .prepare('SELECT * FROM interactions ORDER BY id DESC LIMIT 12')
    .all()
    .reverse() as InteractionRecord[];

  return {
    facts: scoredFacts,
    recentInteractions,
  };
}

export function listProactiveRules(): ProactiveRule[] {
  return db.prepare('SELECT * FROM proactive_rules ORDER BY id DESC').all() as ProactiveRule[];
}

export function createProactiveRule(params: {
  title: string;
  triggerType: 'filesystem' | 'workspace_email' | 'schedule' | 'manual';
  conditionSpec: string;
  actionPrompt: string;
}): ProactiveRule {
  const stmt = db.prepare(`
    INSERT INTO proactive_rules (title, trigger_type, condition_spec, action_prompt, enabled)
    VALUES (?, ?, ?, ?, 1)
  `);
  const info = stmt.run(params.title, params.triggerType, params.conditionSpec, params.actionPrompt);
  return db.prepare('SELECT * FROM proactive_rules WHERE id = ?').get(info.lastInsertRowid) as ProactiveRule;
}

export function toggleProactiveRule(id: number): ProactiveRule | null {
  const row = db.prepare('SELECT * FROM proactive_rules WHERE id = ?').get(id) as ProactiveRule | undefined;
  if (!row) return null;
  const next = row.enabled ? 0 : 1;
  db.prepare('UPDATE proactive_rules SET enabled = ? WHERE id = ?').run(next, id);
  return db.prepare('SELECT * FROM proactive_rules WHERE id = ?').get(id) as ProactiveRule;
}

export function updateProactiveRuleResult(id: number, result: string): void {
  db.prepare("UPDATE proactive_rules SET last_run_at = datetime('now'), last_result = ? WHERE id = ?").run(result, id);
}

export function deleteProactiveRule(id: number): boolean {
  const res = db.prepare('DELETE FROM proactive_rules WHERE id = ?').run(id);
  return res.changes > 0;
}

export function savePendingConfirmation(params: {
  id: string;
  actionType: string;
  target: string;
  summary: string;
  payload: Record<string, unknown>;
}): PendingConfirmation {
  db.prepare(`
    INSERT INTO pending_confirmations (id, action_type, target, summary, payload_json, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(params.id, params.actionType, params.target, params.summary, JSON.stringify(params.payload));
  return db.prepare('SELECT * FROM pending_confirmations WHERE id = ?').get(params.id) as PendingConfirmation;
}

export function getPendingConfirmation(id: string): PendingConfirmation | null {
  const row = db.prepare('SELECT * FROM pending_confirmations WHERE id = ?').get(id) as PendingConfirmation | undefined;
  return row || null;
}

export function resolvePendingConfirmation(id: string, status: 'confirmed' | 'cancelled'): void {
  db.prepare('UPDATE pending_confirmations SET status = ? WHERE id = ?').run(status, id);
}

export function getMemoryStats(): {
  totalInteractions: number;
  totalFacts: number;
  pinnedFacts: number;
  activeRules: number;
} {
  const interactions = (db.prepare('SELECT COUNT(*) as c FROM interactions').get() as { c: number }).c;
  const facts = (db.prepare('SELECT COUNT(*) as c FROM memory_facts').get() as { c: number }).c;
  const pinned = (db.prepare('SELECT COUNT(*) as c FROM memory_facts WHERE pinned = 1').get() as { c: number }).c;
  const rules = (db.prepare('SELECT COUNT(*) as c FROM proactive_rules WHERE enabled = 1').get() as { c: number }).c;
  return {
    totalInteractions: interactions,
    totalFacts: facts,
    pinnedFacts: pinned,
    activeRules: rules,
  };
}

// ==========================================
// USERS & SESSIONS
// ==========================================

export function countUsers(): number {
  return (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
}

export function findUserByIdentifier(identifier: string): LocalUserRecord | null {
  const clean = identifier.trim().toLowerCase();
  const row = db
    .prepare('SELECT * FROM users WHERE lower(username) = ? OR lower(email) = ? LIMIT 1')
    .get(clean, clean) as LocalUserRecord | undefined;
  return row || null;
}

export function findUserById(id: number): LocalUserRecord | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as LocalUserRecord | undefined;
  return row || null;
}

export function createUser(params: {
  username: string;
  email: string;
  displayName: string;
  passwordHash: string;
  authProvider: 'local' | 'google';
}): LocalUserRecord {
  const info = db
    .prepare(`
      INSERT INTO users (username, email, display_name, password_hash, auth_provider)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      params.username.trim().toLowerCase(),
      params.email.trim().toLowerCase(),
      params.displayName.trim(),
      params.passwordHash,
      params.authProvider
    );
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as LocalUserRecord;
}

export function createSession(token: string, userId: number, ttlMs: number): void {
  const expiresAt = Date.now() + ttlMs;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
}

export function getSessionUser(token: string): LocalUserRecord | null {
  const row = db
    .prepare(`
      SELECT u.* FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?
      LIMIT 1
    `)
    .get(token, Date.now()) as LocalUserRecord | undefined;
  return row || null;
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// ==========================================
// USAGE & TOKEN TELEMETRY
// ==========================================

export function logUsage(params: {
  sessionId: string;
  model: string;
  routingMode: 'auto' | 'manual';
  routingReason: string;
  complexityTier: 'lite' | 'balanced' | 'advanced' | 'deep';
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
  latencyMs: number;
  toolCallsCount: number;
  status: 'ok' | 'fallback' | 'error';
}): UsageLogRecord {
  const info = db
    .prepare(`
      INSERT INTO usage_logs (
        session_id, model, routing_mode, routing_reason, complexity_tier,
        prompt_tokens, output_tokens, thoughts_tokens, total_tokens,
        latency_ms, tool_calls_count, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      params.sessionId,
      params.model,
      params.routingMode,
      params.routingReason,
      params.complexityTier,
      params.promptTokens,
      params.outputTokens,
      params.thoughtsTokens,
      params.totalTokens,
      params.latencyMs,
      params.toolCallsCount,
      params.status
    );
  return db.prepare('SELECT * FROM usage_logs WHERE id = ?').get(info.lastInsertRowid) as UsageLogRecord;
}

export function getUsageSummary(): {
  totals: {
    requests: number;
    todayRequests: number;
    promptTokens: number;
    outputTokens: number;
    thoughtsTokens: number;
    totalTokens: number;
    avgLatencyMs: number;
    totalToolCalls: number;
  };
  byModel: Array<{
    model: string;
    requests: number;
    promptTokens: number;
    outputTokens: number;
    totalTokens: number;
    avgLatencyMs: number;
  }>;
  recent: UsageLogRecord[];
} {
  const totalsRow = db
    .prepare(`
      SELECT
        COUNT(*) as requests,
        COALESCE(SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END), 0) as todayRequests,
        COALESCE(SUM(prompt_tokens), 0) as promptTokens,
        COALESCE(SUM(output_tokens), 0) as outputTokens,
        COALESCE(SUM(thoughts_tokens), 0) as thoughtsTokens,
        COALESCE(SUM(total_tokens), 0) as totalTokens,
        COALESCE(ROUND(AVG(latency_ms)), 0) as avgLatencyMs,
        COALESCE(SUM(tool_calls_count), 0) as totalToolCalls
      FROM usage_logs
    `)
    .get() as {
      requests: number;
      todayRequests: number;
      promptTokens: number;
      outputTokens: number;
      thoughtsTokens: number;
      totalTokens: number;
      avgLatencyMs: number;
      totalToolCalls: number;
    };

  const byModel = db
    .prepare(`
      SELECT
        model,
        COUNT(*) as requests,
        COALESCE(SUM(prompt_tokens), 0) as promptTokens,
        COALESCE(SUM(output_tokens), 0) as outputTokens,
        COALESCE(SUM(total_tokens), 0) as totalTokens,
        COALESCE(ROUND(AVG(latency_ms)), 0) as avgLatencyMs
      FROM usage_logs
      GROUP BY model
      ORDER BY requests DESC
    `)
    .all() as Array<{
      model: string;
      requests: number;
      promptTokens: number;
      outputTokens: number;
      totalTokens: number;
      avgLatencyMs: number;
    }>;

  const recent = db
    .prepare('SELECT * FROM usage_logs ORDER BY id DESC LIMIT 40')
    .all() as UsageLogRecord[];

  return {
    totals: totalsRow,
    byModel,
    recent,
  };
}

// ==========================================
// WEB CREDENTIALS VAULT
// ==========================================

export function listWebCredentials(): Array<{
  id: number;
  site_name: string;
  login_url: string;
  username: string;
  notes: string;
  last_used_at: string | null;
  created_at: string;
}> {
  return db
    .prepare('SELECT id, site_name, login_url, username, notes, last_used_at, created_at FROM web_credentials ORDER BY id DESC')
    .all() as Array<{
      id: number;
      site_name: string;
      login_url: string;
      username: string;
      notes: string;
      last_used_at: string | null;
      created_at: string;
    }>;
}

export function saveWebCredential(params: {
  userId: number;
  siteName: string;
  loginUrl: string;
  username: string;
  encryptedPassword: string;
  iv: string;
  authTag: string;
  notes?: string;
}): WebCredentialRecord {
  const existing = db
    .prepare('SELECT id FROM web_credentials WHERE lower(site_name) = lower(?) LIMIT 1')
    .get(params.siteName.trim()) as { id: number } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE web_credentials
      SET login_url = ?, username = ?, encrypted_password = ?, iv = ?, auth_tag = ?, notes = ?
      WHERE id = ?
    `).run(
      params.loginUrl.trim(),
      params.username.trim(),
      params.encryptedPassword,
      params.iv,
      params.authTag,
      params.notes || '',
      existing.id
    );
    return db.prepare('SELECT * FROM web_credentials WHERE id = ?').get(existing.id) as WebCredentialRecord;
  }

  const info = db
    .prepare(`
      INSERT INTO web_credentials (user_id, site_name, login_url, username, encrypted_password, iv, auth_tag, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      params.userId,
      params.siteName.trim(),
      params.loginUrl.trim(),
      params.username.trim(),
      params.encryptedPassword,
      params.iv,
      params.authTag,
      params.notes || ''
    );
  return db.prepare('SELECT * FROM web_credentials WHERE id = ?').get(info.lastInsertRowid) as WebCredentialRecord;
}

export function findWebCredential(idOrSite: string | number): WebCredentialRecord | null {
  if (typeof idOrSite === 'number' || /^\d+$/.test(String(idOrSite))) {
    const row = db
      .prepare('SELECT * FROM web_credentials WHERE id = ? LIMIT 1')
      .get(Number(idOrSite)) as WebCredentialRecord | undefined;
    if (row) return row;
  }
  const q = String(idOrSite).trim().toLowerCase();
  const row = db
    .prepare('SELECT * FROM web_credentials WHERE lower(site_name) = ? OR lower(site_name) LIKE ? OR lower(login_url) LIKE ? LIMIT 1')
    .get(q, `%${q}%`, `%${q}%`) as WebCredentialRecord | undefined;
  return row || null;
}

export function touchWebCredential(id: number): void {
  db.prepare("UPDATE web_credentials SET last_used_at = datetime('now') WHERE id = ?").run(id);
}

export function deleteWebCredential(id: number): boolean {
  return db.prepare('DELETE FROM web_credentials WHERE id = ?').run(id).changes > 0;
}

// ==========================================
// SELF-EVOLVED CAPABILITIES & SUBAGENT RUNS
// ==========================================

export function listEvolvedCapabilities(): EvolvedCapabilityRecord[] {
  return db
    .prepare('SELECT * FROM evolved_capabilities ORDER BY enabled DESC, updated_at DESC, id DESC')
    .all() as EvolvedCapabilityRecord[];
}

export function getEvolvedCapabilityByName(name: string): EvolvedCapabilityRecord | null {
  const row = db
    .prepare('SELECT * FROM evolved_capabilities WHERE name = ? LIMIT 1')
    .get(name.trim()) as EvolvedCapabilityRecord | undefined;
  return row || null;
}

export function upsertEvolvedCapability(params: {
  name: string;
  description: string;
  limitationReason: string;
  parametersSchemaJson: string;
  code: string;
  filePath: string;
  testStatus: 'passed' | 'failed' | 'untested';
  testOutput: string;
  enabled?: boolean;
}): EvolvedCapabilityRecord {
  const existing = getEvolvedCapabilityByName(params.name);
  if (existing) {
    const nextVersion = existing.version + 1;
    db.prepare(`
      UPDATE evolved_capabilities
      SET description = ?, limitation_reason = ?, parameters_schema_json = ?, code = ?,
          file_path = ?, version = ?, enabled = ?, test_status = ?, test_output = ?,
          last_error = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      params.description,
      params.limitationReason,
      params.parametersSchemaJson,
      params.code,
      params.filePath,
      nextVersion,
      params.enabled === false ? 0 : 1,
      params.testStatus,
      params.testOutput.slice(0, 4000),
      existing.id
    );
    return db.prepare('SELECT * FROM evolved_capabilities WHERE id = ?').get(existing.id) as EvolvedCapabilityRecord;
  }

  const info = db
    .prepare(`
      INSERT INTO evolved_capabilities (
        name, description, limitation_reason, parameters_schema_json, code, file_path,
        version, enabled, test_status, test_output
      )
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `)
    .run(
      params.name,
      params.description,
      params.limitationReason,
      params.parametersSchemaJson,
      params.code,
      params.filePath,
      params.enabled === false ? 0 : 1,
      params.testStatus,
      params.testOutput.slice(0, 4000)
    );
  return db.prepare('SELECT * FROM evolved_capabilities WHERE id = ?').get(info.lastInsertRowid) as EvolvedCapabilityRecord;
}

export function toggleEvolvedCapability(name: string, enabled?: boolean): EvolvedCapabilityRecord | null {
  const row = getEvolvedCapabilityByName(name);
  if (!row) return null;
  const next = typeof enabled === 'boolean' ? (enabled ? 1 : 0) : row.enabled ? 0 : 1;
  db.prepare("UPDATE evolved_capabilities SET enabled = ?, updated_at = datetime('now') WHERE id = ?").run(
    next,
    row.id
  );
  return db.prepare('SELECT * FROM evolved_capabilities WHERE id = ?').get(row.id) as EvolvedCapabilityRecord;
}

export function recordEvolvedCapabilityRun(name: string, ok: boolean, errMsg?: string): void {
  db.prepare(`
    UPDATE evolved_capabilities
    SET run_count = run_count + 1,
        last_error = ?,
        updated_at = datetime('now')
    WHERE name = ?
  `).run(ok ? null : (errMsg || 'Erro de execução').slice(0, 1000), name);
}

export function deleteEvolvedCapability(name: string): boolean {
  return db.prepare('DELETE FROM evolved_capabilities WHERE name = ?').run(name.trim()).changes > 0;
}

export function logSubagentRun(params: {
  sessionId: string;
  subagentName: string;
  objective: string;
  model: string;
  status: 'ok' | 'error' | 'awaiting_confirmation';
  summary: string;
  stepsCount: number;
  latencyMs: number;
}): SubagentRunRecord {
  const info = db
    .prepare(`
      INSERT INTO subagent_runs (
        session_id, subagent_name, objective, model, status, summary, steps_count, latency_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      params.sessionId,
      params.subagentName,
      params.objective.slice(0, 600),
      params.model,
      params.status,
      params.summary.slice(0, 1800),
      params.stepsCount,
      params.latencyMs
    );
  return db.prepare('SELECT * FROM subagent_runs WHERE id = ?').get(info.lastInsertRowid) as SubagentRunRecord;
}

export function listSubagentRuns(limit = 40): SubagentRunRecord[] {
  return db
    .prepare('SELECT * FROM subagent_runs ORDER BY id DESC LIMIT ?')
    .all(limit) as SubagentRunRecord[];
}

// ==========================================
// MULTI-DEVICE MESH (ANDROID / IOS / DESKTOP)
// ==========================================

export function createDevicePairingCode(params: {
  code: string;
  userId: number;
  label: string;
  platform: DevicePlatform;
  ttlMs?: number;
}): DevicePairingCodeRecord {
  const expiresAt = Date.now() + (params.ttlMs || 15 * 60 * 1000);
  db.prepare('DELETE FROM device_pairing_codes WHERE expires_at < ? OR used = 1').run(Date.now() - 60_000);
  db.prepare(`
    INSERT INTO device_pairing_codes (code, user_id, label, platform, expires_at, used)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(params.code.toUpperCase(), params.userId, params.label.trim(), params.platform, expiresAt);
  return db.prepare('SELECT * FROM device_pairing_codes WHERE code = ?').get(params.code.toUpperCase()) as DevicePairingCodeRecord;
}

export function consumeDevicePairingCode(code: string): DevicePairingCodeRecord | null {
  const clean = code.trim().toUpperCase();
  const row = db
    .prepare('SELECT * FROM device_pairing_codes WHERE code = ? AND used = 0 AND expires_at > ? LIMIT 1')
    .get(clean, Date.now()) as DevicePairingCodeRecord | undefined;
  if (!row) return null;
  db.prepare('UPDATE device_pairing_codes SET used = 1 WHERE code = ?').run(clean);
  return row;
}

export function upsertPairedDevice(params: {
  id: string;
  userId: number;
  name: string;
  platform: DevicePlatform;
  transport: DeviceTransport;
  serialOrUid?: string;
  parentBridgeId?: string | null;
  tokenHash?: string;
  status?: 'online' | 'offline';
  capabilities?: string[];
  telemetry?: Record<string, unknown>;
  storageSnapshot?: Record<string, unknown>;
  appsSnapshot?: unknown[];
  notificationsSnapshot?: unknown[];
  filesSnapshot?: unknown[];
}): PairedDeviceRecord {
  const existing = db.prepare('SELECT * FROM paired_devices WHERE id = ?').get(params.id) as PairedDeviceRecord | undefined;
  if (existing) {
    db.prepare(`
      UPDATE paired_devices
      SET name = ?,
          platform = ?,
          transport = ?,
          serial_or_uid = COALESCE(?, serial_or_uid),
          parent_bridge_id = COALESCE(?, parent_bridge_id),
          token_hash = CASE WHEN ? != '' THEN ? ELSE token_hash END,
          status = ?,
          capabilities_json = COALESCE(?, capabilities_json),
          telemetry_json = COALESCE(?, telemetry_json),
          storage_snapshot_json = COALESCE(?, storage_snapshot_json),
          apps_snapshot_json = COALESCE(?, apps_snapshot_json),
          notifications_snapshot_json = COALESCE(?, notifications_snapshot_json),
          files_snapshot_json = COALESCE(?, files_snapshot_json),
          last_seen_at = datetime('now')
      WHERE id = ?
    `).run(
      params.name,
      params.platform,
      params.transport,
      params.serialOrUid ?? null,
      params.parentBridgeId ?? null,
      params.tokenHash || '',
      params.tokenHash || '',
      params.status || existing.status,
      params.capabilities ? JSON.stringify(params.capabilities) : null,
      params.telemetry ? JSON.stringify(params.telemetry) : null,
      params.storageSnapshot ? JSON.stringify(params.storageSnapshot) : null,
      params.appsSnapshot ? JSON.stringify(params.appsSnapshot) : null,
      params.notificationsSnapshot ? JSON.stringify(params.notificationsSnapshot) : null,
      params.filesSnapshot ? JSON.stringify(params.filesSnapshot) : null,
      params.id
    );
    return db.prepare('SELECT * FROM paired_devices WHERE id = ?').get(params.id) as PairedDeviceRecord;
  }

  db.prepare(`
    INSERT INTO paired_devices (
      id, user_id, name, platform, transport, serial_or_uid, parent_bridge_id, token_hash,
      status, capabilities_json, telemetry_json, storage_snapshot_json,
      apps_snapshot_json, notifications_snapshot_json, files_snapshot_json, last_seen_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    params.id,
    params.userId,
    params.name,
    params.platform,
    params.transport,
    params.serialOrUid || '',
    params.parentBridgeId || null,
    params.tokenHash || '',
    params.status || 'online',
    JSON.stringify(params.capabilities || []),
    JSON.stringify(params.telemetry || {}),
    JSON.stringify(params.storageSnapshot || {}),
    JSON.stringify(params.appsSnapshot || []),
    JSON.stringify(params.notificationsSnapshot || []),
    JSON.stringify(params.filesSnapshot || [])
  );
  return db.prepare('SELECT * FROM paired_devices WHERE id = ?').get(params.id) as PairedDeviceRecord;
}

export function listPairedDevices(userId?: number): PairedDeviceRecord[] {
  if (typeof userId === 'number' && userId > 0) {
    return db
      .prepare('SELECT * FROM paired_devices WHERE user_id = ? OR user_id = 0 ORDER BY CASE WHEN status = \'online\' THEN 0 ELSE 1 END, last_seen_at DESC')
      .all(userId) as PairedDeviceRecord[];
  }
  return db
    .prepare('SELECT * FROM paired_devices ORDER BY CASE WHEN status = \'online\' THEN 0 ELSE 1 END, last_seen_at DESC')
    .all() as PairedDeviceRecord[];
}

export function getPairedDeviceById(id: string): PairedDeviceRecord | null {
  const row = db.prepare('SELECT * FROM paired_devices WHERE id = ? LIMIT 1').get(id) as PairedDeviceRecord | undefined;
  return row || null;
}

export function findPairedDeviceByTokenHash(tokenHash: string): PairedDeviceRecord | null {
  if (!tokenHash) return null;
  const row = db.prepare('SELECT * FROM paired_devices WHERE token_hash = ? LIMIT 1').get(tokenHash) as PairedDeviceRecord | undefined;
  return row || null;
}

export function updateDeviceStatus(id: string, status: 'online' | 'offline'): void {
  db.prepare("UPDATE paired_devices SET status = ?, last_seen_at = datetime('now') WHERE id = ?").run(status, id);
}

export function markBridgeChildrenOffline(bridgeDeviceId: string): void {
  db.prepare("UPDATE paired_devices SET status = 'offline' WHERE parent_bridge_id = ?").run(bridgeDeviceId);
}

export function updateDeviceSnapshots(params: {
  id: string;
  telemetry?: Record<string, unknown>;
  storageSnapshot?: Record<string, unknown>;
  appsSnapshot?: unknown[];
  notificationsSnapshot?: unknown[];
  filesSnapshot?: unknown[];
  capabilities?: string[];
}): PairedDeviceRecord | null {
  const existing = getPairedDeviceById(params.id);
  if (!existing) return null;

  let mergedTelemetry = existing.telemetry_json;
  if (params.telemetry) {
    try {
      const prev = JSON.parse(existing.telemetry_json || '{}') as Record<string, unknown>;
      mergedTelemetry = JSON.stringify({ ...prev, ...params.telemetry });
    } catch {
      mergedTelemetry = JSON.stringify(params.telemetry);
    }
  }

  db.prepare(`
    UPDATE paired_devices
    SET status = 'online',
        telemetry_json = ?,
        storage_snapshot_json = COALESCE(?, storage_snapshot_json),
        apps_snapshot_json = COALESCE(?, apps_snapshot_json),
        notifications_snapshot_json = COALESCE(?, notifications_snapshot_json),
        files_snapshot_json = COALESCE(?, files_snapshot_json),
        capabilities_json = COALESCE(?, capabilities_json),
        last_seen_at = datetime('now')
    WHERE id = ?
  `).run(
    mergedTelemetry,
    params.storageSnapshot ? JSON.stringify(params.storageSnapshot) : null,
    params.appsSnapshot ? JSON.stringify(params.appsSnapshot) : null,
    params.notificationsSnapshot ? JSON.stringify(params.notificationsSnapshot) : null,
    params.filesSnapshot ? JSON.stringify(params.filesSnapshot) : null,
    params.capabilities ? JSON.stringify(params.capabilities) : null,
    params.id
  );
  return getPairedDeviceById(params.id);
}

export function deletePairedDevice(id: string): boolean {
  db.prepare('DELETE FROM device_commands WHERE device_id = ?').run(id);
  db.prepare('DELETE FROM paired_devices WHERE parent_bridge_id = ?').run(id);
  return db.prepare('DELETE FROM paired_devices WHERE id = ?').run(id).changes > 0;
}

export function createDeviceCommand(params: {
  id: string;
  deviceId: string;
  commandType: string;
  payload: Record<string, unknown>;
  status?: 'pending' | 'running' | 'completed' | 'error';
}): DeviceCommandRecord {
  db.prepare(`
    INSERT INTO device_commands (id, device_id, command_type, payload_json, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(params.id, params.deviceId, params.commandType, JSON.stringify(params.payload), params.status || 'pending');
  return db.prepare('SELECT * FROM device_commands WHERE id = ?').get(params.id) as DeviceCommandRecord;
}

export function updateDeviceCommandResult(
  id: string,
  status: 'completed' | 'error' | 'running',
  result?: unknown
): DeviceCommandRecord | null {
  db.prepare(`
    UPDATE device_commands
    SET status = ?,
        result_json = ?,
        completed_at = CASE WHEN ? IN ('completed', 'error') THEN datetime('now') ELSE completed_at END
    WHERE id = ?
  `).run(status, result !== undefined ? JSON.stringify(result) : null, status, id);
  const row = db.prepare('SELECT * FROM device_commands WHERE id = ?').get(id) as DeviceCommandRecord | undefined;
  return row || null;
}

export function listDeviceCommands(deviceId: string, limit = 30): DeviceCommandRecord[] {
  return db
    .prepare('SELECT * FROM device_commands WHERE device_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(deviceId, limit) as DeviceCommandRecord[];
}

export function getPendingDeviceCommands(deviceId: string): DeviceCommandRecord[] {
  return db
    .prepare("SELECT * FROM device_commands WHERE device_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 20")
    .all(deviceId) as DeviceCommandRecord[];
}

// ==========================================
// AUTONOMOUS REPETITIVE WEB ROUTINES
// ==========================================

export function listWebRoutines(userId?: number): WebRoutineRecord[] {
  if (typeof userId === 'number' && userId > 0) {
    return db
      .prepare('SELECT * FROM web_routines WHERE user_id = ? OR user_id = 0 ORDER BY updated_at DESC, id DESC')
      .all(userId) as WebRoutineRecord[];
  }
  return db.prepare('SELECT * FROM web_routines ORDER BY updated_at DESC, id DESC').all() as WebRoutineRecord[];
}

export function getWebRoutineById(id: number): WebRoutineRecord | null {
  const row = db.prepare('SELECT * FROM web_routines WHERE id = ? LIMIT 1').get(id) as WebRoutineRecord | undefined;
  return row || null;
}

export function findWebRoutine(idOrName: string | number): WebRoutineRecord | null {
  if (typeof idOrName === 'number' || /^\d+$/.test(String(idOrName))) {
    const byId = getWebRoutineById(Number(idOrName));
    if (byId) return byId;
  }
  const q = String(idOrName).trim().toLowerCase();
  if (!q) return null;
  const row = db
    .prepare('SELECT * FROM web_routines WHERE lower(name) = ? OR lower(name) LIKE ? OR lower(site_name) LIKE ? LIMIT 1')
    .get(q, `%${q}%`, `%${q}%`) as WebRoutineRecord | undefined;
  return row || null;
}

export function saveWebRoutine(params: {
  id?: number;
  userId: number;
  name: string;
  siteName?: string;
  credentialId?: number | null;
  startUrl: string;
  targetSections: string[];
  extractionInstructions?: string;
  downloadAttachments?: boolean;
  fileExtensions?: string;
  localFolder?: string;
  driveFolder?: string;
  autoOrganizeBySection?: boolean;
  scheduleHint?: string;
  enabled?: boolean;
}): WebRoutineRecord {
  const sectionsJson = JSON.stringify(
    params.targetSections.map((s) => s.trim()).filter(Boolean).slice(0, 20)
  );
  const cleanExts = (params.fileExtensions ?? 'pdf,xlsx,xls,csv,docx,zip,xml').trim();
  const cleanLocal = (params.localFolder ?? 'Downloads/Portais').trim() || 'Downloads/Portais';
  const cleanDrive = (params.driveFolder ?? '').trim();

  if (params.id && getWebRoutineById(params.id)) {
    db.prepare(`
      UPDATE web_routines
      SET name = ?,
          site_name = ?,
          credential_id = ?,
          start_url = ?,
          target_sections_json = ?,
          extraction_instructions = ?,
          download_attachments = ?,
          file_extensions = ?,
          local_folder = ?,
          drive_folder = ?,
          auto_organize_by_section = ?,
          schedule_hint = ?,
          enabled = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      params.name.trim(),
      (params.siteName || '').trim(),
      params.credentialId ?? null,
      params.startUrl.trim(),
      sectionsJson,
      (params.extractionInstructions || '').trim(),
      params.downloadAttachments === false ? 0 : 1,
      cleanExts,
      cleanLocal,
      cleanDrive,
      params.autoOrganizeBySection === false ? 0 : 1,
      (params.scheduleHint || 'Sob demanda').trim(),
      params.enabled === false ? 0 : 1,
      params.id
    );
    return getWebRoutineById(params.id)!;
  }

  const info = db
    .prepare(`
      INSERT INTO web_routines (
        user_id, name, site_name, credential_id, start_url, target_sections_json,
        extraction_instructions, download_attachments, file_extensions,
        local_folder, drive_folder, auto_organize_by_section, schedule_hint, enabled
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      params.userId,
      params.name.trim(),
      (params.siteName || '').trim(),
      params.credentialId ?? null,
      params.startUrl.trim(),
      sectionsJson,
      (params.extractionInstructions || '').trim(),
      params.downloadAttachments === false ? 0 : 1,
      cleanExts,
      cleanLocal,
      cleanDrive,
      params.autoOrganizeBySection === false ? 0 : 1,
      (params.scheduleHint || 'Sob demanda').trim(),
      params.enabled === false ? 0 : 1
    );
  return getWebRoutineById(Number(info.lastInsertRowid))!;
}

export function deleteWebRoutine(id: number): boolean {
  return db.prepare('DELETE FROM web_routines WHERE id = ?').run(id).changes > 0;
}

export function updateWebRoutineStatus(id: number, status: string, summary: string): void {
  db.prepare(`
    UPDATE web_routines
    SET last_run_at = datetime('now'),
        last_status = ?,
        last_summary = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(status, summary.slice(0, 1500), id);
}

export function logWebRoutineRun(params: {
  routineId?: number | null;
  routineName: string;
  status: 'running' | 'ok' | 'partial' | 'error';
  visitedSections: unknown[];
  extractedData: unknown[];
  downloadedFiles: unknown[];
  driveUploads: unknown[];
  logs: string[];
  summary: string;
  latencyMs: number;
}): WebRoutineRunRecord {
  const info = db
    .prepare(`
      INSERT INTO web_routine_runs (
        routine_id, routine_name, status, visited_sections_json, extracted_data_json,
        downloaded_files_json, drive_uploads_json, logs_json, summary, latency_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      params.routineId ?? null,
      params.routineName.slice(0, 200),
      params.status,
      JSON.stringify(params.visitedSections),
      JSON.stringify(params.extractedData),
      JSON.stringify(params.downloadedFiles),
      JSON.stringify(params.driveUploads),
      JSON.stringify(params.logs),
      params.summary.slice(0, 2500),
      params.latencyMs
    );
  return db.prepare('SELECT * FROM web_routine_runs WHERE id = ?').get(info.lastInsertRowid) as WebRoutineRunRecord;
}

export function listWebRoutineRuns(routineId?: number, limit = 25): WebRoutineRunRecord[] {
  if (typeof routineId === 'number' && routineId > 0) {
    return db
      .prepare('SELECT * FROM web_routine_runs WHERE routine_id = ? ORDER BY id DESC LIMIT ?')
      .all(routineId, limit) as WebRoutineRunRecord[];
  }
  return db
    .prepare('SELECT * FROM web_routine_runs ORDER BY id DESC LIMIT ?')
    .all(limit) as WebRoutineRunRecord[];
}

export function getAppSetting(key: string): string | null {
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ? LIMIT 1')
    .get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setAppSetting(key: string, value: string | null): void {
  if (value === null || value === '') {
    db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
    return;
  }
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, value);
}



