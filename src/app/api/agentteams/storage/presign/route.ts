import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient } from '@/lib/minio-client';
import { enforceLevelOnlyRbac } from '@/lib/server-auth';
import { isSensitiveObjectKey } from '@/lib/sensitive-files';

const PRESIGN_EXPIRY_SECONDS = 15 * 60;

export async function GET(request: NextRequest) {
  const denied = await enforceLevelOnlyRbac(request, 'view', 'storage', 'presign');
  if (denied) return denied;
  const bucket = request.nextUrl.searchParams.get('bucket') || '';
  const key = request.nextUrl.searchParams.get('key') || '';

  if (!bucket || !key) {
    return NextResponse.json({ error: 'bucket and key are required' }, { status: 400 });
  }

  try {
    // 敏感文件不签发预签名 URL（与 download 路由同语义，统一 404）。
    const objectName = decodeURIComponent(key);
    if (isSensitiveObjectKey(objectName)) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    const client = createMinioClient();
    const url = await client.presignedGetObject(
      decodeURIComponent(bucket),
      objectName,
      PRESIGN_EXPIRY_SECONDS
    );
    return NextResponse.json({ url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await enforceLevelOnlyRbac(request, 'create', 'storage', 'presign');
  if (denied) return denied;
  let body: { bucket?: string; key?: string; contentType?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { bucket, key, contentType } = body;

  try {
    const bucketName = decodeURIComponent(bucket ?? '');
    if (!bucketName || !key) {
      return NextResponse.json({ error: 'bucket and key are required' }, { status: 400 });
    }

    // 敏感文件不签发预签名 URL（与 GET 分支同语义，统一 404）。
    const objectName = decodeURIComponent(key);
    if (isSensitiveObjectKey(objectName)) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    const client = createMinioClient();
    const url = await client.presignedPutObject(
      bucketName,
      objectName,
      PRESIGN_EXPIRY_SECONDS
    );
    return NextResponse.json({ url, fields: contentType ? { 'Content-Type': contentType } : {} });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
