import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from '@/lib/matrix-api';
import { getDirectExecution, EXECUTION_KEY, markStoppedMessages } from '@/lib/direct-execution';
import type { DisplayMessage } from '@/hooks/use-matrix';

const human = '@me:test', agent = '@agent:test';
function status(runId: string, state: string, ts: number, sender = agent): MatrixEvent {
  return { event_id: `$${runId}-${state}`, sender, type: 'm.room.message', origin_server_ts: ts,
    content: { msgtype: 'm.notice', body: state, [EXECUTION_KEY]: { run_id: runId, status: state, capabilities: ['stop', 'steer'] } } };
}
const derive = (events: MatrixEvent[], members = [human, agent]) => getDirectExecution(events, human, members, [agent]);

describe('direct execution controls', () => {
  it('marks only the confirmed stopped response, retaining its partial content', () => {
    const messages: DisplayMessage[] = ['old', 'new'].map(id => ({ id, sender: agent, senderShort: 'agent',
      content: `partial ${id}`, type: 'm.text', timestamp: 1, isMe: false, isStreaming: true }));
    const stopped = status('a', 'stopped', 3);
    (stopped.content[EXECUTION_KEY] as Record<string, unknown>).message_id = 'old';
    const result = markStoppedMessages(messages, [stopped], [agent]);
    expect(result[0]).toMatchObject({ turnState: 'stopped', isStreaming: false, content: 'partial old' });
    expect(result[1]).toEqual(messages[1]);
    expect(markStoppedMessages(messages, [status('a', 'stopping', 2)], [agent])).toEqual(messages);
  });
  it('shows a standalone acknowledgement when the response is not loaded and ignores forged acknowledgements', () => {
    expect(markStoppedMessages([], [status('a', 'stopped', 3)], [agent])[0]).toMatchObject({ turnState: 'stopped', sender: agent });
    expect(markStoppedMessages([], [status('a', 'stopped', 3, human)], [agent])).toEqual([]);
  });
  it('requires a known Agent, two joined members, and advertised capabilities', () => {
    expect(derive([status('a', 'running', 1)])).toMatchObject({ runId: 'a', status: 'running', agentId: agent });
    expect(derive([status('a', 'running', 1)], [human, agent, '@third:test'])).toBeNull();
    expect(derive([status('a', 'running', 1, human)])).toBeNull();
    expect(getDirectExecution([status('a', 'running', 1)], human, [human, agent], [])).toBeNull();
  });
  it('ignores an old run finishing after the next run has started', () => {
    expect(derive([status('a', 'running', 1), status('b', 'running', 2), status('a', 'stopped', 3)])).toMatchObject({ runId: 'b', status: 'running' });
  });
  it('terminal states win over delayed stopping notices and timestamp ties', () => {
    expect(derive([status('a', 'stopping', 2), status('a', 'stopped', 2), status('a', 'running', 1)])?.status).toBe('stopped');
  });
  it('does not infer cancellability from typing or unknown status data', () => {
    expect(derive([])).toBeNull();
    expect(derive([status('a', 'bogus', 1)])).toBeNull();
  });
});
