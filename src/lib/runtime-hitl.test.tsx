import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ingestHitlTimelineEvents, useHitlInboxStore } from './hitl-inbox';
import { deriveWorkerSessionState } from './worker-session-state';
import { normalizeToBlocks } from './a2ui/normalize';
import { ConfirmationCard, toConfirmationCardPayload } from '@/components/dashboard/sections/chat/confirmation-card';
import { parseRuntimeApproval } from './runtime-approval';
import type { MatrixEvent } from './matrix-api';

vi.mock('@/lib/matrix-store', () => ({ useMatrixStore: (select: (_s: { userId: string }) => unknown) => select({ userId: '@human:s' }) }));
beforeEach(() => useHitlInboxStore.setState({ confirmations: {}, resolutions: {} }));
function question(status = 'pending', sender = '@worker:s'): MatrixEvent {
  return { event_id: `$${status}`, type: 'm.room.message', sender, origin_server_ts: status === 'pending' ? 1 : 2,
    content: { body: 'Choose', 'org.agentteams.run': { version: '1', blocks: [{ type: 'confirmation', tool_name: 'ask_human',
      confirmation_id: 'question-1', reply_format: 'com.agentteams.answer', status,
      questions: [{ id: 'decision', question: 'Choose', options: [{ id: 'a', label: 'A' }] }] }] } } };
}

describe('shared HITL controls', () => {
  it('supports a new Harness without adding client commands', async () => {
    const data = { version: 1, runtime: 'future-harness', reply_format: 'com.agentteams.answer', request_id: 'one',
      context_id: 'opaque:context', status: 'pending', tool_name: 'terminal' };
    expect(parseRuntimeApproval(data)).toBeDefined();
    const blocks = normalizeToBlocks({ body: '', content: { 'org.agentteams.approval': data }, isStreaming: false });
    const send = vi.fn(() => true);
    render(<ConfirmationCard payload={toConfirmationCardPayload(blocks[0].payload!)} onApprove={send} onReject={send} />);
    fireEvent.click(screen.getByRole('button', { name: '批准本次' }));
    expect(send).toHaveBeenCalledWith('批准请求 one', expect.objectContaining({ kind: 'tool_approval', confirmation_id: 'one', context_id: 'opaque:context' }));
    await screen.findByText('已提交，等待运行时确认');
  });
  it('keeps a submitted question pending until its owning runtime accepts it', () => {
    ingestHitlTimelineEvents('!room:s', [question()], '@human:s');
    useHitlInboxStore.getState().submitConfirmation('question-1', '@human:s', 'A');
    ingestHitlTimelineEvents('!room:s', [question('answered', '@other:s')], '@human:s');
    expect(useHitlInboxStore.getState().confirmations['question-1']).toBeDefined();
    ingestHitlTimelineEvents('!room:s', [question('answered')], '@human:s');
    expect(useHitlInboxStore.getState().confirmations['question-1']).toBeUndefined();
    expect(useHitlInboxStore.getState().resolutions['question-1'].answer).toBe('answered');
  });
  it.each(['answered', 'cancelled', 'expired'])('retains %s receipts across history loading', status => {
    ingestHitlTimelineEvents('!room:s', [question(status)], '@human:s');
    ingestHitlTimelineEvents('!room:s', [question()], '@human:s');
    expect(useHitlInboxStore.getState().confirmations['question-1']).toBeUndefined();
  });
  it('prioritizes waiting over running and inactivity over both', () => {
    const opts = { agentStatus: { agentStatus: 'running', runningTaskCount: 1 }, isTyping: true, now: 10, waitingUser: true };
    expect(deriveWorkerSessionState(opts)).toBe('waiting_user');
    expect(deriveWorkerSessionState({ ...opts, phase: 'Stopped' })).toBe('idle');
  });
});
