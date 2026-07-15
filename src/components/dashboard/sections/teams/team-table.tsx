'use client';

import { Bot, Eye, Pencil, Trash2, UserCheck, UserPlus } from 'lucide-react';
import { Card } from '@/components/ui/card';
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
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';

export function TeamTable({
  teams,
  getAvailableFor,
  isAddWorkerOpen,
  onAddWorkerPopoverChange,
  onView,
  onEdit,
  onDelete,
  onAddWorker,
  onShowTopology,
}: {
  teams: TeamResponse[];
  getAvailableFor: (_teamName: string, _currentWorkerNames: string[]) => WorkerResponse[];
  isAddWorkerOpen: (_teamName: string) => boolean;
  onAddWorkerPopoverChange: (_teamName: string, _open: boolean) => void;
  onView: (_team: TeamResponse) => void;
  onEdit: (_team: TeamResponse) => void;
  onDelete: (_name: string) => void;
  onAddWorker: (_teamName: string, _workerName: string) => void;
  onShowTopology: (_team: TeamResponse) => void;
}) {
  return (
    <Card className="glass-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>阶段</TableHead>
            <TableHead>Leader</TableHead>
            <TableHead>Workers</TableHead>
            <TableHead>房间</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {teams.map((team) => (
            <TableRow key={team.name}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <StatusDot phase={team.phase} />
                  <Bot className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden="true" />
                  <span className="font-medium truncate max-w-[180px]">{team.name}</span>
                </div>
              </TableCell>
              <TableCell>
                <PhaseBadge kind="team" phase={team.phase} />
              </TableCell>
              <TableCell>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs truncate max-w-[120px] block cursor-help">
                      {team.leaderName || '-'}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Leader: {team.leaderName || '未指定'}</p>
                    <p>就绪: {team.leaderReady ? '是' : '否'}</p>
                  </TooltipContent>
                </Tooltip>
              </TableCell>
              <TableCell>
                <span className="text-xs">
                  {team.readyWorkers}/{team.totalWorkers}
                </span>
              </TableCell>
              <TableCell>
                {team.teamRoomID ? (
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-xs truncate max-w-[120px]">
                      {team.teamRoomID}
                    </span>
                    <CopyButton text={team.teamRoomID} />
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => onView(team)}
                    title="查看详情"
                    aria-label={`查看 ${team.name} 详情`}
                  >
                    <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                  <Popover
                    open={isAddWorkerOpen(team.name)}
                    onOpenChange={(open) => onAddWorkerPopoverChange(team.name, open)}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        title="添加 Worker"
                        aria-label={`为 ${team.name} 添加 Worker`}
                      >
                        <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-2" align="end">
                      <div className="space-y-1">
                        <p className="text-xs font-medium px-2 py-1 text-muted-foreground">
                          可添加的 Workers
                        </p>
                        {getAvailableFor(team.name, team.workerNames || []).length === 0 ? (
                          <p className="text-xs text-muted-foreground px-2 py-2">
                            没有可添加的 Worker
                          </p>
                        ) : (
                          <div className="max-h-40 overflow-y-auto">
                            {getAvailableFor(team.name, team.workerNames || []).map((w) => (
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
                    className="h-7 w-7 p-0"
                    onClick={() => onShowTopology(team)}
                    title="查看拓扑"
                    aria-label={`查看 ${team.name} 拓扑`}
                  >
                    <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => onEdit(team)}
                    title="编辑"
                    aria-label={`编辑 ${team.name}`}
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => onDelete(team.name)}
                    title="删除"
                    aria-label={`删除 ${team.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
