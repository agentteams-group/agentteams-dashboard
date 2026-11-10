import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureManagerModel } from './configure-manager-model';
import { agentteamsApi } from './agentteams-api';
import { higressApi } from './higress-api';

vi.mock('./agentteams-api', () => ({ agentteamsApi: { updateManagerModel: vi.fn(), bindConsumer: vi.fn() } }));
vi.mock('./higress-api', async (original) => ({
  ...await original<typeof import('./higress-api')>(),
  higressApi: { listProviders: vi.fn(), listRoutes: vi.fn(), createProvider: vi.fn(), updateProvider: vi.fn(), createRoute: vi.fn(), updateRoute: vi.fn() },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(higressApi.listProviders).mockResolvedValue([]);
  vi.mocked(higressApi.listRoutes).mockResolvedValue([]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
});

describe('configureManagerModel', () => {
  it('saves provider, authenticated route and manager binding before verifying the saved identity', async () => {
    await configureManagerModel('default', { model: 'test-model', baseUrl: 'https://example.invalid/v1', apiKey: 'synthetic-key' }, vi.fn());
    expect(higressApi.createProvider).toHaveBeenCalledWith(expect.objectContaining({ tokens: ['synthetic-key'], name: 'onboarding-default' }));
    expect(higressApi.createRoute).toHaveBeenCalledWith(expect.objectContaining({
      upstreams: [{ provider: 'onboarding-default', weight: 100, modelMapping: { 'test-model': 'test-model' } }],
      modelPredicates: [{ matchType: 'EQUAL', matchValue: 'test-model' }],
      authConfig: { enabled: true, allowedCredentialTypes: ['key-auth'], allowedConsumers: ['manager'] },
    }));
    expect(agentteamsApi.updateManagerModel).toHaveBeenCalledWith('default', 'test-model');
    expect(agentteamsApi.bindConsumer).toHaveBeenCalledWith('manager');
    expect(fetch).toHaveBeenCalledWith('/api/agentteams/managers/default/gateway-probe/', expect.objectContaining({ body: '{"kind":"model"}' }));
    expect(vi.mocked(agentteamsApi.bindConsumer).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(fetch).mock.invocationCallOrder[0]);
  });

  it('reuses existing configuration without creating providers', async () => {
    await configureManagerModel('default', { model: 'existing' }, vi.fn());
    expect(higressApi.createProvider).not.toHaveBeenCalled();
    expect(agentteamsApi.updateManagerModel).toHaveBeenCalledWith('default', 'existing');
  });

  it('updates the same first-run resources when retrying instead of duplicating them', async () => {
    vi.mocked(higressApi.listProviders).mockResolvedValue([{ name: 'onboarding-default' }] as never);
    vi.mocked(higressApi.listRoutes).mockResolvedValue([{ name: 'onboarding-default', authConfig: { allowedConsumers: ['worker-alice'] } }] as never);
    await configureManagerModel('default', { model: 'test-model', baseUrl: 'https://example.invalid/v1', apiKey: 'new-key' }, vi.fn());
    expect(higressApi.createProvider).not.toHaveBeenCalled();
    expect(higressApi.createRoute).not.toHaveBeenCalled();
    expect(higressApi.updateRoute).toHaveBeenCalledWith('onboarding-default', expect.objectContaining({ authConfig: expect.objectContaining({ allowedConsumers: ['worker-alice', 'manager'] }) }));
  });

  it('does not report success when the gateway cannot call the model', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ success: false, message: 'gateway returned HTTP 429' }) } as Response);
    await expect(configureManagerModel('default', { model: 'existing' }, vi.fn())).rejects.toThrow('HTTP 429');
  });

  it('waits for asynchronous gateway authorization before completing', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ success: false, message: 'gateway returned HTTP 401' }) } as Response);
      const completion = configureManagerModel('default', { model: 'existing' }, vi.fn());
      await vi.advanceTimersByTimeAsync(3000);
      await completion;
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
