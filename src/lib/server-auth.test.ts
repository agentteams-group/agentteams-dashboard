import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { enforceServerSideRbac, enforceLevelOnlyRbac, readServerIdentity, SERVER_USER_HEADER, SERVER_USER_LEVEL_HEADER, SERVER_USER_TEAMS_HEADER, SERVER_USER_WORKERS_HEADER, SERVER_USER_SCOPE_HEADER } from './server-auth';
import { setAuditLogPathForTests } from './audit-log';

function makeRequest(
  name: string | null,
  level: number | null,
  scope: 'global' | 'scoped' | 'unknown' = level === 3 ? 'global' : 'scoped',
): NextRequest {
  const headers = new Headers();
  if (name) headers.set(SERVER_USER_HEADER, name);
  if (level !== null) headers.set(SERVER_USER_LEVEL_HEADER, String(level));
  if (name && level !== null) {
    headers.set(SERVER_USER_SCOPE_HEADER, scope);
    headers.set(SERVER_USER_TEAMS_HEADER, JSON.stringify(scope === 'scoped' ? ['t1'] : []));
    headers.set(SERVER_USER_WORKERS_HEADER, JSON.stringify(scope === 'scoped' ? ['w1'] : []));
  }
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
      teams: ['t1'],
      workers: ['w1'],
      scope: 'scoped',
      sourceIp: undefined,
    });
  });

  it('ignores x-forwarded-for by default (SEC-10: untrusted proxy)', () => {
    const headers = new Headers();
    headers.set(SERVER_USER_HEADER, 'alice');
    headers.set(SERVER_USER_LEVEL_HEADER, '3');
    headers.set('x-forwarded-for', '10.1.2.3, 10.0.0.1');
    const req = new NextRequest('http://localhost/api', { headers });
    expect(readServerIdentity(req)?.sourceIp).toBeUndefined();
  });

  it('captures the first forwarded IP when AGENTTEAMS_TRUST_PROXY=true', () => {
    process.env.AGENTTEAMS_TRUST_PROXY = 'true';
    try {
      const headers = new Headers();
      headers.set(SERVER_USER_HEADER, 'alice');
      headers.set(SERVER_USER_LEVEL_HEADER, '3');
      headers.set('x-forwarded-for', '10.1.2.3, 10.0.0.1');
      const req = new NextRequest('http://localhost/api', { headers });
      expect(readServerIdentity(req)?.sourceIp).toBe('10.1.2.3');
    } finally {
      delete process.env.AGENTTEAMS_TRUST_PROXY;
    }
  });

  it('trusted-proxy mode falls back to undefined without the header', () => {
    process.env.AGENTTEAMS_TRUST_PROXY = 'true';
    try {
      expect(readServerIdentity(makeRequest('alice', 3))?.sourceIp).toBeUndefined();
    } finally {
      delete process.env.AGENTTEAMS_TRUST_PROXY;
    }
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

  it('returns 401 when no identity header is present', async () => {
    const res = await enforceServerSideRbac(makeRequest(null, null), 'delete', 'worker', 'w1');
    expect(res?.status).toBe(401);
  });

  it('denies unknown and empty scopes even for level 3', async () => {
    expect((await enforceServerSideRbac(makeRequest('admin', 3, 'unknown'), 'view', 'worker', 'w1'))?.status).toBe(403);
    const headers = new Headers({
      [SERVER_USER_HEADER]: 'admin',
      [SERVER_USER_LEVEL_HEADER]: '3',
      [SERVER_USER_SCOPE_HEADER]: 'scoped',
      [SERVER_USER_WORKERS_HEADER]: '[]',
    });
    const req = new NextRequest('http://localhost/api/agentteams/workers/x', { headers });
    expect((await enforceServerSideRbac(req, 'view', 'worker', 'w1'))?.status).toBe(403);
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

  it('returns 401 when no identity header is present', async () => {
    const res = await enforceLevelOnlyRbac(makeRequest(null, null), 'delete', 'storage.bucket', 'foo');
    expect(res?.status).toBe(401);
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
// ── F7 stateless mode：dashboard 等级门与 Controller 原生 per-token RBAC
// 并行生效（纵深防御）。stateless 下 middleware 仍按 token 解析身份并注入
// 可信头（resolveStaticIdentity → level 3/2/1），等级检查照常执行；
// storage/*、packages、skills 直连 MinIO，没有 Controller 兜底。 ────────
describe('F7 stateless mode: dashboard level gate runs in parallel with the Controller', () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rbac-static-'));
    setAuditLogPathForTests(path.join(tmpDir, 'audit.log.jsonl'));
    // mock isStatelessAuthMode() === true（逐调用读取该 env，见 static-mode.ts）。
    vi.stubEnv('DASHBOARD_STATELESS', '1');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    delete process.env.AGENTTEAMS_AUDIT_LOG_PATH;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('enforceServerSideRbac denies L1 delete with 403 even in stateless mode', async () => {
    const res = await enforceServerSideRbac(makeRequest('observer', 1), 'delete', 'worker', 'w1');
    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
    const body = await res?.json();
    expect(body).toMatchObject({ success: false, action: 'delete', resourceType: 'worker', resourceName: 'w1' });
    // fire-and-forget 审计写入刷盘后再清理 tmpDir（见本文件既有 deny 用例）。
    await new Promise((r) => setTimeout(r, 20));
  });

  it('enforceServerSideRbac lets L3 through in stateless mode', async () => {
    const res = await enforceServerSideRbac(makeRequest('admin', 3), 'delete', 'worker', 'w1');
    expect(res).toBeNull();
  });

  it('enforceLevelOnlyRbac denies L1 delete with 403 even in stateless mode', async () => {
    const res = await enforceLevelOnlyRbac(makeRequest('observer', 1), 'delete', 'storage.bucket', 'foo');
    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
    const body = await res?.json();
    expect(body).toMatchObject({ success: false, action: 'delete', resourceType: 'storage.bucket', resourceName: 'foo' });
  });

  it('enforceLevelOnlyRbac lets L3 through in stateless mode', async () => {
    const res = await enforceLevelOnlyRbac(makeRequest('admin', 3), 'delete', 'storage.bucket', 'foo');
    expect(res).toBeNull();
  });

  it('stateful mode keeps denying (default unchanged)', async () => {
    vi.unstubAllEnvs();
    const res = await enforceServerSideRbac(makeRequest('observer', 1), 'delete', 'worker', 'w1');
    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
  });
});
