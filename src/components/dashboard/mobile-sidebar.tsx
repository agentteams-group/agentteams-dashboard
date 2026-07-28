'use client';

import { useMemo, useCallback } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  navItems,
  navGroups,
  isNavItemVisible,
  getGroupItems,
  isGroupVisible,
  type DeploymentMode,
} from './nav-items';

interface MobileSidebarProps {
  open: boolean;
  activeSection: string;
  countMap: Record<string, number>;
  sectionsWithNotifications: Set<string>;
  onNavClick: (_sectionId: string) => void;
  onClose: () => void;
  expandedGroups: Set<string>;
  onToggleGroup: (_groupId: string, _ctrlKey: boolean) => void;
  mode?: DeploymentMode | null;
}

export function MobileSidebar({
  open,
  activeSection,
  countMap,
  sectionsWithNotifications,
  onNavClick,
  onClose,
  expandedGroups,
  onToggleGroup,
  mode,
}: MobileSidebarProps) {
  const visibleGroups = useMemo(
    () => navGroups.filter((g) => isGroupVisible(g.id, navItems, mode)),
    [mode]
  );

  const persistentItems = useMemo(
    () =>
      navItems.filter(
        (item) => !item.group && isNavItemVisible(item, mode)
      ),
    [mode]
  );

  const makeToggleHandler = useCallback(
    (groupId: string) =>
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onToggleGroup(groupId, e.ctrlKey || e.metaKey);
      },
    [onToggleGroup]
  );

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
                  src="/logo.jpg"
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
              {visibleGroups.map((group) => {
                const groupItems = getGroupItems(group.id, navItems, mode);
                const GroupIcon = group.icon;
                const expanded = expandedGroups.has(group.id);
                const isActiveInGroup = groupItems.some(
                  (item) => item.id === activeSection
                );
                const groupCount = groupItems.reduce(
                  (sum, item) => sum + (countMap[item.id] ?? 0),
                  0
                );
                const hasGroupNotification = groupItems.some((item) =>
                  sectionsWithNotifications.has(item.id)
                );

                return (
                  <div key={group.id}>
                    <button
                      onClick={makeToggleHandler(group.id)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm ${
                        isActiveInGroup
                          ? 'text-foreground font-semibold'
                          : 'text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      <GroupIcon
                        className={`w-5 h-5 ${
                          isActiveInGroup ? 'text-emerald-500' : ''
                        }`}
                      />
                      <span className="flex-1 truncate text-left">
                        {group.label}
                      </span>
                      {groupCount > 0 && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] h-5 min-w-[20px] px-1.5"
                        >
                          {groupCount}
                        </Badge>
                      )}
                      {hasGroupNotification && !isActiveInGroup && (
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      )}
                      <ChevronDown
                        className={`w-4 h-4 transition-transform duration-200 ${
                          expanded ? '' : '-rotate-90'
                        }`}
                      />
                    </button>

                    <AnimatePresence initial={false}>
                      {expanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="overflow-hidden"
                        >
                          {groupItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = activeSection === item.id;
                            const count = countMap[item.id] ?? 0;
                            const hasNotification =
                              sectionsWithNotifications.has(item.id);

                            return (
                              <button
                                key={item.id}
                                onClick={() => onNavClick(item.id)}
                                className={`w-full flex items-center gap-3 px-4 pl-8 py-2.5 text-sm ${
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
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}

              {persistentItems.length > 0 && (
                <>
                  <div className="px-3 py-1">
                    <Separator />
                  </div>
                  {persistentItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeSection === item.id;
                    const count = countMap[item.id] ?? 0;
                    const hasNotification =
                      sectionsWithNotifications.has(item.id);
                    return (
                      <button
                        key={item.id}
                        onClick={() => onNavClick(item.id)}
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
                </>
              )}
            </nav>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
