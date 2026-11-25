import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import * as memory from './memory.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const VAULT_KEY_PATH = path.join(DATA_DIR, '.vault_key');

function getVaultKeyBuffer(): Buffer {
  const envKey = process.env.AEGIS_VAULT_KEY?.trim();
  if (envKey) {
    return crypto.createHash('sha256').update(envKey).digest();
  }
  if (fs.existsSync(VAULT_KEY_PATH)) {
    const hex = fs.readFileSync(VAULT_KEY_PATH, 'utf-8').trim();
    if (hex.length === 64) {
      return Buffer.from(hex, 'hex');
    }
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(VAULT_KEY_PATH, key.toString('hex'), { mode: 0o600 });
  return key;
}

const VAULT_KEY = getVaultKeyBuffer();

export function encryptSecret(plaintext: string): { cipherText: string; iv: string; authTag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', VAULT_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    cipherText: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptSecret(cipherText: string, ivB64: string, tagB64: string): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', VAULT_KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherText, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function encryptPacked(plaintext: string): string {
  const { cipherText, iv, authTag } = encryptSecret(plaintext);
  return `${iv}.${authTag}.${cipherText}`;
}

export function decryptPacked(packed: string): string {
  const [iv, authTag, cipherText] = packed.split('.');
  if (!iv || !authTag || !cipherText) return '';
  return decryptSecret(cipherText, iv, authTag);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(keyHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function issueSession(res: Response, userId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  memory.createSession(token, userId, SESSION_TTL_MS);
  res.cookie('aegis_session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
  return token;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const map: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      map[k] = decodeURIComponent(v);
    }
  }
  return map;
}

export function extractSessionToken(req: Request): string | null {
  const headerToken = req.headers['x-aegis-session'];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies.aegis_session || null;
}

export function getAuthenticatedUser(req: Request): memory.LocalUserRecord | null {
  const token = extractSessionToken(req);
  if (!token) return null;
  return memory.getSessionUser(token);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Autenticação necessária. Faça login para acessar o Aegis.' });
  }
  (req as Request & { aegisUser?: memory.LocalUserRecord }).aegisUser = user;
  return next();
}

export function sanitizeUser(user: memory.LocalUserRecord) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.display_name,
    authProvider: user.auth_provider,
    createdAt: user.created_at,
  };
}
