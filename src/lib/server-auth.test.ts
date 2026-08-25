import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { enforceServerSideRbac, enforceLevelOnlyRbac, readServerIdentity, SERVER_USER_HEADER, SERVER_USER_LEVEL_HEADER } from './server-auth';
import { setAuditLogPathForTests } from './audit-log';

function makeRequest(name: string | null, level: number | null): NextRequest {
  const headers = new Headers();
  if (name) headers.set(SERVER_USER_HEADER, name);
  if (level !== null) headers.set(SERVER_USER_LEVEL_HEADER, String(level));
  return new NextRequest('http://localhost/api/agentteams/workers/x', { headers });
}

describe('readServerIdentity', () => {
  it('returns null when no identity header is present', () => {
    expect(readServerIdentity(makeRequest(null, null))).toBeNull();
  });

  it('parses name and level, defaulting to level 1', () => {
    expect(readServerIdentity(makeRequest('alice', 2))).toEqual({
      name: 'alice',
      level: 2,
      sourceIp: undefined,
    });
  });

  it('captures the first forwarded IP for audit attribution', () => {
    const headers = new Headers();
    headers.set(SERVER_USER_HEADER, 'alice');
    headers.set(SERVER_USER_LEVEL_HEADER, '3');
    headers.set('x-forwarded-for', '10.1.2.3, 10.0.0.1');
    const req = new NextRequest('http://localhost/api', { headers });
    expect(readServerIdentity(req)?.sourceIp).toBe('10.1.2.3');
  });
});

describe('enforceServerSideRbac', () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rbac-test-'));
    setAuditLogPathForTests(path.join(tmpDir, 'audit.log.jsonl'));
  });

  afterEach(async () => {
    delete process.env.AGENTTEAMS_AUDIT_LOG_PATH;
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns null (allow) when no identity header is present', async () => {
    const res = await enforceServerSideRbac(makeRequest(null, null), 'delete', 'worker', 'w1');
    expect(res).toBeNull();
  });

  it('allows admin (level 3) to delete any worker', async () => {
    const res = await enforceServerSideRbac(makeRequest('admin', 3), 'delete', 'worker', 'w1');
    expect(res).toBeNull();
  });

  it('denies observer (level 1) attempting delete with a 403', async () => {
    const res = await enforceServerSideRbac(makeRequest('observer', 1), 'delete', 'worker', 'w1');
    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
    const body = await res?.json();
    expect(body).toMatchObject({ success: false, action: 'delete', resourceType: 'worker', resourceName: 'w1' });
    expect(typeof body.error).toBe('string');
  });

  it('appends a warning audit event when RBAC denies', async () => {
    await enforceServerSideRbac(makeRequest('observer', 1), 'delete', 'worker', 'w-secret');
    // Give the fire-and-forget append a tick to flush.
    await new Promise((r) => setTimeout(r, 20));
    const content = await fs.readFile(path.join(tmpDir, 'audit.log.jsonl'), 'utf8');
    expect(content).toContain('rbac.deny.delete');
    expect(content).toContain('"severity":"warning"');
    expect(content).toContain('w-secret');
  });
});

describe('enforceLevelOnlyRbac', () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rbac-level-'));
    setAuditLogPathForTests(path.join(tmpDir, 'audit.log.jsonl'));
  });

  afterEach(async () => {
    delete process.env.AGENTTEAMS_AUDIT_LOG_PATH;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns null (allow) when no identity header is present', async () => {
    const res = await enforceLevelOnlyRbac(makeRequest(null, null), 'delete', 'storage.bucket', 'foo');
    expect(res).toBeNull();
  });

  it('allows admin (level 3) to delete a storage bucket', async () => {
    const res = await enforceLevelOnlyRbac(makeRequest('admin', 3), 'delete', 'storage.bucket', 'foo');
    expect(res).toBeNull();
  });

  it('denies observer (level 1) attempting delete with a 403', async () => {
    const res = await enforceLevelOnlyRbac(makeRequest('observer', 1), 'delete', 'storage.bucket', 'foo');
    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
    const body = await res?.json();
    expect(body).toMatchObject({ success: false, action: 'delete', resourceType: 'storage.bucket', resourceName: 'foo' });
    expect(typeof body.error).toBe('string');
  });

  it('allows operator (level 2) to perform wake (level 2 grants wake but not create/delete)', async () => {
    const res = await enforceLevelOnlyRbac(makeRequest('operator', 2), 'wake', 'worker', 'w-1');
    expect(res).toBeNull();
  });

  it('appends a system audit event on deny with severity=warning', async () => {
    await enforceLevelOnlyRbac(makeRequest('observer', 1), 'delete', 'storage.bucket', 'audit-target');
    await new Promise((r) => setTimeout(r, 20));
    const content = await fs.readFile(path.join(tmpDir, 'audit.log.jsonl'), 'utf8');
    expect(content).toContain('rbac.deny.delete');
    expect(content).toContain('"entity_type":"system"');
    expect(content).toContain('audit-target');
    expect(content).toContain('"severity":"warning"');
  });
});