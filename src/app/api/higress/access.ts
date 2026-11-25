import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/dashboard-session';
import { isStatelessAuthMode } from '@/lib/static-mode';
import { resolveStaticIdentity } from '@/lib/static-identity';
import { validateHigressSession } from '@/lib/api-auth';

export async function requireHigressConsoleAccess(request: NextRequest): Promise<NextResponse | null> {
  if (process.env.AGENTTEAMS_HIGRESS_ADAPTER_MODE === 'external') {
    return (await validateHigressSession(request)).valid ? null
      : NextResponse.json({ error: 'A valid Higress Console session is required' }, { status: 401 });
  }
  if (isStatelessAuthMode()) {
    const result = await resolveStaticIdentity(request);
    if (result?.ok === true && result.identity.level === 3) return null;
    return NextResponse.json({ error: 'Controller administrator access is required' }, { status: 403 });
  }
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (session.level !== 3) return NextResponse.json({ error: 'Controller administrator access is required' }, { status: 403 });
  return null;
}

export const requireHigressConsoleWriteAccess = requireHigressConsoleAccess;
