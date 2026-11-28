// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

function apiRequest(path: string, extraHeaders?: Record<string, string>) {
  const headers = new Headers(extraHeaders);
  return new NextRequest(`http://dashboard.test${path}`, { headers });
}

/**
 * NextResponse.next({ request: { headers } }) forwards the mutated headers via
 * internal `x-middleware-request-<name>` response headers; asserting on those
 * proves the identity actually reaches downstream route handlers.
 */
function forwardedHeader(res: { headers: Headers }, name: string): string | null {
  return res.headers.get(`x-middleware-request-${name}`);
}

describe('proxy AGENTTEAMS_AUTH_DISABLED local identity', () => {
  beforeEach(() => {
    process.env.AGENTTEAMS_AUTH_DISABLED = 'true';
    delete process.env.AGENTTEAMS_LOCAL_USER;
    delete process.env.AGENTTEAMS_LOCAL_USER_LEVEL;
  });

  afterEach(() => {
    delete process.env.AGENTTEAMS_AUTH_DISABLED;
    delete process.env.AGENTTEAMS_LOCAL_USER;
    delete process.env.AGENTTEAMS_LOCAL_USER_LEVEL;
  });

  it('injects the default local-admin L3 identity', async () => {
    const res = await proxy(apiRequest('/api/agentteams/audit'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-agentteams-auth-mode')).toBe('disabled');
    expect(forwardedHeader(res, 'x-agentteams-user')).toBe('local-admin');
    expect(forwardedHeader(res, 'x-agentteams-user-level')).toBe('3');
  });

  it('honors AGENTTEAMS_LOCAL_USER / AGENTTEAMS_LOCAL_USER_LEVEL overrides', async () => {
    process.env.AGENTTEAMS_LOCAL_USER = 'dev-operator';
    process.env.AGENTTEAMS_LOCAL_USER_LEVEL = '2';
    const res = await proxy(apiRequest('/api/agentteams/workers'));
    expect(forwardedHeader(res, 'x-agentteams-user')).toBe('dev-operator');
    expect(forwardedHeader(res, 'x-agentteams-user-level')).toBe('2');
  });

  it('falls back to L3 when the configured level is not numeric', async () => {
    process.env.AGENTTEAMS_LOCAL_USER_LEVEL = 'not-a-number';
    const res = await proxy(apiRequest('/api/agentteams/audit'));
    expect(forwardedHeader(res, 'x-agentteams-user-level')).toBe('3');
  });

  it('overwrites client-forged identity headers', async () => {
    const res = await proxy(
      apiRequest('/api/agentteams/audit', {
        'x-agentteams-user': 'attacker',
        'x-agentteams-user-level': '3',
      }),
    );
    expect(forwardedHeader(res, 'x-agentteams-user')).toBe('local-admin');
    expect(forwardedHeader(res, 'x-agentteams-user-level')).toBe('3');
  });

  it('does not inject identity when auth is enabled and no session cookie exists', async () => {
    delete process.env.AGENTTEAMS_AUTH_DISABLED;
    const res = await proxy(apiRequest('/api/agentteams/audit'));
    expect(res.status).toBe(401);
    expect(forwardedHeader(res, 'x-agentteams-user')).toBeNull();
  });
});
