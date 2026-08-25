import { NextRequest, NextResponse } from 'next/server';
import { validateHigressSession } from '@/lib/api-auth';
import { getHigressConsoleURL } from './proxy-helper';

export async function requireHigressConsoleAccess(request: NextRequest): Promise<NextResponse | null> {
  try {
    getHigressConsoleURL();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Higress Console deployment configuration error';
    return NextResponse.json({ error: message }, { status: 503 });
  }

  const { valid } = await validateHigressSession(request);
  if (!valid) {
    return NextResponse.json({ error: 'A valid Higress Console session is required' }, { status: 401 });
  }
  return null;
}

export const requireHigressConsoleWriteAccess = requireHigressConsoleAccess;
