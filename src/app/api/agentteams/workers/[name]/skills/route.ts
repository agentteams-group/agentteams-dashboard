import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import {
  parseSkillPackage,
  skillObjectKey,
  workerSkillsPrefix,
  SKILL_PACKAGE_MAX_BYTES,
  isValidNameSegment,
} from '@/lib/skill-package';
import { getAuthToken } from '../../../proxy-helper';

const SYNC_FAILED_NOTE = '技能已上传，Worker 最长约 5 分钟内自动发现';

async function getControllerBaseUrl(): Promise<string> {
  return (
    process.env.AGENTTEAMS_CONTROLLER_URL ||
    process.env.AGENTTEAMS_API_URL ||
    'http://agentteams-controller:8090'
  );
}

async function restartWorker(workerName: string): Promise<{ ok: boolean; error?: string }> {
  const baseUrl = await getControllerBaseUrl();
  const saToken = await getAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (saToken) {
    headers['authorization'] = `Bearer ${saToken}`;
  }

  // Sleep
  try {
    const sleepUrl = `${baseUrl}/api/v1/workers/${encodeURIComponent(workerName)}/sleep`;
    const sleepRes = await fetch(sleepUrl, { method: 'POST', headers, signal: AbortSignal.timeout(10000) });
    if (!sleepRes.ok) {
      return { ok: false, error: `sleep 失败 HTTP ${sleepRes.status}` };
    }
  } catch (err) {
    return { ok: false, error: `sleep 异常: ${err instanceof Error ? err.message : 'unknown'}` };
  }

  // Small wait to ensure Worker settles
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Wake
  try {
    const wakeUrl = `${baseUrl}/api/v1/workers/${encodeURIComponent(workerName)}/wake`;
    const wakeRes = await fetch(wakeUrl, { method: 'POST', headers, signal: AbortSignal.timeout(10000) });
    if (!wakeRes.ok) {
      return { ok: false, error: `wake 失败 HTTP ${wakeRes.status}` };
    }
  } catch (err) {
    return { ok: false, error: `wake 异常: ${err instanceof Error ? err.message : 'unknown'}` };
  }

  return { ok: true };
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
    // The frontend passes the worker's runtime via ?runtime= so we list
    // skills from the correct workspace path. Falls back to the canonical
    // skills/ directory when omitted.
    const runtime = request.nextUrl.searchParams.get('runtime') || null;
    const prefix = workerSkillsPrefix(name, runtime);
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

    // The frontend includes the worker's runtime in the multipart body when
    // known. Different runtimes read skills from different on-disk paths
    // (e.g. QwenPaw from `.qwenpaw/workspaces/default/skills/`) which we
    // mirror in MinIO so the worker side finds the files where it expects.
    const runtime = (form.get('runtime') as string | null) || null;

    for (const f of parsed.files) {
      const key = skillObjectKey(name, parsed.skillName, f.relativePath, runtime);
      await client.putObject(bucket, key, Buffer.from(f.data), f.data.byteLength, {
        'Content-Type': 'application/octet-stream',
      });
    }

    let note: string;
    const restart = await restartWorker(name);
    if (restart.ok) {
      note = '已通知 Worker 加载新技能';
    } else {
      note = SYNC_FAILED_NOTE;
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
