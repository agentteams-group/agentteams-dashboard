import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  SERVER_USER_HEADER,
  SERVER_USER_LEVEL_HEADER,
  SERVER_USER_SCOPE_HEADER,
  SERVER_USER_TEAMS_HEADER,
  SERVER_USER_WORKERS_HEADER,
} from '@/lib/server-auth';

vi.mock('@/lib/audit-log', () => ({
  appendAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

const restartMock = vi.fn();
vi.mock('@/lib/worker-restart', () => ({
  restartWorkerForSkillReload: (...args: unknown[]) => restartMock(...args),
}));

import { POST } from './route';

function callPOST(name: string, headers: Headers = new Headers({
  [SERVER_USER_HEADER]: 'admin',
  [SERVER_USER_LEVEL_HEADER]: '3',
  [SERVER_USER_SCOPE_HEADER]: 'global',
  [SERVER_USER_TEAMS_HEADER]: '[]',
  [SERVER_USER_WORKERS_HEADER]: '[]',
})) {
  const req = new NextRequest(
    `http://localhost/api/agentteams/workers/${encodeURIComponent(name)}/restart`,
    { method: 'POST', headers },
  );
  return POST(req, { params: Promise.resolve({ name }) });
}

describe('POST /workers/[name]/restart', () => {
  it('returns 401 when the trusted middleware identity is missing', async () => {
    const res = await callPOST('worker-1', new Headers());
    expect(res.status).toBe(401);
    expect(restartMock).not.toHaveBeenCalled();
  });

  it('returns 403 for a level-3 non-system admin with unknown scope', async () => {
    const headers = new Headers({
      [SERVER_USER_HEADER]: 'scoped-admin',
      [SERVER_USER_LEVEL_HEADER]: '3',
      [SERVER_USER_SCOPE_HEADER]: 'scoped',
      [SERVER_USER_TEAMS_HEADER]: '[]',
      [SERVER_USER_WORKERS_HEADER]: '[]',
    });
    const res = await callPOST('worker-1', headers);
    expect(res.status).toBe(403);
    expect(restartMock).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    restartMock.mockReset();
  });

  it('returns 400 for an invalid worker name', async () => {
    const res = await callPOST('bad/name');
    expect(res.status).toBe(400);
  });

  it('returns 200 with phase when restart succeeds', async () => {
    restartMock.mockResolvedValue({ ok: true, phase: 'Running' });
    const res = await callPOST('worker-1');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.phase).toBe('Running');
  });

  it('returns 502 with error when worker stays sleeping', async () => {
    restartMock.mockResolvedValue({
      ok: false,
      phase: 'Sleeping',
      error: 'Worker 重启后仍未就绪 (phase=Sleeping)',
    });
    const res = await callPOST('worker-1');
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toContain('未就绪');
    expect(json.phase).toBe('Sleeping');
  });
});
