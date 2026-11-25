import { callControllerGateway } from '../controller-helper';
// GET/POST /api/higress/ai-routes — List / Create AI Routes via Controller
import { NextRequest, NextResponse } from 'next/server';
import { higressErrorResponse, higressProxyErrorResponse } from '../proxy-helper';
import { requireHigressConsoleAccess } from '../access';
import { validateAiRoutePayload } from '@/lib/higress-api';
import { isRecord, unwrapData } from '../helpers';

function getRoutes(body: unknown): unknown[] {
  const data = unwrapData(body);
  if (Array.isArray(data)) return data;
  if (isRecord(data) && Array.isArray(data.routes)) return data.routes;
  return [];
}

// GET — List all AI routes
export async function GET(request: NextRequest) {
  try {
    const rejected = await requireHigressConsoleAccess(request);
    if (rejected) return rejected;

    const { response, body } = await callControllerGateway(request, '/v1/ai/routes', {
      method: 'GET',
    });

    if (!response.ok) {
      return higressErrorResponse(response, body);
    }

    return NextResponse.json({ routes: getRoutes(body), fallbackConfigWritable: isRecord(body) && body.fallbackConfigWritable === true });
  } catch (err: unknown) {
    return higressProxyErrorResponse(err, 'Failed to list routes');
  }
}

// POST — Create a new AI route
export async function POST(request: NextRequest) {
  try {
    const rejected = await requireHigressConsoleAccess(request);
    if (rejected) return rejected;

    const body: unknown = await request.json().catch(() => null);
    const validationErrors = validateAiRoutePayload(body);
    if (validationErrors.length > 0) return NextResponse.json({ success: false, error: validationErrors[0] }, { status: 400 });

    const { response, body: resBody } = await callControllerGateway(request, '/v1/ai/routes', {
      method: 'POST',
      body: body as Record<string, unknown>,
    });

    if (!response.ok) {
      return higressErrorResponse(response, resBody);
    }

    return NextResponse.json(unwrapData(resBody) ?? body, { status: 201 });
  } catch (err: unknown) {
    return higressProxyErrorResponse(err, 'Failed to create route');
  }
}
