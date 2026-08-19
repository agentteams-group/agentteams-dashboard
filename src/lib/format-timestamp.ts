// Timestamp formatting for agentteams read clients.
//
// The controller's project history API returns 19-digit unix **nanosecond**
// strings. 19 digits exceed Number.MAX_SAFE_INTEGER, so the conversion must
// go through BigInt — a plain `Number(ts) / 1e6` would round the input and
// drift the displayed time by seconds.

/**
 * Parse a decimal timestamp string to milliseconds, or null when it cannot
 * be interpreted:
 * - 14-19 digits: nanoseconds (the history API contract; 19 is the normal case)
 * - 1-13 digits:  treated as milliseconds (defensive unit fallback)
 * - non-numeric / empty / zero: null — callers show the raw value instead
 *   of a fake unix-seconds number
 */
export function nanoToMs(ts: string): number | null {
  const trimmed = typeof ts === 'string' ? ts.trim() : '';
  if (!/^\d+$/.test(trimmed) || trimmed === '0') return null;
  try {
    // BigInt (function call, not an `n` literal — tsconfig target < ES2020)
    const NS_PER_MS = BigInt(1000000);
    const ms =
      trimmed.length <= 13 ? Number(trimmed) : Number(BigInt(trimmed) / NS_PER_MS);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  } catch {
    return null;
  }
}

/** Format a project history timestamp for display; unparseable input is
 * returned verbatim (never truncated into a misleading unix-seconds look). */
export function formatNanoTimestamp(ts: string): string {
  const ms = nanoToMs(ts);
  return ms === null ? ts : new Date(ms).toLocaleString();
}
