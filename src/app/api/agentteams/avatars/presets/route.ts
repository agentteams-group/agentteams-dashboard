import { NextRequest, NextResponse } from 'next/server';
import { readAvatarCatalog } from '@/lib/avatar-storage';
import { readServerIdentity } from '@/lib/server-auth';

export async function GET(request: NextRequest) {
  if (!readServerIdentity(request)) return new NextResponse(null, { status: 401 });
  const kind = request.nextUrl.searchParams.get('kind');
  if (kind !== 'human' && kind !== 'agent') return new NextResponse(null, { status: 404 });
  return NextResponse.json(await readAvatarCatalog(kind));
}
