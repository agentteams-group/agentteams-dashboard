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
      healthy: false,
    });
  });
});
