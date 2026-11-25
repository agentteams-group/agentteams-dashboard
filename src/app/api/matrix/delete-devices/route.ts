// POST /api/matrix/delete-devices - F7 S4: revoke a Matrix device session.
//
// Deletes the device identified by the client (the browser's own
// device_id, persisted from login). Deleting the device invalidates its
// access token server-side — the "revoke this device" button in the
// client settings. The caller authenticates with the device's own access
// token (Authorization header, the same convention as the other
// /api/matrix/* proxy routes).
//
// allowPrivateNetwork note (review): the operator MUST configure
// MATRIX_HOMESERVER_ALLOWLIST for stateless deployments — validation runs in
// requireAllowlist mode so device-revoke requests only ever reach an
// operator-approved host; unset list → the request is rejected outright.
import { NextRequest, NextResponse } from 'next/server';
import {
  HomeserverValidationError,
  validateHomeserverUrl,
} from '@/lib/homeserver-allowlist';

function getAccessToken(request: NextRequest): string {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return '';
  const [scheme, token] = authHeader.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token || '' : '';
}

export async function POST(request: NextRequest) {
  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Missing Authorization header (Bearer <access_token>)' },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { homeserver, deviceId } = body as { homeserver?: string; deviceId?: string };
  if (!homeserver || !deviceId) {
    return NextResponse.json(
      { error: 'Missing required fields: homeserver, deviceId' },
      { status: 400 },
    );
  }

  // Stateless hard requirement (review): same as static-login — an explicit
  // operator allowlist is mandatory; the access token must only reach an
  // approved host.
  if (!process.env.MATRIX_HOMESERVER_ALLOWLIST?.trim()) {
    return NextResponse.json(
      {
        error:
          '设备吊销被拒绝：服务端未配置 MATRIX_HOMESERVER_ALLOWLIST（无状态部署必须显式列出允许的 homeserver 主机）',
        reason: 'allowlist-not-configured',
      },
      { status: 403 },
    );
  }

  let parsed: URL;
  try {
    parsed = validateHomeserverUrl(homeserver, { requireAllowlist: true });
  } catch (err) {
    if (err instanceof HomeserverValidationError) {
      return NextResponse.json({ error: err.message, reason: err.reason }, { status: 403 });
    }
    return NextResponse.json({ error: 'Invalid homeserver URL' }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    // 规范端点：DELETE /_matrix/client/v3/devices/{deviceId}（单设备删除）。
    // POST /_matrix/client/v3/delete_devices 是需 UIA 的批量端点，且不接受
    // DELETE 方法——旧路径在规范 homeserver（含内嵌 Tuwunel）上只会 404。
    const res = await fetch(
      `${parsed.origin}/_matrix/client/v3/devices/${encodeURIComponent(deviceId)}`,
      {
        method: 'DELETE',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || data.errmsg || 'Device revocation failed', code: data.errcode },
        { status: res.status },
      );
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message, reason: 'unreachable' }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
