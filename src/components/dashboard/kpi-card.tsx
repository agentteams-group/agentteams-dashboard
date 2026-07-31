'use client';

import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type KPITrend = 'up' | 'down' | 'stable' | null;

export interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: KPITrend;
  icon?: LucideIcon;
  color?: string;
  className?: string;
}

const TRENDS = {
  up: { icon: TrendingUp, color: 'text-emerald-500' },
  down: { icon: TrendingDown, color: 'text-red-500' },
  stable: { icon: Minus, color: 'text-muted-foreground' },
};

/**
 * Reusable KPI card for displaying a single metric with trend indicator.
 */
export function KpiCard({
  title,
  value,
  subtitle,
  trend,
  icon: Icon,
  color = 'text-emerald-500',
  className = '',
}: KpiCardProps) {
  const trendInfo = trend ? TRENDS[trend] : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      className={`rounded-lg border bg-card p-4 ${className}`}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{title}</p>
          <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {Icon && <Icon className={`h-5 w-5 ${color}`} />}
          {trendInfo && (
            <trendInfo.icon className={`h-4 w-4 ${trendInfo.color}`} />
          )}
        </div>
      </div>
    </motion.div>
  );
}
