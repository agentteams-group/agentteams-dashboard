import { NextRequest, NextResponse } from 'next/server';
import { getNacosConfig, setNacosConfig } from '@/lib/skill-center-config';
import { syncNacosSkills } from '@/lib/skill-center-storage';

export async function POST(_request: NextRequest) {
  const config = getNacosConfig();
  if (!config) {
    return NextResponse.json({ error: 'Nacos 未配置' }, { status: 400 });
  }

  if (!config.registryUrl) {
    return NextResponse.json({ error: 'Nacos 注册中心地址未配置' }, { status: 400 });
  }

  try {
    const { nacosSkills, updatedConfig } = await syncNacosSkills(config);
    setNacosConfig(updatedConfig);

    return NextResponse.json({
      success: true,
      synced: nacosSkills.length,
      totalNacos: config.lastSyncAt ? nacosSkills.length : 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
