import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { createMinioClient } from '@/lib/minio-client';
import { enforceLevelOnlyRbac } from '@/lib/server-auth';
import { isSensitiveObjectKey } from '@/lib/sensitive-files';

export async function GET(request: NextRequest) {
  const denied = await enforceLevelOnlyRbac(request, 'view', 'storage', 'download');
  if (denied) return denied;
  const bucket = request.nextUrl.searchParams.get('bucket') || '';
  const key = request.nextUrl.searchParams.get('key') || '';

  if (!bucket || !key) {
    return NextResponse.json({ error: 'bucket and key are required' }, { status: 400 });
  }

  try {
    const objectName = decodeURIComponent(key);
    // 敏感文件（worker 凭据类）与 worker 路由同语义：统一 404。
    if (isSensitiveObjectKey(objectName)) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    const client = createMinioClient();
    const bucketName = decodeURIComponent(bucket);
    const stat = await client.statObject(bucketName, objectName);

    const nodeStream = await client.getObject(bucketName, objectName);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', stat.metaData?.['content-type'] || 'application/octet-stream');
    responseHeaders.set('Content-Length', String(stat.size));
    responseHeaders.set(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(objectName.split('/').pop() || objectName)}"`
    );

    return new NextResponse(webStream, { headers: responseHeaders });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err.code === 'NoSuchKey' || err.code === 'NotFound')) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
