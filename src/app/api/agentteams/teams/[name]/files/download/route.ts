import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import type { Client } from 'minio';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { isValidNameSegment } from '@/lib/skill-package';
import { enforceServerSideRbac } from '@/lib/server-auth';
import { isSensitiveObjectKey, normalizeStorageBucket, normalizeStorageKey } from '@/lib/sensitive-files';

async function tryStatAndGet(
  client: Client,
  bucket: string,
  key: string,
): Promise<{ stat: Awaited<ReturnType<Client['statObject']>>; stream: Readable } | null> {
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
  const key = request.nextUrl.searchParams.get('key') || '';

  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Team 名' }, { status: 400 });
  }

  // SEC-03：对齐 workers/[name]/files/download 的双门——
  // ① 服务端 RBAC：team 可见性由会话身份判定（L2 团队范围 / L1 全局只读）；
  // ② 敏感文件过滤（credentials/.ssh 等）：统一 404，不暴露存在性。
  const denied = await enforceServerSideRbac(request, 'view', 'team', name);
  if (denied) return denied;

  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  let normalizedKey: string;
  try {
    normalizedKey = normalizeStorageKey(key);
    normalizeStorageBucket(bucket);
  } catch {
    return NextResponse.json({ error: '文件不存在' }, { status: 404 });
  }
  if (!normalizedKey.startsWith(`teams/${name}/`)) {
    return NextResponse.json({ error: '非法 Team 文件路径' }, { status: 400 });
  }

  if (isSensitiveObjectKey(normalizedKey)) {
    return NextResponse.json({ error: '文件不存在' }, { status: 404 });
  }

  try {
    const client = createMinioClient();
    const result = await tryStatAndGet(client, bucket, normalizedKey);
    if (!result) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    const { stat, stream: nodeStream } = result;
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    const headers = new Headers();
    headers.set('Content-Type', stat.metaData?.['content-type'] || 'application/octet-stream');
    headers.set('Content-Length', String(stat.size));
    headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(normalizedKey.split('/').pop() || normalizedKey)}"`);

    return new NextResponse(webStream, { headers });
  } catch {
    return NextResponse.json({ error: '无法读取 Team 文件' }, { status: 502 });
  }
}
