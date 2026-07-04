import * as Minio from 'minio';

export interface MinioConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  region?: string;
}

function parseEndpoint(endpoint: string): { host: string; port: number; useSSL: boolean } {
  let url = endpoint.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `http://${url}`;
  }
  const parsed = new URL(url);
  const useSSL = parsed.protocol === 'https:';
  const port = parsed.port ? parseInt(parsed.port, 10) : useSSL ? 443 : 80;
  return { host: parsed.hostname, port, useSSL };
}

function isLocalhost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function resolveMinioHost(endpointHost: string): string {
  if (!isLocalhost(endpointHost)) return endpointHost;

  // In embedded mode the controller often advertises MinIO as 127.0.0.1:9000,
  // but the dashboard runs in a different container. Fall back to the controller host.
  const controllerUrl = process.env.HICLAW_CONTROLLER_URL || '';
  if (controllerUrl) {
    try {
      const parsed = new URL(controllerUrl);
      if (!isLocalhost(parsed.hostname)) {
        return parsed.hostname;
      }
    } catch {
      // ignore
    }
  }
  return endpointHost;
}

export function getMinioConfigFromEnv(): MinioConfig | null {
  const endpoint = process.env.HICLAW_FS_ENDPOINT || process.env.HICLAW_MINIO_ENDPOINT || '';
  const accessKey =
    process.env.HICLAW_FS_ACCESS_KEY || process.env.HICLAW_MINIO_USER || '';
  const secretKey =
    process.env.HICLAW_FS_SECRET_KEY || process.env.HICLAW_MINIO_PASSWORD || '';

  if (!endpoint || !accessKey || !secretKey) {
    return null;
  }

  const { host, port, useSSL } = parseEndpoint(endpoint);
  return {
    endPoint: resolveMinioHost(host),
    port,
    useSSL,
    accessKey,
    secretKey,
    region: process.env.HICLAW_FS_REGION || 'us-east-1',
  };
}

export function getMinioBucket(): string | null {
  return process.env.HICLAW_FS_BUCKET || process.env.HICLAW_MINIO_BUCKET || null;
}

export function createMinioClient(config?: MinioConfig): Minio.Client {
  const cfg = config || getMinioConfigFromEnv();
  if (!cfg) {
    throw new Error(
      'MinIO is not configured. Set HICLAW_FS_ENDPOINT, HICLAW_FS_ACCESS_KEY and HICLAW_FS_SECRET_KEY.'
    );
  }
  return new Minio.Client({
    endPoint: cfg.endPoint,
    port: cfg.port,
    useSSL: cfg.useSSL,
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
    region: cfg.region,
  });
}

export { Minio };
