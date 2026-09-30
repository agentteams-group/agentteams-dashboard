import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/dashboard-session';
import { appendAuditEvent } from '@/lib/audit-log';
import { readServerIdentity } from '@/lib/server-auth';
import { compareSemver } from '@/lib/version';
import { applyHotfix, claimHotfixRun, releaseHotfixRun, selectHotfixAssets } from '@/lib/hotfix';

export const dynamic = 'force-dynamic';

const RESTART_DELAY_MS = 800;

function hotfixConfig(): { repo: string; assetPrefix: string; currentVersion: string } {
  return {
    repo: process.env.DASHBOARD_HOTFIX_REPO || 'agentteams-group/agentteams-dashboard',
    assetPrefix: process.env.DASHBOARD_HOTFIX_ASSET_PREFIX || 'dashboard-hotfix-',
    currentVersion: process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0',
  };
}

// One patch at a time is enforced by lib/hotfix claim/release.

/**
 * Hard process termination. A bare process.exit(0) can be swallowed when
 * route handlers execute in a worker/child context (only that context dies;
 * the main server keeps serving the pre-patch build from its in-memory
 * module cache while the disk holds the patched files — the exact
 * "API reports new build, page stays old" failure mode). Escalate instead:
 * SIGTERM (graceful, hits the main process — worker threads share its PID)
 * → SIGKILL 1.5s later (cannot be ignored, even as PID 1) → exit fallback.
 * The container supervisor (docker restart policy / k8s restartPolicy) then
 * starts the process back up on the patched files.
 */
function scheduleHardRestart(): void {
  setTimeout(() => {
    try {
      process.kill(process.pid, 'SIGTERM');
    } catch {
      /* already dying */
    }
    setTimeout(() => {
      try {
        process.kill(process.pid, 'SIGKILL');
      } catch {
        /* noop */
      }
      try {
        process.exit(1);
      } catch {
        /* noop */
      }
    }, 1500).unref();
  }, RESTART_DELAY_MS).unref();
}

/**
 * In-app hot patch (设置 → 更新 → 热更新, admin-gated + audited).
 *
 * Downloads the latest release's standalone bundle, verifies sha256, swaps
 * it into the app directory, then exits the process — the container
 * supervisor (docker restart policy / k8s restartPolicy) restarts it onto
 * the patched files. No docker socket, no sidecar: identical behavior on
 * docker and k8s. The browser keeps polling /api/dashboard-build and
 * reloads once the running build id changes.
 */
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || session.level < 3) {
    return NextResponse.json({ error: '仅管理员（L1）可触发热更新' }, { status: 403 });
  }

  const { repo, assetPrefix, currentVersion } = hotfixConfig();

  let release: ReturnType<typeof selectHotfixAssets>;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `无法获取最新 Release（HTTP ${res.status}）` }, { status: 502 });
    }
    release = selectHotfixAssets((await res.json()) as Record<string, unknown>, assetPrefix);
  } catch {
    return NextResponse.json({ error: '无法连接 GitHub，请检查网络后重试' }, { status: 502 });
  }

  if (!release) {
    return NextResponse.json(
      { error: `最新 Release 未附带热更新包（${assetPrefix}*.tar.gz），请走镜像部署` },
      { status: 404 }
    );
  }
  if (compareSemver(release.tag, currentVersion) <= 0) {
    return NextResponse.json({ error: `已是最新版本（${currentVersion}），无需热更新` }, { status: 409 });
  }

  if (!claimHotfixRun()) {
    return NextResponse.json({ error: '热更新进行中，请勿重复触发' }, { status: 409 });
  }

  try {
    const result = await applyHotfix({ release });
    const identity = readServerIdentity(request);
    if (identity) {
      void appendAuditEvent({
        actor: identity.name,
        actor_level: identity.level,
        entity_type: 'system',
        entity_name: 'dashboard-hotfix',
        action: 'self-update',
        details: `hot-patched ${currentVersion} → ${result.version} (build ${result.buildId}); restarting`,
        severity: 'warning',
        source_ip: identity.sourceIp,
      });
    }

    // Let the response flush, then hard-terminate so the supervisor restarts
    // the process on the patched files.
    scheduleHardRestart();
    releaseHotfixRun();
    return NextResponse.json({ ok: true, version: result.version, buildId: result.buildId });
  } catch (error) {
    releaseHotfixRun();
    const message = error instanceof Error ? error.message : '热更新失败';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
