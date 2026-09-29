import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const exportMock = vi.fn();
vi.mock('../../debug-log/matrix', () => ({
  exportMatrixMessages: (...args: unknown[]) => exportMock(...args),
}));
const identityMock = vi.fn();
vi.mock('@/lib/server-auth', () => ({
  readServerIdentity: (...args: unknown[]) => identityMock(...args),
}));

import { GET, POST, replayDir } from './route';

function authedPost(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/agentteams/replay/export', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', Authorization: 'Bearer matrix-token' },
  });
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-'));
  process.env.AGENTTEAMS_REPLAY_DIR = tmpDir;
  exportMock.mockReset();
  identityMock.mockReset();
  identityMock.mockReturnValue({ name: 'carol', level: 2 });
});

afterEach(async () => {
  delete process.env.AGENTTEAMS_REPLAY_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('POST /api/agentteams/replay/export', () => {
  it('401s without a server identity', async () => {
    identityMock.mockReturnValue(null);
    const res = await POST(authedPost({ homeserver: 'https://matrix.org', room: '!r' }));
    expect(res.status).toBe(401);
    expect(exportMock).not.toHaveBeenCalled();
  });

  it('400s when homeserver or room are missing', async () => {
    expect((await POST(authedPost({ room: '!r' }))).status).toBe(400);
    expect((await POST(authedPost({ homeserver: 'https://matrix.org' }))).status).toBe(400);
  });

  it('exports with redaction forced on and persists a capability bundle', async () => {
    exportMock.mockResolvedValue({ rooms: 1, messages: 7, files: { 'a.md': { path: 'a.md', content: 'x' } } });
    const res = await POST(authedPost({ homeserver: 'https://matrix.org', room: '!room:server', sinceEpochSec: 1000 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { replayId: string; url: string; messages: number };
    expect(body.messages).toBe(7);
    expect(body.replayId).toMatch(/^[a-f0-9]{32}$/);
    expect(body.url).toBe(`/replay/${body.replayId}`);

    const call = exportMock.mock.calls[0][0] as Record<string, unknown>;
    expect(call.redact).toBe(true); // 脱敏强制开启，不接受调用方关闭
    expect(call.roomFilter).toBe('!room:server');

    const stored = JSON.parse(await fs.readFile(path.join(replayDir(), `${body.replayId}.json`), 'utf8'));
    expect(stored.exportedBy).toBe('carol');
  });

  it('502s when the export yields nothing', async () => {
    exportMock.mockResolvedValue({ rooms: 0, messages: 0, files: {} });
    const res = await POST(authedPost({ homeserver: 'https://matrix.org', room: '!empty' }));
    expect(res.status).toBe(502);
  });
});

describe('GET /api/agentteams/replay/export?id=', () => {
  it('400s on a non-hex id (path traversal guard)', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/agentteams/replay/export?id=..%2F..%2Fetc'),
    );
    expect(res.status).toBe(400);
  });

  it('404s for an unknown id and 200s for a stored bundle', async () => {
    const missing = await GET(
      new NextRequest(`http://localhost/api/agentteams/replay/export?id=${'a'.repeat(32)}`),
    );
    expect(missing.status).toBe(404);

    const id = 'b'.repeat(32);
    await fs.mkdir(replayDir(), { recursive: true });
    await fs.writeFile(path.join(replayDir(), `${id}.json`), '{"replayId":"x"}');
    const found = await GET(
      new NextRequest(`http://localhost/api/agentteams/replay/export?id=${id}`),
    );
    expect(found.status).toBe(200);
    expect(((await found.json()) as { replayId: string }).replayId).toBe('x');
  });
});
