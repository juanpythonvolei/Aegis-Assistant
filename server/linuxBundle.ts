import JSZip from 'jszip';

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
  const tok = req.headers['x-aegis-local-token'];
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
  return {
    models: {
      async generateContent({ model, contents, config = {} }) {
        loadLocalEnvFiles();
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error('GEMINI_API_KEY não definida. Adicione em ~/.config/aegis/env e reinicie o Aegis Desktop.');
        }
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
        const body = { contents: normalizeGeminiContents(contents) };
        if (config.systemInstruction) {
          body.systemInstruction = { parts: [{ text: String(config.systemInstruction) }] };
        }
        if (Array.isArray(config.tools) && config.tools.length > 0) {
          body.tools = config.tools;
        }
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'aegis-desktop-native/2.1.0' },
          body: JSON.stringify(body),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(data.error?.message || ('Gemini API HTTP ' + r.status));
        }
        const parts = data.candidates?.[0]?.content?.parts || [];
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
          functionCalls,
          candidates: data.candidates || [],
          usageMetadata: data.usageMetadata || null,
        };
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

  if (pathname === '/health') {
    const cloud = loadCloudConnections();
    const gCache = loadGoogleSyncCache();
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
    return sendJson(res, 200, {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      uptimeSeconds: Math.floor(os.uptime()),
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model || 'Linux CPU',
      totalMemMb: Math.round(os.totalmem() / 1048576),
      freeMemMb: Math.round(os.freemem() / 1048576),
      loadAvg: os.loadavg().map((n) => Number(n.toFixed(2))),
      homeDir: HOME,
      diskUsage,
      diskPct,
    });
  }

  if (pathname === '/usage' && req.method === 'GET') {
    const logs = readJsonLines(USAGE_FILE, 200);
    const byModelMap = {};
    let promptTokens = 0, outputTokens = 0, totalTokens = 0, latencySum = 0;
    for (const l of logs) {
      promptTokens += l.promptTokens || 0;
      outputTokens += l.outputTokens || 0;
      totalTokens += l.totalTokens || 0;
      latencySum += l.latencyMs || 0;
      if (!byModelMap[l.model]) byModelMap[l.model] = { model: l.model, requests: 0, totalTokens: 0 };
      byModelMap[l.model].requests += 1;
      byModelMap[l.model].totalTokens += l.totalTokens || 0;
    }
    return sendJson(res, 200, {
      totals: {
        requests: logs.length,
        promptTokens,
        outputTokens,
        totalTokens,
        avgLatencyMs: logs.length ? Math.round(latencySum / logs.length) : 0,
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

  if (pathname === '/command' && req.method === 'POST') {
    const t0 = Date.now();
    const { prompt, confirmedCommand, confirmedWebLogin, confirmedGoogleUpload, modelPreference = 'auto', googleEmail } = await readBody(req);
    const authHeader = req.headers.authorization || '';
    const bearerTok = /^Bearer\\s+(.+)$/i.test(authHeader) ? authHeader.replace(/^Bearer\\s+/i, '').trim() : '';

    if (bearerTok) {
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

      appendJsonLine(MEMORY_FILE, { role: 'user', content: prompt });
      const route = selectModel(prompt, modelPreference);
      const curatorModel = route.model === 'gemini-3.1-flash-lite' && modelPreference === 'auto' && String(prompt || '').trim().length > 24
        ? 'gemini-4-hydrogen'
        : route.model;
      let activeModel = curatorModel;
      let fallbackUsed = false;
      const facts = loadFacts().slice(0, 6).map((f) => f.content.slice(0, 140)).join('\\n- ');
      const cloud = loadCloudConnections();
      const gCache = loadGoogleSyncCache();

      const thinkingTrace = [];
      const addTrace = (kind, title, detail, model, role) => {
        thinkingTrace.push({ id: 'lt_' + Date.now() + '_' + thinkingTrace.length, kind, title, detail, model, role, timestamp: new Date().toISOString() });
      };

      const pendingConfirmations = [];
      const outputs = [];
      const screens = [];
      const steps = [];
      let promptTokens = 0, outputTokens = 0, totalTokens = 0;

      const googleContextSummary = cloud.google?.token
        ? 'Conectado (' + cloud.google.email + ') · Última sync: ' + (gCache.lastSyncAt || 'agora') + ' · Cache: ' + (gCache.drive?.length || 0) + ' arq Drive, ' + (gCache.gmail?.length || 0) + ' e-mails, ' + (gCache.calendar?.length || 0) + ' eventos, ' + (gCache.tasks?.length || 0) + ' tarefas.'
        : 'Desconectado';

      const executeLocalTool = async (call) => {
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
              toolResult = { ok: false, error: 'Google não sincronizado no daemon local. Sincronize sua conta Google no painel Aegis.' };
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
              toolResult = { ok: false, error: 'Google não sincronizado no daemon local.' };
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
        addTrace('tool', call.name, status === 'executed' ? 'Executado localmente com sucesso.' : (toolResult.error || 'Aguardando confirmação'), activeModel, 'worker');
        return { functionResponse: { id: call.id, name: call.name, response: toolResult } };
      };

      // STAGE 1: Lightweight Local Worker ("Trabalho Bruto" with Flash Lite) + Smart Curation Gating
      let workerDossier = '';
      const trimmedPrompt = String(prompt || '').trim();
      const isTrivial = /^(oi|olá|ola|bom dia|boa tarde|boa noite|ok|obrigado|valeu|ping|teste)[\\s!?.]*$/i.test(trimmedPrompt);
      const needsToolHint = /(arquivo|pasta|home|download|disco|cpu|ram|memória|memoria|processo|serviço|servico|comando|terminal|bash|exec|abrir|abre|site|url|http|login|drive|gmail|email|e-mail|agenda|calendário|calendario|tarefa|tasks|android|adb|google|sincron)/i.test(trimmedPrompt);

      // Direct ultra-economical turn for simple conversational questions (no tools, no curator overhead)
      if ((isTrivial || (route.tier === 'lite' && !needsToolHint && trimmedPrompt.length <= 160)) && modelPreference === 'auto') {
        const directRes = await getAiClient().models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: [{ role: 'user', parts: [{ text: trimmedPrompt }] }],
          config: {
            systemInstruction: 'Você é o Aegis Local em ' + os.hostname() + '. Responda em Português de forma direta e concisa.',
          },
        });
        if (directRes.usageMetadata) {
          promptTokens += directRes.usageMetadata.promptTokenCount || 0;
          outputTokens += directRes.usageMetadata.candidatesTokenCount || 0;
          totalTokens += directRes.usageMetadata.totalTokenCount || 0;
        }
        const replyText = (directRes.text || 'Pronto.').trim();
        const latencyMs = Date.now() - t0;
        const usageEntry = {
          model: 'gemini-3.1-flash-lite',
          routingMode: 'auto',
          routingReason: 'Resposta direta econômica (sem curadoria extra)',
          complexityTier: 'lite',
          promptTokens,
          outputTokens,
          thoughtsTokens: 0,
          totalTokens,
          latencyMs,
          fallbackUsed: false,
          workerModels: [],
          curatorModel: 'gemini-3.1-flash-lite',
          subtasksCount: 0,
        };
        appendJsonLine(USAGE_FILE, usageEntry);
        appendJsonLine(MEMORY_FILE, { role: 'assistant', content: replyText, outputs, usage: usageEntry });
        return sendJson(res, 200, { reply: replyText, steps, outputs, screens, pendingConfirmations, usage: usageEntry, thinkingTrace });
      }

      let workerHadErrors = false;
      if (!isTrivial) {
        addTrace('plan', 'Orquestração Local (Trabalhador → Curadoria Inteligente)', 'Subagente Flash Lite executando coleta local/Google; curadoria acionada apenas se necessário', 'gemini-3.1-flash-lite', 'decomposer');
        const workerContents = [{ role: 'user', parts: [{ text: 'Execute a coleta/ação local ou Google para atender:\\n' + trimmedPrompt }] }];
        for (let wHop = 0; wHop < 2; wHop++) {
          const wRes = await getAiClient().models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: workerContents,
            config: {
              systemInstruction: 'Você é o Subagente Trabalhador Local do Aegis em ' + os.hostname() + ' (' + os.platform() + '). Google: ' + googleContextSummary + '. Execute ferramentas necessárias e responda de forma clara e factual em Português.',
              tools,
            },
          });
          if (wRes.usageMetadata) {
            promptTokens += wRes.usageMetadata.promptTokenCount || 0;
            outputTokens += wRes.usageMetadata.candidatesTokenCount || 0;
            totalTokens += wRes.usageMetadata.totalTokenCount || 0;
          }
          const wCalls = wRes.functionCalls || [];
          if (wCalls.length === 0) {
            workerDossier = (wRes.text || '').trim().slice(0, 2200);
            addTrace('subagent', 'Trabalhador Local Concluído', workerDossier.slice(0, 180) || 'Coleta finalizada.', 'gemini-3.1-flash-lite', 'worker');
            break;
          }
          if (wRes.candidates?.[0]?.content) workerContents.push(wRes.candidates[0].content);
          const fnParts = await Promise.all(wCalls.map((c) => executeLocalTool(c)));
          workerContents.push({ role: 'user', parts: fnParts });
        }
        workerHadErrors = steps.some((s) => s.status === 'error');
      }

      // SMART CURATION GATE: skip redundant Senior Curator when Flash Lite already succeeded cleanly on a modest task
      const canSkipCurator =
        modelPreference === 'auto' &&
        Boolean(workerDossier) &&
        !workerHadErrors &&
        pendingConfirmations.length === 0 &&
        (route.tier === 'lite' || (route.tier === 'balanced' && trimmedPrompt.length <= 160 && steps.length <= 2));

      if (canSkipCurator) {
        addTrace('curator', 'Curadoria dispensada (economia de tokens)', 'O trabalhador Flash Lite concluiu a demanda limpa sem erros; curadoria sênior não foi necessária.', 'gemini-3.1-flash-lite', 'curator');
        const latencyMs = Date.now() - t0;
        const usageEntry = {
          model: 'gemini-3.1-flash-lite',
          routingMode: 'auto',
          routingReason: 'Local (' + os.hostname() + ') · Curadoria dispensada (entrega limpa pelo trabalhador)',
          complexityTier: route.tier,
          promptTokens,
          outputTokens,
          thoughtsTokens: 0,
          totalTokens,
          latencyMs,
          fallbackUsed: false,
          workerModels: ['gemini-3.1-flash-lite'],
          curatorModel: 'gemini-3.1-flash-lite',
          subtasksCount: 1,
        };
        appendJsonLine(USAGE_FILE, usageEntry);
        appendJsonLine(MEMORY_FILE, { role: 'assistant', content: workerDossier, outputs, usage: usageEntry });
        return sendJson(res, 200, { reply: workerDossier, steps, outputs, screens, pendingConfirmations, usage: usageEntry, thinkingTrace });
      }

      // Right-size curator model if worker returned clean data
      if (modelPreference === 'auto' && !workerHadErrors && activeModel === 'gemini-4-argon' && steps.length <= 2) {
        activeModel = 'gemini-4-hydrogen';
      }

      // STAGE 2: Senior Curator Synthesis & Verification (only when truly needed)
      addTrace('curator', 'Curadoria Sênior Local', 'Auditando dados locais e Google Workspace com ' + activeModel, activeModel, 'curator');
      const systemInstruction = 'Você é o Aegis Local em ' + os.hostname() + ' (' + (IS_WIN ? 'Windows' : 'Linux') + '). Google: ' + googleContextSummary + '. Pasta sync: ' + GOOGLE_SYNC_DIR + '. Responda objetivamente em Português.\\nMemória:\\n- ' + facts;

      const curatorPrompt = workerDossier
        ? 'Solicitação:\\n' + trimmedPrompt + '\\n\\n[DOSSIÊ LOCAL]\\n' + workerDossier + '\\n\\nRevise e entregue a resposta final polida (use ferramentas extras apenas se faltar algo).'
        : trimmedPrompt;

      const contents = [{ role: 'user', parts: [{ text: curatorPrompt }] }];

      for (let hop = 0; hop < 4; hop++) {
        let response;
        try {
          response = await getAiClient().models.generateContent({
            model: activeModel,
            contents,
            config: { systemInstruction, tools },
          });
        } catch (err) {
          if (activeModel !== 'gemini-4-hydrogen' && activeModel !== 'gemini-3.1-flash-lite' && !fallbackUsed) {
            activeModel = 'gemini-4-hydrogen';
            fallbackUsed = true;
            response = await getAiClient().models.generateContent({
              model: activeModel,
              contents,
              config: { systemInstruction, tools },
            });
          } else {
            throw err;
          }
        }

        if (response.usageMetadata) {
          promptTokens += response.usageMetadata.promptTokenCount || 0;
          outputTokens += response.usageMetadata.candidatesTokenCount || 0;
          totalTokens += response.usageMetadata.totalTokenCount || 0;
        }

        const calls = response.functionCalls || [];
        if (calls.length === 0) {
          const replyText = (response.text || 'Operação concluída.').trim();
          const latencyMs = Date.now() - t0;
          const usageEntry = {
            model: activeModel,
            routingMode: route.mode,
            routingReason: 'Operação Local (' + os.hostname() + ') · ' + route.reason,
            complexityTier: route.tier,
            promptTokens,
            outputTokens,
            thoughtsTokens: 0,
            totalTokens,
            latencyMs,
            fallbackUsed,
            workerModels: isTrivial ? [] : ['gemini-3.1-flash-lite'],
            curatorModel: activeModel,
            subtasksCount: isTrivial ? 0 : 1,
          };
          appendJsonLine(USAGE_FILE, usageEntry);
          appendJsonLine(MEMORY_FILE, { role: 'assistant', content: replyText, outputs, usage: usageEntry });
          return sendJson(res, 200, { reply: replyText, steps, outputs, screens, pendingConfirmations, usage: usageEntry, thinkingTrace });
        }

        if (response.candidates?.[0]?.content) contents.push(response.candidates[0].content);
        const fnParts = await Promise.all(calls.map((c) => executeLocalTool(c)));
        contents.push({ role: 'user', parts: fnParts });
      }

      const latencyMs = Date.now() - t0;
      const usageEntry = { model: activeModel, routingMode: route.mode, routingReason: route.reason, complexityTier: route.tier, promptTokens, outputTokens, thoughtsTokens: 0, totalTokens, latencyMs, fallbackUsed, workerModels: isTrivial ? [] : ['gemini-3.1-flash-lite'], curatorModel: activeModel, subtasksCount: isTrivial ? 0 : 1 };
      appendJsonLine(USAGE_FILE, usageEntry);
      return sendJson(res, 200, { reply: 'Processamento local concluído.', steps, outputs, screens, pendingConfirmations, usage: usageEntry, thinkingTrace });
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

  res.writeHead(404);
  res.end('Not Found');
});

// ==========================================
// DESKTOP ADB BRIDGE & AEGIS CLOUD RELAY
// ==========================================
const CLOUD_BRIDGE_FILE = path.join(DATA_DIR, 'cloud_bridge.json');
const ADB_SERIAL_RE = /^[a-zA-Z0-9._:-]{1,64}$/;

async function runAdbDesktop(args, timeout = 10000) {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    execFile('adb', args, { timeout, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, stdout: stdout || '', stderr: stderr || err.message });
      resolve({ ok: true, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function listAdbDevicesDesktop() {
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
  if (commandType === 'input_keyevent') {
    const key = String(payload.key || 'KEYCODE_HOME').replace(/[^A-Z0-9_]/gi, '');
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
function startCloudRelay() {
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(CLOUD_BRIDGE_FILE, 'utf-8')); } catch {}
  const cloudUrl = process.env.AEGIS_CLOUD_URL || cfg?.cloudUrl || '';
  const pairCode = process.env.AEGIS_PAIR_CODE || cfg?.pairingCode || '';
  const token = process.env.AEGIS_DEVICE_TOKEN || cfg?.token || '';
  if (!cloudUrl || !globalThis.WebSocket) return;
  const wsBase = cloudUrl.replace(/^http:\\/\\//i, 'ws://').replace(/^https:\\/\\//i, 'wss://').replace(/\\/$/, '');
  const fullWs = wsBase + '/api/devices/ws' + (token ? '?token=' + encodeURIComponent(token) : '');
  try { cloudRelaySocket?.close(); } catch {}
  const ws = new globalThis.WebSocket(fullWs);
  cloudRelaySocket = ws;
  let adbTimer = null;

  ws.addEventListener('open', async () => {
    console.log('[Aegis Cloud Relay] Conectado à nuvem:', wsBase);
    if (!token && pairCode) {
      ws.send(JSON.stringify({
        type: 'pair',
        pairingCode: pairCode,
        name: os.hostname() + (IS_WIN ? ' (Windows Desktop)' : ' (Linux Desktop)'),
        platform: IS_WIN ? 'windows' : 'linux',
        transport: 'desktop_ws',
        capabilities: ['shell', 'list_files', 'read_file', 'adb_bridge'],
        telemetry: { hostname: os.hostname(), platform: os.platform(), totalMemMb: Math.round(os.totalmem() / 1048576), freeMemMb: Math.round(os.freemem() / 1048576) },
      }));
    } else {
      const adbList = await listAdbDevicesDesktop();
      ws.send(JSON.stringify({ type: 'adb_devices', devices: adbList }));
    }
    adbTimer = setInterval(async () => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'telemetry',
          telemetry: { hostname: os.hostname(), totalMemMb: Math.round(os.totalmem() / 1048576), freeMemMb: Math.round(os.freemem() / 1048576), uptimeSeconds: Math.round(os.uptime()) },
        }));
        const adbList = await listAdbDevicesDesktop();
        ws.send(JSON.stringify({ type: 'adb_devices', devices: adbList }));
      }
    }, 15000);
  });

  ws.addEventListener('message', async (ev) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === 'paired' && msg.token) {
        fs.writeFileSync(CLOUD_BRIDGE_FILE, JSON.stringify({ cloudUrl, token: msg.token, deviceId: msg.deviceId }, null, 2), { mode: 0o600 });
        const adbList = await listAdbDevicesDesktop();
        ws.send(JSON.stringify({ type: 'adb_devices', devices: adbList }));
      } else if (msg.type === 'adb_exec') {
        const resAdb = await execAdbOnDesktop(msg.serial, msg.commandType, msg.payload || {});
        ws.send(JSON.stringify({ type: 'command_result', commandId: msg.commandId, ok: resAdb.ok, output: resAdb.output, error: resAdb.error }));
      } else if (msg.type === 'exec_command') {
        try {
          if (msg.commandType === 'shell') {
            const out = await execNative(String(msg.payload?.command || ''), HOME);
            ws.send(JSON.stringify({ type: 'command_result', commandId: msg.commandId, ok: true, output: out }));
          } else if (msg.commandType === 'list_files') {
            const dir = path.resolve(HOME, String(msg.payload?.path || '.'));
            const entries = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 120).map((e) => ({ name: e.name, path: path.join(dir, e.name), type: e.isDirectory() ? 'directory' : 'file' }));
            ws.send(JSON.stringify({ type: 'command_result', commandId: msg.commandId, ok: true, output: { path: dir, entries } }));
          } else if (msg.commandType === 'read_file') {
            const fp = path.resolve(HOME, String(msg.payload?.path || ''));
            ws.send(JSON.stringify({ type: 'command_result', commandId: msg.commandId, ok: true, output: { path: fp, content: fs.readFileSync(fp, 'utf-8').slice(0, 120000) } }));
          } else {
            ws.send(JSON.stringify({ type: 'command_result', commandId: msg.commandId, ok: false, error: 'Comando não suportado no Desktop.' }));
          }
        } catch (err) {
          ws.send(JSON.stringify({ type: 'command_result', commandId: msg.commandId, ok: false, error: err.message }));
        }
      }
    } catch {}
  });

  ws.addEventListener('close', () => {
    if (adbTimer) clearInterval(adbTimer);
    setTimeout(startCloudRelay, 8000);
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
  console.log('[' + new Date().toISOString() + '] Aegis Desktop Daemon v2.1.0 ativo em http://127.0.0.1:' + PORT + ' (Zero-Dep · Linux/Windows + Ponte ADB Android)');
  startCloudRelay();
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

const LOCAL_UI_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Aegis — HUD Desktop Linux</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #070B12;
      --sidebar: #0B1018;
      --panel: #101723;
      --deep: #090E16;
      --cyan: #38BDF8;
      --cyan-soft: rgba(56, 189, 248, 0.12);
      --border: rgba(255, 255, 255, 0.08);
      --border-accent: rgba(56, 189, 248, 0.3);
      --amber: #FBBF24;
      --emerald: #34D399;
      --rose: #FB7185;
      --text: #F1F5F9;
      --muted: #94A3B8;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; overflow: hidden; background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
    .hidden { display: none !important; }

    /* Login Gate */
    .login-wrap { position: fixed; inset: 0; z-index: 60; background: radial-gradient(circle at 50% 15%, rgba(14,116,144,0.18), var(--bg) 60%); display: flex; align-items: center; justify-content: center; padding: 20px; }
    .login-card { width: 100%; max-width: 410px; background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 28px; box-shadow: 0 24px 60px rgba(0,0,0,0.55); }
    .login-card h1 { margin: 0 0 6px; font-size: 20px; font-weight: 700; }
    .login-card p { margin: 0 0 20px; font-size: 13px; color: var(--muted); line-height: 1.5; }
    .field-lbl { display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px; }

    /* Unified Web-Style App Shell */
    .app-shell { display: flex; height: 100%; width: 100%; }
    .sidebar { width: 256px; background: var(--sidebar); border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }
    .sb-head { height: 56px; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); font-weight: 700; font-size: 17px; letter-spacing: -0.01em; }
    .sb-nav { flex: 1; padding: 12px; display: flex; flex-direction: column; gap: 4px; overflow-y: auto; }
    .nav-btn { width: 100%; text-align: left; background: transparent; border: 1px solid transparent; color: var(--muted); padding: 10px 12px; border-radius: 8px; font-size: 12.5px; font-weight: 500; cursor: pointer; transition: all 150ms; }
    .nav-btn:hover { background: rgba(255,255,255,0.04); color: var(--text); }
    .nav-btn.active { background: var(--cyan-soft); border-color: var(--border-accent); color: #7DD3FC; font-weight: 600; }
    .sb-foot { padding: 14px 16px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px; font-size: 12px; }

    .main-col { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .topbar { height: 56px; border-bottom: 1px solid var(--border); padding: 0 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; background: var(--bg); flex-shrink: 0; }
    .topbar-left { display: flex; align-items: center; gap: 12px; font-size: 13px; }
    .topbar-right { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--muted); }
    .main-view { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }

    /* Shared Controls */
    input, textarea, select { background: var(--deep); border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 9px 12px; font-size: 13px; width: 100%; outline: none; }
    input:focus, textarea:focus, select:focus { border-color: var(--cyan); }
    button.primary { background: #38BDF8; color: #04121F; border: 0; border-radius: 8px; padding: 9px 16px; font-weight: 600; font-size: 12.5px; cursor: pointer; white-space: nowrap; }
    button.primary:hover { background: #7DD3FC; }
    button.ghost { background: #151D2B; color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 7px 12px; font-size: 12px; cursor: pointer; white-space: nowrap; }
    button.ghost:hover { border-color: var(--border-accent); }
    button.danger { background: rgba(251,113,133,0.12); color: #FDA4AF; border: 1px solid rgba(251,113,133,0.3); border-radius: 6px; padding: 5px 10px; font-size: 11.5px; cursor: pointer; }

    /* Telemetry Strip */
    .telemetry-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; padding: 14px 24px; border-bottom: 1px solid var(--border); background: #0B1018; }
    .stat-card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; }
    .stat-k { font-size: 11px; color: var(--muted); margin-bottom: 3px; }
    .stat-v { font-size: 15px; font-weight: 600; }

    /* Views */
    .view-pane { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    .toolbar { padding: 12px 24px; border-bottom: 1px solid var(--border); background: #0C121C; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
    .chat-scroll { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }
    .msg-box { max-width: 820px; width: 100%; margin: 0 auto; }
    .msg-hdr { font-size: 11.5px; color: var(--muted); margin-bottom: 5px; display: flex; align-items: center; gap: 8px; }
    .msg-body { border: 1px solid var(--border); background: var(--panel); border-radius: 10px; padding: 12px 15px; font-size: 13.5px; line-height: 1.6; }
    .msg-body.user { background: rgba(56,189,248,0.08); border-color: var(--border-accent); }
    .cmd-dock { padding: 14px 24px; border-top: 1px solid var(--border); background: #0B1018; }
    .cmd-form { max-width: 820px; margin: 0 auto; display: flex; gap: 10px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 20px 24px; flex: 1; min-height: 0; overflow-y: auto; }
    .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    .panel-head { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 600; }
    .panel-body { padding: 14px 16px; overflow-y: auto; flex: 1; }
    .row-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 12.5px; }
    pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-family: inherit; }

    /* Modal */
    .modal-bg { position: fixed; inset: 0; z-index: 70; background: rgba(2,6,14,0.82); display: flex; align-items: center; justify-content: center; padding: 16px; }
    .modal-card { width: 100%; max-width: 520px; background: var(--panel); border: 1px solid var(--amber); border-radius: 12px; overflow: hidden; }
    @media (max-width: 960px) { .sidebar { display: none; } .grid-2, .telemetry-strip { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <!-- Login / Setup Overlay -->
  <div id="login-screen" class="login-wrap">
    <div class="login-card">
      <h1 id="login-title">Aegis Desktop Linux</h1>
      <p id="login-sub">Autentique-se para operar o sistema local, navegação web e conexões cloud.</p>
      <form onsubmit="submitAuth(event)" style="display:flex; flex-direction:column; gap:12px;">
        <div>
          <label class="field-lbl">Usuário Operador</label>
          <input id="auth-user" placeholder="ex: juan" required />
        </div>
        <div>
          <label class="field-lbl">Senha Local</label>
          <input id="auth-pass" type="password" placeholder="••••••" required />
        </div>
        <div id="auth-err" style="font-size:12px; color:var(--rose);"></div>
        <button class="primary" type="submit" id="auth-btn" style="width:100%; padding:11px;">Entrar no Aegis</button>
      </form>
    </div>
  </div>

  <!-- Main Unified Shell -->
  <div id="app-shell" class="app-shell hidden">
    <aside class="sidebar">
      <div class="sb-head">
        <span>Aegis</span>
        <span class="mono" style="font-size:11px; color:var(--cyan);">LOCAL</span>
      </div>
      <nav class="sb-nav">
        <button class="nav-btn active" onclick="showTab('cmd', this)">Janela de Comando</button>
        <button class="nav-btn" onclick="showTab('sys', this)">Terminal &amp; Sistema</button>
        <button class="nav-btn" onclick="showTab('web', this)">Navegação Web</button>
        <button class="nav-btn" onclick="showTab('mem', this)">Memória Persistente</button>
        <button class="nav-btn" onclick="showTab('cloud', this)">Conexões Cloud</button>
        <button class="nav-btn" onclick="showTab('usage', this)">Consumo &amp; Modelos</button>
      </nav>
      <div class="sb-foot">
        <div>
          <div style="font-weight:600;" id="sb-user">Operador</div>
          <div class="mono" style="font-size:11px; color:var(--muted);" id="sb-tokens">0 tokens na máquina</div>
        </div>
        <button class="ghost" onclick="logoutLocal()" style="width:100%;">Sair da Sessão</button>
      </div>
    </aside>

    <div class="main-col">
      <header class="topbar">
        <div class="topbar-left">
          <span style="color:var(--muted);">Aegis Linux</span>
          <span style="color:var(--muted);">/</span>
          <strong id="top-title">Janela de Comando</strong>
        </div>
        <div class="topbar-right mono">
          <span id="hdr-host">Conectando...</span>
          <span>·</span>
          <span id="hdr-clock">--:--:--</span>
        </div>
      </header>

      <div class="telemetry-strip">
        <div class="stat-card"><div class="stat-k">CPU Load</div><div class="stat-v mono" id="st-cpu">—</div></div>
        <div class="stat-card"><div class="stat-k">Memória RAM</div><div class="stat-v mono" id="st-ram">—</div></div>
        <div class="stat-card"><div class="stat-k">Disco Local</div><div class="stat-v mono" id="st-disk">—</div></div>
        <div class="stat-card"><div class="stat-k">Tokens Acumulados</div><div class="stat-v mono" id="st-tokens">0 tok · 0 req</div></div>
      </div>

      <main class="main-view">
        <!-- TAB 1: COMMAND -->
        <section id="tab-cmd" class="view-pane">
          <div class="toolbar">
            <div style="display:flex; align-items:center; gap:10px;">
              <label style="font-size:12px; color:var(--muted); white-space:nowrap;">Modelo IA:</label>
              <select id="model-select" style="width:auto; min-width:210px; padding:6px 10px; font-size:12px;">
                <option value="auto">Automático (Inteligente por Tarefa)</option>
                <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Econômico)</option>
                <option value="gemini-4-hydrogen">Gemini 4 Hydrogen (Balanceado)</option>
                <option value="gemini-4-argon">Gemini 4 Argon (Avançado)</option>
                <option value="gemini-4-carbon">Gemini 4 Carbon (Profundo)</option>
              </select>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button class="ghost" onclick="quickPrompt('Verifique o uso de RAM, CPU e espaço em disco local e me explique o resultado.')">Diagnosticar Sistema</button>
              <button class="ghost" onclick="quickPrompt('Liste os arquivos recentes em ~/Downloads.')">Ver ~/Downloads</button>
            </div>
          </div>
          <div id="chat-log" class="chat-scroll">
            <div class="msg-box">
              <div class="msg-hdr"><span>Aegis</span><span>·</span><span class="mono">Núcleo Local Linux</span></div>
              <div class="msg-body"><pre>Conectado à sua máquina Linux. Todos os comandos executados retornam a análise completa dos dados reais do sistema. A seleção automática de modelo escolhe entre econômico e avançado conforme a complexidade da sua tarefa.</pre></div>
            </div>
          </div>
          <div class="cmd-dock">
            <form class="cmd-form" onsubmit="sendCmd(event)">
              <input id="cmd-input" placeholder="Dê uma diretriz ao Aegis (Linux local, navegação web, Google Workspace)..." autocomplete="off" />
              <button class="primary" type="submit" id="cmd-btn">Executar</button>
            </form>
          </div>
        </section>

        <!-- TAB 2: TERMINAL & FILES -->
        <section id="tab-sys" class="view-pane hidden">
          <div class="grid-2">
            <div class="panel">
              <div class="panel-head">
                <span>Terminal Bash Local</span>
                <div style="display:flex; gap:6px;">
                  <button class="ghost" onclick="runPreset('free -h')">free -h</button>
                  <button class="ghost" onclick="runPreset('df -h')">df -h</button>
                </div>
              </div>
              <div id="sh-log" class="panel-body mono" style="background:var(--deep); font-size:12px;"></div>
              <form style="display:flex; gap:8px; padding:12px; border-top:1px solid var(--border);" onsubmit="runShell(event)">
                <input id="sh-input" class="mono" placeholder="Comando bash..." />
                <button class="primary" type="submit">Rodar</button>
              </form>
            </div>
            <div class="panel">
              <div class="panel-head">
                <span class="mono" id="cwd-label" style="overflow:hidden;text-overflow:ellipsis;">~</span>
                <div style="display:flex; gap:6px;">
                  <button class="ghost" id="local-back-btn" style="display:none;" onclick="closeLocalViewer()">Arquivos</button>
                  <button class="ghost" onclick="goParentDir()">Subir</button>
                  <button class="ghost" onclick="loadFiles()">Atualizar</button>
                </div>
              </div>
              <div id="file-list" class="panel-body"></div>
              <div id="local-viewer" class="panel-body hidden" style="display:flex;flex-direction:column;gap:10px;"></div>
            </div>
          </div>
        </section>

        <!-- TAB 3: WEB AUTOMATION & VAULT -->
        <section id="tab-web" class="view-pane hidden">
          <div class="grid-2">
            <div class="panel">
              <div class="panel-head">
                <span>Navegador Autônomo</span>
                <span class="mono" id="web-status" style="font-size:11px; color:var(--muted);">Aguardando URL</span>
              </div>
              <form style="display:flex; gap:8px; padding:12px; border-bottom:1px solid var(--border);" onsubmit="navWeb(event)">
                <input id="web-url" placeholder="https://..." />
                <button class="primary" type="submit">Acessar</button>
              </form>
              <div id="web-preview" class="panel-body" style="font-size:12.5px;"><pre style="color:var(--muted);">Informe uma URL ou peça ao Aegis na Janela de Comando para navegar, logar e extrair dados.</pre></div>
            </div>
            <div class="panel">
              <div class="panel-head"><span>Cofre de Credenciais Web (AES-256)</span></div>
              <form style="padding:12px; border-bottom:1px solid var(--border); display:flex; flex-direction:column; gap:8px;" onsubmit="saveCred(event)">
                <input id="cr-site" placeholder="Nome do site (ex: Portal RH)" required />
                <input id="cr-url" placeholder="URL de login (https://...)" required />
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                  <input id="cr-user" placeholder="Usuário ou e-mail" required />
                  <input id="cr-pass" type="password" placeholder="Senha" required />
                </div>
                <button class="primary" type="submit">Salvar no Cofre</button>
              </form>
              <div id="cred-list" class="panel-body"></div>
            </div>
          </div>
        </section>

        <!-- TAB 4: MEMORY -->
        <section id="tab-mem" class="view-pane hidden">
          <div class="grid-2">
            <div class="panel">
              <div class="panel-head"><span>Fatos &amp; Preferências</span></div>
              <form style="display:flex; gap:8px; padding:12px; border-bottom:1px solid var(--border);" onsubmit="addFact(event)">
                <input id="fact-input" placeholder="Nova memória permanente..." />
                <button class="primary" type="submit">Salvar</button>
              </form>
              <div id="facts-list" class="panel-body"></div>
            </div>
            <div class="panel">
              <div class="panel-head"><span>Histórico Recente</span></div>
              <div id="events-list" class="panel-body"></div>
            </div>
          </div>
        </section>

        <!-- TAB 5: GOOGLE WORKSPACE & DRIVE EXPLORER -->
        <section id="tab-cloud" class="view-pane hidden">
          <div class="grid-2">
            <div class="panel">
              <div class="panel-head">
                <span>Google Drive · Estrutura de Pastas</span>
                <div style="display:flex; gap:6px; align-items:center;">
                  <span id="g-status" class="mono" style="font-size:11px; color:var(--muted);"></span>
                  <button class="ghost" onclick="loadGDrive('root', 'Meu Drive')">Raiz</button>
                </div>
              </div>
              <div id="cloud-google" style="padding:10px 14px; border-bottom:1px solid var(--border); font-size:12px;">Carregando...</div>
              <div id="gdrive-bread" style="padding:8px 14px; border-bottom:1px solid var(--border); font-size:11.5px; color:var(--cyan);"></div>
              <div id="gdrive-list" class="panel-body"></div>
            </div>
            <div class="panel">
              <div class="panel-head">
                <span id="gdrive-file-title">Visualizador &amp; Editor Google Drive</span>
                <a id="gdrive-ext-link" href="#" target="_blank" style="display:none; font-size:11.5px; color:var(--cyan);">Abrir no Google Drive</a>
              </div>
              <div id="gdrive-viewer" class="panel-body" style="display:flex;flex-direction:column;gap:10px;"><pre style="color:var(--muted);">Sincronize sua sessão Google pela interface web principal e selecione uma pasta ou arquivo ao lado.</pre></div>
            </div>
          </div>
        </section>

        <!-- TAB 6: USAGE & MODELS -->
        <section id="tab-usage" class="view-pane hidden">
          <div class="grid-2">
            <div class="panel">
              <div class="panel-head"><span>Consumo por Modelo</span><button class="ghost" onclick="loadUsage()">Atualizar</button></div>
              <div id="usage-models" class="panel-body"></div>
            </div>
            <div class="panel">
              <div class="panel-head"><span>Chamadas Recentes</span></div>
              <div id="usage-recent" class="panel-body"></div>
            </div>
          </div>
        </section>
      </main>
    </div>
  </div>

  <!-- Confirmation Modal -->
  <div id="auth-modal" class="modal-bg hidden">
    <div class="modal-card">
      <div class="panel-head" style="color:var(--amber);">Confirmação de Segurança Aegis</div>
      <div style="padding:16px; font-size:13px;">
        <div id="auth-desc" style="margin-bottom:10px;"></div>
        <pre id="auth-cmd" class="mono" style="background:var(--deep); padding:10px; border-radius:8px; color:#FDE68A;"></pre>
      </div>
      <div style="padding:12px 16px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:10px;">
        <button class="ghost" onclick="resolveModal(false)">Cancelar</button>
        <button class="primary" onclick="resolveModal(true)">Confirmar</button>
      </div>
    </div>
  </div>

  <script>
    let localToken = localStorage.getItem('aegis_local_token') || '';
    let needsSetup = false;
    let currentDir = '.';
    let parentDir = '.';
    let aiBusy = false;
    let modalResolve = null;

    function esc(s) {
      return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    async function apiFetch(url, opts = {}) {
      const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      if (localToken) headers['X-Aegis-Local-Token'] = localToken;
      const r = await fetch(url, Object.assign({}, opts, { headers }));
      if (r.status === 401) {
        localToken = '';
        localStorage.removeItem('aegis_local_token');
        showLogin();
      }
      return r;
    }

    function showLogin() {
      document.getElementById('login-screen').classList.remove('hidden');
      document.getElementById('app-shell').classList.add('hidden');
    }

    function showApp(username) {
      document.getElementById('sb-user').textContent = username || 'Operador';
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('app-shell').classList.remove('hidden');
      pollTelemetry();
      loadUsage();
    }

    async function checkAuth() {
      const s = await (await fetch('/auth/status', { headers: localToken ? { 'X-Aegis-Local-Token': localToken } : {} })).json();
      needsSetup = Boolean(s.needsSetup);
      document.getElementById('login-title').textContent = needsSetup ? 'Configurar Operador Local' : 'Entrar no Aegis Linux';
      document.getElementById('auth-btn').textContent = needsSetup ? 'Criar Conta Local' : 'Entrar no Aegis';
      if (s.authenticated) showApp(s.username);
      else showLogin();
    }

    async function submitAuth(e) {
      e.preventDefault();
      const username = document.getElementById('auth-user').value.trim();
      const password = document.getElementById('auth-pass').value;
      const errEl = document.getElementById('auth-err');
      errEl.textContent = '';
      const r = await fetch(needsSetup ? '/auth/setup' : '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const d = await r.json();
      if (!r.ok) { errEl.textContent = d.error || 'Falha na autenticação.'; return; }
      localToken = d.token;
      localStorage.setItem('aegis_local_token', localToken);
      showApp(d.username);
    }

    async function logoutLocal() {
      await apiFetch('/auth/logout', { method: 'POST' });
      localToken = '';
      localStorage.removeItem('aegis_local_token');
      checkAuth();
    }

    function showTab(id, btn) {
      document.querySelectorAll('.view-pane').forEach((v) => v.classList.add('hidden'));
      document.getElementById('tab-' + id).classList.remove('hidden');
      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('top-title').textContent = btn.textContent;
      if (id === 'sys') loadFiles(currentDir);
      if (id === 'mem') loadMem();
      if (id === 'web') loadCreds();
      if (id === 'cloud') loadConnections();
      if (id === 'usage') loadUsage();
    }

    function askAuth(desc, command) {
      document.getElementById('auth-desc').textContent = desc;
      document.getElementById('auth-cmd').textContent = command;
      document.getElementById('auth-modal').classList.remove('hidden');
      return new Promise((resolve) => { modalResolve = resolve; });
    }
    function resolveModal(ok) {
      document.getElementById('auth-modal').classList.add('hidden');
      if (modalResolve) { modalResolve(ok); modalResolve = null; }
    }

    async function pollTelemetry() {
      if (!localToken) return;
      try {
        const s = await (await apiFetch('/status')).json();
        if (s.error) return;
        const ramUsed = s.totalMemMb - s.freeMemMb;
        document.getElementById('hdr-host').textContent = s.hostname + ' · ' + s.arch;
        document.getElementById('st-cpu').textContent = s.cpuCount + ' cores (load ' + (s.loadAvg[0] || 0) + ')';
        document.getElementById('st-ram').textContent = ramUsed + ' / ' + s.totalMemMb + ' MB';
        document.getElementById('st-disk').textContent = (s.diskPct || 0) + '% usado';
      } catch {}
    }

    async function loadUsage() {
      if (!localToken) return;
      try {
        const u = await (await apiFetch('/usage')).json();
        if (!u.totals) return;
        document.getElementById('st-tokens').textContent = u.totals.totalTokens + ' tok · ' + u.totals.requests + ' req';
        document.getElementById('sb-tokens').textContent = u.totals.totalTokens + ' tokens · ' + u.totals.requests + ' req';
        document.getElementById('usage-models').innerHTML = (u.byModel || []).map((m) =>
          '<div class="row-item"><div><strong>' + esc(m.model) + '</strong></div><div class="mono">' + m.requests + ' req · ' + m.totalTokens + ' tokens</div></div>'
        ).join('') || '<div style="color:var(--muted);font-size:12.5px;">Nenhuma requisição registrada ainda.</div>';
        document.getElementById('usage-recent').innerHTML = (u.recent || []).map((r) =>
          '<div class="row-item"><div><div>' + esc(r.model) + ' (' + esc(r.mode) + ')</div><div style="font-size:11px;color:var(--muted);">' + esc(r.reason) + '</div></div><div class="mono">' + r.totalTokens + ' tok · ' + r.latencyMs + 'ms</div></div>'
        ).join('') || '<div style="color:var(--muted);font-size:12.5px;">Sem histórico ainda.</div>';
      } catch {}
    }

    function quickPrompt(t) {
      document.getElementById('cmd-input').value = t;
      sendCmd(new Event('submit'));
    }

    async function sendCmd(e) {
      e.preventDefault();
      const inp = document.getElementById('cmd-input');
      const prompt = inp.value.trim();
      if (!prompt || aiBusy) return;
      inp.value = '';
      aiBusy = true;
      document.getElementById('cmd-btn').textContent = 'Processando...';
      const log = document.getElementById('chat-log');
      log.innerHTML += '<div class="msg-box"><div class="msg-hdr"><span>Você</span></div><div class="msg-body user"><pre>' + esc(prompt) + '</pre></div></div>';
      log.scrollTop = log.scrollHeight;

      try {
        const modelPreference = document.getElementById('model-select').value;
        const r = await apiFetch('/command', { method: 'POST', body: JSON.stringify({ prompt, modelPreference }) });
        const d = await r.json();
        const uMeta = d.usage ? ' · ' + esc(d.usage.model) + ' · ' + d.usage.totalTokens + ' tokens · ' + d.usage.latencyMs + 'ms' : '';
        log.innerHTML += '<div class="msg-box"><div class="msg-hdr"><span>Aegis</span><span class="mono">' + uMeta + '</span></div><div class="msg-body"><pre>' + esc(d.reply || d.error || 'Concluído.') + '</pre></div></div>';

        for (const p of (d.pendingConfirmations || [])) {
          const ok = await askAuth('Confirmação necessária:', p.command);
          if (ok) {
            const er = await apiFetch('/command', {
              method: 'POST',
              body: JSON.stringify(p.type === 'web_login' ? { confirmedWebLogin: p.payload } : { confirmedCommand: p.command }),
            });
            const ed = await er.json();
            const text = (ed.summary ? ed.summary + '\\n\\nSaída:\\n' : '') + (ed.stdout || ed.stderr || 'Executado.');
            log.innerHTML += '<div class="msg-box"><div class="msg-hdr" style="color:var(--emerald);">Execução Confirmada</div><div class="msg-body"><pre class="mono">' + esc(text) + '</pre></div></div>';
          }
        }
        loadUsage();
      } catch (err) {
        log.innerHTML += '<div class="msg-box"><div class="msg-hdr" style="color:var(--rose);">Erro</div><div class="msg-body"><pre>' + esc(err.message) + '</pre></div></div>';
      } finally {
        aiBusy = false;
        document.getElementById('cmd-btn').textContent = 'Executar';
        log.scrollTop = log.scrollHeight;
      }
    }

    const activeBlobUrls = { local: null, gdrive: null };
    let currentLocalFile = null;
    let currentGDriveFile = null;

    function setBlobUrl(slot, blob) {
      if (activeBlobUrls[slot]) URL.revokeObjectURL(activeBlobUrls[slot]);
      activeBlobUrls[slot] = URL.createObjectURL(blob);
      return activeBlobUrls[slot];
    }

    async function fetchMediaBlobUrl(slot, url) {
      const headers = {};
      if (localToken) headers['X-Aegis-Local-Token'] = localToken;
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return setBlobUrl(slot, await r.blob());
    }

    function renderEmbeddedViewerHtml(prefix, file, mediaUrl) {
      const editable = Boolean(file.editable);
      const isCsv = /\\.(csv|tsv)$/i.test(file.name || '') || file.mimeType === 'text/csv';
      let bar = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:8px;">';
      bar += '<div style="display:flex;gap:6px;">';
      bar += '<button class="ghost" onclick="switchViewMode(\\'' + prefix + '\\', \\'preview\\')">Visualizar</button>';
      if (editable) bar += '<button class="ghost" onclick="switchViewMode(\\'' + prefix + '\\', \\'edit\\')">Editor Embutido</button>';
      bar += '</div>';
      if (editable) bar += '<button class="primary" onclick="saveCurrentFile(\\'' + prefix + '\\')">Salvar Alterações</button>';
      bar += '</div>';

      let previewHtml = '';
      if (file.kind === 'pdf' || (file.kind === 'slides' && mediaUrl)) {
        previewHtml = '<iframe src="' + mediaUrl + '" style="width:100%;height:100%;min-height:380px;border:0;background:#fff;border-radius:8px;"></iframe>';
      } else if (file.kind === 'image' && mediaUrl) {
        previewHtml = '<div style="display:flex;justify-content:center;align-items:center;height:100%;overflow:auto;"><img src="' + mediaUrl + '" style="max-width:100%;max-height:420px;border-radius:8px;" /></div>';
      } else if (file.kind === 'audio' && mediaUrl) {
        previewHtml = '<div style="padding:24px;text-align:center;"><audio controls src="' + mediaUrl + '" style="width:100%;max-width:420px;"></audio></div>';
      } else if (file.kind === 'video' && mediaUrl) {
        previewHtml = '<div style="display:flex;justify-content:center;"><video controls src="' + mediaUrl + '" style="max-width:100%;max-height:420px;border-radius:8px;"></video></div>';
      } else if (isCsv && file.textContent) {
        const rows = file.textContent.split(/\\r?\\n/).filter(Boolean).slice(0, 120).map((r) => r.split(','));
        previewHtml = '<div style="overflow:auto;max-height:400px;"><table style="width:100%;border-collapse:collapse;font-size:12px;">' + rows.map((row, ri) => '<tr>' + row.map((c) => '<td style="border:1px solid var(--border);padding:5px 8px;' + (ri === 0 ? 'font-weight:700;color:var(--cyan);' : '') + '">' + esc(c) + '</td>').join('') + '</tr>').join('') + '</table></div>';
      } else if (file.textContent || file.content) {
        previewHtml = '<pre class="mono" style="font-size:12px;line-height:1.6;">' + esc(file.textContent ?? file.content) + '</pre>';
      } else {
        previewHtml = '<div style="color:var(--muted);font-size:12.5px;">Tipo: ' + esc(file.mimeType || 'binário') + '</div>';
      }

      const editVal = esc(file.textContent ?? file.content ?? '');
      const editHtml = editable
        ? '<textarea id="' + prefix + '-editor" class="mono" style="flex:1;min-height:360px;font-size:12px;line-height:1.6;resize:none;">' + editVal + '</textarea>'
        : '';

      return bar + '<div id="' + prefix + '-preview-box" style="flex:1;min-height:0;overflow:auto;">' + previewHtml + '</div><div id="' + prefix + '-edit-box" class="hidden" style="flex:1;min-height:0;display:flex;flex-direction:column;">' + editHtml + '</div>';
    }

    function switchViewMode(prefix, mode) {
      const p = document.getElementById(prefix + '-preview-box');
      const e = document.getElementById(prefix + '-edit-box');
      if (!p || !e) return;
      if (mode === 'edit') { p.classList.add('hidden'); e.classList.remove('hidden'); }
      else { e.classList.add('hidden'); p.classList.remove('hidden'); }
    }

    async function saveCurrentFile(prefix) {
      const ed = document.getElementById(prefix + '-editor');
      if (!ed) return;
      const newContent = ed.value;
      const viewer = document.getElementById(prefix === 'local' ? 'local-viewer' : 'gdrive-viewer');
      const showInlineErr = (msg) => {
        if (!viewer) return;
        const old = viewer.querySelector('.save-err-banner');
        if (old) old.remove();
        const div = document.createElement('div');
        div.className = 'save-err-banner';
        div.style.cssText = 'padding:8px 10px;border-radius:6px;background:rgba(251,113,133,0.12);border:1px solid rgba(251,113,133,0.35);color:#FDA4AF;font-size:12px;';
        div.textContent = msg;
        viewer.prepend(div);
      };
      if (prefix === 'local' && currentLocalFile) {
        if (!(await askAuth('Salvar alterações no arquivo local?', currentLocalFile.path))) return;
        const r = await (await apiFetch('/file/save', { method: 'POST', body: JSON.stringify({ path: currentLocalFile.path, content: newContent }) })).json();
        if (r.error) showInlineErr(r.error);
        else { currentLocalFile.content = newContent; openLocalFile(currentLocalFile.path); }
      } else if (prefix === 'gdrive' && currentGDriveFile) {
        if (!(await askAuth('Salvar alterações no Google Drive?', currentGDriveFile.name))) return;
        const r = await (await apiFetch('/google/drive/save', { method: 'POST', body: JSON.stringify({ id: currentGDriveFile.id, kind: currentGDriveFile.kind, mimeType: currentGDriveFile.mimeType, content: newContent }) })).json();
        if (r.error) showInlineErr(r.error);
        else openGFile(currentGDriveFile.id);
      }
    }

    function closeLocalViewer() {
      document.getElementById('local-viewer').classList.add('hidden');
      document.getElementById('file-list').classList.remove('hidden');
      document.getElementById('local-back-btn').style.display = 'none';
      currentLocalFile = null;
    }

    async function openLocalFile(fullPath) {
      document.getElementById('file-list').classList.add('hidden');
      const viewer = document.getElementById('local-viewer');
      viewer.classList.remove('hidden');
      document.getElementById('local-back-btn').style.display = 'inline-block';
      viewer.innerHTML = '<span class="mono" style="color:var(--muted);">Abrindo arquivo...</span>';
      const d = await (await apiFetch('/file?path=' + encodeURIComponent(fullPath))).json();
      if (d.error) { viewer.innerHTML = '<div style="color:var(--rose);">' + esc(d.error) + '</div>'; return; }
      currentLocalFile = d;
      let mediaUrl = null;
      if (d.kind === 'pdf' || d.kind === 'image' || d.kind === 'audio' || d.kind === 'video') {
        try { mediaUrl = await fetchMediaBlobUrl('local', '/file/media?path=' + encodeURIComponent(fullPath)); } catch {}
      }
      viewer.innerHTML = renderEmbeddedViewerHtml('local', d, mediaUrl);
    }

    async function loadFiles(dirPath = currentDir) {
      closeLocalViewer();
      const f = await (await apiFetch('/files?path=' + encodeURIComponent(dirPath))).json();
      if (f.error) return;
      currentDir = f.dir; parentDir = f.parentDir || '.';
      document.getElementById('cwd-label').textContent = f.dir;
      document.getElementById('file-list').innerHTML = (f.entries || []).map((x) => {
        const sp = esc(x.fullPath).replace(/'/g, '&#39;');
        if (x.type === 'directory') return '<div class="row-item" style="cursor:pointer;" onclick="loadFiles(\\'' + sp + '\\')"><span class="mono" style="color:var(--cyan);">[DIR] ' + esc(x.name) + '</span><span class="mono" style="color:var(--muted);">abrir</span></div>';
        return '<div class="row-item" style="cursor:pointer;" onclick="openLocalFile(\\'' + sp + '\\')"><span class="mono">' + esc(x.name) + '</span><span class="mono" style="color:var(--muted);">visualizar · ' + x.sizeBytes + ' B</span></div>';
      }).join('');
    }
    function goParentDir() { loadFiles(parentDir); }
    function runPreset(c) { document.getElementById('sh-input').value = c; runShell(new Event('submit')); }
    async function runShell(e) {
      e.preventDefault();
      const inp = document.getElementById('sh-input');
      const command = inp.value.trim();
      if (!command) return;
      inp.value = '';
      const box = document.getElementById('sh-log');
      box.innerHTML += '<div style="color:var(--cyan);margin-top:6px;">$ ' + esc(command) + '</div>';
      let r = await (await apiFetch('/exec', { method: 'POST', body: JSON.stringify({ command, confirmed: false }) })).json();
      if (r.requiresConfirmation) {
        if (!(await askAuth('Este comando altera estado local:', command))) return;
        r = await (await apiFetch('/exec', { method: 'POST', body: JSON.stringify({ command, confirmed: true }) })).json();
      }
      box.innerHTML += '<pre>' + esc(r.stdout || r.stderr || 'OK') + '</pre>';
      box.scrollTop = box.scrollHeight;
    }

    async function loadMem() {
      const m = await (await apiFetch('/memory')).json();
      document.getElementById('facts-list').innerHTML = (m.facts || []).map((f) =>
        '<div class="row-item"><div>' + esc(f.content) + '</div><button class="danger" onclick="delFact(' + f.id + ')">Remover</button></div>'
      ).join('') || '<div style="color:var(--muted);">Sem fatos salvos.</div>';
      document.getElementById('events-list').innerHTML = (m.recent || []).slice().reverse().map((ev) =>
        '<div class="row-item"><div><div class="mono" style="font-size:11px;color:var(--cyan);">' + esc(ev.role || 'evento') + '</div><div>' + esc(ev.content || ev.command || ev.filename || '') + '</div></div></div>'
      ).join('') || '<div style="color:var(--muted);">Sem eventos.</div>';
    }
    async function addFact(e) {
      e.preventDefault();
      const inp = document.getElementById('fact-input');
      if (!inp.value.trim()) return;
      await apiFetch('/memory/facts', { method: 'POST', body: JSON.stringify({ fact: inp.value.trim() }) });
      inp.value = ''; loadMem();
    }
    async function delFact(id) { await apiFetch('/memory/facts?id=' + id, { method: 'DELETE' }); loadMem(); }

    async function navWeb(e) {
      e.preventDefault();
      const url = document.getElementById('web-url').value.trim();
      if (!url) return;
      document.getElementById('web-status').textContent = 'Carregando...';
      const d = await (await apiFetch('/web/navigate', { method: 'POST', body: JSON.stringify({ url }) })).json();
      if (d.error) { document.getElementById('web-status').textContent = d.error; return; }
      const s = d.snapshot;
      document.getElementById('web-status').textContent = 'HTTP ' + s.status + ' · ' + s.cookieCount + ' cookies';
      document.getElementById('web-preview').innerHTML = '<div style="margin-bottom:8px;"><strong>' + esc(s.title) + '</strong><div class="mono" style="font-size:11px;color:var(--muted);">' + esc(s.url) + '</div></div><pre>' + esc(s.textPreview) + '</pre>';
    }
    async function loadCreds() {
      const d = await (await apiFetch('/web/credentials')).json();
      document.getElementById('cred-list').innerHTML = (d.credentials || []).map((c) =>
        '<div class="row-item"><div><strong>' + esc(c.siteName) + '</strong><div class="mono" style="font-size:11px;color:var(--muted);">' + esc(c.username) + ' · ' + esc(c.loginUrl) + '</div></div><div style="display:flex;gap:6px;"><button class="ghost" onclick="testCredLogin(' + c.id + ')">Logar</button><button class="danger" onclick="delCred(' + c.id + ')">Excluir</button></div></div>'
      ).join('') || '<div style="color:var(--muted);">Nenhuma credencial salva.</div>';
    }
    async function saveCred(e) {
      e.preventDefault();
      await apiFetch('/web/credentials', {
        method: 'POST',
        body: JSON.stringify({
          siteName: document.getElementById('cr-site').value,
          loginUrl: document.getElementById('cr-url').value,
          username: document.getElementById('cr-user').value,
          password: document.getElementById('cr-pass').value,
        }),
      });
      e.target.reset(); loadCreds();
    }
    async function delCred(id) { await apiFetch('/web/credentials?id=' + id, { method: 'DELETE' }); loadCreds(); }
    async function testCredLogin(id) {
      const ok = await askAuth('Autenticar automaticamente usando a credencial salva?', 'Cofre ID #' + id);
      if (!ok) return;
      const d = await (await apiFetch('/web/login', { method: 'POST', body: JSON.stringify({ credentialId: id }) })).json();
      if (d.snapshot) {
        document.getElementById('web-status').textContent = 'Logado · HTTP ' + d.snapshot.status;
        document.getElementById('web-preview').innerHTML = '<strong>' + esc(d.snapshot.title) + '</strong><pre style="margin-top:8px;">' + esc(d.snapshot.textPreview) + '</pre>';
      }
    }

    let gBread = [{ id: 'root', name: 'Meu Drive' }];

    async function loadConnections() {
      const c = await (await apiFetch('/connections')).json();
      const box = document.getElementById('cloud-google');
      if (c.google?.connected) {
        box.innerHTML = '<span>Conectado como <strong>' + esc(c.google.email) + '</strong></span> <button class="danger" style="margin-left:10px;padding:4px 8px;" onclick="clearConn(\\'google\\')">Desconectar</button>';
        loadGDrive('root', 'Meu Drive', true);
      } else {
        box.innerHTML = '<span style="color:var(--muted);">Sincronize sua sessão Google automaticamente pela aba <strong>Conexões Cloud</strong> da interface web principal.</span>';
        document.getElementById('gdrive-list').innerHTML = '';
        document.getElementById('gdrive-bread').textContent = '';
      }
    }

    async function loadGDrive(folderId, folderName, reset = false) {
      if (reset) gBread = [{ id: 'root', name: 'Meu Drive' }];
      else {
        const idx = gBread.findIndex((b) => b.id === folderId);
        if (idx >= 0) gBread = gBread.slice(0, idx + 1);
        else gBread.push({ id: folderId, name: folderName || folderId });
      }
      document.getElementById('gdrive-bread').innerHTML = gBread.map((b) =>
        '<span style="cursor:pointer;text-decoration:underline;" onclick="loadGDrive(\\'' + esc(b.id) + '\\', \\'' + esc(b.name).replace(/'/g, '&#39;') + '\\')">' + esc(b.name) + '</span>'
      ).join(' / ');

      const d = await (await apiFetch('/google/drive/folder?folderId=' + encodeURIComponent(folderId))).json();
      if (d.error) { document.getElementById('gdrive-list').innerHTML = '<div style="color:var(--rose);">' + esc(d.error) + '</div>'; return; }
      document.getElementById('gdrive-list').innerHTML = (d.files || []).map((f) => {
        const isDir = f.mimeType === 'application/vnd.google-apps.folder';
        const safeName = esc(f.name).replace(/'/g, '&#39;');
        if (isDir) {
          return '<div class="row-item" style="cursor:pointer;" onclick="loadGDrive(\\'' + esc(f.id) + '\\', \\'' + safeName + '\\')"><span class="mono" style="color:var(--cyan);">[PASTA] ' + esc(f.name) + '</span><span class="mono" style="color:var(--muted);">abrir</span></div>';
        }
        return '<div class="row-item" style="cursor:pointer;" onclick="openGFile(\\'' + esc(f.id) + '\\')"><span class="mono">' + esc(f.name) + '</span><span class="mono" style="color:var(--muted);">visualizar</span></div>';
      }).join('') || '<div style="color:var(--muted);">Pasta vazia.</div>';
    }

    async function openGFile(id) {
      const viewer = document.getElementById('gdrive-viewer');
      viewer.innerHTML = '<span class="mono" style="color:var(--muted);">Carregando arquivo...</span>';
      const d = await (await apiFetch('/google/drive/file?id=' + encodeURIComponent(id))).json();
      if (d.error || !d.file) {
        viewer.innerHTML = '<div style="color:var(--rose);">' + esc(d.error || 'Erro') + '</div>';
        return;
      }
      const f = d.file;
      currentGDriveFile = f;
      document.getElementById('gdrive-file-title').textContent = f.name;
      const ext = document.getElementById('gdrive-ext-link');
      if (f.webViewLink) { ext.href = f.webViewLink; ext.style.display = 'inline'; } else { ext.style.display = 'none'; }
      let mediaUrl = null;
      if (f.kind === 'pdf' || f.kind === 'image' || f.kind === 'audio' || f.kind === 'video' || f.kind === 'slides') {
        try {
          const qs = f.defaultExportMime ? '&exportMime=' + encodeURIComponent(f.defaultExportMime) : '';
          mediaUrl = await fetchMediaBlobUrl('gdrive', '/google/drive/media?id=' + encodeURIComponent(f.id) + qs);
        } catch {}
      }
      viewer.innerHTML = renderEmbeddedViewerHtml('gdrive', f, mediaUrl);
    }

    async function clearConn(provider) {
      await apiFetch('/connections', { method: 'POST', body: JSON.stringify({ provider, token: null }) });
      loadConnections();
    }

    setInterval(() => { document.getElementById('hdr-clock').textContent = new Date().toLocaleTimeString('pt-BR'); }, 1000);
    setInterval(pollTelemetry, 4000);
    checkAuth();
  </script>
</body>
</html>`;

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
