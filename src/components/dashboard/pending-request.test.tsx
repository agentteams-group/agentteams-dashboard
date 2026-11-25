import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PendingRequest } from './pending-request';
import { useMatrixStore } from '@/lib/matrix-store';
import { useHitlInboxStore, type HitlConfirmation } from '@/lib/hitl-inbox';

const mocks = vi.hoisted(() => ({ send: vi.fn(), event: vi.fn() }));
vi.mock('@/hooks/use-matrix', () => ({ useMatrixSendMessage: () => ({ mutateAsync: mocks.send }) }));
vi.mock('@/lib/matrix-api', () => ({ matrixApi: { getRoomEvent: mocks.event } }));
const item: HitlConfirmation = { id: 'cfm', roomId: '!target:test', eventId: '$request', sender: '@agent:test', toolName: 'Bash', approveReply: '/approve', rejectReply: '拒绝', timestamp: Date.now() };
beforeEach(() => {
  vi.resetAllMocks();
  useMatrixStore.setState({ homeserver: 'http://matrix.test', accessToken: 'test', userId: '@human:test' });
  useHitlInboxStore.setState({ confirmations: { cfm: item }, resolutions: {} });
  mocks.event.mockResolvedValue({ type: 'm.room.message', sender: item.sender, event_id: item.eventId, content: { body: 'approval', 'org.agentteams.run': { version: '1', blocks: [{ type: 'confirmation', tool_name: 'Bash', confirmation_id: 'cfm' }] } } });
});
afterEach(cleanup);
function view() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PendingRequest item={item}><span>原消息</span></PendingRequest></QueryClientProvider>); }

it('sends an inline decision to the exact request room and event', async () => {
  mocks.send.mockResolvedValue({ event_id: '$reply' });
  view();
  fireEvent.click(screen.getByRole('button', { name: '处理审批' }));
  fireEvent.click(await screen.findByRole('button', { name: '批准本次' }));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ roomId: '!target:test', mentions: { user_ids: ['@agent:test'] }, relatesTo: { rel_type: 'm.reference', event_id: '$request' }, extra: { 'com.agentteams.answer': expect.objectContaining({ confirmation_id: 'cfm', actor: '@human:test' }) } })));
});

it('retains a failed decision so it can be retried', async () => {
  mocks.send.mockRejectedValue(new Error('offline'));
  view();
  fireEvent.click(screen.getByRole('button', { name: '处理审批' }));
  fireEvent.click(await screen.findByRole('button', { name: '批准本次' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(useHitlInboxStore.getState().confirmations.cfm).toBeDefined();
});
