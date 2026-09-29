/**
 * Storage-plane regression suite (task 16, design.md §3.3.4).
 *
 * Runs the real storage routes against a REAL S3-compatible backend
 * (MinIO / RustFS). Gated behind STORAGE_REGRESSION=1 plus a resolvable
 * storage config so the regular `npm test` pass stays hermetic — the
 * suite skips with a printed reason otherwise.
 *
 * Usage against a live backend:
 *   STORAGE_REGRESSION=1 \
 *   AGENTTEAMS_FS_ENDPOINT=http://host:9000 \
 *   AGENTTEAMS_FS_ACCESS_KEY=... AGENTTEAMS_FS_SECRET_KEY=... \
 *   AGENTTEAMS_FS_BUCKET=agentteams-storage \
 *   npx vitest run src/__tests__/integration/storage-regression.test.ts
 */
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server-auth', () => ({
  enforceLevelOnlyRbac: vi.fn(async () => null),
  enforceServerSideRbac: vi.fn(async () => null),
  readServerIdentity: vi.fn(() => ({ level: 3 })),
}));

import { GET as presignGET } from '@/app/api/agentteams/storage/presign/route';
import { POST as uploadPOST } from '@/app/api/agentteams/storage/upload/route';
import { GET as downloadGET } from '@/app/api/agentteams/storage/download/route';
import { GET as bucketsGET, POST as bucketsPOST } from '@/app/api/agentteams/storage/buckets/route';
import { GET as bucketGET, PUT as bucketPUT, DELETE as bucketDELETE } from '@/app/api/agentteams/storage/buckets/[bucket]/route';
import { GET as objectsGET } from '@/app/api/agentteams/storage/buckets/[bucket]/objects/route';
import { PUT as objectPUT, GET as objectGET, DELETE as objectDELETE } from '@/app/api/agentteams/storage/buckets/[bucket]/objects/[...key]/route';
import { POST as bulkDeletePOST } from '@/app/api/agentteams/storage/buckets/[bucket]/bulk-delete/route';
import { GET as statsGET } from '@/app/api/agentteams/storage/buckets/[bucket]/stats/route';
import { GET as skillsGET, POST as skillsPOST } from '@/app/api/agentteams/skills/route';
import { GET as mcpsGET, POST as mcpsPOST, DELETE as mcpsDELETE } from '@/app/api/agentteams/mcps/route';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { SKILL_PACKAGE_MAX_BYTES } from '@/lib/skill-center-types';

const enabled = process.env.STORAGE_REGRESSION === '1';
const config = enabled
  ? (() => {
      const cfg = {
        endPoint: process.env.AGENTTEAMS_FS_ENDPOINT || process.env.AGENTTEAMS_MINIO_ENDPOINT || '',
        accessKey: process.env.AGENTTEAMS_FS_ACCESS_KEY || process.env.AGENTTEAMS_MINIO_USER || '',
        secretKey: process.env.AGENTTEAMS_FS_SECRET_KEY || process.env.AGENTTEAMS_MINIO_PASSWORD || '',
        bucket: process.env.AGENTTEAMS_FS_BUCKET || process.env.AGENTTEAMS_MINIO_BUCKET || 'agentteams-storage',
      };
      if (cfg.endPoint && !cfg.endPoint.startsWith('http')) cfg.endPoint = `http://${cfg.endPoint}`;
      return cfg;
    })()
  : null;

const ready = Boolean(enabled && config?.endPoint && config.accessKey && config.secretKey);
const d = (ready ? describe : describe.skip) as typeof describe;

const PREFIX = `regression-${Date.now()}`;
const TEST_BUCKET = `regression-bucket-${Date.now()}`;
const createdBuckets: string[] = [];

function jsonReq(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  });
}

function client() {
  const url = new URL(config!.endPoint);
  return createMinioClient({
    endPoint: url.hostname,
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    useSSL: url.protocol === 'https:',
    accessKey: config!.accessKey,
    secretKey: config!.secretKey,
  });
}

async function putObject(bucket: string, key: string, body: string | Buffer): Promise<void> {
  await client().putObject(bucket, key, body, Buffer.byteLength(body as Buffer));
}

beforeAll(async () => {
  if (!ready) {
    console.warn('[storage-regression] skipped: set STORAGE_REGRESSION=1 and the AGENTTEAMS_FS_* env to run against a live backend');
    return;
  }
  // The configured bucket must exist for the bucket-scoped routes.
  const c = client();
  const exists = await c.bucketExists(config!.bucket).catch(() => false);
  if (!exists) await c.makeBucket(config!.bucket);
});

afterAll(async () => {
  if (!ready) return;
  const c = client();
  for (const bucket of createdBuckets.splice(0)) {
    await c.removeBucket(bucket).catch(() => undefined);
  }
  const objs = await c
    .listObjects(config!.bucket, PREFIX, true)
    .toArray()
    .catch(() => []);
  if (objs.length > 0) {
    await c.removeObjects(
      config!.bucket,
      objs.map((o) => o.name).filter((n): n is string => Boolean(n)),
    );
  }
});

d('§3.3.4 #2 presign chain', () => {
  it('issues a GET presigned URL with 15-minute expiry', async () => {
    const key = `${PREFIX}/presign/get.txt`;
    await putObject(config!.bucket, key, 'presign-me');
    const res = await presignGET(
      jsonReq(`http://localhost/api/agentteams/storage/presign?bucket=${config!.bucket}&key=${encodeURIComponent(key)}`, 'GET'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toContain('X-Amz-Expires=900');
    const fetched = await fetch(body.url);
    expect(fetched.status).toBe(200);
    expect(await fetched.text()).toBe('presign-me');
  });

  it('issues a PUT presigned URL that accepts uploads', async () => {
    const key = `${PREFIX}/presign/put.txt`;
    const res = await presignGET(
      jsonReq(`http://localhost/api/agentteams/storage/presign?bucket=${config!.bucket}&key=${encodeURIComponent(key)}&method=PUT`, 'GET'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    const uploaded = await fetch(body.url, { method: 'PUT', body: 'via-presign' });
    expect([200, 204]).toContain(uploaded.status);
  });

  it('refuses to presign sensitive keys with a uniform 404', async () => {
    const res = await presignGET(
      jsonReq(`http://localhost/api/agentteams/storage/presign?bucket=${config!.bucket}&key=${encodeURIComponent(`${PREFIX}/worker.token`)}`, 'GET'),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: '文件不存在' });
  });

  it('400s when bucket or key are missing', async () => {
    expect((await presignGET(jsonReq('http://localhost/api/agentteams/storage/presign', 'GET'))).status).toBe(400);
  });
});

d('§3.3.4 #3 storage management routes (error-code semantics)', () => {
  it('bucket create / duplicate 409 / get / delete lifecycle', async () => {
    const listRes = await bucketsGET(jsonReq('http://localhost/api/agentteams/storage/buckets', 'GET'));
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { buckets: Array<{ name: string }> };
    expect(listed.buckets.some((b) => b.name === config!.bucket)).toBe(true);

    const created = await bucketPUT(
      jsonReq(`http://localhost/api/agentteams/storage/buckets/${TEST_BUCKET}`, 'PUT'),
      { params: Promise.resolve({ bucket: TEST_BUCKET }) },
    );
    expect([200, 201]).toContain(created.status);
    createdBuckets.push(TEST_BUCKET);

    const duplicate = await bucketPUT(
      jsonReq(`http://localhost/api/agentteams/storage/buckets/${TEST_BUCKET}`, 'PUT'),
      { params: Promise.resolve({ bucket: TEST_BUCKET }) },
    );
    expect(duplicate.status).toBe(409);

    const gone = await bucketDELETE(
      jsonReq(`http://localhost/api/agentteams/storage/buckets/${TEST_BUCKET}`, 'DELETE'),
      { params: Promise.resolve({ bucket: TEST_BUCKET }) },
    );
    expect(gone.status).toBe(200);
    createdBuckets.splice(createdBuckets.indexOf(TEST_BUCKET), 1);

    const missing = await bucketDELETE(
      jsonReq(`http://localhost/api/agentteams/storage/buckets/${TEST_BUCKET}`, 'DELETE'),
      { params: Promise.resolve({ bucket: TEST_BUCKET }) },
    );
    expect(missing.status).toBe(404);
  });

  it('object upload / download / list / stats / delete round-trip', async () => {
    const key = `${PREFIX}/objects/roundtrip.txt`;
    const upload = await uploadPOST(
      jsonReq(`http://localhost/api/agentteams/storage/upload`, 'POST', {
        bucket: config!.bucket,
        key,
        content: 'round-trip-content',
      }),
    );
    expect(upload.status).toBe(200);

    const objectRes = await objectGET(
      jsonReq(`http://localhost/api/agentteams/storage/buckets/${config!.bucket}/objects/${key}`, 'GET'),
      { params: Promise.resolve({ bucket: config!.bucket, key: [key] }) },
    );
    expect(objectRes.status).toBe(200);
    expect(await objectRes.text()).toBe('round-trip-content');

    const list = await objectsGET(
      jsonReq(`http://localhost/api/agentteams/storage/buckets/${config!.bucket}/objects?prefix=${encodeURIComponent(PREFIX)}`, 'GET'),
      { params: Promise.resolve({ bucket: config!.bucket }) },
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { objects?: Array<{ name?: string }> } | Array<{ name?: string }>;
    const names = Array.isArray(listBody) ? listBody.map((o) => o.name) : (listBody.objects ?? []).map((o) => o.name);
    expect(names).toContain(key);

    const stats = await statsGET(
      jsonReq(`http://localhost/api/agentteams/storage/buckets/${config!.bucket}/stats`, 'GET'),
      { params: Promise.resolve({ bucket: config!.bucket }) },
    );
    expect(stats.status).toBe(200);

    const del = await objectDELETE(
      jsonReq(`http://localhost/api/agentteams/storage/buckets/${config!.bucket}/objects/${key}`, 'DELETE'),
      { params: Promise.resolve({ bucket: config!.bucket, key: [key] }) },
    );
    expect([200, 204]).toContain(del.status);
  });

  it('download returns 404 for sensitive keys and missing objects', async () => {
    const sensitive = await downloadGET(
      jsonReq(`http://localhost/api/agentteams/storage/download?bucket=${config!.bucket}&key=${encodeURIComponent(`${PREFIX}/service-account.token`)}`, 'GET'),
    );
    expect(sensitive.status).toBe(404);

    const missing = await downloadGET(
      jsonReq(`http://localhost/api/agentteams/storage/download?bucket=${config!.bucket}&key=${encodeURIComponent(`${PREFIX}/no-such-object`)}`, 'GET'),
    );
    expect(missing.status).toBe(404);
  });

  it('bulk-delete removes a batch and 400s without keys', async () => {
    const keys = [`${PREFIX}/bulk/a.txt`, `${PREFIX}/bulk/b.txt`];
    for (const key of keys) await putObject(config!.bucket, key, 'bulk');
    const bad = await bulkDeletePOST(
      jsonReq(`http://localhost/api/agentteams/storage/buckets/${config!.bucket}/bulk-delete`, 'POST', {}),
      { params: Promise.resolve({ bucket: config!.bucket }) },
    );
    expect(bad.status).toBe(400);

    const ok = await bulkDeletePOST(
      jsonReq(`http://localhost/api/agentteams/storage/buckets/${config!.bucket}/bulk-delete`, 'POST', { keys }),
      { params: Promise.resolve({ bucket: config!.bucket }) },
    );
    expect(ok.status).toBe(200);
  });
});

d('§3.3.4 #1 64MB skill ZIP upload cap', () => {
  it('rejects an over-limit upload with 400', async () => {
    const oversized = Buffer.alloc(SKILL_PACKAGE_MAX_BYTES + 1, 0x41);
    const form = new FormData();
    form.append('file', new Blob([oversized]), 'big.zip');
    const res = await skillsPOST(
      new NextRequest('http://localhost/api/agentteams/skills', { method: 'POST', body: form }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('64 MB');
  }, 60_000);
});

d('§3.3.4 #4 skills sources', () => {
  it('lists skills carrying a source field (custom visible in a no-nacos environment)', async () => {
    const res = await skillsGET(jsonReq('http://localhost/api/agentteams/skills', 'GET'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skills: Array<{ name: string; source?: string }> };
    expect(Array.isArray(body.skills)).toBe(true);
    for (const skill of body.skills) {
      expect(['custom', 'nacos', 'builtin']).toContain(skill.source);
    }
  });
});

d('§3.3.4 #6 concurrent listObjects traversal', () => {
  it('survives five concurrent metadata-prefix scans', async () => {
    const c = client();
    const runs = await Promise.all(
      Array.from({ length: 5 }, () =>
        c
          .listObjects(config!.bucket, `${PREFIX}/`, true)
          .toArray()
          .then((items) => items.length),
      ),
    );
    expect(runs).toHaveLength(5);
    expect(new Set(runs).size).toBe(1); // identical prefix → identical counts
  });
});

d('§3.3.4 #8 MCP config CRUD (mcp-servers/ prefix)', () => {
  const name = `regression-mcp-${Date.now()}`;
  it('creates, lists and deletes an MCP config', async () => {
    const created = await mcpsPOST(
      jsonReq('http://localhost/api/agentteams/mcps', 'POST', {
        name,
        url: 'http://mcp.example:3000',
        transport: 'sse',
      }),
    );
    expect([200, 201]).toContain(created.status);

    const list = await mcpsGET(jsonReq('http://localhost/api/agentteams/mcps', 'GET'));
    expect(list.status).toBe(200);
    const body = (await list.json()) as { servers: Array<{ name: string }> };
    expect(body.servers.some((s) => s.name === name)).toBe(true);

    const removed = await mcpsDELETE(
      jsonReq(`http://localhost/api/agentteams/mcps/${name}`, 'DELETE'),
      { params: Promise.resolve({ name }) },
    );
    expect([200, 204]).toContain(removed.status);
  });
});

d('§3.3.4 #7 health probe (minio backend)', () => {
  it('bucket helper resolves the configured bucket and the client reaches the backend', async () => {
    expect(getMinioBucket()).toBeTruthy();
    const buckets = await client().listBuckets();
    expect(buckets.length).toBeGreaterThanOrEqual(1);
  });
});
