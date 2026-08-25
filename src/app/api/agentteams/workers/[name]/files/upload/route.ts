import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { isValidNameSegment } from '@/lib/skill-package';
import { enforceServerSideRbac } from '@/lib/server-auth';

async function hasPrefix(client: ReturnType<typeof createMinioClient>, bucket: string, prefix: string): Promise<boolean> {
  return new Promise((resolve) => {
    const stream = client.listObjects(bucket, prefix, false);
    stream.on('data', () => { stream.destroy(); resolve(true); });
    stream.on('end', () => resolve(false));
    stream.on('error', () => resolve(false));
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const subdir = request.nextUrl.searchParams.get('prefix') ?? '';

  const denied = await enforceServerSideRbac(request, 'update', 'worker', name);
  if (denied) return denied;

  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }

  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  try {
    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: '请选择要上传的文件' }, { status: 400 });
    }

    const client = createMinioClient();
    const directRoot = `${name}/`;
    const agentsRoot = `agents/${name}/`;
    const rootPrefix = (await hasPrefix(client, bucket, directRoot)) ? directRoot : agentsRoot;

    const dirSuffix = subdir
      ? (subdir.startsWith(directRoot) ? subdir.slice(directRoot.length) : subdir)
      : '';
    const keyPrefix = `${rootPrefix}${dirSuffix}`;
    const safeFileName = file.name.replace(/[<>:"/\\|?*]/g, '_');
    const key = `${keyPrefix}${safeFileName}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    await client.putObject(bucket, key, buffer, file.size, {
      'content-type': file.type || 'application/octet-stream',
    });

    return NextResponse.json({
      success: true,
      key,
      size: file.size,
      name: file.name,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `文件上传失败: ${err instanceof Error ? err.message : '未知错误'}` },
      { status: 502 },
    );
  }
}
