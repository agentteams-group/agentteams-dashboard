import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

async function getInfrastructure(mode: string | undefined, gatewayUrl?: string, consoleUrl?: string) {
  vi.resetModules();
  vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', mode);
  vi.stubEnv('AGENTTEAMS_AI_GATEWAY_URL', gatewayUrl);
  vi.stubEnv('AGENTTEAMS_AI_GATEWAY_ADMIN_URL', consoleUrl);
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  vi.stubEnv('AGENTTEAMS_MATRIX_URL', 'http://matrix.test');
  vi.stubEnv('AGENTTEAMS_FS_ENDPOINT', 'http://minio.test');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));

  const { GET } = await import('./route');
  const response = await GET({} as never);
  return response.json();
}

describe('GET /api/agentteams/infrastructure', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('reports external services as unconfigured when deployment URLs are absent', async () => {
    const data = await getInfrastructure('external');

    expect(data.higress).toMatchObject({
      mode: 'external',
      gateway: { configured: false, state: 'unconfigured' },
      console: { configured: false, state: 'unconfigured' },
      healthy: false,
    });
  });

  it('uses the embedded Gateway and Console endpoints in direct mode', async () => {
    const data = await getInfrastructure('direct');

    expect(data.higress).toMatchObject({
      mode: 'direct',
      gateway: { endpoint: 'http://aigw-local.agentteams.io:8080', httpStatus: 503 },
      console: { endpoint: 'http://agentteams-controller:8001', httpStatus: 503 },
    });
    // Gateway data plane is probed on its real readiness surface.
    expect(fetch).toHaveBeenCalledWith(
      'http://aigw-local.agentteams.io:8080/v1/chat/completions',
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
    );
  });

  it('marks the gateway unreachable when the AI route is not proxied (404)', async () => {
    vi.resetModules();
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'external');
    vi.stubEnv('AGENTTEAMS_AI_GATEWAY_URL', 'https://gateway.example.test');
    vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
    vi.stubEnv('AGENTTEAMS_MATRIX_URL', 'http://matrix.test');
    vi.stubEnv('AGENTTEAMS_FS_ENDPOINT', 'http://minio.test');
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('https://gateway.example.test')) {
        return Promise.resolve(new Response('', { status: 404 }));
      }
      return Promise.resolve(new Response('', { status: 200 }));
    }));

    const { GET } = await import('./route');
    const response = await GET({} as never);
    const data = await response.json();

    expect(data.higress).toMatchObject({
      gateway: { configured: true, state: 'unreachable', httpStatus: 404 },
      healthy: false,
    });
  });

  it('treats 401/403 on the AI route as a reachable data plane', async () => {
    vi.resetModules();
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'external');
    vi.stubEnv('AGENTTEAMS_AI_GATEWAY_URL', 'https://gateway.example.test');
    vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
    vi.stubEnv('AGENTTEAMS_MATRIX_URL', 'http://matrix.test');
    vi.stubEnv('AGENTTEAMS_FS_ENDPOINT', 'http://minio.test');
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('https://gateway.example.test')) {
        return Promise.resolve(new Response('', { status: 401 }));
      }
      return Promise.resolve(new Response('', { status: 200 }));
    }));

    const { GET } = await import('./route');
    const response = await GET({} as never);
    const data = await response.json();

    expect(data.higress).toMatchObject({
      gateway: { configured: true, state: 'reachable', httpStatus: 401 },
      healthy: true,
    });
  });

  it('treats every HTTP response as a reachable external service', async () => {
    const data = await getInfrastructure(
      'external',
      'https://gateway.example.test/v1',
      'https://console.example.test/admin',
    );

    expect(data.higress).toMatchObject({
      mode: 'external',
      gateway: {
        configured: true,
        endpoint: 'https://gateway.example.test/v1',
        state: 'reachable',
        httpStatus: 503,
      },
      console: {
        configured: true,
        endpoint: 'https://console.example.test/admin',
        state: 'reachable',
        httpStatus: 503,
      },
      healthy: true,
    });
  });

  it('reports failed Gateway probes as unreachable without masking Console status', async () => {
    vi.resetModules();
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'external');
    vi.stubEnv('AGENTTEAMS_AI_GATEWAY_URL', 'https://gateway.example.test');
    vi.stubEnv('AGENTTEAMS_AI_GATEWAY_ADMIN_URL', 'https://console.example.test');
    vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
    vi.stubEnv('AGENTTEAMS_MATRIX_URL', 'http://matrix.test');
    vi.stubEnv('AGENTTEAMS_FS_ENDPOINT', 'http://minio.test');
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('https://gateway.example.test')) {
        return Promise.reject(new Error('Gateway connection refused'));
      }
      return Promise.resolve(new Response('', { status: 200 }));
    }));

    const { GET } = await import('./route');
    const response = await GET({} as never);
    const data = await response.json();

    expect(data.higress).toMatchObject({
      gateway: {
        configured: true,
        state: 'unreachable',
        error: 'Gateway connection refused',
      },
      console: { configured: true, state: 'reachable', httpStatus: 200 },
      healthy: false,
    });
  });

  it('reports failed Console probes as unreachable without masking Gateway status', async () => {
    vi.resetModules();
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'external');
    vi.stubEnv('AGENTTEAMS_AI_GATEWAY_URL', 'https://gateway.example.test');
    vi.stubEnv('AGENTTEAMS_AI_GATEWAY_ADMIN_URL', 'https://console.example.test');
    vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
    vi.stubEnv('AGENTTEAMS_MATRIX_URL', 'http://matrix.test');
    vi.stubEnv('AGENTTEAMS_FS_ENDPOINT', 'http://minio.test');
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('https://console.example.test')) {
        return Promise.reject(new Error('Console connection refused'));
      }
      return Promise.resolve(new Response('', { status: 200 }));
    }));

    const { GET } = await import('./route');
    const response = await GET({} as never);
    const data = await response.json();

    expect(data.higress).toMatchObject({
      gateway: { configured: true, state: 'reachable', httpStatus: 200 },
      console: {
        configured: true,
        state: 'unreachable',
        error: 'Console connection refused',
      },
      // Gateway is reachable, so runtime adaptation stays healthy even when
      // the optional Console management endpoint is down.
      healthy: true,
    });
  });
});
