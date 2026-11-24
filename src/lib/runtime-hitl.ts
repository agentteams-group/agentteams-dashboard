/** Ask User receipts share the question envelope; they never authorize tools. */
export function questionReceipts(content: Record<string, unknown>): Array<{ id: string; status: 'answered' | 'cancelled' | 'expired' }> {
  const run = content['org.agentteams.run'] as { version?: unknown; blocks?: unknown } | undefined;
  if (run?.version !== '1' || !Array.isArray(run.blocks)) return [];
  return run.blocks.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return [];
    const block = raw as Record<string, unknown>;
    if (block.type !== 'confirmation' || typeof block.confirmation_id !== 'string' || !block.confirmation_id
      || !['answered', 'cancelled', 'expired'].includes(String(block.status))) return [];
    return [{ id: block.confirmation_id, status: block.status as 'answered' | 'cancelled' | 'expired' }];
  });
}
