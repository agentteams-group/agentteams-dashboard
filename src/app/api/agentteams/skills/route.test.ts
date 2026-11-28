import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';

vi.mock('@/lib/audit-log', () => ({ appendAuditEvent: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/lib/minio-client', () => ({
  createMinioClient: () => ({ bucketExists: () => Promise.resolve(true) }),
  getMinioBucket: () => 'agentteams-fs',
}));

vi.mock('@/lib/skill-center-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/skill-center-storage')>();
  return {
    ...actual,
    ensureSkillsBucket: vi.fn().mockResolvedValue(undefined),
    listSkills: vi.fn(),
    listGlobalSkills: vi.fn(),
  };
});

import { listSkills as listSkillsActual, listGlobalSkills as listGlobalSkillsActual } from '@/lib/skill-center-storage';

const meta = (name: string, description: string, source: 'custom' | 'nacos' | 'builtin') => ({
  name,
  description,
  source,
  createdAt: '',
  updatedAt: '',
  fileCount: 1,
});

describe('GET /api/agentteams/skills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listSkillsActual).mockResolvedValue([]);
    vi.mocked(listGlobalSkillsActual).mockResolvedValue([]);
    vi.stubEnv('DASHBOARD_STATELESS', '1');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('merges metadata and global skills, metadata takes precedence', async () => {
    vi.mocked(listSkillsActual).mockResolvedValue([meta('custom-skill', '自定义', 'custom')]);
    vi.mocked(listGlobalSkillsActual).mockResolvedValue([
      meta('builtin-skill', '内置', 'builtin'),
      meta('custom-skill', '全局旧条目', 'builtin'),
    ]);
    const req = new NextRequest('http://localhost/api/agentteams/skills');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills).toHaveLength(2);
    const custom = body.skills.find((s: { name: string }) => s.name === 'custom-skill');
    expect(custom.source).toBe('custom');
    expect(custom.description).toBe('自定义');
    const builtin = body.skills.find((s: { name: string }) => s.name === 'builtin-skill');
    expect(builtin.source).toBe('builtin');
  });

  it.each([1, 2, 3])('allows Skills reads and enforces upload RBAC at level %i', async (level) => {
    const headers = { 'x-agentteams-user': `user-${level}`, 'x-agentteams-user-level': String(level) };
    const read = await GET(new NextRequest('http://localhost/api/agentteams/skills', { headers }));
    expect(read.status).toBe(200);
    const write = await POST(new NextRequest('http://localhost/api/agentteams/skills', {
      method: 'POST', headers,
    }));
    // Level 3 passes RBAC and reaches content-type validation; lower levels
    // are denied by the route's independent server-side check.
    expect(write.status).toBe(level === 3 ? 400 : 403);
    if (level < 3) expect(await write.json()).toMatchObject({ action: 'create', resourceType: 'skill' });
  });

  it('filters by source param', async () => {
    vi.mocked(listSkillsActual).mockResolvedValue([meta('a', 'A', 'custom'), meta('b', 'B', 'nacos')]);
    vi.mocked(listGlobalSkillsActual).mockResolvedValue([]);
    const req = new NextRequest('http://localhost/api/agentteams/skills?source=builtin');
    const res = await GET(req);
    const body = await res.json();
    expect(body.skills).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});
