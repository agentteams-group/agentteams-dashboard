import { NextResponse } from 'next/server';
import { nacosSyncEngine } from '@/lib/nacos-sync-engine';
import { getNacosConfig } from '@/lib/skill-center-config';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const config = await getNacosConfig();
    if (!config) {
      return NextResponse.json({ error: 'Nacos 未配置' }, { status: 400 });
    }

    const result = await nacosSyncEngine.fullSync();

    return NextResponse.json({
      success: true,
      downloaded: result.downloaded,
      skipped: result.skipped,
      failed: result.failed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '同步失败';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
