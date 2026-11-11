// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';
import {
  SESSION_COOKIE_NAME,
  __resetSessionStoreForTests,
  createSession,
} from '@/lib/dashboard-session';
import { __resetStaticIdentityCacheForTests } from '@/lib/static-identity';

const SECRET = 'f'.repeat(64);

function dataRequest(path: string, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return new NextRequest(`http://dashboard.test${path}`, { headers });
}

function l2Cookie(user = 'bob') {
  const { cookieValue } = createSession({
    user,
    crLevel: 2,
    teams: ['biz-team'],
    credential: { kind: 'matrix', token: 'syt_test' },
  });
  return cookieValue;
}

function l1Cookie() {
  const { cookieValue } = createSession({ user: 'carol', crLevel: 1, credential: { kind: 'sa' } });
  return cookieValue;
}

describe('middleware auth gate (M19 dashboard session)', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    process.env.DASHBOARD_SESSION_SECRET = SECRET;
    delete process.env.AGENTTEAMS_AUTH_DISABLED;
  });

  afterEach(() => {
    __resetSessionStoreForTests();
    delete process.env.DASHBOARD_SESSION_SECRET;
    delete process.env.AGENTTEAMS_AUTH_DISABLED;
  });

  it('401 on /api/agentteams/* without a session cookie', async () => {
    const res = await middleware(dataRequest('/api/agentteams/teams'));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('401 on a forged (tampered) session cookie', async () => {
    const cookieValue = l2Cookie();
    const tampered = cookieValue.slice(0, -4) + 'xxxx';
    const res = await middleware(dataRequest('/api/agentteams/teams', `${SESSION_COOKIE_NAME}=${tampered}`));
    expect(res.status).toBe(401);
  });

  it('401 on a cookie from a destroyed session (restart semantics)', async () => {
    const { cookieValue } = createSession({ user: 'bob', crLevel: 2, credential: { kind: 'matrix', token: 't' } });
    __resetSessionStoreForTests(); // simulate container restart
    const res = await middleware(dataRequest('/api/agentteams/teams', `${SESSION_COOKIE_NAME}=${cookieValue}`));
    expect(res.status).toBe(401);
  });

  // Identity-header injection (x-agentteams-user/level) is asserted
  // end-to-end in proxy-helper.test.ts ("forwards the server-resolved
  // x-agentteams identity headers"); NextResponse.next does not expose the
  // overridden request headers on the response object.
  it('lets an L2 session through (gate open)', async () => {
    const res = await middleware(dataRequest('/api/agentteams/teams', `${SESSION_COOKIE_NAME}=${l2Cookie()}`));
    expect(res.status).toBe(200);
  });

  it('lets an L1 (Console) session through (gate open)', async () => {
    const res = await middleware(dataRequest('/api/agentteams/teams', `${SESSION_COOKIE_NAME}=${l1Cookie()}`));
    expect(res.status).toBe(200);
  });

  it('gates setup/status behind the session (SEC-06: SA-token relay)', async () => {
    const res = await middleware(dataRequest('/api/agentteams/setup/status'));
    expect(res.status).toBe(401);
  });

  it('lets the pre-login healthz probe through without a session (with and without trailing slash)', async () => {
    expect((await middleware(dataRequest('/api/agentteams/healthz'))).status).toBe(200);
    expect((await middleware(dataRequest('/api/agentteams/healthz/'))).status).toBe(200);
  });

  it('keeps other data routes gated (healthz is public, workers are not)', async () => {
    const res = await middleware(dataRequest('/api/agentteams/workers'));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('keeps the AGENTTEAMS_AUTH_DISABLED escape hatch', async () => {
    process.env.AGENTTEAMS_AUTH_DISABLED = 'true';
    const res = await middleware(dataRequest('/api/agentteams/teams'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-agentteams-auth-mode')).toBe('disabled');
  });

  it('passes OPTIONS preflight through (no credentials on preflight)', async () => {
    const res = await middleware(new NextRequest('http://dashboard.test/api/agentteams/teams', { method: 'OPTIONS' }));
    expect(res.status).toBe(200);
  });

  it('redirects legacy /dashboard/ URLs to root', async () => {
    const res = await middleware(dataRequest('/dashboard/workers'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://dashboard.test/workers');
  });
});

// ── F7 stateless mode (DASHBOARD_STATELESS=1) ──────────────────────────────
describe('middleware auth gate (F7 stateless mode)', () => {
  let controller: Server;
  let controllerUrl: string;

  beforeAll(async () => {
    controller = createServer((req, res) => {
      if (req.url?.startsWith('/api/v1/humans')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ humans: [] }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((resolve) => controller.listen(0, '127.0.0.1', resolve));
    const address = controller.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    controllerUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => controller.close(() => resolve()));
  });

  beforeEach(() => {
    process.env.DASHBOARD_STATELESS = '1';
    process.env.AGENTTEAMS_API_URL = controllerUrl;
    process.env.DASHBOARD_SESSION_SECRET = SECRET;
    __resetStaticIdentityCacheForTests();
  });

  afterEach(() => {
    delete process.env.DASHBOARD_STATELESS;
    delete process.env.AGENTTEAMS_API_URL;
    __resetStaticIdentityCacheForTests();
  });

  function staticRequest(path: string, token?: string, extra: Record<string, string> = {}) {
    const headers = new Headers(extra);
    if (token) headers.set('authorization', `Bearer ${token}`);
    return new NextRequest(`http://dashboard.test${path}`, { headers });
  }

  it('401 on a data route without a bearer token', async () => {
    const res = await middleware(staticRequest('/api/agentteams/teams'));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('lets a valid admin-grade token through and marks the auth mode', async () => {
    const res = await middleware(staticRequest('/api/agentteams/teams', 'sa-token'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-agentteams-auth-mode')).toBe('stateless');
  });

  it('503 when the controller is unreachable (identity unresolvable — not a 401)', async () => {
    process.env.AGENTTEAMS_API_URL = 'http://127.0.0.1:1';
    const res = await middleware(staticRequest('/api/agentteams/teams', 'any-token'));
    expect(res.status).toBe(503);
  });

  it('401 with a re-login message when the token is invalid (definitive)', async () => {
    const controller2 = createServer((req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown user ID' }));
    });
    await new Promise<void>((resolve) => controller2.listen(0, '127.0.0.1', resolve));
    const address = controller2.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    try {
      process.env.AGENTTEAMS_API_URL = `http://127.0.0.1:${address.port}`;
      const res = await middleware(staticRequest('/api/agentteams/teams', 'expired-token'));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('重新登录');
    } finally {
      await new Promise<void>((resolve) => controller2.close(() => resolve()));
    }
  });

  it('keeps the public /mode probe reachable without a bearer (F7 login flow)', async () => {
    const res = await middleware(staticRequest('/api/agentteams/mode'));
    expect(res.status).toBe(200);
  });

  it('keeps the pre-login healthz probe public in stateless mode too', async () => {
    const res = await middleware(staticRequest('/api/agentteams/healthz/'));
    expect(res.status).toBe(200);
  });

  it('degrades server-credential routes with 501 before asking for credentials', async () => {
    const res = await middleware(staticRequest('/api/agentteams/storage/buckets'));
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.code).toBe('STATIC_MODE_UNAVAILABLE');
  });

  it('ignores client-claimed identity headers on the session path (forged cookie is not a session)', async () => {
    // In stateless mode a session cookie is not a credential — even a valid
    // stateful cookie alone (no bearer) must not open the gate.
    const res = await middleware(
      staticRequest('/api/agentteams/teams', undefined, {
        cookie: `${SESSION_COOKIE_NAME}=${l2Cookie()}`,
      }),
    );
    expect(res.status).toBe(401);
  });
});
