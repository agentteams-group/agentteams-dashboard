import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { isValidNameSegment } from '@/lib/skill-package';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const key = request.nextUrl.searchParams.get('key') || '';
  const allowedPrefixes = [`${name}/`, `agents/${name}/`];

  if (!isValidNameSegment(name) || !allowedPrefixes.some((prefix) => key.startsWith(prefix))) {
    return NextResponse.json({ error: '非法 Worker 文件路径' }, { status: 400 });
  }

  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  try {
    const client = createMinioClient();
    const stat = await client.statObject(bucket, key);
    const nodeStream = await client.getObject(bucket, key);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    const headers = new Headers();
    headers.set('Content-Type', stat.metaData?.['content-type'] || 'application/octet-stream');
    headers.set('Content-Length', String(stat.size));
    headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(key.split('/').pop() || key)}"`);

    return new NextResponse(webStream, { headers });
  } catch {
    return NextResponse.json({ error: '无法读取 Worker 文件' }, { status: 502 });
  }
}
