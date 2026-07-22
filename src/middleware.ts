import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateHigressSession } from './lib/api-auth';

// Force Node.js runtime because api-auth.ts imports higress/proxy-helper which
// uses AbortController/timeout patterns that are safer under Node runtime.
export const runtime = 'nodejs';

// Public endpoints that do NOT require a Higress browser session.
// Only genuinely public endpoints (health checks, setup bootstrap) belong here.
const PUBLIC_PATHS = [
  '/api/agentteams/setup/ensure-ai',
  '/api/agentteams/setup/status',
];

// Backward compatibility for embedded mode: old /dashboard/ URLs redirect to root
// because the dashboard is now served at "/" when NEXT_PUBLIC_BASE_PATH is empty.
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Legacy redirect
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
    const target = pathname.replace(/^\/dashboard/, '') || '/';
    const url = request.nextUrl.clone();
    url.pathname = target;
    return NextResponse.redirect(url);
  }

  // CORS preflight requests never carry credentials — let them through so
  // browsers can complete the OPTIONS handshake.
  if (request.method === 'OPTIONS') {
    return NextResponse.next();
  }

  // API auth gate: protect ALL /api/agentteams/* routes.
  // The SA token authenticates Dashboard→Controller, not the browser caller.
  // All browser requests (GET included) must present a valid Higress session cookie.
  if (pathname.startsWith('/api/agentteams/')) {
    const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
    if (isPublicPath) {
      return NextResponse.next();
    }

    const valid = await validateHigressSession(request);
    if (!valid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard', '/dashboard/:path*', '/api/agentteams/:path*'],
};
