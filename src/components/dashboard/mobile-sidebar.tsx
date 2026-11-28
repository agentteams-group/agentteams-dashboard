'use client';

import Image from 'next/image';
import type { RefObject } from 'react';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { WorkspaceNavigation } from './workspace-navigation';
import type { DeploymentMode } from './nav-items';
import type { RoomInfo } from './sections/chat/room-info';

interface MobileSidebarProps {
  agentRooms?: RoomInfo[];
  open: boolean;
  activeSection: string;
  countMap: Record<string, number>;
  sectionsWithNotifications: Set<string>;
  onNavClick: (_sectionId: string) => void;
  onClose: () => void;
  onOpenChange?: (_open: boolean) => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  mode?: DeploymentMode | null;
}

export function MobileSidebar({
  agentRooms,
  open,
  activeSection,
  countMap,
  sectionsWithNotifications,
  onNavClick,
  onClose,
  onOpenChange = (nextOpen) => { if (!nextOpen) onClose(); },
  triggerRef,
  mode,
}: MobileSidebarProps) {
  const openSettings = useAgentTeamsStore(state => state.openSettings);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        id="mobile-navigation"
        aria-modal="true"
        aria-describedby="mobile-navigation-description"
        className="w-64 max-w-[85vw] gap-0 bg-card p-0 md:hidden"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef?.current?.focus();
        }}
      >
        <SheetHeader className="h-16 shrink-0 flex-row items-center justify-between gap-2 border-b p-4 pr-12">
          <div className="flex items-center gap-2">
            <Image src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/agentteams-logo.svg`} alt="AgentTeams" width={32} height={32} className="rounded-lg" />
            <SheetTitle>AgentTeams 导航</SheetTitle>
          </div>
        </SheetHeader>
        <SheetDescription id="mobile-navigation-description" className="sr-only">
          选择要前往的工作区页面，或打开设置。
        </SheetDescription>
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          <WorkspaceNavigation
            mode={mode}
            agentRooms={agentRooms}
            activeSection={activeSection}
            countMap={countMap}
            sectionsWithNotifications={sectionsWithNotifications}
            onNavClick={onNavClick}
          />
        </div>
        <div className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button
            variant="ghost"
            className="min-h-11 w-full justify-start"
            aria-label="设置"
            onClick={() => { onClose(); openSettings(); }}
          >
            <Settings className="size-4" aria-hidden="true" />设置
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
