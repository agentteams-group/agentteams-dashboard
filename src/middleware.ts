import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateHigressSession, hasServerAuthToken } from './lib/api-auth';

// Force Node.js runtime because api-auth.ts imports higress/proxy-helper which
// uses AbortController/timeout patterns that are safer under Node runtime.
export const runtime = 'nodejs';

// Setup/bootstrapping endpoints that should NOT require an existing Higress
// session (needed for initial deployment when the admin user hasn't been
// created yet via the Console).
const SETUP_PATHS = [
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

  // API auth gate: protect /api/agentteams/* write operations
  if (pathname.startsWith('/api/agentteams/')) {
    // Allow setup/bootstrap endpoints without an existing session
    const isSetupPath = SETUP_PATHS.some((p) => pathname.startsWith(p));
    if (isSetupPath) {
      return NextResponse.next();
    }

    const method = request.method.toUpperCase();
    const isWriteOp = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    if (isWriteOp) {
      // Write operations always require a valid Higress browser session
      const valid = await validateHigressSession(request);
      if (!valid) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      // GET requests: allow if SA token exists (server-side proxy),
      // otherwise require browser session
      if (!(await hasServerAuthToken())) {
        const valid = await validateHigressSession(request);
        if (!valid) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard', '/dashboard/:path*', '/api/agentteams/:path*'],
};
