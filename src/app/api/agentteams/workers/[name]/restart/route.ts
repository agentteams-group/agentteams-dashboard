import { NextRequest, NextResponse } from 'next/server';
import { isValidNameSegment } from '@/lib/skill-package';
import { restartWorkerForSkillReload } from '@/lib/worker-restart';
import { enforceServerSideRbac } from '@/lib/server-auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }

  const denied = await enforceServerSideRbac(request, 'wake', 'worker', name);
  if (denied) return denied;

  const restart = await restartWorkerForSkillReload(name);
  if (!restart.ok) {
    return NextResponse.json(
      {
        error: restart.error ?? 'Worker 重启失败',
        phase: restart.phase ?? null,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    success: true,
    note: 'Worker 已重启并确认就绪',
    phase: restart.phase ?? null,
  });
}
