'use client';

import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  mode?: DeploymentMode | null;
}

export function MobileSidebar({ agentRooms, open, activeSection, countMap, sectionsWithNotifications, onNavClick, onClose }: MobileSidebarProps) {
  const openSettings = useAgentTeamsStore(state => state.openSettings);
  return (
    <AnimatePresence>
      {open && <>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 bg-black md:hidden" onClick={onClose} />
        <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          aria-label="移动导航" className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card md:hidden">
          <div className="flex h-16 shrink-0 items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <Image src="/agentteams-logo.svg" alt="AgentTeams" width={32} height={32} className="rounded-lg" />
              <span className="text-base font-semibold">AgentTeams</span>
            </div>
            <Button variant="ghost" size="icon" aria-label="关闭导航" onClick={onClose}><X className="size-5" /></Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
            <WorkspaceNavigation agentRooms={agentRooms} activeSection={activeSection} countMap={countMap} sectionsWithNotifications={sectionsWithNotifications} onNavClick={onNavClick} />
          </div>
          <div className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button variant="ghost" className="min-h-11 w-full justify-start" aria-label="设置" onClick={() => { onClose(); openSettings(); }}>
              <Settings className="size-4" />设置
            </Button>
          </div>
        </motion.aside>
      </>}
    </AnimatePresence>
  );
}
