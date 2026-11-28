// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as route from './route';

const gate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/server-auth', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/server-auth')>(), enforceServerSideRbac: gate }));

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('proxies an authorized Team detail read including the Leader conversation', async () => {
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  gate.mockResolvedValue(null);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: 'alpha', leaderDMRoomID: '!leader:test' }), { status: 200 })));
  const response = await route.GET(new NextRequest('http://localhost/api/agentteams/teams/alpha'), { params: Promise.resolve({ name: 'alpha' }) });
  expect(gate).toHaveBeenCalledWith(expect.anything(), 'view', 'team', 'alpha');
  expect(fetch).toHaveBeenCalledWith('http://controller.test/api/v1/teams/alpha', expect.objectContaining({ method: 'GET' }));
  expect(await response.json()).toMatchObject({ leaderDMRoomID: '!leader:test' });
});

it('retains upstream missing-team status and escapes the Team name', async () => {
  vi.stubEnv('AGENTTEAMS_CONTROLLER_URL', 'http://controller.test');
  gate.mockResolvedValue(null);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"not found"}', { status: 404 })));
  const response = await route.GET(new NextRequest('http://localhost/api/agentteams/teams/alpha'), { params: Promise.resolve({ name: 'a/b' }) });
  expect(response.status).toBe(404);
  expect(fetch).toHaveBeenCalledWith('http://controller.test/api/v1/teams/a%2Fb', expect.anything());
});

it('does not contact the Controller for a denied Team detail read', async () => {
  gate.mockResolvedValue(new Response('denied', { status: 403 }));
  vi.stubGlobal('fetch', vi.fn());
  const response = await route.GET(new NextRequest('http://localhost/api/agentteams/teams/alpha'), { params: Promise.resolve({ name: 'alpha' }) });
  expect(response.status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});
