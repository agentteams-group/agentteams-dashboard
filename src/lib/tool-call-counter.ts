// Tool-call counter backing the Worker card vitals strip ("工具调用" column).
//
// The workers section deliberately does NOT subscribe to Matrix timelines
// (任务书 R5). Instead the Chat side counts tool_call blocks as they render
// and appends timestamps here; the card reads a 24h window count.

const STORAGE_KEY = 'agentteams:toolcall-ledger:v1';
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_TIMESTAMPS_PER_WORKER = 500;
const MAX_EVENTS = 1000;

interface ToolCallLedger {
  /** Matrix event id → number of tool_call blocks already counted for it. */
  events: Record<string, number>;
  /** Worker name → timestamps of counted tool calls. */
  perWorker: Record<string, number[]>;
  /** Worker name → structured tool_call ids already counted (org.agentteams.run v1). */
  structuredKeys?: Record<string, Set<string>>;
}

function loadLedger(): ToolCallLedger {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { events: {}, perWorker: {} };
    const parsed = JSON.parse(raw) as Partial<ToolCallLedger>;
    return {
      events: parsed.events && typeof parsed.events === 'object' ? parsed.events : {},
      perWorker: parsed.perWorker && typeof parsed.perWorker === 'object' ? parsed.perWorker : {},
      structuredKeys: parsed.structuredKeys && typeof parsed.structuredKeys === 'object'
        ? asStringSets(parsed.structuredKeys)
        : {},
    };
  } catch {
    return { events: {}, perWorker: {}, structuredKeys: {} };
  }
}

function asStringSets(value: unknown): Record<string, Set<string>> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, Set<string>> = {};
  for (const [workerName, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    result[workerName] = new Set(Object.keys(raw as Record<string, unknown>));
  }
  return result;
}

function saveLedger(ledger: ToolCallLedger): void {
  try {
    const serialisable: ToolCallLedger = {
      events: ledger.events,
      perWorker: ledger.perWorker,
    };
    if (ledger.structuredKeys) {
      const serialisedKeys: Record<string, Record<string, number>> = {};
      for (const [workerName, keys] of Object.entries(ledger.structuredKeys)) {
        const inner: Record<string, number> = {};
        for (const key of keys) inner[key] = 1;
        serialisedKeys[workerName] = inner;
      }
      serialisable.structuredKeys = serialisedKeys as unknown as Record<string, Set<string>>;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serialisable));
  } catch {
    // Storage full / unavailable — counting is best-effort, never block chat.
  }
}

function isAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/**
 * Count `blockCount` tool_call blocks belonging to one rendered message.
 * Revisions of the same root event (m.replace streaming) only add the delta,
 * so a growing tool list is not double-counted.
 *
 * `structuredKeys` is an optional list of stable tool_call ids from
 * runtime-versioned (`org.agentteams.run` v1) blocks. When provided, these ids
 * are the authoritative dedupe keys and the event-delta counter is skipped —
 * each tool call has exactly one stable id, so counting both the event block
 * count and the structured ids would double-count. Pass `undefined` (or an
 * empty array) to keep the original event-delta behaviour.
 */
export function recordToolCalls(
  workerName: string,
  eventId: string,
  blockCount: number,
  now: number = Date.now(),
  structuredKeys?: readonly string[],
): void {
  if (!isAvailable() || !workerName) return;

  const hasStructuredKeys = !!structuredKeys && structuredKeys.length > 0;
  const hasEventDelta = !hasStructuredKeys && !!eventId && blockCount > 0;
  if (!hasStructuredKeys && !hasEventDelta) return;

  const ledger = loadLedger();

  let totalDelta = 0;
  if (hasStructuredKeys) {
    const seen = ledger.structuredKeys ?? (ledger.structuredKeys = {});
    const keySet = seen[workerName] ?? (seen[workerName] = new Set<string>());
    for (const key of structuredKeys) {
      if (typeof key !== 'string' || key.trim().length === 0) continue;
      if (keySet.has(key)) continue;
      keySet.add(key);
      totalDelta += 1;
    }
  } else if (hasEventDelta) {
    const already = ledger.events[eventId] ?? 0;
    const delta = blockCount - already;
    if (delta > 0) {
      ledger.events[eventId] = blockCount;
      totalDelta = delta;
    }
  }

  if (totalDelta <= 0) return;

  const stamps = [...(ledger.perWorker[workerName] ?? [])];
  for (let i = 0; i < totalDelta; i++) stamps.push(now);
  ledger.perWorker[workerName] = stamps.slice(-MAX_TIMESTAMPS_PER_WORKER);

  // Bound the event index: drop oldest arbitrary entries past the cap.
  const eventIds = Object.keys(ledger.events);
  if (eventIds.length > MAX_EVENTS) {
    for (const id of eventIds.slice(0, eventIds.length - MAX_EVENTS)) {
      delete ledger.events[id];
    }
  }
  saveLedger(ledger);
}

/** Number of tool calls attributed to the worker in the last 24 hours. */
export function countToolCalls24h(workerName: string, now = Date.now()): number {
  if (!isAvailable() || !workerName) return 0;
  const ledger = loadLedger();
  const stamps = ledger.perWorker[workerName];
  if (!stamps || stamps.length === 0) return 0;
  const fresh = stamps.filter((ts) => now - ts < WINDOW_MS);
  if (fresh.length !== stamps.length) {
    ledger.perWorker[workerName] = fresh;
    saveLedger(ledger);
  }
  return fresh.length;
}

/** Test helper: wipe the ledger. */
export function clearToolCallLedger(): void {
  if (!isAvailable()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
