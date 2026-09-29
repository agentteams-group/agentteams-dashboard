import { NextRequest, NextResponse } from 'next/server';
import { readServerIdentity } from '@/lib/server-auth';

export async function rejectEnvironmentWrite(request: NextRequest) {
  const body = await request.clone().json().catch(() => null);
  if (body && Object.hasOwn(body, 'env') && readServerIdentity(request)?.level !== 3) {
    return NextResponse.json({ error: '环境变量仅允许管理员修改' }, { status: 403 });
  }
  return null;
}

// The proxy may use a deployment-level Controller credential. Never let that
// credential turn a lower-privilege Dashboard read into a secret disclosure.
export async function filterEnvironmentResponse(request: NextRequest, response: Response) {
  if (!response.ok || readServerIdentity(request)?.level === 3) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body) return response;
  const workers = Array.isArray(body.workers) ? body.workers : [body];
  for (const worker of workers) { delete worker.env; worker.envEditable = false; }
  return NextResponse.json(body, { status: response.status });
}
