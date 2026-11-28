import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient } from '@/lib/minio-client';
import { guardStorageObject } from '../../../../security';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ bucket: string; key: string[] }> }
) {
  const { bucket, key } = await params;
  const guarded = await guardStorageObject(request, 'delete', bucket, key.join('/'));
  if (guarded.response) return guarded.response;

  try {
    const client = createMinioClient();
    await client.removeObject(guarded.bucket, guarded.key);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
