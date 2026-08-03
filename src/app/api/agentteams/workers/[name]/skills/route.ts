import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import {
  parseSkillPackage,
  skillObjectKey,
  workerSkillsPrefix,
  SKILL_PACKAGE_MAX_BYTES,
  isValidNameSegment,
} from '@/lib/skill-package';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }

  const client = createMinioClient();
  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  try {
    const prefix = workerSkillsPrefix(name);
    const skills = new Set<string>();

    const stream = client.listObjects(bucket, prefix, false);

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (obj: Record<string, unknown>) => {
        if (typeof obj.prefix === 'string' && obj.prefix.startsWith(prefix)) {
          const remainder = obj.prefix.slice(prefix.length);
          const firstSeg = remainder.replace(/\/+$/, '').split('/')[0];
          if (firstSeg) skills.add(firstSeg);
        }
      });
      stream.on('error', reject);
      stream.on('end', resolve);
    });

    return NextResponse.json({ skills: Array.from(skills).sort() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: '需要 multipart/form-data 请求' }, { status: 400 });
  }

  const client = createMinioClient();
  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  try {
    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file || !file.name) {
      return NextResponse.json({ error: '缺少技能包文件' }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith('.zip')) {
      return NextResponse.json({ error: '技能包须为 .zip 文件' }, { status: 400 });
    }
    if (file.size > SKILL_PACKAGE_MAX_BYTES) {
      return NextResponse.json({ error: '技能包超过 64 MB 大小限制' }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    let parsed;
    try {
      parsed = parseSkillPackage(bytes);
    } catch (err) {
      const message = err instanceof Error ? err.message : '技能包校验失败';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    for (const f of parsed.files) {
      const key = skillObjectKey(name, parsed.skillName, f.relativePath);
      await client.putObject(bucket, key, f.data, f.data.byteLength, {
        'Content-Type': 'application/octet-stream',
      });
    }

    return NextResponse.json({
      success: true,
      skillName: parsed.skillName,
      description: parsed.description,
      filesCount: parsed.files.length,
      prefix: workerSkillsPrefix(name),
      note: 'Worker 最长约 60 秒内自动加载',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
