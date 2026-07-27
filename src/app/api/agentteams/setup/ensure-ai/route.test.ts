import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

describe('POST /api/agentteams/setup/ensure-ai', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'external');
  });

  it('does not write Consumer or AI Route configuration in external mode', async () => {
    const response = await POST();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'External Higress mode is read-only; configure Consumers, Providers, and AI Routes in the external Console',
    });
  });
});
