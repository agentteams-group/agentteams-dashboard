import { agentteamsApi } from '@/lib/agentteams-api';
import { apiUrl } from '@/lib/api-base';
import { higressApi, serializeProviderForm, serializeRouteForm } from '@/lib/higress-api';

export async function configureManagerModel(
  manager: string,
  input: { model: string; baseUrl?: string; apiKey?: string },
  onProgress: (_message: string) => void,
) {
  const model = input.model.trim();
  if (!model) throw new Error('请选择或填写模型名称。');
  if (input.baseUrl) {
    const name = `onboarding-${manager}`;
    const [providers, routes] = await Promise.all([higressApi.listProviders(), higressApi.listRoutes()]);
    const provider = serializeProviderForm({
      name, type: 'openai', protocol: 'openai/v1', baseUrl: input.baseUrl.trim(),
      tokens: [input.apiKey?.trim() ?? ''], modelMappings: [{ pattern: model, targetModel: model }], pathPrefix: '/v1',
    });
    onProgress('正在保存模型配置…');
    if (providers.some((item) => item.name === name)) await higressApi.updateProvider(name, provider);
    else await higressApi.createProvider({ ...provider, name, type: 'openai', tokens: [input.apiKey?.trim() ?? ''] });
    const existing = routes.find((item) => item.name === name);
    const route = serializeRouteForm({
      name, pathPredicate: { matchType: 'PRE', matchValue: '/v1' },
      upstreams: [{ provider: name, weight: 100, modelMappings: [{ pattern: model, targetModel: model }] }],
      modelPredicates: [{ matchType: 'EXACT', matchValue: model }],
      authConfig: { enabled: true, allowedCredentialTypes: ['key-auth'], allowedConsumers: [...new Set([...(existing?.authConfig?.allowedConsumers ?? []), 'manager'])] },
    });
    if (existing) await higressApi.updateRoute(name, route);
    else await higressApi.createRoute(route);
  }
  await agentteamsApi.updateManagerModel(manager, model);
  await agentteamsApi.bindConsumer('manager');
  onProgress('正在验证 Manager 的模型调用，首次接入需要等待网关配置生效…');
  // Newly bound gateway credentials propagate asynchronously on first boot.
  const deadline = Date.now() + 90_000;
  for (;;) {
    const response = await fetch(apiUrl(`/api/agentteams/managers/${encodeURIComponent(manager)}/gateway-probe`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'model' }),
    });
    const result = await response.json();
    if (response.ok && result.success) return;
    const message = result.message || result.error || '模型验证失败，请检查 API Key、模型名称和服务地址。';
    if (Date.now() >= deadline || !/HTTP (401|403|404|503)|credentials unavailable/.test(message)) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
