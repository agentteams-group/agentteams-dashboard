import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { isValidNameSegment } from '@/lib/skill-package';
import { enforceServerSideRbac } from '@/lib/server-auth';
import { isSensitiveObjectKey, normalizeStorageBucket, normalizeStorageKey } from '@/lib/sensitive-files';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const subdir = request.nextUrl.searchParams.get('prefix') ?? '';

  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Team 名' }, { status: 400 });
  }

  const denied = await enforceServerSideRbac(request, 'update', 'team', name);
  if (denied) return denied;

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

    const teamRoot = `teams/${name}/`;
    const dirSuffix = subdir.startsWith(teamRoot)
      ? subdir.slice(teamRoot.length)
      : subdir;
    const safeFileName = file.name.replace(/[<>:"/\\|?*]/g, '_');
    let key: string;
    try {
      key = normalizeStorageKey(`${teamRoot}${dirSuffix}${safeFileName}`);
      normalizeStorageBucket(bucket);
    } catch {
      return NextResponse.json({ error: '非法 Team 文件路径' }, { status: 400 });
    }
    if (!key.startsWith(teamRoot)) {
      return NextResponse.json({ error: '非法 Team 文件路径' }, { status: 400 });
    }
    if (isSensitiveObjectKey(key)) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    const client = createMinioClient();
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
