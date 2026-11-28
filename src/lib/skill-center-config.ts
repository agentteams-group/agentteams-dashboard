/**
 * Nacos configuration is encrypted at rest on the Dashboard's persistent
 * volume. The master key is supplied only through the process environment;
 * it is never generated, persisted, logged, or returned by the API.
 *
 * Legacy deployments stored plaintext at skills/config/nacos.json in MinIO.
 * It is read only as a migration source: encrypt locally first, verify the
 * round-trip, and only then remove the old object.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';

const CONFIG_OBJECT_KEY = 'skills/config/nacos.json';
const ALGORITHM = 'aes-256-gcm';
const MAX_CONFIG_BYTES = 64 * 1024;

export const NACOS_PASSWORD_MASK = '__nacos-saved__';

export function isNacosPasswordMask(value: string | undefined): boolean {
  return value === NACOS_PASSWORD_MASK;
}

export function maskNacosConfig(config: NacosConfig | null): NacosConfig | null {
  if (!config?.password) return config;
  return { ...config, password: NACOS_PASSWORD_MASK };
}

export interface NacosConfig {
  registryUrl: string;
  namespace: string;
  alias?: string;
  protocol?: 'http' | 'https';
  apiPrefix?: string;
  mode?: 'services' | 'skills';
  username?: string;
  password?: string;
  lastSyncAt?: string;
  lastSyncStatus?: 'success' | 'error';
  lastSyncError?: string;
}

export interface SkillCenterConfigData {
  nacos?: NacosConfig;
  updatedAt: string;
}

interface EncryptedEnvelope {
  version: 1;
  algorithm: typeof ALGORITHM;
  iv: string;
  tag: string;
  ciphertext: string;
}

export function nacosConfigFilePath(): string {
  return process.env.NACOS_CONFIG_FILE
    || path.join(path.dirname(process.env.DASHBOARD_CONFIG_FILE || '/data/agentteams-dashboard/config.json'), 'nacos-config.enc.json');
}

function masterKey(): Buffer {
  const raw = process.env.AGENTTEAMS_SECRETS_MASTER_KEY || '';
  if (!/^[a-f\d]{64}$/i.test(raw)) {
    throw new Error('AGENTTEAMS_SECRETS_MASTER_KEY 未配置或格式无效（须为 64 位十六进制）');
  }
  return Buffer.from(raw, 'hex');
}

function isNacosConfig(value: unknown): value is NacosConfig {
  if (!value || typeof value !== 'object') return false;
  const cfg = value as Partial<NacosConfig>;
  return typeof cfg.registryUrl === 'string'
    && typeof cfg.namespace === 'string'
    && (cfg.password === undefined || typeof cfg.password === 'string');
}

function parseData(value: unknown): NacosConfig | null {
  if (!value || typeof value !== 'object') throw new Error('Nacos 配置格式无效');
  const data = value as SkillCenterConfigData;
  return isNacosConfig(data.nacos) ? data.nacos : null;
}

function encrypt(data: SkillCenterConfigData, key: Buffer): EncryptedEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return {
    version: 1,
    algorithm: ALGORITHM,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decrypt(envelope: EncryptedEnvelope, key: Buffer): SkillCenterConfigData {
  if (envelope.version !== 1 || envelope.algorithm !== ALGORITHM) {
    throw new Error('不支持的 Nacos 加密配置版本');
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext) as SkillCenterConfigData;
}

async function readEncrypted(file: string): Promise<{ data: SkillCenterConfigData; key: Buffer } | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  if (Buffer.byteLength(raw) > MAX_CONFIG_BYTES) throw new Error('Nacos 加密配置过大');
  const key = masterKey();
  return { data: decrypt(JSON.parse(raw) as EncryptedEnvelope, key), key };
}

async function writeEncrypted(file: string, data: SkillCenterConfigData): Promise<Buffer> {
  const key = masterKey();
  const body = JSON.stringify(encrypt(data, key));
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`;
  try {
    await fs.writeFile(tmp, body, { mode: 0o600 });
    await fs.chmod(tmp, 0o600);
    await fs.rename(tmp, file);
    await fs.chmod(file, 0o600);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
  return key;
}

async function readLegacy(): Promise<NacosConfig | null> {
  const bucket = getMinioBucket();
  if (!bucket) return null;
  const stream = await createMinioClient().getObject(bucket, CONFIG_OBJECT_KEY);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_CONFIG_BYTES) throw new Error('Nacos 配置过大');
    chunks.push(buf);
  }
  return parseData(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

async function removeLegacy(): Promise<void> {
  const bucket = getMinioBucket();
  if (!bucket) return;
  await createMinioClient().removeObject(bucket, CONFIG_OBJECT_KEY);
}

export async function getNacosConfig(): Promise<NacosConfig | null> {
  const file = nacosConfigFilePath();
  const saved = await readEncrypted(file);
  if (saved) return parseData(saved.data);

  // Missing local configuration: migrate only an actual legacy object. MinIO
  // missing-object/connection failures are not mistaken for "no config".
  let legacy: NacosConfig | null;
  try {
    legacy = await readLegacy();
  } catch (err) {
    if ((err as { code?: string }).code === 'NoSuchKey') return null;
    throw err;
  }
  if (!legacy) return null;
  const data = { nacos: legacy, updatedAt: new Date().toISOString() };
  const key = await writeEncrypted(file, data);
  const roundTrip = parseData(decrypt(JSON.parse(await fs.readFile(file, 'utf8')) as EncryptedEnvelope, key));
  if (JSON.stringify(roundTrip) !== JSON.stringify(legacy)) throw new Error('Nacos 配置迁移校验失败');
  await removeLegacy();
  return legacy;
}

export async function setNacosConfig(config: NacosConfig): Promise<void> {
  if (!isNacosConfig(config)) throw new Error('Nacos 配置格式无效');
  const file = nacosConfigFilePath();
  await writeEncrypted(file, { nacos: config, updatedAt: new Date().toISOString() });
  // Never remove the migration source until the encrypted value is readable.
  const saved = await readEncrypted(file);
  if (!saved || JSON.stringify(parseData(saved.data)) !== JSON.stringify(config)) {
    throw new Error('Nacos 配置写入校验失败');
  }
  await removeLegacy();
}

export async function clearNacosConfig(): Promise<void> {
  await fs.rm(nacosConfigFilePath(), { force: true });
  await removeLegacy();
}
