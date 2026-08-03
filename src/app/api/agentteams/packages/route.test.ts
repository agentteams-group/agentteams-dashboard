import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { zipSync } from 'fflate';

// Build a minimal valid ZIP once.
const validSkillMd = new TextEncoder().encode(
  '---\nname: test-package\ndescription: A test package.\n---\n',
);
const validZip = zipSync({ 'SKILL.md': validSkillMd });

// An invalid ZIP (no SKILL.md) that parseSkillPackage rejects.
const noSkillMdZip = zipSync({ 'README.md': new TextEncoder().encode('hello') });

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

/** Build a NextRequest that pretends to be multipart by mocking formData. */
function buildMultipartRequest(zipBytes: Uint8Array<ArrayBuffer>): NextRequest {
  const req = new NextRequest('http://localhost/api/agentteams/packages', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=----TestBoundary' },
  });
  req.formData = async () => {
    const form = new FormData();
    form.append('file', new Blob([zipBytes], { type: 'application/zip' }), 'pkg.zip');
    return form;
  };
  return req;
}

describe('POST /packages', () => {
  it('rejects non-multipart requests', async () => {
    const req = new NextRequest('http://localhost/api/agentteams/packages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when file is missing', async () => {
    const req = new NextRequest('http://localhost/api/agentteams/packages', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=----TestBoundary' },
    });
    req.formData = async () => new FormData();
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-zip files', async () => {
    const req = new NextRequest('http://localhost/api/agentteams/packages', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=----TestBoundary' },
    });
    req.formData = async () => {
      const form = new FormData();
      form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'pkg.txt');
      return form;
    };
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for a ZIP missing SKILL.md', async () => {
    const req = buildMultipartRequest(noSkillMdZip);
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('accepts a valid multipart request and returns success', async () => {
    const req = buildMultipartRequest(validZip);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const text = await res.text();
    const json = JSON.parse(text);
    expect(json).toHaveProperty('success', true);
    expect(json).toHaveProperty('skillName', 'test-package');
    expect(json).toHaveProperty('description', 'A test package.');
    expect(json).toHaveProperty('filesCount', 1);
    expect(json).toHaveProperty('packageUri');
  });
});
