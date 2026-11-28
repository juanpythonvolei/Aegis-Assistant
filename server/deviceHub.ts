import JSZip from 'jszip';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { URL } from 'node:url';
import { promisify } from 'node:util';
import { WebSocket, WebSocketServer } from 'ws';
import * as memory from './memory.ts';

const execFileAsync = promisify(execFile);

const SERIAL_REGEX = /^[a-zA-Z0-9._:-]{1,64}$/;
const PACKAGE_REGEX = /^[a-zA-Z0-9._-]{2,120}$/;

export interface SanitizedDevice {
  id: string;
  name: string;
  platform: memory.DevicePlatform;
  transport: memory.DeviceTransport;
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

export interface DeviceCommandDispatchResult {
  ok: boolean;
  commandId: string;
  queued?: boolean;
  transport: string;
  output?: unknown;
  error?: string;
}

interface PendingRpc {
  resolve: (value: DeviceCommandDispatchResult) => void;
  timer: NodeJS.Timeout;
  deviceId: string;
  transport: string;
}

const agentSockets = new Map<string, WebSocket>();
const operatorSockets = new Set<WebSocket>();
const pendingRpcs = new Map<string, PendingRpc>();

export function hashDeviceToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

export function generateDeviceToken(): { rawToken: string; tokenHash: string } {
  const rawToken = `agd_${crypto.randomBytes(24).toString('hex')}`;
  return { rawToken, tokenHash: hashDeviceToken(rawToken) };
}

export function generatePairingCode(userId: number, label: string, platform: memory.DevicePlatform): memory.DevicePairingCodeRecord {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return memory.createDevicePairingCode({
    code,
    userId,
    label: label || `Dispositivo ${platform.toUpperCase()}`,
    platform,
    ttlMs: 15 * 60 * 1000,
  });
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function sanitizeDeviceRecord(row: memory.PairedDeviceRecord): SanitizedDevice {
  const directConnected = agentSockets.has(row.id) && agentSockets.get(row.id)?.readyState === WebSocket.OPEN;
  const bridgeConnected = Boolean(
    row.parent_bridge_id &&
      agentSockets.has(row.parent_bridge_id) &&
      agentSockets.get(row.parent_bridge_id)?.readyState === WebSocket.OPEN
  );
  const liveSocketConnected = directConnected || bridgeConnected;
  const effectiveStatus: 'online' | 'offline' =
    liveSocketConnected || row.transport === 'adb_local' || row.status === 'online' ? row.status : 'offline';

  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    transport: row.transport,
    serialOrUid: row.serial_or_uid,
    parentBridgeId: row.parent_bridge_id,
    status: liveSocketConnected ? 'online' : effectiveStatus,
    liveSocketConnected,
    capabilities: safeJsonParse<string[]>(row.capabilities_json, []),
    telemetry: safeJsonParse<Record<string, unknown>>(row.telemetry_json, {}),
    storage: safeJsonParse<Record<string, unknown>>(row.storage_snapshot_json, {}),
    apps: safeJsonParse<unknown[]>(row.apps_snapshot_json, []),
    notifications: safeJsonParse<unknown[]>(row.notifications_snapshot_json, []),
    files: safeJsonParse<unknown[]>(row.files_snapshot_json, []),
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

export function broadcastOperatorEvent(event: string, payload: unknown): void {
  const frame = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });
  for (const ws of operatorSockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(frame);
    }
  }
}

export function broadcastMeshPeers(userId: number): void {
  const allForUser = memory.listPairedDevices(userId).map(sanitizeDeviceRecord);
  const compactPeers = allForUser.map((d) => ({
    id: d.id,
    name: d.name,
    platform: d.platform,
    transport: d.transport,
    status: d.status,
    liveSocketConnected: d.liveSocketConnected,
    capabilities: d.capabilities,
    lanIp: typeof d.telemetry?.lanIp === 'string' ? d.telemetry.lanIp : null,
    meshPort: typeof d.telemetry?.meshPort === 'number' ? d.telemetry.meshPort : 38472,
    batteryPercent: d.telemetry?.batteryPercent ?? null,
    lastSeenAt: d.lastSeenAt,
  }));
  for (const d of allForUser) {
    const sock = agentSockets.get(d.id);
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(
        JSON.stringify({
          type: 'mesh_peers',
          selfId: d.id,
          peers: compactPeers.filter((p) => p.id !== d.id),
          timestamp: new Date().toISOString(),
        })
      );
    }
  }
}

async function verifyGoogleAccessTokenEmail(accessToken: string): Promise<string | null> {
  if (!accessToken || accessToken.length < 16 || accessToken.length > 4096) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string; verified_email?: boolean };
    if (data.email && data.verified_email !== false) {
      return data.email.trim().toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
}

export function isDestructiveDeviceCommand(commandType: string, payload: Record<string, unknown>): boolean {
  const ct = commandType.toLowerCase();
  if (ct === 'delete_file' || ct === 'uninstall_app' || ct === 'reboot' || ct === 'factory_reset') {
    return true;
  }
  if (ct === 'shell' || ct === 'adb_shell') {
    const cmd = String(payload.command || '').toLowerCase();
    const dangerous = [
      /\brm\s+-[a-z]*[rf]/i,
      /\brm\s+\//i,
      /\bpm\s+uninstall\b/i,
      /\bpm\s+clear\b/i,
      /\breboot\b/i,
      /\bshutdown\b/i,
      /\bwipe\b/i,
      /\bmkfs\b/i,
      /\bdd\s+if=/i,
      /\bfactory[_-]?reset\b/i,
      /\bsettings\s+delete\b/i,
      /\bsvc\s+power\s+shutdown\b/i,
    ];
    return dangerous.some((re) => re.test(cmd));
  }
  return false;
}

// ==========================================
// LOCAL HOST ADB BRIDGE (NO ANDROID APP REQUIRED)
// ==========================================

async function runAdbSafe(args: string[], timeoutMs = 10000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('adb', args, {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { ok: true, stdout: stdout || '', stderr: stderr || '' };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string; code?: string };
    return {
      ok: false,
      stdout: e.stdout || '',
      stderr: e.stderr || e.message || 'ADB indisponível neste host.',
    };
  }
}

export async function detectLocalAdbDevices(userId = 0): Promise<SanitizedDevice[]> {
  const res = await runAdbSafe(['devices', '-l'], 3500);
  if (!res.ok) return [];

  const lines = res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('List of devices') && !l.startsWith('* daemon'));

  const found: SanitizedDevice[] = [];
  for (const line of lines) {
    const parts = line.split(/\s+/);
    const serial = parts[0];
    const state = parts[1];
    if (!serial || !SERIAL_REGEX.test(serial) || state !== 'device') continue;

    const modelMatch = line.match(/model:([^\s]+)/);
    const deviceMatch = line.match(/device:([^\s]+)/);
    const modelName = (modelMatch?.[1] || deviceMatch?.[1] || serial).replace(/_/g, ' ');
    const deviceId = `adb_${serial.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    // Gather lightweight live telemetry via ADB
    const [battRes, dfRes, verRes] = await Promise.all([
      runAdbSafe(['-s', serial, 'shell', 'dumpsys', 'battery'], 3000),
      runAdbSafe(['-s', serial, 'shell', 'df', '-h', '/sdcard'], 3000),
      runAdbSafe(['-s', serial, 'shell', 'getprop', 'ro.build.version.release'], 2500),
    ]);

    const levelMatch = battRes.stdout.match(/level:\s*(\d+)/);
    const statusMatch = battRes.stdout.match(/status:\s*(\d+)/);
    const tempMatch = battRes.stdout.match(/temperature:\s*(\d+)/);

    const record = memory.upsertPairedDevice({
      id: deviceId,
      userId,
      name: `${modelName} (ADB)`,
      platform: 'android',
      transport: 'adb_local',
      serialOrUid: serial,
      status: 'online',
      capabilities: [
        'shell',
        'list_files',
        'read_file',
        'open_app',
        'input_tap',
        'input_swipe',
        'input_text',
        'input_keyevent',
        'list_packages',
        'notifications',
        'battery_info',
        'storage_info',
      ],
      telemetry: {
        batteryPercent: levelMatch ? Number(levelMatch[1]) : null,
        charging: statusMatch ? statusMatch[1] === '2' || statusMatch[1] === '5' : null,
        temperatureC: tempMatch ? Number(tempMatch[1]) / 10 : null,
        androidVersion: verRes.stdout.trim() || 'Android',
        connection: serial.includes(':') ? 'ADB Wireless Wi-Fi' : 'ADB USB Local',
        serial,
      },
      storageSnapshot: {
        raw: dfRes.stdout.trim(),
      },
    });
    found.push(sanitizeDeviceRecord(record));
  }

  return found;
}

async function executeLocalAdbCommand(
  serial: string,
  commandType: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; output?: unknown; error?: string }> {
  if (!SERIAL_REGEX.test(serial)) {
    return { ok: false, error: 'Serial ADB inválido.' };
  }

  switch (commandType) {
    case 'shell':
    case 'adb_shell': {
      const cmd = String(payload.command || '').trim();
      if (!cmd) return { ok: false, error: 'Comando shell vazio.' };
      const r = await runAdbSafe(['-s', serial, 'shell', cmd], 15000);
      return { ok: r.ok, output: { stdout: r.stdout, stderr: r.stderr }, error: r.ok ? undefined : r.stderr };
    }
    case 'list_files': {
      const targetPath = String(payload.path || '/sdcard').replace(/["`$\\]/g, '');
      const r = await runAdbSafe(['-s', serial, 'shell', `ls -la "${targetPath}"`], 10000);
      const entries = r.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((l) => l && !l.startsWith('total '))
        .slice(0, 120);
      return { ok: r.ok, output: { path: targetPath, entries, raw: r.stdout }, error: r.ok ? undefined : r.stderr };
    }
    case 'read_file': {
      const targetPath = String(payload.path || '').replace(/["`$\\]/g, '');
      if (!targetPath) return { ok: false, error: 'Caminho do arquivo obrigatório.' };
      const r = await runAdbSafe(['-s', serial, 'shell', `head -c 65536 "${targetPath}"`], 10000);
      return { ok: r.ok, output: { path: targetPath, content: r.stdout }, error: r.ok ? undefined : r.stderr };
    }
    case 'open_app': {
      const pkg = String(payload.packageName || payload.app || '').trim();
      if (!PACKAGE_REGEX.test(pkg)) return { ok: false, error: 'Nome de pacote Android inválido (ex: com.whatsapp).' };
      const r = await runAdbSafe(['-s', serial, 'shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], 8000);
      return { ok: r.ok, output: { packageName: pkg, stdout: r.stdout }, error: r.ok ? undefined : r.stderr };
    }
    case 'input_tap': {
      const x = Math.round(Number(payload.x || 0));
      const y = Math.round(Number(payload.y || 0));
      const r = await runAdbSafe(['-s', serial, 'shell', 'input', 'tap', String(x), String(y)], 6000);
      return { ok: r.ok, output: { tapped: { x, y } }, error: r.ok ? undefined : r.stderr };
    }
    case 'input_swipe': {
      const x1 = Math.round(Number(payload.x1 || 300));
      const y1 = Math.round(Number(payload.y1 || 900));
      const x2 = Math.round(Number(payload.x2 || 300));
      const y2 = Math.round(Number(payload.y2 || 300));
      const dur = Math.round(Number(payload.durationMs || 300));
      const r = await runAdbSafe(['-s', serial, 'shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(dur)], 6000);
      return { ok: r.ok, output: { swiped: { x1, y1, x2, y2, dur } }, error: r.ok ? undefined : r.stderr };
    }
    case 'input_text': {
      const txt = String(payload.text || '').replace(/\s+/g, '%s').replace(/["`$\\;&|]/g, '');
      const r = await runAdbSafe(['-s', serial, 'shell', 'input', 'text', txt], 6000);
      return { ok: r.ok, output: { typed: payload.text }, error: r.ok ? undefined : r.stderr };
    }
    case 'input_keyevent': {
      const key = String(payload.key || 'KEYCODE_HOME').replace(/[^A-Z0-9_]/gi, '');
      const r = await runAdbSafe(['-s', serial, 'shell', 'input', 'keyevent', key], 6000);
      return { ok: r.ok, output: { keyevent: key }, error: r.ok ? undefined : r.stderr };
    }
    case 'list_packages': {
      const r = await runAdbSafe(['-s', serial, 'shell', 'pm', 'list', 'packages', '-3'], 10000);
      const packages = r.stdout
        .split('\n')
        .map((l) => l.replace(/^package:/, '').trim())
        .filter(Boolean);
      return { ok: r.ok, output: { count: packages.length, packages }, error: r.ok ? undefined : r.stderr };
    }
    case 'battery_info': {
      const r = await runAdbSafe(['-s', serial, 'shell', 'dumpsys', 'battery'], 6000);
      return { ok: r.ok, output: { raw: r.stdout }, error: r.ok ? undefined : r.stderr };
    }
    case 'notifications': {
      const r = await runAdbSafe(['-s', serial, 'shell', 'dumpsys', 'notification', '--noredact'], 8000);
      const titles = Array.from(r.stdout.matchAll(/android\.title=([^\n]+)/g)).map((m) => m[1].trim()).slice(0, 25);
      return { ok: r.ok, output: { titles, rawPreview: r.stdout.slice(0, 2000) }, error: r.ok ? undefined : r.stderr };
    }
    default:
      return { ok: false, error: `Tipo de comando ADB não suportado: ${commandType}` };
  }
}

// ==========================================
// UNIFIED COMMAND DISPATCHER (CLOUD + DESKTOP + ANDROID + IOS)
// ==========================================

export async function dispatchDeviceCommand(
  deviceId: string,
  commandType: string,
  payload: Record<string, unknown>,
  timeoutMs = 20000
): Promise<DeviceCommandDispatchResult> {
  const device = memory.getPairedDeviceById(deviceId);
  if (!device) {
    return {
      ok: false,
      commandId: '',
      transport: 'unknown',
      error: `Dispositivo "${deviceId}" não encontrado.`,
    };
  }

  const commandId = `dcmd_${crypto.randomBytes(6).toString('hex')}`;
  memory.createDeviceCommand({
    id: commandId,
    deviceId: device.id,
    commandType,
    payload,
    status: 'running',
  });

  // 1. Direct WebSocket connected agent (Android Termux, Android Native App, Desktop Daemon)
  const directWs = agentSockets.get(device.id);
  if (directWs && directWs.readyState === WebSocket.OPEN) {
    return new Promise<DeviceCommandDispatchResult>((resolve) => {
      const timer = setTimeout(() => {
        pendingRpcs.delete(commandId);
        memory.updateDeviceCommandResult(commandId, 'error', { error: 'Tempo esgotado aguardando resposta do dispositivo.' });
        resolve({
          ok: false,
          commandId,
          transport: device.transport,
          error: 'Tempo esgotado aguardando resposta do agente no dispositivo.',
        });
      }, timeoutMs);

      pendingRpcs.set(commandId, { resolve, timer, deviceId: device.id, transport: device.transport });
      directWs.send(
        JSON.stringify({
          type: 'exec_command',
          commandId,
          commandType,
          payload,
        })
      );
    });
  }

  // 2. Desktop ADB Relay (Android connected via USB/Wi-Fi to a paired Linux/Windows Desktop)
  if (device.transport === 'adb_desktop_relay' && device.parent_bridge_id) {
    const bridgeWs = agentSockets.get(device.parent_bridge_id);
    if (bridgeWs && bridgeWs.readyState === WebSocket.OPEN) {
      return new Promise<DeviceCommandDispatchResult>((resolve) => {
        const timer = setTimeout(() => {
          pendingRpcs.delete(commandId);
          memory.updateDeviceCommandResult(commandId, 'error', { error: 'Timeout na ponte ADB Desktop.' });
          resolve({
            ok: false,
            commandId,
            transport: 'adb_desktop_relay',
            error: 'Timeout aguardando resposta da ponte ADB no computador.',
          });
        }, timeoutMs);

        pendingRpcs.set(commandId, { resolve, timer, deviceId: device.id, transport: 'adb_desktop_relay' });
        bridgeWs.send(
          JSON.stringify({
            type: 'adb_exec',
            commandId,
            serial: device.serial_or_uid,
            commandType,
            payload,
          })
        );
      });
    }
    memory.updateDeviceCommandResult(commandId, 'error', { error: 'Computador ponte ADB desconectado.' });
    return {
      ok: false,
      commandId,
      transport: 'adb_desktop_relay',
      error: 'O computador ponte (Desktop Agent) que hospeda este Android via ADB está offline.',
    };
  }

  // 3. Host Local ADB (direct USB/Wi-Fi on the same machine running Aegis)
  if (device.transport === 'adb_local' && device.serial_or_uid) {
    const adbRes = await executeLocalAdbCommand(device.serial_or_uid, commandType, payload);
    memory.updateDeviceCommandResult(commandId, adbRes.ok ? 'completed' : 'error', adbRes.ok ? adbRes.output : { error: adbRes.error });
    broadcastOperatorEvent('command_update', { deviceId: device.id, commandId, status: adbRes.ok ? 'completed' : 'error', result: adbRes });
    return {
      ok: adbRes.ok,
      commandId,
      transport: 'adb_local',
      output: adbRes.output,
      error: adbRes.error,
    };
  }

  // 4. iOS Shortcuts / PWA asynchronous command queue
  if (device.transport === 'ios_shortcut' || device.transport === 'pwa_browser') {
    memory.updateDeviceCommandResult(commandId, 'running', null);
    // Keep as pending so iOS Shortcut / PWA poll picks it up
    memory.createDeviceCommand({
      id: `${commandId}_q`,
      deviceId: device.id,
      commandType,
      payload,
      status: 'pending',
    });
    memory.updateDeviceCommandResult(commandId, 'completed', {
      queued: true,
      queuedCommandId: `${commandId}_q`,
      note: 'Comando enfileirado para execução via Atalho iOS / PWA.',
    });
    broadcastOperatorEvent('command_update', { deviceId: device.id, commandId: `${commandId}_q`, status: 'pending' });
    return {
      ok: true,
      commandId: `${commandId}_q`,
      queued: true,
      transport: device.transport,
      output: {
        queued: true,
        message: 'Comando enfileirado. Execute o Atalho "Aegis Sync" no iPhone/iPad (ou aguarde a automação agendada) para efetivar.',
      },
    };
  }

  memory.updateDeviceCommandResult(commandId, 'error', { error: 'Dispositivo offline no momento.' });
  return {
    ok: false,
    commandId,
    transport: device.transport,
    error: `O dispositivo "${device.name}" está offline. Conecte o agente (Termux, App Android ou Ponte Desktop ADB) e tente novamente.`,
  };
}

// ==========================================
// REAL-TIME WEBSOCKET SERVER (/api/devices/ws)
// ==========================================

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const map: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      map[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return map;
}

export function attachDeviceWebSocketServer(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    try {
      const parsed = new URL(req.url || '/', 'http://localhost');
      if (parsed.pathname !== '/api/devices/ws') {
        return; // Leave /api/live and Vite untouched
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const parsed = new URL(req.url || '/', 'http://localhost');
    const role = parsed.searchParams.get('role') || 'agent';

    // Operator web UI subscription channel
    if (role === 'operator') {
      const querySession = parsed.searchParams.get('session')?.trim();
      const cookies = parseCookieHeader(req.headers.cookie);
      const sessionToken = querySession || cookies.aegis_session || '';
      const user = sessionToken ? memory.getSessionUser(sessionToken) : null;
      if (!user) {
        ws.close(4401, 'Unauthorized');
        return;
      }

      operatorSockets.add(ws);
      ws.send(
        JSON.stringify({
          event: 'devices_snapshot',
          data: memory.listPairedDevices(user.id).map(sanitizeDeviceRecord),
        })
      );

      ws.on('close', () => operatorSockets.delete(ws));
      ws.on('error', () => operatorSockets.delete(ws));
      return;
    }

    // Device Agent channel (Android Termux / Native Kotlin App / Desktop ADB Bridge)
    let boundDeviceId: string | null = null;
    const rawHeaderToken =
      parsed.searchParams.get('token')?.trim() ||
      (typeof req.headers['x-aegis-device-token'] === 'string' ? req.headers['x-aegis-device-token'].trim() : '');

    if (rawHeaderToken) {
      const existing = memory.findPairedDeviceByTokenHash(hashDeviceToken(rawHeaderToken));
      if (existing) {
        boundDeviceId = existing.id;
        agentSockets.set(existing.id, ws);
        memory.updateDeviceStatus(existing.id, 'online');
        const sanitized = sanitizeDeviceRecord(memory.getPairedDeviceById(existing.id)!);
        ws.send(JSON.stringify({ type: 'authenticated', deviceId: existing.id, name: existing.name }));
        broadcastOperatorEvent('device_update', sanitized);
        broadcastMeshPeers(existing.user_id);
      }
    }

    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30_000);

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        let type = String(msg.type || '');

        // Unified "hello" handshake used by Android Native App & Desktop Auto-Mesh
        if (type === 'hello') {
          if (typeof msg.token === 'string' && msg.token.trim()) {
            type = 'auth';
          } else if (typeof msg.pairingCode === 'string' && msg.pairingCode.trim()) {
            type = 'pair';
          } else if (typeof msg.googleAccessToken === 'string' && msg.googleAccessToken.trim()) {
            type = 'account_pair';
          }
        }

        // Automatic zero-code pairing via verified Google Account OAuth token
        if (type === 'account_pair') {
          const gToken = String(msg.googleAccessToken || '').trim();
          const verifiedEmail = await verifyGoogleAccessTokenEmail(gToken);
          if (!verifiedEmail) {
            ws.send(JSON.stringify({ type: 'error', message: 'Token Google inválido para auto-pareamento na malha.' }));
            return;
          }
          const user = memory.findUserByIdentifier(verifiedEmail);
          if (!user) {
            ws.send(JSON.stringify({ type: 'error', message: `Conta ${verifiedEmail} ainda não registrada no Aegis Cloud.` }));
            return;
          }

          const { rawToken, tokenHash } = generateDeviceToken();
          const platform = (['android', 'ios', 'linux', 'windows', 'web'].includes(String(msg.platform))
            ? String(msg.platform)
            : 'linux') as memory.DevicePlatform;
          const transport = (['termux_ws', 'android_app_ws', 'desktop_ws', 'ios_shortcut', 'pwa_browser'].includes(String(msg.transport))
            ? String(msg.transport)
            : platform === 'android'
            ? 'android_app_ws'
            : 'desktop_ws') as memory.DeviceTransport;
          const serialOrUid = String(msg.serialOrUid || `${platform}_${crypto.randomBytes(4).toString('hex')}`).slice(0, 80);
          const deterministicId = `mesh_${crypto.createHash('sha256').update(`${user.id}:${serialOrUid}`).digest('hex').slice(0, 12)}`;

          const created = memory.upsertPairedDevice({
            id: deterministicId,
            userId: user.id,
            name: String(msg.name || `Dispositivo ${platform.toUpperCase()}`),
            platform,
            transport,
            serialOrUid,
            tokenHash,
            status: 'online',
            capabilities: Array.isArray(msg.capabilities) ? msg.capabilities.map(String) : [],
            telemetry: typeof msg.telemetry === 'object' && msg.telemetry ? (msg.telemetry as Record<string, unknown>) : {},
          });

          boundDeviceId = created.id;
          agentSockets.set(created.id, ws);
          ws.send(
            JSON.stringify({
              type: 'paired',
              deviceId: created.id,
              token: rawToken,
              name: created.name,
              autoPairedBy: 'google_account',
            })
          );
          broadcastOperatorEvent('device_update', sanitizeDeviceRecord(created));
          broadcastMeshPeers(user.id);
          return;
        }

        if (type === 'pair') {
          const code = String(msg.pairingCode || '').trim();
          const codeRec = memory.consumeDevicePairingCode(code);
          if (!codeRec) {
            ws.send(JSON.stringify({ type: 'error', message: 'Código de pareamento inválido ou expirado.' }));
            return;
          }
          const { rawToken, tokenHash } = generateDeviceToken();
          const devId = `dev_${crypto.randomBytes(6).toString('hex')}`;
          const platform = (['android', 'ios', 'linux', 'windows', 'web'].includes(String(msg.platform))
            ? String(msg.platform)
            : codeRec.platform) as memory.DevicePlatform;
          const transport = (['termux_ws', 'android_app_ws', 'desktop_ws', 'ios_shortcut', 'pwa_browser'].includes(String(msg.transport))
            ? String(msg.transport)
            : platform === 'android'
            ? 'android_app_ws'
            : 'desktop_ws') as memory.DeviceTransport;

          const created = memory.upsertPairedDevice({
            id: devId,
            userId: codeRec.user_id,
            name: String(msg.name || codeRec.label || `Dispositivo ${platform}`),
            platform,
            transport,
            serialOrUid: String(msg.serialOrUid || devId),
            tokenHash,
            status: 'online',
            capabilities: Array.isArray(msg.capabilities) ? msg.capabilities.map(String) : [],
            telemetry: typeof msg.telemetry === 'object' && msg.telemetry ? (msg.telemetry as Record<string, unknown>) : {},
          });

          boundDeviceId = created.id;
          agentSockets.set(created.id, ws);
          ws.send(JSON.stringify({ type: 'paired', deviceId: created.id, token: rawToken, name: created.name }));
          broadcastOperatorEvent('device_update', sanitizeDeviceRecord(created));
          broadcastMeshPeers(codeRec.user_id);
          return;
        }

        if (type === 'auth' && typeof msg.token === 'string') {
          const found = memory.findPairedDeviceByTokenHash(hashDeviceToken(msg.token));
          if (!found) {
            ws.send(JSON.stringify({ type: 'error', message: 'Token de dispositivo inválido.' }));
            return;
          }
          boundDeviceId = found.id;
          agentSockets.set(found.id, ws);
          memory.updateDeviceStatus(found.id, 'online');
          const updated = memory.getPairedDeviceById(found.id)!;
          ws.send(JSON.stringify({ type: 'authenticated', deviceId: found.id, name: found.name }));
          broadcastOperatorEvent('device_update', sanitizeDeviceRecord(updated));
          broadcastMeshPeers(found.user_id);
          return;
        }

        if (!boundDeviceId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Dispositivo não autenticado. Envie pair, auth ou account_pair.' }));
          return;
        }

        if (type === 'get_peers') {
          const me = memory.getPairedDeviceById(boundDeviceId);
          if (me) broadcastMeshPeers(me.user_id);
          return;
        }

        if (type === 'peer_command') {
          const requestId = String(msg.requestId || `pr_${Date.now()}`);
          const targetDeviceId = String(msg.targetDeviceId || '').trim();
          const commandType = String(msg.commandType || '').trim();
          const payload = typeof msg.payload === 'object' && msg.payload ? (msg.payload as Record<string, unknown>) : {};
          const sender = memory.getPairedDeviceById(boundDeviceId);
          const target = targetDeviceId ? memory.getPairedDeviceById(targetDeviceId) : null;

          if (!sender || !target || sender.user_id !== target.user_id) {
            ws.send(JSON.stringify({ type: 'peer_command_result', requestId, ok: false, error: 'Dispositivo destino não pertence à sua malha.' }));
            return;
          }
          if (isDestructiveDeviceCommand(commandType, payload)) {
            ws.send(JSON.stringify({ type: 'peer_command_result', requestId, ok: false, error: 'Comando destrutivo bloqueado via relay automático; execute diretamente no dispositivo ou aprove no painel.' }));
            return;
          }
          const result = await dispatchDeviceCommand(target.id, commandType, payload, 20_000);
          ws.send(
            JSON.stringify({
              type: 'peer_command_result',
              requestId,
              targetDeviceId: target.id,
              ok: result.ok,
              transport: result.transport,
              output: result.output,
              error: result.error,
            })
          );
          return;
        }

        if (type === 'clipboard_broadcast') {
          const text = String(msg.text || '').slice(0, 32_768);
          const sender = memory.getPairedDeviceById(boundDeviceId);
          if (!sender || !text) return;
          const peers = memory.listPairedDevices(sender.user_id);
          const frame = JSON.stringify({
            type: 'clipboard_sync',
            fromDeviceId: sender.id,
            fromName: sender.name,
            text,
            timestamp: new Date().toISOString(),
          });
          for (const p of peers) {
            if (p.id === sender.id) continue;
            const sock = agentSockets.get(p.id);
            if (sock && sock.readyState === WebSocket.OPEN) {
              sock.send(frame);
            }
          }
          broadcastOperatorEvent('clipboard_sync', { fromDeviceId: sender.id, fromName: sender.name, text });
          return;
        }

        if (type === 'telemetry' || type === 'snapshot') {
          const updated = memory.updateDeviceSnapshots({
            id: boundDeviceId,
            telemetry: typeof msg.telemetry === 'object' && msg.telemetry ? (msg.telemetry as Record<string, unknown>) : undefined,
            storageSnapshot: typeof msg.storage === 'object' && msg.storage ? (msg.storage as Record<string, unknown>) : undefined,
            appsSnapshot: Array.isArray(msg.apps) ? msg.apps : undefined,
            notificationsSnapshot: Array.isArray(msg.notifications) ? msg.notifications : undefined,
            filesSnapshot: Array.isArray(msg.files) ? msg.files : undefined,
            capabilities: Array.isArray(msg.capabilities) ? msg.capabilities.map(String) : undefined,
          });
          if (updated) {
            broadcastOperatorEvent('device_update', sanitizeDeviceRecord(updated));
            broadcastMeshPeers(updated.user_id);
          }
          return;
        }

        if (type === 'adb_devices' && Array.isArray(msg.devices)) {
          const bridge = memory.getPairedDeviceById(boundDeviceId);
          memory.markBridgeChildrenOffline(boundDeviceId);
          for (const item of msg.devices as Array<Record<string, unknown>>) {
            const serial = String(item.serial || '');
            if (!serial || !SERIAL_REGEX.test(serial)) continue;
            const childId = `adb_${boundDeviceId}_${serial.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
            const child = memory.upsertPairedDevice({
              id: childId,
              userId: bridge?.user_id || 0,
              name: String(item.model || serial) + ' (via Desktop ADB)',
              platform: 'android',
              transport: 'adb_desktop_relay',
              serialOrUid: serial,
              parentBridgeId: boundDeviceId,
              status: 'online',
              capabilities: [
                'shell',
                'list_files',
                'read_file',
                'open_app',
                'input_tap',
                'input_swipe',
                'input_text',
                'input_keyevent',
                'list_packages',
                'notifications',
                'battery_info',
                'storage_info',
              ],
              telemetry: typeof item.telemetry === 'object' && item.telemetry ? (item.telemetry as Record<string, unknown>) : { serial, bridge: bridge?.name },
              storageSnapshot: typeof item.storage === 'object' && item.storage ? (item.storage as Record<string, unknown>) : undefined,
              appsSnapshot: Array.isArray(item.apps) ? item.apps : undefined,
              notificationsSnapshot: Array.isArray(item.notifications) ? item.notifications : undefined,
              filesSnapshot: Array.isArray(item.files) ? item.files : undefined,
            });
            broadcastOperatorEvent('device_update', sanitizeDeviceRecord(child));
          }
          if (bridge) broadcastMeshPeers(bridge.user_id);
          return;
        }

        if (type === 'command_result') {
          const commandId = String(msg.commandId || '');
          const ok = Boolean(msg.ok);
          const output = msg.output;
          const error = msg.error ? String(msg.error) : undefined;
          memory.updateDeviceCommandResult(commandId, ok ? 'completed' : 'error', ok ? output : { error });

          const rpc = pendingRpcs.get(commandId);
          if (rpc) {
            clearTimeout(rpc.timer);
            pendingRpcs.delete(commandId);
            rpc.resolve({
              ok,
              commandId,
              transport: rpc.transport,
              output,
              error,
            });
          }
          broadcastOperatorEvent('command_update', {
            deviceId: boundDeviceId,
            commandId,
            status: ok ? 'completed' : 'error',
            output,
            error,
          });
        }
      } catch (err) {
        console.error('Device WS message error:', err);
      }
    });

    const cleanup = () => {
      clearInterval(pingInterval);
      if (boundDeviceId && agentSockets.get(boundDeviceId) === ws) {
        agentSockets.delete(boundDeviceId);
        memory.updateDeviceStatus(boundDeviceId, 'offline');
        memory.markBridgeChildrenOffline(boundDeviceId);
        const rec = memory.getPairedDeviceById(boundDeviceId);
        if (rec) {
          broadcastOperatorEvent('device_update', sanitizeDeviceRecord(rec));
          broadcastMeshPeers(rec.user_id);
        }
      }
    };

    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });
}

// ==========================================
// UNIFIED DEVICE CONTEXT SUMMARY FOR AI ORCHESTRATOR
// ==========================================

export function getDevicesContextSummaryForAI(userId?: number): string {
  const devices = memory.listPairedDevices(userId).map(sanitizeDeviceRecord);
  if (devices.length === 0) {
    return 'Nenhum dispositivo móvel/remoto pareado ainda (o usuário pode vincular Android via ADB/Termux/App ou iOS via PWA/Atalhos no módulo Dispositivos).';
  }
  return devices
    .map((d) => {
      const batt = d.telemetry.batteryPercent !== undefined && d.telemetry.batteryPercent !== null
        ? ` | Bateria: ${d.telemetry.batteryPercent}%`
        : '';
      const appsCnt = d.apps.length > 0 ? ` | Apps: ${d.apps.length}` : '';
      const notifCnt = d.notifications.length > 0 ? ` | Notificações: ${d.notifications.length}` : '';
      const filesCnt = d.files.length > 0 ? ` | Arquivos indexados: ${d.files.length}` : '';
      return `- [${d.id}] ${d.name} (${d.platform}/${d.transport}) · ${d.status.toUpperCase()}${batt}${appsCnt}${notifCnt}${filesCnt}`;
    })
    .join('\n');
}

export function searchAcrossAllDevicesSnapshots(query: string, userId?: number): Array<{
  deviceId: string;
  deviceName: string;
  platform: string;
  category: 'file' | 'app' | 'notification' | 'telemetry';
  match: string;
}> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const devices = memory.listPairedDevices(userId).map(sanitizeDeviceRecord);
  const hits: Array<{
    deviceId: string;
    deviceName: string;
    platform: string;
    category: 'file' | 'app' | 'notification' | 'telemetry';
    match: string;
  }> = [];

  for (const d of devices) {
    for (const f of d.files) {
      const str = typeof f === 'string' ? f : JSON.stringify(f);
      if (str.toLowerCase().includes(q)) {
        hits.push({ deviceId: d.id, deviceName: d.name, platform: d.platform, category: 'file', match: str.slice(0, 220) });
      }
    }
    for (const a of d.apps) {
      const str = typeof a === 'string' ? a : JSON.stringify(a);
      if (str.toLowerCase().includes(q)) {
        hits.push({ deviceId: d.id, deviceName: d.name, platform: d.platform, category: 'app', match: str.slice(0, 180) });
      }
    }
    for (const n of d.notifications) {
      const str = typeof n === 'string' ? n : JSON.stringify(n);
      if (str.toLowerCase().includes(q)) {
        hits.push({ deviceId: d.id, deviceName: d.name, platform: d.platform, category: 'notification', match: str.slice(0, 220) });
      }
    }
    const telStr = JSON.stringify(d.telemetry);
    if (telStr.toLowerCase().includes(q)) {
      hits.push({ deviceId: d.id, deviceName: d.name, platform: d.platform, category: 'telemetry', match: telStr.slice(0, 220) });
    }
  }
  return hits.slice(0, 40);
}

// ==========================================
// ANDROID TERMUX SYSTEM AGENT & KOTLIN COMPANION GENERATORS
// ==========================================

export function getAndroidTermuxAgentScript(serverOrigin: string): string {
  const wsBase = serverOrigin.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://').replace(/\/$/, '');
  return `#!/usr/bin/env node
/**
 * Aegis Android System Agent (Termux + Termux:API + Shizuku/ADB Localhost)
 * Conecta diretamente à nuvem Aegis via WebSocket persistente para telemetria total,
 * acesso a arquivos (/sdcard), apps, notificações e controle a nível de sistema.
 */
import { exec, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const CONFIG_DIR = path.join(os.homedir(), '.aegis-android');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });

const SERVER_WS = process.env.AEGIS_WS_URL || '${wsBase}/api/devices/ws';
const PAIRING_CODE = process.env.AEGIS_PAIR_CODE || process.argv[2] || '';
const DEVICE_NAME = process.env.AEGIS_DEVICE_NAME || ('Android ' + os.hostname());

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch { return {}; }
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

async function tryCmd(cmd, timeout = 5000) {
  try {
    const { stdout } = await execAsync(cmd, { timeout, maxBuffer: 1024 * 1024 });
    return (stdout || '').trim();
  } catch {
    return '';
  }
}

async function collectFullSnapshot() {
  const battRaw = await tryCmd('termux-battery-status', 3000);
  let battery = {};
  try { battery = JSON.parse(battRaw || '{}'); } catch {}

  const wifiRaw = await tryCmd('termux-wifi-connectioninfo', 3000);
  let wifi = {};
  try { wifi = JSON.parse(wifiRaw || '{}'); } catch {}

  const dfOut = await tryCmd('df -h /sdcard 2>/dev/null || df -h ~', 3000);
  const androidVer = await tryCmd('getprop ro.build.version.release', 2000);
  const model = await tryCmd('getprop ro.product.model', 2000);
  const hasRish = Boolean(await tryCmd('command -v rish', 1500));
  const hasAdb = Boolean(await tryCmd('command -v adb', 1500));

  let notifications = [];
  const notifRaw = await tryCmd('termux-notification-list', 3500);
  try {
    const parsed = JSON.parse(notifRaw || '[]');
    if (Array.isArray(parsed)) {
      notifications = parsed.slice(0, 30).map((n) => ({
        packageName: n.packageName,
        title: n.title,
        content: n.content,
        when: n.when,
      }));
    }
  } catch {}

  let apps = [];
  const pkgOut = await tryCmd(hasRish ? 'rish -c "pm list packages -3"' : 'pm list packages -3', 4500);
  if (pkgOut) {
    apps = pkgOut.split('\\n').map((l) => l.replace(/^package:/, '').trim()).filter(Boolean).slice(0, 150);
  }

  let files = [];
  const sdcardRoot = fs.existsSync('/sdcard') ? '/sdcard' : os.homedir();
  try {
    files = fs.readdirSync(sdcardRoot, { withFileTypes: true }).slice(0, 80).map((e) => ({
      name: e.name,
      path: path.join(sdcardRoot, e.name),
      type: e.isDirectory() ? 'directory' : 'file',
    }));
  } catch {}

  return {
    telemetry: {
      model: model || DEVICE_NAME,
      androidVersion: androidVer || os.release(),
      batteryPercent: typeof battery.percentage === 'number' ? battery.percentage : null,
      charging: battery.status === 'CHARGING' || battery.status === 'FULL',
      temperatureC: typeof battery.temperature === 'number' ? battery.temperature : null,
      wifiSsid: wifi.ssid || null,
      wifiIp: wifi.ip || null,
      totalMemMb: Math.round(os.totalmem() / 1048576),
      freeMemMb: Math.round(os.freemem() / 1048576),
      shizukuReady: hasRish,
      adbLocalReady: hasAdb,
      uptimeSeconds: Math.round(os.uptime()),
    },
    storage: { raw: dfOut, root: sdcardRoot },
    apps,
    notifications,
    files,
    capabilities: [
      'shell', 'list_files', 'read_file', 'write_file', 'open_app',
      'input_tap', 'input_swipe', 'input_text', 'input_keyevent',
      'tts_speak', 'notify', 'clipboard_get', 'clipboard_set', 'torch', 'vibrate',
      ...(hasRish ? ['shizuku_system_shell'] : []),
    ],
  };
}

async function execSystemShell(cmd, preferShizuku = false) {
  const hasRish = preferShizuku && Boolean(await tryCmd('command -v rish', 1500));
  if (hasRish) {
    return execFileAsync('rish', ['-c', cmd], { timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
  }
  return execAsync(cmd, { timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
}

async function handleCommand(commandType, payload) {
  switch (commandType) {
    case 'shell':
    case 'adb_shell': {
      const { stdout, stderr } = await execSystemShell(String(payload.command || ''), Boolean(payload.privileged));
      return { stdout, stderr };
    }
    case 'list_files': {
      const dir = String(payload.path || (fs.existsSync('/sdcard') ? '/sdcard' : os.homedir()));
      const entries = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 150).map((e) => {
        const full = path.join(dir, e.name);
        let sizeBytes = 0;
        try { sizeBytes = fs.statSync(full).size; } catch {}
        return { name: e.name, path: full, type: e.isDirectory() ? 'directory' : 'file', sizeBytes };
      });
      return { path: dir, entries };
    }
    case 'read_file': {
      const fp = String(payload.path || '');
      const content = fs.readFileSync(fp, 'utf-8').slice(0, 120000);
      return { path: fp, content };
    }
    case 'write_file': {
      const fp = String(payload.path || '');
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, String(payload.content || ''), 'utf-8');
      return { path: fp, written: true };
    }
    case 'open_app': {
      const pkg = String(payload.packageName || payload.app || '').replace(/[^a-zA-Z0-9._-]/g, '');
      const { stdout, stderr } = await execSystemShell('monkey -p ' + pkg + ' -c android.intent.category.LAUNCHER 1', true);
      return { packageName: pkg, stdout, stderr };
    }
    case 'input_tap': {
      const x = Math.round(Number(payload.x || 0));
      const y = Math.round(Number(payload.y || 0));
      const { stdout } = await execSystemShell('input tap ' + x + ' ' + y, true);
      return { tapped: { x, y }, stdout };
    }
    case 'input_swipe': {
      const { x1 = 300, y1 = 900, x2 = 300, y2 = 300, durationMs = 300 } = payload;
      await execSystemShell(\`input swipe \${Number(x1)} \${Number(y1)} \${Number(x2)} \${Number(y2)} \${Number(durationMs)}\`, true);
      return { swiped: true };
    }
    case 'input_text': {
      const clean = String(payload.text || '').replace(/\\s+/g, '%s').replace(/["'\`$\\\\;&|]/g, '');
      await execSystemShell('input text ' + clean, true);
      return { typed: payload.text };
    }
    case 'input_keyevent': {
      const key = String(payload.key || 'KEYCODE_HOME').replace(/[^A-Z0-9_]/gi, '');
      await execSystemShell('input keyevent ' + key, true);
      return { keyevent: key };
    }
    case 'tts_speak': {
      await execFileAsync('termux-tts-speak', [String(payload.text || '')], { timeout: 10000 });
      return { spoken: true };
    }
    case 'notify': {
      await execFileAsync('termux-notification', ['--title', String(payload.title || 'Aegis'), '--content', String(payload.content || '')], { timeout: 6000 });
      return { notified: true };
    }
    case 'clipboard_get': {
      const { stdout } = await execFileAsync('termux-clipboard-get', [], { timeout: 5000 });
      return { text: stdout };
    }
    case 'clipboard_set': {
      await execFileAsync('termux-clipboard-set', [String(payload.text || '')], { timeout: 5000 });
      return { copied: true };
    }
    case 'torch': {
      const state = payload.enabled ? 'on' : 'off';
      await execFileAsync('termux-torch', [state], { timeout: 5000 });
      return { torch: state };
    }
    case 'vibrate': {
      await execFileAsync('termux-vibrate', ['-d', String(Number(payload.durationMs || 250))], { timeout: 5000 });
      return { vibrated: true };
    }
    case 'list_packages': {
      const snap = await collectFullSnapshot();
      return { count: snap.apps.length, packages: snap.apps };
    }
    case 'notifications': {
      const snap = await collectFullSnapshot();
      return { notifications: snap.notifications };
    }
    default:
      throw new Error('Comando não suportado: ' + commandType);
  }
}

async function connectLoop() {
  const cfg = loadConfig();
  const wsUrl = cfg.token ? SERVER_WS + '?token=' + encodeURIComponent(cfg.token) : SERVER_WS;
  const WSImpl = globalThis.WebSocket;
  if (!WSImpl) {
    console.error('Node.js v22+ necessário para WebSocket nativo.');
    process.exit(1);
  }

  console.log('[Aegis Android] Conectando a', SERVER_WS);
  const ws = new WSImpl(wsUrl);
  let snapTimer = null;

  ws.addEventListener('open', async () => {
    console.log('[Aegis Android] Canal WebSocket aberto.');
    const snap = await collectFullSnapshot();
    if (!cfg.token) {
      if (!PAIRING_CODE) {
        console.error('[Aegis Android] Informe o código de pareamento de 6 dígitos: node aegis-android-agent.mjs CODIGO');
        process.exit(1);
      }
      ws.send(JSON.stringify({
        type: 'pair',
        pairingCode: PAIRING_CODE,
        name: snap.telemetry.model || DEVICE_NAME,
        platform: 'android',
        transport: 'termux_ws',
        capabilities: snap.capabilities,
        telemetry: snap.telemetry,
      }));
    } else {
      ws.send(JSON.stringify({ type: 'snapshot', ...snap }));
    }

    snapTimer = setInterval(async () => {
      if (ws.readyState === 1) {
        const fresh = await collectFullSnapshot();
        ws.send(JSON.stringify({ type: 'snapshot', ...fresh }));
      }
    }, 25000);
  });

  ws.addEventListener('message', async (ev) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === 'paired' && msg.token) {
        saveConfig({ deviceId: msg.deviceId, token: msg.token, name: msg.name });
        console.log('[Aegis Android] Pareado com sucesso! ID:', msg.deviceId);
        const snap = await collectFullSnapshot();
        ws.send(JSON.stringify({ type: 'snapshot', ...snap }));
      } else if (msg.type === 'authenticated') {
        console.log('[Aegis Android] Autenticado como', msg.name);
      } else if (msg.type === 'exec_command') {
        try {
          const output = await handleCommand(msg.commandType, msg.payload || {});
          ws.send(JSON.stringify({ type: 'command_result', commandId: msg.commandId, ok: true, output }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'command_result', commandId: msg.commandId, ok: false, error: err?.message || String(err) }));
        }
      } else if (msg.type === 'error') {
        console.error('[Aegis Android] Erro do servidor:', msg.message);
      }
    } catch (e) {
      console.error('[Aegis Android] Erro ao processar mensagem:', e.message);
    }
  });

  ws.addEventListener('close', () => {
    if (snapTimer) clearInterval(snapTimer);
    console.log('[Aegis Android] Desconectado. Reconectando em 5s...');
    setTimeout(connectLoop, 5000);
  });

  ws.addEventListener('error', () => {
    try { ws.close(); } catch {}
  });
}

connectLoop();
`;
}

export function getAndroidTermuxInstallSh(serverOrigin: string, pairingCode = ''): string {
  const cleanOrigin = serverOrigin.replace(/\/$/, '');
  return `#!/data/data/com.termux/files/usr/bin/bash
set -e
echo "=== Instalador Aegis Android System Agent (Termux) ==="
pkg update -y && pkg install -y nodejs-lts curl termux-api
termux-setup-storage || true
mkdir -p ~/.aegis-android
curl -fsSL "${cleanOrigin}/api/devices/scripts/android-agent.mjs" -o ~/.aegis-android/aegis-android-agent.mjs
echo "Iniciando pareamento com Aegis Cloud..."
node ~/.aegis-android/aegis-android-agent.mjs "${pairingCode}"
`;
}

export async function buildAndroidKotlinCompanionZip(serverOrigin: string): Promise<Buffer> {
  const wsBase = serverOrigin.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://').replace(/\/$/, '');
  const zip = new JSZip();

  zip.file(
    'AndroidManifest.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.aegis.companion">
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
  <uses-permission android:name="android.permission.QUERY_ALL_PACKAGES" />
  <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
  <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />

  <application android:label="Aegis Companion" android:allowBackup="false">
    <service
      android:name=".AegisAccessibilityService"
      android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"
      android:exported="false">
      <intent-filter>
        <action android:name="android.accessibilityservice.AccessibilityService" />
      </intent-filter>
      <meta-data android:name="android.accessibilityservice" android:resource="@xml/aegis_accessibility_config" />
    </service>

    <service
      android:name=".AegisNotificationListener"
      android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"
      android:exported="false">
      <intent-filter>
        <action android:name="android.service.notification.NotificationListenerService" />
      </intent-filter>
    </service>
  </application>
</manifest>
`
  );

  zip.file(
    'res/xml/aegis_accessibility_config.xml',
    `<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
  android:accessibilityEventTypes="typeAllMask"
  android:accessibilityFeedbackType="feedbackGeneric"
  android:accessibilityFlags="flagReportViewIds|flagRetrieveInteractiveWindows"
  android:canPerformGestures="true"
  android:canRetrieveWindowContent="true"
  android:notificationTimeout="100" />
`
  );

  zip.file(
    'src/main/java/com/aegis/companion/AegisAccessibilityService.kt',
    `package com.aegis.companion

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.view.accessibility.AccessibilityEvent

class AegisAccessibilityService : AccessibilityService() {
  companion object {
    @Volatile var instance: AegisAccessibilityService? = null
  }

  override fun onServiceConnected() {
    instance = this
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    // Opcional: envia contexto de janela ativa ao AegisCloudSocketClient
  }

  override fun onInterrupt() {}

  fun performTap(x: Float, y: Float) {
    val path = Path().apply { moveTo(x, y) }
    val stroke = GestureDescription.StrokeDescription(path, 0L, 60L)
    dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
  }

  fun performGlobal(action: Int): Boolean = performGlobalAction(action)

  fun launchPackage(packageName: String): Boolean {
    val launchIntent: Intent = packageManager.getLaunchIntentForPackage(packageName) ?: return false
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    startActivity(launchIntent)
    return true
  }
}
`
  );

  zip.file(
    'src/main/java/com/aegis/companion/AegisCloudSocketClient.kt',
    `package com.aegis.companion

import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class AegisCloudSocketClient(
  private val serverWsUrl: String = "${wsBase}/api/devices/ws",
  private val deviceToken: String
) : WebSocketListener() {

  private val client = OkHttpClient.Builder()
    .pingInterval(25, TimeUnit.SECONDS)
    .build()

  private var socket: WebSocket? = null

  fun connect() {
    val req = Request.Builder()
      .url("\$serverWsUrl?token=\$deviceToken")
      .build()
    socket = client.newWebSocket(req, this)
  }

  override fun onMessage(webSocket: WebSocket, text: String) {
    val msg = JSONObject(text)
    if (msg.optString("type") == "exec_command") {
      val cmdId = msg.optString("commandId")
      val cmdType = msg.optString("commandType")
      val payload = msg.optJSONObject("payload") ?: JSONObject()
      val svc = AegisAccessibilityService.instance
      val ok = when (cmdType) {
        "input_tap" -> {
          svc?.performTap(payload.optDouble("x", 0.0).toFloat(), payload.optDouble("y", 0.0).toFloat())
          svc != null
        }
        "open_app" -> svc?.launchPackage(payload.optString("packageName")) ?: false
        "input_keyevent" -> when (payload.optString("key")) {
          "KEYCODE_HOME" -> svc?.performGlobal(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME) ?: false
          "KEYCODE_BACK" -> svc?.performGlobal(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK) ?: false
          else -> false
        }
        else -> false
      }
      val reply = JSONObject()
        .put("type", "command_result")
        .put("commandId", cmdId)
        .put("ok", ok)
        .put("output", JSONObject().put("executed", ok))
      webSocket.send(reply.toString())
    }
  }
}
`
  );

  zip.file(
    'README.md',
    `# Aegis Android Native Companion (Kotlin Starter)

Projeto base Kotlin para controle nativo de interface Android via \`AccessibilityService\` + \`NotificationListenerService\` conectado em tempo real ao Aegis Cloud (\`${wsBase}/api/devices/ws\`).

## Alternativas ainda mais rápidas (sem precisar compilar APK):
1. **ADB pelo Desktop Agent (Linux/Windows)**: Plugue o Android via USB ou Depuração Wi-Fi (\`adb connect\`) — o Aegis Desktop detecta e libera controle total pela nuvem e localmente sem instalar nenhum app no celular!
2. **Termux System Agent**: Cole o comando único do módulo Dispositivos no Termux para controle direto da nuvem (inclusive com Shizuku/rish para privilégios de sistema).
`
  );

  return zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' });
}
