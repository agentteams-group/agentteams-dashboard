export interface RuntimeMetrics {
  state: string;
  startedAt: string | null;
  restartCount: number;
  oomKilled: boolean;
  exitCode: number;
  cpuPercent: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  sampledAt: string | null;
  usageError?: string;
}

export interface RuntimeTarget {
  kind: 'worker' | 'manager' | 'component';
  name: string;
  runtime?: string;
  model?: string;
  phase?: string;
  agentStatus?: string;
  lastActiveAt?: string;
  runningTaskCount?: number;
  availability: 'available' | 'unsupported' | 'missing' | 'error';
  reason?: string;
  metrics: RuntimeMetrics | null;
}

export interface RuntimeSnapshot {
  mode: string;
  sampledAt: string;
  items: RuntimeTarget[];
  total: number;
  page: number;
  totalPages: number;
  limit: number;
}

export interface RuntimeLogs {
  text: string;
  truncated: boolean;
  sampledAt: string;
  tail: number;
}

export function formatMemory(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

export function runtimeSourceMessage(target: RuntimeTarget): string | null {
  if (target.availability === 'unsupported') return '当前部署或外部 Agent 暂无容器数据源';
  if (target.availability === 'missing') return '容器不存在，暂无监控数据';
  if (target.availability === 'error') return '数据源暂时不可用，请刷新重试';
  if (target.metrics?.usageError) return '资源用量暂不可用，运行状态仍可查看';
  return null;
}
