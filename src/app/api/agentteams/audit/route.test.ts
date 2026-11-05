// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer, type Server } from 'node:http';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';
import { setAuditLogPathForTests } from '@/lib/audit-log';

let server: Server;
let controllerUrl: string;
let tmpDir: string;
let logPath: string;
const received: Array<{ method: string; url: string; body?: string }> = [];
type AuditBehavior = 'ok' | 'not-found' | 'unreachable-502' | 'garbage' | 'bad-range';
let auditBehavior: AuditBehavior = 'ok';
let teamsStatus = 200;

const CONTROLLER_EVENTS = [
  {
    ts: '2026-09-16T08:00:00.000Z',
    kind: 'capability',
    actor: 'ctrl-admin',
    target: 'h1',
    targetTeam: 'alpha-team',
    action: 'capability_grant',
    capability: 'approval_policy',
    before: ['approval_policy'],
    after: ['approval_policy', 'channel_secrets'],
  },
  {
    ts: '2026-09-16T09:00:00.000Z',
    kind: 'channel',
    actor: 'ctrl-admin',
    target: 'w1',
    targetTeam: 'alpha-team',
    action: 'channel_update',
  },
];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const url = req.url ?? '';
      received.push({ method: req.method ?? '', url, body });

      if (req.method === 'GET' && url.startsWith('/api/v1/audit')) {
        if (auditBehavior === 'ok') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ events: CONTROLLER_EVENTS }));
          return;
        }
        if (auditBehavior === 'not-found') {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end('{"message":"no such endpoint"}');
          return;
        }
        if (auditBehavior === 'unreachable-502') {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end('{"message":"storage read failure"}');
          return;
        }
        if (auditBehavior === 'garbage') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('this is not json');
          return;
        }
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end('{"message":"from is after to"}');
        return;
      }

      if (req.method === 'GET' && url.startsWith('/api/v1/teams')) {
        if (teamsStatus !== 200) {
          res.writeHead(teamsStatus, { 'content-type': 'application/json' });
          res.end('{"message":"teams unavailable"}');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ teams: [{ name: 'alpha-team' }] }));
        return;
      }

      res.writeHead(204);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  controllerUrl = `http://127.0.0.1:${address.port}`;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-route-'));
  logPath = path.join(tmpDir, 'audit.log.jsonl');
  setAuditLogPathForTests(logPath);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  received.length = 0;
  auditBehavior = 'ok';
  teamsStatus = 200;
});

function makeRequest(pathSuffix: string, init: { method?: string; body?: string; admin?: boolean; actor?: string; level?: number } = {}) {
  const url = new URL(`http://localhost${pathSuffix}`);
  url.searchParams.set('controllerUrl', controllerUrl);
  const headers: Record<string, string> = {};
  if (init.body) headers['content-type'] = 'application/json';
  if (init.admin !== false) {
    headers['x-agentteams-user'] = init.actor ?? 'admin';
    headers['x-agentteams-user-level'] = String(init.level ?? 3);
  }
  return new NextRequest(url, {
    method: init.method ?? 'GET',
    headers,
    body: init.body,
  });
}

describe('GET /api/agentteams/audit (identity gate)', () => {
  it('returns 403 when the caller has no identity (dev / auth disabled)', async () => {
    const res = await GET(makeRequest('/api/agentteams/audit', { admin: false }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: '需要审计权限', requiredLevel: 2 });
    expect(body.observedLevel).toBeNull();
  });

  it('returns 403 with observedLevel=1 for a level-1 caller', async () => {
    const url = new URL('http://localhost/api/agentteams/audit');
    const req = new NextRequest(url, {
      method: 'GET',
      headers: {
        'x-agentteams-user': 'junior',
        'x-agentteams-user-level': '1',
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.observedLevel).toBe(1);
    expect(body.requiredLevel).toBe(2);
  });
});

describe('GET /api/agentteams/audit (B6 controller data plane)', () => {
  it('serves normalized controller events for admin (source=controller, scope=all)', async () => {
    const res = await GET(makeRequest('/api/agentteams/audit', { actor: 'admin', level: 3 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.source).toBe('controller');
    expect(body.scope).toBe('all');
    expect(body.events.length).toBe(2);
    expect(body.events[0]).toMatchObject({
      entity_type: 'human',
      entity_name: 'h1',
      team: 'alpha-team',
      kind: 'capability',
      actor: 'ctrl-admin',
    });
    expect(body.events[0].timestamp).toBe(Date.parse('2026-09-16T08:00:00.000Z'));
    expect(body.events[1].entity_type).toBe('worker');
  });

  it('maps from/to (epoch ms) to RFC3339 and caps limit at 200', async () => {
    const from = Date.parse('2026-09-16T00:00:00.000Z');
    const to = Date.parse('2026-09-17T00:00:00.000Z');
    const res = await GET(
      makeRequest(`/api/agentteams/audit?from=${from}&to=${to}&limit=5000`),
    );
    expect(res.status).toBe(200);
    const auditCall = received.find((r) => r.url.startsWith('/api/v1/audit'));
    expect(auditCall).toBeDefined();
    const qs = new URL(`http://x${auditCall!.url}`).searchParams;
    expect(qs.get('from')).toBe('2026-09-16T00:00:00.000Z');
    expect(qs.get('to')).toBe('2026-09-17T00:00:00.000Z');
    expect(qs.get('limit')).toBe('200');
  });

  it('L2 without ?team= auto-resolves the first accessible team and scopes the query', async () => {
    const res = await GET(makeRequest('/api/agentteams/audit', { actor: 'ops-l2', level: 2 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('controller');
    expect(body.scope).toBe('team');
    expect(body.team).toBe('alpha-team');
    const teamsCall = received.find((r) => r.url.startsWith('/api/v1/teams'));
    expect(teamsCall).toBeDefined();
    const auditCall = received.find((r) => r.url.startsWith('/api/v1/audit'));
    const qs = new URL(`http://x${auditCall!.url}`).searchParams;
    expect(qs.get('team')).toBe('alpha-team');
  });

  it('L2 with explicit ?team= does not re-resolve the team list', async () => {
    await GET(makeRequest('/api/agentteams/audit?team=beta-team', { actor: 'ops-l2', level: 2 }));
    expect(received.some((r) => r.url.startsWith('/api/v1/teams'))).toBe(false);
    const auditCall = received.find((r) => r.url.startsWith('/api/v1/audit'));
    const qs = new URL(`http://x${auditCall!.url}`).searchParams;
    expect(qs.get('team')).toBe('beta-team');
  });

  it('degrades to the local log when the controller 404s (build without #1270)', async () => {
    auditBehavior = 'not-found';
    await POST(
      makeRequest('/api/agentteams/audit', {
        method: 'POST',
        body: JSON.stringify({ entity_type: 'worker', entity_name: 'w-local', action: 'create' }),
        actor: 'admin',
        level: 3,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));

    const res = await GET(makeRequest('/api/agentteams/audit', { actor: 'admin', level: 3 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('local');
    expect(body.note).toContain('本地日志');
    expect(body.events.some((ev: { entity_name: string }) => ev.entity_name === 'w-local')).toBe(true);
  });

  it('degrades to the local log when the controller 502s (unreachable / storage failure)', async () => {
    auditBehavior = 'unreachable-502';
    const res = await GET(makeRequest('/api/agentteams/audit', { actor: 'admin', level: 3 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('local');
    expect(body.note).toContain('不可达');
  });

  it('degrades to the local log when the controller response is unparseable', async () => {
    auditBehavior = 'garbage';
    const res = await GET(makeRequest('/api/agentteams/audit', { actor: 'admin', level: 3 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('local');
    expect(body.note).toContain('无法解析');
  });

  it('L2 degrades to the local self-scoped log when no accessible team resolves', async () => {
    teamsStatus = 500;
    await POST(
      makeRequest('/api/agentteams/audit', {
        method: 'POST',
        body: JSON.stringify({ entity_type: 'team', entity_name: 't-by-l2', action: 'update' }),
        actor: 'ops-l2',
        level: 2,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));

    const res = await GET(makeRequest('/api/agentteams/audit', { actor: 'ops-l2', level: 2 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('local');
    expect(body.scope).toBe('self');
    expect(body.note).toContain('团队');
    for (const ev of body.events) {
      expect(ev.actor).toBe('ops-l2');
    }
  });

  it('surfaces controller validation errors (400) instead of silently switching source', async () => {
    auditBehavior = 'bad-range';
    const res = await GET(makeRequest('/api/agentteams/audit', { actor: 'admin', level: 3 }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.source).toBe('controller');
    expect(body.upstreamStatus).toBe(400);
    expect(body.error).toContain('from is after to');
  });

  it('applies the entity filter to controller-sourced events via the kind mapping', async () => {
    const res = await GET(
      makeRequest('/api/agentteams/audit?entityType=worker', { actor: 'admin', level: 3 }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('controller');
    expect(body.events.length).toBe(1);
    expect(body.events[0].kind).toBe('channel');
    expect(body.events[0].entity_type).toBe('worker');
  });
});

describe('GET /api/agentteams/audit (local fallback contract)', () => {
  it('admin local view is source=local scope=all with a provenance note after 404', async () => {
    auditBehavior = 'not-found';
    const res = await GET(makeRequest('/api/agentteams/audit', { actor: 'admin', level: 3 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('local');
    expect(body.scope).toBe('all');
    expect(Array.isArray(body.events)).toBe(true);
  });

  it('L2 local view is scoped to the auditor (self) when the controller is unavailable', async () => {
    auditBehavior = 'not-found';
    await POST(
      makeRequest('/api/agentteams/audit', {
        method: 'POST',
        body: JSON.stringify({ entity_type: 'worker', entity_name: 'w-by-admin', action: 'create' }),
        actor: 'admin',
        level: 3,
      }),
    );
    await POST(
      makeRequest('/api/agentteams/audit', {
        method: 'POST',
        body: JSON.stringify({ entity_type: 'worker', entity_name: 'w-by-l2', action: 'create' }),
        actor: 'auditor-l2',
        level: 2,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));

    const res = await GET(makeRequest('/api/agentteams/audit', { actor: 'auditor-l2', level: 2 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.source).toBe('local');
    expect(body.scope).toBe('self');
    expect(Array.isArray(body.events)).toBe(true);
    for (const ev of body.events) {
      expect(ev.actor).toBe('auditor-l2');
    }
    expect(body.events.some((ev: { entity_name: string }) => ev.entity_name === 'w-by-admin')).toBe(false);
  });
});

describe('POST /api/agentteams/audit', () => {
  it('returns 403 when no identity header is present', async () => {
    const res = await POST(makeRequest('/api/agentteams/audit', { method: 'POST', body: '{}', admin: false }));
    expect(res.status).toBe(403);
  });

  it('returns 403 for a level-1 caller (manage 门 L3-only)', async () => {
    const res = await POST(
      makeRequest('/api/agentteams/audit', { method: 'POST', body: '{}', actor: 'observer', level: 1 }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(String(body.error)).toContain('manage');
  });

  it('returns 403 for a level-2 caller', async () => {
    const res = await POST(
      makeRequest('/api/agentteams/audit', { method: 'POST', body: '{}', actor: 'operator', level: 2 }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 when severity is not in the enum', async () => {
    const res = await POST(
      makeRequest('/api/agentteams/audit', {
        method: 'POST',
        body: JSON.stringify({
          entity_type: 'worker',
          entity_name: 'w1',
          action: 'create',
          severity: 'catastrophic-not-in-enum',
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(String(body.error)).toContain('severity');
  });

  it('returns 400 when the payload is missing required fields', async () => {
    const res = await POST(makeRequest('/api/agentteams/audit', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(400);
  });

  it('writes a valid event to the JSONL log', async () => {
    const res = await POST(
      makeRequest('/api/agentteams/audit', {
        method: 'POST',
        body: JSON.stringify({
          entity_type: 'worker',
          entity_name: 'w-from-test',
          action: 'create',
          severity: 'info',
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.id).toMatch(/^audit-/);

    // Wait briefly for fs.appendFile to flush, then verify the line landed.
    await new Promise((r) => setTimeout(r, 20));
    const content = await fs.readFile(logPath, 'utf8');
    expect(content).toContain('w-from-test');
    expect(content).toContain('"action":"create"');
  });
});
