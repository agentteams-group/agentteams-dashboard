/**
 * Server-side audit log — append-only JSONL with size-based rotation.
 *
 * Stores governance events (mutations, RBAC denials, login attempts) on the
 * server so they survive client-side localStorage clears and remain
 * tamper-resistant. The format is line-delimited JSON, friendly to grep /
 * awk and to downstream pipelines that tail the file.
 *
 * Rotation is triggered when the active file exceeds {@link MAX_FILE_BYTES};
 * older archives keep their original date in the filename and are evicted
 * past {@link MAX_REK_FILES}.
 */

import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import * as path from 'node:path';

export type AuditSeverity = 'info' | 'warning' | 'error';

export interface AuditEventInput {
  actor?: string;
  actor_level?: number;
  entity_type: 'worker' | 'team' | 'manager' | 'human' | 'system';
  entity_name: string;
  action: string;
  details?: string;
  severity?: AuditSeverity;
  source_ip?: string;
}

export interface AuditEventRecord extends AuditEventInput {
  id: string;
  timestamp: number;
  severity: AuditSeverity;
}

export interface AuditQuery {
  from?: number;
  to?: number;
  entityType?: AuditEventInput['entity_type'];
  limit?: number;
}

const DEFAULT_LOG_PATH = path.resolve(process.cwd(), 'logs', 'audit.log.jsonl');
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_RETAINED_FILES = 30;
const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 1000;

let counter = 0;
function generateId(timestamp: number): string {
  counter = (counter + 1) & 0xffff;
  const rand = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `audit-${timestamp.toString(36)}-${counter.toString(36)}-${rand}`;
}

function resolveLogPath(): string {
  const override = process.env.AGENTTEAMS_AUDIT_LOG_PATH;
  return override && override.length > 0 ? path.resolve(override) : DEFAULT_LOG_PATH;
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function shouldRotate(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size >= MAX_FILE_BYTES;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

function archiveName(activePath: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const ext = path.extname(activePath);
  const base = activePath.slice(0, -ext.length);
  return `${base}.${date}${ext}`;
}

async function rotate(filePath: string): Promise<void> {
  if (!(await shouldRotate(filePath))) return;
  const target = archiveName(filePath);
  try {
    await fs.rename(filePath, target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  await pruneArchives(filePath);
}

async function pruneArchives(activePath: string): Promise<void> {
  const dir = path.dirname(activePath);
  const base = path.basename(activePath);
  const ext = path.extname(base);
  const stem = base.slice(0, -ext.length);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  const archives = entries
    .filter((name) => name.startsWith(`${stem}.`) && name.endsWith(ext) && name !== base)
    .sort();
  if (archives.length <= MAX_RETAINED_FILES) return;
  const toDelete = archives.slice(0, archives.length - MAX_RETAINED_FILES);
  await Promise.all(toDelete.map((name) => fs.unlink(path.join(dir, name)).catch(() => undefined)));
}

/** Internal helper exposed for tests so concurrent appends are not blocked. */
export async function appendRawLine(filePath: string, line: string): Promise<void> {
  await ensureDir(filePath);
  if (fsSync.existsSync(filePath)) {
    await rotate(filePath);
  }
  await fs.appendFile(filePath, line, 'utf8');
}

/**
 * Append an audit event. Always safe to call from request handlers; failures
 * are swallowed and logged so an audit write never breaks the upstream
 * mutation flow.
 */
export async function appendAuditEvent(input: AuditEventInput): Promise<AuditEventRecord | undefined> {
  const record: AuditEventRecord = {
    ...input,
    id: generateId(Date.now()),
    timestamp: Date.now(),
    severity: input.severity ?? 'info',
  };
  const line = JSON.stringify(record) + '\n';
  const target = resolveLogPath();
  try {
    await appendRawLine(target, line);
    return record;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[audit-log] failed to append event', err);
    }
    return undefined;
  }
}

function parseLine(line: string): AuditEventRecord | null {
  if (!line.trim()) return null;
  try {
    const value = JSON.parse(line) as AuditEventRecord;
    if (typeof value.timestamp !== 'number' || typeof value.id !== 'string') return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * List audit events newest-first. Reads the active file plus any
 * `audit.log.YYYY-MM-DD.jsonl` archives that overlap the query range; keeps
 * memory bounded by `query.limit`.
 */
export async function listAuditEvents(query: AuditQuery = {}): Promise<AuditEventRecord[]> {
  const target = resolveLogPath();
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_QUERY_LIMIT, 1), MAX_QUERY_LIMIT);
  const from = query.from ?? 0;
  const to = query.to ?? Number.MAX_SAFE_INTEGER;

  const files = await candidateFiles(target, to);
  const collected: AuditEventRecord[] = [];

  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf8');
      const lines = content.split('\n');
      // Files are appended newest-last; iterate in reverse and stop when we
      // fall below `from` so older archives are skipped quickly.
      for (let i = lines.length - 1; i >= 0; i--) {
        const record = parseLine(lines[i]);
        if (!record) continue;
        if (record.timestamp < from) break;
        if (record.timestamp > to) continue;
        if (query.entityType && record.entity_type !== query.entityType) continue;
        collected.push(record);
        if (collected.length >= limit) return collected;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
  }
  return collected;
}

async function candidateFiles(activePath: string, to: number): Promise<string[]> {
  const dir = path.dirname(activePath);
  const base = path.basename(activePath);
  const ext = path.extname(base);
  const stem = base.slice(0, -ext.length);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [activePath];
  }
  const archives = entries.filter((name) => name.startsWith(`${stem}.`) && name.endsWith(ext));
  archives.sort();
  const ordered = [...archives.filter((n) => n !== base), base];
  // Stop reading archives older than `to`. Each archive's date is encoded in
  // the filename; reuse a 00:00 UTC timestamp to compare.
  const cutoff = new Date(to);
  const filtered = ordered.filter((name) => {
    const match = name.match(/\.(\d{4}-\d{2}-\d{2})/);
    if (!match) return true;
    return new Date(`${match[1]}T23:59:59.999Z`).getTime() >= cutoff.getTime() - 24 * 3600 * 1000;
  });
  return filtered.map((name) => path.join(dir, name));
}

/** Test helper: wipe the active log and all rotated archives. */
export async function resetAuditLogForTests(): Promise<void> {
  const target = resolveLogPath();
  try {
    await fs.unlink(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const dir = path.dirname(target);
  const base = path.basename(target);
  const ext = path.extname(base);
  const stem = base.slice(0, -ext.length);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((name) => name.startsWith(`${stem}.`) && name.endsWith(ext))
      .map((name) => fs.unlink(path.join(dir, name)).catch(() => undefined)),
  );
}

/** Test helper: override the log path used by the current process. */
export function setAuditLogPathForTests(filePath: string): void {
  process.env.AGENTTEAMS_AUDIT_LOG_PATH = filePath;
}