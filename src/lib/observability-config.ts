import { isTestTargetAllowed } from './backend-config';
import { TracingError } from './tracing-error';

export interface ObservabilityConfig {
  backend: 'langfuse' | 'agentloop';
  agentloop: { region: string; workspace: string; project: string; logstore: string };
  enabled: boolean;
  captureContent: boolean;
  mode: 'collector';
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

export function observabilityUrl(value: string, label: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new TracingError(400, `${label}地址无效`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !isTestTargetAllowed(value)) {
    throw new TracingError(400, `${label}地址不允许`);
  }
  return value.replace(/\/+$/, '');
}

export function validateAgentLoopConfig(config: ObservabilityConfig) {
  const { region, workspace, project, logstore } = config.agentloop;
  if (!region || !workspace || !project || !logstore || !/^[a-z0-9-]+$/.test(region) || !/^[a-z0-9-]+$/.test(project) || !/^[a-z0-9_-]+$/.test(logstore)) {
    throw new TracingError(400, '请填写 AgentLoop 地域、CMS Workspace 和已定位的 Trace Project / Logstore');
  }
}
