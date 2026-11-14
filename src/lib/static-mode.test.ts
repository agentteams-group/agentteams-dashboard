import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStatelessAuthMode, statelessDegradedResponse } from './static-mode';

async function bodyOf(res: { json: () => Promise<unknown> }): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe('static-mode helpers (F7)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('isStatelessAuthMode defaults to false (stateful) and flips on DASHBOARD_STATELESS=1', () => {
    expect(isStatelessAuthMode()).toBe(false);
    vi.stubEnv('DASHBOARD_STATELESS', '1');
    expect(isStatelessAuthMode()).toBe(true);
  });

  it('degrades every server-credential-only prefix with 501 + STATIC_MODE_UNAVAILABLE', async () => {
    vi.stubEnv('DASHBOARD_STATELESS', '1');
    const cases: Array<[string, string]> = [
      ['/api/agentteams/storage/buckets', 'storage'],
      ['/api/higress/ai-routes', 'gateway'],
      ['/api/higress/ai-providers', 'gateway'],
      ['/api/agentteams/wen-tian/logs', 'logs'],
      ['/api/agentteams/logs/kubeblocks', 'logs'],
      ['/api/agentteams/debug-log', 'logs'],
      ['/api/agentteams/agentspecs/list', 'nacos'],
      ['/api/agentteams/skills/nacos/status', 'nacos'],
      ['/api/agentteams/models/probe', 'gateway'],
      ['/api/agentteams/infrastructure', 'infrastructure'],
    ];
    for (const [pathname, capability] of cases) {
      const res = statelessDegradedResponse(pathname);
      expect(res, pathname).not.toBeNull();
      expect(res!.status).toBe(501);
      const body = await bodyOf(res!);
      expect(body).toMatchObject({ code: 'STATIC_MODE_UNAVAILABLE', capability, success: false });
    }
  });

  it('passes through (null) when not in stateless mode', () => {
    expect(statelessDegradedResponse('/api/agentteams/storage/buckets')).toBeNull();
  });

  it('passes through (null) when a server credential env is present', () => {
    vi.stubEnv('DASHBOARD_STATELESS', '1');
    vi.stubEnv('AGENTTEAMS_AUTH_TOKEN', 'sa-present');
    expect(statelessDegradedResponse('/api/agentteams/storage/buckets')).toBeNull();
    vi.unstubAllEnvs();
    vi.stubEnv('DASHBOARD_STATELESS', '1');
    vi.stubEnv('AGENTTEAMS_AUTH_TOKEN_FILE', '/tmp/tok');
    expect(statelessDegradedResponse('/api/agentteams/storage/buckets')).toBeNull();
  });

  it('does not degrade data-plane / chat / public routes', () => {
    vi.stubEnv('DASHBOARD_STATELESS', '1');
    expect(statelessDegradedResponse('/api/agentteams/workers')).toBeNull();
    expect(statelessDegradedResponse('/api/agentteams/teams/alpha')).toBeNull();
    expect(statelessDegradedResponse('/api/matrix/sync')).toBeNull();
    expect(statelessDegradedResponse('/api/agentteams/mode')).toBeNull();
    expect(statelessDegradedResponse('/api/agentteams/audit')).toBeNull();
    expect(statelessDegradedResponse('/api/agentteams/session-states')).toBeNull();
  });
});
