'use client';

import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export function ResourceListMenu({ label, disabled, items }: {
  label: string;
  disabled?: boolean;
  items: { label: string; onSelect: () => void; disabled?: boolean; destructive?: boolean }[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9 px-2 text-xs max-sm:h-11"
          aria-label={label} disabled={disabled} onClick={(event) => event.stopPropagation()}>
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          更多
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        {items.map((item) => (
          <DropdownMenuItem key={item.label} onSelect={item.onSelect} disabled={item.disabled}
            variant={item.destructive ? 'destructive' : 'default'}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
