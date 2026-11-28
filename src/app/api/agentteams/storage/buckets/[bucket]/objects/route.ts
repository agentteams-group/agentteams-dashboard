import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient } from '@/lib/minio-client';
import { filterStorageKeysForIdentity } from '@/lib/server-auth';
import { isSensitiveObjectKey, isSensitiveStoragePrefix } from '@/lib/sensitive-files';
import { guardStoragePrefix } from '../../../security';
import type { StorageObject } from '@/lib/agentteams-api';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bucket: string }> }
) {
  const { bucket } = await params;
  const prefix = request.nextUrl.searchParams.get('prefix') || '';
  const guarded = await guardStoragePrefix(request, bucket, prefix);
  if (guarded.response) return guarded.response;

  try {
    const client = createMinioClient();
    const objects: StorageObject[] = [];

    await new Promise<void>((resolve, reject) => {
      const stream = client.listObjects(guarded.bucket, guarded.prefix, false);
      stream.on('data', (obj: Record<string, unknown>) => {
        if (typeof obj.prefix === 'string') {
          if (isSensitiveStoragePrefix(guarded.bucket, obj.prefix)) return;
          objects.push({ key: obj.prefix, size: 0, isPrefix: true });
        } else if (typeof obj.name === 'string') {
          // 敏感文件（worker 凭据类）不进列表：不暴露其存在性。
          if (isSensitiveObjectKey(obj.name)) return;
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

    const visibleObjects = filterStorageKeysForIdentity(request, 'view', objects, (object) => object.key);
    return NextResponse.json({ objects: visibleObjects });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
