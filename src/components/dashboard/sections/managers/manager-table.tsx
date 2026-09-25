'use client';

import { Crown, Eye, Pencil, Trash2, CheckCircle2, XCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { TruncatedId } from '@/components/dashboard/truncated-id';
import { RUNTIME_LABELS } from '@/lib/phase-colors';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import type { ManagerResponse } from '@/lib/agentteams-api';
import { isLegacyCopaw } from '@/lib/runtime-options';

export function ManagerTable({
  managers,
  onView,
  onEdit,
  onUpgradeToQwenPaw,
  onDelete,
}: {
  managers: ManagerResponse[];
  onView: (_manager: ManagerResponse) => void;
  onEdit: (_manager: ManagerResponse) => void;
  onUpgradeToQwenPaw?: (_manager: ManagerResponse) => void;
  onDelete: (_name: string) => void;
}) {
  return (
    <Card className="glass-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>阶段</TableHead>
            <TableHead>模型</TableHead>
            <TableHead>运行时</TableHead>
            <TableHead>欢迎消息</TableHead>
            <TableHead>Matrix ID</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {managers.map((manager) => (
            <TableRow key={manager.name}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <StatusDot phase={manager.phase} />
                  <Crown className="w-4 h-4 text-violet-500 shrink-0" aria-hidden="true" />
                  <span className="font-medium truncate max-w-[180px]">{manager.name}</span>
                </div>
              </TableCell>
              <TableCell>
                <PhaseBadge kind="manager" phase={manager.phase} />
              </TableCell>
              <TableCell>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="font-mono text-xs truncate max-w-[150px] block cursor-help">
                      {manager.model || '-'}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>完整模型名: {manager.model || '未设置'}</TooltipContent>
                </Tooltip>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  {RUNTIME_LABELS[manager.runtime] || manager.runtime || '-'}
                </Badge>
              </TableCell>
              <TableCell>
                {manager.welcomeSent ? (
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500" aria-hidden="true" />
                    <span className="text-xs text-green-600 dark:text-green-400">已发送</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                    <span className="text-xs text-muted-foreground">未发送</span>
                  </div>
                )}
              </TableCell>
              <TableCell>
                {manager.matrixUserID ? (
                  <TruncatedId value={manager.matrixUserID} label="Matrix 用户 ID" />
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
                    onClick={() => onView(manager)}
                    title="查看详情"
                    aria-label={`查看 ${manager.name} 详情`}
                  >
                    <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                  {isLegacyCopaw(manager.runtime) && onUpgradeToQwenPaw && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => onUpgradeToQwenPaw(manager)}
                      title="升级到 QwenPaw"
                      aria-label={`升级 ${manager.name} 到 QwenPaw`}
                    >
                      升级
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => onEdit(manager)}
                    title="编辑"
                    aria-label={`编辑 ${manager.name}`}
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => onDelete(manager.name)}
                    title="删除"
                    aria-label={`删除 ${manager.name}`}
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
