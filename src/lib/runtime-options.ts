import type { WorkerRuntime } from '@/lib/agentteams-api';

/** Worker runtimes that can be selected when creating a new instance. */
export const CREATABLE_WORKER_RUNTIMES: { value: WorkerRuntime; label: string }[] = [
  { value: 'openclaw', label: 'OpenClaw' },
  { value: 'hermes', label: 'Hermes' },
  { value: 'qwenpaw', label: 'QwenPaw' },
  { value: 'deepseek-harness', label: 'DeepSeek Harness（实验）' },
];

/** Manager runtimes accepted by the current Controller. */
export const CREATABLE_MANAGER_RUNTIMES: { value: string; label: string }[] = [
  { value: 'openclaw', label: 'OpenClaw' },
  { value: 'qwenpaw', label: 'QwenPaw' },
];

export const COPAW_MIGRATION_HINT =
  'CoPaw 已停止新建。请将运行时改为 QwenPaw；升级前请备份持久化数据，并避免在任务执行中切换。';

export function isLegacyCopaw(runtime: string | null | undefined): boolean {
  return (runtime || '').toLowerCase() === 'copaw';
}

/** Runtimes that remain visible for existing instances but cannot be created. */
export function isLegacyRuntime(runtime: string | null | undefined): boolean {
  const value = (runtime || '').toLowerCase();
  return value === 'copaw' || value === 'openhuman';
}

export function creatableWorkerRuntimeValues(): WorkerRuntime[] {
  return CREATABLE_WORKER_RUNTIMES.map((item) => item.value);
}

export function rejectCopawCreate(runtime: string | null | undefined): string | null {
  if (isLegacyCopaw(runtime)) return COPAW_MIGRATION_HINT;
  return null;
}
