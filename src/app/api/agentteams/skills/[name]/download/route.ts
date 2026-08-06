import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { isValidNameSegment } from '@/lib/skill-package';
import { getNacosConfig } from '@/lib/skill-center-config';
import {
  SkillEntry,
  SKILLS_BUCKET,
  SKILLS_METADATA_PREFIX,
} from '@/lib/skill-center-types';
import { zipSync, unzipSync } from 'fflate';
import { fetchNacosSkillZip, cacheSkillContent } from '@/lib/nacos-fetcher';

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

async function listSkillFiles(client: any, skillName: string): Promise<string[]> {
  const prefix = `${skillName}/`;
  const files: string[] = [];
  const stream = client.listObjects(SKILLS_BUCKET, prefix, false);

  for await (const obj of stream) {
    if (!obj.name) continue;
    files.push(obj.name.replace(prefix, ''));
  }

  return files.sort();
}

async function readObject(client: any, skillName: string, relativePath: string): Promise<Buffer> {
  const key = `${skillName}/${relativePath}`;
  const stream = await client.getObject(SKILLS_BUCKET, key);
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  return Buffer.concat(chunks);
}

function serveZip(name: string, zipBytes: Uint8Array): NextResponse {
  const buf = Buffer.from(zipBytes);
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${name}.zip"`,
      'Content-Length': String(buf.length),
    },
  });
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

  try {
    const client = createMinioClient();
    const metadata = await getSkillMetadata(client, name);
    if (!metadata) {
      return NextResponse.json({ error: '技能不存在' }, { status: 404 });
    }

    if (metadata.source === 'nacos') {
      const fileNames = await listSkillFiles(client, name);

      if (fileNames.length > 0) {
        const entries: Record<string, Uint8Array> = {};
        for (const fileName of fileNames) {
          const data = await readObject(client, name, fileName);
          entries[fileName] = new Uint8Array(data);
        }
        return serveZip(name, zipSync(entries));
      }

      const config = getNacosConfig();
      if (!config) {
        return NextResponse.json({ error: 'Nacos 未配置，无法自动拉取技能内容' }, { status: 400 });
      }

      const result = await fetchNacosSkillZip(name, config);
      if (!result) {
        return NextResponse.json({
          error: `无法从 Nacos 获取技能 "${name}" 的内容`,
        }, { status: 502 });
      }

      try {
        const entries = unzipSync(result.zipBytes);
        const files = Object.entries(entries).map(([relativePath, data]) => ({
          relativePath,
          data: data as Uint8Array,
        }));

        if (files.length > 0) {
          await cacheSkillContent(client, name, files);
        }
      } catch {
        // non-zip content, skip caching
      }

      return serveZip(name, result.zipBytes);
    }

    const fileNames = await listSkillFiles(client, name);
    if (fileNames.length === 0) {
      return NextResponse.json({ error: '技能文件不存在' }, { status: 404 });
    }

    const entries: Record<string, Uint8Array> = {};
    for (const fileName of fileNames) {
      const data = await readObject(client, name, fileName);
      entries[fileName] = new Uint8Array(data);
    }

    return serveZip(name, zipSync(entries));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
