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
  const rawKey = request.nextUrl.searchParams.get('key') || '';
  const key = rawKey.startsWith('agents/') ? rawKey.slice('agents/'.length) : rawKey;  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }

  // B1（维护者 1.2.4 联调验收报告）：文件下载是独立漏口——原先只查 key 前缀，
  // 受限用户（L2 团队范围 / L3 只读指定 Worker）可绕过 Worker 可见性取任意
  // 本 Worker 文件（含 credentials.yaml）。双门：
  // ① 服务端 RBAC（与 workers 主路由同引擎）：可见性由会话身份判定；
  // ② 敏感文件过滤（对齐插件 _kb_is_sensitive 共享定义）：统一 404，
  //    不暴露存在性。
  const denied = await enforceServerSideRbac(request, 'view', 'worker', name);
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
  if (!normalizedKey.startsWith(`${name}/`)) {
    return NextResponse.json({ error: '非法 Worker 文件路径' }, { status: 400 });
  }
  if (isSensitiveObjectKey(normalizedKey)) {
    return NextResponse.json({ error: '文件不存在' }, { status: 404 });
  }

  try {
    const client = createMinioClient();
    let result = await tryStatAndGet(client, bucket, normalizedKey);
    if (!result) {
      result = await tryStatAndGet(client, bucket, `agents/${normalizedKey}`);
    }
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
    return NextResponse.json({ error: '无法读取 Worker 文件' }, { status: 502 });
  }
}
