import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { agentteamsApi, type HumanResponse } from '@/lib/agentteams-api';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HumanDetailDialog } from './human-detail-dialog';

const summary: HumanResponse = {
  name: 'alice', displayName: 'Alice', phase: 'Active', permissionLevel: 2,
  matrixUserID: '@alice:owned.test', initialPassword: '', rooms: [], message: '',
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('loads the individual record when list responses omit the credential and drops it on close', async () => {
  const getHuman = vi.spyOn(agentteamsApi, 'getHuman').mockResolvedValue({ ...summary, initialPassword: 'owned-detail-fixture' });
  const client = new QueryClient();
  const view = (human: HumanResponse | null) => (
    <QueryClientProvider client={client}>
      <TooltipProvider><HumanDetailDialog human={human} onOpenChange={() => {}} /></TooltipProvider>
    </QueryClientProvider>
  );
  const rendered = render(view(summary));
  expect(await screen.findByText('owned-detail-fixture')).toBeInTheDocument();
  expect(getHuman).toHaveBeenCalledWith('alice');
  rendered.rerender(view(null));
  await waitFor(() => expect(client.getQueryData(['agentteams-human-detail', 'alice'])).toBeUndefined());
  client.clear();
});

it('reports a denied detail read without exposing a credential from another request', async () => {
  vi.spyOn(agentteamsApi, 'getHuman').mockRejectedValue(new Error('forbidden'));
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><TooltipProvider>
    <HumanDetailDialog human={summary} onOpenChange={() => {}} />
  </TooltipProvider></QueryClientProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('详情加载失败');
  expect(screen.queryByText('owned-detail-fixture')).not.toBeInTheDocument();
  client.clear();
});
