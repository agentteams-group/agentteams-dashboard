// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const helperMock = vi.hoisted(() => ({
  getAuthToken: vi.fn(),
  getControllerUrl: vi.fn(),
}));

vi.mock('../../../proxy-helper', () => helperMock);

const auditMock = vi.hoisted(() => ({
  appendAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/audit-log', () => auditMock);

import { GET } from './route';

function makeRequest(name: string, level: number | null, tail?: string): NextRequest {
  const headers = new Headers();
  if (level !== null) {
    headers.set('x-agentteams-user', level === 3 ? 'admin' : 'observer');
    headers.set('x-agentteams-user-level', String(level));
  }
  const query = tail ? `?tail=${tail}` : '';
  return new NextRequest(`http://x/api/agentteams/managers/${name}/logs${query}`, { headers });
}

function urlOf(call: unknown[]): URL {
  return new URL(String(call[0]));
}

function dockerFrame(text: string): Response {
  const payload = Buffer.from(text);
  const head = Buffer.alloc(8);
  head.writeUInt8(1, 0);
  head.writeUInt32BE(payload.length, 4);
  return new Response(Buffer.concat([head, payload]), { status: 200 });
}

const fetchMock = vi.fn();

describe('GET /api/agentteams/managers/[name]/logs', () => {
  beforeEach(() => {
    helperMock.getControllerUrl.mockReturnValue('http://controller.test');
    helperMock.getAuthToken.mockResolvedValue('sa-token');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('rejects an invalid Manager name before touching Docker', async () => {
    const res = await GET(makeRequest('..', 3), { params: Promise.resolve({ name: '..' }) });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('denies a non-admin session (container logs are L3-only)', async () => {
    const res = await GET(makeRequest('default', 1), { params: Promise.resolve({ name: 'default' }) });
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the default Manager container with tail=300', async () => {
    fetchMock.mockResolvedValue(
      dockerFrame('2026-11-08T10:00:00.000000001Z manager booted\n'),
    );
    const res = await GET(makeRequest('default', 3), { params: Promise.resolve({ name: 'default' }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        timestamp: '2026-11-08T10:00:00.000000001Z',
        level: 'info',
        component: 'default',
        message: 'manager booted',
      },
    ]);

    const url = urlOf(fetchMock.mock.calls[0] as unknown[]);
    expect(url.pathname).toBe('/docker/v1.41/containers/agentteams-manager/logs');
    expect(url.searchParams.get('tail')).toBe('300');
    expect(url.searchParams.get('timestamps')).toBe('1');
  });

  it('derives the prefixed container name for non-default Managers and caps tail', async () => {
    fetchMock.mockResolvedValue(dockerFrame('hello\n'));
    await GET(makeRequest('alpha', 3, '999999'), { params: Promise.resolve({ name: 'alpha' }) });

    const url = urlOf(fetchMock.mock.calls[0] as unknown[]);
    expect(url.pathname).toBe('/docker/v1.41/containers/agentteams-manager-alpha/logs');
    expect(url.searchParams.get('tail')).toBe('2000');
  });

  it('passes a missing container through as 404', async () => {
    fetchMock.mockResolvedValue(new Response('no such container', { status: 404 }));
    const res = await GET(makeRequest('ghost', 3), { params: Promise.resolve({ name: 'ghost' }) });
    expect(res.status).toBe(404);
  });

  it('folds other Docker failures into 502', async () => {
    fetchMock.mockResolvedValue(new Response('daemon exploded', { status: 500 }));
    const res = await GET(makeRequest('default', 3), { params: Promise.resolve({ name: 'default' }) });
    expect(res.status).toBe(502);
  });
});
