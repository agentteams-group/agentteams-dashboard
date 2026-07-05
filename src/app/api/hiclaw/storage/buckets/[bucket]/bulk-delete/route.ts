// POST /api/hiclaw/storage/buckets/[bucket]/bulk-delete — Bulk delete objects
import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient } from '@/lib/minio-client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bucket: string }> }
) {
  const { bucket } = await params;
  const bucketName = decodeURIComponent(bucket);

  try {
    const body = await request.json();
    const keys = body.keys as string[] | undefined;

    if (!keys || !Array.isArray(keys) || keys.length === 0) {
      return NextResponse.json({ error: 'keys array is required' }, { status: 400 });
    }

    const client = createMinioClient();
    const results: { key: string; success: boolean; error?: string }[] = [];

    // MinIO removeObjects accepts max 1000 at a time
    const batchSize = 1000;
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      try {
        await client.removeObjects(bucketName, batch);
        for (const key of batch) {
          results.push({ key, success: true });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Delete failed';
        for (const key of batch) {
          results.push({ key, success: false, error: message });
        }
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return NextResponse.json({ success: true, deleted: succeeded, failed, results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bulk delete failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
