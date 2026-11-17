'use client';

import { Eye, Pencil, Shield, UserCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { PERMISSION_BADGE_CLASSES, PERMISSION_LABELS } from './human-types';
import type { HumanResponse } from '@/lib/agentteams-api';

function permissionLabel(h: HumanResponse): string {
  const level = h.permissionLevel ?? 2;
  return PERMISSION_LABELS[level] || `L${level}`;
}

export function HumanCard({
  human,
  index,
  onView,
  onEdit,
}: {
  human: HumanResponse;
  index: number;
  onView: (_human: HumanResponse) => void;
  onEdit: (_human: HumanResponse) => void;
}) {
  const level = human.permissionLevel ?? 2;
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      layout
    >
      <Card
        className="glass-card hover-lift cursor-pointer"
        data-testid="human-card"
        role="group"
        tabIndex={0}
        aria-label={`打开 ${human.name} 详情`}
        onClick={() => onView(human)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onView(human);
        }}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <StatusDot phase={human.phase} />
              <UserCheck className="w-5 h-5 text-teal-500 shrink-0" aria-hidden="true" />
              <span className="truncate font-medium">{human.displayName || human.name}</span>
            </div>
            <PhaseBadge kind="human" phase={human.phase} />
          </div>

          <div className="space-y-1.5 text-sm">
            {human.displayName && human.displayName !== human.name && (
              <p className="truncate text-xs text-muted-foreground" title={human.name}>{human.name}</p>
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
          </div>

          <div
            className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border"
            onClick={(event) => event.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="sm"
              className="h-9 flex-1 text-xs max-sm:h-11"
              onClick={() => onView(human)}
            >
              <Eye className="w-3 h-3 mr-1" aria-hidden="true" />
              详情
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 flex-1 text-xs max-sm:h-11"
              onClick={() => onEdit(human)}
            >
              <Pencil className="w-3 h-3 mr-1" aria-hidden="true" />
              编辑
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
