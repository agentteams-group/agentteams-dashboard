import { apiUrl } from '@/lib/api-base';

const reasons: Record<string, string> = {
  ok: 'Harness 模型验证通过。',
  authentication: '模型认证失败，请检查模型凭据。',
  billing_or_quota: '模型余额或配额不足。',
  rate_limit_or_quota: '模型请求受限，请稍后重试并检查配额。',
  model_or_endpoint: '模型或服务地址不可用。',
  upstream_unavailable: '上游模型服务暂不可用。',
  configuration: 'Harness 模型配置尚不可用，请检查已保存配置与运行状态。',
  unsupported: '该 Harness 当前认证模式尚不支持模型验证。',
  disabled: '该 Harness 已关闭模型验证。',
  timeout: '等待 Harness 验证结果超时，请检查运行状态后重试。',
  network: 'Harness 无法连接模型服务。',
};

type Result = { success: boolean; message: string; reason?: string };

function failure(response: Response, body: { message?: string; error?: string } | null): Result {
  return { success: false, message: response.status === 404 || response.status === 405
    ? 'Controller 暂不支持此验证，请升级后重试。'
    : body?.message || body?.error || `模型验证失败（HTTP ${response.status}），请检查模型配置与运行状态。` };
}

// Queue once. Only a result acknowledging this request can complete the check.
export async function probeHarnessModel(
  kind: 'workers' | 'managers',
  name: string,
  onProgress?: (_message: string) => void,
): Promise<Result> {
  const member = `/api/agentteams/${kind}/${encodeURIComponent(name)}`;
  const response = await fetch(apiUrl(`${member}/gateway-probe`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // Legacy Controllers can spend 20 seconds executing the model request.
    body: JSON.stringify({ kind: 'model' }), signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  // Older Controllers return a synchronous result; do not start a second probe.
  if (response.status !== 202) return response.ok && body?.success === true
    ? { success: true, message: body.message || '模型验证通过。' } : failure(response, body);
  const expires = Date.parse(body?.expires_at);
  if (body?.status !== 'pending' || body?.queued !== true || !/^[a-f0-9]{32}$/.test(body?.request_id || '') || !Number.isFinite(expires)) {
    return { success: false, message: 'Controller 返回了无效的验证请求，请升级后重试。' };
  }
  const deadline = Math.min(expires, Date.now() + 120_000);
  onProgress?.('正在等待 Harness 回报模型验证结果…');
  while (Date.now() < deadline) {
    const health = await fetch(apiUrl(`${member}/health`), {
      cache: 'no-store', signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - Date.now()))),
    });
    const report = await health.json().catch(() => null);
    if (!health.ok) return failure(health, report);
    if (report?.version === 1 && report?.request_id === body.request_id) {
      return { success: report.status === 'ok' && report.reason === 'ok',
        message: reasons[report.reason] || 'Harness 未能验证模型，请检查运行状态与已保存配置。', reason: report.reason };
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(5000, deadline - Date.now()))));
  }
  return { success: false, message: reasons.timeout, reason: 'timeout' };
}
