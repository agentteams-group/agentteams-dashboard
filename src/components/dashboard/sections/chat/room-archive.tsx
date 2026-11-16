'use client';

import { useState } from 'react';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useArchivedRooms, useSetRoomArchived, useDeleteArchivedRoom } from '@/hooks/use-room-archive';
import { useMatrixRoomState } from '@/hooks/use-matrix';
import { useMatrixStore } from '@/lib/matrix-store';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { MatrixRequestError, type ArchivedRoomFilters } from '@/lib/matrix-api';
import type { RoomInfo } from './room-info';

export function archiveError(error: unknown): string {
  return error instanceof MatrixRequestError && error.status === 404
    ? '当前服务尚未支持任务房间归档，请升级 Matrix 服务。'
    : error instanceof Error ? error.message : '操作失败，请重试';
}

export function ArchivedRoomsDialog({ onSelectRoom }: { onSelectRoom: (_id: string) => void }) {
  const [open, setOpen] = useState(false);
  const userId = useMatrixStore(state => state.userId);
  const [role, setRole] = useState<'all' | 'team_admin' | 'human_member'>('all');
  const [account, setAccount] = useState('');
  const [filters, setFilters] = useState<ArchivedRoomFilters>({});
  const list = useArchivedRooms(filters, open);
  return <Dialog open={open} onOpenChange={setOpen}>
    <Button variant="ghost" size="sm" aria-label="已归档房间" title="已归档房间" onClick={() => setOpen(true)}><Archive className="size-4" /><span className="hidden xl:inline">已归档房间</span></Button>
    <DialogContent className="max-h-[80dvh] overflow-y-auto">
      <DialogTitle>已归档任务房间</DialogTitle>
      <DialogDescription>保留历史消息和附件。取消归档后可继续协作。</DialogDescription>
      <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); setFilters(role === 'all' ? {} : { [role]: account.trim() || userId || '' }); }}>
        <select aria-label="按账号角色查询" value={role} onChange={event => setRole(event.target.value as typeof role)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="all">我可访问的全部</option><option value="team_admin">团队管理员</option><option value="human_member">人类成员</option>
        </select>
        {role !== 'all' && <Input className="min-w-0 flex-1 basis-40" aria-label="Matrix 账号" placeholder={userId ?? '@账号:服务器'} value={account} onChange={event => setAccount(event.target.value)} />}
        <Button type="submit" variant="secondary" size="sm" className="h-9">查询</Button>
      </form>
      {list.isLoading && <p role="status">正在加载归档房间…</p>}
      {list.isError && <div role="alert">{archiveError(list.error)}<Button variant="ghost" size="sm" onClick={() => { void list.refetch(); }}>重试</Button></div>}
      {list.isSuccess && !list.data.rooms.length && <p className="text-sm text-muted-foreground">没有符合条件的归档任务房间</p>}
      <div className="space-y-1">{list.data?.rooms.map(room => <Button key={room.room_id} variant="ghost" className="h-auto w-full justify-start py-3 text-left" onClick={() => { setOpen(false); onSelectRoom(room.room_id); }}>
        <Archive className="size-4 shrink-0" /><span className="min-w-0"><span className="block truncate">{room.name || '任务房间'}</span><span className="block truncate text-xs text-muted-foreground">{room.room_meta?.teamName || room.room_id}</span></span>
      </Button>)}</div>
    </DialogContent>
  </Dialog>;
}

export function RoomArchiveAction({ room }: { room: RoomInfo }) {
  const state = useMatrixRoomState(room.id);
  const userId = useMatrixStore(value => value.userId);
  const userLevel = useAgentTeamsStore(value => value.userLevel);
  const list = useArchivedRooms();
  const change = useSetRoomArchived();
  const remove = useDeleteArchivedRoom();
  const archivedRoom = list.data?.rooms.find(item => item.room_id === room.id);
  const meta = state.data?.find(event => event.type === 'room.meta' && event.state_key === '')?.content;
  if (meta?.roomKind !== 'task_room' && !archivedRoom) return null;
  const archived = !!archivedRoom || !!room.archived;
  const power = state.data?.find(event => event.type === 'm.room.power_levels')?.content;
  const users = power?.users as Record<string, number> | undefined;
  const events = power?.events as Record<string, number> | undefined;
  const create = state.data?.find(event => event.type === 'm.room.create');
  const isCreator = !!userId && (create?.sender === userId || Array.isArray(create?.content.additional_creators) && create.content.additional_creators.includes(userId));
  const level = Number(create?.content.room_version ?? 1) >= 12 && isCreator ? Infinity : userId ? users?.[userId] ?? Number(power?.users_default ?? 0) : 0;
  const teamAdmin = meta?.teamAdmin as { userId?: string } | undefined;
  const leader = meta?.leaderWorker as { userId?: string } | undefined;
  const hasRole = userLevel >= 3 || !!userId && (teamAdmin?.userId === userId || leader?.userId === userId);
  const canArchive = archivedRoom?.can_archive ?? (hasRole && level >= (events?.['org.agentteams.room.archive'] ?? Number(power?.state_default ?? 50)));
  const busy = change.isPending || remove.isPending;
  return <div className="flex items-center gap-1">
    {archived && <span className="whitespace-nowrap text-xs text-muted-foreground">已归档<span className="hidden lg:inline"> · 只读</span></span>}
    {canArchive && <Button variant="ghost" size="sm" aria-label={archived ? '取消归档' : '归档任务房间'} title={archived ? '取消归档' : '归档任务房间'} disabled={busy} onClick={() => {
      if (!archived && !window.confirm('归档后所有成员将停止同步此任务房间。请确认任务已完成，产物已同步到工作区。')) return;
      change.mutate({ roomId: room.id, archived: !archived });
    }}>{archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}<span className="hidden xl:inline">{archived ? '取消归档' : '归档任务房间'}</span></Button>}
    {archived && archivedRoom?.can_delete && <Button variant="ghost" size="sm" aria-label="删除房间" title="删除房间" disabled={busy} onClick={() => {
      if (window.confirm('永久删除此归档任务房间？房间消息将无法恢复，工作区产物保留。')) remove.mutate(room.id);
    }}><Trash2 className="size-4" /><span className="hidden xl:inline">删除房间</span></Button>}
    {(change.isError || remove.isError) && <span role="alert" className="text-xs text-destructive">{archiveError(change.error || remove.error)}</span>}
  </div>;
}
