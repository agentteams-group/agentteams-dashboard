'use client';

import { Bot, Eye, Pencil, Trash2, UserCheck, UserPlus } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { CopyButton } from '@/components/dashboard/copy-button';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';

export function TeamCard({
  team,
  index,
  availableWorkers,
  onAddWorkerPopoverChange,
  onView,
  onEdit,
  onDelete,
  onAddWorker,
  onShowTopology,
  isAddWorkerOpen,
}: {
  team: TeamResponse;
  index: number;
  availableWorkers: WorkerResponse[];
  onAddWorkerPopoverChange: (_open: boolean) => void;
  onView: (_team: TeamResponse) => void;
  onEdit: (_team: TeamResponse) => void;
  onDelete: (_name: string) => void;
  onAddWorker: (_teamName: string, _workerName: string) => void;
  onShowTopology: (_team: TeamResponse) => void;
  isAddWorkerOpen: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      layout
    >
      <Card className="glass-card hover-lift">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <StatusDot phase={team.phase} />
              <Bot className="w-5 h-5 text-emerald-500 shrink-0" aria-hidden="true" />
              <span className="font-medium truncate">{team.name}</span>
            </div>
            <PhaseBadge kind="team" phase={team.phase} />
          </div>

          <div className="space-y-1.5 text-sm">
            {team.description && (
              <p className="text-muted-foreground text-xs line-clamp-2">{team.description}</p>
            )}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Leader</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs truncate ml-2 cursor-help">
                    {team.leaderName || '-'}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Leader: {team.leaderName || '未指定'}</p>
                  <p>就绪状态: {team.leaderReady ? '已就绪' : '未就绪'}</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Workers</span>
              <span className="text-xs">
                {team.readyWorkers}/{team.totalWorkers}
              </span>
            </div>
            {team.teamRoomID && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">房间</span>
                <div className="flex items-center gap-1 min-w-0 ml-2">
                  <span className="font-mono text-xs truncate max-w-[60%]">
                    {team.teamRoomID}
                  </span>
                  <CopyButton text={team.teamRoomID} />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs flex-1"
              onClick={() => onView(team)}
            >
              <Eye className="w-3 h-3 mr-1" aria-hidden="true" />
              详情
            </Button>
            <Popover
              open={isAddWorkerOpen}
              onOpenChange={onAddWorkerPopoverChange}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  title="添加 Worker"
                  aria-label={`为 ${team.name} 添加 Worker`}
                >
                  <UserPlus className="w-3 h-3" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-2" align="end">
                <div className="space-y-1">
                  <p className="text-xs font-medium px-2 py-1 text-muted-foreground">
                    可添加的 Workers
                  </p>
                  {availableWorkers.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-2 py-2">
                      没有可添加的 Worker
                    </p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto">
                      {availableWorkers.map((w) => (
                        <button
                          key={w.name}
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-md hover:bg-muted/50 transition-colors text-left"
                          onClick={() => onAddWorker(team.name, w.name)}
                        >
                          <StatusDot phase={w.phase} />
                          <Bot className="w-3 h-3 text-primary" aria-hidden="true" />
                          <span className="truncate">{w.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onShowTopology(team)}
              title="查看拓扑"
              aria-label={`查看 ${team.name} 拓扑`}
            >
              <UserCheck className="w-3 h-3" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onEdit(team)}
              aria-label={`编辑 ${team.name}`}
              title="编辑"
            >
              <Pencil className="w-3 h-3" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={() => onDelete(team.name)}
              aria-label={`删除 ${team.name}`}
              title="删除"
            >
              <Trash2 className="w-3 h-3" aria-hidden="true" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
