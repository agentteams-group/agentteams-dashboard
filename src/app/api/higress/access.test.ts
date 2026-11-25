// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { requireHigressConsoleWriteAccess } from './access';
import { createSession, SESSION_COOKIE_NAME, __resetSessionStoreForTests } from '@/lib/dashboard-session';

describe('Controller gateway access', () => {
  beforeEach(() => {
    vi.stubEnv('DASHBOARD_SESSION_SECRET', 'a'.repeat(64));
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'direct');
    __resetSessionStoreForTests();
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  function request(level?: number) {
    const headers = new Headers();
    if (level) {
      const { cookieValue } = createSession({ user: 'alice', crLevel: level, credential: { kind: 'matrix', token: 'own-token' } });
      headers.set('cookie', `${SESSION_COOKIE_NAME}=${cookieValue}`);
    }
    return new NextRequest('http://dashboard.test/api/higress/ai-providers', { method: 'POST', headers });
  }
  it('rejects unauthenticated requests', async () => {
    expect((await requireHigressConsoleWriteAccess(request()))?.status).toBe(401);
  });
  it('rejects L2 requests', async () => {
    expect((await requireHigressConsoleWriteAccess(request(2)))?.status).toBe(403);
  });
  it('allows L1 without any Console cookie or Dashboard Console configuration', async () => {
    vi.stubEnv('AGENTTEAMS_AI_GATEWAY_ADMIN_URL', 'invalid');
    expect(await requireHigressConsoleWriteAccess(request(1))).toBeNull();
  });
});
