'use client';

// 编码执行记录（#146 缺口 2）：只读查看编码 CLI 的一次性执行记录与原始日志。
//
// 数据面：上游只读端点（agentteams-controller/internal/server/coding_runs.go）——
//   GET /api/v1/coding-runs                     → [{task_id, run, team?}]（上限 200）
//   GET /api/v1/coding-runs/{taskID}/runs/{run} → 原始日志（text/plain 字节透传）
//
// 上游契约限制（如实标注）：列表无 worker / status / source CLI 字段，时间只能从
// run-YYYYMMDD-HHMMSS.log 文件名推导；详情是未结构化的原始日志，无法区分
// 输入 / 输出 / 日志。待上游补齐字段后再增强，不臆造数据。
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
import { agentteamsApi, type CodingRun } from '@/lib/agentteams-api';
import { ApiError } from '@/lib/api-error';
import { useCodingRuns } from '@/hooks/use-coding-runs';
import { parseCodingRunTime } from '@/lib/coding-runs';

export function CodingRunsSection() {
  const { data: runs, isLoading, isFetching, error, refetch } = useCodingRuns();
  const [selected, setSelected] = useState<CodingRun | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState('');

  const openRun = useCallback(async (run: CodingRun) => {
    setSelected(run);
    setLog(null);
    setLogError('');
    setLogLoading(true);
    try {
      const text = await agentteamsApi.getCodingRunLog(run.task_id, run.run, run.team);
      setLog(text);
    } catch (err) {
      setLogError(err instanceof Error ? err.message : '读取失败');
    } finally {
      setLogLoading(false);
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
                <TableHead>执行记录</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={`${run.task_id}/${run.run}`}>
                  <TableCell className="font-mono text-xs">
                    {parseCodingRunTime(run.run)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{run.task_id}</TableCell>
                  <TableCell>
                    {run.team ? (
                      <Badge variant="secondary">{run.team}</Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
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
          <div className="max-h-[65vh] overflow-auto rounded-md border bg-muted/20 p-3">
            {logLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                读取日志…
              </div>
            ) : logError ? (
              <p className="text-sm text-red-600 dark:text-red-400">{logError}</p>
            ) : (
              <pre className="whitespace-pre-wrap break-all font-mono text-xs">{log ?? ''}</pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
