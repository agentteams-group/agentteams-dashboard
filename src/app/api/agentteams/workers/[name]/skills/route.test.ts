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
  const mockClient = {
    listObjects: () => ({
      on: (event: string, _cb: (..._args: unknown[]) => void) => {
        if (event === 'end') setTimeout(_cb, 0);
        return mockClient;
      },
    }),
    putObject: vi.fn().mockResolvedValue(undefined),
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
