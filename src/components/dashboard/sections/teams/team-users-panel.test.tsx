import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TeamUsersPanel } from './team-users-panel';
import { agentteamsApi, type TeamResponse } from '@/lib/agentteams-api';

vi.mock('@/hooks/use-agentteams-humans', () => ({ useHumans: () => ({ data: [{ name: 'alice' }, { name: 'bob' }, { name: 'carol', accessibleTeams: ['alpha', 'other'] }] }) }));
const team = { name: 'alpha', admin: { name: 'alice' }, humanMembers: [{ name: 'bob', role: 'member', matrixUserId: '@bob:matrix' }] } as TeamResponse;
function setup() {
  render(<QueryClientProvider client={new QueryClient()}><TeamUsersPanel team={team} /></QueryClientProvider>);
}
beforeEach(() => {
  vi.spyOn(agentteamsApi, 'updateTeam').mockImplementation(async (_name, data) => ({ ...team, ...data }) as TeamResponse);
  vi.spyOn(agentteamsApi, 'getHuman').mockResolvedValue({ name: 'carol', accessibleTeams: ['alpha', 'other'] } as never);
  vi.spyOn(agentteamsApi, 'updateHuman').mockResolvedValue({} as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('saves admin replacement, member promotion and inherited users without dropping Matrix identity', async () => {
  setup();
  fireEvent.change(screen.getByLabelText('Team Admin'), { target: { value: 'bob' } });
  fireEvent.change(screen.getByLabelText('bob 的角色'), { target: { value: 'coordinator' } });
  fireEvent.click(screen.getByRole('button', { name: '保存用户角色' }));
  await screen.findByText('用户角色已保存');
  expect(agentteamsApi.updateTeam).toHaveBeenCalledWith('alpha', { admin: { name: 'bob' }, humanMembers: [{ name: 'bob', role: 'coordinator', matrixUserId: '@bob:matrix' }, { name: 'carol', role: 'coordinator' }] });
  expect(screen.getByRole('button', { name: '保存用户角色' })).toBeDisabled();
});

it('adds a normal user, demotes a coordinator and clears admin with explicit null', async () => {
  setup();
  fireEvent.change(screen.getByLabelText('Team Admin'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('添加用户'), { target: { value: 'alice' } });
  fireEvent.change(screen.getByLabelText('carol 的角色'), { target: { value: 'member' } });
  fireEvent.click(screen.getByRole('button', { name: '保存用户角色' }));
  await screen.findByText('用户角色已保存');
  expect(agentteamsApi.updateTeam).toHaveBeenCalledWith('alpha', expect.objectContaining({ admin: null, humanMembers: expect.arrayContaining([{ name: 'alice', role: 'member' }, { name: 'carol', role: 'member' }]) }));
});

it('removes both explicit and accessibleTeams membership, preserving other team grants', async () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: '移除用户 bob' }));
  fireEvent.click(screen.getByRole('button', { name: '移除用户 carol' }));
  fireEvent.click(screen.getByRole('button', { name: '保存用户角色' }));
  await screen.findByText('用户角色已保存');
  expect(agentteamsApi.updateTeam).toHaveBeenCalledWith('alpha', { humanMembers: [] });
  expect(agentteamsApi.updateHuman).toHaveBeenCalledWith('carol', { accessibleTeams: ['other'] });
});

it('does not report success when an older controller silently ignores changes', async () => {
  vi.mocked(agentteamsApi.updateTeam).mockResolvedValue(team);
  setup();
  fireEvent.change(screen.getByLabelText('Team Admin'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '保存用户角色' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('服务端未应用'));
  expect(screen.queryByText('用户角色已保存')).not.toBeInTheDocument();
});
