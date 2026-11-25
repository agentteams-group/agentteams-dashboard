'use client';

import { Bot, Eye, UserPlus } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ResourceListMenu } from '@/components/dashboard/resource-list-menu';
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
  isDeleting,
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
  isDeleting: boolean;
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
              <button
                type="button"
                className="font-medium truncate text-left hover:underline"
                onClick={() => onView(team)}
                title="打开团队设置"
              >
                {team.name}
              </button>
            </div>
            <PhaseBadge kind="team" phase={team.phase} />
          </div>

          {isDeleting && (
            <p role="status" className="mb-3 text-xs font-medium text-amber-600 dark:text-amber-400">
              删除中，等待 Controller 完成任务
            </p>
          )}

          <div className="space-y-1.5 text-sm">
            {team.description && (
              <p className="text-muted-foreground text-xs truncate">{team.description}</p>
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
              <span className="text-muted-foreground">成员就绪</span>
              <span className="text-xs">
                {team.readyWorkers}/{team.totalWorkers}
              </span>
            </div>
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
              onOpenChange={(open) => !isDeleting && onAddWorkerPopoverChange(open)}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  title="添加 Worker"
                  aria-label={`为 ${team.name} 添加 Worker`}
                  disabled={isDeleting}
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
                          disabled={isDeleting}
                        >
                          <StatusDot phase={w.phase} />
                          <Bot className="w-3 h-3 text-emerald-500" aria-hidden="true" />
                          <span className="truncate">{w.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <ResourceListMenu label={`${team.name} 更多操作`} disabled={isDeleting} items={[
              { label: '查看拓扑', onSelect: () => onShowTopology(team) },
              { label: '编辑', onSelect: () => onEdit(team) },
              { label: '删除', onSelect: () => onDelete(team.name), destructive: true },
            ]} />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
