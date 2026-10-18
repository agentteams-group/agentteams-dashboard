'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { artifactStateFromTask } from '@/lib/artifact-state';
import { ArtifactStateBadge } from '@/components/dashboard/sections/projects/artifact-state-badge';
import {
  fetchRoomState,
  latestReleaseForTask,
  parseReleaseRecords,
  sendReleaseRecord,
  type ReleaseRecord,
} from '@/lib/release-record';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';

interface ReleaseControlsProps {
  roomId?: string;
  projectId: string;
  taskId?: string;
  round?: number;
  /** 任务归一化状态/验收结论（无放行历史时推导兜底态）。 */
  taskStatus?: string;
  resultStatus?: string;
  compact?: boolean;
}

/**
 * 放行控制（PRD F3.3）：读取 `com.agentteams.release` 房间状态事件历史，
 * 显示当前工件态与放行/撤销动作（协作者及以上，附录 B：观察者只读）。
 * 动作经 BFF 写状态事件并落 release.* 审计；撤销生成新记录而非覆盖。
 */
export function ReleaseControls({
  roomId,
  projectId,
  taskId,
  round,
  taskStatus,
  resultStatus,
  compact,
}: ReleaseControlsProps) {
  const userLevel = useAgentTeamsStore((s) => s.userLevel);
  const currentUserId = useMatrixStore((s) => s.userId);
  const queryClient = useQueryClient();

  const stateQuery = useQuery({
    queryKey: ['room-release-state', roomId],
    queryFn: () => fetchRoomState(roomId!),
    enabled: Boolean(roomId),
    refetchInterval: 15000,
    staleTime: 5000,
    retry: false,
  });
  const records: ReleaseRecord[] = roomId
    ? parseReleaseRecords(stateQuery.data)
    : [];

  const canAct = Boolean(roomId) && userLevel >= 2;
  const latest = latestReleaseForTask(records, taskId);
  const released = latest?.action === 'release';
  const info = artifactStateFromTask({ status: taskStatus, result_status: resultStatus }, records, taskId);

  const act = async (action: 'release' | 'revoke') => {
    if (!roomId) return;
    try {
      await sendReleaseRecord(roomId, {
        action,
        project_id: projectId,
        ...(taskId ? { task_id: taskId } : {}),
        ...(round ? { round } : {}),
        actor: currentUserId ?? 'unknown',
      });
      await queryClient.invalidateQueries({ queryKey: ['room-release-state', roomId] });
    } catch {
      /* 失败静默：查询 15s 后自校准；操作结果以状态事件正源为准 */
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <ArtifactStateBadge info={info} />
      {released && (
        <Badge variant="outline" className="text-[10px] shrink-0" title={`放行人 ${latest?.actor ?? ''}`}>
          <CircleCheck className="h-2.5 w-2.5" aria-hidden="true" />
          v{records.filter((r) => r.action === 'release').length}
        </Badge>
      )}
      {canAct && (
        released ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => void act('revoke')}
            title="撤销放行（生成新记录，历史不覆盖）"
          >
            <RotateCcw className="h-2.5 w-2.5" aria-hidden="true" />
            撤销
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-5 px-1.5 text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
            onClick={() => void act('release')}
            title="人工放行（写入房间状态事件并落审计）"
          >
            <CircleCheck className="h-2.5 w-2.5" aria-hidden="true" />
            放行
          </Button>
        )
      )}
      {!compact && !roomId && info.state === 'released' && (
        <span className="text-[10px] text-muted-foreground" title={info.note}>
          （完成态推导）
        </span>
      )}
    </span>
  );
}
