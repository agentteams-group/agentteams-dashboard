import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { unzipSync } from 'fflate';
import { POST } from './route';

vi.mock('../proxy-helper', () => ({
  getAuthToken: vi.fn().mockResolvedValue('sa-token'),
  getControllerUrl: vi.fn().mockReturnValue('http://agentteams-controller:8090'),
}));

vi.mock('./docker', () => ({
  listAgentTeamsContainers: vi.fn().mockResolvedValue([]),
  inspectContainer: vi.fn(),
  getContainerLogs: vi.fn(),
}));

vi.mock('./sessions', () => ({
  exportAgentSessions: vi.fn().mockResolvedValue({
    containers: 0,
    sessions: 0,
    events: 0,
    files: {},
    errors: [],
  }),
}));

vi.mock('./matrix', () => ({
  exportMatrixMessages: vi.fn(),
}));

function buildRequest(rawBody: string): NextRequest {
  return new NextRequest('http://localhost/api/agentteams/debug-log', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody,
  });
}

describe('POST /api/agentteams/debug-log', () => {
  it('returns 400 for a null JSON body', async () => {
    const res = await POST(buildRequest('null'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toHaveProperty('error');
  });

  it('returns 400 for a JSON array body', async () => {
    const res = await POST(buildRequest('[]'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when range is not a string', async () => {
    const res = await POST(buildRequest('{"range": 5}'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/must be a string/);
  });

  it('returns 400 when redact is not a boolean', async () => {
    const res = await POST(buildRequest('{"redact": "yes"}'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/must be a boolean/);
  });

  it('returns 400 for an oversized range', async () => {
    const res = await POST(buildRequest('{"range": "10000d"}'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/too large/i);
  });

  it('returns a zip bundle with summary.txt for an empty collection', async () => {
    const res = await POST(buildRequest('{}'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    const buf = await res.arrayBuffer();
    const files = unzipSync(new Uint8Array(buf));
    expect(files['summary.txt']).toBeDefined();
    const summary = new TextDecoder().decode(files['summary.txt']);
    expect(summary).toContain('AgentTeams Debug Log');
    expect(summary).toContain('Matrix export skipped');
  });
});
