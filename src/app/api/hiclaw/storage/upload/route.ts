import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { createMinioClient } from '@/lib/minio-client';

export async function POST(request: NextRequest) {
  const bucket = request.nextUrl.searchParams.get('bucket') || '';
  const key = request.nextUrl.searchParams.get('key') || '';
  const contentType = request.nextUrl.searchParams.get('contentType') || 'application/octet-stream';

  if (!bucket || !key) {
    return NextResponse.json({ error: 'bucket and key are required' }, { status: 400 });
  }

  try {
    const client = createMinioClient();
    const objectName = decodeURIComponent(key);
    const bucketName = decodeURIComponent(bucket);

    // Use streaming upload to avoid buffering entire file in memory (OOM on large files)
    const contentLength = request.headers.get('content-length');
    const size = contentLength ? parseInt(contentLength, 10) : undefined;

    if (request.body) {
      const nodeStream = Readable.fromWeb(request.body as import('stream/web').ReadableStream);
      await client.putObject(bucketName, objectName, nodeStream, size, {
        'Content-Type': contentType,
      });
    } else {
      // Fallback: read into buffer if no stream available
      const buffer = Buffer.from(await request.arrayBuffer());
      await client.putObject(bucketName, objectName, buffer, buffer.length, {
        'Content-Type': contentType,
      });
    }

    return NextResponse.json({ success: true, key: objectName });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
