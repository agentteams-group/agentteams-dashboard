import { NextRequest, NextResponse } from 'next/server';
import { readServerIdentity } from '@/lib/server-auth';
import { appendAuditEvent } from '@/lib/audit-log';
import { controllerObservabilityConfig, observabilityController } from '@/lib/observability-controller';
import type { ObservabilityConfig } from '@/lib/observability-config';
import { TracingError } from '@/lib/tracing-error';

export const runtime = 'nodejs';

async function forward(request: NextRequest, method: string) {
  const identity = readServerIdentity(request);
  if (!identity) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (identity.level !== 3) return NextResponse.json({ error: '仅管理员可以配置可观测' }, { status: 403 });
  let body: Record<string, unknown> | undefined;
  if (method !== 'GET') {
    body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: '请求须为 JSON 对象' }, { status: 400 });
  }
  let resource = '/api/v1/observability/config';
  if (method === 'POST') {
    if (body?.action !== 'test' && body?.action !== 'apply') return NextResponse.json({ error: '未知可观测操作' }, { status: 400 });
    resource = `/api/v1/observability/${body.action}`;
  }
  // Keep AgentLoop query signing on its existing Dashboard cloud identity;
  // its settings still come from the Controller, and Collector testing runs there.
  if (method === 'POST' && body?.action === 'test' && (body.settings as Partial<ObservabilityConfig> | undefined)?.backend === 'agentloop') {
    try {
      const saved = await controllerObservabilityConfig(request);
      const config = { ...saved, ...body.settings as Partial<ObservabilityConfig> };
      const { testAgentLoopConnection } = await import('@/lib/agentloop-server');
      const query = await testAgentLoopConnection(config);
      const collector = await observabilityController(request, resource, method, body);
      if (!collector.ok) return collector;
      return NextResponse.json(query);
    } catch (error) {
      return NextResponse.json({ error: error instanceof TracingError ? error.message : '可观测连接测试失败' }, { status: error instanceof TracingError ? error.status : 502 });
    }
  }
  const response = await observabilityController(request, resource, method, body);
  if (method === 'PUT' && response.ok) {
    void appendAuditEvent({ actor: identity.name, actor_level: identity.level, entity_type: 'system', entity_name: 'observability',
      action: 'observability.configure', details: 'Controller 可观测配置已保存', severity: 'info' });
  }
  return response;
}

export async function GET(request: NextRequest) { return forward(request, 'GET'); }
export async function PUT(request: NextRequest) { return forward(request, 'PUT'); }
export async function POST(request: NextRequest) { return forward(request, 'POST'); }
