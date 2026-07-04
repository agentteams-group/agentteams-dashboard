import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient } from '@/lib/minio-client';
import type { StorageObject } from '@/lib/hiclaw-api';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bucket: string }> }
) {
  const { bucket } = await params;
  const prefix = request.nextUrl.searchParams.get('prefix') || '';

  try {
    const client = createMinioClient();
    const objects: StorageObject[] = [];

    await new Promise<void>((resolve, reject) => {
      const stream = client.listObjects(decodeURIComponent(bucket), prefix, false);
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
