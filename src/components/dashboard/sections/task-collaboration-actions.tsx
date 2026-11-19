'use client';

import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatRoomAccess } from '@/hooks/use-chat-room-access';
import type { BoardTask } from '@/hooks/use-task-board';
import { apiUrl, requestJson } from '@/lib/api-base';
import { openChatRoom } from '@/lib/open-chat-room';
import { subtasksOf } from '@/lib/task-hierarchy';

export function TaskCollaborationActions({ task, tasks, compact = false, children: actions }: {
  task: BoardTask;
  tasks: BoardTask[];
  compact?: boolean;
  children?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const access = useChatRoomAccess();
  const children = subtasksOf(task, tasks);
  const executionTask = children.find(child => child.executionRoomId) ?? children.find(child => child.status !== 'pending') ?? task;
  const awaitingDispatch = executionTask.status === 'pending' && !executionTask.executionRoomId;
  const unavailableReason = '任务尚未派发，协作房间未创建';
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function enterCollaboration() {
    setOpening(true);
    setError(null);
    try {
      // Older Controllers expose the execution room only through task meta.
      const meta = executionTask.executionRoomId ? undefined : await queryClient.fetchQuery({
        queryKey: ['task-detail', executionTask.runId, executionTask.teamId],
        queryFn: () => requestJson<{ room_id?: string }>(apiUrl(`/api/agentteams/tasks/${encodeURIComponent(executionTask.runId)}/meta${executionTask.teamId ? `?team=${encodeURIComponent(executionTask.teamId)}` : ''}`)),
        staleTime: 15000,
      });
      const roomId = (executionTask.executionRoomId || meta?.room_id)?.replace(/^room:/, '');
      if (!roomId) setError('协作房间尚未创建');
      else if (access.state !== 'joined' || !access.joinedRooms?.includes(roomId)) setError('尚未加入协作房间，请联系团队管理员');
      else openChatRoom(roomId, task.runId);
    } catch {
      setError('协作房间暂时无法读取，请稍后重试');
    } finally {
      setOpening(false);
    }
  }
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex" title={awaitingDispatch ? unavailableReason : undefined} onClick={event => event.stopPropagation()}>
      <Button variant={compact ? 'ghost' : 'outline'} size={compact ? 'icon' : 'sm'} className={compact ? 'size-8 text-muted-foreground' : 'text-xs'} aria-label="进入协作房间" disabled={awaitingDispatch || opening || access.state !== 'joined'}
        title={awaitingDispatch ? unavailableReason : access.state !== 'joined' ? '请先登录对话并等待房间权限同步' : '进入该任务的执行协作房间'}
        onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); void enterCollaboration(); }}>
        {opening ? <Loader2 className="size-3.5 animate-spin" /> : <MessageSquare className="size-3.5" />}{!compact && '进入协作房间'}
      </Button>
      </span>
      {actions}
    </div>
    {!compact && awaitingDispatch && <p role="status" className="text-xs text-muted-foreground">{unavailableReason}</p>}
    {error && <p role="status" className="text-xs text-muted-foreground">{error}</p>}
  </div>;
}
