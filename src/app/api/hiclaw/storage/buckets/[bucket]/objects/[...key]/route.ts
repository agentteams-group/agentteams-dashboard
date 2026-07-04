import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient } from '@/lib/minio-client';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ bucket: string; key: string[] }> }
) {
  const { bucket, key } = await params;
  const objectKey = decodeURIComponent(key.join('/'));

  try {
    const client = createMinioClient();
    await client.removeObject(decodeURIComponent(bucket), objectKey);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
