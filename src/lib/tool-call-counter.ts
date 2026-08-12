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
}

function loadLedger(): ToolCallLedger {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { events: {}, perWorker: {} };
    const parsed = JSON.parse(raw) as Partial<ToolCallLedger>;
    return {
      events: parsed.events && typeof parsed.events === 'object' ? parsed.events : {},
      perWorker: parsed.perWorker && typeof parsed.perWorker === 'object' ? parsed.perWorker : {},
    };
  } catch {
    return { events: {}, perWorker: {} };
  }
}

function saveLedger(ledger: ToolCallLedger): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
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
 */
export function recordToolCalls(workerName: string, eventId: string, blockCount: number, now = Date.now()): void {
  if (!isAvailable() || !workerName || !eventId || blockCount <= 0) return;
  const ledger = loadLedger();
  const already = ledger.events[eventId] ?? 0;
  const delta = blockCount - already;
  if (delta <= 0) return;

  ledger.events[eventId] = blockCount;
  const stamps = [...(ledger.perWorker[workerName] ?? [])];
  for (let i = 0; i < delta; i++) stamps.push(now);
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
