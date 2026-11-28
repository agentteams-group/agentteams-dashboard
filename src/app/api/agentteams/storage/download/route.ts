import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { createMinioClient } from '@/lib/minio-client';
import { guardStorageObject } from '../security';

export async function GET(request: NextRequest) {
  const bucket = request.nextUrl.searchParams.get('bucket') || '';
  const key = request.nextUrl.searchParams.get('key') || '';
  const guarded = await guardStorageObject(request, 'view', bucket, key);
  if (guarded.response) return guarded.response;

  try {
    const client = createMinioClient();
    const stat = await client.statObject(guarded.bucket, guarded.key);

    const nodeStream = await client.getObject(guarded.bucket, guarded.key);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', stat.metaData?.['content-type'] || 'application/octet-stream');
    responseHeaders.set('Content-Length', String(stat.size));
    responseHeaders.set(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(guarded.key.split('/').pop() || guarded.key)}"`
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
