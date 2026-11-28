import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient } from '@/lib/minio-client';
import { guardStorageObject } from '../security';

const PRESIGN_EXPIRY_SECONDS = 15 * 60;

export async function GET(request: NextRequest) {
  const bucket = request.nextUrl.searchParams.get('bucket') || '';
  const key = request.nextUrl.searchParams.get('key') || '';
  const guarded = await guardStorageObject(request, 'view', bucket, key);
  if (guarded.response) return guarded.response;

  try {
    const client = createMinioClient();
    const url = await client.presignedGetObject(
      guarded.bucket,
      guarded.key,
      PRESIGN_EXPIRY_SECONDS
    );
    return NextResponse.json({ url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  let body: { bucket?: string; key?: string; contentType?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { bucket, key, contentType } = body;
  const guarded = await guardStorageObject(request, 'create', bucket ?? '', key ?? '');
  if (guarded.response) return guarded.response;

  try {
    const client = createMinioClient();
    const url = await client.presignedPutObject(
      guarded.bucket,
      guarded.key,
      PRESIGN_EXPIRY_SECONDS
    );
    return NextResponse.json({ url, fields: contentType ? { 'Content-Type': contentType } : {} });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
