'use client';

import { useState } from 'react';
import { Layers } from 'lucide-react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { statusBadgeClass } from '@/lib/status-tokens';
import {
  MATRIX_CAPABILITY_PRESENTATION,
  listMatrixCapabilities,
} from '@/lib/matrix-capabilities';
import { cn } from '@/lib/utils';

/**
 * 「服务端能力」弹层（方案 v3 B-6）。
 *
 * 放在会话侧栏底部、与同步状态位并排：那一行是本面板里唯一常驻的 Matrix 连接
 * 说明位（ChatSection 的 sessionFooter），运营者怀疑「为什么点不动」时眼睛本来
 * 就在那儿。它回答的不是「连接好不好」（那是 SyncStatusChip），而是「这个
 * homeserver + 这个控制台组合到底能用到哪些会话能力，不能用是谁的限制」。
 *
 * 清单直接读 `matrix-capabilities` 里已有的状态（含全文检索的实测结论），不发
 * 任何请求；这也让折叠时的「几项受限」计数有东西可算。
 */
export function ServerCapabilityPopover() {
  const [open, setOpen] = useState(false);
  const rows = listMatrixCapabilities();
  const degradedCount = rows.filter((row) => row.state !== 'supported').length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-7 select-none items-center gap-1.5 rounded-md border border-border px-2',
            'text-xs text-muted-foreground transition-colors',
            'hover:bg-accent hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            open && 'bg-accent text-foreground',
          )}
          aria-label={`服务端能力（${degradedCount} 项受限）`}
        >
          <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          能力
          {/* 有受限项才带计数：全绿时不该占位。 */}
          {degradedCount > 0 && (
            <span className={cn('rounded-full px-1 text-xs font-semibold', statusBadgeClass('waiting'))}>
              {degradedCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-3">
        <p className="text-sm font-semibold">会话能力</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          这一栏说的是本控制台与这个 homeserver 的组合实际能用到什么；「本控制台不支持」是这里的实现缺口，不用去翻服务端配置。
        </p>
        <ul className="mt-2 space-y-2">
          {rows.map((row) => {
            const presentation = MATRIX_CAPABILITY_PRESENTATION[row.state];
            return (
              <li key={row.key} className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
                  <Badge variant="outline" className={cn('shrink-0 text-xs', statusBadgeClass(presentation.token))}>
                    {presentation.label}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{row.detail}</p>
                {row.probe && (
                  <p className="mt-0.5 text-xs text-muted-foreground">最近一次实测：{row.probe.atText}</p>
                )}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
