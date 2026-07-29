import { NextRequest, NextResponse } from 'next/server';
import { callHigressConsole } from '../higress/proxy-helper';
import { getAuthToken } from './proxy-helper';
import type { AiRoute, LlmProviderResponse } from '@/lib/higress-api';
import { buildModelBindings, hasUnavailableModelAliases } from '@/lib/model-bindings';

function isExternalAdapterMode(): boolean {
  return process.env.AGENTTEAMS_HIGRESS_ADAPTER_MODE === 'external';
}

function getCollection<T>(body: unknown, key: string): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).data)) {
    return (body as Record<string, T[]>).data;
  }
  if (body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>)[key])) {
    return (body as Record<string, T[]>)[key];
  }
  return [];
}

export async function getRequestModelAlias(request: NextRequest): Promise<string | undefined> {
  try {
    const body = await request.clone().json();
    return typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
  } catch {
    return undefined;
  }
}

export async function rejectExternalModelProvider(request: NextRequest): Promise<NextResponse | null> {
  if (!isExternalAdapterMode()) return null;

  try {
    const body = await request.clone().json();
    const modelProvider = body && typeof body === 'object'
      ? (body as Record<string, unknown>).modelProvider
      : undefined;
    if (typeof modelProvider !== 'string' || !modelProvider.trim()) return null;

    return NextResponse.json(
      {
        error: 'External Higress mode uses the request model alias. Remove modelProvider and configure the model alias on an available Higress AI Route.',
      },
      { status: 409 }
    );
  } catch {
    return null;
  }
}

export async function rejectUnavailableExternalModelAlias(
  request: NextRequest,
  model: string | undefined
): Promise<NextResponse | null> {
  if (!isExternalAdapterMode() || !model) return null;

  try {
    const cookie = request.headers.get('cookie');
    const [providersResult, routesResult] = await Promise.all([
      callHigressConsole('/v1/ai/providers', { cookie }),
      callHigressConsole('/v1/ai/routes', { cookie }),
    ]);
    if (!providersResult.response.ok || !routesResult.response.ok) {
      return NextResponse.json(
        { error: 'External Higress model bindings are unavailable; verify the Console session and configuration' },
        { status: 503 }
      );
    }

    const bindings = buildModelBindings(
      [model],
      getCollection<AiRoute>(routesResult.body, 'routes'),
      getCollection<LlmProviderResponse>(providersResult.body, 'providers')
    );
    if (hasUnavailableModelAliases([model], bindings)) {
      return NextResponse.json(
        { error: `Request model alias "${model}" has no available external Higress binding` },
        { status: 409 }
      );
    }
    return null;
  } catch {
    return NextResponse.json(
      { error: 'External Higress model bindings are unavailable; verify the Console session and configuration' },
      { status: 503 }
    );
  }
}

export async function rejectUnavailableExternalWorkerAlias(
  request: NextRequest,
  controllerUrl: string,
  name: string
): Promise<NextResponse | null> {
  if (!isExternalAdapterMode()) return null;

  try {
    const token = await getAuthToken();
    const authorization = token
      ? `Bearer ${token}`
      : request.headers.get('authorization') ?? undefined;
    const response = await fetch(
      new URL(`/api/v1/workers/${encodeURIComponent(name)}`, controllerUrl),
      {
        headers: authorization ? { authorization } : undefined,
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!response.ok) {
      return NextResponse.json(
        { error: 'Worker model alias could not be read before external runtime startup' },
        { status: 503 }
      );
    }

    const worker = await response.json() as { model?: unknown; modelProvider?: unknown };
    if (typeof worker.modelProvider === 'string' && worker.modelProvider.trim()) {
      return NextResponse.json(
        {
          error: 'This Worker still references modelProvider. Remove the legacy modelProvider and configure its request model alias on an available Higress AI Route.',
        },
        { status: 409 }
      );
    }
    const model = typeof worker.model === 'string' && worker.model.trim() ? worker.model.trim() : undefined;
    if (!model) {
      return NextResponse.json(
        { error: 'Worker requires a request model alias before external runtime startup' },
        { status: 409 }
      );
    }
    return rejectUnavailableExternalModelAlias(request, model);
  } catch {
    return NextResponse.json(
      { error: 'Worker model alias could not be read before external runtime startup' },
      { status: 503 }
    );
  }
}
