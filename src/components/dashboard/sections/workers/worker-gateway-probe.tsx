'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { agentteamsApi } from '@/lib/agentteams-api';
import { apiUrl } from '@/lib/api-base';

export function WorkerGatewayProbe({ workerName }: { workerName: string }) {
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  async function verify(kind: 'model' | 'mcp') {
    setPending(true);
    setResults([]);
    try {
      // Always reload persisted spec: unsaved form values must not be reported
      // as verified, and a renamed worker may have a different consumer name.
      const saved = await agentteamsApi.getWorker(workerName);
      const targets = kind === 'model' ? [undefined] : (saved.mcpServers || []).map((server) => server.name);
      if (!targets.length) { setResults(['尚未保存 MCP 配置。']); return; }
      for (const server of targets) {
        const response = await fetch(apiUrl(`/api/agentteams/workers/${encodeURIComponent(workerName)}/gateway-probe`), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, server }),
        });
        const body = await response.json().catch(() => null);
        const message = response.status === 404 || response.status === 405
          ? 'Controller 暂不支持此验证，请升级后重试。'
          : body?.message || body?.error || `HTTP ${response.status}`;
        setResults((previous) => [...previous, `${server || saved.model || '模型'}：${response.ok && body?.success ? '验证通过' : '未通过'} · ${message}`]);
      }
    } catch { setResults(['验证请求失败，请检查连接与权限。']); }
    finally { setPending(false); }
  }
  return <div className="space-y-2 rounded border p-3 text-xs">
    <p className="font-medium">已保存配置的网关验证</p>
    <p>验证使用该 Worker 的 Consumer 身份，不使用上游 API Key。请先保存修改；表单中尚未保存的模型与 MCP 不参与验证。请求由 Controller 发出，验证成功不代表 Worker 容器网络或实际任务已验证。</p>
    <p>模型验证会产生一次最多请求 8 个输出 token 的推理调用。MCP 验证仅初始化并读取工具列表，不执行工具；当前支持网关的 Streamable HTTP 入口。</p>
    <div className="flex gap-2"><Button type="button" variant="outline" disabled={pending} onClick={() => void verify('model')}>验证已保存模型</Button><Button type="button" variant="outline" disabled={pending} onClick={() => void verify('mcp')}>验证已保存 MCP</Button></div>
    <p>未授权时，请管理员在“模型管理 → Consumers”检查 AI 路由绑定范围；MCP 需通过 Manager 或 Higress 给该 Worker 授权。这里不会自动扩大权限。</p>
    <div role="status">{pending && <p>正在验证…</p>}{results.map((result, index) => <p key={index} className="break-words">{result}</p>)}</div>
  </div>;
}
