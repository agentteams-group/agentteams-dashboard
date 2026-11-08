'use client';

// 千锻注入历史——GET /millforge/injections（留 50，最新在前）：时间/团队/
// build/整体成败/SOUL·新建逐项计数/core 技能状态；空态与失败重试。

import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { MillforgeInjectEntry } from '@/lib/agentteams-api';
import type { MillforgeCore } from './use-millforge-core';

function formatTime(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

function countOk(entries: MillforgeInjectEntry[] | undefined): string {
  const list = entries ?? [];
  return `${list.filter((entry) => entry.status === 'ok').length}/${list.length}`;
}

const CORE_LABELS: Record<string, string> = {
  ok: '成功',
  skipped: '跳过',
  partial: '部分失败',
  error: '失败',
};

export function MillforgeHistory({ core }: { core: MillforgeCore }) {
  const { injections, injLoading, injError, loadInjections } = core;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">注入历史（最近 50 条）</span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          data-testid="millforge-history-refresh"
          disabled={injLoading}
          onClick={() => void loadInjections()}
        >
          {injLoading ? (
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-3" aria-hidden="true" />
          )}
          刷新
        </Button>
      </div>

      {injError ? (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center gap-2 text-xs">
            <span className="break-all">注入历史读取失败：{injError}</span>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void loadInjections()}>
              重试
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!injError ? (
        <div className="max-h-[52vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-8 text-xs">时间</TableHead>
                <TableHead className="h-8 text-xs">团队</TableHead>
                <TableHead className="h-8 text-xs">build</TableHead>
                <TableHead className="h-8 text-xs">整体</TableHead>
                <TableHead className="h-8 text-xs">SOUL</TableHead>
                <TableHead className="h-8 text-xs">新建</TableHead>
                <TableHead className="h-8 text-xs">core 技能</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {injections.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-xs text-muted-foreground">
                    {injLoading ? '读取中…' : '暂无注入记录'}
                  </TableCell>
                </TableRow>
              ) : (
                injections.map((record) => (
                  <TableRow key={record.id || `${record.at}:${record.build_id}`}>
                    <TableCell className="py-1 text-xs text-muted-foreground">
                      {formatTime(record.at)}
                    </TableCell>
                    <TableCell className="max-w-32 truncate py-1 text-xs">{record.team || '—'}</TableCell>
                    <TableCell className="py-1 font-mono text-xs">
                      {String(record.build_id || '').slice(0, 10)}…
                    </TableCell>
                    <TableCell className="py-1">
                      {record.partial ? (
                        <Badge variant="outline" className="text-xs text-amber-600 dark:text-amber-400">
                          部分失败
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-emerald-600 dark:text-emerald-400">
                          全部成功
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="py-1 font-mono text-xs">{countOk(record.souls)}</TableCell>
                    <TableCell className="py-1 font-mono text-xs">
                      {record.created?.length ? countOk(record.created) : '—'}
                    </TableCell>
                    <TableCell className="py-1 text-xs">
                      {CORE_LABELS[record.core_skill?.status] ?? record.core_skill?.status ?? '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
