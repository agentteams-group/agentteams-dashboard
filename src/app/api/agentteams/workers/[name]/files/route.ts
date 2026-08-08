import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { isValidNameSegment } from '@/lib/skill-package';
import type { StorageObject } from '@/lib/agentteams-api';

function listFiles(client: ReturnType<typeof createMinioClient>, bucket: string, prefix: string): Promise<StorageObject[]> {
  return new Promise((resolve, reject) => {
    const objects: StorageObject[] = [];
    const stream = client.listObjects(bucket, prefix, false);
    stream.on('data', (obj: Record<string, unknown>) => {
      if (typeof obj.prefix === 'string') {
        objects.push({ key: obj.prefix, size: 0, isPrefix: true });
      } else if (typeof obj.name === 'string') {
        objects.push({
          key: obj.name,
          size: typeof obj.size === 'number' ? obj.size : 0,
          lastModified: obj.lastModified ? String(obj.lastModified) : undefined,
          etag: typeof obj.etag === 'string' ? obj.etag : undefined,
        });
      }
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(objects));
  });
}

function stripAgentsPrefix(name: string, objects: StorageObject[]): StorageObject[] {
  const prefix = `${name}/`;
  return objects
    .map((obj) => {
      if (obj.key.startsWith('agents/')) {
        return { ...obj, key: obj.key.slice('agents/'.length) };
      }
      return obj;
    })
    .filter((obj) => obj.key === prefix || obj.key.startsWith(prefix));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const subPrefix = request.nextUrl.searchParams.get('prefix') ?? '';
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }

  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  try {
    const client = createMinioClient();

    const resolvePrefix = (base: string): string =>
      base.startsWith(`${name}/`) ? base : `${name}/${base}`;

    const tryList = async (prefix: string) => await listFiles(client, bucket, prefix);

    if (subPrefix) {
      const direct = await tryList(resolvePrefix(subPrefix));
      if (direct.length > 0) return NextResponse.json({ objects: direct, prefix: subPrefix });

      const agentsFallback = stripAgentsPrefix(name, await tryList(`agents/${resolvePrefix(subPrefix)}`));
      return NextResponse.json({ objects: agentsFallback, prefix: subPrefix });
    }

    const rootPrefix = `${name}/`;
    const rootObjects = await tryList(rootPrefix);
    if (rootObjects.length > 0) {
      return NextResponse.json({ objects: rootObjects, prefix: '' });
    }

    const agentsObjects = stripAgentsPrefix(name, await tryList(`agents/${rootPrefix}`));
    return NextResponse.json({ objects: agentsObjects, prefix: '' });
  } catch {
    return NextResponse.json({ error: '无法读取 Worker 文件' }, { status: 502 });
  }
}
