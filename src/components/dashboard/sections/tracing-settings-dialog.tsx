'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings2 } from 'lucide-react';
import { apiUrl } from '@/lib/api-base';
import type { ObservabilityView } from '@/lib/observability-config';
import type { TraceScope } from '@/lib/tracing-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

async function configuration<T>(method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(apiUrl('/api/agentteams/observability'), { method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '可观测操作失败');
  return data as T;
}

export function TracingSettingsDialog({ scope }: { scope: TraceScope }) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const saved = useQuery({ queryKey: ['observability-config'], queryFn: () => configuration<ObservabilityView>(), enabled: open, retry: false });
  return <>
    <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Settings2 className="mr-2 h-4 w-4" />可观测配置</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>可观测配置</DialogTitle><DialogDescription>可选功能。先保存连接配置，再应用到所选 Worker；保存后无需重启 Dashboard。</DialogDescription></DialogHeader>
      {saved.isLoading ? <p className="text-sm text-muted-foreground">正在读取配置…</p> : null}
      {saved.error ? <p role="alert" className="text-sm text-destructive">{saved.error.message}</p> : null}
      {saved.data ? <ConfigurationForm key={saved.data.revision} value={saved.data} scope={scope} onSave={(value) => {
        client.setQueryData(['observability-config'], value);
        void client.invalidateQueries({ queryKey: ['traces'] });
        void client.invalidateQueries({ queryKey: ['trace'] });
      }} /> : null}
    </DialogContent></Dialog>
  </>;
}

function ConfigurationForm({ value, scope, onSave }: { value: ObservabilityView; scope: TraceScope; onSave: (_value: ObservabilityView) => void }) {
  const [draft, setDraft] = useState({ ...value, secretKey: '', collectorHeaders: '' });
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [results, setResults] = useState<{ name: string; success: boolean; message: string }[]>([]);
  function update(patch: Partial<typeof draft>) { setDraft({ ...draft, ...patch }); setDirty(true); setNotice(''); }
  async function perform(action: 'test' | 'save' | 'apply') {
    setBusy(true); setError(''); setNotice(''); setResults([]);
    try {
      if (action === 'test') {
        const result = await configuration<{ projectId: string; projectName: string; message: string }>('POST', { action, settings: draft });
        if (draft.backend === 'langfuse' && !draft.projectId) update({ projectId: result.projectId });
        setNotice(`${result.projectName}：${result.message}`);
      } else if (action === 'save') {
        const result = await configuration<ObservabilityView>('PUT', draft);
        onSave(result);
      } else {
        const result = await configuration<{ results: typeof results }>('POST', { action, workers: selected, revision: value.revision });
        setResults(result.results);
      }
    } catch (error) { setError(error instanceof Error ? error.message : '可观测操作失败'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5">
    <div className="flex items-center justify-between rounded-lg border p-3"><div><p className="text-sm font-medium">启用 Worker Tracing</p><p className="text-xs text-muted-foreground">默认关闭；开关保存后需应用到 Worker。</p></div><Switch aria-label="启用 Worker Tracing" checked={draft.enabled} onCheckedChange={(enabled) => update({ enabled })} /></div>
    <label className="block space-y-1 text-xs">查询后端<Select value={draft.backend} onValueChange={(backend: 'langfuse' | 'agentloop') => update({ backend })}><SelectTrigger aria-label="查询后端" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="langfuse">Langfuse</SelectItem><SelectItem value="agentloop">阿里云 AgentLoop</SelectItem></SelectContent></Select></label>
    {draft.backend === 'langfuse' ? <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-xs">Langfuse 服务端地址<Input aria-label="Langfuse 服务端地址" placeholder="https://langfuse.example.com" value={draft.langfuseUrl} onChange={(e) => update({ langfuseUrl: e.target.value })} /></label>
      <label className="space-y-1 text-xs">浏览器访问地址<Input aria-label="浏览器访问地址" placeholder="留空使用服务端地址" value={draft.publicUrl} onChange={(e) => update({ publicUrl: e.target.value })} /></label>
      <label className="space-y-1 text-xs">Public Key<Input aria-label="Public Key" autoComplete="off" value={draft.publicKey} onChange={(e) => update({ publicKey: e.target.value })} /></label>
      <label className="space-y-1 text-xs">Secret Key<Input aria-label="Secret Key" type="password" autoComplete="new-password" placeholder={value.secretKeyConfigured ? '已配置，留空保留' : 'sk-lf-…'} value={draft.secretKey} onChange={(e) => update({ secretKey: e.target.value })} /></label>
      <label className="space-y-1 text-xs">Project ID<Input aria-label="Project ID" placeholder="可通过测试连接自动获取" value={draft.projectId} onChange={(e) => update({ projectId: e.target.value })} /></label>
    </div> : <div className="grid gap-3 sm:grid-cols-2">
      {([['region', '地域', 'cn-hangzhou'], ['workspace', 'CMS Workspace', '目标 AgentSpace 关联的 CMS Workspace'], ['project', 'Trace SLS Project', '从 CMS Workspace 定位的 Trace Project'], ['logstore', 'Trace Logstore', '原始 Span 存储，不是 agent-trajectory']] as const).map(([key, label, placeholder]) => <label key={key} className="space-y-1 text-xs">{label}<Input aria-label={label} placeholder={placeholder} value={draft.agentloop[key]} onChange={(e) => update({ agentloop: { ...draft.agentloop, [key]: e.target.value } })} /></label>)}
      <p className="text-xs text-muted-foreground sm:col-span-2">查询使用 Dashboard 服务端的阿里云身份，仅需目标 Trace 数据源的只读权限。请确认此数据源属于所选 Workspace，并为不同组织隔离数据源。</p>
    </div>}
    <div className="space-y-3">
      <label className="block space-y-1 text-xs">Collector OTLP/HTTP 地址<Input aria-label="Collector OTLP/HTTP 地址" placeholder="http://otel-collector:4318" value={draft.collectorEndpoint} onChange={(e) => update({ collectorEndpoint: e.target.value })} /></label>
      <label className="block space-y-1 text-xs">Collector Headers<Input aria-label="Collector Headers" type="password" autoComplete="new-password" placeholder={value.collectorHeadersConfigured ? '已配置，留空保留' : '可选：key=value，多项用逗号分隔'} value={draft.collectorHeaders} onChange={(e) => update({ collectorHeaders: e.target.value })} /></label>
      <p className="text-xs text-muted-foreground">需预先部署已配置目标平台出口的 Collector，地址需从 Worker 网络可达；可配置同时上报 Langfuse 和 AgentLoop。Collector Headers 仅填写采集凭证，查询凭证保留在 Dashboard 服务端。</p>
    </div>
    <label className="flex items-center justify-between gap-3 text-sm">采集模型和工具的输入输出<Switch aria-label="采集模型和工具的输入输出" checked={draft.captureContent} onCheckedChange={(captureContent) => update({ captureContent })} /></label>
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void perform('test')}>测试连接</Button><Button disabled={busy} onClick={() => void perform('save')}>保存配置</Button><span className="self-center text-xs text-muted-foreground">{dirty ? '有未保存的修改' : value.revision === 'environment' ? '尚未保存配置' : '配置已保存'}</span></div>
    {notice ? <p role="status" className="text-xs text-muted-foreground">{notice}</p> : null}
    <div className="space-y-3 border-t pt-4"><h3 className="text-sm font-medium">应用到 Worker</h3><p className="text-xs text-muted-foreground">应用会更新环境变量；运行中的托管容器将重建，可能中断当前任务，休眠中的 Worker 下次启动生效。仅支持已包含采集适配器的 QwenPaw、Hermes 镜像。</p>
      <div className="flex flex-wrap gap-3">{scope.workers.filter((w) => ['qwenpaw', 'hermes'].includes(w.runtime ?? '')).map((worker) => <label key={worker.name} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(worker.name)} onChange={(e) => setSelected(e.target.checked ? [...selected, worker.name] : selected.filter((name) => name !== worker.name))} />{worker.name}</label>)}</div>
      <Button variant="outline" disabled={busy || dirty || value.revision === 'environment' || !selected.length} onClick={() => void perform('apply')}>应用到所选 Worker（重建生效）</Button>
      {results.map((result) => <p key={result.name} role={result.success ? 'status' : 'alert'} className={`text-xs ${result.success ? 'text-muted-foreground' : 'text-destructive'}`}>{result.name}：{result.message}</p>)}
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div>;
}
