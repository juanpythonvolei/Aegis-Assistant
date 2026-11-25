import { exec } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export const LINUX_WORKSPACE_ROOT = path.resolve(process.cwd(), 'linux_workspace');

function ensureWorkspaceSeeded(): void {
  const dirs = ['Documentos', 'Downloads', 'Projetos', 'Scripts', 'Logs'];
  if (!fs.existsSync(LINUX_WORKSPACE_ROOT)) {
    fs.mkdirSync(LINUX_WORKSPACE_ROOT, { recursive: true });
    for (const dir of dirs) {
      fs.mkdirSync(path.join(LINUX_WORKSPACE_ROOT, dir), { recursive: true });
    }
    fs.writeFileSync(
      path.join(LINUX_WORKSPACE_ROOT, 'Documentos', 'notas-arquitetura.md'),
      '# Arquitetura Local Aegis\n\n- Integração local via systemd --user\n- Sincronização seletiva com Google Drive e Gmail\n- Memória persistente local em SQLite\n',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(LINUX_WORKSPACE_ROOT, 'Downloads', 'fatura_servidor_outubro.txt'),
      'Fornecedor: Cloud Compute Linux\nValor: R$ 189,00\nVencimento: 2026-11-20\nStatus: Pendente de conferência\n',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(LINUX_WORKSPACE_ROOT, 'Downloads', 'relatorio_metricas_q4.csv'),
      'servico,cpu_pct,memoria_mb,status\naegis-daemon,1.8,48,ativo\nsystemd-journald,0.4,24,ativo\npostgres-local,3.2,210,ativo\n',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(LINUX_WORKSPACE_ROOT, 'Downloads', 'backup_dotfiles.sh'),
      '#!/usr/bin/env bash\nset -euo pipefail\ntar -czf ~/Backups/dotfiles-$(date +%F).tar.gz ~/.bashrc ~/.zshrc ~/.config/nvim\n',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(LINUX_WORKSPACE_ROOT, 'Scripts', 'healthcheck.sh'),
      '#!/usr/bin/env bash\necho "Host: $(hostname) | Kernel: $(uname -r)"\ndf -h / | tail -n 1\nfree -h | head -n 2\n',
      'utf-8'
    );
  }
}

ensureWorkspaceSeeded();

export function resolveSafePath(relativePath = '.'): string {
  const cleaned = relativePath.replace(/^~\/?/, '').replace(/^\/+/, '');
  const target = path.resolve(LINUX_WORKSPACE_ROOT, cleaned || '.');
  if (!target.startsWith(LINUX_WORKSPACE_ROOT)) {
    throw new Error('Caminho fora do diretório de trabalho local permitido.');
  }
  return target;
}

export interface LocalFileEntry {
  name: string;
  relativePath: string;
  type: 'file' | 'directory';
  sizeBytes: number;
  modifiedAt: string;
  extension: string;
}

export function listLocalFiles(subpath = '.'): LocalFileEntry[] {
  const targetDir = resolveSafePath(subpath);
  if (!fs.existsSync(targetDir)) {
    return [];
  }
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  return entries
    .map((entry) => {
      const full = path.join(targetDir, entry.name);
      const stat = fs.statSync(full);
      const rel = path.relative(LINUX_WORKSPACE_ROOT, full);
      return {
        name: entry.name,
        relativePath: rel,
        type: entry.isDirectory() ? 'directory' : 'file',
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        extension: entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase(),
      } satisfies LocalFileEntry;
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function searchLocalFiles(query: string, subpath = '.'): Array<{
  relativePath: string;
  matchType: 'filename' | 'content';
  excerpt: string;
}> {
  const root = resolveSafePath(subpath);
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: Array<{ relativePath: string; matchType: 'filename' | 'content'; excerpt: string }> = [];

  function walk(dir: string) {
    if (results.length >= 40) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(LINUX_WORKSPACE_ROOT, full);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        if (entry.name.toLowerCase().includes(needle)) {
          results.push({ relativePath: rel, matchType: 'filename', excerpt: entry.name });
        }
        const stat = fs.statSync(full);
        if (stat.size <= 512 * 1024) {
          try {
            const text = fs.readFileSync(full, 'utf-8');
            const idx = text.toLowerCase().indexOf(needle);
            if (idx !== -1) {
              const start = Math.max(0, idx - 40);
              const end = Math.min(text.length, idx + needle.length + 80);
              results.push({
                relativePath: rel,
                matchType: 'content',
                excerpt: text.slice(start, end).replace(/\s+/g, ' ').trim(),
              });
            }
          } catch {
            // Skip binary files
          }
        }
      }
    }
  }

  if (fs.existsSync(root)) walk(root);
  return results;
}

export function detectLocalMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.ts': 'text/typescript',
    '.tsx': 'text/typescript',
    '.py': 'text/x-python',
    '.sh': 'text/x-shellscript',
    '.xml': 'application/xml',
  };
  return map[ext] || 'text/plain';
}

export function readLocalFile(relativePath: string): {
  path: string;
  name: string;
  mimeType: string;
  kind: 'text' | 'pdf' | 'image' | 'audio' | 'video';
  content: string;
  sizeBytes: number;
} {
  const target = resolveSafePath(relativePath);
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    throw new Error(`Arquivo não encontrado: ${relativePath}`);
  }
  const mimeType = detectLocalMime(target);
  const sizeBytes = fs.statSync(target).size;
  const rel = path.relative(LINUX_WORKSPACE_ROOT, target);
  const name = path.basename(target);

  if (mimeType === 'application/pdf') {
    return { path: rel, name, mimeType, kind: 'pdf', content: '', sizeBytes };
  }
  if (mimeType.startsWith('image/') && mimeType !== 'image/svg+xml') {
    return { path: rel, name, mimeType, kind: 'image', content: '', sizeBytes };
  }
  if (mimeType.startsWith('audio/')) {
    return { path: rel, name, mimeType, kind: 'audio', content: '', sizeBytes };
  }
  if (mimeType.startsWith('video/')) {
    return { path: rel, name, mimeType, kind: 'video', content: '', sizeBytes };
  }

  const content = fs.readFileSync(target, 'utf-8');
  return {
    path: rel,
    name,
    mimeType,
    kind: 'text',
    content: content.slice(0, 200_000),
    sizeBytes,
  };
}

export function readLocalMedia(relativePath: string): { mimeType: string; buffer: Buffer } {
  const target = resolveSafePath(relativePath);
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    throw new Error(`Arquivo não encontrado: ${relativePath}`);
  }
  return {
    mimeType: detectLocalMime(target),
    buffer: fs.readFileSync(target),
  };
}

export function writeLocalFile(relativePath: string, content: string): { path: string; bytesWritten: number } {
  const target = resolveSafePath(relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf-8');
  return {
    path: path.relative(LINUX_WORKSPACE_ROOT, target),
    bytesWritten: Buffer.byteLength(content, 'utf-8'),
  };
}

export function moveLocalFile(sourceRel: string, destRel: string): { from: string; to: string } {
  const src = resolveSafePath(sourceRel);
  const dst = resolveSafePath(destRel);
  if (!fs.existsSync(src)) {
    throw new Error(`Origem não encontrada: ${sourceRel}`);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.renameSync(src, dst);
  return {
    from: path.relative(LINUX_WORKSPACE_ROOT, src),
    to: path.relative(LINUX_WORKSPACE_ROOT, dst),
  };
}

export function deleteLocalFile(relativePath: string): { deleted: string } {
  const target = resolveSafePath(relativePath);
  if (!fs.existsSync(target)) {
    throw new Error(`Arquivo não encontrado: ${relativePath}`);
  }
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    fs.rmSync(target, { recursive: true, force: false });
  } else {
    fs.unlinkSync(target);
  }
  return { deleted: path.relative(LINUX_WORKSPACE_ROOT, target) };
}

export function planDirectoryOrganization(subpath = 'Downloads'): Array<{ from: string; to: string; category: string }> {
  const dir = resolveSafePath(subpath);
  if (!fs.existsSync(dir)) return [];

  const categoryMap: Record<string, string> = {
    '.pdf': 'Documentos',
    '.doc': 'Documentos',
    '.docx': 'Documentos',
    '.txt': 'Documentos',
    '.md': 'Documentos',
    '.csv': 'Dados',
    '.json': 'Dados',
    '.xlsx': 'Dados',
    '.sh': 'Scripts',
    '.py': 'Scripts',
    '.ts': 'Codigo',
    '.js': 'Codigo',
    '.png': 'Imagens',
    '.jpg': 'Imagens',
    '.jpeg': 'Imagens',
    '.webp': 'Imagens',
    '.zip': 'Arquivos',
    '.tar': 'Arquivos',
    '.gz': 'Arquivos',
  };

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const plan: Array<{ from: string; to: string; category: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const category = categoryMap[ext] || 'Outros';
    const fromRel = path.relative(LINUX_WORKSPACE_ROOT, path.join(dir, entry.name));
    const toRel = path.relative(LINUX_WORKSPACE_ROOT, path.join(dir, category, entry.name));
    plan.push({ from: fromRel, to: toRel, category });
  }
  return plan;
}

export function applyDirectoryOrganization(moves: Array<{ from: string; to: string }>): { movedCount: number; moves: Array<{ from: string; to: string }> } {
  const completed: Array<{ from: string; to: string }> = [];
  for (const m of moves) {
    const res = moveLocalFile(m.from, m.to);
    completed.push(res);
  }
  return { movedCount: completed.length, moves: completed };
}

const READ_ONLY_COMMANDS = new Set([
  'ls',
  'll',
  'pwd',
  'cat',
  'head',
  'tail',
  'find',
  'grep',
  'rg',
  'wc',
  'uname',
  'uptime',
  'df',
  'free',
  'whoami',
  'id',
  'date',
  'echo',
  'stat',
  'ps',
  'env',
  'which',
  'du',
]);

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*|--recursive|--force)/i,
  /\brm\s+/i,
  /\brmdir\b/i,
  /\bshred\b/i,
  /\bwipefs\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bfdisk\b|\bparted\b|\bdiskpart\b/i,
  /\bformat\s+[a-z]:/i,
  /\bshutdown\b|\breboot\b|\bpoweroff\b|\bhalt\b|\bstop-computer\b|\brestart-computer\b/i,
  /\bkill\s+-9\b|\bkillall\b|\bpkill\b|\btaskkill\b|\bstop-process\b/i,
  /\bchmod\s+-R\s+000\b|\bchown\s+-R\s+/i,
  /\breg\s+delete\b|\bremove-item\b.*(-recurse|-force)/i,
  /\bdel\s+\/[sfq]/i,
  /\btruncate\b/i,
  /\bsystemctl\s+(stop|disable|mask)\b/i,
];

const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\/(\s|$)/i,
  /:\(\)\s*\{/,
  /\/etc\/shadow/i,
];

export function isDestructiveShellCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  return DESTRUCTIVE_PATTERNS.some((rx) => rx.test(trimmed));
}

export function isMutatingShellCommand(command: string): boolean {
  return isDestructiveShellCommand(command);
}

export async function runLinuxCommand(command: string): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  cwd: string;
}> {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error('Comando bloqueado pela política de segurança do sistema.');
    }
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: LINUX_WORKSPACE_ROOT,
      timeout: 12000,
      maxBuffer: 512 * 1024,
      env: { ...process.env, LANG: 'C.UTF-8' },
    });
    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
      cwd: LINUX_WORKSPACE_ROOT,
    };
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: (execErr.stdout || '').trim(),
      stderr: (execErr.stderr || execErr.message || 'Erro ao executar comando').trim(),
      exitCode: typeof execErr.code === 'number' ? execErr.code : 1,
      cwd: LINUX_WORKSPACE_ROOT,
    };
  }
}

export async function getLinuxSystemStatus(): Promise<{
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
}> {
  let diskUsage = 'Indisponível';
  try {
    const { stdout } = await execAsync('df -h . | tail -n 1', { cwd: LINUX_WORKSPACE_ROOT, timeout: 4000 });
    diskUsage = stdout.trim();
  } catch {
    diskUsage = 'N/A';
  }

  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    uptimeSeconds: Math.floor(os.uptime()),
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model || 'Linux CPU',
    totalMemMb: Math.round(os.totalmem() / (1024 * 1024)),
    freeMemMb: Math.round(os.freemem() / (1024 * 1024)),
    loadAvg: os.loadavg().map((n) => Number(n.toFixed(2))),
    workspacePath: LINUX_WORKSPACE_ROOT,
    diskUsage,
  };
}
