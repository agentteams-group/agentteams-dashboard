// DELETE /api/agentteams/storage/buckets/[bucket] — Delete a bucket
import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient } from '@/lib/minio-client';
import { enforceLevelOnlyRbac } from '@/lib/server-auth';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ bucket: string }> }
) {
  const { bucket } = await params;
  const bucketName = decodeURIComponent(bucket);
  const denied = await enforceLevelOnlyRbac(request, 'delete', 'storage.bucket', bucketName);
  if (denied) return denied;
  try {
    const client = createMinioClient();

    const exists = await client.bucketExists(bucketName);
    if (!exists) {
      return NextResponse.json({ error: `Bucket "${bucketName}" does not exist` }, { status: 404 });
    }

    await client.removeBucket(bucketName);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to delete bucket';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
