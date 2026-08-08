import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import {
  callHigressConsole,
  forwardCookies,
  getHigressConsoleURL,
} from '../../higress/proxy-helper';

vi.mock('../../higress/proxy-helper', () => ({
  callHigressConsole: vi.fn(),
  forwardCookies: vi.fn(),
  getHigressConsoleURL: vi.fn(() => 'http://higress-console:8080'),
  higressErrorResponse: vi.fn(),
}));

vi.mock('@/lib/homeserver-allowlist', () => ({
  validateHomeserverUrl: vi.fn(),
}));

const mockCallHigressConsole = vi.mocked(callHigressConsole);
const mockForwardCookies = vi.mocked(forwardCookies);
const mockGetHigressConsoleURL = vi.mocked(getHigressConsoleURL);

function request() {
  return new NextRequest('http://dashboard.test/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'password' }),
  });
}

function successfulConsoleLogin() {
  return {
    response: new Response(null, { status: 200 }),
    body: { success: true },
  };
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    mockCallHigressConsole.mockReset();
    mockForwardCookies.mockReset();
    mockGetHigressConsoleURL.mockReset();
    mockGetHigressConsoleURL.mockReturnValue('http://higress-console:8080');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('skips Console initialization in external Higress mode', async () => {
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'external');
    mockCallHigressConsole.mockResolvedValue(successfulConsoleLogin());

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mockCallHigressConsole).toHaveBeenCalledTimes(1);
    expect(mockCallHigressConsole).toHaveBeenCalledWith('/session/login', {
      method: 'POST',
      body: { username: 'admin', password: 'password' },
      consoleUrl: 'http://higress-console:8080',
    });
    expect(mockCallHigressConsole).not.toHaveBeenCalledWith(
      '/system/init',
      expect.anything(),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retains Console initialization for direct Higress mode', async () => {
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'direct');
    mockCallHigressConsole.mockResolvedValue(successfulConsoleLogin());

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mockCallHigressConsole).toHaveBeenCalledTimes(2);
    expect(mockCallHigressConsole).toHaveBeenNthCalledWith(1, '/system/init', {
      method: 'POST',
      body: {
        adminUser: {
          name: 'admin',
          password: 'password',
          displayName: 'admin',
        },
      },
      consoleUrl: 'http://higress-console:8080',
    });
  });
});
