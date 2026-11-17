'use client';

import { useEffect, useRef, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { RoomTasksPanel } from './RoomTasksPanel';

export function TaskTopologyPopover({ roomId }: { roomId: string }) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const enter = () => { clear(); timer.current = setTimeout(() => setOpen(true), 250); };
  const leave = () => { clear(); if (!pinned.current) timer.current = setTimeout(() => setOpen(false), 200); };

  return <Popover open={open} onOpenChange={value => { clear(); pinned.current = false; setOpen(value); }}>
    <PopoverAnchor asChild>
      <Button variant={open ? 'secondary' : 'ghost'} size="sm" className="h-8 gap-1.5 px-2 text-sm" aria-label="任务拓扑" aria-haspopup="dialog" aria-expanded={open}
        onPointerEnter={enter} onPointerLeave={leave} onClick={() => { clear(); const next = !pinned.current; pinned.current = next; setOpen(next); }}>
        <GitBranch className="size-4" />任务拓扑
      </Button>
    </PopoverAnchor>
    <PopoverContent role="dialog" aria-label="任务拓扑预览" align="end" side="bottom" sideOffset={8} className="w-[min(90vw,52rem)] max-h-[min(70vh,32rem)] overflow-auto rounded-xl border-border/70 p-0 shadow-lg" onPointerEnter={clear} onPointerLeave={leave} onOpenAutoFocus={event => event.preventDefault()}>
      <RoomTasksPanel roomId={roomId} />
    </PopoverContent>
  </Popover>;
}
