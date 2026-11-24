import { NextRequest, NextResponse } from 'next/server';
import {
  getNacosConfig,
  setNacosConfig,
  maskNacosConfig,
  isNacosPasswordMask,
} from '@/lib/skill-center-config';
import type { NacosConfig } from '@/lib/skill-center-config';
import { enforceLevelOnlyRbac } from '@/lib/server-auth';

function isValidNacosUrl(url: string): boolean {
  return /^nacos:\/\/[a-zA-Z0-9._-]+(:[0-9]+)?\/[a-zA-Z0-9._-]+$/.test(url);
}

export async function GET(request: NextRequest) {
  const denied = await enforceLevelOnlyRbac(request, 'view', 'skill.nacos.config', 'config');
  if (denied) return denied;
  try {
    const config = await getNacosConfig();
    // 密码不出服务端：响应中只回掩码占位符。
    return NextResponse.json({ config: maskNacosConfig(config) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const denied = await enforceLevelOnlyRbac(request, 'update', 'skill.nacos.config', 'config');
  if (denied) return denied;
  let body: Partial<NacosConfig>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const { registryUrl, namespace, alias, protocol, apiPrefix, mode, username, password, ardBaseUrl } = body;

  if (!registryUrl || !isValidNacosUrl(registryUrl)) {
    return NextResponse.json(
      { error: 'Nacos 注册中心 URL 格式无效（须为 nacos://host[:port]/namespace 格式）' },
      { status: 400 }
    );
  }

  try {
    if (ardBaseUrl) {
      const url = URL.canParse(ardBaseUrl) && new URL(ardBaseUrl);
      if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        return NextResponse.json({ error: 'ARD 地址需要完整的 HTTP(S) 服务地址' }, { status: 400 });
      }
    }
    // 客户端传回掩码占位符表示"保留已存密码"，从存储回填真实值。
    let effectivePassword = password || undefined;
    if (isNacosPasswordMask(effectivePassword)) {
      const saved = await getNacosConfig();
      if (saved && (saved.registryUrl !== registryUrl || (saved.protocol || 'http') !== (protocol || 'http')
          || (saved.ardBaseUrl || '') !== (ardBaseUrl || ''))) {
        return NextResponse.json({ error: '连接地址已改变，请重新输入密码' }, { status: 400 });
      }
      effectivePassword = saved?.password;
    }

    const newConfig: NacosConfig = {
      registryUrl,
      ardBaseUrl: ardBaseUrl || undefined,
      namespace: namespace || 'public',
      alias: alias || undefined,
      protocol: protocol || 'http',
      apiPrefix: apiPrefix || '/nacos',
      mode: mode || 'services',
      username: username || undefined,
      password: effectivePassword,
      lastSyncAt: undefined,
      lastSyncStatus: undefined,
      lastSyncError: undefined,
    };

    await setNacosConfig(newConfig);

    // 密码不出服务端：响应中只回掩码占位符。
    return NextResponse.json({ success: true, config: maskNacosConfig(newConfig) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
