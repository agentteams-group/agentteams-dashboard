'use client';

import { useMemo, useState } from 'react';
import { Activity, ChevronRight, Clock3, Coins, Layers3, Sparkles, Users, Wrench } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { CopyButton } from '@/components/dashboard/copy-button';
import { summarizeTaskTraces, traceDuration, traceReasoning, type TaskTraceBundle } from '@/lib/task-tracing';
import { traceRows, type TraceObservation } from '@/lib/tracing-types';

const colors = ['bg-teal-500', 'bg-violet-500', 'bg-sky-500', 'bg-amber-500', 'bg-rose-500'];
const chartColors = ['#14b8a6', '#8b5cf6', '#0ea5e9', '#f59e0b', '#f43f5e'];
const clock = (value: number) => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
const count = (value: number) => value.toLocaleString('zh-CN');

function SpanDetail({ observation }: { observation: TraceObservation }) {
  const reasoning = traceReasoning(observation.output);
  return <div className="space-y-3 rounded-lg bg-muted/40 p-3 text-xs">
    {observation.type === 'GENERATION' ? <div><p className="mb-2 font-medium">模型推理</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">{reasoning || (observation.output == null ? '未采集' : '本次调用未返回推理正文')}</pre></div> : null}
    <div className="grid gap-3 md:grid-cols-2">{(['input', 'output'] as const).map((key) => <div key={key}>
      <p className="mb-2 font-medium">{key === 'input' ? '输入' : '输出'}</p>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">{observation[key] == null ? '未采集' : JSON.stringify(observation[key], null, 2)}</pre>
    </div>)}</div>
    <details><summary className="cursor-pointer text-muted-foreground">元数据与用量</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify({ metadata: observation.metadata, usage: observation.usageDetails ?? observation.usage }, null, 2)}</pre></details>
  </div>;
}

export function TaskTracePanel({ bundle }: { bundle: TaskTraceBundle }) {
  const summary = useMemo(() => summarizeTaskTraces(bundle), [bundle]);
  const [chosenAgent, setChosenAgent] = useState<string | null>(null);
  const selectedAgent = summary.agents.find((agent) => agent.name === chosenAgent) ?? summary.agents[0];
  const visibleRuns = summary.runs.filter((run) => run.agent === selectedAgent?.name);
  const [selectedSpan, setSelectedSpan] = useState<{ observation: TraceObservation; traceId: string } | null>(null);
  const [openRuns, setOpenRuns] = useState<Record<string, boolean>>({});
  const agentColor = (agent: string) => colors[Math.max(0, summary.agents.findIndex((a) => a.name === agent)) % colors.length];
  const missing = bundle.gaps.filter((gap) => gap.startsWith('no_trace_for_task:')).length;
  const roomCorrelated = bundle.traces.filter((entry) => entry.correlation === 'task_room').length;
  const partial = roomCorrelated > 0 || !bundle.retrieval_complete || missing > 0 || !summary.usageComplete;
  return <div className="space-y-6" aria-label="任务 Trace 分析">
    <section className="overflow-hidden rounded-2xl border bg-card">
      <div className="grid lg:grid-cols-2 lg:divide-x">
        <div className="px-5 py-5 sm:px-6">
          <div className="mb-4 flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><span className="shrink-0">{bundle.team_id || '工作区'}</span><span className="text-border">/</span><span className="min-w-0 flex-1 truncate font-mono" title={bundle.task_id}>{bundle.task_id}</span><CopyButton text={bundle.task_id} label="复制任务 ID" /><span className={`shrink-0 rounded-full px-2 py-1 text-xs ${partial ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'}`}>{partial ? '部分数据' : '已加载'}</span></div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><Coins className="size-3.5" />总 Token</p>
          <div className="mt-3 text-4xl font-semibold tabular-nums tracking-tight sm:text-5xl">{summary.reportedCalls ? count(summary.tokens) : '未上报'}</div>
          <p className="mt-2 text-xs text-muted-foreground">{summary.usageComplete ? '全部模型调用已上报用量' : `已上报 ${summary.reportedCalls} / ${summary.calls.length} 次调用 · 总量尚不完整`}</p>
          <dl className="mt-7 grid grid-cols-3 gap-4 border-t pt-5">{[
            { label: '参与 Agent', value: summary.agents.filter((a) => a.name !== '未识别 Agent').length, icon: Users },
            { label: '模型调用', value: summary.calls.length, icon: Activity },
            { label: '工具执行', value: summary.toolCount, icon: Wrench },
          ].map(({ label, value, icon: Icon }) => <div key={label}><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="size-3.5" />{label}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{count(value)}</dd></div>)}</dl>
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground"><Clock3 className="size-3.5" /><span>总时间跨度</span><strong className="font-medium tabular-nums text-foreground">{traceDuration(summary.durationMs)}</strong>{summary.start != null ? <span className="font-mono">{clock(summary.start)} — {clock(summary.end!)}</span> : null}</div>
        </div>
        <div className="border-t px-5 py-5 sm:px-6 lg:border-t-0" aria-label="各 Agent Token 占比">
          <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Agent Token 占比</h3><span className="text-xs text-muted-foreground">点击切换下方链路</span></div>
          <div className="mt-5 grid items-center gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
            <div className="relative mx-auto size-44">
              <svg viewBox="0 0 180 180" className="size-full -rotate-90" aria-label="Agent Token 消耗饼图">
                <circle cx="90" cy="90" r="68" fill="none" strokeWidth="22" className="stroke-muted" />
                {summary.tokens > 0 ? summary.agents.map((agent, index) => {
                  const share = agent.tokens / summary.tokens;
                  const offset = summary.agents.slice(0, index).reduce((n, a) => n + a.tokens, 0) / summary.tokens;
                  if (!share) return null;
                  return <circle key={agent.name} cx="90" cy="90" r="68" fill="none" stroke={chartColors[index % chartColors.length]} strokeWidth={agent.name === selectedAgent?.name ? 26 : 20} strokeDasharray={`${share * 427.2566} ${427.2566}`} strokeDashoffset={-offset * 427.2566} className="cursor-pointer transition-[stroke-width,opacity] focus:outline-none" opacity={agent.name === selectedAgent?.name ? 1 : 0.5} role="button" tabIndex={0} aria-label={`选择 ${agent.name}，Token 占比 ${(share * 100).toFixed(1)}%`} aria-pressed={agent.name === selectedAgent?.name} onClick={() => setChosenAgent(agent.name)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setChosenAgent(agent.name); } }}><title>{agent.name} · {count(agent.tokens)} Token · {(share * 100).toFixed(1)}%</title></circle>;
                }) : null}
              </svg>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-3xl font-semibold tabular-nums tracking-tight">{summary.tokens && selectedAgent ? `${(selectedAgent.tokens / summary.tokens * 100).toFixed(1)}%` : '—'}</span><span className="mt-1 text-xs text-muted-foreground">{summary.tokens ? '所选 Agent' : '暂无用量'}</span></div>
            </div>
            <div className="space-y-1">{summary.agents.map((agent) => <button type="button" key={agent.name} aria-label={`查看 ${agent.name} 的 Trace`} aria-pressed={agent.name === selectedAgent?.name} onClick={() => setChosenAgent(agent.name)} className={`flex w-full min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${agent.name === selectedAgent?.name ? 'border-border bg-muted/50' : 'border-transparent hover:bg-muted/30'}`}>
              <span className={`size-2 shrink-0 rounded-full ${agentColor(agent.name)}`} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium" title={agent.name}>{agent.name}</span><span className="mt-1 block text-xs tabular-nums text-muted-foreground">{agent.reported ? `${count(agent.tokens)} Token` : '用量未上报'}</span></span><span className="shrink-0 text-xs font-semibold tabular-nums">{agent.reported && summary.tokens > 0 ? `${(100 * agent.tokens / summary.tokens).toFixed(1)}%` : '—'}</span>
            </button>)}</div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{summary.usageComplete ? '按已上报模型用量计算，默认选择消耗最高的 Agent。' : '占比仅基于已知用量，未上报部分不计入。'}</p>
        </div>
      </div>
    </section>

    <section aria-label="完整 Trace 流" className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6"><div><h3 className="text-sm font-semibold">完整 Trace 流</h3><p className="mt-1 text-xs text-muted-foreground">{selectedAgent?.name ?? '暂无 Agent'} · 按时间展开 · 点击步骤查看输入、输出与元数据</p></div><span className="rounded-md bg-muted px-2 py-1 text-xs tabular-nums text-muted-foreground">{visibleRuns.length} 轮执行</span></div>
      <div aria-label="所选 Agent 执行统计" className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b bg-muted/20 px-5 py-3 text-xs sm:px-6">{[
        ['Token', selectedAgent?.reported ? count(selectedAgent.tokens) : '未上报'],
        ['模型调用', count(selectedAgent?.calls ?? 0)],
        ['工具调用', count(selectedAgent?.tools ?? 0)],
        ['工具失败', count(selectedAgent?.failedTools ?? 0)],
      ].map(([label, value]) => <span key={label} className="inline-flex items-baseline gap-2"><span className="text-muted-foreground">{label}</span><strong className={`font-semibold tabular-nums ${label === '工具失败' && selectedAgent?.failedTools ? 'text-amber-700 dark:text-amber-400' : ''}`}>{value}</strong></span>)}</div>
      <div className="px-4 py-3 sm:px-6">{visibleRuns.map((run) => {
        const task = bundle.tasks.find((t) => t.task_id === run.taskId);
        const errors = run.traces.reduce((n, t) => n + t.observations.filter((o) => o.level === 'ERROR').length, 0);
        const opened = openRuns[run.id] ?? true;
        return <details key={run.id} className="group relative border-l border-border pl-5 last:border-l-transparent sm:pl-7" open={opened} onToggle={(event) => { const open = event.currentTarget.open; setOpenRuns((previous) => previous[run.id] === open ? previous : { ...previous, [run.id]: open }); }}>
          <span className={`absolute -left-[4px] top-7 size-2 rounded-full ring-4 ring-card ${agentColor(run.agent)}`} />
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 py-5 [&::-webkit-details-marker]:hidden"><time className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{clock(run.start)}</time><div className="min-w-0 flex-1 basis-40"><p className="truncate text-sm font-semibold" title={run.agent}>{run.agent}</p><p className="mt-1 truncate text-xs text-muted-foreground">{task?.title || 'Agent 执行'} · {run.traces.length} 条 Trace{errors ? ` · ${errors} 项错误` : ''}</p></div><span className="text-xs tabular-nums text-muted-foreground">{traceDuration(run.end - run.start)}</span><ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" /></summary>
          {opened ? <div className="mb-5 overflow-x-auto rounded-xl border bg-background">
            <div className="grid min-w-[720px] grid-cols-[minmax(240px,1.2fr)_minmax(180px,1fr)_76px_80px_72px] items-center gap-3 border-b bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground"><span>执行步骤</span><span className="flex justify-between"><span>0</span><span>时间线 · {traceDuration(run.end - run.start)}</span></span><span className="text-right">耗时</span><span className="text-right">Token</span><span className="text-right">状态</span></div>
            {run.traces.map((entry) => <div key={entry.trace.id} className="[content-visibility:auto] [contain-intrinsic-size:auto_100px]">
              <div className="flex min-w-[720px] items-center gap-2 border-b bg-muted/10 px-4 py-2 text-[11px] text-muted-foreground"><Layers3 className="size-3.5" /><span className="min-w-0 flex-1 truncate" title={entry.trace.name ?? entry.trace.id}>{entry.trace.name || 'Trace'}</span><span>{entry.observations.length} 步骤</span><span className="font-mono" title={entry.trace.id}>{entry.trace.id.slice(0, 8)}</span></div>
              {traceRows(entry.observations).map(({ observation, depth, duration }) => {
                const failed = observation.level === 'ERROR' || observation.metadata?.['agentteams.outcome'] === 'error';
                const model = observation.type === 'GENERATION';
                const tool = observation.type === 'TOOL' || observation.metadata?.['gen_ai.operation.name'] === 'execute_tool';
                const Icon = model ? Sparkles : tool ? Wrench : Activity;
                const tone = failed ? 'bg-amber-500' : model ? 'bg-violet-500' : tool ? 'bg-teal-500' : 'bg-slate-400';
                const total = observation.usageDetails?.total ?? observation.usage?.total;
                const input = observation.usageDetails?.input ?? observation.usage?.input;
                const output = observation.usageDetails?.output ?? observation.usage?.output;
                const tokens = total ?? (input != null || output != null ? (input ?? 0) + (output ?? 0) : null);
                const axis = Math.max(1, run.end - run.start);
                const left = Math.max(0, Math.min(100, 100 * (Date.parse(observation.startTime) - run.start) / axis));
                const width = Math.max(0, Math.min(100 - left, 100 * duration / axis));
                return <button type="button" key={observation.id} onClick={() => setSelectedSpan({ observation, traceId: entry.trace.id })} aria-label={`查看步骤 ${observation.name || observation.type}`} className={`grid min-w-[720px] w-full grid-cols-[minmax(240px,1.2fr)_minmax(180px,1fr)_76px_80px_72px] items-center gap-3 border-b border-border/50 px-4 py-2.5 text-left text-xs last:border-b-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${failed ? 'bg-amber-500/5' : ''}`}>
                  <span className="flex min-w-0 items-center gap-2" style={{ paddingLeft: Math.min(depth, 10) * 12 }}><span className={`flex size-6 shrink-0 items-center justify-center rounded-md ${model ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400' : tool ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400' : 'bg-muted text-muted-foreground'}`}><Icon className="size-3.5" /></span><span className="min-w-0"><span className="block truncate font-medium" title={observation.name ?? observation.type}>{observation.name || observation.type}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{model ? observation.model || '模型调用' : tool ? '工具执行' : observation.type}</span></span></span>
                  <span className="relative h-6 overflow-hidden rounded bg-muted/20" style={{ backgroundImage: 'linear-gradient(to right, var(--border) 1px, transparent 1px)', backgroundSize: '25% 100%' }} title={`${clock(Date.parse(observation.startTime))} · ${traceDuration(duration)}`}><span className={`absolute top-1.5 h-3 min-w-[3px] rounded-sm ${tone} ${observation.endTime ? '' : 'opacity-50'}`} style={{ left: `${left}%`, width: `${width}%` }} /></span>
                  <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">{observation.endTime ? traceDuration(duration) : '未结束'}</span><span className="text-right font-mono text-[11px] tabular-nums">{model && tokens != null ? count(tokens) : '—'}</span><span className={`text-right text-[11px] ${failed ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>{failed ? '失败' : observation.endTime ? '已结束' : '未结束'}</span>
                </button>;
              })}
            </div>)}
          </div> : null}
        </details>;
      })}{!visibleRuns.length ? <p className="py-12 text-center text-sm text-muted-foreground">尚未采集到执行记录。任务开始后可刷新查看。</p> : null}</div>
      <div className="border-t bg-muted/20 px-5 py-3 text-xs leading-6 text-muted-foreground sm:px-6">{missing ? `${missing} 个任务节点暂未采集到 Trace。` : ''}{roomCorrelated ? `${roomCorrelated} 条记录按任务房间关联，原始任务标识缺失。` : ''}时间跨度按最早开始至最晚已记录时间计算，重叠执行不会重复累加；Token 仅汇总模型调用用量。{bundle.gaps.length ? <details><summary className="cursor-pointer">查看采集情况</summary><ul className="mt-2 max-h-40 overflow-auto font-mono">{bundle.gaps.map((gap, i) => <li key={i} className="break-all">{gap}</li>)}</ul></details> : null}</div>
    </section>
    <Sheet open={selectedSpan != null} onOpenChange={(open) => { if (!open) setSelectedSpan(null); }}>
      <SheetContent className="overflow-y-auto sm:max-w-[580px]">
        <SheetHeader className="border-b pr-12"><SheetTitle className="break-all">{selectedSpan?.observation.name || '执行步骤'}</SheetTitle><SheetDescription>查看这一步的输入、输出与原始采集数据</SheetDescription></SheetHeader>
        {selectedSpan ? <div className="space-y-5 px-4 pb-6"><dl className="grid grid-cols-2 gap-4 text-xs"><div><dt className="text-muted-foreground">类型</dt><dd className="mt-1 font-medium">{selectedSpan.observation.type}</dd></div><div><dt className="text-muted-foreground">耗时</dt><dd className="mt-1 font-medium">{selectedSpan.observation.endTime ? traceDuration(Date.parse(selectedSpan.observation.endTime) - Date.parse(selectedSpan.observation.startTime)) : '未结束'}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">Trace ID</dt><dd className="mt-1 flex items-center gap-2 break-all font-mono">{selectedSpan.traceId}<CopyButton text={selectedSpan.traceId} label="复制 Trace ID" /></dd></div></dl>{selectedSpan.observation.statusMessage ? <p className="break-words rounded-lg bg-amber-500/10 p-3 text-xs">{selectedSpan.observation.statusMessage}</p> : null}<SpanDetail observation={selectedSpan.observation} /></div> : null}
      </SheetContent>
    </Sheet>
  </div>;
}
