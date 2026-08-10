import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { isValidNameSegment, workerSkillsPrefix } from '@/lib/skill-package';
import { getAuthToken } from '../../../proxy-helper';

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

  try {
    const sleepUrl = `${baseUrl}/api/v1/workers/${encodeURIComponent(workerName)}/sleep`;
    const sleepRes = await fetch(sleepUrl, { method: 'POST', headers, signal: AbortSignal.timeout(10000) });
    if (!sleepRes.ok) {
      return { ok: false, error: `sleep 失败 HTTP ${sleepRes.status}` };
    }
  } catch (err) {
    return { ok: false, error: `sleep 异常: ${err instanceof Error ? err.message : 'unknown'}` };
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

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

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }

  const restart = await restartWorker(name);
  if (!restart.ok) {
    return NextResponse.json({ error: restart.error }, { status: 502 });
  }

  // Verify: poll the worker's skill list until it stabilizes (max 30s).
  const client = createMinioClient();
  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ success: true, note: 'Worker 已重启' });
  }
  const prefix = workerSkillsPrefix(name);
  const deadline = Date.now() + 30000;
  const skillNames = new Set<string>();
  let lastError: string | null = null;

  while (Date.now() < deadline) {
    try {
      skillNames.clear();
      const stream = client.listObjects(bucket, prefix, false);
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (obj: Record<string, unknown>) => {
          if (typeof obj.prefix === 'string' && obj.prefix.startsWith(prefix)) {
            const remainder = obj.prefix.slice(prefix.length);
            const firstSeg = remainder.replace(/\/+$/, '').split('/')[0];
            if (firstSeg) skillNames.add(firstSeg);
          }
        });
        stream.on('error', reject);
        stream.on('end', resolve);
      });
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'unknown';
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  if (skillNames.size === 0 && lastError) {
    return NextResponse.json({
      success: true,
      note: `Worker 已重启，但技能验证暂不可用: ${lastError}`,
    });
  }

  return NextResponse.json({
    success: true,
    note: 'Worker 已重启',
    skills: Array.from(skillNames).sort(),
  });
}
