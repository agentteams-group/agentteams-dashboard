import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ArchivedRoomsDialog, RoomArchiveAction } from './room-archive';
import { MatrixRequestError } from '@/lib/matrix-api';

const mocks = vi.hoisted(() => ({ list: vi.fn(), state: vi.fn(), change: vi.fn(), remove: vi.fn(), level: 2 }));
vi.mock('@/hooks/use-room-archive', () => ({ useArchivedRooms: mocks.list, useSetRoomArchived: () => ({ mutate: mocks.change }), useDeleteArchivedRoom: () => ({ mutate: mocks.remove }) }));
vi.mock('@/hooks/use-matrix', () => ({ useMatrixRoomState: mocks.state }));
vi.mock('@/lib/matrix-store', () => ({ useMatrixStore: (selector: (_state: { userId: string }) => unknown) => selector({ userId: '@me:test' }) }));
vi.mock('@/lib/agentteams-store', () => ({ useAgentTeamsStore: (selector: (_state: { userLevel: number }) => unknown) => selector({ userLevel: mocks.level }) }));
const room = { id: '!task:test', name: '任务', type: 'project' as const, members: [] };
function state(kind: string, role?: 'teamAdmin' | 'leaderWorker') {
  mocks.state.mockReturnValue({ data: [
    { type: 'room.meta', state_key: '', content: { roomKind: kind, ...(role && { [role]: { userId: '@me:test' } }) } },
    { type: 'm.room.power_levels', content: { users: { '@me:test': 100 } } },
  ] });
  mocks.list.mockReturnValue({ data: { rooms: [] }, isSuccess: true });
}
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); mocks.level = 2; });
describe('task room archive controls', () => {
  it.each(['dm', 'group_room', 'team_room'])('hides controls for %s even for admins', kind => {
    mocks.level = 3;
    state(kind, 'teamAdmin');
    render(<RoomArchiveAction room={room} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('does not treat room power alone as an archive role', () => {
    state('task_room');
    render(<RoomArchiveAction room={room} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('allows the task leader to archive with the artifact reminder', () => {
    state('task_room', 'leaderWorker');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<RoomArchiveAction room={room} />);
    fireEvent.click(screen.getByRole('button', { name: '归档任务房间' }));
    expect(mocks.change).toHaveBeenCalledWith({ roomId: room.id, archived: true });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('产物已同步到工作区'));
  });
  it('lets a leader restore but only offers deletion when the server grants it', () => {
    state('task_room', 'leaderWorker');
    mocks.list.mockReturnValue({ data: { rooms: [{ room_id: room.id, can_archive: true, can_delete: false }] } });
    render(<RoomArchiveAction room={{ ...room, archived: true }} />);
    fireEvent.click(screen.getByRole('button', { name: '取消归档' }));
    expect(mocks.change).toHaveBeenCalledWith({ roomId: room.id, archived: false });
    expect(screen.queryByRole('button', { name: '删除房间' })).toBeNull();
  });
  it('recognizes room version 12 creators without a users power-level entry', () => {
    state('task_room', 'leaderWorker');
    mocks.state.mockReturnValue({ data: [
      { type: 'room.meta', state_key: '', content: { roomKind: 'task_room', leaderWorker: { userId: '@me:test' } } },
      { type: 'm.room.create', sender: '@me:test', content: { room_version: '12' } },
      { type: 'm.room.power_levels', content: { users: {} } },
    ] });
    render(<RoomArchiveAction room={room} />);
    expect(screen.getByRole('button', { name: '归档任务房间' })).toBeEnabled();
  });
  it('requires confirmation before deleting an authorized archived task room', () => {
    state('task_room', 'teamAdmin');
    mocks.list.mockReturnValue({ data: { rooms: [{ room_id: room.id, can_archive: true, can_delete: true }] } });
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<RoomArchiveAction room={{ ...room, archived: true }} />);
    fireEvent.click(screen.getByRole('button', { name: '删除房间' }));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除房间' }));
    expect(mocks.remove).toHaveBeenCalledWith(room.id);
  });
  it('submits team admin and human member account filters separately', () => {
    mocks.list.mockReturnValue({ data: { rooms: [] }, isSuccess: true });
    render(<ArchivedRoomsDialog onSelectRoom={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '已归档房间' }));
    fireEvent.change(screen.getByLabelText('按账号角色查询'), { target: { value: 'team_admin' } });
    fireEvent.change(screen.getByLabelText('Matrix 账号'), { target: { value: '@admin:test' } });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    expect(mocks.list).toHaveBeenLastCalledWith({ team_admin: '@admin:test' }, true);
    fireEvent.change(screen.getByLabelText('按账号角色查询'), { target: { value: 'human_member' } });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    expect(mocks.list).toHaveBeenLastCalledWith({ human_member: '@admin:test' }, true);
  });
  it('reports an unsupported server without pretending the archive list is empty', () => {
    mocks.list.mockReturnValue({ isError: true, error: new MatrixRequestError('not found', 'M_UNRECOGNIZED', 404) });
    render(<ArchivedRoomsDialog onSelectRoom={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '已归档房间' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请升级 Matrix 服务');
  });
});
