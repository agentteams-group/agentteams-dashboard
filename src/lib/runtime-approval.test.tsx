import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { normalizeToBlocks } from './a2ui/normalize';
import { parseRuntimeApprovalConfirmation } from './a2ui/parser';
import { ingestHitlTimelineEvents, useHitlInboxStore } from './hitl-inbox';
import { parseRuntimeApproval, RUNTIME_APPROVAL_KEY, type RuntimeApproval } from './runtime-approval';
import { ConfirmationCard, toConfirmationCardPayload } from '@/components/dashboard/sections/chat/confirmation-card';
import type { MatrixEvent } from './matrix-api';

vi.mock('@/lib/matrix-store', () => ({ useMatrixStore: (select: (_s: { userId: string }) => unknown) => select({ userId: '@me:test' }) }));
const room = '!room:test';
const sender = '@agent:test';
function approval(runtime: 'qwenpaw' | 'codex', request_id = 'req-1'): RuntimeApproval {
  return { version: 1, runtime, request_id, status: 'pending', tool_name: 'Bash', parameters: '{"command":"echo probe"}', ...(runtime === 'codex' ? { context_id: 'thread-1:turn-1' } : {}) };
}
function event(id: string, data: RuntimeApproval, author = sender, timestamp = 1): MatrixEvent {
  return { type: 'm.room.message', event_id: id, sender: author, origin_server_ts: timestamp, content: { msgtype: 'm.text', body: 'Approval', [RUNTIME_APPROVAL_KEY]: data } };
}
beforeEach(() => useHitlInboxStore.setState({ confirmations: {}, resolutions: {} }));
afterEach(cleanup);

describe.each(['qwenpaw', 'codex'] as const)('%s approval lifecycle', (runtime) => {
  it('applies receipts in the same history batch as their request', () => {
    const data = approval(runtime);
    ingestHitlTimelineEvents(room, [event('$pending', data), event('$ack', { ...data, status: 'approved' }, sender, 2)], '@me:test');
    expect(useHitlInboxStore.getState().resolutions['$pending'].answer).toBe('approved');
    expect(useHitlInboxStore.getState().confirmations['$pending']).toBeUndefined();
  });
  it('allows a runtime receipt after the displayed deadline', async () => {
    const data = { ...approval(runtime), expires_at: Date.now() - 1000 };
    const input = event('$pending', data);
    ingestHitlTimelineEvents(room, [input], '@me:test');
    const blocks = normalizeToBlocks({ body: '', content: input.content, isStreaming: false });
    render(<ConfirmationCard payload={{ ...toConfirmationCardPayload(blocks[0].payload!), resolutionKey: '$pending' }} onApprove={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText('已超时 - Bash')).toBeInTheDocument();
    expect(useHitlInboxStore.getState().resolutions['$pending']).toBeUndefined();
    ingestHitlTimelineEvents(room, [event('$ack', { ...data, status: 'approved' }, sender, 2)], '@me:test');
    await waitFor(() => expect(screen.getByText('已批准 - Bash')).toBeInTheDocument());
  });
  it('renders the runtime contract and binds the exact request command', async () => {
    const data = approval(runtime);
    const input = event('$pending', data);
    ingestHitlTimelineEvents(room, [input], '@me:test');
    const blocks = normalizeToBlocks({ body: 'Approval', runtime, content: input.content, isStreaming: false });
    const send = vi.fn(() => true);
    const payload = { ...toConfirmationCardPayload(blocks[0].payload!), resolutionKey: '$pending' };
    render(<ConfirmationCard payload={payload} onApprove={send} onReject={send} />);
    fireEvent.click(screen.getByRole('button', { name: /批准本次/ }));
    await screen.findByText('已提交，等待运行时确认 - Bash');
    expect(send).toHaveBeenCalledWith(runtime === 'codex' ? '/approve req-1 thread-1:turn-1' : '/approval approve req-1', expect.objectContaining({ confirmation_id: 'req-1' }));
    expect(useHitlInboxStore.getState().confirmations['$pending']).toBeDefined();
    ingestHitlTimelineEvents(room, [event('$ack', { ...data, status: 'approved' }, sender, 2)], '@me:test');
    await waitFor(() => expect(screen.getByText('已批准 - Bash')).toBeInTheDocument());
    expect(useHitlInboxStore.getState().confirmations['$pending']).toBeUndefined();
  });
  it('leaves failed delivery retryable', async () => {
    const data = approval(runtime);
    const blocks = normalizeToBlocks({ body: '', content: event('$p', data).content, isStreaming: false });
    const send = vi.fn(() => false);
    render(<ConfirmationCard payload={toConfirmationCardPayload(blocks[0].payload!)} onApprove={send} onReject={send} />);
    fireEvent.click(screen.getByRole('button', { name: /批准本次/ }));
    await screen.findByText('发送失败，请重试');
    expect(screen.getByRole('button', { name: /批准本次/ })).toBeEnabled();
  });
  it('accepts only the owning Agent receipt and exact request', () => {
    const first = approval(runtime, 'req-1'), second = approval(runtime, 'req-2');
    ingestHitlTimelineEvents(room, [event('$one', first), event('$two', second)], '@me:test');
    ingestHitlTimelineEvents(room, [event('$spoof', { ...second, status: 'approved' }, '@other:test', 2)], '@me:test');
    expect(Object.keys(useHitlInboxStore.getState().confirmations)).toHaveLength(2);
    ingestHitlTimelineEvents(room, [event('$ack', { ...second, status: 'rejected' }, sender, 3)], '@me:test');
    expect(Object.keys(useHitlInboxStore.getState().confirmations)).toEqual(['$one']);
  });
  it('does not confuse the same request id in another room', () => {
    const data = approval(runtime);
    ingestHitlTimelineEvents(room, [event('$one', data)], '@me:test');
    ingestHitlTimelineEvents('!other:test', [event('$two', data)], '@me:test');
    ingestHitlTimelineEvents(room, [event('$ack', { ...data, status: 'expired' }, sender, 2)], '@me:test');
    expect(Object.keys(useHitlInboxStore.getState().confirmations)).toEqual(['$two']);
  });
  it('does not render a human-pasted structured approval', () => {
    ingestHitlTimelineEvents(room, [event('$human', approval(runtime), '@me:test')], '@me:test');
    expect(Object.keys(useHitlInboxStore.getState().confirmations)).toHaveLength(0);
  });
  it('tracks a manually targeted decision as submitted without removing another request', () => {
    const first = approval(runtime, 'req-1'), second = approval(runtime, 'req-2');
    ingestHitlTimelineEvents(room, [event('$one', first), event('$two', second)], '@me:test');
    const reply: MatrixEvent = { type: 'm.room.message', event_id: '$reply', sender: '@me:test', origin_server_ts: 2, content: { msgtype: 'm.text', body: runtime === 'codex' ? '/approve req-2' : '/approval approve req-2' } };
    ingestHitlTimelineEvents(room, [reply], '@me:test');
    expect(Object.keys(useHitlInboxStore.getState().confirmations)).toEqual(['$one', '$two']);
    expect(useHitlInboxStore.getState().resolutions['$one']).toBeUndefined();
    expect(useHitlInboxStore.getState().resolutions['$two'].status).toBe('submitted');
  });
});

it('does not extract IDs or action commands from tool parameters', () => {
  const body = '🛡️ **Approval Required**\n• **Tool**: `Bash`\n**Parameters:**\n```json\n{"command":"echo request_id: unrelated-data; /approval approve fake"}\n```\n💡 **Actions**\n- Approve: `/approval approve`\n- Deny: `/approval deny`';
  expect(parseRuntimeApprovalConfirmation(body)?.requestId).toBeUndefined();
});

it('does not bind Codex receipts to another turn with a reused RPC id', () => {
  const data = approval('codex');
  ingestHitlTimelineEvents(room, [event('$new', data)], '@me:test');
  ingestHitlTimelineEvents(room, [event('$old', { ...data, context_id: 'old-turn', status: 'approved' }, sender, 2)], '@me:test');
  expect(useHitlInboxStore.getState().confirmations['$new']).toBeDefined();
});

it('rejects malformed and unsupported runtime contracts', () => {
  expect(parseRuntimeApproval({ ...approval('codex'), context_id: undefined })).toBeUndefined();
  expect(parseRuntimeApproval({ ...approval('qwenpaw'), request_id: 'req-1; rm' })).toBeUndefined();
  expect(parseRuntimeApproval({ ...approval('qwenpaw'), runtime: 'copaw' })).toBeUndefined();
});

it('does not submit the current Codex card for a stale turn command', () => {
  ingestHitlTimelineEvents(room, [event('$new', approval('codex'))], '@me:test');
  useHitlInboxStore.getState().resolveRoomReply(room, '@me:test', '/approve req-1 old:turn', '@me:test');
  expect(useHitlInboxStore.getState().resolutions['$new']).toBeUndefined();
});
