import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// --- Mock minio-client ---
const mockGet = vi.fn();
const mockList = vi.fn();

vi.mock('@/lib/minio-client', () => ({
  createMinioClient: () => ({
    getObject: mockGet,
    listObjects: mockList,
    putObject: vi.fn().mockResolvedValue(undefined),
    bucketExists: vi.fn().mockResolvedValue(true),
  }),
  getMinioBucket: () => 'agentteams-fs',
}));

// --- Mock nacos config ---
const mockGetNacosConfig = vi.fn().mockResolvedValue(null);
vi.mock('@/lib/skill-center-config', () => ({
  getNacosConfig: mockGetNacosConfig,
}));

// --- Mock nacos fetcher ---
const mockFetchNacosSkillZip = vi.fn().mockResolvedValue(null);
const mockCacheSkillContent = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/nacos-fetcher', () => ({
  fetchNacosSkillZip: mockFetchNacosSkillZip,
  cacheSkillContent: mockCacheSkillContent,
}));

// Import after mocking
const { GET } = await import('./route');

const validSkillMd = new TextEncoder().encode(
  '---\nname: test-skill\ndescription: A test skill.\n---\nScript content',
);
const scriptContent = new TextEncoder().encode('echo hello');

function makeStream(data: Uint8Array) {
  const buf = Buffer.from(data);
  return {
    on: vi.fn(function on(this: any, event: string, cb: (..._args: unknown[]) => void) {
      if (event === 'data') {
        setImmediate(() => cb(buf));
      }
      if (event === 'end') {
        setImmediate(() => cb());
      }
      if (event === 'error') {
        setImmediate(() => cb(new Error('not found')));
      }
      return this;
    }),
  } as any;
}

function makeListIterator(items: { name: string }[]) {
  let i = 0;
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          const val = items[i++];
          return { done: !val, value: val };
        },
      };
    },
  };
}

function buildRequest(name: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/agentteams/skills/${encodeURIComponent(name)}/download`,
  );
}

describe('GET /api/agentteams/skills/[name]/download', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 400 for an invalid skill name', async () => {
    const res = await GET(buildRequest('bad/name'), { params: Promise.resolve({ name: 'bad/name' }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('非法技能名称');
  });

  it('returns 404 when skill metadata is not found', async () => {
    mockGet.mockRejectedValueOnce(new Error('not found'));
    const res = await GET(buildRequest('missing'), { params: Promise.resolve({ name: 'missing' }) });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain('技能不存在');
  });

  it('returns 400 for nacos-sourced skills when nacos is not configured', async () => {
    const metadata = {
      name: 'nacos-skill',
      description: 'From nacos',
      source: 'nacos',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      fileCount: 0,
    };
    mockGet
      .mockResolvedValueOnce(makeStream(new TextEncoder().encode(JSON.stringify(metadata))))
      .mockRejectedValue(new Error('not found'));
    mockList.mockReturnValue(makeListIterator([]));

    const res = await GET(buildRequest('nacos-skill'), { params: Promise.resolve({ name: 'nacos-skill' }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Nacos');
  });

  it('serves nacos-sourced skill from cache when files exist', async () => {
    const metadata = {
      name: 'cached-nacos',
      description: 'Cached nacos skill',
      source: 'nacos',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      fileCount: 1,
    };
    const mdContent = new TextEncoder().encode('---\nname: cached-nacos\ndescription: Cached\n---\nHello');
    mockGet
      .mockResolvedValueOnce(makeStream(new TextEncoder().encode(JSON.stringify(metadata))))
      .mockResolvedValueOnce(makeStream(mdContent));
    mockList
      .mockReturnValueOnce(makeListIterator([{ name: 'cached-nacos/skill.md' }]))
      .mockReturnValueOnce(makeListIterator([{ name: 'cached-nacos/skill.md' }]));

    const res = await GET(buildRequest('cached-nacos'), { params: Promise.resolve({ name: 'cached-nacos' }) });
    expect(res.status).toBe(200);
    const blob = await res.blob();
    expect(blob.size).toBeGreaterThan(0);
    expect(res.headers.get('Content-Type')).toBe('application/zip');
  });

  it('returns 404 when skill has no files', async () => {
    const metadata = {
      name: 'empty-skill',
      description: 'Empty',
      source: 'custom',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      fileCount: 0,
    };
    mockGet
      .mockResolvedValueOnce(makeStream(new TextEncoder().encode(JSON.stringify(metadata))))
      .mockRejectedValue(new Error('not found'));
    mockList.mockReturnValue(makeListIterator([]));

    const res = await GET(buildRequest('empty-skill'), { params: Promise.resolve({ name: 'empty-skill' }) });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain('技能文件不存在');
  });

  it('returns a zip file for a valid custom skill', async () => {
    const metadata = {
      name: 'my-skill',
      description: 'My test skill',
      source: 'custom',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      fileCount: 2,
    };
    mockGet
      .mockResolvedValueOnce(makeStream(new TextEncoder().encode(JSON.stringify(metadata))))
      .mockResolvedValueOnce(makeStream(validSkillMd))
      .mockResolvedValueOnce(makeStream(scriptContent));
    mockList.mockReturnValue(
      makeListIterator([
        { name: 'my-skill/SKILL.md' },
        { name: 'my-skill/scripts/run.sh' },
      ]),
    );

    const res = await GET(buildRequest('my-skill'), { params: Promise.resolve({ name: 'my-skill' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/zip');
    expect(res.headers.get('Content-Disposition')).toContain('my-skill.zip');

    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);

    const { unzipSync } = await import('fflate') as any;
    const entries = unzipSync(new Uint8Array(buffer));
    expect(Object.keys(entries)).toContain('SKILL.md');
    expect(Object.keys(entries)).toContain('scripts/run.sh');
    expect(new TextDecoder().decode(entries['SKILL.md'])).toEqual(
      new TextDecoder().decode(validSkillMd),
    );
    expect(new TextDecoder().decode(entries['scripts/run.sh'])).toEqual(
      new TextDecoder().decode(scriptContent),
    );
  });

  it('recursively lists nested files (scripts/, references/ nested subdirs)', async () => {
    // Regression: previously listObjects was called with `recursive=false`,
    // which silently dropped everything under sub-directories. After
    // switching to recursive mode the rebuilt ZIP must contain every
    // nested file with the correct relative path.
    const metadata = {
      name: 'sample-skill',
      description: 'Sample',
      source: 'custom',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      fileCount: 3,
    };
    const marker = new TextEncoder().encode('marker-payload');
    const probe = new TextEncoder().encode('echo nested');
    // `readObject` walks the list after sorting, so the bytes must be
    // mocked in the same order: SKILL.md → references/nested/marker.txt →
    // scripts/probe.sh.
    mockGet
      .mockResolvedValueOnce(makeStream(new TextEncoder().encode(JSON.stringify(metadata))))
      .mockResolvedValueOnce(makeStream(validSkillMd))
      .mockResolvedValueOnce(makeStream(marker))
      .mockResolvedValueOnce(makeStream(probe));
    mockList.mockReturnValue(
      makeListIterator([
        { name: 'sample-skill/SKILL.md' },
        { name: 'sample-skill/scripts/probe.sh' },
        { name: 'sample-skill/references/nested/marker.txt' },
      ]),
    );

    const res = await GET(buildRequest('sample-skill'), { params: Promise.resolve({ name: 'sample-skill' }) });
    expect(res.status).toBe(200);
    // The recursive flag must be set so sub-directories are enumerated.
    expect(mockList).toHaveBeenCalledWith(expect.anything(), 'sample-skill/', true);

    const buffer = await res.arrayBuffer();
    const { unzipSync } = await import('fflate') as any;
    const entries = unzipSync(new Uint8Array(buffer));
    const names = Object.keys(entries).sort();
    expect(names).toEqual(
      ['SKILL.md', 'references/nested/marker.txt', 'scripts/probe.sh'].sort(),
    );
    expect(new TextDecoder().decode(entries['scripts/probe.sh'])).toBe('echo nested');
    expect(new TextDecoder().decode(entries['references/nested/marker.txt'])).toBe('marker-payload');
  });
});
