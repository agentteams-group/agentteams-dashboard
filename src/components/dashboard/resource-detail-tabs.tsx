'use client';

import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function ResourceDetailTabs({ label, items }: {
  label: string;
  items: { id: string; title: string; render: () => ReactNode }[];
}) {
  return <Tabs defaultValue={items[0]?.id} orientation="vertical" className="min-h-0 flex-1 flex-row gap-0 overflow-hidden">
    <TabsList aria-label={label} className="h-full w-28 shrink-0 flex-col items-stretch justify-start gap-1 overflow-y-auto rounded-none border-r bg-muted/20 p-2 sm:h-full sm:w-36">
      {items.map(item => <TabsTrigger key={item.id} value={item.id} className="h-auto min-h-10 flex-none justify-start whitespace-normal px-3 text-left text-xs sm:text-sm">{item.title}</TabsTrigger>)}
    </TabsList>
    {items.map(item => <TabsContent key={item.id} value={item.id} className="m-0 min-h-0 min-w-0 overflow-y-auto p-4 data-[state=inactive]:hidden">
      {item.render()}
    </TabsContent>)}
  </Tabs>;
}
