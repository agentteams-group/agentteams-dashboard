import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { isValidNameSegment } from '@/lib/skill-package';

async function tryStatAndGet(
  client: ReturnType<typeof createMinioClient>,
  bucket: string,
  key: string,
): Promise<{ stat: Awaited<ReturnType<typeof client.statObject>>; stream: ReturnType<typeof client.getObject> } | null> {
  try {
    const stat = await client.statObject(bucket, key);
    const stream = await client.getObject(bucket, key);
    return { stat, stream };
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const rawKey = request.nextUrl.searchParams.get('key') || '';
  const key = rawKey.startsWith('agents/') ? rawKey.slice('agents/'.length) : rawKey;

  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }

  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  if (!key.startsWith(`${name}/`)) {
    return NextResponse.json({ error: '非法 Worker 文件路径' }, { status: 400 });
  }

  try {
    const client = createMinioClient();
    let result = await tryStatAndGet(client, bucket, key);
    if (!result) {
      result = await tryStatAndGet(client, bucket, `agents/${key}`);
    }
    if (!result) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    const { stat, stream: nodeStream } = result;
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
