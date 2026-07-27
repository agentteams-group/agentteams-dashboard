import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { rejectExternalModelProvider, rejectUnavailableExternalModelAlias } from './external-model-binding-guard';
import { callHigressConsole } from '../higress/proxy-helper';

vi.mock('../higress/proxy-helper', () => ({
  callHigressConsole: vi.fn(),
}));

const mockCallHigressConsole = vi.mocked(callHigressConsole);

describe('external model binding guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('allows a request model alias with an available provider route binding', async () => {
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'external');
    mockCallHigressConsole
      .mockResolvedValueOnce({ response: new Response(null, { status: 200 }), body: { providers: [{ name: 'openai', tokenCount: 1 }] } })
      .mockResolvedValueOnce({ response: new Response(null, { status: 200 }), body: { routes: [{ name: 'chat', upstreams: [{ provider: 'openai', modelMapping: { 'team-chat': 'gpt-4.1' } }] }] } });

    const result = await rejectUnavailableExternalModelAlias(
      new NextRequest('http://dashboard.test/api/agentteams/workers'),
      'team-chat'
    );

    expect(result).toBeNull();
  });

  it('rejects an alias without an available external binding', async () => {
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'external');
    mockCallHigressConsole
      .mockResolvedValueOnce({ response: new Response(null, { status: 200 }), body: { providers: [] } })
      .mockResolvedValueOnce({ response: new Response(null, { status: 200 }), body: { routes: [] } });

    const result = await rejectUnavailableExternalModelAlias(
      new NextRequest('http://dashboard.test/api/agentteams/workers'),
      'team-chat'
    );

    expect(result?.status).toBe(409);
    await expect(result?.json()).resolves.toEqual({
      error: 'Request model alias "team-chat" has no available external Higress binding',
    });
  });

  it('rejects a legacy modelProvider on external-mode create and update requests', async () => {
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'external');

    const result = await rejectExternalModelProvider(new NextRequest('http://dashboard.test/api/agentteams/workers', {
      method: 'POST',
      body: JSON.stringify({ model: 'team-chat', modelProvider: 'legacy-provider' }),
    }));

    expect(result?.status).toBe(409);
    await expect(result?.json()).resolves.toEqual({
      error: 'External Higress mode uses the request model alias. Remove modelProvider and configure the model alias on an available Higress AI Route.',
    });
  });

  it('checks a Worker model before external runtime startup', async () => {
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'external');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: 'team-chat' }))));
    mockCallHigressConsole
      .mockResolvedValueOnce({ response: new Response(null, { status: 200 }), body: { providers: [{ name: 'openai', tokenCount: 1 }] } })
      .mockResolvedValueOnce({
        response: new Response(null, { status: 200 }),
        body: {
          routes: [{ name: 'chat', upstreams: [{ provider: 'openai', modelMapping: { 'team-chat': 'gpt-4.1' } }] }],
        },
      });

    const { rejectUnavailableExternalWorkerAlias } = await import('./external-model-binding-guard');
    const result = await rejectUnavailableExternalWorkerAlias(
      new NextRequest('http://dashboard.test/api/agentteams/workers/worker-a/wake'),
      'http://controller.test',
      'worker-a'
    );

    expect(result).toBeNull();
  });

  it('rejects a Worker with a legacy modelProvider before external runtime startup', async () => {
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'external');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: 'team-chat',
      modelProvider: 'legacy-provider',
    }))));

    const { rejectUnavailableExternalWorkerAlias } = await import('./external-model-binding-guard');
    const result = await rejectUnavailableExternalWorkerAlias(
      new NextRequest('http://dashboard.test/api/agentteams/workers/worker-a/wake'),
      'http://controller.test',
      'worker-a'
    );

    expect(result?.status).toBe(409);
  });
});
