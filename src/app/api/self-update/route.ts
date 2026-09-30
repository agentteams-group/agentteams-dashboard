import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/dashboard-session';
import { appendAuditEvent } from '@/lib/audit-log';
import { readServerIdentity } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

/**
 * Container self-update trigger (设置 → 更新 → 更新容器).
 *
 * Forwards a fire-and-forget trigger to the watchtower sidecar (HTTP API
 * mode). Watchtower re-pulls the dashboard image, compares digests, and
 * recreates the container when the image moved. This route returns as soon
 * as the trigger is accepted — the browser polls /api/dashboard-build until
 * the build id changes, then reloads.
 *
 * Security: docker-socket holders are host-root-equivalent, so the blast
 * radius is contained on every layer —
 *  - watchtower runs with --label-enable (only the labeled dashboard
 *    container) and is reachable solely on the compose-internal network;
 *  - the sidecar API requires a bearer token shared with this route via
 *    DASHBOARD_UPDATER_TOKEN;
 *  - this route is admin-gated (dashboard level 3 = CR L1) and audited.
 */

function updaterConfig(): { url: string; token: string } {
  return {
    url: process.env.DASHBOARD_UPDATER_URL || 'http://updater:8080',
    token: process.env.DASHBOARD_UPDATER_TOKEN || '',
  };
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || session.level < 3) {
    return NextResponse.json({ error: '仅管理员（L1）可触发容器更新' }, { status: 403 });
  }

  const { url, token } = updaterConfig();
  if (!token) {
    return NextResponse.json(
      { error: '更新器未配置（缺少 DASHBOARD_UPDATER_TOKEN）' },
      { status: 503 }
    );
  }

  try {
    const res = await fetch(`${url}/v1/update`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `更新器返回 ${res.status}` }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ error: '无法连接更新器，请确认 updater 容器在运行' }, { status: 502 });
  }

  const identity = readServerIdentity(request);
  if (identity) {
    void appendAuditEvent({
      actor: identity.name,
      actor_level: identity.level,
      entity_type: 'system',
      entity_name: 'dashboard-self-update',
      action: 'self-update',
      details: 'POST /api/self-update → watchtower trigger accepted',
      severity: 'warning',
      source_ip: identity.sourceIp,
    });
  }

  return NextResponse.json({ ok: true });
}
