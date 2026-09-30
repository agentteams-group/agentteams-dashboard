import { NextResponse } from 'next/server';
import { getServerBuildId, getServerBuiltAt } from '@/lib/build-id';

export const dynamic = 'force-dynamic';

/**
 * Public, zero-sensitive build identity: an already-open page calls this to
 * detect that the container behind it was redeployed with a newer build
 * (设置 → 更新 → 检查更新). Stability per process is a correctness property —
 * lib/build-id caches the read.
 */
export async function GET() {
  return NextResponse.json(
    {
      buildId: getServerBuildId(),
      builtAt: getServerBuiltAt() ?? null,
      version: process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0',
    },
    // Reverse proxies / CDNs must never serve a cached identity answer —
    // a stale buildId here makes the stale-page banner unresolvable.
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
