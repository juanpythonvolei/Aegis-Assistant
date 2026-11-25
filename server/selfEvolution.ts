import { Type, type FunctionDeclaration, type Schema } from '@google/genai';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { URL } from 'node:url';
import vm from 'node:vm';
import * as linux from './linuxRuntime.ts';
import * as memory from './memory.ts';

const SKILLS_DIR = path.resolve(process.cwd(), 'server', 'evolved_skills');
if (!fs.existsSync(SKILLS_DIR)) {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
}

const CAPABILITY_NAME_RE = /^[a-z][a-z0-9_]{2,48}$/;

const RESERVED_TOOL_NAMES = new Set([
  'draw_holographic_screen',
  'request_camera_vision',
  'delegate_subagent',
  'evaluate_and_evolve_capability',
  'list_evolved_capabilities',
  'invoke_evolved_capability',
  'linux_system_info',
  'linux_list_files',
  'linux_search_files',
  'linux_read_file',
  'linux_write_file',
  'linux_move_file',
  'linux_delete_file',
  'linux_organize_directory',
  'linux_run_command',
  'memory_save_fact',
  'memory_search',
  'web_navigate',
  'web_extract',
  'web_login',
  'web_perform_action',
  'web_save_credential',
  'gmail_list_analyze',
  'gmail_send_email',
  'gmail_trash_message',
  'drive_list_files',
  'drive_read_file',
  'drive_create_folder',
  'drive_rename_file',
  'drive_move_file',
  'drive_delete_file',
  'calendar_list_events',
  'calendar_create_event',
  'calendar_update_event',
  'calendar_delete_event',
  'docs_create_document',
  'docs_read_document',
  'docs_append_text',
  'docs_replace_content',
  'sheets_create_spreadsheet',
  'sheets_read_values',
  'sheets_update_values',
  'sheets_append_rows',
  'tasks_list',
  'tasks_create',
  'tasks_update',
  'tasks_complete',
]);

const FORBIDDEN_CODE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bprocess\s*\.\s*env\b/i, reason: 'Acesso direto a variáveis de ambiente não é permitido no sandbox.' },
  { pattern: /\bchild_process\b/i, reason: 'Execução direta de child_process é bloqueada no sandbox.' },
  { pattern: /\brequire\s*\(/i, reason: 'require() dinâmico não é permitido; use os helpers fornecidos em ctx.' },
  { pattern: /\bimport\s*\(/i, reason: 'import() dinâmico não é permitido; use os helpers fornecidos em ctx.' },
  { pattern: /^\s*import\s+/m, reason: 'Escreva apenas a função async function run(args, ctx) sem imports externos.' },
  { pattern: /\b__proto__\b|\bprototype\s*\[/i, reason: 'Manipulação de prototype não é permitida.' },
  { pattern: /\bconstructor\s*\.\s*constructor\b/i, reason: 'Escape de contexto via constructor não é permitido.' },
  { pattern: /\beval\s*\(/i, reason: 'eval() não é permitido no sandbox.' },
  { pattern: /\bnew\s+Function\b/i, reason: 'new Function() não é permitido no sandbox.' },
  { pattern: /\bglobalThis\s*\.\s*process\b|\bglobal\s*\.\s*process\b/i, reason: 'Acesso ao objeto global process não é permitido.' },
];

export interface ParameterPropertySpec {
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
}

export interface EvolutionSynthesisInput {
  name: string;
  description: string;
  limitationReason: string;
  parametersSpec: Record<string, ParameterPropertySpec>;
  code: string;
  testArgs?: Record<string, unknown>;
}

export interface EvolutionExecutionResult {
  ok: boolean;
  output?: unknown;
  logs: string[];
  error?: string;
  durationMs: number;
}

function resolveSkillFilePath(name: string): string {
  const clean = name.trim().toLowerCase();
  if (!CAPABILITY_NAME_RE.test(clean)) {
    throw new Error(
      `Nome de capacidade inválido ("${name}"). Use apenas letras minúsculas, números e underscore (3 a 49 caracteres, começando com letra).`
    );
  }
  const target = path.resolve(SKILLS_DIR, `${clean}.mjs`);
  if (!target.startsWith(SKILLS_DIR + path.sep)) {
    throw new Error('Caminho de capacidade fora do diretório permitido.');
  }
  return target;
}

function isBlockedPrivateHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '0.0.0.0' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h === 'metadata.google.internal' ||
    h === '169.254.169.254'
  ) {
    return true;
  }
  if (net.isIPv4(h)) {
    const parts = h.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
  }
  if (net.isIPv6(h) && (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h === '::1')) {
    return true;
  }
  return false;
}

function validateSafeUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Apenas URLs HTTP/HTTPS são permitidas em ctx.fetch.');
  }
  if (isBlockedPrivateHost(parsed.hostname)) {
    throw new Error('Acesso a endereços internos/locais bloqueado em ctx.fetch.');
  }
  return parsed;
}

function parseCsvSimple(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function stringifyCsvSimple(rows: Array<Array<unknown>>, delimiter = ','): string {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? '');
          if (s.includes(delimiter) || s.includes('"') || s.includes('\n')) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(delimiter)
    )
    .join('\n');
}

export function validateCapabilityCode(code: string): { ok: boolean; error?: string } {
  const trimmed = code.trim();
  if (!trimmed || trimmed.length < 15) {
    return { ok: false, error: 'Código muito curto ou vazio.' };
  }
  if (trimmed.length > 24_000) {
    return { ok: false, error: 'Código excede o limite máximo de 24KB por capacidade.' };
  }
  for (const rule of FORBIDDEN_CODE_PATTERNS) {
    if (rule.pattern.test(trimmed)) {
      return { ok: false, error: rule.reason };
    }
  }
  if (!/\bfunction\s+run\b|\bconst\s+run\s*=|\blet\s+run\s*=/.test(trimmed)) {
    return {
      ok: false,
      error: 'O código deve definir `async function run(args, ctx) { ... }` (ou `const run = async (args, ctx) => ...`).',
    };
  }
  return { ok: true };
}

function normalizeUserCodeForVm(rawCode: string): string {
  // Strip optional `export default` or `export ` prefixes so both ESM-style and plain JS compile seamlessly
  return rawCode
    .replace(/^\s*export\s+default\s+/gm, 'const run = ')
    .replace(/^\s*export\s+(async\s+function|function|const|let)\s+/gm, '$1 ');
}

export async function runCodeInSandbox(
  rawCode: string,
  args: Record<string, unknown>,
  timeoutMs = 5000
): Promise<EvolutionExecutionResult> {
  const t0 = Date.now();
  const logs: string[] = [];

  const check = validateCapabilityCode(rawCode);
  if (!check.ok) {
    return { ok: false, logs, error: check.error, durationMs: Date.now() - t0 };
  }

  const normalized = normalizeUserCodeForVm(rawCode);
  const wrappedSource = `
    "use strict";
    ${normalized}
    if (typeof run !== 'function') {
      throw new Error('Função run(args, ctx) não encontrada após compilação.');
    }
    run;
  `;

  const safeCtx = {
    nowIso: () => new Date().toISOString(),
    log: (...parts: unknown[]) => {
      if (logs.length < 40) {
        logs.push(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ').slice(0, 400));
      }
    },
    fetchText: async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const safeUrl = validateSafeUrl(url);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 4500));
      try {
        const res = await fetch(safeUrl.toString(), {
          method: init?.method || 'GET',
          headers: {
            'User-Agent': 'Aegis-Evolved-Skill/1.0',
            ...(init?.headers || {}),
          },
          body: init?.body,
          signal: controller.signal,
        });
        const text = await res.text();
        return { ok: res.ok, status: res.status, text: text.slice(0, 60_000) };
      } finally {
        clearTimeout(timer);
      }
    },
    fetchJson: async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const safeUrl = validateSafeUrl(url);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 4500));
      try {
        const res = await fetch(safeUrl.toString(), {
          method: init?.method || 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Aegis-Evolved-Skill/1.0',
            ...(init?.headers || {}),
          },
          body: init?.body,
          signal: controller.signal,
        });
        const data = await res.json();
        return { ok: res.ok, status: res.status, data };
      } finally {
        clearTimeout(timer);
      }
    },
    workspace: {
      list: (subpath = '.') => linux.listLocalFiles(subpath),
      read: (relPath: string) => linux.readLocalFile(relPath),
      write: (relPath: string, content: string) => linux.writeLocalFile(relPath, content),
    },
    crypto: {
      sha256: (input: string) => crypto.createHash('sha256').update(String(input)).digest('hex'),
      uuid: () => crypto.randomUUID(),
      base64Encode: (input: string) => Buffer.from(String(input), 'utf8').toString('base64'),
      base64Decode: (input: string) => Buffer.from(String(input), 'base64').toString('utf8'),
    },
    csv: {
      parse: parseCsvSimple,
      stringify: stringifyCsvSimple,
    },
    html: {
      stripTags: (html: string) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    },
  };

  const sandboxGlobals = {
    Math,
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    Promise,
    URL,
    URLSearchParams,
    Error,
    TypeError,
    RangeError,
    Intl,
    encodeURIComponent,
    decodeURIComponent,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    console: {
      log: safeCtx.log,
      info: safeCtx.log,
      warn: safeCtx.log,
      error: safeCtx.log,
    },
  };

  try {
    const context = vm.createContext(sandboxGlobals, {
      codeGeneration: { strings: false, wasm: false },
    });
    const script = new vm.Script(wrappedSource, { filename: 'evolved_skill.mjs' });
    const runFn = script.runInContext(context, { timeout: 1500 }) as (
      a: Record<string, unknown>,
      c: typeof safeCtx
    ) => Promise<unknown> | unknown;

    const clonedArgs = JSON.parse(JSON.stringify(args || {})) as Record<string, unknown>;
    const execPromise = Promise.resolve().then(() => runFn(clonedArgs, safeCtx));
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Tempo limite excedido (${timeoutMs}ms) ao executar capacidade evoluída.`)), timeoutMs)
    );

    const result = await Promise.race([execPromise, timeoutPromise]);
    return {
      ok: true,
      output: result,
      logs,
      durationMs: Date.now() - t0,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      logs,
      error: err instanceof Error ? err.message : String(err || 'Erro ao executar código evoluído.'),
      durationMs: Date.now() - t0,
    };
  }
}

export async function createOrUpdateEvolvedCapability(input: EvolutionSynthesisInput): Promise<{
  ok: boolean;
  capability?: memory.EvolvedCapabilityRecord;
  testResult: EvolutionExecutionResult;
  error?: string;
}> {
  const cleanName = input.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!CAPABILITY_NAME_RE.test(cleanName)) {
    const err = `Nome inválido "${input.name}". Use snake_case começando com letra (ex: parse_ofx_extrato).`;
    return { ok: false, error: err, testResult: { ok: false, logs: [], error: err, durationMs: 0 } };
  }
  if (RESERVED_TOOL_NAMES.has(cleanName)) {
    const err = `O nome "${cleanName}" pertence a uma ferramenta nativa. Escolha um nome novo para a função evoluída.`;
    return { ok: false, error: err, testResult: { ok: false, logs: [], error: err, durationMs: 0 } };
  }

  const codeCheck = validateCapabilityCode(input.code);
  if (!codeCheck.ok) {
    return {
      ok: false,
      error: codeCheck.error,
      testResult: { ok: false, logs: [], error: codeCheck.error, durationMs: 0 },
    };
  }

  // Run automated sandbox verification before persisting
  const testResult = await runCodeInSandbox(input.code, input.testArgs || {}, 5000);
  if (!testResult.ok) {
    return {
      ok: false,
      error: `Falha na autoverificação do código gerado: ${testResult.error}`,
      testResult,
    };
  }

  const targetFile = resolveSkillFilePath(cleanName);
  const relativeFilePath = path.relative(process.cwd(), targetFile);

  const fileHeader = `// Aegis Self-Evolved Capability: ${cleanName}\n// Triggered by limitation: ${input.limitationReason.replace(/\n/g, ' ')}\n// Generated at: ${new Date().toISOString()}\n\n`;
  const moduleBody = input.code.trim().includes('export ')
    ? input.code.trim()
    : `${input.code.trim()}\n\nexport { run };\n`;

  fs.writeFileSync(targetFile, `${fileHeader}${moduleBody}\n`, 'utf8');

  const capability = memory.upsertEvolvedCapability({
    name: cleanName,
    description: input.description.trim(),
    limitationReason: input.limitationReason.trim(),
    parametersSchemaJson: JSON.stringify(input.parametersSpec || {}),
    code: input.code.trim(),
    filePath: relativeFilePath,
    testStatus: 'passed',
    testOutput: JSON.stringify({ output: testResult.output, logs: testResult.logs, durationMs: testResult.durationMs }),
    enabled: true,
  });

  return {
    ok: true,
    capability,
    testResult,
  };
}

export async function executeEvolvedCapability(
  name: string,
  args: Record<string, unknown>
): Promise<EvolutionExecutionResult & { capabilityName: string; version?: number }> {
  const cap = memory.getEvolvedCapabilityByName(name.trim().toLowerCase());
  if (!cap) {
    return {
      ok: false,
      capabilityName: name,
      logs: [],
      error: `Capacidade evoluída "${name}" não encontrada.`,
      durationMs: 0,
    };
  }
  if (!cap.enabled) {
    return {
      ok: false,
      capabilityName: cap.name,
      version: cap.version,
      logs: [],
      error: `Capacidade evoluída "${cap.name}" está desativada nas configurações de auto-evolução.`,
      durationMs: 0,
    };
  }

  const res = await runCodeInSandbox(cap.code, args || {}, 5000);
  memory.recordEvolvedCapabilityRun(cap.name, res.ok, res.error);
  return {
    ...res,
    capabilityName: cap.name,
    version: cap.version,
  };
}

export function getActiveEvolvedToolDeclarations(): FunctionDeclaration[] {
  const caps = memory.listEvolvedCapabilities().filter((c) => c.enabled === 1);
  const declarations: FunctionDeclaration[] = [];

  for (const cap of caps) {
    let parsedSpec: Record<string, ParameterPropertySpec> = {};
    try {
      parsedSpec = JSON.parse(cap.parameters_schema_json || '{}') as Record<string, ParameterPropertySpec>;
    } catch {
      parsedSpec = {};
    }

    const properties: Record<string, Schema> = {};
    const required: string[] = [];

    for (const [key, spec] of Object.entries(parsedSpec)) {
      const typeEnum =
        spec?.type === 'number'
          ? Type.NUMBER
          : spec?.type === 'boolean'
          ? Type.BOOLEAN
          : Type.STRING;
      properties[key] = {
        type: typeEnum,
        description: String(spec?.description || key),
      };
      if (spec?.required) {
        required.push(key);
      }
    }

    declarations.push({
      name: cap.name,
      description: `[AUTO-EVOLUÍDA v${cap.version}] ${cap.description}`,
      parameters: {
        type: Type.OBJECT,
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
    });
  }

  return declarations;
}

export function deleteEvolvedCapabilityFull(name: string): boolean {
  const clean = name.trim().toLowerCase();
  try {
    const filePath = resolveSkillFilePath(clean);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore file deletion error if name invalid or already removed
  }
  return memory.deleteEvolvedCapability(clean);
}
