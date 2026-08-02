import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { NextRequest } from 'next/server';
import { proxyToAgentTeams } from './proxy-helper';

let server: Server;
let controllerUrl: string;
const received: Array<{ method: string; url: string }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    received.push({ method: req.method ?? '', url: req.url ?? '' });
    res.writeHead(204);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  controllerUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('proxyToAgentTeams DELETE', () => {
  it('forwards the DELETE verb and path to the controller', async () => {
    received.length = 0;
    const request = new NextRequest('http://localhost/api/agentteams/teams/alpha-team', {
      method: 'DELETE',
    });

    const res = await proxyToAgentTeams(
      request,
      controllerUrl,
      '/api/v1/teams/alpha-team',
      { forwardBody: false, method: 'DELETE' }
    );

    expect(res.status).toBe(204);
    expect(received).toEqual([{ method: 'DELETE', url: '/api/v1/teams/alpha-team' }]);
  });

  it('surfaces a controller failure as a non-2xx proxy response (not swallowed)', async () => {
    // Swap the handler to reject the delete, then restore it.
    const originalHandler = server.listeners('request')[0];
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      received.push({ method: req.method ?? '', url: req.url ?? '' });
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end('{"error":"conflict"}');
    });

    const request = new NextRequest('http://localhost/api/agentteams/teams/alpha-team', {
      method: 'DELETE',
    });
    const res = await proxyToAgentTeams(
      request,
      controllerUrl,
      '/api/v1/teams/alpha-team',
      { forwardBody: false, method: 'DELETE' }
    );
    const body = await res.text();

    expect(res.status).toBe(409);
    expect(body).toContain('conflict');
    expect(received).toContainEqual({ method: 'DELETE', url: '/api/v1/teams/alpha-team' });

    server.removeAllListeners('request');
    server.on('request', originalHandler);
  });
});
