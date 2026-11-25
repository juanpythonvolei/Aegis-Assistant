export type ModelPreference =
  | 'auto'
  | 'gemini-3.1-flash-lite'
  | 'gemini-4-hydrogen'
  | 'gemini-4-neon'
  | 'gemini-4-argon'
  | 'gemini-4-carbon';

export type ConcreteModelId = Exclude<ModelPreference, 'auto'>;

export type ComplexityTier = 'lite' | 'balanced' | 'advanced' | 'deep';

export interface ModelEscalationStep {
  fromModel: ConcreteModelId;
  toModel: ConcreteModelId;
  fromTier: ComplexityTier;
  toTier: ComplexityTier;
  reason: string;
  direction: 'up' | 'fallback';
  stage: 'preflight' | 'mid-turn' | 'fallback';
  timestamp: string;
}

export type ThinkingTraceKind =
  | 'routing'
  | 'plan'
  | 'worker'
  | 'tool'
  | 'thought'
  | 'curator'
  | 'escalation'
  | 'evolution';

export interface ThinkingTraceEntry {
  id: string;
  kind: ThinkingTraceKind;
  title: string;
  detail?: string;
  model?: string;
  role?: 'decomposer' | 'worker' | 'curator' | 'system';
  subagent?: string;
  status: 'running' | 'done' | 'error' | 'info';
  latencyMs?: number;
  timestamp: string;
  subtasks?: Array<{
    subagent: string;
    label: string;
    model: string;
    objective: string;
  }>;
}

export interface LiveModelRoutingState {
  phase:
    | 'idle'
    | 'analyzing'
    | 'planning'
    | 'invoking'
    | 'escalating'
    | 'fallback'
    | 'subagent'
    | 'curating'
    | 'evolving'
    | 'ready';
  activeModel: string;
  previousModel?: string;
  curatorModel?: string;
  workerCount?: number;
  tier: ComplexityTier | 'live';
  routingMode: 'auto' | 'manual' | 'live';
  reason?: string;
  activeTool?: string;
  activeSubagent?: string;
  evolvingCapability?: string;
}

export type AegisCoreState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'seeing';

export type LiveSessionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type HolographicScreenKind =
  | 'file_viewer'
  | 'image_gallery'
  | 'web_canvas'
  | 'interactive_dashboard'
  | 'html_artifact';

export interface HolographicScreenSpec {
  id: string;
  title: string;
  subtitle?: string;
  kind: HolographicScreenKind;
  createdAt: string;
  // file_viewer payload
  fileSource?: 'drive' | 'local' | 'inline';
  fileIdOrPath?: string;
  fileName?: string;
  mimeType?: string;
  content?: string;
  // image_gallery payload
  images?: Array<{
    url: string;
    title: string;
    caption?: string;
  }>;
  // web_canvas payload
  webUrl?: string;
  webTitle?: string;
  webText?: string;
  webHeadings?: string[];
  webLinks?: Array<{ text: string; href: string }>;
  webTables?: Array<string[][]>;
  // interactive_dashboard payload
  metrics?: Array<{
    label: string;
    value: string;
    delta?: string;
    tone?: 'amber' | 'cyan' | 'emerald' | 'rose' | 'slate';
  }>;
  sections?: Array<{
    heading: string;
    body?: string;
    bullets?: string[];
    code?: { language?: string; content: string };
    table?: { headers: string[]; rows: string[][] };
    progress?: Array<{ label: string; value: number; max?: number }>;
  }>;
  // html_artifact payload
  htmlCode?: string;
}

export interface TurnUsageStats {
  model: ConcreteModelId;
  routingMode: 'auto' | 'manual';
  routingReason: string;
  complexityTier: ComplexityTier;
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
  latencyMs: number;
  fallbackUsed: boolean;
  escalationTrail?: ModelEscalationStep[];
  workerModels?: ConcreteModelId[];
  curatorModel?: ConcreteModelId;
  subtasksCount?: number;
}

export interface AegisUser {
  id: number;
  username: string;
  email: string;
  displayName: string;
  authProvider: 'local' | 'google';
  createdAt: string;
}

export interface ExecutedStep {
  tool: string;
  args: Record<string, unknown>;
  status: 'executed' | 'awaiting_confirmation' | 'error';
  result?: unknown;
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

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'proactive' | 'system';
  content: string;
  timestamp: string;
  modality?: 'text' | 'voice';
  steps?: ExecutedStep[];
  pendingConfirmations?: PendingConfirmation[];
  screens?: HolographicScreenSpec[];
  usage?: TurnUsageStats;
  thinkingTrace?: ThinkingTraceEntry[];
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

export interface InteractionRecord {
  id: number;
  session_id: string;
  role: 'user' | 'assistant' | 'tool' | 'proactive';
  content: string;
  tool_calls_json: string | null;
  context_tags: string | null;
  created_at: string;
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

export interface LinuxSystemStatus {
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  uptimeSeconds: number;
  cpuCount: number;
  cpuModel: string;
  totalMemMb: number;
  freeMemMb: number;
  loadAvg: number[];
  workspacePath: string;
  diskUsage: string;
}

export interface LocalFileEntry {
  name: string;
  relativePath: string;
  type: 'file' | 'directory';
  sizeBytes: number;
  modifiedAt: string;
  extension: string;
}

export interface BundleFile {
  name: string;
  pathInPackage: string;
  language: string;
  description: string;
  content: string;
}

export interface WebCredentialSummary {
  id: number;
  site_name: string;
  login_url: string;
  username: string;
  notes: string;
  last_used_at: string | null;
  created_at: string;
}

export interface NavMenuNode {
  label: string;
  href: string;
  level: number;
  kind: 'menu' | 'submenu' | 'tab' | 'breadcrumb' | 'action';
  parentPath: string;
  isActive?: boolean;
  children: NavMenuNode[];
}

export interface DetectedAttachment {
  filename: string;
  href: string;
  extension: string;
  label: string;
  sectionHint: string;
}

export interface SemanticMenuUnderstanding {
  path: string;
  label: string;
  href: string;
  kind: string;
  purpose: string;
  likelyHasAttachments: boolean;
}

export interface WebPageSnapshot {
  url: string;
  status: number;
  title: string;
  textPreview: string;
  headings: string[];
  breadcrumbs?: string[];
  navigationTree?: NavMenuNode[];
  attachments?: DetectedAttachment[];
  links: Array<{ text: string; href: string }>;
  forms: Array<{
    index: number;
    action: string;
    method: string;
    fields: Array<{ name: string; type: string; value?: string; placeholder?: string }>;
  }>;
  tables: Array<string[][]>;
  cookieCount: number;
  timestamp: string;
}

export interface WebRoutine {
  id: number;
  name: string;
  site_name: string;
  credential_id: number | null;
  start_url: string;
  target_sections: string[];
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

export interface WebRoutineRun {
  id: number;
  routine_id: number | null;
  routine_name: string;
  status: 'running' | 'ok' | 'partial' | 'error';
  visited_sections: Array<{
    url: string;
    title: string;
    sectionPath: string;
    understanding: string;
  }>;
  extracted_data: Array<{
    section: string;
    url: string;
    summary: string;
    items: Array<{ label: string; value: string }>;
    tablesCount: number;
  }>;
  downloaded_files: Array<{
    fileName: string;
    localRelativePath: string;
    sizeBytes: number;
    mimeType: string;
    section: string;
    sourceUrl: string;
  }>;
  drive_uploads: Array<{
    fileName: string;
    driveFileId: string;
    driveFolderPath: string;
    webViewLink?: string;
  }>;
  logs: string[];
  summary: string;
  latency_ms: number;
  created_at: string;
}

export interface UsageSummary {
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
  recent: Array<{
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
  }>;
}

export interface ConfirmationModalRequest {
  id: string;
  title: string;
  summary: string;
  actionType: string;
  target: string;
  details?: string;
  onConfirm: () => Promise<void>;
  onCancel?: () => Promise<void> | void;
}

export interface EvolvedCapability {
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

export interface PairedDevice {
  id: string;
  name: string;
  platform: DevicePlatform;
  transport: DeviceTransport;
  serialOrUid: string;
  parentBridgeId: string | null;
  status: 'online' | 'offline';
  liveSocketConnected: boolean;
  capabilities: string[];
  telemetry: Record<string, unknown>;
  storage: Record<string, unknown>;
  apps: unknown[];
  notifications: unknown[];
  files: unknown[];
  lastSeenAt: string;
  createdAt: string;
}

export interface DeviceCommandItem {
  id: string;
  device_id: string;
  command_type: string;
  payload_json: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  result_json: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface BackgroundJobItem {
  id: string;
  title: string;
  prompt: string;
  status: 'running' | 'completed' | 'error';
  phase: string;
  activeModel: string;
  latestActivity: string;
  startedAt: string;
  completedAt?: string;
  announced: boolean;
  result?: {
    reply: string;
    steps: ExecutedStep[];
    pendingConfirmations: PendingConfirmation[];
    screens?: HolographicScreenSpec[];
    cameraAction?: 'enable' | 'disable';
    usage: TurnUsageStats;
  };
  error?: string;
  trace: ThinkingTraceEntry[];
}
