import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { configFilePath, isTestTargetAllowed } from './backend-config';
import { TracingError } from './tracing-error';

export interface ObservabilityConfig {
  enabled: boolean;
  captureContent: boolean;
  mode: 'direct' | 'collector';
  langfuseUrl: string;
  publicUrl: string;
  projectId: string;
  publicKey: string;
  secretKey: string;
  collectorEndpoint: string;
  collectorHeaders: string;
  revision: string;
}

export type ObservabilityView = Omit<ObservabilityConfig, 'secretKey' | 'collectorHeaders'> & {
  secretKeyConfigured: boolean;
  collectorHeadersConfigured: boolean;
};

function filePath() { return path.join(path.dirname(configFilePath()), 'observability.json'); }

export async function readObservabilityConfig(): Promise<ObservabilityConfig> {
  try { return JSON.parse(await fs.readFile(filePath(), 'utf8')) as ObservabilityConfig; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new TracingError(503, '可观测配置无法读取');
  }
  return {
    enabled: false, captureContent: true, mode: 'direct',
    langfuseUrl: process.env.LANGFUSE_BASE_URL ?? '', publicUrl: process.env.LANGFUSE_PUBLIC_URL ?? '',
    projectId: process.env.LANGFUSE_PROJECT_ID ?? '', publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? '',
    secretKey: process.env.LANGFUSE_SECRET_KEY ?? '', collectorEndpoint: '', collectorHeaders: '', revision: 'environment',
  };
}

export function publicObservabilityConfig(config: ObservabilityConfig): ObservabilityView {
  const { secretKey, collectorHeaders, ...view } = config;
  return { ...view, secretKeyConfigured: Boolean(secretKey), collectorHeadersConfigured: Boolean(collectorHeaders) };
}

export function observabilityUrl(value: string, label: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new TracingError(400, `${label}地址无效`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !isTestTargetAllowed(value)) {
    throw new TracingError(400, `${label}地址不允许`);
  }
  return value.replace(/\/+$/, '');
}

export function mergeObservabilityConfig(previous: ObservabilityConfig, input: unknown): ObservabilityConfig {
  if (!input || typeof input !== 'object') throw new TracingError(400, '配置格式无效');
  const body = input as Record<string, unknown>;
  const config = { ...previous };
  for (const key of ['enabled', 'captureContent'] as const) {
    if (typeof body[key] !== 'boolean') throw new TracingError(400, '采集开关格式无效');
    config[key] = body[key];
  }
  if (body.mode !== 'direct' && body.mode !== 'collector') throw new TracingError(400, '接入方式无效');
  config.mode = body.mode;
  for (const key of ['langfuseUrl', 'publicUrl', 'projectId', 'publicKey', 'secretKey', 'collectorEndpoint', 'collectorHeaders'] as const) {
    if (body[key] == null) continue;
    if (typeof body[key] !== 'string' || body[key].length > 8192 || /[\r\n\0]/.test(body[key])) throw new TracingError(400, '配置字段格式无效');
    // Secret fields are write-only. An empty form field retains the saved value.
    if ((key === 'secretKey' || key === 'collectorHeaders') && !body[key]) continue;
    config[key] = body[key].trim();
  }
  for (const [key, label] of [['langfuseUrl', 'Langfuse'], ['publicUrl', '浏览器访问'], ['collectorEndpoint', 'Collector']] as const) {
    if (config[key]) config[key] = observabilityUrl(config[key], label);
  }
  if (config.enabled && (!config.langfuseUrl || !config.publicKey || !config.secretKey)) throw new TracingError(400, '请填写 Langfuse 地址和项目密钥');
  if (config.enabled && config.mode === 'collector' && !config.collectorEndpoint) throw new TracingError(400, '请填写 Collector OTLP/HTTP 地址');
  if (config.projectId && !/^[a-zA-Z0-9_-]+$/.test(config.projectId)) throw new TracingError(400, 'Langfuse Project ID 无效');
  return config;
}

export async function saveObservabilityConfig(config: ObservabilityConfig): Promise<ObservabilityConfig> {
  const saved = { ...config, revision: randomUUID() };
  const file = filePath();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${saved.revision}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(saved), { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, file);
  } catch {
    await fs.unlink(temporary).catch(() => {});
    throw new TracingError(503, '可观测配置保存失败');
  }
  return saved;
}

export function parseOtlpHeaders(value: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of value.split(',').filter(Boolean)) {
    const separator = entry.indexOf('=');
    if (separator <= 0) throw new TracingError(400, 'OTLP Headers 格式应为 key=value');
    try {
      const key = entry.slice(0, separator).trim();
      const decoded = decodeURIComponent(entry.slice(separator + 1).trim());
      new Headers({ [key]: decoded });
      headers[key] = decoded;
    } catch { throw new TracingError(400, 'OTLP Headers 格式无效'); }
  }
  return headers;
}

export function workerObservabilityEnv(config: ObservabilityConfig, previous: Record<string, string>) {
  const env = { ...previous };
  for (const key of ['OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'OTEL_EXPORTER_OTLP_PROTOCOL', 'OTEL_EXPORTER_OTLP_HEADERS', 'OTEL_EXPORTER_OTLP_TRACES_HEADERS', 'AGENTTEAMS_OTEL_CAPTURE_CONTENT']) delete env[key];
  env.AGENTTEAMS_OTEL_ENABLED = String(config.enabled);
  env.AGENTTEAMS_OTEL_CONFIG_REVISION = config.revision;
  if (config.enabled) {
    const endpoint = config.mode === 'direct' ? `${observabilityUrl(config.langfuseUrl, 'Langfuse')}/api/public/otel` : observabilityUrl(config.collectorEndpoint, 'Collector');
    const headers = config.mode === 'direct'
      ? `Authorization=${encodeURIComponent('Basic ' + Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64'))},x-langfuse-ingestion-version=4`
      : config.collectorHeaders;
    parseOtlpHeaders(headers);
    Object.assign(env, { AGENTTEAMS_OTEL_CAPTURE_CONTENT: String(config.captureContent),
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint, OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${endpoint}/v1/traces`,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf', OTEL_EXPORTER_OTLP_HEADERS: headers, OTEL_EXPORTER_OTLP_TRACES_HEADERS: headers });
  }
  return env;
}

export async function testObservabilityConnection(config: ObservabilityConfig) {
  const base = observabilityUrl(config.langfuseUrl, 'Langfuse');
  const authorization = `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')}`;
  const request = async (url: string, options: RequestInit = {}) => {
    try { return await fetch(url, { ...options, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) }); }
    catch { throw new TracingError(502, '无法连接可观测后端，请检查地址和网络'); }
  };
  const projects = await request(`${base}/api/public/projects`, { headers: { Authorization: authorization } });
  if (!projects.ok) throw new TracingError(502, `Langfuse 项目认证失败（HTTP ${projects.status}）`);
  const data = await projects.json() as { data?: { id: string; name: string }[] };
  const project = data.data?.find((p) => !config.projectId || p.id === config.projectId);
  if (!project) throw new TracingError(400, '项目密钥与 Project ID 不匹配');
  const endpoint = config.mode === 'direct' ? `${base}/api/public/otel` : observabilityUrl(config.collectorEndpoint, 'Collector');
  const response = await request(`${endpoint}/v1/traces`, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(config.mode === 'direct' ? { Authorization: authorization, 'x-langfuse-ingestion-version': '4' } : parseOtlpHeaders(config.collectorHeaders)),
  }, body: JSON.stringify({ resourceSpans: [] }) });
  if (!response.ok) throw new TracingError(502, `OTLP 接收端测试失败（HTTP ${response.status}）`);
  return { projectId: project.id, projectName: project.name, source: 'dashboard', message: '项目认证和 OTLP 接收端可达；Worker 网络与实际采集需在应用后验证。' };
}
