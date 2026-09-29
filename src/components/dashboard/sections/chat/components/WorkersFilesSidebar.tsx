'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { PanelRightClose } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FilesBrowserPanel } from '../views/worker-files-panel';
import type { TeamResponse } from '@/lib/agentteams-api';

export interface WorkerFileOption {
  userId: string;
  workerName: string;
  label: string;
}

interface WorkersFilesSidebarProps {
  team?: TeamResponse;
  workerOptions: WorkerFileOption[];
  effectiveSelectedWorker: string | null;
  selectedIsTeamShared: boolean;
  workerPaneWidth: number;
  onPaneWidthChange: Dispatch<SetStateAction<number>>;
  onResizeStart: () => void;
  onClose: () => void;
  onSelectWorker: (_worker: string | null) => void;
}

export function WorkersFilesSidebar({
  team,
  workerOptions,
  effectiveSelectedWorker,
  selectedIsTeamShared,
  workerPaneWidth,
  onPaneWidthChange,
  onResizeStart,
  onClose,
  onSelectWorker,
}: WorkersFilesSidebarProps) {
  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={256}
        aria-valuemax={600}
        aria-valuenow={Math.round(workerPaneWidth)}
        tabIndex={0}
        className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/60 focus:bg-primary/60 focus:outline-none max-md:hidden"
        onPointerDown={(event) => {
          event.preventDefault();
          onResizeStart();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const step = event.shiftKey ? 32 : 8;
          // Pane is on the right: ArrowLeft drags the edge left (wider).
          const delta = event.key === 'ArrowLeft' ? step : -step;
          onPaneWidthChange((w) => Math.min(600, Math.max(256, w + delta)));
        }}
      />
      <div
        className="shrink-0 border-l border-border bg-card overflow-hidden flex flex-col
          max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-30 max-md:shadow-xl max-md:max-w-[85vw]"
        style={{ width: workerPaneWidth }}
      >
        <div className="px-3 py-2.5 border-b border-border shrink-0 flex items-center justify-between">
          <h4 className="font-semibold text-xs">工作目录</h4>
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={onClose}>
            <PanelRightClose className="w-3 h-3" />
          </Button>
        </div>
        {team && (
          <div className="px-3 pt-2 pb-1 border-b border-border shrink-0">
            <p className="text-[10px] leading-none text-muted-foreground">
              当前任务文件存放在「{team.teamName} 的团队共享空间」(teams/{team.name}/shared/)
            </p>
          </div>
        )}
        <div className="p-2 border-b border-border">
          <Select
            value={effectiveSelectedWorker || ''}
            onValueChange={(v) => onSelectWorker(v || null)}
          >
            <SelectTrigger className="w-full h-7 text-xs" aria-label="选择 Worker">
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
          <div className="flex-1 overflow-hidden">
            {/* key resets prefix/selection when the target changes */}
            <FilesBrowserPanel
              key={effectiveSelectedWorker}
              kind={selectedIsTeamShared ? 'team' : 'worker'}
              ownerName={selectedIsTeamShared ? (team?.name ?? '') : effectiveSelectedWorker}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-4">
            <p className="text-xs text-muted-foreground text-center">
              {workerOptions.length === 0
                ? team
                  ? '团队暂无已注册的 Worker'
                  : '当前房间没有 AgentTeams Worker 成员'
                : '选择一个目标查看文件'}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
