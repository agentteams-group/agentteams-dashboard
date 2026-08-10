import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const restartMock = vi.fn();
vi.mock('@/lib/worker-restart', () => ({
  restartWorkerForSkillReload: (...args: unknown[]) => restartMock(...args),
}));

import { POST } from './route';

function callPOST(name: string) {
  const req = new NextRequest(
    `http://localhost/api/agentteams/workers/${encodeURIComponent(name)}/restart`,
    { method: 'POST' },
  );
  return POST(req, { params: Promise.resolve({ name }) });
}

describe('POST /workers/[name]/restart', () => {
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
