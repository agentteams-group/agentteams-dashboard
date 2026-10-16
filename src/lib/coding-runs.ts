// 编码执行记录辅助（#146 缺口 2）。

import type { CodingRunStatus } from '@/lib/agentteams-api';

const RUN_FILE = /^run-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.log$/;

/**
 * 从 run-YYYYMMDD-HHMMSS.log 文件名推导可读时间（本地形态，非 UTC）。
 *
 * 仅作为 v1 旧 run 的降级展示：上游最终契约**不**从文件名推导 started_at
 * （文件名是容器本地时间，时区不可知），所以有 `runs.jsonl` 记录时一律以
 * 上游 `started_at`（UTC）为准。无法解析时原样返回。
 */
export function parseCodingRunTime(run: string): string {
  const match = RUN_FILE.exec(run);
  if (!match) return run;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/** 把上游 UTC ISO 时间转成本地可读串；非法值原样返回。 */
export function formatCodingRunInstant(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const CODING_RUN_STATUS_META: Record<
  CodingRunStatus,
  { label: string; className: string }
> = {
  ok: { label: '成功', className: 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400' },
  failed: { label: '失败', className: 'border-red-500/30 text-red-600 dark:text-red-400' },
  timeout: { label: '超时', className: 'border-amber-500/30 text-amber-600 dark:text-amber-400' },
  blocked: { label: '受阻', className: 'border-slate-500/30 text-slate-600 dark:text-slate-400' },
};

/** 人类可读的字节数。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
