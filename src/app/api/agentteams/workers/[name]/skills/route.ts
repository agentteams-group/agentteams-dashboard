import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import {
  parseSkillPackage,
  skillObjectKey,
  workerSkillsPrefix,
  SKILL_PACKAGE_MAX_BYTES,
  isValidNameSegment,
} from '@/lib/skill-package';
import { restartWorkerForSkillReload } from '@/lib/worker-restart';
import { enforceServerSideRbac } from '@/lib/server-auth';

const SYNC_FAILED_NOTE = '技能已上传，Worker 最长约 5 分钟内自动发现';

async function restartWorker(workerName: string): Promise<{ ok: boolean; error?: string }> {
  return restartWorkerForSkillReload(workerName);
}

export async function GET(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ name: string }> },
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
    // Every runtime shares the canonical `agents/{workerName}/skills/`
    // directory — the `runtime` query parameter is preserved only so
    // existing Dashboard callers don't have to change, but it no longer
    // changes the prefix we read from.
    const runtime = request.nextUrl.searchParams.get('runtime') || null;
    const prefix = workerSkillsPrefix(name, runtime);
    const skills = new Set<string>();

    // Recursive listing so sub-directories (e.g. `skills/<name>/scripts/`)
    // are enumerated by their first segment just like the top-level skills.
    const stream = client.listObjects(bucket, prefix, true);

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (obj: Record<string, unknown>) => {
        if (typeof obj.name !== 'string' || !obj.name.startsWith(prefix)) return;
        const remainder = obj.name.slice(prefix.length);
        if (!remainder) return;
        // Skip directory placeholder entries.
        if (remainder.endsWith('/')) return;
        const firstSeg = remainder.split('/')[0];
        if (firstSeg) skills.add(firstSeg);
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

  const denied = await enforceServerSideRbac(request, 'update', 'worker', name);
  if (denied) return denied;

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

    // The frontend includes the worker's runtime in the multipart body when
    // known. Runtime is currently unused for path selection — the canonical
    // `agents/{workerName}/skills/{skillName}/` prefix is shared by every
    // runtime and the Worker reconciler is responsible for materialising any
    // runtime-specific mirror. We still echo it back so clients that log the
    // response can tell which runtime received the upload.
    const runtime = (form.get('runtime') as string | null) || null;

    for (const f of parsed.files) {
      const key = skillObjectKey(name, parsed.skillName, f.relativePath, runtime);
      await client.putObject(bucket, key, Buffer.from(f.data), f.data.byteLength, {
        'Content-Type': 'application/octet-stream',
      });
    }

    // Verify the canonical write actually landed. The Worker reconciler and
    // any downstream `spec.skills` update rely on at least the SKILL.md
    // being present, AND every file we attempted to write making it to
    // storage — a partial upload (e.g. mid-stream abort) used to be
    // reported as success and silently broke Worker reconcile.
    const canonicalPrefix = workerSkillsPrefix(name);
    const skillRootPrefix = `${canonicalPrefix}${parsed.skillName}/`;
    const skillMdKey = `${skillRootPrefix}SKILL.md`;

    let skillMdOk = false;
    try {
      await client.statObject(bucket, skillMdKey);
      skillMdOk = true;
    } catch {
      skillMdOk = false;
    }
    if (!skillMdOk) {
      return NextResponse.json(
        {
          error: '技能包已上传但 SKILL.md 验证失败，请重试或检查对象存储',
        },
        { status: 502 },
      );
    }

    // Cross-check the recursive object count against the parsed file count.
    // The expected count includes SKILL.md plus every other file. Directories
    // in the listing are ignored.
    const expectedCount = parsed.files.length;
    let observedCount = 0;
    const listStream = client.listObjects(bucket, skillRootPrefix, true);
    await new Promise<void>((resolve, reject) => {
      listStream.on('data', (obj: Record<string, unknown>) => {
        if (typeof obj.name !== 'string' || !obj.name.startsWith(skillRootPrefix)) return;
        const relative = obj.name.slice(skillRootPrefix.length);
        if (!relative || relative.endsWith('/')) return;
        observedCount += 1;
      });
      listStream.on('error', reject);
      listStream.on('end', resolve);
    });

    if (observedCount !== expectedCount) {
      return NextResponse.json(
        {
          error: `技能包落盘不完整：预期 ${expectedCount} 个文件，实际发现 ${observedCount} 个，请重试。`,
        },
        { status: 502 },
      );
    }

    // When ?restart=false the caller will batch multiple skill uploads
    // and trigger a single restart via POST /workers/{name}/restart.
    const shouldRestart = request.nextUrl.searchParams.get('restart') !== 'false';

    let note: string;
    if (shouldRestart) {
      const restart = await restartWorker(name);
      if (restart.ok) {
        note = '已通知 Worker 加载新技能';
      } else {
        note = SYNC_FAILED_NOTE;
      }
    } else {
      note = '技能文件已写入，等待批量重启';
    }

    return NextResponse.json({
      success: true,
      skillName: parsed.skillName,
      description: parsed.description,
      filesCount: parsed.files.length,
      prefix: workerSkillsPrefix(name, runtime),
      runtime: runtime ?? 'openclaw',
      note,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
