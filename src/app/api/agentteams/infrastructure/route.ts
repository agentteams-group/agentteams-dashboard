import { NextRequest, NextResponse } from 'next/server';
import { getAuthToken } from '../proxy-helper';
import type { InfrastructureInfo } from '@/lib/agentteams-api';

const TIMEOUT_MS = 5000;

const CONTROLLER_URL =
  process.env.AGENTTEAMS_CONTROLLER_URL ||
  process.env.AGENTTEAMS_API_URL ||
  'http://agentteams-controller.agentteams-system:8090';

const MINIO_ENDPOINT =
  process.env.AGENTTEAMS_MINIO_URL ||
  process.env.AGENTTEAMS_FS_ENDPOINT || // set by install/agentteams-dashboard.sh
  'http://agentteams-minio.agentteams-system:9000';

const MATRIX_ENDPOINT =
  process.env.AGENTTEAMS_MATRIX_URL ||
  process.env.NEXT_PUBLIC_MATRIX_API_URL || // set by install/agentteams-dashboard.sh
  'http://matrix-local.agentteams.io:18080';

const HIGRESS_ENDPOINT =
  process.env.AGENTTEAMS_AI_GATEWAY_URL ||
  process.env.AGENTTEAMS_AI_GATEWAY_ADMIN_URL || // set by install/agentteams-dashboard.sh
  'http://higress-gateway.agentteams-system:80';

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

async function checkController(): Promise<InfrastructureInfo['controller']> {
  try {
    const res = await fetchWithTimeout(`${CONTROLLER_URL}/healthz`);
    const versionRes = await fetchWithTimeout(`${CONTROLLER_URL}/api/v1/version`, {
      headers: { Authorization: `Bearer ${await getAuthToken() || ''}` },
    });
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
    const fs = await import('fs');

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

async function checkMinio(): Promise<InfrastructureInfo['minio']> {
  try {
    const res = await fetchWithTimeout(`${MINIO_ENDPOINT}/minio/health/live`);
    return {
      healthy: res.ok,
      endpoint: MINIO_ENDPOINT,
      buckets: [], // Bucket list is provided by /api/agentteams/storage/buckets
    };
  } catch {
    return {
      healthy: false,
      endpoint: MINIO_ENDPOINT,
      buckets: [],
    };
  }
}

async function checkMatrix(): Promise<InfrastructureInfo['matrix']> {
  try {
    const res = await fetchWithTimeout(`${MATRIX_ENDPOINT}/_matrix/client/versions`);
    return { healthy: res.ok, homeserver: MATRIX_ENDPOINT };
  } catch {
    return { healthy: false, homeserver: MATRIX_ENDPOINT };
  }
}

async function checkHigress(): Promise<InfrastructureInfo['higress']> {
  try {
    const res = await fetchWithTimeout(HIGRESS_ENDPOINT);
    return { healthy: res.ok, endpoint: HIGRESS_ENDPOINT };
  } catch {
    return { healthy: false, endpoint: HIGRESS_ENDPOINT };
  }
}

// GET /api/agentteams/infrastructure - aggregate health of all platform components
export async function GET(_request: NextRequest) {
  const [controller, kubernetes, minio, matrix, higress] = await Promise.all([
    checkController(),
    checkKubernetes(),
    checkMinio(),
    checkMatrix(),
    checkHigress(),
  ]);

  const info: InfrastructureInfo = {
    controller,
    kubernetes,
    minio,
    matrix,
    higress,
  };

  return NextResponse.json(info);
}
