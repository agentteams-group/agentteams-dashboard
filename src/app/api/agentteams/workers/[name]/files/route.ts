import { NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { isValidNameSegment } from '@/lib/skill-package';
import type { StorageObject } from '@/lib/agentteams-api';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }

  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  try {
    const client = createMinioClient();
    const objects: StorageObject[] = [];

    await new Promise<void>((resolve, reject) => {
      const stream = client.listObjects(bucket, `${name}/`, false);
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
      stream.on('end', resolve);
    });

    return NextResponse.json({ objects });
  } catch {
    return NextResponse.json({ error: '无法读取 Worker 文件' }, { status: 502 });
  }
}
