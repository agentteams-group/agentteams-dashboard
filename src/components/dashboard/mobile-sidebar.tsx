'use client';

import { useMemo } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  navItems,
  navGroups,
  isNavItemVisible,
  type DeploymentMode,
  type NavGroup,
} from './nav-items';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { PluginNavItems } from '@/components/plugins/plugin-nav-items';

interface MobileSidebarProps {
  open: boolean;
  activeSection: string;
  countMap: Record<string, number>;
  sectionsWithNotifications: Set<string>;
  onNavClick: (_sectionId: string) => void;
  onClose: () => void;
  mode?: DeploymentMode | null;
}

function GroupHeader({ group }: { group: { id: NavGroup; label: string } }) {
  if (!group.label) return null;
  return (
    <div className="px-4 py-2 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
      {group.label}
    </div>
  );
}

export function MobileSidebar({
  open,
  activeSection,
  countMap,
  sectionsWithNotifications,
  onNavClick,
  onClose,
  mode,
}: MobileSidebarProps) {
  const taskBoardVisible = useAgentTeamsStore((s) => s.taskBoardVisible);
  const projectsVisible = useAgentTeamsStore((s) => s.projectsVisible);
  const visibleItems = useMemo(
    () => navItems.filter((item) => isNavItemVisible(item, mode, taskBoardVisible, projectsVisible)),
    [mode, taskBoardVisible, projectsVisible]
  );

  // Group items by their group field
  const groupedItems = navGroups.map((group) => ({
    group,
    items: visibleItems.filter((item) => item.group === group.id),
  })).filter(({ items }) => items.length > 0);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black z-40 md:hidden"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed left-0 top-0 bottom-0 w-64 bg-card border-r border-border z-50 md:hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 h-14 border-b border-border">
              <div className="flex items-center gap-2">
                <Image
                  src="/agentteams-logo.svg"
                  alt="AgentTeams"
                  width={32}
                  height={32}
                  className="rounded-lg"
                />
                <span className="font-bold text-lg">AgentTeams</span>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Scrollable nav */}
            <nav className="flex-1 overflow-y-auto custom-scrollbar py-2">
              {groupedItems.map(({ group, items }) => (
                <div key={group.id}>
                  <GroupHeader group={group} />
                  {items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeSection === item.id;
                    const count = countMap[item.id] ?? 0;
                    const hasNotification =
                      sectionsWithNotifications.has(item.id);
                    return (
                      <button
                        key={item.id}
                        onClick={() => onNavClick(item.id)}
                        data-nav-section={item.id}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm ${
                          isActive
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium'
                            : 'text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        <Icon
                          className={`w-5 h-5 ${
                            isActive ? 'text-emerald-500' : ''
                          }`}
                        />
                        <span>{item.label}</span>
                        {count > 0 && (
                          <Badge
                            variant="secondary"
                            className="ml-auto text-[10px] h-5 min-w-[20px] px-1.5"
                          >
                            {count}
                          </Badge>
                        )}
                        {hasNotification && !isActive && (
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse ml-1" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}

              {/* Plugin-contributed menu items (extension point: sidebar-menu) */}
              <PluginNavItems
                activeSection={activeSection}
                collapsed={false}
                onNavClick={onNavClick}
              />
            </nav>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
