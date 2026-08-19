import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from './route';
import { zipSync } from 'fflate';

// Build a minimal valid ZIP once.
const validSkillMd = new TextEncoder().encode(
  '---\nname: test-skill\ndescription: A test skill.\n---\n',
);
const validZip = zipSync({ 'SKILL.md': validSkillMd });

// An invalid ZIP (no SKILL.md) that parseSkillPackage rejects.
const noSkillMdZip = zipSync({ 'README.md': new TextEncoder().encode('hello') });

// A ZIP missing the name field in frontmatter.
const noNameZip = zipSync({
  'SKILL.md': new TextEncoder().encode('---\ndescription: no name\n---\n'),
});

// Mock the controller restart path (no real controller in tests).
vi.mock('@/lib/worker-restart', () => ({
  restartWorkerForSkillReload: vi.fn().mockResolvedValue({ ok: true, phase: 'Running' }),
}));

// Mock minio-client.
vi.mock('@/lib/minio-client', () => {
  const putObject = vi.fn().mockResolvedValue(undefined);
  const statObject = vi.fn().mockResolvedValue({});
  // listObjects returns a stream whose `data` events echo back whatever
  // keys putObject has been called with since the previous listObjects
  // call. The route POST handler relies on the recursive listing to
  // cross-check the upload count, while the GET handler reuses the
  // same stream to enumerate skills. We snapshot (and clear) the
  // pending keys at the start of each listing so cross-test leakage
  // doesn't pollute the count.
  let pendingKeys: string[] = [];
  putObject.mockImplementation((_bucket: string, key: string) => {
    pendingKeys.push(key);
    return Promise.resolve(undefined);
  });
  function makeStream() {
    const snapshot = pendingKeys;
    pendingKeys = [];
    return {
      on: (event: string, cb: (..._args: unknown[]) => void) => {
        if (event === 'data') {
          for (const key of snapshot) {
            setTimeout(() => cb({ name: key }), 0);
          }
        }
        if (event === 'end') setTimeout(cb, 0);
        return makeStream();
      },
    };
  }
  const mockClient = {
    listObjects: () => makeStream(),
    putObject,
    statObject,
  };
  return {
    createMinioClient: () => mockClient,
    getMinioBucket: () => 'agentteams-fs',
  };
});

async function callGET(name: string) {
  const req = new NextRequest(
    `http://localhost/api/agentteams/workers/${encodeURIComponent(name)}/skills`,
  );
  return GET(req, { params: Promise.resolve({ name }) });
}

/** Build a NextRequest that pretends to be multipart by mocking formData. */
function buildMultipartRequest(name: string, zipBytes: Uint8Array<ArrayBuffer>): NextRequest {
  const req = new NextRequest(
    `http://localhost/api/agentteams/workers/${encodeURIComponent(name)}/skills`,
    {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=----TestBoundary' },
    },
  );
  // Override formData to return a properly constructed FormData.
  req.formData = async () => {
    const form = new FormData();
    form.append('file', new Blob([zipBytes], { type: 'application/zip' }), 'pkg.zip');
    return form;
  };
  return req;
}

describe('GET /workers/[name]/skills', () => {
  it('returns 400 for an invalid worker name', async () => {
    const res = await callGET('bad/name');
    expect(res.status).toBe(400);
  });

  it('returns a JSON body with a skills array on success', async () => {
    const res = await callGET('worker-1');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('skills');
    expect(Array.isArray(json.skills)).toBe(true);
  });
});

describe('POST /workers/[name]/skills', () => {
  it('rejects non-multipart requests', async () => {
    const req = new NextRequest(
      'http://localhost/api/agentteams/workers/worker-1/skills',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      },
    );
    const res = await POST(req, { params: Promise.resolve({ name: 'worker-1' }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid worker name', async () => {
    const req = buildMultipartRequest('bad/name', validZip);
    const res = await POST(req, { params: Promise.resolve({ name: 'bad/name' }) });
    expect(res.status).toBe(400);
  });

  it('accepts a valid multipart request and returns success', async () => {
    const req = buildMultipartRequest('worker-1', validZip);
    const res = await POST(req, { params: Promise.resolve({ name: 'worker-1' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('success', true);
    expect(json).toHaveProperty('skillName', 'test-skill');
    expect(json).toHaveProperty('description', 'A test skill.');
  });

  it('writes the package to the canonical skills/ prefix (no runtime subpath)', async () => {
    // Regression: per-runtime subpaths were removed so the AT reconciler
    // can rely on a single canonical location per worker.
    const { createMinioClient } = await import('@/lib/minio-client');
    const client = createMinioClient() as unknown as { putObject: ReturnType<typeof vi.fn> };
    const req = buildMultipartRequest('worker-1', validZip);
    const res = await POST(req, { params: Promise.resolve({ name: 'worker-1' }) });
    expect(res.status).toBe(200);
    const key = client.putObject.mock.calls[0]?.[1] as string;
    expect(key).toBe('agents/worker-1/skills/test-skill/SKILL.md');
  });

  it('returns 502 when the SKILL.md verification fails after upload', async () => {
    const { createMinioClient } = await import('@/lib/minio-client');
    const client = createMinioClient() as unknown as { statObject: ReturnType<typeof vi.fn> };
    client.statObject.mockRejectedValueOnce(new Error('not found'));
    const req = buildMultipartRequest('worker-1', validZip);
    const res = await POST(req, { params: Promise.resolve({ name: 'worker-1' }) });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toContain('SKILL.md');
  });

  it('rejects a ZIP missing SKILL.md', async () => {
    const req = buildMultipartRequest('worker-1', noSkillMdZip);
    const res = await POST(req, { params: Promise.resolve({ name: 'worker-1' }) });
    expect(res.status).toBe(400);
  });

  it('rejects a ZIP missing name frontmatter', async () => {
    const req = buildMultipartRequest('worker-1', noNameZip);
    const res = await POST(req, { params: Promise.resolve({ name: 'worker-1' }) });
    expect(res.status).toBe(400);
  });
});
