import type { ExecutionHistoryEntry } from './batch-workflow-types';

const STORAGE_KEY = 'batch-execution-history';
const MAX_HISTORY = 10;

export function loadExecutionHistory(): ExecutionHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as ExecutionHistoryEntry[] : [];
  } catch {
    return [];
  }
}

export function saveExecutionHistory(history: ExecutionHistoryEntry[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

export function appendExecutionHistory(entry: ExecutionHistoryEntry): ExecutionHistoryEntry[] {
  const history = loadExecutionHistory();
  const next = [entry, ...history.filter((h) => h.workflowId !== entry.workflowId)].slice(0, MAX_HISTORY);
  saveExecutionHistory(next);
  return next;
}
