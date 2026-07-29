'use client';

import { Eye, Trash2, UserCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { PERMISSION_BADGE_CLASSES, PERMISSION_LABELS } from './human-types';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import type { HumanResponse } from '@/lib/agentteams-api';

function permissionLabel(level: number): string {
  return PERMISSION_LABELS[level] || `L${level}`;
}

export function HumanTable({
  humans,
  onView,
  onDelete,
}: {
  humans: HumanResponse[];
  onView: (_human: HumanResponse) => void;
  onDelete: (_name: string) => void;
}) {
  return (
    <Card className="glass-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>显示名称</TableHead>
            <TableHead>阶段</TableHead>
            <TableHead>权限</TableHead>
            <TableHead>邮箱</TableHead>
            <TableHead>房间</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {humans.map((human) => {
            const level = human.permissionLevel || 1;
            return (
              <TableRow key={human.name}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <StatusDot phase={human.phase} />
                    <UserCheck className="w-4 h-4 text-teal-500 shrink-0" aria-hidden="true" />
                    <span className="font-medium truncate max-w-[180px]">{human.name}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-xs truncate max-w-[120px] block">{human.displayName}</span>
                </TableCell>
                <TableCell>
                  <PhaseBadge kind="human" phase={human.phase} />
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`text-xs ${PERMISSION_BADGE_CLASSES[level] || ''}`}
                  >
                    {permissionLabel(level)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {human.email ? (
                    <span className="text-xs truncate max-w-[150px] block">{human.email}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">
                    {human.rooms?.length || 0}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => onView(human)}
                      title="查看详情"
                      aria-label={`查看 ${human.name} 详情`}
                    >
                      <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => onDelete(human.name)}
                      title="删除"
                      aria-label={`删除 ${human.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
