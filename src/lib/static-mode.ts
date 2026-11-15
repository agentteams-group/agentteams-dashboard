/**
 * F7 stateless terminal state — shared server-side helpers.
 *
 * `DASHBOARD_STATELESS=1` switches the dashboard from the server-session
 * credential model (M19: token held in the in-memory session store, injected
 * by proxy helpers) to the browser-token model (the browser holds its own
 * Matrix access token / optional Controller admin token and sends it on every
 * data-plane request; the server stays a zero-storage proxy).
 *
 * The switch is read per call (not module-level) so env changes apply on
 * reload, mirroring the AGENTTEAMS_AUTH_DISABLED convention in middleware.
 * Default (unset) = stateful: every code path below is a no-op, keeping the
 * default deployment byte-for-byte unchanged.
 */

import { NextResponse } from 'next/server';

export type StaticCapability =
  | 'storage'
  | 'gateway'
  | 'logs'
  | 'nacos'
  | 'sglang'
  | 'infrastructure';

export function isStatelessAuthMode(): boolean {
  return process.env.DASHBOARD_STATELESS === '1';
}

/**
 * Route families that REQUIRE server-side credentials (MinIO object storage,
 * the Higress Console gateway plane, node/k8s logs, the Nacos skill catalog,
 * the SGLang probe, backend health infrastructure). In a zero-credential
 * stateless deployment the browser's token cannot legitimately stand in for
 * the service account, so the middleware answers 501 with an actionable
 * message instead of letting the route fail opaquely upstream.
 *
 * When the deployment DOES carry a server credential (AGENTTEAMS_AUTH_TOKEN
 * env/file, or a Higress Console session in the stateful case) the guard
 * passes and the routes behave exactly as today.
 */
const STATIC_DEGRADED_PREFIXES: Array<{
  prefix: string;
  capability: StaticCapability;
  label: string;
}> = [
  { prefix: '/api/agentteams/storage/', capability: 'storage', label: '对象存储（MinIO）' },
  { prefix: '/api/higress/ai-routes', capability: 'gateway', label: '网关 AI 路由管理（Higress Console）' },
  { prefix: '/api/higress/ai-providers', capability: 'gateway', label: '网关模型提供方管理（Higress Console）' },
  { prefix: '/api/agentteams/wen-tian/logs', capability: 'logs', label: '节点日志' },
  { prefix: '/api/agentteams/logs/', capability: 'logs', label: '组件日志' },
  { prefix: '/api/agentteams/debug-log', capability: 'logs', label: '调试日志' },
  { prefix: '/api/agentteams/agentspecs/', capability: 'nacos', label: 'Nacos Agent 目录' },
  { prefix: '/api/agentteams/skills/nacos', capability: 'nacos', label: 'Nacos 技能目录' },
  { prefix: '/api/agentteams/models/probe', capability: 'gateway', label: '模型连接测试' },
  { prefix: '/api/agentteams/infrastructure', capability: 'infrastructure', label: '基础设施健康探测' },
];

/**
 * Middleware helper: return the 501 degradation response when `pathname`
 * belongs to a server-credential-only route family and this deployment has
 * no server credential to use. Null = proceed normally.
 */
export function statelessDegradedResponse(pathname: string): NextResponse | null {
  if (!isStatelessAuthMode()) return null;
  if (process.env.AGENTTEAMS_AUTH_TOKEN || process.env.AGENTTEAMS_AUTH_TOKEN_FILE) return null;
  for (const { prefix, capability, label } of STATIC_DEGRADED_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      return NextResponse.json(
        {
          success: false,
          error: `「${label}」需要服务端凭据，当前为无状态部署（服务端零凭据），该功能不可用`,
          code: 'STATIC_MODE_UNAVAILABLE',
          capability,
        },
        { status: 501 },
      );
    }
  }
  return null;
}
