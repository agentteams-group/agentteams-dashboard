import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToHiClaw } from '../../proxy-helper';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  return proxyToHiClaw(
    request,
    getControllerUrl(request),
    `/api/v1/models/${encodeURIComponent(name)}`,
    { forwardBody: false }
  );
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  return proxyToHiClaw(
    request,
    getControllerUrl(request),
    `/api/v1/models/${encodeURIComponent(name)}`
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  return proxyToHiClaw(
    request,
    getControllerUrl(request),
    `/api/v1/models/${encodeURIComponent(name)}`,
    { forwardBody: false, method: 'DELETE' }
  );
}
