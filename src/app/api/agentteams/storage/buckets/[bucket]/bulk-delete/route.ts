// POST /api/agentteams/storage/buckets/[bucket]/bulk-delete — Bulk delete objects
import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient } from '@/lib/minio-client';
import { guardStorageObject } from '../../../security';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bucket: string }> }
) {
  const { bucket } = await params;

  try {
    const body = await request.json();
    const keys = body.keys as string[] | undefined;

    if (!keys || !Array.isArray(keys) || keys.length === 0 || keys.some((key) => typeof key !== 'string' || !key)) {
      return NextResponse.json({ error: 'keys array is required' }, { status: 400 });
    }

    // 全量预检：任一秘密对象/越权对象都让整个请求失败，且不得调用 MinIO。
    const guardedKeys: string[] = [];
    let guardedBucket = bucket;
    for (const key of keys) {
      const guarded = await guardStorageObject(request, 'delete', bucket, key);
      if (guarded.response) return guarded.response;
      guardedBucket = guarded.bucket;
      guardedKeys.push(guarded.key);
    }

    const client = createMinioClient();
    const results: { key: string; success: boolean; error?: string }[] = [];

    // MinIO removeObjects accepts max 1000 at a time
    const batchSize = 1000;
    for (let i = 0; i < guardedKeys.length; i += batchSize) {
      const batch = guardedKeys.slice(i, i + batchSize);
      try {
        await client.removeObjects(guardedBucket, batch);
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
