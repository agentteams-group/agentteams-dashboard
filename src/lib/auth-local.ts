// Local authentication module — fallback when Higress Console is not configured.
// Stores admin credentials and session secret in a JSON file with scrypt-hashed passwords.
import { randomBytes, scrypt, timingSafeEqual, createHmac } from 'crypto';
import { promisify } from 'util';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const scryptAsync = promisify(scrypt);

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

interface StoredUser {
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
}

interface StoredData {
  sessionSecret: string;
  users: StoredUser[];
}

function getDbPath(): string {
  return process.env.LOCAL_AUTH_DB || '/app/db/admin.json';
}

function readDb(): StoredData {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    return { sessionSecret: '', users: [] };
  }
  try {
    const data = JSON.parse(readFileSync(dbPath, 'utf-8'));
    // Migrate old format without sessionSecret
    if (!data.sessionSecret) {
      data.sessionSecret = randomBytes(32).toString('hex');
      writeDb(data);
    }
    return data;
  } catch {
    return { sessionSecret: '', users: [] };
  }
}

function writeDb(data: StoredData): void {
  const dbPath = getDbPath();
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

/** Get or create the persisted session secret. */
function getSessionSecret(): string {
  const db = readDb();
  if (!db.sessionSecret) {
    db.sessionSecret = randomBytes(32).toString('hex');
    writeDb(db);
  }
  return db.sessionSecret;
}

export async function hashPassword(password: string, salt?: string): Promise<{ hash: string; salt: string }> {
  const useSalt = salt || randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, useSalt, 64)) as Buffer;
  return { hash: hash.toString('hex'), salt: useSalt };
}

async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const { hash: computedHash } = await hashPassword(password, salt);
  return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(computedHash, 'hex'));
}

/**
 * Authenticate a user against the local user store.
 * On first login, creates the admin user automatically.
 */
export async function authenticateLocal(username: string, password: string): Promise<{ success: boolean; error?: string }> {
  const db = readDb();

  if (db.users.length === 0) {
    // First login — create the admin user.
    const { hash, salt } = await hashPassword(password);
    db.users.push({
      username,
      passwordHash: hash,
      salt,
      createdAt: new Date().toISOString(),
    });
    writeDb(db);
    return { success: true };
  }

  const user = db.users.find(u => u.username === username);
  if (!user) {
    return { success: false, error: 'Invalid username or password' };
  }

  const valid = await verifyPassword(password, user.passwordHash, user.salt);
  if (!valid) {
    return { success: false, error: 'Invalid username or password' };
  }

  return { success: true };
}

/**
 * Create a signed session token.
 */
export function createSessionToken(username: string): string {
  const secret = getSessionSecret();
  const payload = JSON.stringify({
    username,
    iat: Date.now(),
    exp: Date.now() + SESSION_MAX_AGE,
  });
  const encoded = Buffer.from(payload).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

/**
 * Validate a session token and return the username if valid.
 */
export function validateSessionToken(token: string): string | null {
  try {
    const secret = getSessionSecret();
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) return null;

    const expectedSig = createHmac('sha256', secret).update(encoded).digest('base64url');

    // Constant-time comparison
    if (signature.length !== expectedSig.length) return null;
    let diff = 0;
    for (let i = 0; i < signature.length; i++) {
      diff |= signature.charCodeAt(i) ^ expectedSig.charCodeAt(i);
    }
    if (diff !== 0) return null;

    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    if (payload.exp < Date.now()) return null;

    return payload.username;
  } catch {
    return null;
  }
}

/**
 * Check if Higress Console is configured.
 */
export function isHigressConfigured(): boolean {
  const url = process.env.HICLAW_AI_GATEWAY_ADMIN_URL;
  return !!url && url !== '';
}
