import JSZip from 'jszip';
import { getLocalHoloUiHtml } from './localHoloUi.ts';

export interface BundleFile {
  name: string;
  pathInPackage: string;
  language: string;
  description: string;
  content: string;
}

const INSTALL_WINDOWS_PS1 = `#Requires -Version 5.1
$ErrorActionPreference = "Stop"

Write-Host "==> Instalando Aegis Agente Local Windows (Acesso Total ao Sistema)..." -ForegroundColor Yellow

$AegisHome = Join-Path $env:LOCALAPPDATA "Aegis"
$ConfigDir = Join-Path $env:APPDATA "Aegis"
$BinDir = Join-Path $env:USERPROFILE ".local\\bin"

New-Item -ItemType Directory -Force -Path $AegisHome, $ConfigDir, $BinDir | Out-Null

# Verificar Node.js >= 20
$needNode = $true
if (Get-Command node -ErrorAction SilentlyContinue) {
  $nodeVer = (node -v).TrimStart("v")
  $major = [int]($nodeVer.Split(".")[0])
  if ($major -ge 20) {
    $needNode = $false
    Write-Host "==> Node.js detectado: v$nodeVer" -ForegroundColor Green
  }
}

if ($needNode) {
  Write-Host "==> Node.js >= 20 nao encontrado. Instalando via winget (OpenJS.NodeJS.LTS)..." -ForegroundColor Cyan
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  } else {
    Write-Host "ERRO: Instale Node.js 22 LTS em https://nodejs.org e execute este script novamente." -ForegroundColor Red
    exit 1
  }
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Copy-Item -Force (Join-Path $ScriptDir "aegis-daemon.mjs") (Join-Path $AegisHome "aegis-daemon.mjs")
Copy-Item -Force (Join-Path $ScriptDir "aegis-cli.mjs") (Join-Path $AegisHome "aegis-cli.mjs")
Copy-Item -Force (Join-Path $ScriptDir "ui.html") (Join-Path $AegisHome "ui.html")
Copy-Item -Force (Join-Path $ScriptDir "package.json") (Join-Path $AegisHome "package.json")
Copy-Item -Force (Join-Path $ScriptDir "start-aegis.bat") (Join-Path $AegisHome "start-aegis.bat")

Write-Host "==> Runtime zero-dependencias (Node.js nativo, sem npm install necessario)." -ForegroundColor Cyan

$EnvFile = Join-Path $ConfigDir "env"
if (-not (Test-Path $EnvFile)) {
@"
# Defina sua chave Gemini localmente para o agente Windows:
# GEMINI_API_KEY=sua-chave-aqui
AEGIS_PORT=3847
AEGIS_WATCH_DIR=$env:USERPROFILE\\Downloads
"@ | Set-Content -Path $EnvFile -Encoding UTF8
}

# Wrapper CLI aegis.cmd
$AegisCmd = Join-Path $BinDir "aegis.cmd"
@"
@echo off
node "$AegisHome\\aegis-cli.mjs" %*
"@ | Set-Content -Path $AegisCmd -Encoding ASCII

# Adicionar BinDir ao PATH do usuario se necessario
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$BinDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", "User")
}

# Registrar inicializacao automatica no logon do Windows
try {
  $VbsPath = Join-Path $AegisHome "launch-hidden.vbs"
  $Action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument ('"' + $VbsPath + '"')
  @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c ""$AegisHome\\start-aegis.bat""", 0, False
"@ | Set-Content -Path $VbsPath -Encoding ASCII
  $Trigger = New-ScheduledTaskTrigger -AtLogOn
  Register-ScheduledTask -TaskName "AegisLocalDaemon" -Action $Action -Trigger $Trigger -Description "Aegis Assistente Local Windows" -Force | Out-Null
  Write-Host "==> Tarefa agendada AegisLocalDaemon registrada para iniciar com o Windows." -ForegroundColor Green
} catch {
  Write-Host "==> Aviso: nao foi possivel registrar tarefa agendada automaticamente. Use start-aegis.bat." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Yellow
Write-Host " Aegis Windows instalado com sucesso!" -ForegroundColor Green
Write-Host " 1) Edite $EnvFile e informe sua GEMINI_API_KEY"
Write-Host " 2) Execute: $AegisHome\\start-aegis.bat"
Write-Host " 3) Interface Holografica Local: http://127.0.0.1:3847"
Write-Host "==========================================================" -ForegroundColor Yellow
`;

const START_AEGIS_BAT = `@echo off
setlocal enabledelayedexpansion
set "AEGIS_HOME=%LOCALAPPDATA%\\Aegis"
set "ENV_FILE=%APPDATA%\\Aegis\\env"

if exist "%ENV_FILE%" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    set "KEY=%%A"
    if not "!KEY:~0,1!"=="#" (
      if not "%%A"=="" set "%%A=%%B"
    )
  )
)

echo Iniciando Aegis Agente Local Windows em http://127.0.0.1:3847 ...
start "" "http://127.0.0.1:3847"
node "%AEGIS_HOME%\\aegis-daemon.mjs"
`;

const INSTALL_SH = `#!/usr/bin/env bash
set -euo pipefail

AEGIS_HOME="$HOME/.local/share/aegis"
AEGIS_BIN="$HOME/.local/bin"
CONFIG_DIR="$HOME/.config/aegis"
SYSTEMD_DIR="$HOME/.config/systemd/user"
DESKTOP_DIR="$HOME/.local/share/applications"

echo "==> Instalando Aegis Assistente Local Linux..."

mkdir -p "$AEGIS_HOME/bin" "$AEGIS_BIN" "$CONFIG_DIR" "$SYSTEMD_DIR" "$DESKTOP_DIR"

NEED_PORTABLE_NODE=1
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 22 ]; then
    NEED_PORTABLE_NODE=0
    ln -sf "$(command -v node)" "$AEGIS_HOME/bin/node"
    ln -sf "$(command -v npm)" "$AEGIS_HOME/bin/npm"
    echo "==> Usando Node.js do sistema ($(node -v))."
  else
    echo "==> Node.js do sistema é $(node -v) (< v22). Baixando runtime isolado Node.js v22 LTS para o Aegis..."
  fi
else
  echo "==> Node.js >= 22 não encontrado no sistema. Baixando runtime isolado Node.js v22 LTS para o Aegis..."
fi

if [ "$NEED_PORTABLE_NODE" -eq 1 ]; then
  if [ ! -x "$AEGIS_HOME/node-runtime/bin/node" ]; then
    RAW_ARCH=$(uname -m)
    case "$RAW_ARCH" in
      x86_64|amd64) NODE_ARCH="x64" ;;
      aarch64|arm64) NODE_ARCH="arm64" ;;
      *) echo "Erro: arquitetura não suportada para download automático: $RAW_ARCH"; exit 1 ;;
    esac

    NODE_VER="v22.14.0"
    NODE_TAR="node-\${NODE_VER}-linux-\${NODE_ARCH}.tar.xz"
    NODE_URL="https://nodejs.org/dist/\${NODE_VER}/\${NODE_TAR}"
    TMP_TAR="/tmp/\${NODE_TAR}"

    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "$NODE_URL" -o "$TMP_TAR"
    elif command -v wget >/dev/null 2>&1; then
      wget -qO "$TMP_TAR" "$NODE_URL"
    else
      echo "Erro: instale curl ou wget para baixar o Node.js v22."
      exit 1
    fi

    rm -rf "$AEGIS_HOME/node-runtime"
    mkdir -p "$AEGIS_HOME/node-runtime"
    tar -xJf "$TMP_TAR" --strip-components=1 -C "$AEGIS_HOME/node-runtime"
    rm -f "$TMP_TAR"
  fi
  ln -sf "$AEGIS_HOME/node-runtime/bin/node" "$AEGIS_HOME/bin/node"
  ln -sf "$AEGIS_HOME/node-runtime/bin/npm" "$AEGIS_HOME/bin/npm"
  echo "==> Runtime isolado ativo: $($AEGIS_HOME/bin/node -v)"
fi

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/aegis-daemon.mjs" "$AEGIS_HOME/aegis-daemon.mjs"
cp "$SCRIPT_DIR/aegis-cli.mjs" "$AEGIS_HOME/aegis-cli.mjs"
cp "$SCRIPT_DIR/ui.html" "$AEGIS_HOME/ui.html"
cp "$SCRIPT_DIR/package.json" "$AEGIS_HOME/package.json"

echo "==> Runtime zero-dependências pronto (sem necessidade de npm install)."

cat << 'EOF' > "$AEGIS_BIN/aegis"
#!/usr/bin/env bash
exec "$HOME/.local/share/aegis/bin/node" "$HOME/.local/share/aegis/aegis-cli.mjs" "$@"
EOF
chmod +x "$AEGIS_BIN/aegis"

if [ ! -f "$CONFIG_DIR/env" ]; then
  cat << 'EOF' > "$CONFIG_DIR/env"
# Defina sua chave Gemini localmente para o daemon Linux:
# GEMINI_API_KEY="sua-chave-aqui"
AEGIS_PORT=3847
AEGIS_WATCH_DIR="$HOME/Downloads"
EOF
fi

cp "$SCRIPT_DIR/aegis.service" "$SYSTEMD_DIR/aegis.service"
cp "$SCRIPT_DIR/aegis.desktop" "$DESKTOP_DIR/aegis.desktop"

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload || true
  systemctl --user enable aegis.service || true
  systemctl --user restart aegis.service || true
  echo "==> Serviço systemd --user (aegis.service) habilitado na porta 3847."
fi

echo ""
echo "Instalação concluída!"
if [[ ":$PATH:" != *":$AEGIS_BIN:"* ]]; then
  echo '  0. Adicione ao ~/.bashrc ou ~/.zshrc: export PATH="$HOME/.local/bin:$PATH"'
fi
echo "  1. Configure GEMINI_API_KEY em $CONFIG_DIR/env e rode: systemctl --user restart aegis"
echo "  2. Interface gráfica local: http://127.0.0.1:3847 (ou execute 'aegis --ui')"
echo "  3. Terminal interativo: 'aegis --chat'"
`;

const PACKAGE_JSON_LINUX = `{
  "name": "aegis-linux-agent",
  "version": "2.1.0",
  "type": "module",
  "private": true,
  "dependencies": {}
}
`;

const AEGIS_DAEMON_MJS = `import http from 'node:http';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const DATA_DIR = path.join(HOME, '.local', 'share', 'aegis');

// Auto-load ~/.config/aegis/env, ~/.config/aegis/aegis.env, and SCRIPT_DIR/.env
function loadLocalEnvFiles() {
  const candidates = [
    path.join(HOME, '.config', 'aegis', 'env'),
    path.join(HOME, '.config', 'aegis', 'aegis.env'),
    path.join(HOME, 'AppData', 'Roaming', 'Aegis', 'env'),
    path.join(SCRIPT_DIR, '.env'),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const lines = fs.readFileSync(file, 'utf-8').split(/\\r?\\n/);
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const key = line.slice(0, eq).replace(/^export\\s+/, '').trim();
        let val = line.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        val = val.replace(/^\\$HOME\\b/, HOME).replace(/^~(?=[\\/\\\\]|$)/, HOME);
        if (key && !process.env[key] && val) {
          process.env[key] = val;
        }
      }
    } catch {}
  }
}
loadLocalEnvFiles();

const Type = {
  OBJECT: 'OBJECT',
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  ARRAY: 'ARRAY',
};

const MEMORY_FILE = path.join(DATA_DIR, 'memory.jsonl');
const FACTS_FILE = path.join(DATA_DIR, 'facts.json');
const USAGE_FILE = path.join(DATA_DIR, 'usage.jsonl');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const VAULT_FILE = path.join(DATA_DIR, 'vault.enc.json');
const CLOUD_FILE = path.join(DATA_DIR, 'cloud.enc.json');
const GOOGLE_SYNC_CACHE_FILE = path.join(DATA_DIR, 'google_sync_cache.json');
const GOOGLE_SYNC_DIR = path.join(HOME, 'AegisGoogleSync');
const KEY_FILE = path.join(DATA_DIR, '.vault_key');
const CLI_TOKEN_FILE = path.join(DATA_DIR, '.cli_token');
const PORT = Number(process.env.AEGIS_PORT || 3847);
const WATCH_DIR = process.env.AEGIS_WATCH_DIR || path.join(HOME, 'Downloads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(GOOGLE_SYNC_DIR, { recursive: true });
if (!fs.existsSync(FACTS_FILE)) fs.writeFileSync(FACTS_FILE, '[]', 'utf-8');
if (!fs.existsSync(MEMORY_FILE)) fs.writeFileSync(MEMORY_FILE, '', 'utf-8');
if (!fs.existsSync(USAGE_FILE)) fs.writeFileSync(USAGE_FILE, '', 'utf-8');

function loadLocalSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) || {};
  } catch {
    return {};
  }
}

function saveLocalSettings(patch) {
  const cur = loadLocalSettings();
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

function saveLocalApiKey(apiKey) {
  const clean = String(apiKey || '').trim();
  const envDir = IS_WIN ? path.join(HOME, 'AppData', 'Roaming', 'Aegis') : path.join(HOME, '.config', 'aegis');
  fs.mkdirSync(envDir, { recursive: true });
  const envPath = path.join(envDir, 'env');
  let lines = [];
  if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, 'utf-8').split(/\\r?\\n/).filter((l) => !/^\\s*(export\\s+)?GEMINI_API_KEY\\s*=/.test(l));
  }
  if (clean) {
    lines.push('GEMINI_API_KEY=' + clean);
    process.env.GEMINI_API_KEY = clean;
  } else {
    delete process.env.GEMINI_API_KEY;
  }
  fs.writeFileSync(envPath, lines.filter((l, i, arr) => l || i < arr.length - 1).join('\\n') + '\\n', { mode: 0o600 });
}

const backgroundJobs = new Map();
const BACKGROUND_JOB_ORDER = [];
function upsertBackgroundJob(job) {
  backgroundJobs.set(job.id, job);
  if (!BACKGROUND_JOB_ORDER.includes(job.id)) {
    BACKGROUND_JOB_ORDER.unshift(job.id);
    while (BACKGROUND_JOB_ORDER.length > 30) {
      const oldId = BACKGROUND_JOB_ORDER.pop();
      if (oldId) backgroundJobs.delete(oldId);
    }
  }
}

function getVaultKey() {
  if (fs.existsSync(KEY_FILE)) {
    const hex = fs.readFileSync(KEY_FILE, 'utf-8').trim();
    if (hex.length === 64) return Buffer.from(hex, 'hex');
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  return key;
}
const VAULT_KEY = getVaultKey();

function getCliToken() {
  if (fs.existsSync(CLI_TOKEN_FILE)) {
    return fs.readFileSync(CLI_TOKEN_FILE, 'utf-8').trim();
  }
  const tok = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(CLI_TOKEN_FILE, tok, { mode: 0o600 });
  return tok;
}
const CLI_TOKEN = getCliToken();
const activeSessions = new Map();

function encryptStr(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', VAULT_KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    cipherText: enc.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

function decryptStr(cipherText, ivB64, tagB64) {
  const dec = crypto.createDecipheriv('aes-256-gcm', VAULT_KEY, Buffer.from(ivB64, 'base64'));
  dec.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([dec.update(Buffer.from(cipherText, 'base64')), dec.final()]).toString('utf8');
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(pw, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 2) return false;
  const derived = crypto.scryptSync(pw, parts[0], 64);
  const orig = Buffer.from(parts[1], 'hex');
  return derived.length === orig.length && crypto.timingSafeEqual(derived, orig);
}

function loadAuthUser() {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function isAuthed(req) {
  const authUser = loadAuthUser();
  if (!authUser) return false;
  let tok = req.headers['x-aegis-local-token'];
  if (!tok && req.url && req.url.includes('token=')) {
    try {
      tok = new URL(req.url, 'http://127.0.0.1').searchParams.get('token');
    } catch {}
  }
  if (!tok) return false;
  if (tok === CLI_TOKEN) return true;
  const exp = activeSessions.get(tok);
  return Boolean(exp && exp > Date.now());
}

// Zero-dependency Gemini REST API client (works with Node.js >= 18 native fetch, no node_modules needed)
function normalizeGeminiContents(contents) {
  if (typeof contents === 'string') {
    return [{ role: 'user', parts: [{ text: contents }] }];
  }
  if (Array.isArray(contents)) {
    return contents.map((item) => {
      if (typeof item === 'string') return { role: 'user', parts: [{ text: item }] };
      return item;
    });
  }
  return [{ role: 'user', parts: [{ text: String(contents || '') }] }];
}

function getAiClient() {
  const FALLBACK_ALIAS_MAP = {
    'gemini-4-carbon': 'gemini-2.5-pro',
    'gemini-4-argon': 'gemini-2.5-pro',
    'gemini-4-neon': 'gemini-2.5-flash',
    'gemini-4-hydrogen': 'gemini-2.5-flash',
    'gemini-3.1-flash-lite': 'gemini-2.5-flash-lite',
  };

  async function callRest(modelName, contents, config, useThinking) {
    loadLocalEnvFiles();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY não definida. Configure na aba Configurações do Aegis ou em ~/.config/aegis/env.');
    }
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(modelName) + ':generateContent?key=' + encodeURIComponent(apiKey);
    const body = { contents: normalizeGeminiContents(contents) };
    if (config.systemInstruction) {
      body.systemInstruction = { parts: [{ text: String(config.systemInstruction) }] };
    }
    if (Array.isArray(config.tools) && config.tools.length > 0) {
      body.tools = config.tools;
    }
    if (useThinking && config.includeThoughts) {
      body.generationConfig = {
        ...(body.generationConfig || {}),
        thinkingConfig: { includeThoughts: true },
      };
    }
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'aegis-desktop-native/2.1.0' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data.error?.message || ('Gemini API HTTP ' + r.status));
      err.status = r.status;
      throw err;
    }
    const parts = data.candidates?.[0]?.content?.parts || [];
    const thoughts = parts.filter((p) => typeof p.text === 'string' && p.thought).map((p) => p.text).join('\\n').trim();
    const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
    const functionCalls = parts
      .filter((p) => p.functionCall)
      .map((p, idx) => ({
        id: p.functionCall.id || ('fc_' + Date.now() + '_' + idx),
        name: p.functionCall.name,
        args: p.functionCall.args || {},
      }));
    return {
      text,
      thoughts,
      resolvedModel: modelName,
      functionCalls,
      candidates: data.candidates || [],
      usageMetadata: data.usageMetadata || null,
    };
  }

  return {
    models: {
      async generateContent({ model, contents, config = {} }) {
        try {
          return await callRest(model, contents, config, Boolean(config.includeThoughts));
        } catch (err) {
          if (config.includeThoughts && (err.status === 400 || /thinking/i.test(err.message || ''))) {
            try {
              return await callRest(model, contents, config, false);
            } catch (innerErr) {
              err = innerErr;
            }
          }
          const aliasFallback = FALLBACK_ALIAS_MAP[model];
          if (aliasFallback && (err.status === 404 || /not found|unsupported/i.test(err.message || ''))) {
            try {
              return await callRest(aliasFallback, contents, config, Boolean(config.includeThoughts));
            } catch {
              return await callRest(aliasFallback, contents, config, false);
            }
          }
          throw err;
        }
      },
    },
  };
}

function appendJsonLine(file, entry) {
  fs.appendFileSync(file, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\\n', 'utf-8');
}

function readJsonLines(file, limit = 50) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\\n').slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function loadFacts() {
  try { return JSON.parse(fs.readFileSync(FACTS_FILE, 'utf-8')); } catch { return []; }
}

function saveFact(fact) {
  const facts = loadFacts();
  if (!facts.some((f) => f.content.toLowerCase() === fact.toLowerCase())) {
    facts.unshift({ id: Date.now(), content: fact, createdAt: new Date().toISOString() });
    fs.writeFileSync(FACTS_FILE, JSON.stringify(facts.slice(0, 200), null, 2), 'utf-8');
  }
}

function loadVault() {
  try {
    if (!fs.existsSync(VAULT_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf-8'));
    return raw.map((c) => ({ ...c }));
  } catch { return []; }
}

function saveVault(list) {
  fs.writeFileSync(VAULT_FILE, JSON.stringify(list, null, 2), { mode: 0o600 });
}

function loadCloudConnections() {
  try {
    if (!fs.existsSync(CLOUD_FILE)) return { google: null };
    const enc = JSON.parse(fs.readFileSync(CLOUD_FILE, 'utf-8'));
    const dec = decryptStr(enc.cipherText, enc.iv, enc.authTag);
    return JSON.parse(dec);
  } catch {
    return { google: null };
  }
}

function saveCloudConnections(data) {
  const enc = encryptStr(JSON.stringify(data));
  fs.writeFileSync(CLOUD_FILE, JSON.stringify(enc), { mode: 0o600 });
}

function loadGoogleSyncCache() {
  try {
    if (!fs.existsSync(GOOGLE_SYNC_CACHE_FILE)) {
      return { lastSyncAt: null, email: null, drive: [], gmail: [], calendar: [], tasks: [] };
    }
    return JSON.parse(fs.readFileSync(GOOGLE_SYNC_CACHE_FILE, 'utf-8'));
  } catch {
    return { lastSyncAt: null, email: null, drive: [], gmail: [], calendar: [], tasks: [] };
  }
}

function saveGoogleSyncCache(cache) {
  fs.writeFileSync(GOOGLE_SYNC_CACHE_FILE, JSON.stringify(cache, null, 2), { mode: 0o600 });
}

async function runFullGoogleWorkspaceSync(token, email) {
  const headers = { Authorization: 'Bearer ' + token };
  const nowIso = new Date().toISOString();
  const [driveR, gmailR, calR, tasksR] = await Promise.allSettled([
    fetch('https://www.googleapis.com/drive/v3/files?pageSize=30&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType,modifiedTime,size,webViewLink)&q=trashed%20%3D%20false', { headers }).then((r) => r.json()),
    fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=12', { headers }).then((r) => r.json()),
    fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=15&singleEvents=true&orderBy=startTime&timeMin=' + encodeURIComponent(nowIso), { headers }).then((r) => r.json()),
    fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?maxResults=20&showCompleted=false', { headers }).then((r) => r.json()),
  ]);

  const driveFiles = driveR.status === 'fulfilled' && Array.isArray(driveR.value?.files) ? driveR.value.files : [];
  const gmailRaw = gmailR.status === 'fulfilled' && Array.isArray(gmailR.value?.messages) ? gmailR.value.messages : [];
  const calEvents = calR.status === 'fulfilled' && Array.isArray(calR.value?.items) ? calR.value.items : [];
  const taskItems = tasksR.status === 'fulfilled' && Array.isArray(tasksR.value?.items) ? tasksR.value.items : [];

  // Hydrate top 6 Gmail subjects/snippets in parallel for local cache
  const gmailDetailed = await Promise.all(
    gmailRaw.slice(0, 6).map(async (m) => {
      try {
        const mr = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(m.id) + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date', { headers });
        const md = await mr.json();
        const hdrs = md.payload?.headers || [];
        const getH = (n) => hdrs.find((h) => String(h.name || '').toLowerCase() === n)?.value || '';
        return { id: m.id, subject: getH('subject') || '(Sem assunto)', from: getH('from'), date: getH('date'), snippet: md.snippet || '' };
      } catch {
        return { id: m.id, subject: '(Mensagem)', from: '', date: '', snippet: '' };
      }
    })
  );

  const cache = {
    lastSyncAt: new Date().toISOString(),
    email: email || 'Google User',
    syncDir: GOOGLE_SYNC_DIR,
    drive: driveFiles,
    gmail: gmailDetailed,
    calendar: calEvents.map((e) => ({ id: e.id, summary: e.summary || '(Evento)', start: e.start?.dateTime || e.start?.date || '', end: e.end?.dateTime || e.end?.date || '' })),
    tasks: taskItems.map((t) => ({ id: t.id, title: t.title || '(Tarefa)', due: t.due || null, status: t.status || 'needsAction' })),
  };
  saveGoogleSyncCache(cache);
  return cache;
}

function selectModel(prompt, preference = 'auto') {
  if (preference && preference !== 'auto') {
    return { model: preference, mode: 'manual', reason: 'Seleção manual (' + preference + ')', tier: 'manual' };
  }
  const lower = String(prompt || '').toLowerCase();
  const len = lower.length;
  const deepWords = ['arquitetura', 'auditoria', 'debug', 'depur', 'refator', 'segurança', 'root cause'];
  const advWords = ['analise profundamente', 'correlacione', 'código', 'script', 'automação', 'multi', 'integre', 'compare', 'relatório'];
  const medWords = ['email', 'e-mail', 'gmail', 'drive', 'site', 'navegue', 'acesse', 'login', 'logar', 'extraia', 'organize', 'downloads'];

  if (deepWords.some((k) => lower.includes(k)) && len > 80) {
    return { model: 'gemini-4-carbon', mode: 'auto', reason: 'Auditoria/raciocínio técnico profundo', tier: 'deep' };
  }
  if (advWords.some((k) => lower.includes(k)) || len > 130) {
    return { model: 'gemini-4-argon', mode: 'auto', reason: 'Tarefa complexa multi-etapas', tier: 'advanced' };
  }
  if (medWords.some((k) => lower.includes(k)) || len > 85) {
    return { model: 'gemini-4-hydrogen', mode: 'auto', reason: 'Operação intermediária (Web/Cloud/Arquivos)', tier: 'balanced' };
  }
  return { model: 'gemini-3.1-flash-lite', mode: 'auto', reason: 'Comando direto / leitura rápida (economia de tokens)', tier: 'lite' };
}

// Local Web Browser Cookie-Jar
const webCookies = [];
let lastWebSnapshot = null;

function buildCookieHeader(urlStr) {
  const host = new URL(urlStr).hostname.toLowerCase();
  return webCookies.filter((c) => host === c.domain || host.endsWith('.' + c.domain)).map((c) => c.name + '=' + c.value).join('; ');
}

function storeCookies(urlStr, headers) {
  const host = new URL(urlStr).hostname.toLowerCase();
  const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  for (const raw of list) {
    const parts = raw.split(';');
    const eq = parts[0].indexOf('=');
    if (eq <= 0) continue;
    const name = parts[0].slice(0, eq).trim();
    const value = parts[0].slice(eq + 1).trim();
    let domain = host;
    for (const a of parts.slice(1)) {
      const kv = a.trim().split('=');
      if (kv[0]?.toLowerCase() === 'domain' && kv[1]) domain = kv[1].trim().replace(/^\\./, '').toLowerCase();
    }
    const idx = webCookies.findIndex((c) => c.name === name && c.domain === domain);
    if (idx >= 0) webCookies[idx] = { name, value, domain };
    else webCookies.push({ name, value, domain });
  }
}

async function fetchWebRedirects(targetUrl, opts = {}, maxHops = 6) {
  let cur = /^https?:\\/\\//i.test(targetUrl) ? targetUrl.trim() : 'https://' + targetUrl.trim();
  let method = (opts.method || 'GET').toUpperCase();
  let body = opts.body;
  let extra = opts.headers || {};

  for (let i = 0; i <= maxHops; i++) {
    const ck = buildCookieHeader(cur);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      ...extra,
    };
    if (ck) headers.Cookie = ck;
    const r = await fetch(cur, { method, headers, body: method === 'GET' ? undefined : body, redirect: 'manual' });
    storeCookies(cur, r.headers);
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      cur = new URL(r.headers.get('location'), cur).toString();
      if (r.status === 301 || r.status === 302 || r.status === 303) {
        method = 'GET'; body = undefined; extra = {};
      }
      continue;
    }
    return { finalUrl: cur, status: r.status, html: await r.text(), contentType: r.headers.get('content-type') || '' };
  }
  throw new Error('Excesso de redirecionamentos HTTP.');
}

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\\d+);/g, (_, n) => String.fromCharCode(Number(n) || 32));
}

function getHtmlAttr(tag, attr) {
  const rx = new RegExp('\\\\b' + attr + '\\\\s*=\\\\s*(?:"([^"]*)"|\\'([^\\']*)\\'|([^\\\\s>]+))', 'i');
  const m = tag.match(rx);
  return decodeHtmlEntities((m && (m[1] ?? m[2] ?? m[3])) || '');
}

function stripTags(html) {
  return decodeHtmlEntities(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\\s+/g, ' ').trim();
}

function parseSnapshot(url, status, html, contentType) {
  if (contentType.includes('application/json') || html.trim().startsWith('{')) {
    lastWebSnapshot = { url, status, title: 'JSON (' + url + ')', textPreview: html.slice(0, 5000), links: [], forms: [], cookieCount: webCookies.length, timestamp: new Date().toISOString() };
    return lastWebSnapshot;
  }
  const cleanHtml = String(html || '')
    .replace(/<script\\b[^>]*>[\\s\\S]*?<\\/script>/gi, ' ')
    .replace(/<style\\b[^>]*>[\\s\\S]*?<\\/style>/gi, ' ')
    .replace(/<noscript\\b[^>]*>[\\s\\S]*?<\\/noscript>/gi, ' ')
    .replace(/<svg\\b[^>]*>[\\s\\S]*?<\\/svg>/gi, ' ');

  const titleMatch = cleanHtml.match(/<title\\b[^>]*>([\\s\\S]*?)<\\/title>/i);
  const h1Match = cleanHtml.match(/<h1\\b[^>]*>([\\s\\S]*?)<\\/h1>/i);
  const title = stripTags(titleMatch?.[1] || '') || stripTags(h1Match?.[1] || '') || url;

  const links = [];
  const aRx = /<a\\b([^>]*)>([\\s\\S]*?)<\\/a>/gi;
  let am;
  while ((am = aRx.exec(cleanHtml)) !== null && links.length < 25) {
    const h = getHtmlAttr(am[1], 'href').trim();
    if (!h || h.startsWith('#') || h.startsWith('javascript:')) continue;
    try {
      const txt = stripTags(am[2]) || h;
      links.push({ text: txt.slice(0, 90), href: new URL(h, url).toString() });
    } catch {}
  }

  const forms = [];
  const formRx = /<form\\b([^>]*)>([\\s\\S]*?)<\\/form>/gi;
  let fm;
  while ((fm = formRx.exec(cleanHtml)) !== null && forms.length < 6) {
    let action = url;
    try { action = new URL(getHtmlAttr(fm[1], 'action') || url, url).toString(); } catch {}
    const method = (getHtmlAttr(fm[1], 'method') || 'GET').toUpperCase();
    const fields = [];
    const fieldRx = /<(input|select|textarea)\\b([^>]*)>/gi;
    let fld;
    while ((fld = fieldRx.exec(fm[2])) !== null && fields.length < 20) {
      const tag = fld[1].toLowerCase();
      const attrs = fld[2];
      const name = getHtmlAttr(attrs, 'name') || getHtmlAttr(attrs, 'id') || '';
      const type = (getHtmlAttr(attrs, 'type') || tag || 'text').toLowerCase();
      if (!name && type !== 'submit') continue;
      fields.push({ name, type, value: type === 'hidden' ? getHtmlAttr(attrs, 'value') : undefined });
    }
    forms.push({ index: forms.length, action, method, fields });
  }

  const bodyMatch = cleanHtml.match(/<body\\b[^>]*>([\\s\\S]*?)<\\/body>/i);
  const rawBody = bodyMatch ? bodyMatch[1] : cleanHtml;
  const textPreview = decodeHtmlEntities(rawBody.replace(/<(br|p|div|li|tr|h[1-6])\\b[^>]*>/gi, '\\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \\t]+/g, ' ')
    .replace(/\\n\\s*\\n+/g, '\\n')
    .trim()
    .slice(0, 5500);

  lastWebSnapshot = { url, status, title, textPreview, links, forms, cookieCount: webCookies.length, timestamp: new Date().toISOString() };
  return lastWebSnapshot;
}

async function webNavigate(url) {
  const res = await fetchWebRedirects(url);
  return parseSnapshot(res.finalUrl, res.status, res.html, res.contentType);
}

async function webLogin({ siteOrId, loginUrl, username, password }) {
  let targetUrl = loginUrl || '';
  let user = username || '';
  let pass = password || '';
  if (siteOrId) {
    const q = String(siteOrId).toLowerCase();
    const found = loadVault().find((c) => String(c.id) === String(siteOrId) || c.siteName.toLowerCase().includes(q) || c.loginUrl.toLowerCase().includes(q));
    if (!found) throw new Error('Credencial não encontrada no cofre local.');
    targetUrl = targetUrl || found.loginUrl;
    user = found.username;
    pass = decryptStr(found.encryptedPassword, found.iv, found.authTag);
  }
  const page = await webNavigate(targetUrl);
  const form = page.forms.find((f) => f.fields.some((x) => x.type === 'password')) || page.forms[0];
  if (!form) throw new Error('Formulário de login não encontrado em ' + page.url);
  const p = new URLSearchParams();
  let uSet = false, pSet = false;
  for (const f of form.fields) {
    if (!f.name) continue;
    const ln = f.name.toLowerCase();
    if (f.type === 'hidden') p.set(f.name, f.value || '');
    else if (f.type === 'password' && !pSet) { p.set(f.name, pass); pSet = true; }
    else if (!uSet && (f.type === 'email' || f.type === 'text' || ln.includes('user') || ln.includes('email') || ln.includes('login'))) {
      p.set(f.name, user); uSet = true;
    }
  }
  if (!uSet) p.set('username', user);
  if (!pSet) p.set('password', pass);
  const sr = await fetchWebRedirects(form.action, {
    method: form.method === 'GET' ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: page.url },
    body: p.toString(),
  });
  return parseSnapshot(sr.finalUrl, sr.status, sr.html, sr.contentType);
}

const tools = [
  {
    functionDeclarations: [
      {
        name: 'local_exec',
        description: 'Executa comando nativo do sistema (Bash no Linux ou PowerShell no Windows) com acesso completo ao computador. Comandos não destrutivos executam livremente; apenas comandos destrutivos pedem confirmação. Sempre analise stdout/stderr retornado e explique o resultado real ao usuário.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            command: { type: Type.STRING, description: 'Comando Bash (Linux) ou PowerShell (Windows)' },
            cwd: { type: Type.STRING, description: 'Diretório de trabalho opcional (padrão: pasta do usuário)' },
          },
          required: ['command'],
        },
      },
      {
        name: 'local_write_file',
        description: 'Cria ou atualiza qualquer arquivo no sistema local (Linux ou Windows) livremente.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            path: { type: Type.STRING, description: 'Caminho absoluto ou relativo ao HOME' },
            content: { type: Type.STRING },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'local_open_app',
        description: 'Abre um aplicativo, pasta ou arquivo diretamente no sistema operacional (xdg-open no Linux ou Start-Process no Windows).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            target: { type: Type.STRING, description: 'Nome do aplicativo, caminho de arquivo ou URL para abrir no sistema' },
          },
          required: ['target'],
        },
      },
      {
        name: 'draw_holographic_screen',
        description: 'Desenha uma tela holográfica flutuante na HUD local para apresentar arquivos, imagens, páginas web, dashboards ou artefatos HTML/SVG sem precisar automatizar janelas.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            kind: { type: Type.STRING, description: 'file_viewer, web_canvas, interactive_dashboard ou html_artifact' },
            title: { type: Type.STRING },
            content: { type: Type.STRING },
            htmlCode: { type: Type.STRING },
          },
          required: ['kind', 'title'],
        },
      },
      {
        name: 'local_search',
        description: 'Busca arquivos ou pastas em todo o sistema local (Linux ou Windows).',
        parameters: {
          type: Type.OBJECT,
          properties: { directory: { type: Type.STRING }, pattern: { type: Type.STRING } },
          required: ['directory', 'pattern'],
        },
      },
      {
        name: 'memory_remember',
        description: 'Salva fato ou preferência na memória local persistente.',
        parameters: {
          type: Type.OBJECT,
          properties: { fact: { type: Type.STRING } },
          required: ['fact'],
        },
      },
      {
        name: 'web_navigate',
        description: 'Acessa uma URL da web e extrai título, texto, links e formulários.',
        parameters: {
          type: Type.OBJECT,
          properties: { url: { type: Type.STRING } },
          required: ['url'],
        },
      },
      {
        name: 'web_login',
        description: 'Loga em um site usando credencial do Cofre local (exige confirmação).',
        parameters: {
          type: Type.OBJECT,
          properties: { siteOrId: { type: Type.STRING }, loginUrl: { type: Type.STRING }, username: { type: Type.STRING }, password: { type: Type.STRING } },
        },
      },
      {
        name: 'google_list_recent',
        description: 'Consulta Google Drive, Gmail, Google Calendar ou Google Tasks sincronizados localmente (ou todos com service="all").',
        parameters: {
          type: Type.OBJECT,
          properties: {
            service: { type: Type.STRING, description: 'drive, gmail, calendar, tasks ou all' },
            folderId: { type: Type.STRING, description: 'ID opcional da pasta do Drive' },
          },
          required: ['service'],
        },
      },
      {
        name: 'google_drive_download_local',
        description: 'Baixa um arquivo do Google Drive (ou exporta Google Docs/Sheets) diretamente para a pasta local ~/AegisGoogleSync.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            fileId: { type: Type.STRING, description: 'ID do arquivo no Google Drive' },
            targetDir: { type: Type.STRING, description: 'Pasta local opcional (padrao ~/AegisGoogleSync)' },
          },
          required: ['fileId'],
        },
      },
      {
        name: 'google_drive_upload_local',
        description: 'Envia um arquivo da maquina local para o Google Drive (exige confirmacao explicita do operador).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            localPath: { type: Type.STRING, description: 'Caminho local do arquivo a enviar' },
            fileName: { type: Type.STRING, description: 'Nome opcional no Google Drive' },
          },
          required: ['localPath'],
        },
      },
    ],
  },
];

const IS_WIN = process.platform === 'win32';

const DESTRUCTIVE_RX = [
  /\\brm\\s+(-[a-zA-Z]*[rf][a-zA-Z]*|--recursive|--force)/i,
  /\\brm\\s+/i,
  /\\brmdir\\b|\\bshred\\b|\\bwipefs\\b|\\bmkfs\\b|\\bdd\\s+if=/i,
  /\\bfdisk\\b|\\bparted\\b|\\bdiskpart\\b|\\bformat\\s+[a-z]:/i,
  /\\bshutdown\\b|\\breboot\\b|\\bpoweroff\\b|\\bhalt\\b|\\bstop-computer\\b|\\brestart-computer\\b/i,
  /\\bkill\\s+-9\\b|\\bkillall\\b|\\btaskkill\\s+\\/f/i,
  /\\breg\\s+delete\\b|\\bremove-item\\b.*(-recurse|-force)/i,
  /\\bdel\\s+\\/[sfq]/i,
  /\\bchmod\\s+-R\\s+000\\b|\\bsystemctl\\s+(stop|disable|mask)\\b/i,
];

function isMutating(cmd) {
  const trimmed = String(cmd || '').trim();
  if (!trimmed) return false;
  return DESTRUCTIVE_RX.some((rx) => rx.test(trimmed));
}

async function execNative(cmd, cwd = HOME) {
  const opts = { cwd: cwd || HOME, timeout: 30000, maxBuffer: 4 * 1024 * 1024 };
  if (IS_WIN) {
    return execAsync('powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ' + JSON.stringify(cmd), opts);
  }
  return execAsync(cmd, { ...opts, shell: '/bin/bash' });
}

if (fs.existsSync(WATCH_DIR)) {
  fs.watch(WATCH_DIR, (eventType, filename) => {
    if (filename && eventType === 'rename') {
      appendJsonLine(MEMORY_FILE, { role: 'proactive', event: 'fs_watch', directory: WATCH_DIR, filename });
    }
  });
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || '{}');
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Aegis-Local-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const reqUrl = new URL(req.url || '/', 'http://127.0.0.1:' + PORT);
  const pathname = reqUrl.pathname;

  if (pathname === '/' && req.method === 'GET') {
    const uiCandidates = [
      path.join(SCRIPT_DIR, 'ui.html'),
      path.join(DATA_DIR, 'ui.html'),
      '/opt/aegis/ui.html',
    ];
    for (const uiPath of uiCandidates) {
      if (fs.existsSync(uiPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(uiPath, 'utf-8'));
      }
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<!doctype html><html><body style="background:#070B12;color:#F8FAFC;font-family:sans-serif;padding:32px"><h2>Aegis Desktop Daemon v2.1.0 Online</h2><p>Porta 127.0.0.1:' + PORT + ' ativa. Arquivo ui.html não localizado em ' + SCRIPT_DIR + '.</p></body></html>');
  }

  if (pathname === '/google/oauth/receive' && req.method === 'GET') {
    const bridgeHtml = [
      '<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8" /><title>Aegis Google Sync</title>',
      '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#05070B;color:#F1F5F9;font-family:system-ui,sans-serif;}',
      '.box{max-width:440px;padding:28px;border-radius:18px;border:1px solid rgba(245,158,11,0.35);background:#0C111C;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,0.8);}',
      'h2{margin:0 0 8px;color:#FBBF24;font-size:18px;}p{margin:0 0 14px;color:#94A3B8;font-size:13px;line-height:1.5;}',
      '.ok{color:#34D399;font-weight:600;}.err{color:#FB7185;}</style></head><body>',
      '<div class="box"><h2>Sincronizando Conta Google</h2><p id="st">Recebendo credencial OAuth no Aegis Local...</p></div>',
      '<script>',
      '(async function(){',
      '  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));',
      '  const qs = new URLSearchParams(location.search);',
      '  const token = hash.get("access_token") || qs.get("access_token") || "";',
      '  let email = hash.get("email") || qs.get("email") || "";',
      '  const st = document.getElementById("st");',
      '  if (!token) { st.className = "err"; st.textContent = "Token Google não recebido. Feche esta aba e tente novamente."; return; }',
      '  try {',
      '    if (!email) {',
      '      const uRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: "Bearer " + token } });',
      '      if (uRes.ok) { const u = await uRes.json(); email = u.email || u.name || "Google User"; }',
      '    }',
      '    const localTok = localStorage.getItem("aegis_local_token") || "";',
      '    const headers = { "Content-Type": "application/json" };',
      '    if (localTok) headers["X-Aegis-Local-Token"] = localTok;',
      '    const r = await fetch("/google/oauth/complete", { method: "POST", headers, body: JSON.stringify({ token, email: email || "Google User" }) });',
      '    const d = await r.json();',
      '    if (!r.ok) throw new Error(d.error || "Falha ao gravar token");',
      '    st.className = "ok";',
      '    st.textContent = "Google conectado (" + (d.email || email || "Conta Google") + ")! Retornando para a HUD 3D...";',
      '    if (window.opener && !window.opener.closed) { try { window.opener.postMessage({ type: "aegis_google_connected", email: d.email || email }, "*"); } catch {} setTimeout(() => window.close(), 1100); }',
      '    else { setTimeout(() => { location.href = "/"; }, 1100); }',
      '  } catch (e) { st.className = "err"; st.textContent = "Erro: " + (e.message || e); }',
      '})();',
      '</script></body></html>',
    ].join('');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(bridgeHtml);
  }

  if (pathname === '/google/oauth/complete' && req.method === 'POST') {
    const body = await readBody(req);
    const token = String(body.token || '').trim();
    const email = String(body.email || 'Google User').trim();
    if (!token) return sendJson(res, 400, { error: 'Token OAuth ausente.' });
    const cloud = loadCloudConnections();
    cloud.google = { token, email, updatedAt: new Date().toISOString() };
    saveCloudConnections(cloud);
    try { startCloudRelay(); triggerLanDiscoveryProbe(); } catch {}
    let snap = null;
    try {
      snap = await runFullGoogleWorkspaceSync(token, email);
    } catch {}
    return sendJson(res, 200, {
      ok: true,
      email,
      synced: Boolean(snap),
      counts: snap ? { drive: snap.drive.length, gmail: snap.gmail.length, calendar: snap.calendar.length, tasks: snap.tasks.length } : null,
    });
  }

  if (pathname === '/health') {
    const cloud = loadCloudConnections();
    const gCache = loadGoogleSyncCache();
    const settings = loadLocalSettings();
    return sendJson(res, 200, {
      status: 'ok',
      version: '2.1.0',
      host: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      watchDir: WATCH_DIR,
      syncDir: GOOGLE_SYNC_DIR,
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
      googleConnected: Boolean(cloud.google?.token),
      googleEmail: cloud.google?.email || null,
      lastGoogleSyncAt: gCache.lastSyncAt || null,
      modelPreference: settings.modelPreference || 'auto',
      activeJobsCount: Array.from(backgroundJobs.values()).filter((j) => j.status === 'running').length,
    });
  }

  // Local Operator Auth Endpoints
  if (pathname === '/auth/status' && req.method === 'GET') {
    const u = loadAuthUser();
    return sendJson(res, 200, {
      needsSetup: !u,
      authenticated: isAuthed(req),
      username: u?.username || null,
    });
  }

  if (pathname === '/auth/setup' && req.method === 'POST') {
    const existing = loadAuthUser();
    if (existing) return sendJson(res, 409, { error: 'Operador local já configurado.' });
    const { username, password } = await readBody(req);
    if (!username?.trim() || !password || password.length < 4) {
      return sendJson(res, 400, { error: 'Usuário e senha (mín. 4 caracteres) são obrigatórios.' });
    }
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ username: username.trim(), passwordHash: hashPassword(password) }), { mode: 0o600 });
    const token = crypto.randomBytes(24).toString('hex');
    activeSessions.set(token, Date.now() + 7 * 86400000);
    return sendJson(res, 200, { token, username: username.trim() });
  }

  if (pathname === '/auth/login' && req.method === 'POST') {
    const u = loadAuthUser();
    if (!u) return sendJson(res, 400, { error: 'Configure o operador primeiro.' });
    const { username, password } = await readBody(req);
    if (String(username || '').trim().toLowerCase() !== u.username.toLowerCase() || !verifyPassword(String(password || ''), u.passwordHash)) {
      return sendJson(res, 401, { error: 'Usuário ou senha inválidos.' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    activeSessions.set(token, Date.now() + 7 * 86400000);
    return sendJson(res, 200, { token, username: u.username });
  }

  if (pathname === '/auth/logout' && req.method === 'POST') {
    const tok = req.headers['x-aegis-local-token'];
    if (tok) activeSessions.delete(tok);
    return sendJson(res, 200, { ok: true });
  }

  // Protected routes below
  if (!isAuthed(req)) {
    return sendJson(res, 401, { error: 'Autenticação local necessária.' });
  }

  if (pathname === '/status' && req.method === 'GET') {
    let diskUsage = 'N/A', diskPct = 0;
    try {
      if (IS_WIN) {
        const { stdout } = await execNative("$d = Get-PSDrive C; $used = [math]::Round($d.Used/1GB,1); $free = [math]::Round($d.Free/1GB,1); $tot = [math]::Round(($d.Used+$d.Free)/1GB,1); $pct = if($tot -gt 0){[math]::Round(($used/$tot)*100)}else{0}; Write-Output ('C: ' + $used + 'GB/' + $tot + 'GB (' + $pct + '%) Livre: ' + $free + 'GB')");
        diskUsage = stdout.trim();
      } else {
        const { stdout } = await execAsync('df -h ~ | tail -n 1', { timeout: 4000 });
        diskUsage = stdout.trim();
      }
      const m = diskUsage.match(/(\\d+)%/);
      if (m) diskPct = Number(m[1]);
    } catch {}
    const cpus = os.cpus();
    const totalMemMb = Math.round(os.totalmem() / 1048576);
    const freeMemMb = Math.round(os.freemem() / 1048576);
    const ramUsagePercent = totalMemMb > 0 ? Math.min(100, Math.max(0, Math.round(((totalMemMb - freeMemMb) / totalMemMb) * 100))) : 0;
    const load1 = os.loadavg()[0] || 0;
    const cpuUsagePercent = Math.min(100, Math.max(1, Math.round((load1 / Math.max(1, cpus.length)) * 100)));
    const cloud = loadCloudConnections();
    const gCache = loadGoogleSyncCache();
    const settings = loadLocalSettings();
    const activeJobsCount = Array.from(backgroundJobs.values()).filter((j) => j.status === 'running').length;
    return sendJson(res, 200, {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      uptimeSeconds: Math.floor(os.uptime()),
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model || 'Linux CPU',
      cpuUsagePercent,
      totalMemMb,
      freeMemMb,
      ramUsagePercent,
      loadAvg: os.loadavg().map((n) => Number(n.toFixed(2))),
      homeDir: HOME,
      diskUsage,
      diskPct,
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
      googleConnected: Boolean(cloud.google?.token),
      googleEmail: cloud.google?.email || gCache.email || null,
      lastGoogleSyncAt: gCache.lastSyncAt || null,
      googleCounts: {
        drive: gCache.drive?.length || 0,
        gmail: gCache.gmail?.length || 0,
        calendar: gCache.calendar?.length || 0,
        tasks: gCache.tasks?.length || 0,
      },
      modelPreference: settings.modelPreference || 'auto',
      cloudOrigin: settings.cloudOrigin || process.env.AEGIS_CLOUD_URL || '',
      googleClientId: settings.googleClientId || '',
      activeJobsCount,
    });
  }

  if (pathname === '/settings' && req.method === 'GET') {
    const s = loadLocalSettings();
    return sendJson(res, 200, {
      modelPreference: s.modelPreference || 'auto',
      cloudOrigin: s.cloudOrigin || process.env.AEGIS_CLOUD_URL || '',
      googleClientId: s.googleClientId || '',
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    });
  }

  if (pathname === '/settings' && req.method === 'POST') {
    const body = await readBody(req);
    const patch = {};
    if (typeof body.modelPreference === 'string') patch.modelPreference = body.modelPreference;
    if (typeof body.cloudOrigin === 'string') patch.cloudOrigin = body.cloudOrigin.trim().replace(/\\/+$/, '');
    if (typeof body.googleClientId === 'string') patch.googleClientId = body.googleClientId.trim();
    if (typeof body.geminiApiKey === 'string' && body.geminiApiKey.trim()) {
      saveLocalApiKey(body.geminiApiKey.trim());
    }
    const saved = saveLocalSettings(patch);
    return sendJson(res, 200, {
      ok: true,
      modelPreference: saved.modelPreference || 'auto',
      cloudOrigin: saved.cloudOrigin || '',
      googleClientId: saved.googleClientId || '',
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    });
  }

  if (pathname === '/jobs' && req.method === 'GET') {
    const list = BACKGROUND_JOB_ORDER.map((id) => backgroundJobs.get(id)).filter(Boolean);
    return sendJson(res, 200, { jobs: list });
  }

  if (pathname.startsWith('/jobs/') && req.method === 'GET') {
    const jid = decodeURIComponent(pathname.slice('/jobs/'.length));
    const job = backgroundJobs.get(jid);
    if (!job) return sendJson(res, 404, { error: 'Tarefa não encontrada.' });
    return sendJson(res, 200, { job });
  }

  if (pathname.startsWith('/jobs/') && req.method === 'DELETE') {
    const jid = decodeURIComponent(pathname.slice('/jobs/'.length));
    backgroundJobs.delete(jid);
    const idx = BACKGROUND_JOB_ORDER.indexOf(jid);
    if (idx >= 0) BACKGROUND_JOB_ORDER.splice(idx, 1);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/usage' && req.method === 'GET') {
    const logs = readJsonLines(USAGE_FILE, 200);
    const byModelMap = {};
    let promptTokens = 0, outputTokens = 0, thoughtsTokens = 0, totalTokens = 0, latencySum = 0;
    let curationsSkipped = 0, escalationsCount = 0, fallbacksCount = 0;
    for (const l of logs) {
      promptTokens += l.promptTokens || 0;
      outputTokens += l.outputTokens || 0;
      thoughtsTokens += l.thoughtsTokens || 0;
      totalTokens += l.totalTokens || 0;
      latencySum += l.latencyMs || 0;
      if (l.curationSkipped) curationsSkipped += 1;
      if (l.escalated) escalationsCount += 1;
      if (l.fallbackUsed) fallbacksCount += 1;
      if (!byModelMap[l.model]) byModelMap[l.model] = { model: l.model, requests: 0, totalTokens: 0, thoughtsTokens: 0 };
      byModelMap[l.model].requests += 1;
      byModelMap[l.model].totalTokens += l.totalTokens || 0;
      byModelMap[l.model].thoughtsTokens += l.thoughtsTokens || 0;
    }
    const settings = loadLocalSettings();
    return sendJson(res, 200, {
      modelPreference: settings.modelPreference || 'auto',
      totals: {
        requests: logs.length,
        promptTokens,
        outputTokens,
        thoughtsTokens,
        totalTokens,
        avgLatencyMs: logs.length ? Math.round(latencySum / logs.length) : 0,
        curationsSkipped,
        escalationsCount,
        fallbacksCount,
      },
      byModel: Object.values(byModelMap),
      recent: logs.slice(-25).reverse(),
    });
  }

  if (pathname === '/connections' && req.method === 'GET') {
    const cloud = loadCloudConnections();
    const gCache = loadGoogleSyncCache();
    return sendJson(res, 200, {
      google: cloud.google
        ? {
            connected: true,
            email: cloud.google.email,
            lastSyncAt: gCache.lastSyncAt,
            syncDir: GOOGLE_SYNC_DIR,
            counts: {
              drive: gCache.drive?.length || 0,
              gmail: gCache.gmail?.length || 0,
              calendar: gCache.calendar?.length || 0,
              tasks: gCache.tasks?.length || 0,
            },
          }
        : { connected: false, email: null, lastSyncAt: gCache.lastSyncAt, syncDir: GOOGLE_SYNC_DIR },
    });
  }

  if (pathname === '/connections' && req.method === 'POST') {
    const body = await readBody(req);
    const cloud = loadCloudConnections();
    if (body.provider === 'google') {
      cloud.google = body.token ? { token: body.token, email: body.email || 'Google User', updatedAt: new Date().toISOString() } : null;
    }
    saveCloudConnections(cloud);
    let syncSnapshot = null;
    if (body.provider === 'google' && body.token && body.syncNow !== false) {
      try {
        syncSnapshot = await runFullGoogleWorkspaceSync(body.token, body.email || 'Google User');
      } catch {}
    }
    return sendJson(res, 200, {
      ok: true,
      synced: Boolean(syncSnapshot),
      counts: syncSnapshot
        ? {
            drive: syncSnapshot.drive.length,
            gmail: syncSnapshot.gmail.length,
            calendar: syncSnapshot.calendar.length,
            tasks: syncSnapshot.tasks.length,
          }
        : null,
      lastSyncAt: syncSnapshot?.lastSyncAt || null,
    });
  }

  if (pathname === '/google/sync/status' && req.method === 'GET') {
    const cloud = loadCloudConnections();
    const gCache = loadGoogleSyncCache();
    return sendJson(res, 200, {
      connected: Boolean(cloud.google?.token),
      email: cloud.google?.email || gCache.email || null,
      lastSyncAt: gCache.lastSyncAt,
      syncDir: GOOGLE_SYNC_DIR,
      counts: {
        drive: gCache.drive?.length || 0,
        gmail: gCache.gmail?.length || 0,
        calendar: gCache.calendar?.length || 0,
        tasks: gCache.tasks?.length || 0,
      },
      snapshot: gCache,
    });
  }

  if (pathname === '/google/sync' && req.method === 'POST') {
    const body = await readBody(req);
    const cloud = loadCloudConnections();
    const authHeader = req.headers.authorization || '';
    const bearerTok = /^Bearer\\s+(.+)$/i.test(authHeader) ? authHeader.replace(/^Bearer\\s+/i, '').trim() : '';
    const token = body.token || bearerTok || cloud.google?.token || '';
    const email = body.email || cloud.google?.email || 'Google User';
    if (!token) return sendJson(res, 401, { error: 'Token Google ausente. Conecte sua conta Google primeiro.' });
    cloud.google = { token, email, updatedAt: new Date().toISOString() };
    saveCloudConnections(cloud);
    try {
      const snap = await runFullGoogleWorkspaceSync(token, email);
      return sendJson(res, 200, {
        ok: true,
        email,
        lastSyncAt: snap.lastSyncAt,
        syncDir: GOOGLE_SYNC_DIR,
        counts: {
          drive: snap.drive.length,
          gmail: snap.gmail.length,
          calendar: snap.calendar.length,
          tasks: snap.tasks.length,
        },
        snapshot: snap,
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message || 'Falha ao sincronizar com Google Workspace.' });
    }
  }

  if (pathname === '/google/sync/download' && req.method === 'POST') {
    const cloud = loadCloudConnections();
    if (!cloud.google?.token) return sendJson(res, 401, { error: 'Google não sincronizado.' });
    const { fileId, targetDir } = await readBody(req);
    if (!fileId) return sendJson(res, 400, { error: 'fileId obrigatório.' });
    const metaR = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?fields=id,name,mimeType', {
      headers: { Authorization: 'Bearer ' + cloud.google.token },
    });
    const meta = await metaR.json();
    if (!metaR.ok) return sendJson(res, metaR.status, { error: meta.error?.message || 'Erro ao consultar arquivo.' });
    const mime = meta.mimeType || '';
    let dlUrl = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media';
    let safeName = String(meta.name || fileId).replace(/[\\\\/:*?"<>|]/g, '_');
    if (mime === 'application/vnd.google-apps.document') {
      dlUrl = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '/export?mimeType=text/plain';
      if (!safeName.endsWith('.txt')) safeName += '.txt';
    } else if (mime === 'application/vnd.google-apps.spreadsheet') {
      dlUrl = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '/export?mimeType=text/csv';
      if (!safeName.endsWith('.csv')) safeName += '.csv';
    }
    const dlR = await fetch(dlUrl, { headers: { Authorization: 'Bearer ' + cloud.google.token } });
    if (!dlR.ok) return sendJson(res, dlR.status, { error: 'Falha ao baixar arquivo do Drive.' });
    const buf = Buffer.from(await dlR.arrayBuffer());
    const destDir = targetDir ? path.resolve(HOME, String(targetDir).replace(/^~/, HOME)) : GOOGLE_SYNC_DIR;
    fs.mkdirSync(destDir, { recursive: true });
    const savedPath = path.join(destDir, safeName);
    fs.writeFileSync(savedPath, buf);
    return sendJson(res, 200, { ok: true, savedPath, bytes: buf.length, name: safeName });
  }

  if (pathname === '/google/sync/upload' && req.method === 'POST') {
    const cloud = loadCloudConnections();
    if (!cloud.google?.token) return sendJson(res, 401, { error: 'Google não sincronizado.' });
    const { localPath, fileName, confirmed } = await readBody(req);
    if (!localPath) return sendJson(res, 400, { error: 'localPath obrigatório.' });
    const resolved = path.resolve(HOME, String(localPath).replace(/^~/, HOME));
    if (!fs.existsSync(resolved)) return sendJson(res, 404, { error: 'Arquivo local não encontrado.' });
    if (!confirmed) {
      return sendJson(res, 200, {
        requiresConfirmation: true,
        localPath: resolved,
        fileName: fileName || path.basename(resolved),
        message: 'Confirmar envio de "' + path.basename(resolved) + '" para o Google Drive?',
      });
    }
    const fileBuf = fs.readFileSync(resolved);
    const uploadName = fileName || path.basename(resolved);
    const boundary = 'aegis_sync_' + crypto.randomBytes(8).toString('hex');
    const metaPart = Buffer.from(
      '--' + boundary + '\\r\\nContent-Type: application/json; charset=UTF-8\\r\\n\\r\\n' +
      JSON.stringify({ name: uploadName }) + '\\r\\n--' + boundary + '\\r\\nContent-Type: application/octet-stream\\r\\n\\r\\n'
    );
    const endPart = Buffer.from('\\r\\n--' + boundary + '--');
    const bodyBuf = Buffer.concat([metaPart, fileBuf, endPart]);
    const upR = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cloud.google.token, 'Content-Type': 'multipart/related; boundary=' + boundary },
      body: bodyBuf,
    });
    const upD = await upR.json();
    if (!upR.ok) return sendJson(res, upR.status, { error: upD.error?.message || 'Erro no upload ao Drive.' });
    return sendJson(res, 200, { ok: true, file: upD });
  }

  if (pathname === '/sync/memory' && req.method === 'POST') {
    const { facts = [] } = await readBody(req);
    let added = 0;
    for (const f of Array.isArray(facts) ? facts : []) {
      const txt = typeof f === 'string' ? f : f?.content;
      if (txt && String(txt).trim()) {
        const before = loadFacts().length;
        saveFact(String(txt).trim());
        if (loadFacts().length > before) added++;
      }
    }
    return sendJson(res, 200, { ok: true, added, totalLocalFacts: loadFacts().length });
  }

  if (pathname === '/google/drive/folder' && req.method === 'GET') {
    const cloud = loadCloudConnections();
    if (!cloud.google?.token) return sendJson(res, 401, { error: 'Google não sincronizado.' });
    const folderId = reqUrl.searchParams.get('folderId') || 'root';
    const qParam = reqUrl.searchParams.get('q') || '';
    const qStr = qParam.trim()
      ? "trashed = false and name contains '" + qParam.trim().replace(/'/g, "\\\\'") + "'"
      : "trashed = false and '" + folderId.replace(/'/g, "\\\\'") + "' in parents";
    const qs = new URLSearchParams({
      pageSize: '60',
      orderBy: 'folder,name',
      fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
      q: qStr,
    });
    const gr = await fetch('https://www.googleapis.com/drive/v3/files?' + qs.toString(), {
      headers: { Authorization: 'Bearer ' + cloud.google.token },
    });
    const gd = await gr.json();
    return sendJson(res, gr.status, { files: gd.files || [], error: gd.error?.message });
  }

  if (pathname === '/google/drive/file' && req.method === 'GET') {
    const cloud = loadCloudConnections();
    if (!cloud.google?.token) return sendJson(res, 401, { error: 'Google não sincronizado.' });
    const fileId = reqUrl.searchParams.get('id') || '';
    if (!fileId) return sendJson(res, 400, { error: 'ID ausente.' });
    const metaR = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?fields=id,name,mimeType,modifiedTime,size,webViewLink', {
      headers: { Authorization: 'Bearer ' + cloud.google.token },
    });
    const meta = await metaR.json();
    if (!metaR.ok) return sendJson(res, metaR.status, { error: meta.error?.message || 'Erro ao abrir item.' });
    const mime = meta.mimeType || '';
    let kind = 'binary';
    let editable = false;
    let hasMediaPreview = false;
    let defaultExportMime = '';
    let textContent = '';
    if (mime === 'application/vnd.google-apps.document') {
      kind = 'doc'; editable = true; hasMediaPreview = true; defaultExportMime = 'application/pdf';
      const dr = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '/export?mimeType=text/plain', {
        headers: { Authorization: 'Bearer ' + cloud.google.token },
      });
      textContent = dr.ok ? await dr.text() : '';
    } else if (mime === 'application/vnd.google-apps.spreadsheet') {
      kind = 'sheet'; hasMediaPreview = true; defaultExportMime = 'text/csv';
      const dr = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '/export?mimeType=text/csv', {
        headers: { Authorization: 'Bearer ' + cloud.google.token },
      });
      textContent = dr.ok ? await dr.text() : '';
    } else if (mime === 'application/vnd.google-apps.presentation') {
      kind = 'slides'; hasMediaPreview = true; defaultExportMime = 'application/pdf';
      const dr = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '/export?mimeType=text/plain', {
        headers: { Authorization: 'Bearer ' + cloud.google.token },
      });
      textContent = dr.ok ? await dr.text() : '';
    } else if (mime === 'application/vnd.google-apps.drawing') {
      kind = 'image'; hasMediaPreview = true; defaultExportMime = 'image/png';
    } else if (mime === 'application/pdf' || /\\.pdf$/i.test(meta.name || '')) {
      kind = 'pdf'; hasMediaPreview = true;
    } else if (mime.startsWith('image/')) {
      kind = 'image'; hasMediaPreview = true;
    } else if (mime.startsWith('audio/')) {
      kind = 'audio'; hasMediaPreview = true;
    } else if (mime.startsWith('video/')) {
      kind = 'video'; hasMediaPreview = true;
    } else if (mime.startsWith('text/') || mime === 'application/json' || /\\.(txt|md|json|csv|tsv|ts|js|py|sh|yaml|yml|html|css|sql|xml|log|ini|conf)$/i.test(meta.name || '')) {
      kind = 'text'; editable = true;
      const mr = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media', {
        headers: { Authorization: 'Bearer ' + cloud.google.token },
      });
      textContent = mr.ok ? (await mr.text()).slice(0, 180000) : '';
    }
    return sendJson(res, 200, { file: { ...meta, kind, editable, hasMediaPreview, defaultExportMime, textContent } });
  }

  if (pathname === '/google/drive/media' && req.method === 'GET') {
    const cloud = loadCloudConnections();
    if (!cloud.google?.token) return sendJson(res, 401, { error: 'Google não sincronizado.' });
    const fileId = reqUrl.searchParams.get('id') || '';
    const exportMime = reqUrl.searchParams.get('exportMime') || '';
    if (!fileId) return sendJson(res, 400, { error: 'ID ausente.' });
    const gUrl = exportMime
      ? 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '/export?mimeType=' + encodeURIComponent(exportMime)
      : 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media';
    const mr = await fetch(gUrl, { headers: { Authorization: 'Bearer ' + cloud.google.token } });
    if (!mr.ok) return sendJson(res, mr.status, { error: 'Falha ao carregar mídia (' + mr.status + ')' });
    const buf = Buffer.from(await mr.arrayBuffer());
    res.writeHead(200, { 'Content-Type': mr.headers.get('content-type') || 'application/octet-stream', 'Content-Disposition': 'inline' });
    return res.end(buf);
  }

  if (pathname === '/google/drive/save' && req.method === 'POST') {
    const cloud = loadCloudConnections();
    if (!cloud.google?.token) return sendJson(res, 401, { error: 'Google não sincronizado.' });
    const { id, kind, content, mimeType } = await readBody(req);
    if (!id || typeof content !== 'string') return sendJson(res, 400, { error: 'ID e conteúdo são obrigatórios.' });
    if (kind === 'doc') {
      const docR = await fetch('https://docs.googleapis.com/v1/documents/' + encodeURIComponent(id), {
        headers: { Authorization: 'Bearer ' + cloud.google.token },
      });
      const doc = await docR.json();
      if (!docR.ok) return sendJson(res, docR.status, { error: doc.error?.message || 'Erro ao ler Doc.' });
      const bodyEls = doc.body?.content || [];
      const lastEnd = bodyEls.length > 0 ? (bodyEls[bodyEls.length - 1].endIndex || 1) : 1;
      const requests = [];
      if (lastEnd > 2) requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: lastEnd - 1 } } });
      if (content.length > 0) requests.push({ insertText: { location: { index: 1 }, text: content } });
      if (requests.length > 0) {
        const upR = await fetch('https://docs.googleapis.com/v1/documents/' + encodeURIComponent(id) + ':batchUpdate', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + cloud.google.token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests }),
        });
        const upD = await upR.json();
        if (!upR.ok) return sendJson(res, upR.status, { error: upD.error?.message || 'Erro ao atualizar Doc.' });
      }
      return sendJson(res, 200, { ok: true, message: 'Google Doc atualizado com sucesso.' });
    }
    const upR = await fetch('https://www.googleapis.com/upload/drive/v3/files/' + encodeURIComponent(id) + '?uploadType=media', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + cloud.google.token, 'Content-Type': mimeType || 'text/plain; charset=utf-8' },
      body: content,
    });
    const upD = await upR.json();
    if (!upR.ok) return sendJson(res, upR.status, { error: upD.error?.message || 'Erro ao salvar no Drive.' });
    return sendJson(res, 200, { ok: true, message: 'Arquivo salvo no Google Drive.' });
  }

  if (pathname === '/web/credentials' && req.method === 'GET') {
    const list = loadVault().map(({ id, siteName, loginUrl, username, createdAt }) => ({ id, siteName, loginUrl, username, createdAt }));
    return sendJson(res, 200, { credentials: list });
  }

  if (pathname === '/web/credentials' && req.method === 'POST') {
    const { siteName, loginUrl, username, password } = await readBody(req);
    if (!siteName || !loginUrl || !username || !password) return sendJson(res, 400, { error: 'Campos obrigatórios ausentes.' });
    const enc = encryptStr(password);
    const list = loadVault().filter((c) => c.siteName.toLowerCase() !== siteName.toLowerCase());
    list.unshift({ id: Date.now(), siteName, loginUrl, username, encryptedPassword: enc.cipherText, iv: enc.iv, authTag: enc.authTag, createdAt: new Date().toISOString() });
    saveVault(list);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/web/credentials' && req.method === 'DELETE') {
    const id = Number(reqUrl.searchParams.get('id'));
    saveVault(loadVault().filter((c) => c.id !== id));
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/web/navigate' && req.method === 'POST') {
    try {
      const { url } = await readBody(req);
      return sendJson(res, 200, { snapshot: await webNavigate(url) });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (pathname === '/web/login' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const snapshot = await webLogin({ siteOrId: body.credentialId, loginUrl: body.loginUrl, username: body.username, password: body.password });
      return sendJson(res, 200, { ok: true, snapshot });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (pathname === '/files' && req.method === 'GET') {
    const rawPath = reqUrl.searchParams.get('path') || '.';
    const targetDir = path.resolve(HOME, rawPath);
    const parentDir = path.dirname(targetDir);
    try {
      const entries = fs.readdirSync(targetDir, { withFileTypes: true }).slice(0, 150).map((e) => {
        const full = path.join(targetDir, e.name);
        let sizeBytes = 0;
        try { sizeBytes = fs.statSync(full).size; } catch {}
        return { name: e.name, fullPath: full, type: e.isDirectory() ? 'directory' : 'file', sizeBytes };
      }).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
      return sendJson(res, 200, { dir: targetDir, parentDir, entries });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  function detectMimeLocal(fp) {
    const ext = path.extname(fp).toLowerCase();
    const map = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json', '.html': 'text/html', '.htm': 'text/html' };
    return map[ext] || 'text/plain';
  }

  if (pathname === '/file' && req.method === 'GET') {
    const targetFile = path.resolve(HOME, reqUrl.searchParams.get('path') || '');
    try {
      const stat = fs.statSync(targetFile);
      if (stat.isDirectory()) return sendJson(res, 400, { error: 'Caminho é um diretório.' });
      const mimeType = detectMimeLocal(targetFile);
      let kind = 'text';
      if (mimeType === 'application/pdf') kind = 'pdf';
      else if (mimeType.startsWith('image/') && mimeType !== 'image/svg+xml') kind = 'image';
      else if (mimeType.startsWith('audio/')) kind = 'audio';
      else if (mimeType.startsWith('video/')) kind = 'video';
      const content = kind === 'text' ? fs.readFileSync(targetFile, 'utf-8').slice(0, 160000) : '';
      return sendJson(res, 200, { path: targetFile, name: path.basename(targetFile), mimeType, kind, editable: kind === 'text', sizeBytes: stat.size, content });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname === '/file/media' && req.method === 'GET') {
    const targetFile = path.resolve(HOME, reqUrl.searchParams.get('path') || '');
    try {
      const stat = fs.statSync(targetFile);
      if (stat.isDirectory()) return sendJson(res, 400, { error: 'Caminho é um diretório.' });
      res.writeHead(200, { 'Content-Type': detectMimeLocal(targetFile), 'Content-Disposition': 'inline' });
      return res.end(fs.readFileSync(targetFile));
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname === '/file/save' && req.method === 'POST') {
    try {
      const { path: fp, content } = await readBody(req);
      if (!fp || typeof content !== 'string') return sendJson(res, 400, { error: 'Caminho e conteúdo obrigatórios.' });
      const targetFile = path.resolve(HOME, fp);
      fs.writeFileSync(targetFile, content, 'utf-8');
      appendJsonLine(MEMORY_FILE, { role: 'tool', action: 'file_save', path: targetFile, bytes: Buffer.byteLength(content, 'utf-8') });
      return sendJson(res, 200, { ok: true, path: targetFile, bytesWritten: Buffer.byteLength(content, 'utf-8') });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname === '/exec' && req.method === 'POST') {
    const { command, confirmed, cwd } = await readBody(req);
    if (!command || !String(command).trim()) return sendJson(res, 400, { error: 'Comando obrigatório' });
    if (isMutating(command) && !confirmed) return sendJson(res, 200, { requiresConfirmation: true, command });
    try {
      const { stdout, stderr } = await execNative(command, cwd || HOME);
      appendJsonLine(MEMORY_FILE, { role: 'tool', command, stdout, stderr });
      return sendJson(res, 200, { requiresConfirmation: false, stdout, stderr, exitCode: 0 });
    } catch (err) {
      return sendJson(res, 200, { requiresConfirmation: false, stdout: err.stdout || '', stderr: err.stderr || err.message, exitCode: 1 });
    }
  }

  if (pathname === '/memory' && req.method === 'GET') {
    return sendJson(res, 200, { facts: loadFacts(), recent: readJsonLines(MEMORY_FILE, 50) });
  }

  if (pathname === '/memory/facts' && req.method === 'POST') {
    const { fact } = await readBody(req);
    if (fact && String(fact).trim()) saveFact(String(fact).trim());
    return sendJson(res, 200, { facts: loadFacts() });
  }

  if (pathname === '/memory/facts' && req.method === 'DELETE') {
    const idParam = Number(reqUrl.searchParams.get('id'));
    const next = loadFacts().filter((f) => f.id !== idParam);
    fs.writeFileSync(FACTS_FILE, JSON.stringify(next, null, 2), 'utf-8');
    return sendJson(res, 200, { facts: next });
  }

  function shouldRunLocalInBackground(promptStr, forceBg) {
    if (forceBg) return { shouldRunInBackground: true, reason: 'Execução em segundo plano ativada manualmente.' };
    const lower = String(promptStr || '').toLowerCase();
    if (/\\b(em segundo plano|segundo plano|background|ass[ií]ncrono|sem travar)\\b/i.test(lower)) {
      return { shouldRunInBackground: true, reason: 'Execução em segundo plano solicitada diretamente.' };
    }
    const heavySignals = [
      'varredura', 'auditoria completa', 'analise todos os', 'extraia todos', 'baixe todos',
      'organize todos', 'compare detalhadamente', 'relatório completo', 'pesquisa profunda',
      'múltiplas pastas', 'multiplas pastas', 'sub-menus', 'submenus', 'todos os anexos',
    ];
    if (heavySignals.some((k) => lower.includes(k)) || lower.length > 260) {
      return { shouldRunInBackground: true, reason: 'Demanda longa/multi-etapas movida para 2º plano para não travar o chat.' };
    }
    return { shouldRunInBackground: false, reason: 'Execução rápida em primeiro plano.' };
  }

  function buildLocalSubtasks(promptStr, route) {
    const lower = String(promptStr || '').toLowerCase();
    const tasks = [];
    if (/(site|url|http|naveg|portal|login|extrai|anexo)/i.test(lower)) {
      tasks.push({ id: 'st_web', label: 'Operador Web', objective: 'Mapear página, links, menus e extrair dados solicitados', model: 'gemini-3.1-flash-lite' });
    }
    if (/(drive|gmail|email|e-mail|agenda|calend|google|nuvem|tarefa|tasks)/i.test(lower)) {
      tasks.push({ id: 'st_google', label: 'Coletor Google Workspace', objective: 'Consultar Drive, Gmail, Agenda e Tarefas sincronizados', model: 'gemini-3.1-flash-lite' });
    }
    if (/(arquivo|pasta|disco|cpu|ram|terminal|comando|processo|servi|downloads|home|bash|linux|windows)/i.test(lower)) {
      tasks.push({ id: 'st_sys', label: 'Inspetor de Sistema Local', objective: 'Executar leitura/busca local e coletar métricas da máquina', model: 'gemini-3.1-flash-lite' });
    }
    if (tasks.length === 0) {
      tasks.push({ id: 'st_collect', label: 'Trabalhador de Coleta', objective: 'Levantar contexto, fatos e estrutura inicial da resposta', model: 'gemini-3.1-flash-lite' });
      if (route.tier !== 'lite' || lower.length > 75) {
        tasks.push({ id: 'st_verify', label: 'Verificador Técnico', objective: 'Validar detalhes, passos e consistência antes da curadoria', model: 'gemini-3.1-flash-lite' });
      }
    }
    return tasks.slice(0, 3);
  }

  async function runLocalOrchestration(params, emit) {
    const t0 = Date.now();
    const settings = loadLocalSettings();
    const prompt = String(params.prompt || '').trim();
    const modelPreference = params.modelPreference || settings.modelPreference || 'auto';
    const effectivePref = modelPreference === 'eco' ? 'gemini-3.1-flash-lite' : modelPreference;

    appendJsonLine(MEMORY_FILE, { role: 'user', content: prompt });
    const route = selectModel(prompt, effectivePref);
    const curatorModel =
      effectivePref === 'auto'
        ? route.model === 'gemini-3.1-flash-lite' && prompt.length > 28
          ? 'gemini-4-hydrogen'
          : route.model
        : effectivePref;

    let activeModel = curatorModel;
    let fallbackUsed = false;
    let escalated = false;
    let curationSkipped = false;
    const facts = loadFacts().slice(0, 8).map((f) => f.content.slice(0, 140)).join('\\n- ');
    const cloud = loadCloudConnections();
    const gCache = loadGoogleSyncCache();

    const thinkingTrace = [];
    const pushTrace = (entry) => {
      const full = {
        id: entry.id || ('lt_' + Date.now() + '_' + thinkingTrace.length),
        status: entry.status || 'done',
        timestamp: new Date().toISOString(),
        ...entry,
      };
      const existingIdx = thinkingTrace.findIndex((t) => t.id === full.id);
      if (existingIdx >= 0) thinkingTrace[existingIdx] = { ...thinkingTrace[existingIdx], ...full };
      else thinkingTrace.push(full);
      if (emit) emit('trace', { entry: full, trace: thinkingTrace });
      return full;
    };

    const emitRouting = (patch) => {
      if (emit) emit('routing', patch);
    };

    const pendingConfirmations = [];
    const outputs = [];
    const screens = [];
    const steps = [];
    let promptTokens = 0, outputTokens = 0, thoughtsTokens = 0, totalTokens = 0;

    const googleContextSummary = cloud.google?.token
      ? 'Conectado (' + cloud.google.email + ') · Última sync: ' + (gCache.lastSyncAt || 'agora') + ' · Cache: ' + (gCache.drive?.length || 0) + ' arq Drive, ' + (gCache.gmail?.length || 0) + ' e-mails, ' + (gCache.calendar?.length || 0) + ' eventos, ' + (gCache.tasks?.length || 0) + ' tarefas.'
      : 'Desconectado (o usuário pode conectar a conta Google direto no menu Google Sync do app local)';

    const addUsageMeta = (um) => {
      if (!um) return;
      promptTokens += um.promptTokenCount || 0;
      outputTokens += um.candidatesTokenCount || 0;
      thoughtsTokens += um.thoughtsTokenCount || 0;
      totalTokens += um.totalTokenCount || ((um.promptTokenCount || 0) + (um.candidatesTokenCount || 0));
    };

    const executeLocalTool = async (call, runningModel) => {
      const toolTraceId = 'tool_' + Date.now() + '_' + steps.length;
      pushTrace({ id: toolTraceId, kind: 'tool', status: 'running', title: call.name, detail: JSON.stringify(call.args || {}).slice(0, 160), model: runningModel, role: 'worker' });
      emitRouting({ phase: 'invoking', activeModel: runningModel, activeTool: call.name, reason: 'Executando ferramenta local: ' + call.name });
      let toolResult = {};
      let status = 'executed';
      try {
        if (call.name === 'memory_remember' && call.args?.fact) {
          saveFact(String(call.args.fact));
          toolResult = { ok: true, saved: call.args.fact };
          outputs.push({ tool: 'memory_remember', saved: call.args.fact });
        } else if (call.name === 'draw_holographic_screen') {
          const scr = {
            id: 'scr_' + Date.now() + '_' + screens.length,
            kind: String(call.args?.kind || 'interactive_dashboard'),
            title: String(call.args?.title || 'Projeção Aegis Local'),
            content: call.args?.content ? String(call.args.content) : '',
            htmlCode: call.args?.htmlCode ? String(call.args.htmlCode) : '',
            createdAt: new Date().toISOString(),
          };
          screens.push(scr);
          toolResult = { ok: true, screenId: scr.id, message: 'Tela holográfica projetada.' };
          outputs.push({ tool: 'draw_holographic_screen', title: scr.title, kind: scr.kind });
        } else if (call.name === 'local_write_file') {
          const targetFile = path.resolve(HOME, String(call.args?.path || ''));
          fs.mkdirSync(path.dirname(targetFile), { recursive: true });
          fs.writeFileSync(targetFile, String(call.args?.content || ''), 'utf-8');
          toolResult = { ok: true, path: targetFile };
          outputs.push({ tool: 'local_write_file', path: targetFile });
        } else if (call.name === 'local_open_app') {
          const tgt = String(call.args?.target || '').trim();
          if (IS_WIN) await execNative('Start-Process ' + JSON.stringify(tgt));
          else await execNative('nohup xdg-open ' + JSON.stringify(tgt) + ' >/dev/null 2>&1 &');
          toolResult = { ok: true, opened: tgt };
          outputs.push({ tool: 'local_open_app', target: tgt });
        } else if (call.name === 'local_search') {
          const dir = String(call.args?.directory || HOME).replace(/^~/, HOME);
          const pat = String(call.args?.pattern || '');
          const searchCmd = IS_WIN
            ? 'Get-ChildItem -Path ' + JSON.stringify(dir) + ' -Recurse -Depth 3 -Filter "*' + pat + '*" -ErrorAction SilentlyContinue | Select-Object -First 30 -ExpandProperty FullName'
            : 'find "' + dir + '" -maxdepth 3 -iname "*' + pat + '*" 2>/dev/null | head -n 30';
          const { stdout } = await execNative(searchCmd);
          toolResult = { ok: true, stdout };
          outputs.push({ tool: 'local_search', stdout });
        } else if (call.name === 'local_exec') {
          const cmd = String(call.args?.command || '');
          const cwd = call.args?.cwd ? String(call.args.cwd).replace(/^~/, HOME) : HOME;
          if (isMutating(cmd)) {
            status = 'awaiting_confirmation';
            pendingConfirmations.push({ id: 'lconf_' + Date.now(), type: 'command', action_type: 'local_exec', target: cmd, summary: 'Executar comando destrutivo local: ' + cmd, command: cmd, reason: 'Ação destrutiva requer confirmação' });
            toolResult = { status: 'AWAITING_USER_CONFIRMATION', command: cmd };
          } else {
            const { stdout, stderr } = await execNative(cmd, cwd);
            toolResult = { ok: true, cmd, stdout: String(stdout || '').slice(0, 6000), stderr: String(stderr || '').slice(0, 2000), exitCode: 0 };
            outputs.push({ tool: 'local_exec', cmd, stdout, stderr });
          }
        } else if (call.name === 'web_navigate') {
          const snap = await webNavigate(String(call.args?.url || ''));
          toolResult = { ok: snap.status < 400, url: snap.url, title: snap.title, status: snap.status, textPreview: snap.textPreview.slice(0, 3000), links: snap.links.slice(0, 10) };
          outputs.push({ tool: 'web_navigate', url: snap.url, title: snap.title });
        } else if (call.name === 'web_login') {
          status = 'awaiting_confirmation';
          pendingConfirmations.push({ id: 'lconf_' + Date.now(), type: 'web_login', action_type: 'web_login', target: String(call.args?.siteOrId || call.args?.loginUrl || 'site'), summary: 'Login web em ' + (call.args?.siteOrId || call.args?.loginUrl || 'site'), payload: call.args || {}, command: 'Login web em ' + (call.args?.siteOrId || call.args?.loginUrl || 'site') });
          toolResult = { status: 'AWAITING_USER_CONFIRMATION' };
        } else if (call.name === 'google_list_recent') {
          const activeCloud = loadCloudConnections();
          if (!activeCloud.google?.token) {
            toolResult = { ok: false, error: 'Google não conectado no Aegis Local. Clique em "Conectar Google" na barra superior.' };
          } else {
            const svc = String(call.args?.service || 'all').toLowerCase();
            if (svc === 'all') {
              const snap = await runFullGoogleWorkspaceSync(activeCloud.google.token, activeCloud.google.email);
              toolResult = { ok: true, syncedAt: snap.lastSyncAt, drive: snap.drive.slice(0, 12), gmail: snap.gmail.slice(0, 6), calendar: snap.calendar.slice(0, 8), tasks: snap.tasks.slice(0, 10) };
            } else if (svc === 'drive') {
              const fId = call.args?.folderId ? String(call.args.folderId) : 'root';
              const r = await fetch("https://www.googleapis.com/drive/v3/files?pageSize=20&orderBy=folder,name&fields=files(id,name,mimeType,modifiedTime)&q=trashed%20%3D%20false%20and%20'" + encodeURIComponent(fId) + "'%20in%20parents", { headers: { Authorization: 'Bearer ' + activeCloud.google.token } });
              toolResult = { ok: r.ok, data: await r.json() };
            } else if (svc === 'calendar') {
              const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=12&singleEvents=true&orderBy=startTime&timeMin=' + encodeURIComponent(new Date().toISOString()), { headers: { Authorization: 'Bearer ' + activeCloud.google.token } });
              toolResult = { ok: r.ok, data: await r.json() };
            } else if (svc === 'tasks') {
              const r = await fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?maxResults=15&showCompleted=false', { headers: { Authorization: 'Bearer ' + activeCloud.google.token } });
              toolResult = { ok: r.ok, data: await r.json() };
            } else {
              const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=8', { headers: { Authorization: 'Bearer ' + activeCloud.google.token } });
              toolResult = { ok: r.ok, data: await r.json() };
            }
          }
          outputs.push({ tool: 'google_list_recent', ok: Boolean(toolResult.ok) });
        } else if (call.name === 'google_drive_download_local') {
          const activeCloud = loadCloudConnections();
          if (!activeCloud.google?.token) {
            toolResult = { ok: false, error: 'Google não conectado no Aegis Local.' };
          } else {
            const fId = String(call.args?.fileId || '');
            const metaR = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fId) + '?fields=id,name,mimeType', { headers: { Authorization: 'Bearer ' + activeCloud.google.token } });
            const meta = await metaR.json();
            let dlUrl = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fId) + '?alt=media';
            let safeName = String(meta.name || fId).replace(/[\\\\/:*?"<>|]/g, '_');
            if (meta.mimeType === 'application/vnd.google-apps.document') { dlUrl = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fId) + '/export?mimeType=text/plain'; safeName += '.txt'; }
            else if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') { dlUrl = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fId) + '/export?mimeType=text/csv'; safeName += '.csv'; }
            const dlR = await fetch(dlUrl, { headers: { Authorization: 'Bearer ' + activeCloud.google.token } });
            const buf = Buffer.from(await dlR.arrayBuffer());
            const destDir = call.args?.targetDir ? path.resolve(HOME, String(call.args.targetDir).replace(/^~/, HOME)) : GOOGLE_SYNC_DIR;
            fs.mkdirSync(destDir, { recursive: true });
            const savedPath = path.join(destDir, safeName);
            fs.writeFileSync(savedPath, buf);
            toolResult = { ok: true, savedPath, bytes: buf.length };
          }
        } else if (call.name === 'google_drive_upload_local') {
          status = 'awaiting_confirmation';
          pendingConfirmations.push({ id: 'lconf_' + Date.now(), type: 'google_upload', action_type: 'google_drive_upload_local', target: String(call.args?.localPath || ''), summary: 'Enviar arquivo local "' + String(call.args?.localPath || '') + '" ao Google Drive', payload: call.args || {} });
          toolResult = { status: 'AWAITING_USER_CONFIRMATION' };
        }
      } catch (toolErr) {
        status = 'error';
        toolResult = { ok: false, error: toolErr.message };
      }
      steps.push({ tool: call.name, args: call.args || {}, status, result: toolResult });
      pushTrace({
        id: toolTraceId,
        kind: 'tool',
        status: status === 'error' ? 'error' : 'done',
        title: call.name,
        detail: status === 'executed' ? 'Executado localmente com sucesso.' : (toolResult.error || 'Aguardando confirmação do operador'),
        model: runningModel,
        role: 'worker',
      });
      return { functionResponse: { id: call.id, name: call.name, response: toolResult } };
    };

    emitRouting({ phase: 'analyzing', activeModel: 'gemini-3.1-flash-lite', tier: route.tier, reason: 'Analisando complexidade e subdivisão de subagentes...' });
    const isTrivial = /^(oi|olá|ola|bom dia|boa tarde|boa noite|ok|obrigado|valeu|ping|teste)[\\s!?.]*$/i.test(prompt);
    const needsToolHint = /(arquivo|pasta|home|download|disco|cpu|ram|memória|memoria|processo|serviço|servico|comando|terminal|bash|exec|abrir|abre|site|url|http|login|logar|drive|gmail|email|e-mail|agenda|calendário|calendario|tarefa|tasks|android|adb|google|sincron|tela|desenhe)/i.test(prompt);

    if ((isTrivial || (effectivePref === 'gemini-3.1-flash-lite' && !needsToolHint) || (route.tier === 'lite' && !needsToolHint && prompt.length <= 120)) && (effectivePref === 'auto' || effectivePref === 'gemini-3.1-flash-lite')) {
      curationSkipped = true;
      pushTrace({ kind: 'routing', status: 'done', title: 'Roteamento Econômico Direto', detail: 'Demanda conversacional simples atendida diretamente pelo Flash Lite (curadoria dispensada para economia máxima de tokens).', model: 'gemini-3.1-flash-lite', role: 'router' });
      const directRes = await getAiClient().models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          systemInstruction: 'Você é o Aegis Local em ' + os.hostname() + '. Responda em Português de forma direta e concisa.',
          includeThoughts: true,
        },
      });
      addUsageMeta(directRes.usageMetadata);
      if (directRes.thoughts) {
        pushTrace({ kind: 'thought', status: 'done', title: 'Raciocínio Rápido', detail: directRes.thoughts, model: directRes.resolvedModel || 'gemini-3.1-flash-lite', role: 'worker' });
      }
      const replyText = (directRes.text || 'Pronto.').trim();
      const latencyMs = Date.now() - t0;
      const usageEntry = {
        model: directRes.resolvedModel || 'gemini-3.1-flash-lite',
        routingMode: effectivePref === 'auto' ? 'auto' : 'manual',
        routingReason: 'Resposta direta econômica (curadoria dispensada)',
        complexityTier: 'lite',
        promptTokens,
        outputTokens,
        thoughtsTokens,
        totalTokens,
        latencyMs,
        fallbackUsed: false,
        escalated: false,
        curationSkipped: true,
        workerModels: ['gemini-3.1-flash-lite'],
        curatorModel: 'gemini-3.1-flash-lite',
        subtasksCount: 0,
      };
      appendJsonLine(USAGE_FILE, usageEntry);
      appendJsonLine(MEMORY_FILE, { role: 'assistant', content: replyText, outputs, usage: usageEntry });
      emitRouting({ phase: 'idle', activeModel: usageEntry.model, curatorModel: usageEntry.model, tier: 'lite', reason: usageEntry.routingReason });
      return { reply: replyText, steps, outputs, screens, pendingConfirmations, usage: usageEntry, thinkingTrace };
    }

    // STAGE 1: Explicit Task Decomposition into Worker Sub-Agents ("Trabalho Bruto")
    const subtasks = buildLocalSubtasks(prompt, route);
    emitRouting({ phase: 'planning', activeModel: 'gemini-3.1-flash-lite', curatorModel, workerCount: subtasks.length, tier: route.tier, reason: 'Subdividindo em ' + subtasks.length + ' subagente(s) leves (trabalho bruto)' });
    pushTrace({
      kind: 'plan',
      status: 'done',
      title: 'Plano Multi-Agente (' + subtasks.length + ' ' + (subtasks.length === 1 ? 'trabalhador' : 'trabalhadores') + ' → Curadoria)',
      detail: 'Modelos leves (Flash Lite) executam coleta, ferramentas e rascunho; Curador Sênior revisa apenas quando necessário.',
      model: 'gemini-3.1-flash-lite',
      role: 'decomposer',
      subtasks,
    });

    const workerDossiers = [];
    for (let sIdx = 0; sIdx < subtasks.length; sIdx++) {
      const st = subtasks[sIdx];
      const wStart = Date.now();
      const wTraceId = 'worker_' + st.id + '_' + Date.now();
      emitRouting({ phase: 'subagent', activeModel: st.model, curatorModel, activeSubagent: st.label, workerCount: subtasks.length, tier: route.tier, reason: 'Trabalhador #' + (sIdx + 1) + ': ' + st.objective });
      pushTrace({ id: wTraceId, kind: 'worker', status: 'running', title: '#' + (sIdx + 1) + ' · ' + st.label, detail: st.objective, model: st.model, role: 'worker' });

      const workerContents = [{
        role: 'user',
        parts: [{
          text: 'Subtarefa #' + (sIdx + 1) + ' (' + st.label + '): ' + st.objective + '\\n\\nPedido completo do operador:\\n' + prompt + (workerDossiers.length ? '\\n\\nDescobertas anteriores:\\n' + workerDossiers.join('\\n---\\n').slice(0, 1400) : ''),
        }],
      }];

      let wOut = '';
      let wErr = false;
      try {
        for (let wHop = 0; wHop < 2; wHop++) {
          const wRes = await getAiClient().models.generateContent({
            model: st.model,
            contents: workerContents,
            config: {
              systemInstruction: 'Você é o Subagente Trabalhador "' + st.label + '" do Aegis Local em ' + os.hostname() + ' (' + (IS_WIN ? 'Windows' : 'Linux') + '). Google: ' + googleContextSummary + '. Execute ferramentas necessárias e devolva um dossiê objetivo e completo em Português.',
              tools,
              includeThoughts: true,
            },
          });
          addUsageMeta(wRes.usageMetadata);
          if (wRes.thoughts) {
            pushTrace({ kind: 'thought', status: 'done', title: st.label, detail: wRes.thoughts, model: wRes.resolvedModel || st.model, role: 'worker' });
          }
          const wCalls = wRes.functionCalls || [];
          if (wCalls.length === 0) {
            wOut = (wRes.text || '').trim().slice(0, 2600);
            break;
          }
          if (wRes.candidates?.[0]?.content) workerContents.push(wRes.candidates[0].content);
          const fnParts = await Promise.all(wCalls.map((c) => executeLocalTool(c, wRes.resolvedModel || st.model)));
          workerContents.push({ role: 'user', parts: fnParts });
        }
      } catch (e) {
        wErr = true;
        wOut = 'Erro no trabalhador: ' + e.message;
      }

      if (wOut) workerDossiers.push('[' + st.label + ']\\n' + wOut);
      pushTrace({
        id: wTraceId,
        kind: 'worker',
        status: wErr ? 'error' : 'done',
        title: '#' + (sIdx + 1) + ' · ' + st.label,
        detail: wOut || 'Subtarefa concluída.',
        model: st.model,
        role: 'worker',
        latencyMs: Date.now() - wStart,
      });
    }

    const workerDossier = workerDossiers.join('\\n\\n');
    const workerHadErrors = steps.some((s) => s.status === 'error') || thinkingTrace.some((t) => t.kind === 'worker' && t.status === 'error');

    // SMART CURATION GATE: avoid heavy curator tokens when Flash Lite workers already nailed a modest demand
    const canSkipCurator =
      (effectivePref === 'auto' || effectivePref === 'gemini-3.1-flash-lite') &&
      Boolean(workerDossier) &&
      !workerHadErrors &&
      pendingConfirmations.length === 0 &&
      (effectivePref === 'gemini-3.1-flash-lite' || route.tier === 'lite' || (route.tier === 'balanced' && subtasks.length === 1 && prompt.length <= 165 && steps.length <= 2));

    if (canSkipCurator) {
      curationSkipped = true;
      pushTrace({
        kind: 'curator',
        status: 'done',
        title: 'Curadoria dispensada (economia de tokens)',
        detail: 'O subagente leve Flash Lite entregou um dossiê completo e sem erros; modelo sênior não precisou ser acionado.',
        model: 'gemini-3.1-flash-lite',
        role: 'curator',
      });
      const cleanFinal = workerDossiers.length === 1 ? workerDossiers[0].replace(/^\\[[^\\]]+\\]\\n/, '') : workerDossier;
      const latencyMs = Date.now() - t0;
      const usageEntry = {
        model: 'gemini-3.1-flash-lite',
        routingMode: effectivePref === 'auto' ? 'auto' : 'manual',
        routingReason: 'Local (' + os.hostname() + ') · Curadoria dispensada (entrega limpa pelos trabalhadores)',
        complexityTier: route.tier,
        promptTokens,
        outputTokens,
        thoughtsTokens,
        totalTokens,
        latencyMs,
        fallbackUsed: false,
        escalated: false,
        curationSkipped: true,
        workerModels: ['gemini-3.1-flash-lite'],
        curatorModel: 'gemini-3.1-flash-lite',
        subtasksCount: subtasks.length,
      };
      appendJsonLine(USAGE_FILE, usageEntry);
      appendJsonLine(MEMORY_FILE, { role: 'assistant', content: cleanFinal, outputs, usage: usageEntry });
      emitRouting({ phase: 'idle', activeModel: 'gemini-3.1-flash-lite', curatorModel: 'gemini-3.1-flash-lite', tier: route.tier, reason: usageEntry.routingReason });
      return { reply: cleanFinal, steps, outputs, screens, pendingConfirmations, usage: usageEntry, thinkingTrace };
    }

    // Right-size curator model when workers succeeded cleanly
    if (effectivePref === 'auto' && !workerHadErrors && activeModel === 'gemini-4-argon' && steps.length <= 2 && subtasks.length <= 2) {
      activeModel = 'gemini-4-hydrogen';
    }

    if (activeModel !== 'gemini-3.1-flash-lite') {
      escalated = true;
      emitRouting({ phase: 'escalating', previousModel: 'gemini-3.1-flash-lite', activeModel, curatorModel: activeModel, tier: route.tier, reason: 'Escalonando trabalho bruto para Curadoria Sênior (' + activeModel + ')' });
      pushTrace({
        kind: 'escalation',
        status: 'done',
        title: 'Escalonamento: Flash Lite → ' + activeModel,
        detail: workerHadErrors
          ? 'Trabalhador encontrou obstáculos; promovido para modelo curador mais capaz.'
          : 'Múltiplas frentes ou complexidade ' + route.tier + ' requerem curadoria e síntese sênior.',
        model: activeModel,
        role: 'router',
      });
    }

    // STAGE 2: Senior Curator Synthesis & Verification
    const curatorTraceId = 'curator_' + Date.now();
    emitRouting({ phase: 'curating', activeModel, curatorModel: activeModel, tier: route.tier, reason: 'Curador Sênior revisando e sintetizando entrega final...' });
    pushTrace({
      id: curatorTraceId,
      kind: 'curator',
      status: 'running',
      title: 'Curadoria Sênior · ' + activeModel,
      detail: 'Auditando dossiê dos trabalhadores, dados locais e Google Workspace.',
      model: activeModel,
      role: 'curator',
    });

    const systemInstruction = 'Você é o Curador Sênior do Aegis Local em ' + os.hostname() + ' (' + (IS_WIN ? 'Windows' : 'Linux') + '). Google: ' + googleContextSummary + '. Pasta sync: ' + GOOGLE_SYNC_DIR + '. Revise criticamente o trabalho dos subagentes, corrija lacunas e entregue uma resposta clara e polida em Português.\\nMemória:\\n- ' + facts;
    const curatorPrompt = workerDossier
      ? 'Solicitação do operador:\\n' + prompt + '\\n\\n[DOSSIÊ DOS SUBAGENTES TRABALHADORES]\\n' + workerDossier + '\\n\\nFaça a curadoria final (use ferramentas extras somente se faltar informação crítica).'
      : prompt;

    const contents = [{ role: 'user', parts: [{ text: curatorPrompt }] }];

    for (let hop = 0; hop < 4; hop++) {
      let response;
      try {
        response = await getAiClient().models.generateContent({
          model: activeModel,
          contents,
          config: { systemInstruction, tools, includeThoughts: true },
        });
      } catch (err) {
        if (activeModel !== 'gemini-4-hydrogen' && activeModel !== 'gemini-3.1-flash-lite' && !fallbackUsed) {
          const prevM = activeModel;
          activeModel = 'gemini-4-hydrogen';
          fallbackUsed = true;
          emitRouting({ phase: 'fallback', previousModel: prevM, activeModel, curatorModel: activeModel, tier: route.tier, reason: 'Fallback automático de ' + prevM + ' para ' + activeModel });
          pushTrace({ kind: 'escalation', status: 'done', title: 'Fallback Automático: ' + prevM + ' → ' + activeModel, detail: err.message || 'Alternado automaticamente por resiliência.', model: activeModel, role: 'router' });
          response = await getAiClient().models.generateContent({
            model: activeModel,
            contents,
            config: { systemInstruction, tools, includeThoughts: true },
          });
        } else {
          throw err;
        }
      }

      addUsageMeta(response.usageMetadata);
      if (response.thoughts) {
        pushTrace({ kind: 'thought', status: 'done', title: 'Curadoria Sênior', detail: response.thoughts, model: response.resolvedModel || activeModel, role: 'curator' });
      }

      const calls = response.functionCalls || [];
      if (calls.length === 0) {
        const replyText = (response.text || 'Operação concluída.').trim();
        const latencyMs = Date.now() - t0;
        const resolvedCurator = response.resolvedModel || activeModel;
        pushTrace({ id: curatorTraceId, kind: 'curator', status: 'done', title: 'Curadoria Sênior Concluída', detail: 'Revisão final entregue em ' + (latencyMs / 1000).toFixed(1) + 's com ' + totalTokens + ' tokens.', model: resolvedCurator, role: 'curator' });
        const usageEntry = {
          model: resolvedCurator,
          routingMode: route.mode,
          routingReason: 'Operação Local (' + os.hostname() + ') · ' + route.reason,
          complexityTier: route.tier,
          promptTokens,
          outputTokens,
          thoughtsTokens,
          totalTokens,
          latencyMs,
          fallbackUsed,
          escalated,
          curationSkipped: false,
          workerModels: ['gemini-3.1-flash-lite'],
          curatorModel: resolvedCurator,
          subtasksCount: subtasks.length,
        };
        appendJsonLine(USAGE_FILE, usageEntry);
        appendJsonLine(MEMORY_FILE, { role: 'assistant', content: replyText, outputs, usage: usageEntry });
        emitRouting({ phase: 'idle', activeModel: resolvedCurator, curatorModel: resolvedCurator, tier: route.tier, reason: usageEntry.routingReason });
        return { reply: replyText, steps, outputs, screens, pendingConfirmations, usage: usageEntry, thinkingTrace };
      }

      if (response.candidates?.[0]?.content) contents.push(response.candidates[0].content);
      const fnParts = await Promise.all(calls.map((c) => executeLocalTool(c, response.resolvedModel || activeModel)));
      contents.push({ role: 'user', parts: fnParts });
    }

    const latencyMs = Date.now() - t0;
    pushTrace({ id: curatorTraceId, kind: 'curator', status: 'done', title: 'Curadoria Sênior Concluída', detail: 'Ciclo de ferramentas encerrado.', model: activeModel, role: 'curator' });
    const usageEntry = { model: activeModel, routingMode: route.mode, routingReason: route.reason, complexityTier: route.tier, promptTokens, outputTokens, thoughtsTokens, totalTokens, latencyMs, fallbackUsed, escalated, curationSkipped, workerModels: ['gemini-3.1-flash-lite'], curatorModel: activeModel, subtasksCount: subtasks.length };
    appendJsonLine(USAGE_FILE, usageEntry);
    emitRouting({ phase: 'idle', activeModel, curatorModel: activeModel, tier: route.tier, reason: usageEntry.routingReason });
    return { reply: 'Processamento local concluído.', steps, outputs, screens, pendingConfirmations, usage: usageEntry, thinkingTrace };
  }

  function launchLocalBackgroundJob(promptStr, modelPreference) {
    const jobId = 'bg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const title = promptStr.length > 64 ? promptStr.slice(0, 61) + '...' : promptStr;
    const job = {
      id: jobId,
      title,
      prompt: promptStr,
      status: 'running',
      activeModel: 'gemini-3.1-flash-lite',
      latestActivity: 'Iniciando trabalhadores em segundo plano...',
      thinkingTrace: [],
      reply: null,
      usage: null,
      screens: [],
      pendingConfirmations: [],
      createdAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    };
    upsertBackgroundJob(job);

    runLocalOrchestration(
      { prompt: promptStr, modelPreference },
      (evName, payload) => {
        if (evName === 'routing') {
          if (payload.activeModel) job.activeModel = payload.activeModel;
          if (payload.reason) job.latestActivity = payload.reason;
        } else if (evName === 'trace' && Array.isArray(payload.trace)) {
          job.thinkingTrace = payload.trace.slice();
          if (payload.entry?.title) job.latestActivity = payload.entry.title;
        }
      }
    )
      .then((result) => {
        job.status = 'completed';
        job.reply = result.reply;
        job.usage = result.usage;
        job.screens = result.screens || [];
        job.pendingConfirmations = result.pendingConfirmations || [];
        job.thinkingTrace = result.thinkingTrace || job.thinkingTrace;
        job.activeModel = result.usage?.model || job.activeModel;
        job.latestActivity = 'Concluído (' + (result.usage?.totalTokens || 0) + ' tok) — entregue no chat';
        job.completedAt = new Date().toISOString();
      })
      .catch((err) => {
        job.status = 'failed';
        job.error = err.message || 'Erro na tarefa em segundo plano.';
        job.latestActivity = 'Falhou: ' + job.error;
        job.completedAt = new Date().toISOString();
      });

    return job;
  }

  if (pathname === '/command/stream' && req.method === 'POST') {
    const body = await readBody(req);
    const { prompt, modelPreference, forceBackground = false, forceForeground = false, googleEmail } = body;
    const authHeader = req.headers.authorization || '';
    const bearerTok = /^Bearer\\s+(.+)$/i.test(authHeader) ? authHeader.replace(/^Bearer\\s+/i, '').trim() : '';
    if (bearerTok && bearerTok !== CLI_TOKEN && !activeSessions.has(bearerTok)) {
      const c = loadCloudConnections();
      c.google = { token: bearerTok, email: googleEmail || c.google?.email || 'Google User', updatedAt: new Date().toISOString() };
      saveCloudConnections(c);
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const sendSse = (event, data) => {
      try {
        res.write('event: ' + event + '\\ndata: ' + JSON.stringify(data) + '\\n\\n');
      } catch {}
    };

    try {
      const bgCheck = !forceForeground ? shouldRunLocalInBackground(prompt, forceBackground) : { shouldRunInBackground: false };
      if (bgCheck.shouldRunInBackground) {
        const job = launchLocalBackgroundJob(String(prompt || '').trim(), modelPreference);
        sendSse('background_started', { job, reason: bgCheck.reason });
        sendSse('final', {
          backgroundJob: job,
          reply: 'Movi esta demanda para **segundo plano** (' + job.id + ') para não travar sua conversa. Acompanhe pelo botão **2º Plano** no topo; assim que os subagentes e o curador concluírem, entregarei o resultado aqui automaticamente.',
        });
        return res.end();
      }
      const result = await runLocalOrchestration({ prompt, modelPreference }, sendSse);
      sendSse('final', result);
    } catch (err) {
      sendSse('error', { error: err.message || 'Erro ao processar comando local.' });
    }
    return res.end();
  }

  if (pathname === '/command' && req.method === 'POST') {
    const { prompt, confirmedCommand, confirmedWebLogin, confirmedGoogleUpload, modelPreference, forceBackground = false, forceForeground = false, googleEmail } = await readBody(req);
    const authHeader = req.headers.authorization || '';
    const bearerTok = /^Bearer\\s+(.+)$/i.test(authHeader) ? authHeader.replace(/^Bearer\\s+/i, '').trim() : '';

    if (bearerTok && bearerTok !== CLI_TOKEN && !activeSessions.has(bearerTok)) {
      const c = loadCloudConnections();
      c.google = { token: bearerTok, email: googleEmail || c.google?.email || 'Google User', updatedAt: new Date().toISOString() };
      saveCloudConnections(c);
    }

    try {
      if (confirmedWebLogin) {
        const snap = await webLogin(confirmedWebLogin);
        return sendJson(res, 200, { executed: true, summary: 'Login web executado em ' + snap.url + ' (' + snap.title + '). Cookies: ' + snap.cookieCount, snapshot: snap });
      }

      if (confirmedGoogleUpload) {
        const cloud = loadCloudConnections();
        if (!cloud.google?.token) return sendJson(res, 401, { error: 'Google não sincronizado no daemon local.' });
        const resolved = path.resolve(HOME, String(confirmedGoogleUpload.localPath || '').replace(/^~/, HOME));
        const fileBuf = fs.readFileSync(resolved);
        const uploadName = confirmedGoogleUpload.fileName || path.basename(resolved);
        const boundary = 'aegis_up_' + crypto.randomBytes(8).toString('hex');
        const metaPart = Buffer.from('--' + boundary + '\\r\\nContent-Type: application/json; charset=UTF-8\\r\\n\\r\\n' + JSON.stringify({ name: uploadName }) + '\\r\\n--' + boundary + '\\r\\nContent-Type: application/octet-stream\\r\\n\\r\\n');
        const endPart = Buffer.from('\\r\\n--' + boundary + '--');
        const upR = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + cloud.google.token, 'Content-Type': 'multipart/related; boundary=' + boundary },
          body: Buffer.concat([metaPart, fileBuf, endPart]),
        });
        const upD = await upR.json();
        return sendJson(res, upR.ok ? 200 : upR.status, { executed: upR.ok, summary: upR.ok ? 'Arquivo "' + uploadName + '" enviado ao Google Drive (ID: ' + upD.id + ').' : (upD.error?.message || 'Erro no upload.'), file: upD });
      }

      if (confirmedCommand) {
        let stdout = '', stderr = '', exitCode = 0;
        try {
          const out = await execNative(confirmedCommand, HOME);
          stdout = out.stdout || '';
          stderr = out.stderr || '';
        } catch (e) {
          stdout = e.stdout || '';
          stderr = e.stderr || e.message || '';
          exitCode = 1;
        }
        appendJsonLine(MEMORY_FILE, { role: 'tool', command: confirmedCommand, stdout, stderr });
        let summary = '';
        try {
          const sRes = await getAiClient().models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: 'Comando executado localmente: ' + confirmedCommand + '\\nExit code: ' + exitCode + '\\nSaída:\\n' + (stdout || stderr || '(sem saída)').slice(0, 1800) + '\\n\\nExplique claramente em Português o resultado obtido na máquina.',
          });
          summary = (sRes.text || '').trim();
        } catch {}
        return sendJson(res, 200, { executed: true, command: confirmedCommand, stdout, stderr, exitCode, summary });
      }

      const bgCheck = !forceForeground ? shouldRunLocalInBackground(prompt, forceBackground) : { shouldRunInBackground: false };
      if (bgCheck.shouldRunInBackground) {
        const job = launchLocalBackgroundJob(String(prompt || '').trim(), modelPreference);
        return sendJson(res, 200, {
          backgroundJob: job,
          reply: 'Movi esta demanda para segundo plano (' + job.id + ') para não travar o chat. Assim que finalizar, o resultado será entregue automaticamente.',
          steps: [],
          outputs: [],
          screens: [],
          pendingConfirmations: [],
          thinkingTrace: [],
        });
      }

      const result = await runLocalOrchestration({ prompt, modelPreference }, null);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (pathname === '/android/devices' && req.method === 'GET') {
    const list = await listAdbDevicesDesktop();
    return sendJson(res, 200, { devices: list });
  }

  if (pathname === '/android/exec' && req.method === 'POST') {
    try {
      const { serial, commandType, payload = {} } = await readBody(req);
      const out = await execAdbOnDesktop(String(serial || ''), String(commandType || 'shell'), payload);
      return sendJson(res, out.ok ? 200 : 400, out);
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message });
    }
  }

  if (pathname === '/cloud-bridge' && req.method === 'POST') {
    const { cloudUrl, pairingCode } = await readBody(req);
    if (!cloudUrl) return sendJson(res, 400, { error: 'cloudUrl obrigatório.' });
    fs.writeFileSync(CLOUD_BRIDGE_FILE, JSON.stringify({ cloudUrl, pairingCode: pairingCode || '', token: '' }, null, 2), { mode: 0o600 });
    startCloudRelay();
    return sendJson(res, 200, { ok: true, message: 'Ponte com Aegis Cloud iniciada.' });
  }

  // ===== Unified Multi-Transport Mesh Endpoints (Loopback Auth Required) =====
  if (pathname === '/mesh/status' && req.method === 'GET') {
    return sendJson(res, 200, getMeshStatusSnapshot());
  }

  if (pathname === '/mesh/scan' && req.method === 'POST') {
    triggerLanDiscoveryProbe();
    if (cloudRelaySocket && cloudRelaySocket.readyState === 1) {
      try { cloudRelaySocket.send(JSON.stringify({ type: 'get_peers' })); } catch {}
    } else {
      startCloudRelay();
    }
    const adbList = await listAdbDevicesDesktop();
    adbPeersCache = adbList;
    await new Promise((r) => setTimeout(r, 650));
    return sendJson(res, 200, { ok: true, ...getMeshStatusSnapshot() });
  }

  if (pathname === '/mesh/config' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const cfg = loadMeshConfig();
      if (typeof body.meshKey === 'string') {
        cfg.meshKey = body.meshKey.trim().slice(0, 128);
      }
      if (typeof body.lanDiscovery === 'boolean') {
        cfg.lanDiscovery = body.lanDiscovery;
      }
      saveMeshConfig(cfg);
      if (typeof body.cloudUrl === 'string' && body.cloudUrl.trim()) {
        saveLocalSettings({ cloudOrigin: body.cloudUrl.trim().replace(/\\/+$/, '') });
        startCloudRelay();
      }
      triggerLanDiscoveryProbe();
      return sendJson(res, 200, { ok: true, ...getMeshStatusSnapshot() });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message });
    }
  }

  if (pathname === '/mesh/exec' && req.method === 'POST') {
    try {
      const { peerId, commandType, payload = {}, preferredTransport } = await readBody(req);
      if (!peerId || !commandType) {
        return sendJson(res, 400, { ok: false, error: 'peerId e commandType são obrigatórios.' });
      }
      const out = await execMeshPeerCommand(String(peerId), String(commandType), payload, preferredTransport ? String(preferredTransport) : '');
      return sendJson(res, out.ok ? 200 : 400, out);
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message });
    }
  }

  if (pathname === '/mesh/clipboard' && req.method === 'POST') {
    try {
      const { text } = await readBody(req);
      const clean = String(text || '').slice(0, 32768);
      if (!clean) return sendJson(res, 400, { ok: false, error: 'Texto vazio.' });
      const delivered = await broadcastMeshClipboard(clean);
      return sendJson(res, 200, { ok: true, delivered, ...getMeshStatusSnapshot() });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message });
    }
  }

  res.writeHead(404);
  res.end('Not Found');
});

// ==========================================
// DESKTOP MULTI-TRANSPORT AUTO-MESH ENGINE
// (LAN UDP Discovery + HMAC LAN P2P + Cloud WS Mesh + ADB USB/Wi-Fi)
// ==========================================
const CLOUD_BRIDGE_FILE = path.join(DATA_DIR, 'cloud_bridge.json');
const MESH_CONFIG_FILE = path.join(DATA_DIR, 'mesh_config.json');
const LAN_DISCOVERY_PORT = Number(process.env.AEGIS_MESH_UDP_PORT || 38471);
const LAN_MESH_PORT = Number(process.env.AEGIS_MESH_TCP_PORT || 38472);
const ADB_SERIAL_RE = /^[a-zA-Z0-9._:-]{1,64}$/;

const lanPeers = new Map();
const cloudPeers = new Map();
let adbPeersCache = [];
let lanDiscoverySocket = null;
let lanMeshServer = null;
let lanDiscoveryActive = false;
let lanMeshServerActive = false;
let cloudRelayState = 'idle';
let cloudSelfId = '';
let recentClipboard = null;
const pendingPeerCommands = new Map();

function loadMeshConfig() {
  try {
    if (fs.existsSync(MESH_CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(MESH_CONFIG_FILE, 'utf-8'));
      if (parsed && parsed.deviceId) return parsed;
    }
  } catch {}
  const fresh = {
    deviceId: 'aegis_' + (IS_WIN ? 'win' : 'linux') + '_' + crypto.randomBytes(6).toString('hex'),
    meshKey: process.env.AEGIS_MESH_KEY || '',
    lanDiscovery: true,
  };
  try {
    fs.writeFileSync(MESH_CONFIG_FILE, JSON.stringify(fresh, null, 2), { mode: 0o600 });
  } catch {}
  return fresh;
}

function saveMeshConfig(cfg) {
  fs.writeFileSync(MESH_CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

const MESH_CFG_INIT = loadMeshConfig();

function getLanIpv4Addresses() {
  const ips = [];
  try {
    const nets = os.networkInterfaces();
    for (const ifaces of Object.values(nets)) {
      for (const iface of ifaces || []) {
        if (iface && iface.family === 'IPv4' && !iface.internal && iface.address) {
          ips.push(iface.address);
        }
      }
    }
  } catch {}
  return ips;
}

function getEffectiveMeshSecret() {
  const cfg = loadMeshConfig();
  if (cfg.meshKey && cfg.meshKey.trim()) {
    return { secret: cfg.meshKey.trim(), source: 'custom_key' };
  }
  const cloud = loadCloudConnections();
  const email = cloud?.google?.email ? String(cloud.google.email).trim().toLowerCase() : '';
  if (email) {
    const derived = crypto.createHash('sha256').update('aegis-google-mesh:' + email).digest('hex');
    return { secret: derived, source: 'google_account' };
  }
  return { secret: '', source: 'none' };
}

function computeMeshHmac(secret, ts, bodyStr) {
  return crypto.createHmac('sha256', secret).update(String(ts) + '.' + String(bodyStr)).digest('hex');
}

function verifyMeshHmac(secret, tsHeader, sigHeader, bodyStr) {
  if (!secret || !tsHeader || !sigHeader) return false;
  const ts = Number(tsHeader);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 60_000) return false;
  const expected = computeMeshHmac(secret, tsHeader, bodyStr);
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(String(sigHeader).trim(), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function isDestructiveMeshShell(cmd) {
  const s = String(cmd || '').toLowerCase();
  return /(rm\\s+-rf|mkfs\\.|dd\\s+if=|shutdown|reboot|poweroff|format\\s+[a-z]:|del\\s+\\/s|remove-item.*-recurse|chmod\\s+-r\\s+777\\s+\\/)/.test(s);
}

function buildLanBeaconPacket(kind = 'aegis-mesh-v1') {
  const cfg = loadMeshConfig();
  const lanIps = getLanIpv4Addresses();
  const sec = getEffectiveMeshSecret();
  return JSON.stringify({
    proto: kind,
    deviceId: cloudSelfId || cfg.deviceId,
    name: os.hostname() + (IS_WIN ? ' (Windows)' : ' (Linux)'),
    platform: IS_WIN ? 'windows' : 'linux',
    lanIp: lanIps[0] || '',
    lanIps,
    meshPort: LAN_MESH_PORT,
    authMode: sec.source,
    capabilities: ['ping', 'telemetry', 'list_files', 'read_file', 'shell', 'clipboard_sync', 'adb_bridge'],
    ts: Date.now(),
  });
}

function sendLanBroadcast(packetStr) {
  if (!lanDiscoverySocket) return;
  const buf = Buffer.from(packetStr, 'utf-8');
  const targets = new Set(['255.255.255.255']);
  for (const ip of getLanIpv4Addresses()) {
    const parts = ip.split('.');
    if (parts.length === 4) targets.add(parts[0] + '.' + parts[1] + '.' + parts[2] + '.255');
  }
  for (const addr of targets) {
    try {
      lanDiscoverySocket.send(buf, 0, buf.length, LAN_DISCOVERY_PORT, addr);
    } catch {}
  }
}

function triggerLanDiscoveryProbe() {
  if (!lanDiscoverySocket) return;
  sendLanBroadcast(buildLanBeaconPacket('aegis-mesh-probe'));
  sendLanBroadcast(buildLanBeaconPacket('aegis-mesh-v1'));
}

function startLanDiscovery() {
  const cfg = loadMeshConfig();
  if (cfg.lanDiscovery === false) return;
  try {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    lanDiscoverySocket = sock;
    sock.on('error', (err) => {
      lanDiscoveryActive = false;
      console.warn('[Aegis LAN Mesh] UDP discovery aviso:', err.message);
    });
    sock.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString('utf-8'));
        if (!data || (data.proto !== 'aegis-mesh-v1' && data.proto !== 'aegis-mesh-probe')) return;
        const myCfg = loadMeshConfig();
        const myId = cloudSelfId || myCfg.deviceId;
        if (!data.deviceId || data.deviceId === myId || data.deviceId === myCfg.deviceId) return;
        const peerIp = rinfo.address || data.lanIp || '';
        if (!peerIp || peerIp === '127.0.0.1') return;
        lanPeers.set(data.deviceId, {
          id: data.deviceId,
          name: String(data.name || data.deviceId).slice(0, 80),
          platform: String(data.platform || 'unknown'),
          lanIp: peerIp,
          meshPort: Number(data.meshPort || LAN_MESH_PORT),
          authMode: String(data.authMode || 'none'),
          capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
          lastSeen: Date.now(),
        });
        if (data.proto === 'aegis-mesh-probe') {
          const replyBuf = Buffer.from(buildLanBeaconPacket('aegis-mesh-v1'), 'utf-8');
          sock.send(replyBuf, 0, replyBuf.length, rinfo.port || LAN_DISCOVERY_PORT, peerIp);
        }
      } catch {}
    });
    sock.bind(LAN_DISCOVERY_PORT, () => {
      try { sock.setBroadcast(true); } catch {}
      lanDiscoveryActive = true;
      console.log('[Aegis LAN Mesh] Descoberta automática Wi-Fi/LAN ativa em UDP :' + LAN_DISCOVERY_PORT);
      triggerLanDiscoveryProbe();
      setInterval(() => {
        const now = Date.now();
        for (const [k, v] of lanPeers.entries()) {
          if (now - v.lastSeen > 35_000) lanPeers.delete(k);
        }
        sendLanBroadcast(buildLanBeaconPacket('aegis-mesh-v1'));
      }, 6000);
    });
  } catch (e) {
    console.warn('[Aegis LAN Mesh] Falha ao iniciar UDP discovery:', e.message);
  }
}

async function handleLocalMeshCommand(commandType, payload = {}, fromName = 'peer') {
  if (commandType === 'ping') {
    return {
      ok: true,
      output: {
        pong: true,
        hostname: os.hostname(),
        platform: IS_WIN ? 'windows' : 'linux',
        lanIps: getLanIpv4Addresses(),
        ts: Date.now(),
      },
    };
  }
  if (commandType === 'telemetry') {
    return {
      ok: true,
      output: {
        hostname: os.hostname(),
        platform: os.platform(),
        lanIps: getLanIpv4Addresses(),
        totalMemMb: Math.round(os.totalmem() / 1048576),
        freeMemMb: Math.round(os.freemem() / 1048576),
        uptimeSeconds: Math.round(os.uptime()),
      },
    };
  }
  if (commandType === 'clipboard_sync') {
    const txt = String(payload.text || '').slice(0, 32768);
    recentClipboard = { fromName, text: txt, receivedAt: new Date().toISOString(), transport: 'lan_p2p' };
    return { ok: true, output: { received: true, length: txt.length } };
  }
  if (commandType === 'list_files') {
    const dir = path.resolve(HOME, String(payload.path || '.'));
    const entries = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 120).map((e) => ({
      name: e.name,
      path: path.join(dir, e.name),
      type: e.isDirectory() ? 'directory' : 'file',
    }));
    return { ok: true, output: { path: dir, entries } };
  }
  if (commandType === 'read_file') {
    const fp = path.resolve(HOME, String(payload.path || ''));
    return { ok: true, output: { path: fp, content: fs.readFileSync(fp, 'utf-8').slice(0, 120000) } };
  }
  if (commandType === 'shell') {
    const cmd = String(payload.command || '').trim();
    if (!cmd) return { ok: false, error: 'Comando vazio.' };
    if (isDestructiveMeshShell(cmd)) {
      return { ok: false, error: 'Comando destrutivo bloqueado na execução automática de malha.' };
    }
    const out = await execNative(cmd, HOME);
    return { ok: true, output: out };
  }
  return { ok: false, error: 'Comando de malha não suportado no Desktop: ' + commandType };
}

function startLanMeshServer() {
  try {
    const mServer = http.createServer(async (req, res) => {
      const u = new URL(req.url || '/', 'http://127.0.0.1:' + LAN_MESH_PORT);
      if (u.pathname === '/mesh/info' && req.method === 'GET') {
        const cfg = loadMeshConfig();
        const sec = getEffectiveMeshSecret();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          deviceId: cloudSelfId || cfg.deviceId,
          name: os.hostname() + (IS_WIN ? ' (Windows)' : ' (Linux)'),
          platform: IS_WIN ? 'windows' : 'linux',
          lanIps: getLanIpv4Addresses(),
          meshPort: LAN_MESH_PORT,
          authRequired: true,
          authMode: sec.source,
        }));
      }
      if (u.pathname === '/mesh/exec' && req.method === 'POST') {
        let rawBody = '';
        for await (const chunk of req) {
          rawBody += chunk;
          if (rawBody.length > 512 * 1024) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: false, error: 'Payload excede limite.' }));
          }
        }
        const sec = getEffectiveMeshSecret();
        if (!sec.secret) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            ok: false,
            error: 'Defina uma Chave de Malha LAN compartilhada ou conecte a mesma conta Google em ambos os dispositivos.',
          }));
        }
        const tsHdr = String(req.headers['x-aegis-mesh-ts'] || '');
        const sigHdr = String(req.headers['x-aegis-mesh-sig'] || '');
        if (!verifyMeshHmac(sec.secret, tsHdr, sigHdr, rawBody)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Assinatura HMAC da Malha LAN inválida ou expirada.' }));
        }
        try {
          const parsed = JSON.parse(rawBody || '{}');
          const out = await handleLocalMeshCommand(String(parsed.commandType || ''), parsed.payload || {}, String(parsed.fromName || 'LAN Peer'));
          res.writeHead(out.ok ? 200 : 400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(out));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
    });
    lanMeshServer = mServer;
    mServer.on('error', (err) => {
      lanMeshServerActive = false;
      console.warn('[Aegis LAN P2P] Servidor TCP :' + LAN_MESH_PORT + ' aviso:', err.message);
    });
    mServer.listen(LAN_MESH_PORT, '0.0.0.0', () => {
      lanMeshServerActive = true;
      console.log('[Aegis LAN P2P] Canal direto autenticado (HMAC-SHA256) ativo em 0.0.0.0:' + LAN_MESH_PORT);
    });
  } catch (e) {
    console.warn('[Aegis LAN P2P] Erro ao iniciar servidor P2P:', e.message);
  }
}

async function sendLanP2pCommand(lanIp, meshPort, commandType, payload = {}) {
  const sec = getEffectiveMeshSecret();
  if (!sec.secret) {
    return {
      ok: false,
      error: 'Configure uma Chave de Malha LAN compartilhada (ou conecte o Google) para executar via Wi-Fi/LAN direto.',
    };
  }
  const bodyStr = JSON.stringify({
    fromId: cloudSelfId || loadMeshConfig().deviceId,
    fromName: os.hostname(),
    commandType,
    payload,
  });
  const ts = String(Date.now());
  const sig = computeMeshHmac(sec.secret, ts, bodyStr);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch('http://' + lanIp + ':' + (meshPort || LAN_MESH_PORT) + '/mesh/exec', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Aegis-Mesh-Ts': ts,
        'X-Aegis-Mesh-Sig': sig,
      },
      body: bodyStr,
      signal: controller.signal,
    });
    const data = await resp.json().catch(() => ({ ok: false, error: 'Resposta inválida do peer LAN.' }));
    return { ...data, transportUsed: 'lan_p2p' };
  } catch (err) {
    return { ok: false, error: 'Falha LAN P2P (' + lanIp + '): ' + err.message };
  } finally {
    clearTimeout(timer);
  }
}

function sendCloudPeerCommand(targetDeviceId, commandType, payload = {}) {
  return new Promise((resolve) => {
    if (!cloudRelaySocket || cloudRelaySocket.readyState !== 1) {
      return resolve({ ok: false, error: 'Nuvem WebSocket não conectada.' });
    }
    const requestId = 'p2p_' + crypto.randomBytes(6).toString('hex');
    const timer = setTimeout(() => {
      pendingPeerCommands.delete(requestId);
      resolve({ ok: false, error: 'Tempo esgotado no relay Nuvem WebSocket.' });
    }, 18000);
    pendingPeerCommands.set(requestId, (result) => {
      clearTimeout(timer);
      resolve({ ...result, transportUsed: 'cloud_ws' });
    });
    try {
      cloudRelaySocket.send(JSON.stringify({
        type: 'peer_command',
        requestId,
        targetDeviceId,
        commandType,
        payload,
      }));
    } catch (e) {
      clearTimeout(timer);
      pendingPeerCommands.delete(requestId);
      resolve({ ok: false, error: e.message });
    }
  });
}

function getUnifiedMeshPeers() {
  const map = new Map();

  for (const p of lanPeers.values()) {
    map.set(p.id, {
      id: p.id,
      name: p.name,
      platform: p.platform,
      status: 'online',
      lanIp: p.lanIp,
      meshPort: p.meshPort,
      adbSerial: '',
      transports: ['lan_p2p'],
      capabilities: p.capabilities || [],
      lastSeen: p.lastSeen,
    });
  }

  for (const p of cloudPeers.values()) {
    const existing = map.get(p.id);
    if (existing) {
      if (!existing.transports.includes('cloud_ws')) existing.transports.push('cloud_ws');
      if (!existing.lanIp && p.lanIp) existing.lanIp = p.lanIp;
      if (p.status === 'online') existing.status = 'online';
    } else {
      const transports = [];
      if (p.lanIp && p.meshPort) transports.push('lan_p2p');
      if (p.status === 'online') transports.push('cloud_ws');
      map.set(p.id, {
        id: p.id,
        name: p.name,
        platform: p.platform,
        status: p.status || 'offline',
        lanIp: p.lanIp || '',
        meshPort: p.meshPort || LAN_MESH_PORT,
        adbSerial: '',
        transports,
        capabilities: p.capabilities || [],
        lastSeen: p.lastSeenAt ? new Date(p.lastSeenAt).getTime() : Date.now(),
      });
    }
  }

  for (const a of adbPeersCache) {
    const adbId = 'adb:' + a.serial;
    const isWifi = a.serial.includes(':');
    const existingByModel = Array.from(map.values()).find(
      (x) => x.platform === 'android' && a.model && x.name.toLowerCase().includes(a.model.toLowerCase())
    );
    if (existingByModel) {
      existingByModel.adbSerial = a.serial;
      if (!existingByModel.transports.includes(isWifi ? 'adb_wifi' : 'adb_usb')) {
        existingByModel.transports.push(isWifi ? 'adb_wifi' : 'adb_usb');
      }
    } else {
      map.set(adbId, {
        id: adbId,
        name: a.model || a.serial,
        platform: 'android',
        status: 'online',
        lanIp: isWifi ? a.serial.split(':')[0] : '',
        meshPort: LAN_MESH_PORT,
        adbSerial: a.serial,
        transports: [isWifi ? 'adb_wifi' : 'adb_usb'],
        capabilities: ['shell', 'list_files', 'read_file', 'open_app', 'input_tap', 'input_keyevent'],
        lastSeen: Date.now(),
      });
    }
  }

  return Array.from(map.values());
}

async function execMeshPeerCommand(peerId, commandType, payload = {}, preferredTransport = '') {
  const peers = getUnifiedMeshPeers();
  const peer = peers.find((p) => p.id === peerId || (p.adbSerial && ('adb:' + p.adbSerial) === peerId));
  if (!peer) {
    return { ok: false, error: 'Dispositivo não localizado na malha atual. Clique em Escanear Malha.' };
  }

  const order = [];
  if (preferredTransport) order.push(preferredTransport);
  if (peer.lanIp && !order.includes('lan_p2p')) order.push('lan_p2p');
  if (peer.transports.includes('cloud_ws') && !order.includes('cloud_ws')) order.push('cloud_ws');
  if (peer.adbSerial && !order.includes('adb')) order.push('adb');

  const errors = [];
  for (const tr of order) {
    if (tr === 'lan_p2p' && peer.lanIp) {
      const r = await sendLanP2pCommand(peer.lanIp, peer.meshPort || LAN_MESH_PORT, commandType, payload);
      if (r.ok) return { ...r, peerId: peer.id, peerName: peer.name, transportUsed: 'lan_p2p' };
      errors.push('LAN P2P: ' + (r.error || 'falhou'));
    } else if (tr === 'cloud_ws' && !peer.id.startsWith('adb:')) {
      const r = await sendCloudPeerCommand(peer.id, commandType, payload);
      if (r.ok) return { ...r, peerId: peer.id, peerName: peer.name, transportUsed: 'cloud_ws' };
      errors.push('Nuvem WS: ' + (r.error || 'falhou'));
    } else if ((tr === 'adb' || tr === 'adb_usb' || tr === 'adb_wifi') && peer.adbSerial) {
      const r = await execAdbOnDesktop(peer.adbSerial, commandType === 'ping' ? 'shell' : commandType, commandType === 'ping' ? { command: 'echo pong && getprop ro.product.model' } : payload);
      if (r.ok) return { ...r, peerId: peer.id, peerName: peer.name, transportUsed: peer.adbSerial.includes(':') ? 'adb_wifi' : 'adb_usb' };
      errors.push('ADB: ' + (r.error || 'falhou'));
    }
  }

  return { ok: false, peerId: peer.id, error: 'Todos os transportes falharam (' + errors.join(' | ') + ')' };
}

async function broadcastMeshClipboard(text) {
  let delivered = 0;
  recentClipboard = { fromName: os.hostname() + ' (local)', text, receivedAt: new Date().toISOString(), transport: 'local' };
  const peers = getUnifiedMeshPeers();
  for (const p of peers) {
    if (p.lanIp) {
      const r = await sendLanP2pCommand(p.lanIp, p.meshPort || LAN_MESH_PORT, 'clipboard_sync', { text });
      if (r.ok) delivered++;
    }
  }
  if (cloudRelaySocket && cloudRelaySocket.readyState === 1) {
    try {
      cloudRelaySocket.send(JSON.stringify({ type: 'clipboard_broadcast', text }));
      delivered++;
    } catch {}
  }
  return delivered;
}

function getMeshStatusSnapshot() {
  const cfg = loadMeshConfig();
  const sec = getEffectiveMeshSecret();
  const cloud = loadCloudConnections();
  const settings = loadLocalSettings();
  return {
    selfId: cloudSelfId || cfg.deviceId,
    name: os.hostname() + (IS_WIN ? ' (Windows Desktop)' : ' (Linux Desktop)'),
    platform: IS_WIN ? 'windows' : 'linux',
    lanIps: getLanIpv4Addresses(),
    lanDiscoveryPort: LAN_DISCOVERY_PORT,
    lanMeshPort: LAN_MESH_PORT,
    meshKeyConfigured: Boolean(cfg.meshKey && cfg.meshKey.trim()),
    meshSecretSource: sec.source,
    googleEmail: cloud?.google?.email || null,
    cloudOrigin: process.env.AEGIS_CLOUD_URL || settings.cloudOrigin || '',
    transports: {
      lanDiscovery: lanDiscoveryActive,
      lanP2p: lanMeshServerActive,
      cloudWs: cloudRelayState,
      adbCount: adbPeersCache.length,
    },
    peers: getUnifiedMeshPeers(),
    recentClipboard,
  };
}

async function runAdbDesktop(args, timeout = 10000) {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    execFile('adb', args, { timeout, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, stdout: stdout || '', stderr: stderr || err.message });
      resolve({ ok: true, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function autoConnectWirelessAdb() {
  try {
    const mdns = await runAdbDesktop(['mdns', 'services'], 2500);
    if (!mdns.ok || !mdns.stdout) return;
    const lines = mdns.stdout.split('\\n');
    for (const line of lines) {
      if (!line.includes('_adb-tls-connect._tcp')) continue;
      const m = line.match(/(\\d{1,3}(?:\\.\\d{1,3}){3}:\\d{2,5})/);
      if (m && m[1]) {
        await runAdbDesktop(['connect', m[1]], 2500);
      }
    }
  } catch {}
}

async function listAdbDevicesDesktop() {
  await autoConnectWirelessAdb();
  const res = await runAdbDesktop(['devices', '-l'], 3500);
  if (!res.ok) return [];
  const lines = res.stdout.split('\\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('List of') && !l.startsWith('* daemon'));
  const devices = [];
  for (const line of lines) {
    const parts = line.split(/\\s+/);
    const serial = parts[0];
    if (!serial || parts[1] !== 'device' || !ADB_SERIAL_RE.test(serial)) continue;
    const model = (line.match(/model:([^\\s]+)/)?.[1] || serial).replace(/_/g, ' ');
    const batt = await runAdbDesktop(['-s', serial, 'shell', 'dumpsys', 'battery'], 3000);
    const df = await runAdbDesktop(['-s', serial, 'shell', 'df', '-h', '/sdcard'], 3000);
    const ver = await runAdbDesktop(['-s', serial, 'shell', 'getprop', 'ro.build.version.release'], 2000);
    const levelM = batt.stdout.match(/level:\\s*(\\d+)/);
    const statusM = batt.stdout.match(/status:\\s*(\\d+)/);
    devices.push({
      serial,
      model,
      telemetry: {
        batteryPercent: levelM ? Number(levelM[1]) : null,
        charging: statusM ? (statusM[1] === '2' || statusM[1] === '5') : null,
        androidVersion: ver.stdout.trim() || 'Android',
        connection: serial.includes(':') ? 'ADB Wireless' : 'ADB USB via ' + os.hostname(),
        serial,
      },
      storage: { raw: df.stdout.trim() },
    });
  }
  adbPeersCache = devices;
  return devices;
}

async function execAdbOnDesktop(serial, commandType, payload = {}) {
  if (!ADB_SERIAL_RE.test(serial)) return { ok: false, error: 'Serial ADB inválido.' };
  if (commandType === 'shell' || commandType === 'adb_shell') {
    const r = await runAdbDesktop(['-s', serial, 'shell', String(payload.command || '')], 15000);
    return { ok: r.ok, output: { stdout: r.stdout, stderr: r.stderr }, error: r.ok ? undefined : r.stderr };
  }
  if (commandType === 'list_files') {
    const dir = String(payload.path || '/sdcard').replace(/["\`$\\\\]/g, '');
    const r = await runAdbDesktop(['-s', serial, 'shell', 'ls -la "' + dir + '"'], 10000);
    return { ok: r.ok, output: { path: dir, entries: r.stdout.split('\\n').filter(Boolean).slice(0, 120), raw: r.stdout }, error: r.ok ? undefined : r.stderr };
  }
  if (commandType === 'read_file') {
    const fp = String(payload.path || '').replace(/["\`$\\\\]/g, '');
    const r = await runAdbDesktop(['-s', serial, 'shell', 'head -c 65536 "' + fp + '"'], 10000);
    return { ok: r.ok, output: { path: fp, content: r.stdout }, error: r.ok ? undefined : r.stderr };
  }
  if (commandType === 'open_app') {
    const pkg = String(payload.packageName || payload.app || '').replace(/[^a-zA-Z0-9._-]/g, '');
    const r = await runAdbDesktop(['-s', serial, 'shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], 8000);
    return { ok: r.ok, output: { packageName: pkg, stdout: r.stdout }, error: r.ok ? undefined : r.stderr };
  }
  if (commandType === 'input_tap') {
    const r = await runAdbDesktop(['-s', serial, 'shell', 'input', 'tap', String(Math.round(Number(payload.x || 0))), String(Math.round(Number(payload.y || 0)))], 6000);
    return { ok: r.ok, output: { tapped: true }, error: r.ok ? undefined : r.stderr };
  }
  if (commandType === 'input_text') {
    const txt = String(payload.text || '').replace(/\\s+/g, '%s').replace(/["\`$\\\\;&|]/g, '');
    const r = await runAdbDesktop(['-s', serial, 'shell', 'input', 'text', txt], 6000);
    return { ok: r.ok, output: { typed: payload.text }, error: r.ok ? undefined : r.stderr };
  }
  if (commandType === 'input_keyevent' || commandType === 'keyevent') {
    const key = String(payload.key || payload.keycode || 'KEYCODE_HOME').replace(/[^A-Z0-9_]/gi, '');
    const r = await runAdbDesktop(['-s', serial, 'shell', 'input', 'keyevent', key], 6000);
    return { ok: r.ok, output: { keyevent: key }, error: r.ok ? undefined : r.stderr };
  }
  if (commandType === 'list_packages') {
    const r = await runAdbDesktop(['-s', serial, 'shell', 'pm', 'list', 'packages', '-3'], 10000);
    return { ok: r.ok, output: { packages: r.stdout.split('\\n').map((l) => l.replace(/^package:/, '').trim()).filter(Boolean) }, error: r.ok ? undefined : r.stderr };
  }
  if (commandType === 'notifications') {
    const r = await runAdbDesktop(['-s', serial, 'shell', 'dumpsys', 'notification', '--noredact'], 8000);
    const titles = Array.from(r.stdout.matchAll(/android\\.title=([^\\n]+)/g)).map((m) => m[1].trim()).slice(0, 25);
    return { ok: r.ok, output: { titles }, error: r.ok ? undefined : r.stderr };
  }
  return { ok: false, error: 'Comando ADB não suportado: ' + commandType };
}

let cloudRelaySocket = null;
let cloudReconnectTimer = null;
function startCloudRelay() {
  if (cloudReconnectTimer) { clearTimeout(cloudReconnectTimer); cloudReconnectTimer = null; }
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(CLOUD_BRIDGE_FILE, 'utf-8')); } catch {}
  const localSettings = loadLocalSettings();
  const cloudConns = loadCloudConnections();
  const cloudUrl = process.env.AEGIS_CLOUD_URL || cfg?.cloudUrl || localSettings.cloudOrigin || '';
  const pairCode = process.env.AEGIS_PAIR_CODE || cfg?.pairingCode || '';
  const token = process.env.AEGIS_DEVICE_TOKEN || cfg?.token || '';
  const googleToken = cloudConns?.google?.token || '';
  if (!cloudUrl || !globalThis.WebSocket) {
    cloudRelayState = 'unconfigured';
    return;
  }
  if (!token && !pairCode && !googleToken) {
    cloudRelayState = 'awaiting_auth';
    return;
  }
  const wsBase = cloudUrl.replace(/^http:\\/\\//i, 'ws://').replace(/^https:\\/\\//i, 'wss://').replace(/\\/$/, '');
  const fullWs = wsBase + '/api/devices/ws' + (token ? '?token=' + encodeURIComponent(token) : '');
  try { cloudRelaySocket?.close(); } catch {}
  cloudRelayState = 'connecting';
  const ws = new globalThis.WebSocket(fullWs);
  cloudRelaySocket = ws;
  let adbTimer = null;

  ws.addEventListener('open', async () => {
    cloudRelayState = 'online';
    console.log('[Aegis Cloud Mesh] Conectado à nuvem:', wsBase);
    const lanIps = getLanIpv4Addresses();
    const baseTelemetry = {
      hostname: os.hostname(),
      platform: os.platform(),
      lanIp: lanIps[0] || '',
      lanIps,
      meshPort: LAN_MESH_PORT,
      totalMemMb: Math.round(os.totalmem() / 1048576),
      freeMemMb: Math.round(os.freemem() / 1048576),
    };
    if (!token && pairCode) {
      ws.send(JSON.stringify({
        type: 'pair',
        pairingCode: pairCode,
        name: os.hostname() + (IS_WIN ? ' (Windows Desktop)' : ' (Linux Desktop)'),
        platform: IS_WIN ? 'windows' : 'linux',
        transport: 'desktop_ws',
        capabilities: ['ping', 'shell', 'list_files', 'read_file', 'adb_bridge', 'lan_p2p', 'clipboard_sync'],
        telemetry: baseTelemetry,
      }));
    } else if (!token && googleToken) {
      ws.send(JSON.stringify({
        type: 'account_pair',
        googleAccessToken: googleToken,
        serialOrUid: loadMeshConfig().deviceId,
        name: os.hostname() + (IS_WIN ? ' (Windows Desktop)' : ' (Linux Desktop)'),
        platform: IS_WIN ? 'windows' : 'linux',
        transport: 'desktop_ws',
        capabilities: ['ping', 'shell', 'list_files', 'read_file', 'adb_bridge', 'lan_p2p', 'clipboard_sync'],
        telemetry: baseTelemetry,
      }));
    } else {
      ws.send(JSON.stringify({ type: 'telemetry', telemetry: baseTelemetry }));
      ws.send(JSON.stringify({ type: 'get_peers' }));
      const adbList = await listAdbDevicesDesktop();
      ws.send(JSON.stringify({ type: 'adb_devices', devices: adbList }));
    }
    adbTimer = setInterval(async () => {
      if (ws.readyState === 1) {
        const curIps = getLanIpv4Addresses();
        ws.send(JSON.stringify({
          type: 'telemetry',
          telemetry: {
            hostname: os.hostname(),
            lanIp: curIps[0] || '',
            lanIps: curIps,
            meshPort: LAN_MESH_PORT,
            totalMemMb: Math.round(os.totalmem() / 1048576),
            freeMemMb: Math.round(os.freemem() / 1048576),
            uptimeSeconds: Math.round(os.uptime()),
          },
        }));
        const adbList = await listAdbDevicesDesktop();
        ws.send(JSON.stringify({ type: 'adb_devices', devices: adbList }));
      }
    }, 15000);
  });

  ws.addEventListener('message', async (ev) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if ((msg.type === 'paired' || msg.type === 'authenticated') && (msg.token || msg.deviceId)) {
        if (msg.deviceId) cloudSelfId = String(msg.deviceId);
        if (msg.token) {
          fs.writeFileSync(CLOUD_BRIDGE_FILE, JSON.stringify({ cloudUrl, token: msg.token, deviceId: msg.deviceId }, null, 2), { mode: 0o600 });
        }
        ws.send(JSON.stringify({ type: 'get_peers' }));
        const adbList = await listAdbDevicesDesktop();
        ws.send(JSON.stringify({ type: 'adb_devices', devices: adbList }));
      } else if (msg.type === 'mesh_peers' && Array.isArray(msg.peers)) {
        if (msg.selfId) cloudSelfId = String(msg.selfId);
        cloudPeers.clear();
        for (const p of msg.peers) {
          if (p && p.id && p.id !== cloudSelfId) {
            cloudPeers.set(p.id, p);
          }
        }
      } else if (msg.type === 'peer_command_result' && msg.requestId) {
        const cb = pendingPeerCommands.get(msg.requestId);
        if (cb) {
          pendingPeerCommands.delete(msg.requestId);
          cb({ ok: Boolean(msg.ok), output: msg.output, error: msg.error });
        }
      } else if (msg.type === 'clipboard_sync' && msg.text) {
        recentClipboard = {
          fromName: String(msg.fromName || 'Outro Dispositivo'),
          text: String(msg.text).slice(0, 32768),
          receivedAt: new Date().toISOString(),
          transport: 'cloud_ws',
        };
      } else if (msg.type === 'adb_exec') {
        const resAdb = await execAdbOnDesktop(msg.serial, msg.commandType, msg.payload || {});
        ws.send(JSON.stringify({ type: 'command_result', commandId: msg.commandId, ok: resAdb.ok, output: resAdb.output, error: resAdb.error }));
      } else if (msg.type === 'exec_command' || msg.type === 'command') {
        try {
          const out = await handleLocalMeshCommand(String(msg.commandType || ''), msg.payload || {}, 'Aegis Mesh');
          ws.send(JSON.stringify({ type: 'command_result', commandId: msg.commandId, ok: out.ok, output: out.output, error: out.error }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'command_result', commandId: msg.commandId, ok: false, error: err.message }));
        }
      }
    } catch {}
  });

  ws.addEventListener('close', () => {
    if (adbTimer) clearInterval(adbTimer);
    cloudRelayState = 'reconnecting';
    cloudReconnectTimer = setTimeout(startCloudRelay, 8000);
  });

  ws.addEventListener('error', () => {
    cloudRelayState = 'reconnecting';
  });
}

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.log('[Aegis Daemon] Porta 127.0.0.1:' + PORT + ' já está em uso (outra instância ativa).');
    process.exit(0);
  }
  console.error('[Aegis Daemon] Erro ao abrir servidor:', err);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[' + new Date().toISOString() + '] Aegis Desktop Daemon v2.1.0 ativo em http://127.0.0.1:' + PORT + ' (Malha Automática: LAN UDP/P2P + Nuvem WS + ADB USB/Wi-Fi)');
  startLanDiscovery();
  startLanMeshServer();
  startCloudRelay();
  void listAdbDevicesDesktop();
});
`;

const AEGIS_CLI_MJS = `#!/usr/bin/env node
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';

const DAEMON_URL = process.env.AEGIS_URL || 'http://127.0.0.1:3847';
const CLI_TOKEN_FILE = path.join(os.homedir(), '.local', 'share', 'aegis', '.cli_token');
const args = process.argv.slice(2);

function getToken() {
  try { return fs.readFileSync(CLI_TOKEN_FILE, 'utf-8').trim(); } catch { return ''; }
}

if (args.includes('--ui')) {
  console.log('Abrindo interface local em ' + DAEMON_URL + ' ...');
  exec('xdg-open "' + DAEMON_URL + '"');
  process.exit(0);
}

async function askConfirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('\\x1b[33m[CONFIRMAÇÃO] ' + question + ' (s/N): \\x1b[0m', (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase() === 's' || ans.trim().toLowerCase() === 'y');
    });
  });
}

async function sendPrompt(prompt) {
  const headers = { 'Content-Type': 'application/json', 'X-Aegis-Local-Token': getToken() };
  const res = await fetch(DAEMON_URL + '/command', {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json();
  if (data.error) {
    console.error('\\x1b[31mErro:\\x1b[0m', data.error);
    return;
  }
  if (data.usage) {
    console.log('\\x1b[90m[' + data.usage.model + ' · ' + data.usage.totalTokens + ' tokens · ' + data.usage.latencyMs + 'ms]\\x1b[0m');
  }
  if (data.reply) console.log('\\n\\x1b[36mAegis:\\x1b[0m', data.reply);
  for (const out of data.outputs || []) {
    console.log('\\x1b[90m[' + out.tool + ']\\x1b[0m', out.stdout || JSON.stringify(out));
  }
  for (const pending of data.pendingConfirmations || []) {
    const ok = await askConfirm('Executar "' + pending.command + '"?');
    if (ok) {
      const execRes = await fetch(DAEMON_URL + '/command', {
        method: 'POST',
        headers,
        body: JSON.stringify(pending.type === 'web_login' ? { confirmedWebLogin: pending.payload } : { confirmedCommand: pending.command }),
      });
      const execData = await execRes.json();
      if (execData.summary) console.log('\\n\\x1b[36mResumo:\\x1b[0m', execData.summary);
      console.log('\\x1b[32mSaída:\\x1b[0m', execData.stdout || execData.stderr || 'OK');
    } else {
      console.log('Cancelado.');
    }
  }
}

if (args.includes('--memory')) {
  const res = await fetch(DAEMON_URL + '/memory', { headers: { 'X-Aegis-Local-Token': getToken() } });
  const data = await res.json();
  console.log('\\x1b[36mMemória Persistente Local:\\x1b[0m');
  for (const f of data.facts || []) console.log(' -', f.content);
  process.exit(0);
}

if (args.includes('--chat') || args.length === 0) {
  console.log('\\x1b[36mAegis Terminal Minimalista (Linux)\\x1b[0m — digite "sair" para encerrar.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '\\n\\x1b[36maegis>\\x1b[0m ' });
  rl.prompt();
  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return rl.prompt();
    if (trimmed === 'sair' || trimmed === 'exit') process.exit(0);
    await sendPrompt(trimmed);
    rl.prompt();
  });
} else {
  await sendPrompt(args.join(' '));
}
`;

const AEGIS_SERVICE = `[Unit]
Description=Aegis Local Linux AI Assistant Daemon
After=network-online.target

[Service]
Type=simple
EnvironmentFile=-%h/.config/aegis/env
ExecStart=%h/.local/share/aegis/bin/node %h/.local/share/aegis/aegis-daemon.mjs
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`;

const AEGIS_DESKTOP = `[Desktop Entry]
Name=Aegis Janela de Comando
Comment=Assistente pessoal IA Linux
Exec=xdg-open http://127.0.0.1:3847
Icon=utilities-terminal
Terminal=false
Type=Application
Categories=Utility;System;
`;

const LOCAL_UI_HTML = getLocalHoloUiHtml({
  platformMode: 'desktop',
  appVersion: '2.1.0',
  defaultCloudOrigin: process.env.APP_URL || 'https://ais-pre-gamd6ug3axhvddvr55mbne-702819737353.us-east1.run.app',
});

const README_MD = `# Aegis — Assistente Local Linux + Google Workspace

## Instalação Rápida (Ubuntu, Debian, Arch, Fedora)

\`\`\`bash
chmod +x ~/Downloads/aegis-setup.sh && ~/Downloads/aegis-setup.sh
\`\`\`

## Uso via Terminal & HUD Desktop

- Interface Gráfica Desktop (HUD unificada): http://127.0.0.1:3847 (ou \`aegis --ui\`)
- Sessão interativa minimalista: \`aegis --chat\`
- Comando direto: \`aegis "verifique o espaço em disco e me explique"\`
- Consultar memória persistente: \`aegis --memory\`
`;

export function getLinuxBundleFiles(): BundleFile[] {
  return [
    {
      name: 'install.sh',
      pathInPackage: 'install.sh',
      language: 'bash',
      description: 'Instalador automático Linux com runtime isolado Node.js v22, systemd --user e binário CLI `aegis`.',
      content: INSTALL_SH,
    },
    {
      name: 'install-windows.ps1',
      pathInPackage: 'install-windows.ps1',
      language: 'powershell',
      description: 'Instalador PowerShell para Windows 10/11 (Node.js LTS, acesso total PowerShell/FS, tarefa agendada no logon e CLI aegis).',
      content: INSTALL_WINDOWS_PS1,
    },
    {
      name: 'start-aegis.bat',
      pathInPackage: 'start-aegis.bat',
      language: 'batch',
      description: 'Inicializador direto de um clique para Windows.',
      content: START_AEGIS_BAT,
    },
    {
      name: 'aegis-daemon.mjs',
      pathInPackage: 'aegis-daemon.mjs',
      language: 'javascript',
      description: 'Daemon multiplataforma (Linux Bash + Windows PowerShell) na porta 3847 com acesso irrestrito ao sistema, guarda destrutiva, telas desenhadas e Cofre AES-256.',
      content: AEGIS_DAEMON_MJS,
    },
    {
      name: 'aegis-cli.mjs',
      pathInPackage: 'aegis-cli.mjs',
      language: 'javascript',
      description: 'CLI minimalista (`aegis --chat`, `aegis --ui`, `aegis --memory`) autenticado localmente.',
      content: AEGIS_CLI_MJS,
    },
    {
      name: 'ui.html',
      pathInPackage: 'ui.html',
      language: 'html',
      description: 'HUD Desktop Linux & Windows com comandos, visualizador/editor embutido, Navegação Web, Telemetria IA e Google Drive.',
      content: LOCAL_UI_HTML,
    },
    {
      name: 'aegis.service',
      pathInPackage: 'aegis.service',
      language: 'ini',
      description: 'Unidade systemd --user para inicialização automática com a sessão Linux.',
      content: AEGIS_SERVICE,
    },
    {
      name: 'aegis.desktop',
      pathInPackage: 'aegis.desktop',
      language: 'ini',
      description: 'Atalho de aplicativo desktop para GNOME, KDE, Rofi e Wofi.',
      content: AEGIS_DESKTOP,
    },
    {
      name: 'package.json',
      pathInPackage: 'package.json',
      language: 'json',
      description: 'Manifesto de dependências do daemon local (@google/genai e cheerio).',
      content: PACKAGE_JSON_LINUX,
    },
    {
      name: 'README.md',
      pathInPackage: 'README.md',
      language: 'markdown',
      description: 'Guia completo de instalação e comandos para Linux e Windows.',
      content: README_MD,
    },
  ];
}

export async function buildLinuxBundleZip(): Promise<Buffer> {
  const zip = new JSZip();
  const files = getLinuxBundleFiles();
  for (const file of files) {
    zip.file(file.pathInPackage, file.content, {
      unixPermissions: file.name === 'install.sh' || file.name === 'aegis-cli.mjs' ? '755' : '644',
    });
  }
  return zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' });
}

export function getInstallScriptText(): string {
  return INSTALL_SH;
}

export function getWindowsInstallScriptText(): string {
  return INSTALL_WINDOWS_PS1;
}

export function getWindowsLauncherBatText(): string {
  return START_AEGIS_BAT;
}
