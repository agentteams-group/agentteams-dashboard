import { NextRequest, NextResponse } from 'next/server';
import { getNacosConfig, setNacosConfig } from '@/lib/skill-center-config';
import type { NacosConfig } from '@/lib/skill-center-config';

function isValidNacosUrl(url: string): boolean {
  return /^nacos:\/\/[a-zA-Z0-9._-]+(:[0-9]+)?\/[a-zA-Z0-9._-]+$/.test(url);
}

export async function GET() {
  try {
    const config = getNacosConfig();
    return NextResponse.json({ config });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  let body: { registryUrl?: string; namespace?: string; protocol?: 'http' | 'https'; apiPrefix?: string; mode?: 'services' | 'skills'; username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const { registryUrl, namespace, protocol, apiPrefix, mode, username, password } = body;

  if (!registryUrl || !isValidNacosUrl(registryUrl)) {
    return NextResponse.json(
      { error: 'Nacos 注册中心 URL 格式无效（须为 nacos://host[:port]/namespace 格式）' },
      { status: 400 }
    );
  }

  try {
    const newConfig: NacosConfig = {
      registryUrl,
      namespace: namespace || 'public',
      protocol: protocol || 'http',
      apiPrefix: apiPrefix || '/nacos',
      mode: mode || 'services',
      username: username || undefined,
      password: password || undefined,
      lastSyncAt: undefined,
      lastSyncStatus: undefined,
      lastSyncError: undefined,
    };

    setNacosConfig(newConfig);

    return NextResponse.json({ success: true, config: newConfig });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
