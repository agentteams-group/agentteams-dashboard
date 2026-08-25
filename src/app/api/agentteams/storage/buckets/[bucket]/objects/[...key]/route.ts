import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient } from '@/lib/minio-client';
import { enforceLevelOnlyRbac } from '@/lib/server-auth';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ bucket: string; key: string[] }> }
) {
  const { bucket, key } = await params;
  const objectKey = decodeURIComponent(key.join('/'));
  const bucketName = decodeURIComponent(bucket);
  const denied = await enforceLevelOnlyRbac(request, 'delete', 'storage.object', `${bucketName}/${objectKey}`);
  if (denied) return denied;

  try {
    const client = createMinioClient();
    await client.removeObject(bucketName, objectKey);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
