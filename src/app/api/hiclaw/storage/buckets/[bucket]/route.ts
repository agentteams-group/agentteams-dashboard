// DELETE /api/hiclaw/storage/buckets/[bucket] — Delete a bucket
import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient } from '@/lib/minio-client';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ bucket: string }> }
) {
  const { bucket } = await params;
  try {
    const client = createMinioClient();
    const bucketName = decodeURIComponent(bucket);

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
