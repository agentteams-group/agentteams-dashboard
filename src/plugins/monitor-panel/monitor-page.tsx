'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SectionHeader } from '@/components/dashboard/section-header';
import { OverflowText } from '@/components/dashboard/overflow-text';
import { ListPagination } from '@/components/dashboard/list-pagination';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatMemory, runtimeSourceMessage, type RuntimeTarget } from '@/lib/runtime-monitoring';
import { formatAgoZh } from '@/lib/worker-activity';
import { useNowTick } from '@/hooks/use-now-tick';
import type { PluginDashboardServices } from '@/lib/plugins/types';

const kinds = { worker: 'Worker', manager: 'Manager', component: '基础组件' };
const states: Record<string, string> = { running: '运行中', exited: '已停止', stopped: '已停止', created: '待启动', restarting: '重启中', paused: '已暂停', dead: '异常' };
const activities: Record<string, string> = { idle: '空闲', running: '执行中', busy: '忙碌', waiting: '等待中' };
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';

export function MonitorPage({ dashboard }: { dashboard: PluginDashboardServices }) {
  const now = useNowTick(30_000);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<RuntimeTarget | null>(null);
  const snapshot = useQuery({
    queryKey: ['runtime-monitoring', page, search],
    queryFn: () => dashboard.getMonitoring({ page, limit: 12, search }),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const data = snapshot.data;
  return <div className="space-y-4">
    <SectionHeader title="运行监控" onRefresh={() => void snapshot.refetch()} isRefreshing={snapshot.isFetching}
      meta={<span className="text-sm text-muted-foreground">{data ? `${data.total} 个运行资源` : '容器状态与资源用量'}</span>} />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Input aria-label="搜索运行资源" placeholder="搜索名称、运行时或状态…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className="h-9 w-full sm:max-w-sm" />
      <p className="text-xs text-muted-foreground">{data?.mode === 'embedded' ? 'Docker' : data?.mode || '—'} · 更新于 {data ? dateTime(data.sampledAt) : '—'}</p>
    </div>
    <p className="text-xs leading-5 text-muted-foreground">展示容器整体用量，CPU 100% 对应一个核。嵌入式部署的 Matrix、网关和存储共用 Controller 容器。</p>
    {snapshot.isError && <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">监控数据加载失败，请确认 Controller 已支持监控接口后刷新重试。<span className="mt-1 block text-xs">{snapshot.error.message}</span></div>}
    {snapshot.isPending ? <div role="status" aria-label="加载运行监控" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map(item => <Skeleton key={item} className="h-72 rounded-xl" />)}</div> : data && <>
      {!data.items.length ? <div className="rounded-xl border py-16 text-center text-sm text-muted-foreground">{search ? '没有匹配的运行资源' : '暂无运行资源'}</div> :
        <div aria-label="运行资源卡片" aria-busy={snapshot.isFetching} className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map(target => <RuntimeCard key={`${target.kind}/${target.name}`} target={target} now={now} onLogs={() => setSelected(target)} />)}
        </div>}
      <ListPagination page={data.page} totalPages={data.totalPages} totalItems={data.total} label="资源" onChange={setPage} />
    </>}
    <RuntimeLogSheet key={selected ? `${selected.kind}/${selected.name}` : 'closed'} target={selected} dashboard={dashboard} onClose={() => setSelected(null)} />
  </div>;
}

function RuntimeCard({ target, now, onLogs }: { target: RuntimeTarget; now: number; onLogs: () => void }) {
  const m = target.metrics;
  const message = runtimeSourceMessage(target);
  const state = m?.state;
  const title = target.kind === 'component' ? target.name === 'controller' ? 'Controller' : 'Dashboard' : target.name;
  return <Card className="min-w-0 gap-0 rounded-xl p-4 shadow-none">
    <div className="flex min-w-0 items-center gap-3">
      <div className="min-w-0 flex-1"><h2 className="min-w-0 text-sm font-semibold"><OverflowText text={title} /></h2><p className="mt-1 truncate text-xs text-muted-foreground">{kinds[target.kind]}{target.runtime ? ` · ${target.runtime}` : ''}</p></div>
      <Badge variant="outline" className="shrink-0 gap-1.5 text-xs"><span aria-hidden="true" className={`size-1.5 rounded-full ${state === 'running' ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />{state ? states[state] || state : target.phase || '不可用'}</Badge>
    </div>
    <div className="mt-3 flex h-5 min-w-0 gap-2 text-xs"><span className="shrink-0 text-muted-foreground">{target.kind === 'component' ? '范围' : '模型'}</span><OverflowText text={target.kind === 'component' ? target.name === 'controller' ? 'Controller 与内置基础服务' : 'Dashboard 服务' : target.model || '—'} /></div>
    <div className="my-4 grid grid-cols-2 gap-4 border-y py-4">
      <div><p className="text-xs text-muted-foreground">CPU</p><p className="mt-1 text-xl font-semibold tabular-nums">{m?.cpuPercent == null ? '—' : `${m.cpuPercent.toFixed(2)}%`}</p><p className="mt-1 text-[11px] text-muted-foreground">容器整体占用</p></div>
      <div><p className="text-xs text-muted-foreground">内存</p><p className="mt-1 whitespace-nowrap text-xl font-semibold tabular-nums">{formatMemory(m?.memoryUsageBytes)}</p><p className="mt-1 text-[11px] text-muted-foreground">{m ? m.memoryLimitBytes == null ? '配额未限制' : `配额 ${formatMemory(m.memoryLimitBytes)}` : '配额 —'}</p></div>
    </div>
    <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
      <span className="text-muted-foreground">重启 <span className="ml-1 text-foreground">{m?.restartCount ?? '—'} 次{m?.oomKilled ? ' · OOM' : ''}</span></span>
      <span className="truncate text-right text-muted-foreground" title={dateTime(m?.startedAt)}>启动 <span className="ml-1 text-foreground">{m?.startedAt ? formatAgoZh(m.startedAt, now) : '—'}</span></span>
    </div>
    <div className="mt-2 h-5 min-w-0 text-xs text-muted-foreground">
      <OverflowText text={message || (target.kind === 'worker' ? `最近活动 ${target.lastActiveAt ? formatAgoZh(target.lastActiveAt, now) : '—'}${target.agentStatus ? ` · ${activities[target.agentStatus] || target.agentStatus}` : ''}${target.runningTaskCount == null ? '' : ` · ${target.runningTaskCount} 个任务`}` : `采样时间 ${dateTime(m?.sampledAt)}`)} />
    </div>
    <div className="mt-3 flex justify-end"><Button variant="outline" size="sm" className="h-8 px-3" disabled={target.availability === 'unsupported' || target.availability === 'missing'} onClick={onLogs} aria-label={`查看 ${target.name} 日志`}>日志</Button></div>
  </Card>;
}

function RuntimeLogSheet({ target, dashboard, onClose }: { target: RuntimeTarget | null; dashboard: PluginDashboardServices; onClose: () => void }) {
  const [range, setRange] = useState('all');
  const [keyword, setKeyword] = useState('');
  const logs = useQuery({
    queryKey: ['runtime-logs', target?.kind, target?.name, range],
    queryFn: () => dashboard.getMonitoringLogs(target!.kind, target!.name, { tail: 300, ...(range === 'all' ? {} : { since: new Date(Date.now() - Number(range) * 60_000).toISOString() }) }),
    enabled: !!target,
    retry: false,
    staleTime: 0,
  });
  const lines = logs.data?.text.split('\n').filter(line => line && line.toLowerCase().includes(keyword.toLowerCase())) ?? [];
  return <Sheet open={!!target} onOpenChange={open => { if (!open) onClose(); }}>
    <SheetContent className="flex w-full flex-col gap-4 overflow-hidden p-4 sm:max-w-3xl sm:p-6">
      <SheetHeader className="min-w-0 p-0 pr-6"><SheetTitle className="break-all">{target?.name} · 日志</SheetTitle><SheetDescription>最近 300 行容器输出。常见凭据字段已遮盖。</SheetDescription></SheetHeader>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={range} onValueChange={setRange}><SelectTrigger aria-label="日志时间范围" className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">最近日志</SelectItem><SelectItem value="15">最近 15 分钟</SelectItem><SelectItem value="60">最近 1 小时</SelectItem></SelectContent></Select>
        <Input aria-label="筛选已加载日志" placeholder="筛选已加载日志…" value={keyword} onChange={event => setKeyword(event.target.value)} className="min-w-0 flex-1 basis-40" />
        <Button variant="outline" size="sm" disabled={logs.isFetching} onClick={() => void logs.refetch()}>刷新日志</Button>
      </div>
      {logs.isError ? <p role="alert" className="text-sm text-destructive">日志加载失败：{logs.error.message}</p> : logs.isPending ? <Skeleton aria-label="加载日志" className="h-64" /> : <>
        <p className="text-xs text-muted-foreground">已显示 {lines.length} 行 · 更新于 {dateTime(logs.data.sampledAt)}{logs.data.truncated ? ' · 日志较大，内容已截断，请缩小时间范围' : ''}</p>
        <pre aria-label="容器日志内容" className="min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-6 whitespace-pre-wrap break-all">{lines.length ? lines.join('\n') : keyword ? '没有匹配的日志' : '所选时间范围暂无日志'}</pre>
      </>}
    </SheetContent>
  </Sheet>;
}
