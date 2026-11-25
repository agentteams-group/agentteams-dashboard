import { NextRequest, NextResponse } from 'next/server';
import { getAuthToken } from '../proxy-helper';
import {
  backendAuthHeader,
  markWorking,
  pickBackendUrl,
  probeBackend,
  type BackendName,
} from '@/lib/backend-config';
import type { InfrastructureInfo } from '@/lib/agentteams-api';

const TIMEOUT_MS = 5000;

// Per-request backend resolution (F1): config file (dual address + failover
// working cache) > env vars > embedded topology defaults. The embedded
// (single-container) topology keeps all platform services in the
// agentteams-controller container on the agentteams-net docker network;
// install scripts inject the env vars, k8s deployments point them at the
// corresponding Services, and standalone installs fill the config file via
// the first-launch setup page.
const HIGRESS_MODE = process.env.AGENTTEAMS_HIGRESS_ADAPTER_MODE === 'external' ? 'external' : 'direct';
// Higress exposes separate data-plane and Console endpoints in the embedded
// topology. Dashboard runs in its own container, so loopback addresses are invalid.
const EMBEDDED_HIGRESS_GATEWAY_ENDPOINT = 'http://aigw-local.agentteams.io:8080';
const EMBEDDED_HIGRESS_CONSOLE_ENDPOINT = 'http://agentteams-controller:8001';

function resolveControllerUrl(): string {
  return pickBackendUrl('controller') || 'http://agentteams-controller:8090';
}

function resolveMinioEndpoint(): string {
  return pickBackendUrl('minio') || 'http://agentteams-controller:9000';
}

function resolveMatrixEndpoint(): string {
  return pickBackendUrl('matrix') || 'http://agentteams-controller:6167';
}

function resolveHigressGatewayEndpoint(): string | undefined {
  return pickBackendUrl('higress-gateway') || (HIGRESS_MODE === 'direct' ? EMBEDDED_HIGRESS_GATEWAY_ENDPOINT : undefined);
}

function resolveHigressConsoleEndpoint(): string | undefined {
  return pickBackendUrl('higress-console') || (HIGRESS_MODE === 'direct' ? EMBEDDED_HIGRESS_CONSOLE_ENDPOINT : undefined);
}

function resolveSglangEndpoint(): string | undefined {
  return pickBackendUrl('sglang'); // optional backend; no embedded default
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timeout);
    return res;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function checkController(url: string): Promise<InfrastructureInfo['controller']> {
  try {
    const res = await fetchWithTimeout(`${url}/healthz`);
    if (res.ok) markWorking('controller', url);
    const authToken = await getAuthToken();
    const headers: Record<string, string> = {};
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    const versionRes = await fetchWithTimeout(`${url}/api/v1/version`, { headers });
    let version = 'unknown';
    if (versionRes.ok) {
      const data = await versionRes.json().catch(() => ({}));
      version = data.controller || 'unknown';
    }
    return { healthy: res.ok, version };
  } catch {
    return { healthy: false, version: 'unknown' };
  }
}

async function checkKubernetes(): Promise<InfrastructureInfo['kubernetes']> {
  try {
    // Use Node.js https to query the in-cluster API server with the mounted CA/token.
    const https = await import('https');
    const fs = await import('node:fs');

    const ca = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
    const token = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf-8').trim();

    const version = await new Promise<string>((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'kubernetes.default.svc',
          path: '/version',
          port: 443,
          method: 'GET',
          ca,
          headers: { Authorization: `Bearer ${token}` },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const json = JSON.parse(data);
                resolve(json.gitVersion || 'unknown');
              } catch {
                resolve('unknown');
              }
            } else {
              reject(new Error(`status ${res.statusCode}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error('timeout'));
      });
      req.end();
    });

    return { healthy: true, version };
  } catch {
    return { healthy: false, version: 'unknown' };
  }
}

async function checkMinio(url: string): Promise<InfrastructureInfo['minio']> {
  try {
    const res = await fetchWithTimeout(`${url}/minio/health/live`);
    if (res.ok) markWorking('minio', url);
    return {
      healthy: res.ok,
      endpoint: url,
      buckets: [], // Bucket list is provided by /api/agentteams/storage/buckets
    };
  } catch {
    return {
      healthy: false,
      endpoint: url,
      buckets: [],
    };
  }
}

async function checkMatrix(url: string): Promise<InfrastructureInfo['matrix']> {
  try {
    const res = await fetchWithTimeout(`${url}/_matrix/client/versions`);
    if (res.ok) markWorking('matrix', url);
    return { healthy: res.ok, homeserver: url };
  } catch {
    return { healthy: false, homeserver: url };
  }
}

// SGLang is an optional inference backend (model list / model management).
async function checkSglang(url: string | undefined): Promise<InfrastructureInfo['sglang']> {
  if (!url) {
    return { healthy: false, endpoint: '' };
  }
  const result = await probeBackend('sglang', url, TIMEOUT_MS);
  // httpOk (status < 400), not ok (network connected): a 401/5xx probe must
  // not mark the address working or report a healthy inference backend.
  if (result.httpOk) markWorking('sglang', url, result.latencyMs);
  return { healthy: result.httpOk, endpoint: url };
}

async function checkExternalService(name: BackendName, endpoint: string | undefined) {
  if (!endpoint) {
    return { configured: false, state: 'unconfigured' as const };
  }

  try {
    // 逐地址覆盖凭据（Basic / Bearer 网关门）：只在命中保存的该后端地址时注入。
    const res = await fetchWithTimeout(new URL('/', endpoint).toString(), {
      headers: backendAuthHeader(name, endpoint),
    });
    return {
      configured: true,
      endpoint,
      state: 'reachable' as const,
      httpStatus: res.status,
    };
  } catch (error) {
    return {
      configured: true,
      endpoint,
      state: 'unreachable' as const,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Probe the Higress data plane on its real readiness surface. Per the Higress
// gateway API reference, the ai-proxy plugin only matches `/v1/chat/completions`
// and `/v1/embeddings`; a bare `GET /` therefore cannot distinguish a live AI
// route from a gateway that is up but not proxying. We POST an unauthenticated
// chat/completions probe and treat only a definitive auth/route answer as
// "reachable": 200 (route open), 401/403 (route matched, key missing) still
// prove the data plane is serving AI traffic, whereas 404 means the request
// never reached an ai-proxy route.
async function checkHigressGateway(endpoint: string | undefined) {
  if (!endpoint) {
    return { configured: false, state: 'unconfigured' as const };
  }

  try {
    const probeUrl = new URL('/v1/chat/completions', endpoint).toString();
    const res = await fetchWithTimeout(probeUrl, {
      method: 'POST',
      // 逐地址覆盖凭据：网关前的 Basic 门 / API key 门命中保存地址时注入；
      // 未配置则保持原来的匿名探测语义（401/403 也算数据面可达）。
      headers: {
        'Content-Type': 'application/json',
        ...backendAuthHeader('higress-gateway', endpoint),
      },
      body: JSON.stringify({ model: 'health-probe', messages: [{ role: 'user', content: 'ok' }] }),
    });
    // 404 => path not handled by ai-proxy (misconfigured gateway/route).
    const state = res.status === 404 ? ('unreachable' as const) : ('reachable' as const);
    return {
      configured: true,
      endpoint,
      state,
      httpStatus: res.status,
      ...(state === 'unreachable'
        ? { error: 'AI route /v1/chat/completions not proxied (HTTP 404)' }
        : {}),
    };
  } catch (error) {
    return {
      configured: true,
      endpoint,
      state: 'unreachable' as const,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function checkHigress(
  gatewayEndpoint: string | undefined,
  consoleEndpoint: string | undefined
): Promise<NonNullable<InfrastructureInfo['higress']>> {
  const [gateway, console] = await Promise.all([
    checkHigressGateway(gatewayEndpoint),
    checkExternalService('higress-console', consoleEndpoint),
  ]);
  if (gateway.state === 'reachable' && gatewayEndpoint) markWorking('higress-gateway', gatewayEndpoint);
  if (console.state === 'reachable' && consoleEndpoint) markWorking('higress-console', consoleEndpoint);

  // Runtime adaptation health tracks the Gateway data plane probe only.
  // The optional Console management address keeps its own status so an
  // unconfigured/unreachable Console does not mask a working Gateway.
  return {
    mode: HIGRESS_MODE,
    gateway,
    console,
    healthy: gateway.state === 'reachable',
  };
}

// GET /api/agentteams/infrastructure - aggregate health of all platform components
export async function GET(_request: NextRequest) {
  // Resolve addresses per request (F1): the config file may have been
  // written/updated since module load, and the failover working cache must
  // be consulted (and refreshed) here.
  const controllerUrl = resolveControllerUrl();
  const minioEndpoint = resolveMinioEndpoint();
  const matrixEndpoint = resolveMatrixEndpoint();
  const higressGateway = resolveHigressGatewayEndpoint();
  const higressConsole = resolveHigressConsoleEndpoint();
  const sglangEndpoint = resolveSglangEndpoint();

  const [controller, kubernetes, minio, matrix, higress, sglang] = await Promise.all([
    checkController(controllerUrl),
    checkKubernetes(),
    checkMinio(minioEndpoint),
    checkMatrix(matrixEndpoint),
    checkHigress(higressGateway, higressConsole),
    checkSglang(sglangEndpoint),
  ]);

  const info: InfrastructureInfo = {
    controller,
    kubernetes,
    minio,
    matrix,
    higress,
    sglang,
  };

  return NextResponse.json(info);
}
