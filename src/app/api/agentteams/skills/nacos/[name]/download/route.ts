import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { getNacosConfig } from '@/lib/skill-center-config';
import { isValidNameSegment } from '@/lib/skill-package';
import {
  SkillEntry,
  SKILLS_BUCKET,
  SKILLS_METADATA_PREFIX,
} from '@/lib/skill-center-types';
import { zipSync } from 'fflate';

async function getSkillMetadata(client: any, skillName: string): Promise<SkillEntry | null> {
  const key = `${SKILLS_METADATA_PREFIX}${skillName}.json`;
  try {
    const stream = await client.getObject(SKILLS_BUCKET, key);
    const data = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
    return JSON.parse(data.toString('utf-8')) as SkillEntry;
  } catch {
    return null;
  }
}

async function cacheSkillContent(
  client: any,
  skillName: string,
  files: { relativePath: string; data: Uint8Array }[]
): Promise<void> {
  for (const f of files) {
    const key = `${skillName}/${f.relativePath}`;
    await client.putObject(
      SKILLS_BUCKET,
      key,
      Buffer.from(f.data),
      f.data.byteLength,
      { 'Content-Type': 'application/octet-stream' }
    );
  }
}

async function fetchNacosSkillZip(config: any, skillName: string): Promise<{
  zipBytes: Uint8Array;
  source: string;
} | null> {
  const protocol = config.protocol || 'http';
  const prefix = config.apiPrefix ?? '/nacos';
  const mode = config.mode || 'services';
  const apiBase = `${protocol}://${config.registryUrl}`;

  // Re-parse the registryUrl to extract host:port and namespace
  const urlMatch = config.registryUrl.match(/^([^/]+)\/(.+)$/);
  if (!urlMatch) return null;
  const [, hostPort, namespace] = urlMatch;

  let accessToken = '';
  if (config.username && config.password) {
    try {
      const loginUrl = `${protocol}://${hostPort}/v1/auth/login`;
      const loginRes = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: config.username, password: config.password }),
        signal: AbortSignal.timeout(10000),
      });
      if (loginRes.ok) {
        const loginData = await loginRes.json() as { accessToken?: string };
        accessToken = loginData.accessToken || '';
      }
    } catch {
      // auth failed, continue without token
    }
  }

  const tokenParam = accessToken ? `&accessToken=${encodeURIComponent(accessToken)}` : '';
  const nsParam = `namespaceId=${encodeURIComponent(namespace)}`;

  // Try Nacos 3.2+ skill detail API
  if (mode === 'skills') {
    const detailUrl = `${apiBase}/v3/console/ai/skills/detail?skillName=${encodeURIComponent(skillName)}&${nsParam}${tokenParam}`;
    const res = await fetch(detailUrl, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json() as { code?: number; data?: { zip?: string; content?: string } };
      if (data.code === 0 && data.data) {
        const zipB64 = data.data.zip || data.data.content || '';
        if (zipB64) {
          return { zipBytes: Buffer.from(zipB64, 'base64'), source: 'skills-detail' };
        }
      }
    }
  }

  // Fallback: try listing again and look for a download URL in service metadata
  if (mode === 'services') {
    const listUrl = `${apiBase}${prefix}/v1/ns/catalog/services?pageNo=1&pageSize=500&${nsParam}${tokenParam}`;
    const listRes = await fetch(listUrl, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (listRes.ok) {
      const data = await listRes.json() as { code?: number; data?: { serviceList?: Record<string, unknown>[] } };
      if (data?.code === 200 && Array.isArray(data?.data?.serviceList)) {
        const service = data.data.serviceList.find(
          (s: Record<string, unknown>) => s.name === skillName || s.serviceName === skillName
        );
        if (service) {
          const homePageUrl = typeof service.homePageUrl === 'string' ? service.homePageUrl : '';
          if (homePageUrl) {
            const zipRes = await fetch(homePageUrl, {
              signal: AbortSignal.timeout(15000),
            });
            if (zipRes.ok && zipRes.headers.get('content-type')?.includes('zip')) {
              const buf = Buffer.from(await zipRes.arrayBuffer());
              return { zipBytes: new Uint8Array(buf), source: 'homePageUrl' };
            }
          }
        }
      }
    }
  }

  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法技能名称' }, { status: 400 });
  }

  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  const config = getNacosConfig();
  if (!config) {
    return NextResponse.json({ error: 'Nacos 未配置' }, { status: 400 });
  }

  try {
    const client = createMinioClient();
    const metadata = await getSkillMetadata(client, name);

    if (!metadata) {
      return NextResponse.json({ error: '技能不存在' }, { status: 404 });
    }

    if (metadata.source !== 'nacos') {
      return NextResponse.json({ error: '此接口仅用于下载 Nacos 来源的技能' }, { status: 400 });
    }

    // Check if content is already cached in MinIO
    const existingFiles: string[] = [];
    const existingStream = client.listObjects(SKILLS_BUCKET, `${name}/`, false);
    for await (const obj of existingStream) {
      if (obj.name) existingFiles.push(obj.name);
    }

    if (existingFiles.length > 0) {
      // Reuse existing cached content
      const fileNames: string[] = [];
      const readStream = client.listObjects(SKILLS_BUCKET, `${name}/`, false);
      for await (const obj of readStream) {
        if (obj.name && obj.name !== `${name}/`) {
          fileNames.push(obj.name.replace(`${name}/`, ''));
        }
      }
      if (fileNames.length === 0) {
        return NextResponse.json({ error: '技能文件不存在' }, { status: 404 });
      }

      const entries: Record<string, Uint8Array> = {};
      for (const fileName of fileNames) {
        try {
          const stream = await client.getObject(SKILLS_BUCKET, `${name}/${fileName}`);
          const chunks: Buffer[] = [];
          await new Promise<void>((resolve, reject) => {
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', () => resolve());
            stream.on('error', reject);
          });
          entries[fileName] = new Uint8Array(Buffer.concat(chunks));
        } catch {
          // skip unreadable files
        }
      }

      const zipBytes = zipSync(entries);
      return new NextResponse(Buffer.from(zipBytes), {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${name}.zip"`,
          'Content-Length': String(zipBytes.length),
        },
      });
    }

    // Not cached — fetch from Nacos
    const result = await fetchNacosSkillZip(config, name);
    if (!result) {
      return NextResponse.json({
        error: `无法从 Nacos 获取技能 "${name}" 的内容。请确认 Nacos 配置和权限。`,
      }, { status: 502 });
    }

    // Parse the ZIP to extract and cache files
    try {
      const { unzipSync } = await import('fflate');
      const entries = unzipSync(result.zipBytes);
      const files = Object.entries(entries).map(([relativePath, data]) => ({
        relativePath,
        data: data as Uint8Array,
      }));

      if (files.length === 0) {
        return NextResponse.json({ error: '从 Nacos 获取的技能包为空' }, { status: 502 });
      }

      await cacheSkillContent(client, name, files);

      const zipBuffer = Buffer.from(result.zipBytes);
      return new NextResponse(zipBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${name}.zip"`,
          'Content-Length': String(zipBuffer.length),
        },
      });
    } catch {
      // If the content is not a valid ZIP, return it as-is (might be raw bytes)
      const zipBuffer = Buffer.from(result.zipBytes);
      return new NextResponse(zipBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${name}.zip"`,
          'Content-Length': String(zipBuffer.length),
        },
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
