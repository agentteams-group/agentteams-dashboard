'use client';

import { Crown, Eye, Pencil, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { CheckCircle2, XCircle } from 'lucide-react';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge, RuntimeBadge } from '@/components/dashboard/phase-badge';
import { TruncatedId } from '@/components/dashboard/truncated-id';
import type { ManagerResponse } from '@/lib/agentteams-api';
import { isLegacyCopaw } from '@/lib/runtime-options';

export function ManagerCard({
  manager,
  index,
  onView,
  onEdit,
  onUpgradeToQwenPaw,
  onDelete,
}: {
  manager: ManagerResponse;
  index: number;
  onView: (_manager: ManagerResponse) => void;
  onEdit: (_manager: ManagerResponse) => void;
  onUpgradeToQwenPaw?: (_manager: ManagerResponse) => void;
  onDelete: (_name: string) => void;
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
              <StatusDot phase={manager.phase} />
              <Crown className="w-5 h-5 text-violet-500 shrink-0" aria-hidden="true" />
              <span className="font-medium truncate">{manager.name}</span>
            </div>
            <PhaseBadge kind="manager" phase={manager.phase} />
          </div>

          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">模型</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="font-mono text-xs font-semibold truncate ml-2 cursor-help text-foreground">
                    {manager.model || '-'}
                  </span>
                </TooltipTrigger>
                <TooltipContent>完整模型名: {manager.model || '未设置'}</TooltipContent>
              </Tooltip>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">运行时</span>
              <RuntimeBadge runtime={manager.runtime || ''} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">欢迎消息</span>
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
            </div>
            {manager.matrixUserID && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Matrix ID</span>
                <TruncatedId value={manager.matrixUserID} label="Matrix 用户 ID" />
              </div>
            )}
            {manager.roomID && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">房间 ID</span>
                <TruncatedId value={manager.roomID} label="房间 ID" />
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs flex-1"
              onClick={() => onView(manager)}
            >
              <Eye className="w-3 h-3 mr-1" aria-hidden="true" />
              详情
            </Button>
            {isLegacyCopaw(manager.runtime) && onUpgradeToQwenPaw && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onUpgradeToQwenPaw(manager)}
                aria-label={`升级 ${manager.name} 到 QwenPaw`}
                title="升级到 QwenPaw"
              >
                升级
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onEdit(manager)}
              aria-label={`编辑 ${manager.name}`}
              title="编辑"
            >
              <Pencil className="w-3 h-3" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={() => onDelete(manager.name)}
              aria-label={`删除 ${manager.name}`}
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
