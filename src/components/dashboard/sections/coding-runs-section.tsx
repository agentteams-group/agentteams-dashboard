'use client';

// 编码执行记录（#146 缺口 2）：只读查看编码 CLI 的一次性执行记录与原始日志。
//
// 数据面：上游只读端点（agentteams-controller/internal/server/coding_runs.go）——
//   GET /api/v1/coding-runs                     → 列表项（v2 加性字段）
//   GET /api/v1/coding-runs/{taskID}/runs/{run} → 原始日志（text/plain 字节透传）
//   …?format=json                               → 结构化信封 {meta, input, output}
//
// v2 契约 @ agentscope-ai/AgentTeams#1381（2026-10-15 合并）：
//   · 列表新增 cli / worker / status / exit_code / started_at / ended_at /
//     log_bytes，来自每个 task 的 runs.jsonl 索引；旧 run 无记录时上游省略
//     （降级为 v1 task/run/team）。
//   · started_at 仅来自 runs.jsonl（UTC）；上游明确不从文件名推导（本地时间），
//     故无记录时本页时间列为未知，仅用文件名做带标注的降级展示，不声称 UTC。
//   · 详情 ?format=json 提供 meta / input.prompt / output.transcript；
//     prompt 未镜像时 prompt_available=false。旧 Controller 忽略 format 仍返回
//     text/plain，本页降级为原始日志渲染。
//
// 与聊天区的 QwenPaw 会话上下文（WorkerChatsPanel）不是同一数据面：这里是编码
// 执行（编码 CLI）的记录，不是 Agent 上下文。

import { useCallback, useState } from 'react';
import { AlertCircle, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SectionHeader } from '@/components/dashboard/section-header';
import {
  agentteamsApi,
  type CodingRun,
  type CodingRunDetail,
} from '@/lib/agentteams-api';
import { ApiError } from '@/lib/api-error';
import { useCodingRuns } from '@/hooks/use-coding-runs';
import {
  CODING_RUN_STATUS_META,
  formatBytes,
  formatCodingRunInstant,
  parseCodingRunTime,
} from '@/lib/coding-runs';

export function CodingRunsSection() {
  const { data: runs, isLoading, isFetching, error, refetch } = useCodingRuns();
  const [selected, setSelected] = useState<CodingRun | null>(null);
  const [detail, setDetail] = useState<CodingRunDetail | null>(null);
  const [rawLog, setRawLog] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const openRun = useCallback(async (run: CodingRun) => {
    setSelected(run);
    setDetail(null);
    setRawLog(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const { detail: d, text } = await agentteamsApi.getCodingRunView(
        run.task_id,
        run.run,
        run.team,
      );
      setDetail(d);
      setRawLog(text);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '读取失败');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const notDeployed = error instanceof ApiError && error.status === 404;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="编码执行记录"
        description="编码 CLI 的一次性执行记录与原始日志（只读）。与聊天区的 QwenPaw 会话上下文不是同一数据源。"
        onRefresh={() => void refetch()}
        isRefreshing={isFetching}
      />

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          加载编码执行记录…
        </div>
      ) : notDeployed ? (
        <div className="flex items-center gap-2 rounded-md border border-border/60 p-4 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          当前 Controller 版本未提供编码执行记录（升级后自动开放）。
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-md border border-red-200 p-4 text-sm text-red-600 dark:border-red-900 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error instanceof Error ? error.message : '加载失败'}
        </div>
      ) : !runs || runs.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-border/60 p-4 text-sm text-muted-foreground">
          <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
          暂无编码执行记录。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>任务</TableHead>
                <TableHead>团队</TableHead>
                <TableHead>CLI</TableHead>
                <TableHead>Worker</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>退出码</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>执行记录</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={`${run.task_id}/${run.run}`}>
                  <TableCell
                    className="font-mono text-xs"
                    title={
                      run.started_at
                        ? undefined
                        : '由 run 文件名推导（容器本地时间，非 UTC）'
                    }
                  >
                    {runTime(run)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{run.task_id}</TableCell>
                  <TableCell>
                    {run.team ? (
                      <Badge variant="secondary">{run.team}</Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{run.cli ?? '-'}</TableCell>
                  <TableCell className="font-mono text-xs">{run.worker ?? '-'}</TableCell>
                  <TableCell>{runStatus(run.status)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {run.exit_code !== undefined ? run.exit_code : '-'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {run.log_bytes !== undefined ? formatBytes(run.log_bytes) : '-'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{run.run}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => void openRun(run)}
                    >
                      <FileText className="mr-1 h-3 w-3" aria-hidden="true" />
                      查看日志
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="w-full max-w-[min(100%-2rem,56rem)] max-h-[85vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{selected?.run}</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {selected?.task_id}
              {selected?.team ? ` · ${selected.team}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-auto">
            {detailLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                读取详情…
              </div>
            ) : detailError ? (
              <p className="text-sm text-red-600 dark:text-red-400">{detailError}</p>
            ) : (
              <>
                {detail && <RunMetaBlock detail={detail} />}
                {detail?.input.prompt_available && detail.input.prompt && (
                  <section className="space-y-1">
                    <h3 className="text-xs font-medium text-muted-foreground">输入（Prompt）</h3>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/20 p-3 font-mono text-xs">
                      {detail.input.prompt}
                    </pre>
                  </section>
                )}
                <section className="space-y-1">
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {detail ? '输出（原始日志）' : '原始日志'}
                  </h3>
                  <pre className="whitespace-pre-wrap break-all rounded-md border bg-muted/20 p-3 font-mono text-xs">
                    {rawLog ?? ''}
                  </pre>
                </section>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function runTime(run: CodingRun): string {
  if (run.started_at) return formatCodingRunInstant(run.started_at);
  return parseCodingRunTime(run.run);
}

function runStatus(status: CodingRun['status']) {
  if (!status) return <span className="text-muted-foreground">-</span>;
  const meta = CODING_RUN_STATUS_META[status];
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  );
}

function RunMetaBlock({ detail }: { detail: CodingRunDetail }) {
  const { meta, output } = detail;
  const rows: { label: string; value: string }[] = [];
  if (meta.cli) rows.push({ label: 'CLI', value: meta.cli });
  if (meta.worker) rows.push({ label: 'Worker', value: meta.worker });
  if (meta.runner) rows.push({ label: 'Runner', value: meta.runner });
  if (meta.status) rows.push({ label: '状态', value: CODING_RUN_STATUS_META[meta.status].label });
  if (meta.exit_code !== undefined) rows.push({ label: '退出码', value: String(meta.exit_code) });
  if (meta.timeout_secs !== undefined) rows.push({ label: '超时上限', value: `${meta.timeout_secs}s` });
  if (meta.started_at) rows.push({ label: '开始', value: formatCodingRunInstant(meta.started_at) });
  if (meta.ended_at) rows.push({ label: '结束', value: formatCodingRunInstant(meta.ended_at) });
  if (meta.log_bytes !== undefined) rows.push({ label: '日志大小', value: formatBytes(meta.log_bytes) });
  if (output.status && !meta.status) {
    rows.push({ label: '状态', value: CODING_RUN_STATUS_META[output.status].label });
  }
  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        该执行记录无结构化元数据（旧 run 或上游未记录）。
      </p>
    );
  }
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
      {rows.map((row) => (
        <div key={row.label} className="flex gap-2">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="font-mono">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
