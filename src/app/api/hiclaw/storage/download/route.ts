import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { createMinioClient } from '@/lib/minio-client';

export async function GET(request: NextRequest) {
  const bucket = request.nextUrl.searchParams.get('bucket') || '';
  const key = request.nextUrl.searchParams.get('key') || '';

  if (!bucket || !key) {
    return NextResponse.json({ error: 'bucket and key are required' }, { status: 400 });
  }

  try {
    const client = createMinioClient();
    const objectName = decodeURIComponent(key);
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
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
