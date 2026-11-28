import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { zipSync } from 'fflate';
import {
  SERVER_USER_HEADER,
  SERVER_USER_LEVEL_HEADER,
  SERVER_USER_SCOPE_HEADER,
  SERVER_USER_TEAMS_HEADER,
  SERVER_USER_WORKERS_HEADER,
} from '@/lib/server-auth';

// RBAC 拒绝时会写审计日志——mock 掉以保证测试不落盘。
const auditMock = vi.hoisted(() => ({
  appendAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/audit-log', () => auditMock);

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

function trustedHeaders(contentType?: string): Headers {
  const headers = new Headers({
    [SERVER_USER_HEADER]: 'admin',
    [SERVER_USER_LEVEL_HEADER]: '3',
    [SERVER_USER_SCOPE_HEADER]: 'global',
    [SERVER_USER_TEAMS_HEADER]: '[]',
    [SERVER_USER_WORKERS_HEADER]: '[]',
  });
  if (contentType) headers.set('content-type', contentType);
  return headers;
}

/** Build a request carrying the trusted identity middleware injects. */
function buildMultipartRequest(
  zipBytes: Uint8Array<ArrayBuffer>,
  level: number | null = 3,
): NextRequest {
  const headers = trustedHeaders('multipart/form-data; boundary=----TestBoundary');
  if (level === null) {
    headers.delete(SERVER_USER_HEADER);
    headers.delete(SERVER_USER_LEVEL_HEADER);
    headers.delete(SERVER_USER_SCOPE_HEADER);
    headers.delete(SERVER_USER_TEAMS_HEADER);
    headers.delete(SERVER_USER_WORKERS_HEADER);
  } else if (level !== 3) {
    headers.set(SERVER_USER_HEADER, 'observer');
    headers.set(SERVER_USER_LEVEL_HEADER, String(level));
    headers.set(SERVER_USER_SCOPE_HEADER, 'scoped');
    headers.set(SERVER_USER_TEAMS_HEADER, JSON.stringify(['t1']));
    headers.set(SERVER_USER_WORKERS_HEADER, JSON.stringify(['worker-1']));
  }
  const req = new NextRequest('http://localhost/api/agentteams/packages', {
    method: 'POST',
    headers,
  });
  req.formData = async () => {
    const form = new FormData();
    form.append('file', new Blob([zipBytes], { type: 'application/zip' }), 'pkg.zip');
    return form;
  };
  return req;
}

describe('POST /packages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-multipart requests', async () => {
    const req = new NextRequest('http://localhost/api/agentteams/packages', {
      method: 'POST',
      headers: trustedHeaders('application/json'),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when file is missing', async () => {
    const req = new NextRequest('http://localhost/api/agentteams/packages', {
      method: 'POST',
      headers: trustedHeaders('multipart/form-data; boundary=----TestBoundary'),
    });
    req.formData = async () => new FormData();
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-zip files', async () => {
    const req = new NextRequest('http://localhost/api/agentteams/packages', {
      method: 'POST',
      headers: trustedHeaders('multipart/form-data; boundary=----TestBoundary'),
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

  it('accepts a valid multipart request from an L3 admin session and returns success', async () => {
    const req = buildMultipartRequest(validZip, 3);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const text = await res.text();
    const json = JSON.parse(text);
    expect(json).toHaveProperty('success', true);
    expect(json).toHaveProperty('skillName', 'test-package');
    expect(json).toHaveProperty('description', 'A test package.');
    expect(json).toHaveProperty('filesCount', 1);
    expect(json).toHaveProperty('packageUri');
    // L3 发布的全局技能包必须落在 agents/global/skills/ 前缀下。
    const { createMinioClient } = await import('@/lib/minio-client');
    const putObject = createMinioClient().putObject as ReturnType<typeof vi.fn>;
    const keys = putObject.mock.calls.map((call) => String(call[1]));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith('agents/global/skills/'))).toBe(true);
  });

  it('writes the custom marker after uploading (L3 session)', async () => {
    const { createMinioClient } = await import('@/lib/minio-client');
    const client = createMinioClient();
    const req = buildMultipartRequest(validZip, 3);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const putObject = client.putObject as ReturnType<typeof vi.fn>;
    const markerCall = putObject.mock.calls.find(
      ([, key]) => String(key).endsWith('.agentteams-custom')
    );
    expect(markerCall).toBeDefined();
  });
});

describe('POST /packages L3 写门 (rbac)', () => {
  it('L1 观察者会话上传合法 .zip 被 create 门拒绝（403），不写 MinIO 且审计落 rbac.deny.create', async () => {
    const req = buildMultipartRequest(validZip, 1);
    const res = await POST(req);
    expect(res.status).toBe(403);
    const { createMinioClient } = await import('@/lib/minio-client');
    const putObject = createMinioClient().putObject as ReturnType<typeof vi.fn>;
    expect(putObject).not.toHaveBeenCalled();
    expect(auditMock.appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rbac.deny.create',
        entity_name: 'upload',
        actor_level: 1,
        severity: 'warning',
      }),
    );
  });

  it('无身份头时 fail closed 返回 401', async () => {
    const req = buildMultipartRequest(validZip, null);
    const res = await POST(req);
    expect(res.status).toBe(401);
    const { createMinioClient } = await import('@/lib/minio-client');
    expect(createMinioClient().putObject).not.toHaveBeenCalled();
  });
});
