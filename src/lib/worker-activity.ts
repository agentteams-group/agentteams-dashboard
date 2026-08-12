// Worker "vitals strip" helpers: human-readable durations, status narratives
// and the three-tier health wording used by WorkerCard v2.
//
// Copy rules (任务书 §6.1.3): no AI-tone phrasing, plain ops language.

import type { WorkerResponse } from '@/lib/agentteams-api';

/** Fallback text when a vitals-strip field has no data (AC-W3). */
export const NO_DATA = '暂无';

/** "12 分钟" / "3 小时" / "2 天" — duration from `fromIso` until `now`. */
export function formatDurationZh(fromIso: string, now: number): string | null {
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return null;
  const ms = Math.max(0, now - from);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return '不到 1 分钟';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  return `${days} 天`;
}

/** "刚刚" / "5 分钟前" / "3 小时前" / "2 天前" — relative past tense. */
export function formatAgoZh(fromIso: string, now: number): string | null {
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return null;
  const ms = Math.max(0, now - from);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

/** Truncate to `max` chars with an ellipsis (vitals strip cells are ≤ 12 chars). */
export function truncateCell(text: string, max = 12): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Three-tier health wording (replaces the bare "78/100" score in card copy):
 * 稳定运行 / 偶有异常 / 频繁出错. Inactive phases get a neutral phase word
 * instead of an alarmist tier — a sleeping worker is not "出错".
 */
export function healthTierLabel(score: number, phase: WorkerResponse['phase']): string {
  if (phase === 'Failed') return '频繁出错';
  if (phase === 'Sleeping') return '休眠中';
  if (phase === 'Stopped') return '已停机';
  if (phase === 'Pending' || phase === 'Updating') return '就绪中';
  if (score >= 80) return '稳定运行';
  if (score >= 40) return '偶有异常';
  return '频繁出错';
}

/** First line of a failure message, stack traces stripped, hard-capped. */
export function failureSummary(message: string | undefined): string | null {
  if (!message) return null;
  const firstLine = message.split('\n').map((l) => l.trim()).find(Boolean);
  if (!firstLine) return null;
  return firstLine.length > 40 ? `${firstLine.slice(0, 39)}…` : firstLine;
}

/**
 * One-sentence "what is it doing right now" line for the card (任务书 §6.1.1-3,
 * AC-W4). `stateStartedAt` is the time the worker entered its current phase,
 * so the same field backs both "运行了 X" and "空闲 X" readings.
 */
export function buildStatusNarrative(worker: WorkerResponse, now: number): string {
  switch (worker.phase) {
    case 'Running': {
      const task = worker.lastTaskSummary || worker.message || '';
      if (task) {
        return worker.team ? `正在帮 ${worker.team} 处理 ${task}` : `正在处理 ${task}`;
      }
      return '运行中，暂无任务摘要';
    }
    case 'Ready':
      return '已就绪，等待任务';
    case 'Sleeping': {
      const duration = worker.stateStartedAt ? formatDurationZh(worker.stateStartedAt, now) : null;
      return duration ? `空闲 ${duration}` : '休眠中';
    }
    case 'Pending':
      return '等待 Controller 派发镜像，预计 < 2 分钟';
    case 'Stopped':
      return '已停机';
    case 'Failed': {
      const summary = failureSummary(worker.message);
      return summary ? `最近失败：${summary}` : '失败，暂无错误摘要';
    }
    case 'Updating':
      return '正在拉取新镜像';
    default:
      return worker.phase;
  }
}
