'use client';

import { Eye, UserCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ResourceListMenu } from '@/components/dashboard/resource-list-menu';
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

const ACTION_BUTTON = 'h-8 w-8 p-0 max-sm:h-11 max-sm:w-11';

export function HumanTable({
  humans,
  onView,
  onEdit,
  onDelete,
}: {
  humans: HumanResponse[];
  onView: (_human: HumanResponse) => void;
  onEdit: (_human: HumanResponse) => void;
  onDelete: (_name: string) => void;
}) {
  return (
    <Card className="glass-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>阶段</TableHead>
            <TableHead>权限</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {humans.map((human) => {
            // CR 标尺缺省按 2（团队成员）显示，与 controller/插件默认一致
            const level = human.permissionLevel ?? 2;
            return (
              <TableRow
                key={human.name}
                className="cursor-pointer"
                onClick={() => onView(human)}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <StatusDot phase={human.phase} />
                    <UserCheck className="w-4 h-4 text-teal-500 shrink-0" aria-hidden="true" />
                    <button
                      type="button"
                      className="max-w-[180px] truncate text-left font-medium hover:underline"
                      onClick={(event) => {
                        event.stopPropagation();
                        onView(human);
                      }}
                    >
                      {human.displayName || human.name}
                    </button>
                    <span className="text-xs text-muted-foreground truncate max-w-[180px]">{human.name}</span>
                  </div>
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
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={ACTION_BUTTON}
                      onClick={() => onView(human)}
                      title="查看详情"
                      aria-label={`查看 ${human.name} 详情`}
                    >
                      <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                  <ResourceListMenu label={`${human.name} 更多操作`} items={[
                    { label: '编辑', onSelect: () => onEdit(human) },
                    { label: '删除', onSelect: () => onDelete(human.name), destructive: true },
                  ]} />
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
