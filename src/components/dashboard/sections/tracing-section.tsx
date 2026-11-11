'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowUpRight, ChevronDown, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SectionHeader } from '@/components/dashboard/section-header';
import { CopyButton } from '@/components/dashboard/copy-button';
import { TracingSettingsDialog } from './tracing-settings-dialog';
import { apiUrl } from '@/lib/api-base';
import { diagnoseTrace, summarizeTrace, traceRows, type TraceDetail, type TraceList, type TraceObservation, type TraceScope } from '@/lib/tracing-types';

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
  const [session, setSession] = useState('');
  const [team, setTeam] = useState('');
  const [room, setRoom] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [hours, setHours] = useState('24');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState('');
  const [observationId, setObservationId] = useState('');
  const [advancedFilters, setAdvancedFilters] = useState(false);
  const [filters, setFilters] = useState({ worker: '', runtime: '', task: '', hours: '24', session: '', team: '', room: '' });
  const resources = useQuery({
    queryKey: ['trace-resources'],
    queryFn: ({ signal }) => read<TraceScope>('?options=resources', signal),
    refetchInterval: 10000,
    retry: false,
  });
  const workerOptions = (resources.data?.workers ?? []).filter((w) => !team || w.team === team);
  const workerRuntime = resources.data?.workers.find((w) => w.name === worker)?.runtime;
  const effectiveRuntime = workerRuntime || runtime;
  const needsConfiguration = resources.data?.tracingConfigured === false;
  const tracingReady = !needsConfiguration && resources.data?.tracingEnabled !== false;
  const list = useQuery({
    queryKey: ['traces', filters, page],
    queryFn: ({ signal }) => read<TraceList>(`?${new URLSearchParams({ ...filters, page: String(page) })}`, signal),
    refetchInterval: 10000,
    retry: false,
    enabled: Boolean(resources.data) && !resources.error && tracingReady,
  });
  const detail = useQuery({
    queryKey: ['trace', selected],
    queryFn: ({ signal }) => read<TraceDetail>(`/${selected}`, signal),
    enabled: Boolean(selected) && tracingReady,
    retry: false,
  });
  const rows = traceRows(detail.data?.observations ?? []);
  const observation: TraceObservation | undefined = detail.data?.observations.find((o) => o.id === observationId);
  const summary = summarizeTrace(detail.data?.observations ?? []);
  const usageComplete = summary.calls.length > 0 && summary.completeCalls === summary.calls.length;
  const breakdownComplete = summary.calls.length > 0 && summary.breakdownCalls === summary.calls.length;
  const costComplete = summary.calls.length > 0 && summary.calls.every(({ observation: o }) =>
    o.calculatedTotalCost != null && Object.keys(o.costDetails ?? {}).length > 0);
  const diagnosis = diagnoseTrace(detail.data?.observations ?? []);
  const upstream = detail.data?.metadata?.['agentteams.upstream.trace_id'];

  function openSession(id: string) {
    setWorker(''); setTeam(''); setRuntime(''); setTask(''); setRoom('');
    setSession(id);
    setFilters({ worker: '', runtime: '', task: '', hours, session: id, team: '', room: '' });
    setPage(1);
  }

  async function exportSession(id: string) {
    setExporting(true); setExportError('');
    try {
      const traces: TraceDetail[] = [];
      let current = 1;
      let pages = 1;
      do {
        const result = await read<TraceList>(`?${new URLSearchParams({ session: id, page: String(current) })}`, new AbortController().signal);
        // Bound request concurrency while retaining every page of the session.
        for (let offset = 0; offset < result.data.length; offset += 4) {
          traces.push(...await Promise.all(result.data.slice(offset, offset + 4).map((t) =>
            read<TraceDetail>(`/${t.id}`, new AbortController().signal))));
        }
        pages = result.meta.totalPages; current++;
      } while (current <= pages);
      const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1, sessionId: id,
        exportedAt: new Date().toISOString(), traces: traces.sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
      }, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'worker-session-traces.json'; anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { setExportError(error instanceof Error ? error.message : '导出失败'); }
    finally { setExporting(false); }
  }

  const header = <SectionHeader title="Tracing" description="查看 Worker 执行链路、模型调用和工具耗时" actions={
    <div className="flex flex-wrap items-center gap-2">{tracingReady ? <span className="hidden text-xs text-muted-foreground sm:inline">每 10 秒自动刷新</span> : null}{resources.data?.canConfigure ? <TracingSettingsDialog scope={resources.data} triggerLabel={needsConfiguration ? '配置 Tracing' : tracingReady ? '可观测配置' : '启用 Tracing'} /> : null}<Button variant="outline" size="sm" onClick={() => { void resources.refetch(); if (tracingReady) { void list.refetch(); if (selected) void detail.refetch(); } }}><RefreshCw className="mr-2 h-4 w-4" />刷新</Button></div>
  } />;

  if (resources.data && !tracingReady) return <div className="space-y-5">
    {header}
    <section className="flex flex-col items-center gap-4 rounded-xl border bg-card px-6 py-12 text-center">
      <Activity className="size-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-lg font-medium">{needsConfiguration ? 'Tracing 未配置' : 'Tracing 未启用'}</h2>
      <p className="max-w-lg text-sm text-muted-foreground">配置可观测后端并启用采集后，即可查看 Worker 的执行链路、模型调用和工具耗时。</p>
      {resources.data.canConfigure
        ? <p className="text-sm text-muted-foreground">点击右上方“{needsConfiguration ? '配置 Tracing' : '启用 Tracing'}”，保存连接配置并应用到所选 Worker。</p>
        : <p className="text-sm text-muted-foreground">请联系管理员完成配置。</p>}
    </section>
  </div>;

  return <div className="space-y-4">
    {header}
    <form className="space-y-3 rounded-lg border bg-card p-3" onSubmit={(e) => {
      e.preventDefault(); setFilters({ worker, runtime: effectiveRuntime, task, hours, session, team, room }); setPage(1); setSelected(''); setObservationId('');
    }}>
      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[minmax(120px,1fr)_minmax(140px,1.2fr)_minmax(120px,1fr)_minmax(130px,1fr)_auto_auto]">
      <label className="min-w-0 space-y-1 text-xs">团队<Select value={team || '__all__'} onValueChange={(value) => {
        const next = value === '__all__' ? '' : value; setTeam(next);
        if (worker && !resources.data?.workers.some((w) => w.name === worker && (!next || w.team === next))) { setWorker(''); setRuntime(''); }
      }}>
        <SelectTrigger aria-label="团队" className="w-full min-w-0 bg-background"><SelectValue /></SelectTrigger>
        <SelectContent className="rounded-xl p-1 shadow-lg" sideOffset={6}>
          <SelectItem className="cursor-pointer rounded-lg py-2" value="__all__">全部团队</SelectItem>{resources.data?.teams.map((t) => <SelectItem className="cursor-pointer rounded-lg py-2" key={t.name} value={t.name}>{t.label === t.name ? t.name : `${t.label} (${t.name})`}</SelectItem>)}
        </SelectContent>
      </Select></label>
      <label className="min-w-0 space-y-1 text-xs">Agent<Select value={worker || '__all__'} onValueChange={(value) => { setWorker(value === '__all__' ? '' : value); setRuntime(''); }}>
        <SelectTrigger aria-label="Agent" className="w-full min-w-0 bg-background"><SelectValue /></SelectTrigger>
        <SelectContent className="rounded-xl p-1 shadow-lg" sideOffset={6}>
          <SelectItem className="cursor-pointer rounded-lg py-2" value="__all__">全部 Agent</SelectItem>{workerOptions.map((w) => <SelectItem className="cursor-pointer rounded-lg py-2" key={w.name} value={w.name}>{w.name}</SelectItem>)}
        </SelectContent>
      </Select></label>
      <label className="space-y-1 text-xs">运行时{workerRuntime ? '（自动）' : ''}<Select value={effectiveRuntime || '__all__'} disabled={Boolean(workerRuntime)} onValueChange={(value) => setRuntime(value === '__all__' ? '' : value)}>
        <SelectTrigger aria-label="运行时" className="w-full min-w-0 bg-background"><SelectValue /></SelectTrigger>
        <SelectContent className="rounded-xl p-1 shadow-lg" sideOffset={6}>
          <SelectItem className="cursor-pointer rounded-lg py-2" value="__all__">全部运行时</SelectItem>{['qwenpaw', 'copaw', 'hermes', 'openclaw', 'deepseek-harness', 'openhuman'].map((r) => <SelectItem className="cursor-pointer rounded-lg py-2" key={r} value={r}>{r}</SelectItem>)}
        </SelectContent>
      </Select></label>
      <label className="space-y-1 text-xs">时间<Select value={hours} onValueChange={setHours}>
        <SelectTrigger aria-label="时间" className="w-full min-w-0 bg-background"><SelectValue /></SelectTrigger>
        <SelectContent className="rounded-xl p-1 shadow-lg" sideOffset={6}>
          <SelectItem className="cursor-pointer rounded-lg py-2" value="1">最近 1 小时</SelectItem><SelectItem className="cursor-pointer rounded-lg py-2" value="24">最近 24 小时</SelectItem><SelectItem className="cursor-pointer rounded-lg py-2" value="168">最近 7 天</SelectItem>
        </SelectContent>
      </Select></label>
      <Button type="submit" size="sm">查询</Button>
      <Button type="button" size="sm" variant="ghost" aria-expanded={advancedFilters} aria-controls="trace-advanced-filters" onClick={() => setAdvancedFilters((value) => !value)}>高级筛选{[task, session, room].filter(Boolean).length ? ` (${[task, session, room].filter(Boolean).length})` : ''}<ChevronDown className={`ml-1 size-4 transition-transform ${advancedFilters ? 'rotate-180' : ''}`} /></Button>
      </div>
      {advancedFilters ? <div id="trace-advanced-filters" className="grid gap-3 border-t pt-3 sm:grid-cols-3">
        <label className="min-w-0 space-y-1 text-xs">Task ID<Input aria-label="Task ID" placeholder="全部任务" value={task} onChange={(e) => setTask(e.target.value)} /></label>
        <label className="min-w-0 space-y-1 text-xs">Session ID<Input aria-label="Session ID" placeholder="查询会话的全部轮次" value={session} onChange={(e) => setSession(e.target.value)} /></label>
        <label className="min-w-0 space-y-1 text-xs">Room ID<Input aria-label="Room ID" placeholder="全部会话房间" value={room} onChange={(e) => setRoom(e.target.value)} /></label>
      </div> : null}
    </form>
    {resources.isLoading ? <p className="text-xs text-muted-foreground">正在读取当前账号的资源访问范围…</p> : null}
    {resources.error ? <p role="alert" className="text-sm text-destructive">{resources.error.message}</p> : null}
    {resources.data && !resources.data.workers.length ? <p className="text-xs text-muted-foreground">当前账号暂无可访问的 Worker。</p> : null}
    {filters.session ? <p className="break-all text-xs text-muted-foreground">会话：{filters.session} · 展示全部时间范围内的执行轮次</p> : null}
    {list.error ? <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{list.error.message}</p> : null}
    <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="min-w-0 overflow-hidden rounded-lg border bg-card">
        <div className="border-b px-4 py-3 text-sm font-medium">执行记录 <span className="text-muted-foreground">{list.data?.meta.totalItems ?? 0}</span></div>
        {list.isLoading ? <p className="p-6 text-sm text-muted-foreground">正在读取 Tracing…</p> : null}
        {!list.isLoading && !list.error && !list.data?.data.length ? <p className="p-6 text-sm text-muted-foreground">暂无 Trace。运行 Worker 后刷新查看，入库可能需要数秒。</p> : null}
        <div className="max-h-[650px] overflow-y-auto">{list.data?.data.map((trace) => <button type="button" key={trace.id} aria-label={`${trace.name ?? trace.id} ${trace.timestamp}`} title={`${trace.id}\n${trace.tags.join(' · ')}`} onClick={() => { setSelected(trace.id); setObservationId(''); }} className={`block w-full border-b px-3 py-3 text-left transition-colors hover:bg-muted/60 ${selected === trace.id ? 'border-l-2 border-l-primary bg-muted' : 'border-l-2 border-l-transparent'}`}>
          <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{trace.userId || trace.name || trace.id}</span><span className="shrink-0 font-mono text-xs text-muted-foreground">{trace.latency == null ? '—' : `${trace.latency.toFixed(2)} s`}</span></div>
          <div className="mt-1.5 flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{new Date(trace.timestamp).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span><span className="flex gap-1">{trace.tags.filter((tag) => !tag.includes(':') && !['agentteams', 'worker-turn'].includes(tag)).slice(0, 2).map((tag) => <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>)}</span></div>
        </button>)}</div>
        <div className="flex items-center justify-between p-3"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button><span className="text-xs text-muted-foreground">{page} / {Math.max(1, list.data?.meta.totalPages ?? 1)}</span><Button size="sm" variant="ghost" disabled={page >= (list.data?.meta.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>下一页</Button></div>
      </div>
      <div className="min-w-0 space-y-3 rounded-lg border bg-card p-4">
        {!selected ? <div className="flex min-h-80 flex-col items-center justify-center gap-3 text-muted-foreground"><Activity className="h-8 w-8" /><p className="text-sm">选择一条 Trace 查看执行瀑布</p></div> : null}
        {detail.isFetching ? <p className="text-sm text-muted-foreground">正在读取 Trace…</p> : null}
        {detail.error ? <p role="alert" className="text-sm text-destructive">{detail.error.message}</p> : null}
        {detail.data ? <>
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><h2 className="truncate font-medium">{detail.data.name}</h2><span className="font-mono text-xs text-muted-foreground" title={selected}>{selected.slice(0, 8)}</span><CopyButton text={selected} label="复制 Trace ID" /></div>{detail.data.backendUrl || detail.data.langfuseUrl ? <a className="flex shrink-0 items-center gap-1 text-xs text-primary" href={detail.data.backendUrl || detail.data.langfuseUrl!} target="_blank" rel="noreferrer">{detail.data.backend === 'agentloop' ? 'AgentLoop' : 'Langfuse'}<ArrowUpRight className="h-3 w-3" /></a> : null}</div>
          {detail.data.sessionId ? <div className="flex flex-wrap items-center gap-2 text-xs"><Button size="sm" variant="outline" onClick={() => openSession(detail.data!.sessionId!)}>查看整个会话</Button><Button size="sm" variant="ghost" disabled={exporting} onClick={() => void exportSession(detail.data!.sessionId!)}>{exporting ? '正在导出…' : '导出会话 JSON'}</Button></div> : null}
          {exportError ? <p role="alert" className="text-xs text-destructive">{exportError}</p> : null}
          {typeof upstream === 'string' && /^[a-f0-9]{32}$/i.test(upstream) ? <Button size="sm" variant="outline" onClick={() => { setSelected(upstream); setObservationId(''); }}>查看上游 Worker Trace</Button> : null}
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span className={diagnosis.errors ? 'text-destructive' : ''}>错误 {diagnosis.errors}</span><span>工具调用 {diagnosis.tools}</span><span>HTTP 失败 {diagnosis.failedRequests}</span>{diagnosis.repeatedTools ? <span title="重复调用仅为排查线索，需结合输入输出判断">重复工具参数 {diagnosis.repeatedTools}</span> : null}{diagnosis.slowest ? <span>最慢步骤：{diagnosis.slowest}</span> : null}</p>
          <div aria-label="Trace 概览" className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-4">{[
            ['总 Token', summary.reportedCalls ? `${summary.tokens.toLocaleString()}${usageComplete ? '' : '（部分）'}` : '未上报'],
            ['总耗时', summary.durationMs == null ? '未上报' : `${summary.durationMs >= 1000 ? `${(summary.durationMs / 1000).toFixed(2)} s` : `${summary.durationMs.toFixed(0)} ms`}${summary.durationComplete ? '' : '（部分）'}`],
            ['调用节点', rows.length], ['费用', costComplete && detail.data.totalCost != null ? `$${detail.data.totalCost.toFixed(6)}` : '未计价'],
          ].map(([label, value]) => <div key={label}><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 break-words font-mono text-base">{value}</div></div>)}</div>
          {summary.calls.length ? <details className="rounded-lg border p-3 text-xs">
            <summary className="cursor-pointer font-medium">Token 消耗分布</summary><div className="mt-3 space-y-3">
            <p className="text-muted-foreground">模型调用 {summary.calls.length} 次 · 完整用量 {summary.completeCalls}/{summary.calls.length} 次</p>
            <p>{breakdownComplete ? '输入' : '已知输入'} {summary.input.toLocaleString()} · {breakdownComplete ? '输出' : '已知输出'} {summary.output.toLocaleString()}{breakdownComplete && summary.tokens > 0 ? ` · 输入占 ${(100 * summary.input / summary.tokens).toFixed(1)}%` : ''}{breakdownComplete ? '' : '（输入/输出明细不完整）'}</p>
            {summary.reportedCalls ? <>
              <p className="text-muted-foreground">按模型汇总 · {usageComplete ? '总' : '已上报'} Token 占比</p>
              {summary.models.map((model) => <div key={model.model} className="space-y-1">
                <div className="flex flex-wrap justify-between gap-2"><span>{model.model} · {model.calls} 次</span><span className="font-mono">{model.tokens.toLocaleString()} Token{model.complete ? '' : '（部分）'} · {summary.tokens ? (100 * model.tokens / summary.tokens).toFixed(1) : '0.0'}%</span></div>
                <div className="h-1.5 rounded bg-muted"><div className="h-full rounded bg-violet-500" style={{ width: `${summary.tokens ? 100 * model.tokens / summary.tokens : 0}%` }} /></div>
              </div>)}
              <p className="pt-1 text-muted-foreground">消耗最高的模型调用 · Top 3 · 点击查看输入输出</p>
              {summary.calls.filter((call) => call.reported).slice(0, 3).map((call) => <button key={call.observation.id} type="button" aria-label={`定位第 ${call.index} 次模型调用`} onClick={() => setObservationId(call.observation.id)} className={`block w-full space-y-1 rounded border p-2 text-left hover:bg-muted/40 ${observationId === call.observation.id ? 'bg-muted/60' : ''}`}>
                <div className="flex flex-wrap justify-between gap-2"><span>第 {call.index} 次 · {call.observation.model ?? call.observation.name ?? '未知模型'}</span><span className="font-mono">{call.tokens.toLocaleString()} Token{call.complete ? '' : '（部分）'} · {summary.tokens ? (100 * call.tokens / summary.tokens).toFixed(1) : '0.0'}%</span></div>
                <p className="text-muted-foreground">输入 {call.input?.toLocaleString() ?? '未上报'} · 输出 {call.output?.toLocaleString() ?? '未上报'}</p>
              </button>)}
            </> : <p className="text-muted-foreground">模型未上报 Token 用量。</p>}
            <p className="text-muted-foreground">仅汇总模型调用上报的用量；Token 大头可定位到调用，具体原因需结合输入输出判断。</p>
          </div></details> : null}
          <div className="overflow-x-auto"><div className="min-w-[460px]">
            <div className="grid grid-cols-[minmax(200px,1fr)_1fr_65px] border-b pb-2 text-xs text-muted-foreground"><span>Span / 父子关系</span><span>时间线</span><span className="text-right">耗时</span></div>
            {rows.map(({ observation: o, depth, duration, left, width }) => <button type="button" key={o.id} onClick={() => setObservationId(o.id)} className={`grid w-full grid-cols-[minmax(200px,1fr)_1fr_65px] items-center gap-2 border-b py-2 text-left hover:bg-muted/40 ${observationId === o.id ? 'bg-muted/60' : ''}`}>
              <div className="min-w-0" style={{ paddingLeft: Math.min(depth, 6) * 12 }}><p className="truncate text-xs font-medium">{depth ? '↳ ' : ''}{o.name}</p><span className={`text-xs ${o.level === 'ERROR' ? 'text-destructive' : 'text-muted-foreground'}`}>{o.type}{o.level === 'ERROR' ? ' · ERROR' : ''}{o.model ? ` · ${o.model}` : ''}</span></div>
              <div className="relative h-5 rounded bg-muted/30"><div className={`absolute top-1 h-3 min-w-1 rounded ${o.level === 'ERROR' ? 'bg-destructive' : o.type === 'GENERATION' ? 'bg-violet-500' : 'bg-sky-500'}`} style={{ left: `${left}%`, width: `${Math.max(0.5, Math.min(width, 100 - left))}%` }} /></div>
              <span className="text-right font-mono text-xs text-muted-foreground">{duration.toFixed(0)} ms</span>
            </button>)}
          </div></div>
          {observation ? <div className="space-y-3 border-t pt-4"><h3 className="text-sm font-medium">{observation.name}</h3>{observation.statusMessage ? <p className="text-xs text-destructive">{observation.statusMessage}</p> : null}<div className="grid gap-3 md:grid-cols-2"><div><p className="mb-2 text-xs text-muted-foreground">Input</p><JsonView value={observation.input} /></div><div><p className="mb-2 text-xs text-muted-foreground">Output</p><JsonView value={observation.output} /></div></div><details><summary className="cursor-pointer text-xs text-muted-foreground">属性与用量</summary><JsonView value={{ metadata: observation.metadata, usage: observation.usageDetails ?? observation.usage }} /></details></div> : <p className="text-xs text-muted-foreground">点击 Span 查看输入、输出和属性；内容采集由 Worker 配置控制。</p>}
          <details><summary className="cursor-pointer text-xs text-muted-foreground">标识、会话与采集信息</summary><div className="mt-2 flex flex-wrap items-center gap-1 text-xs"><span className="break-all">Trace: {selected}</span><CopyButton text={selected} label="复制完整 Trace ID" />{detail.data.sessionId ? <><span className="break-all">Session: {detail.data.sessionId}</span><CopyButton text={detail.data.sessionId} label="复制 Session ID" /></> : null}</div><JsonView value={{ tags: detail.data.tags, metadata: detail.data.metadata }} /></details>
        </> : null}
      </div>
    </div>
  </div>;
}
