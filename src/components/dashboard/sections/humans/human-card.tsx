'use client';

import { Eye, Shield, Trash2, UserCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { PERMISSION_BADGE_CLASSES, PERMISSION_LABELS } from './human-types';
import type { HumanResponse } from '@/lib/agentteams-api';

function permissionLabel(h: HumanResponse): string {
  const level = h.permissionLevel || 1;
  return PERMISSION_LABELS[level] || `L${level}`;
}

export function HumanCard({
  human,
  index,
  onView,
  onDelete,
}: {
  human: HumanResponse;
  index: number;
  onView: (_human: HumanResponse) => void;
  onDelete: (_name: string) => void;
}) {
  const level = human.permissionLevel || 1;
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
              <StatusDot phase={human.phase} />
              <UserCheck className="w-5 h-5 text-teal-500 shrink-0" aria-hidden="true" />
              <span className="font-medium truncate">{human.name}</span>
            </div>
            <PhaseBadge kind="human" phase={human.phase} />
          </div>

          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">显示名称</span>
              <span className="text-xs truncate ml-2">{human.displayName}</span>
            </div>
            {human.email && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">邮箱</span>
                <span className="text-xs truncate ml-2">{human.email}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">权限</span>
              <Badge
                variant="outline"
                className={`text-xs ${PERMISSION_BADGE_CLASSES[level] || ''}`}
              >
                <Shield className="w-3 h-3 mr-1" aria-hidden="true" />
                {permissionLabel(human)}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">房间</span>
              <span className="text-xs text-muted-foreground">
                {human.rooms?.length || 0} 个
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs flex-1"
              onClick={() => onView(human)}
            >
              <Eye className="w-3 h-3 mr-1" aria-hidden="true" />
              详情
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={() => onDelete(human.name)}
              aria-label={`删除 ${human.name}`}
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
