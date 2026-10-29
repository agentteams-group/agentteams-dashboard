'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FilesBrowserPanel } from '../views/worker-files-panel';
import type { TeamResponse } from '@/lib/agentteams-api';

export interface WorkerFileOption {
  userId: string;
  workerName: string;
  label: string;
}

interface FilesPanelProps {
  team?: TeamResponse;
  workerOptions: WorkerFileOption[];
  effectiveSelectedWorker: string | null;
  selectedIsTeamShared: boolean;
  onSelectWorker: (_worker: string | null) => void;
}

/** 房间文件 body：数据 = Controller 团队共享空间 / Worker 私有空间。 */
export function FilesPanel({
  team,
  workerOptions,
  effectiveSelectedWorker,
  selectedIsTeamShared,
  onSelectWorker,
}: FilesPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="shrink-0 px-3 pt-2 text-xs font-semibold tracking-wide text-muted-foreground">
        工作目录
      </p>
      {team && (
        <div className="shrink-0 border-b border-border px-3 pb-2 pt-1">
          <p className="text-xs leading-relaxed text-muted-foreground">
            当前任务文件存放在「{team.teamName} 的团队共享空间」(teams/{team.name}/shared/)
          </p>
        </div>
      )}
      <div className="shrink-0 border-b border-border p-2">
        <Select
          value={effectiveSelectedWorker || ''}
          onValueChange={(v) => onSelectWorker(v || null)}
        >
          <SelectTrigger className="h-7 w-full text-xs" aria-label="选择 Worker">
            <SelectValue placeholder={workerOptions.length === 0 ? '暂无可用的 Worker' : '选择 Worker'} />
          </SelectTrigger>
          <SelectContent>
            {workerOptions.map((w) => (
              <SelectItem key={w.userId} value={w.workerName}>{w.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {effectiveSelectedWorker ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          {/* key resets prefix/selection when the target changes */}
          <FilesBrowserPanel
            key={effectiveSelectedWorker}
            kind={selectedIsTeamShared ? 'team' : 'worker'}
            ownerName={selectedIsTeamShared ? (team?.name ?? '') : effectiveSelectedWorker}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-center text-xs text-muted-foreground">
            {workerOptions.length === 0
              ? team
                ? '团队暂无已注册的 Worker'
                : '当前房间没有 AgentTeams Worker 成员'
              : '选择一个目标查看文件'}
          </p>
        </div>
      )}
    </div>
  );
}
