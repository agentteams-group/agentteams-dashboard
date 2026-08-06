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
import { fetchNacosSkillZip, cacheSkillContent } from '@/lib/nacos-fetcher';
import type { NacosZipResult } from '@/lib/nacos-fetcher';

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

  const config = await getNacosConfig();
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
    let nacosResult: NacosZipResult;
    try {
      nacosResult = await fetchNacosSkillZip(name, config);
    } catch (nacosErr) {
      return NextResponse.json({
        error: nacosErr instanceof Error ? nacosErr.message : 'Nacos 下载失败',
      }, { status: 502 });
    }

    // Parse the ZIP to extract and cache files
    try {
      const { unzipSync } = await import('fflate');
      const entries = unzipSync(nacosResult.zipBytes);
      const files = Object.entries(entries).map(([relativePath, data]) => ({
        relativePath,
        data: data as Uint8Array,
      }));

      if (files.length === 0) {
        return NextResponse.json({ error: '从 Nacos 获取的技能包为空' }, { status: 502 });
      }

      await cacheSkillContent(client, name, files);

      const zipBuffer = Buffer.from(nacosResult.zipBytes);
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
      const zipBuffer = Buffer.from(nacosResult.zipBytes);
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
