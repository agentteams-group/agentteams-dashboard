/**
 * Worker container lifecycle notices sent by the controller's manager bot.
 *
 * These arrive as ordinary `m.text` messages ("Worker ceshi container has been
 * automatically paused due to idle timeout...") and used to render as a normal
 * chat bubble. They are status announcements, not conversation, so the chat
 * timeline shows them as a compact notification instead.
 *
 * Detection is deliberately narrow: the manager sender plus the controller's
 * exact "Worker <name> container has been automatically paused/resumed" shape.
 */

export type WorkerLifecycleKind = 'paused' | 'resumed';

export interface WorkerLifecycleNotice {
  kind: WorkerLifecycleKind;
  worker: string;
  /** Original message body, kept for the hover title. */
  body: string;
}

const WORKER_LIFECYCLE_RE =
  /^\s*Worker\s+(.+?)\s+container\s+has\s+been\s+(?:automatically\s+)?(paused|resumed)\b/i;

export function parseWorkerLifecycleNotice(
  body: string | null | undefined
): WorkerLifecycleNotice | null {
  if (!body) return null;
  const text = body.trim();
  if (!text || text.length > 500) return null;
  const match = WORKER_LIFECYCLE_RE.exec(text);
  if (!match) return null;
  const worker = match[1].trim();
  if (!worker || worker.length > 120) return null;
  return {
    kind: match[2].toLowerCase() as WorkerLifecycleKind,
    worker,
    body: text,
  };
}

/** The controller's manager bot owns lifecycle announcements. */
export function isManagerSender(sender: string, label?: string | null): boolean {
  const localpart = sender.startsWith('@') ? sender.slice(1).split(':')[0] : sender;
  return /^manager\b/i.test(localpart) || /^manager\b/i.test(label?.trim() ?? '');
}
