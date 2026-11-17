'use client';

import { useState } from 'react';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useArchivedRooms, useRoomArchiveStatus, useSetRoomArchived, useDeleteArchivedRoom } from '@/hooks/use-room-archive';
import { useMatrixStore } from '@/lib/matrix-store';
import { MatrixRequestError, type ArchivedRoomFilters } from '@/lib/matrix-api';
import type { RoomInfo } from './room-info';

export function archiveError(error: unknown): string {
  return error instanceof MatrixRequestError && error.status === 404
    ? '当前服务尚未支持任务房间归档，请升级 Controller 和 Matrix 服务。'
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
    <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Archive className="size-4" />归档任务</Button>
    <DialogContent className="max-h-[80dvh] overflow-y-auto">
      <DialogTitle>归档任务</DialogTitle>
      <DialogDescription>保留历史消息和附件。取消归档后可继续协作。</DialogDescription>
      <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); setFilters(role === 'all' ? {} : { [role]: account.trim() || userId || '' }); }}>
        <select aria-label="按账号角色查询" value={role} onChange={event => setRole(event.target.value as typeof role)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="all">我可访问的全部</option><option value="team_admin">团队管理员</option><option value="human_member">人类成员</option>
        </select>
        {role !== 'all' && <Input className="min-w-0 flex-1 basis-40" aria-label="Matrix 账号" placeholder={userId ?? '@账号:服务器'} value={account} onChange={event => setAccount(event.target.value)} />}
        <Button type="submit" variant="secondary" size="sm" className="h-9">查询</Button>
      </form>
      {list.isLoading && <p role="status">正在加载归档任务…</p>}
      {list.isError && <div role="alert">{archiveError(list.error)}<Button variant="ghost" size="sm" onClick={() => { void list.refetch(); }}>重试</Button></div>}
      {list.isSuccess && !list.data.rooms.length && <p className="text-sm text-muted-foreground">没有符合条件的归档任务</p>}
      <div className="space-y-1">{list.data?.rooms.map(room => <Button key={room.room_id} variant="ghost" className="h-auto w-full justify-start py-3 text-left" onClick={() => { setOpen(false); onSelectRoom(room.room_id); }}>
        <Archive className="size-4 shrink-0" /><span className="min-w-0"><span className="block truncate">{room.name || '任务房间'}</span><span className="block truncate text-xs text-muted-foreground">{room.room_meta?.teamName || room.room_id}</span></span>
      </Button>)}</div>
    </DialogContent>
  </Dialog>;
}

export function CompletedTaskArchiveAction({ title, resolveRooms }: { title: string; resolveRooms: () => Promise<string[]> }) {
  const change = useSetRoomArchived();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <span className="inline-flex flex-wrap items-center gap-1" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground" aria-label={`归档任务 ${title}`} title="归档已完成任务，保留历史消息和产物" disabled={busy} onClick={async () => {
      if (!window.confirm('归档此已完成任务？历史消息和产物保留，所有成员将停止同步其任务房间。')) return;
      setBusy(true); setError(null);
      try {
        const rooms = [...new Set(await resolveRooms())];
        if (!rooms.length) throw new Error('协作房间尚未创建，无法归档');
        for (const roomId of rooms) await change.mutateAsync({ roomId, archived: true });
      } catch (error) { setError(archiveError(error)); }
      finally { setBusy(false); }
    }}><Archive className="size-3.5" />{busy ? '归档中…' : '归档'}</Button>
    {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
  </span>;
}

export function RoomArchiveAction({ room }: { room: RoomInfo }) {
  const status = useRoomArchiveStatus(room.id);
  const change = useSetRoomArchived();
  const remove = useDeleteArchivedRoom();
  if (!status.data?.is_task_room) return null;
  const { archived, can_archive: canArchive, can_delete: canDelete } = status.data;
  const busy = change.isPending || remove.isPending;
  return <div className="flex items-center gap-1">
    {archived && <span className="whitespace-nowrap text-xs text-muted-foreground">已归档<span className="hidden lg:inline"> · 只读</span></span>}
    {canArchive && <Button variant="ghost" size="sm" aria-label={archived ? '取消归档' : '归档'} title={archived ? '取消归档' : '归档'} disabled={busy} onClick={() => {
      if (!archived && !window.confirm('归档后所有成员将停止同步此任务房间。请确认任务已完成，产物已同步到工作区。')) return;
      change.mutate({ roomId: room.id, archived: !archived });
    }}>{archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}<span>{archived ? '取消归档' : '归档'}</span></Button>}
    {archived && canDelete && <Button variant="ghost" size="sm" aria-label="删除房间" title="删除房间" disabled={busy} onClick={() => {
      if (window.confirm('永久删除此归档任务房间？房间消息将无法恢复，工作区产物保留。')) remove.mutate(room.id);
    }}><Trash2 className="size-4" /><span className="hidden xl:inline">删除房间</span></Button>}
    {(change.isError || remove.isError) && <span role="alert" className="text-xs text-destructive">{archiveError(change.error || remove.error)}</span>}
  </div>;
}
