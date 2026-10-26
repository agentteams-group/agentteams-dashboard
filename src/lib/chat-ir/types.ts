/**
 * ChatIR turn states. States are display metadata only: they never decide
 * which Matrix events belong to a turn (relations and ids do). A stale
 * timeout can therefore close a turn visually without splitting its events.
 *
 *  pending     – a run opened (placeholder) and nothing has arrived yet
 *  running     – at least one block is still streaming
 *  finalized   – an answer was selected for the turn
 *  interrupted – no answer and the run is no longer live (timeout/lifecycle)
 *  detached    – thread replies whose root is outside the loaded window
 */
export type ChatTurnState = 'pending' | 'running' | 'finalized' | 'interrupted' | 'detached';

export type ChatRuntimeProfile =
  | 'openclaw'
  | 'qwenpaw'
  | 'hermes'
  | 'copaw'
  | 'manager'
  | 'openhuman'
  | 'unknown';

export interface ChatTurn {
  turnId: string;
  sender: string;
  runtime: ChatRuntimeProfile;
  state: ChatTurnState;
  canonicalEventId: string;
  latestEventId: string;
  latestTopLevelEventId: string | null;
  sourceEventIds: string[];
  detached: boolean;
  startedAt: number;
  lastEventAt: number;
}
