import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  appendAuditEvent,
  listAuditEvents,
  resetAuditLogForTests,
  setAuditLogPathForTests,
} from './audit-log';

let tmpDir: string;
let logPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-log-'));
  logPath = path.join(tmpDir, 'audit.log.jsonl');
  setAuditLogPathForTests(logPath);
});

afterEach(async () => {
  delete process.env.AGENTTEAMS_AUDIT_LOG_PATH;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('appendAuditEvent', () => {
  it('writes a JSONL line with id/timestamp/severity defaults', async () => {
    const record = await appendAuditEvent({
      actor: 'u1',
      entity_type: 'worker',
      entity_name: 'w1',
      action: 'create',
    });
    expect(record?.id).toMatch(/^audit-/);
    expect(record?.timestamp).toBeGreaterThan(0);
    expect(record?.severity).toBe('info');

    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).action).toBe('create');
  });

  it('preserves explicit severity and optional fields', async () => {
    await appendAuditEvent({
      actor: 'u1',
      actor_level: 3,
      entity_type: 'team',
      entity_name: 't1',
      action: 'delete',
      severity: 'warning',
      details: 'RBAC denied',
      source_ip: '127.0.0.1',
    });
    const events = await listAuditEvents();
    expect(events[0]).toMatchObject({
      actor: 'u1',
      actor_level: 3,
      severity: 'warning',
      details: 'RBAC denied',
      source_ip: '127.0.0.1',
    });
  });
});

describe('listAuditEvents', () => {
  it('returns events newest-first within a time window', async () => {
    const base = Date.now();
    await appendAuditEvent({ entity_type: 'worker', entity_name: 'w1', action: 'create' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await appendAuditEvent({ entity_type: 'worker', entity_name: 'w2', action: 'delete' });
    const events = await listAuditEvents({ from: base });
    expect(events.map((e) => e.entity_name)).toEqual(['w2', 'w1']);
  });

  it('filters by entity type', async () => {
    await appendAuditEvent({ entity_type: 'worker', entity_name: 'w1', action: 'create' });
    await appendAuditEvent({ entity_type: 'team', entity_name: 't1', action: 'create' });
    const events = await listAuditEvents({ entityType: 'team' });
    expect(events).toHaveLength(1);
    expect(events[0].entity_name).toBe('t1');
  });

  it('caps results to the requested limit', async () => {
    for (let i = 0; i < 5; i++) {
      await appendAuditEvent({ entity_type: 'worker', entity_name: `w${i}`, action: 'create' });
    }
    const events = await listAuditEvents({ limit: 3 });
    expect(events).toHaveLength(3);
  });
});

describe('rotation', () => {
  it('archives the active file once it exceeds MAX_FILE_BYTES', async () => {
    // Force rotation by simulating an oversized file with one existing record,
    // then appending a new one. We bypass MAX_FILE_BYTES by writing the
    // active file at the limit and then appending through the public API.
    const bigLine = 'x'.repeat(11 * 1024 * 1024);
    await fs.writeFile(logPath, bigLine);

    await appendAuditEvent({ entity_type: 'worker', entity_name: 'w1', action: 'create' });

    const dir = path.dirname(logPath);
    const entries = await fs.readdir(dir);
    const archives = entries.filter((n) => n !== path.basename(logPath));
    expect(archives.length).toBeGreaterThanOrEqual(1);
    // Active file should now contain only the new event line.
    const active = await fs.readFile(logPath, 'utf8');
    expect(active.split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('rotated archives remain queryable through listAuditEvents', async () => {
    const old = await appendAuditEvent({ entity_type: 'worker', entity_name: 'archived', action: 'create' });
    // Append an oversized line (keeps the archived record) to force rotation
    // on the next append.
    await fs.appendFile(logPath, 'x'.repeat(11 * 1024 * 1024) + '\n');
    const fresh = await appendAuditEvent({ entity_type: 'worker', entity_name: 'active', action: 'create' });

    const events = await listAuditEvents();
    const names = events.map((e) => e.entity_name);
    expect(names).toContain('archived');
    expect(names).toContain('active');
    // Newest-first ordering survives the archive boundary.
    expect(names.indexOf('active')).toBeLessThan(names.indexOf('archived'));
    expect(events[0].id).toBe(fresh?.id);
    expect(events[events.length - 1].id).toBe(old?.id);
  });

  it('prunes oldest archives beyond MAX_RETAINED_FILES (30)', async () => {
    const dir = path.dirname(logPath);
    const base = path.basename(logPath);
    // Pre-seed 31 archives with distinct dates (sortable names), then append
    // past the size limit so rotate() runs pruneArchives.
    for (let i = 1; i <= 31; i++) {
      const date = new Date(Date.UTC(2026, 0, i)).toISOString().slice(0, 10);
      await fs.writeFile(path.join(dir, base.replace('.jsonl', `.${date}.jsonl`)), 'seed\n');
    }
    await fs.writeFile(logPath, 'x'.repeat(11 * 1024 * 1024));
    await appendAuditEvent({ entity_type: 'worker', entity_name: 'w1', action: 'create' });

    const entries = (await fs.readdir(dir)).filter(
      (n) => n.startsWith('audit.log.') && n.endsWith('.jsonl') && n !== base,
    );
    expect(entries.length).toBeLessThanOrEqual(30);
    // The newest archive (latest date) must have survived.
    expect(entries.some((n) => n.includes('2026-01-31'))).toBe(true);
  });

  it('skips corrupt lines instead of failing the query', async () => {
    await appendAuditEvent({ entity_type: 'worker', entity_name: 'good', action: 'create' });
    await fs.appendFile(logPath, 'this is not json\n');
    await appendAuditEvent({ entity_type: 'worker', entity_name: 'good2', action: 'create' });

    const events = await listAuditEvents();
    expect(events.map((e) => e.entity_name)).toEqual(['good2', 'good']);
  });

  it('filters by actor (case-sensitive exact match)', async () => {
    await appendAuditEvent({ actor: 'alice', entity_type: 'worker', entity_name: 'w1', action: 'create' });
    await appendAuditEvent({ actor: 'bob', entity_type: 'worker', entity_name: 'w2', action: 'create' });
    await appendAuditEvent({ actor: 'Bob', entity_type: 'worker', entity_name: 'w3', action: 'create' });

    const events = await listAuditEvents({ actor: 'bob' });
    expect(events).toHaveLength(1);
    expect(events[0].entity_name).toBe('w2');
  });
});

afterEach(async () => {
  await resetAuditLogForTests();
});