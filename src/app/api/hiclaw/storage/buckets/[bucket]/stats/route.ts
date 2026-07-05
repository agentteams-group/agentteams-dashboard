// GET /api/hiclaw/storage/buckets/[bucket]/stats — Bucket usage statistics
import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient } from '@/lib/minio-client';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ bucket: string }> }
) {
  const { bucket } = await params;
  const bucketName = decodeURIComponent(bucket);

  try {
    const client = createMinioClient();

    let objectCount = 0;
    let totalSize = 0;

    await new Promise<void>((resolve, reject) => {
      const stream = client.listObjects(bucketName, '', true); // recursive
      stream.on('data', (obj: Record<string, unknown>) => {
        if (typeof obj.name === 'string') {
          objectCount++;
          totalSize += typeof obj.size === 'number' ? obj.size : 0;
        }
      });
      stream.on('error', reject);
      stream.on('end', resolve);
    });

    return NextResponse.json({
      bucket: bucketName,
      objectCount,
      totalSize,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to get bucket stats';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
