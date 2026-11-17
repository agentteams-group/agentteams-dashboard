import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ArchivedRoomsDialog, CompletedTaskArchiveAction, RoomArchiveAction } from './room-archive';
import { MatrixRequestError } from '@/lib/matrix-api';
const mocks = vi.hoisted(() => ({ list: vi.fn(), status: vi.fn(), change: vi.fn(), remove: vi.fn() }));
vi.mock('@/hooks/use-room-archive', () => ({ useArchivedRooms: mocks.list, useRoomArchiveStatus: mocks.status, useSetRoomArchived: () => ({ mutate: mocks.change, mutateAsync: mocks.change }), useDeleteArchivedRoom: () => ({ mutate: mocks.remove }) }));
vi.mock('@/lib/matrix-store', () => ({ useMatrixStore: (selector: (_state: { userId: string }) => unknown) => selector({ userId: '@me:test' }) }));
const room = { id: '!task:test', name: '任务', type: 'project' as const, members: [] };
function status(archived = false, canArchive = false, canDelete = false) {
  mocks.status.mockReturnValue({ data: { is_task_room: true, archived, can_archive: canArchive, can_delete: canDelete } });
}
beforeEach(() => { mocks.list.mockReturnValue({ data: { rooms: [] }, isSuccess: true }); status(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
describe('Controller-authorized task room controls', () => {
  it('archives every execution room of a completed task without opening chat', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CompletedTaskArchiveAction title="示例任务" resolveRooms={async () => ['!one:test', '!two:test', '!one:test']} />);
    fireEvent.click(screen.getByRole('button', { name: '归档任务 示例任务' }));
    await vi.waitFor(() => expect(mocks.change).toHaveBeenCalledTimes(2));
    expect(mocks.change).toHaveBeenCalledWith({ roomId: '!one:test', archived: true });
    expect(mocks.change).toHaveBeenCalledWith({ roomId: '!two:test', archived: true });
  });
  it('hides all lifecycle actions for an ineligible room', () => {
    mocks.status.mockReturnValue({ data: { is_task_room: false } });
    render(<RoomArchiveAction room={room} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('uses Controller capabilities rather than client role or room metadata guesses', () => {
    status(false, false, false);
    render(<RoomArchiveAction room={room} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('archives an authorized task with the artifact reminder', () => {
    status(false, true, false);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<RoomArchiveAction room={room} />);
    fireEvent.click(screen.getByRole('button', { name: '归档' }));
    expect(mocks.change).toHaveBeenCalledWith({ roomId: room.id, archived: true });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('产物已同步到工作区'));
  });
  it('lets an authorized Leader restore without offering deletion', () => {
    status(true, true, false);
    render(<RoomArchiveAction room={{ ...room, archived: true }} />);
    fireEvent.click(screen.getByRole('button', { name: '取消归档' }));
    expect(mocks.change).toHaveBeenCalledWith({ roomId: room.id, archived: false });
    expect(screen.queryByRole('button', { name: '删除房间' })).toBeNull();
  });
  it('requires confirmation before deleting a task authorized by Controller', () => {
    status(true, true, true);
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<RoomArchiveAction room={{ ...room, archived: true }} />);
    fireEvent.click(screen.getByRole('button', { name: '删除房间' }));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除房间' }));
    expect(mocks.remove).toHaveBeenCalledWith(room.id);
  });
  it('submits team admin and human member account filters separately', () => {
    render(<ArchivedRoomsDialog onSelectRoom={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '归档任务' }));
    expect(screen.getByRole('heading', { name: '归档任务' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('按账号角色查询'), { target: { value: 'team_admin' } });
    fireEvent.change(screen.getByLabelText('Matrix 账号'), { target: { value: '@admin:test' } });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    expect(mocks.list).toHaveBeenLastCalledWith({ team_admin: '@admin:test' }, true);
    fireEvent.change(screen.getByLabelText('按账号角色查询'), { target: { value: 'human_member' } });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    expect(mocks.list).toHaveBeenLastCalledWith({ human_member: '@admin:test' }, true);
  });
  it('reports an unsupported deployment without pretending the list is empty', () => {
    mocks.list.mockReturnValue({ isError: true, error: new MatrixRequestError('not found', 'M_UNRECOGNIZED', 404) });
    render(<ArchivedRoomsDialog onSelectRoom={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '归档任务' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请升级 Controller 和 Matrix 服务');
  });
});
