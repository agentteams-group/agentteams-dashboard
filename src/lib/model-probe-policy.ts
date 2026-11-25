export interface ModelProbePolicy {
  allowedHosts: string[];
  allowPrivateNetwork: boolean;
  revision: string;
  source: 'environment' | 'persistent';
}
export const MODEL_PROBE_POLICY_PATH = '/api/agentteams/models/probe-policy';
export async function parseModelProbePolicy(response: Response): Promise<ModelProbePolicy> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if ([404, 405, 501].includes(response.status)) throw new Error('当前 Controller 尚不支持持久化探测配置，请先升级 Controller。');
    if (response.status === 401) throw new Error('请重新登录后再修改内网白名单。');
    if (response.status === 403) throw new Error('仅管理员可以修改内网白名单。');
    if (response.status === 409) throw new Error('配置已被其他管理员修改，请重试或重新加载后再保存。');
    throw new Error(typeof data?.error === 'string' ? data.error : '无法读取或保存内网白名单，请稍后重试。');
  }
  if (!data || !Array.isArray(data.allowedHosts) || data.allowedHosts.some((host: unknown) => typeof host !== 'string') || typeof data.allowPrivateNetwork !== 'boolean' || typeof data.revision !== 'string') throw new Error('Controller 返回了无效的探测配置。');
  return data;
}
