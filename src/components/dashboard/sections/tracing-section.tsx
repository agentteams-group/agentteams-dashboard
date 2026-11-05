'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowUpRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SectionHeader } from '@/components/dashboard/section-header';
import { apiUrl } from '@/lib/api-base';
import { traceRows, type TraceDetail, type TraceList, type TraceObservation } from '@/lib/tracing-types';

async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(`/api/agentteams/traces${path}`), { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '读取 Tracing 失败');
  return data as T;
}

function JsonView({ value }: { value: unknown }) {
  return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs">{value == null ? '未采集' : JSON.stringify(value, null, 2)}</pre>;
}

export function TracingSection() {
  const [worker, setWorker] = useState('');
  const [runtime, setRuntime] = useState('');
  const [task, setTask] = useState('');
  const [hours, setHours] = useState('24');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState('');
  const [observationId, setObservationId] = useState('');
  const [filters, setFilters] = useState({ worker: '', runtime: '', task: '', hours: '24' });
  const list = useQuery({
    queryKey: ['traces', filters, page],
    queryFn: ({ signal }) => read<TraceList>(`?${new URLSearchParams({ ...filters, page: String(page) })}`, signal),
    refetchInterval: 10000,
    retry: false,
  });
  const detail = useQuery({
    queryKey: ['trace', selected],
    queryFn: ({ signal }) => read<TraceDetail>(`/${selected}`, signal),
    enabled: Boolean(selected),
    retry: false,
  });
  const rows = traceRows(detail.data?.observations ?? []);
  const observation: TraceObservation | undefined = detail.data?.observations.find((o) => o.id === observationId);
  const generations = detail.data?.observations.filter((o) => o.type === 'GENERATION') ?? [];
  const tokens = generations.reduce((sum, o) => sum + (o.usageDetails?.total ?? o.usage?.total ??
    ((o.usageDetails?.input ?? o.usage?.input ?? 0) + (o.usageDetails?.output ?? o.usage?.output ?? 0))), 0);
  const usageComplete = generations.length > 0 && generations.every((o) =>
    o.usageDetails ? Object.keys(o.usageDetails).length > 0 : o.usage?.total != null);
  const costComplete = generations.length > 0 && generations.every((o) =>
    o.calculatedTotalCost != null && Object.keys(o.costDetails ?? {}).length > 0);

  return <div className="space-y-5">
    <SectionHeader title="Tracing" description="查看 Worker 执行链路、模型调用和工具耗时" actions={
      <Button variant="outline" size="sm" onClick={() => { void list.refetch(); if (selected) void detail.refetch(); }}><RefreshCw className="mr-2 h-4 w-4" />刷新</Button>
    } />
    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Activity className="h-4 w-4 text-emerald-500" />OpenTelemetry → Collector → Langfuse<Badge variant="outline">每 10 秒刷新</Badge></div>
    <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4" onSubmit={(e) => {
      e.preventDefault(); setFilters({ worker, runtime, task, hours }); setPage(1); setSelected(''); setObservationId('');
    }}>
      <label className="min-w-40 flex-1 space-y-1 text-xs">Worker<Input aria-label="Worker" placeholder="全部 Worker" value={worker} onChange={(e) => setWorker(e.target.value)} /></label>
      <label className="space-y-1 text-xs">运行时<select aria-label="运行时" className="block h-9 rounded-md border bg-background px-3" value={runtime} onChange={(e) => setRuntime(e.target.value)}>
        <option value="">全部运行时</option>{['qwenpaw', 'hermes', 'openclaw', 'deepseek-harness', 'openhuman'].map((r) => <option key={r}>{r}</option>)}
      </select></label>
      <label className="min-w-40 flex-1 space-y-1 text-xs">Task ID<Input aria-label="Task ID" placeholder="全部任务" value={task} onChange={(e) => setTask(e.target.value)} /></label>
      <label className="space-y-1 text-xs">时间<select aria-label="时间" className="block h-9 rounded-md border bg-background px-3" value={hours} onChange={(e) => setHours(e.target.value)}><option value="1">最近 1 小时</option><option value="24">最近 24 小时</option><option value="168">最近 7 天</option></select></label>
      <Button type="submit" size="sm">查询</Button>
    </form>
    {list.error ? <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{list.error.message}</p> : null}
    <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.6fr)]">
      <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
        <div className="border-b px-4 py-3 text-sm font-medium">执行记录 <span className="text-muted-foreground">{list.data?.meta.totalItems ?? 0}</span></div>
        {list.isLoading ? <p className="p-6 text-sm text-muted-foreground">正在读取 Langfuse…</p> : null}
        {!list.isLoading && !list.error && !list.data?.data.length ? <p className="p-6 text-sm text-muted-foreground">暂无 Trace。运行 Worker 后刷新查看，入库可能需要数秒。</p> : null}
        <div className="max-h-[650px] overflow-y-auto">{list.data?.data.map((trace) => <button type="button" key={trace.id} onClick={() => { setSelected(trace.id); setObservationId(''); }} className={`block w-full border-b p-4 text-left transition-colors hover:bg-muted/60 ${selected === trace.id ? 'bg-muted' : ''}`}>
          <div className="truncate text-sm font-medium">{trace.name ?? trace.id}</div>
          <div className="mt-2 flex flex-wrap gap-1">{trace.tags.filter((tag) => tag !== 'agentteams').map((tag) => <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>)}</div>
          <div className="mt-2 flex justify-between gap-2 text-xs text-muted-foreground"><span>{trace.userId ?? '未知 Worker'}</span><span>{trace.latency == null ? '—' : `${(trace.latency * 1000).toFixed(0)} ms`}</span></div>
          <div className="mt-1 text-xs text-muted-foreground">{new Date(trace.timestamp).toLocaleString()}</div>
        </button>)}</div>
        <div className="flex items-center justify-between p-3"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button><span className="text-xs text-muted-foreground">{page} / {Math.max(1, list.data?.meta.totalPages ?? 1)}</span><Button size="sm" variant="ghost" disabled={page >= (list.data?.meta.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>下一页</Button></div>
      </div>
      <div className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
        {!selected ? <div className="flex min-h-80 flex-col items-center justify-center gap-3 text-muted-foreground"><Activity className="h-8 w-8" /><p className="text-sm">选择一条 Trace 查看执行瀑布</p></div> : null}
        {detail.isFetching ? <p className="text-sm text-muted-foreground">正在读取 Trace…</p> : null}
        {detail.error ? <p role="alert" className="text-sm text-destructive">{detail.error.message}</p> : null}
        {detail.data ? <>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate font-medium">{detail.data.name}</h2><p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{selected}</p></div>{detail.data.langfuseUrl ? <a className="flex shrink-0 items-center gap-1 text-xs text-primary" href={detail.data.langfuseUrl} target="_blank" rel="noreferrer">Langfuse<ArrowUpRight className="h-3 w-3" /></a> : null}</div>
          <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/40 p-3">{[['Spans', rows.length], ['Tokens', usageComplete ? tokens : tokens ? `${tokens}（部分）` : '未上报'], ['Cost', costComplete && detail.data.totalCost != null ? `$${detail.data.totalCost.toFixed(6)}` : '未计价']].map(([label, value]) => <div key={label}><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-mono text-lg">{value}</div></div>)}</div>
          <div className="overflow-x-auto"><div className="min-w-[460px]">
            <div className="grid grid-cols-[minmax(200px,1fr)_1fr_65px] border-b pb-2 text-xs text-muted-foreground"><span>Span / 父子关系</span><span>时间线</span><span className="text-right">耗时</span></div>
            {rows.map(({ observation: o, depth, duration, left, width }) => <button type="button" key={o.id} onClick={() => setObservationId(o.id)} className={`grid w-full grid-cols-[minmax(200px,1fr)_1fr_65px] items-center gap-2 border-b py-3 text-left hover:bg-muted/40 ${observationId === o.id ? 'bg-muted/60' : ''}`}>
              <div className="min-w-0" style={{ paddingLeft: Math.min(depth, 6) * 12 }}><p className="truncate text-xs font-medium">{depth ? '↳ ' : ''}{o.name}</p><span className={`text-[10px] ${o.level === 'ERROR' ? 'text-destructive' : 'text-muted-foreground'}`}>{o.type}{o.level === 'ERROR' ? ' · ERROR' : ''}{o.model ? ` · ${o.model}` : ''}</span></div>
              <div className="relative h-5 rounded bg-muted/30"><div className={`absolute top-1 h-3 min-w-1 rounded ${o.level === 'ERROR' ? 'bg-destructive' : o.type === 'GENERATION' ? 'bg-violet-500' : 'bg-sky-500'}`} style={{ left: `${left}%`, width: `${Math.max(0.5, Math.min(width, 100 - left))}%` }} /></div>
              <span className="text-right font-mono text-[11px] text-muted-foreground">{duration.toFixed(0)} ms</span>
            </button>)}
          </div></div>
          {observation ? <div className="space-y-3 border-t pt-4"><h3 className="text-sm font-medium">{observation.name}</h3>{observation.statusMessage ? <p className="text-xs text-destructive">{observation.statusMessage}</p> : null}<div className="grid gap-3 md:grid-cols-2"><div><p className="mb-2 text-xs text-muted-foreground">Input</p><JsonView value={observation.input} /></div><div><p className="mb-2 text-xs text-muted-foreground">Output</p><JsonView value={observation.output} /></div></div><details><summary className="cursor-pointer text-xs text-muted-foreground">属性与用量</summary><JsonView value={{ metadata: observation.metadata, usage: observation.usageDetails ?? observation.usage }} /></details></div> : <p className="text-xs text-muted-foreground">点击 Span 查看输入、输出和属性；内容采集由 Worker 配置控制。</p>}
        </> : null}
      </div>
    </div>
  </div>;
}
