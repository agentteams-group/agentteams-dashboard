'use client';

import { useMemo, useCallback } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Box,
  Cloud,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  navItems,
  navGroups,
  isNavItemVisible,
  getGroupItems,
  isGroupVisible,
  type NavItem,
  type NavGroup,
  type DeploymentMode,
} from './nav-items';

// ──────────────────────────────────────────
// Props
// ──────────────────────────────────────────

interface SidebarProps {
  activeSection: string;
  countMap: Record<string, number>;
  sectionsWithNotifications: Set<string>;
  collapsed: boolean;
  onNavClick: (_sectionId: string) => void;
  onToggleCollapse: () => void;
  expandedGroups: Set<string>;
  onToggleGroup: (_groupId: string, _ctrlKey: boolean) => void;
  mode?: DeploymentMode | null;
}

// ──────────────────────────────────────────
// NavButton (shared)
// ──────────────────────────────────────────

interface NavButtonProps {
  item: NavItem;
  isActive: boolean;
  count: number;
  hasNotification: boolean;
  collapsed: boolean;
  onNavClick: (_sectionId: string) => void;
  /** Visually indent sub-items inside a group. */
  indent?: boolean;
}

function NavButton({
  item,
  isActive,
  count,
  hasNotification,
  collapsed,
  onNavClick,
  indent = false,
}: NavButtonProps) {
  const Icon = item.icon;
  const button = (
    <button
      onClick={() => onNavClick(item.id)}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-all duration-200 relative ${
        indent && !collapsed ? 'pl-8' : ''
      } ${isActive
        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium border-r-2 border-emerald-500'
        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      }`}
      title={collapsed ? item.label : undefined}
    >
      <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-emerald-500' : ''}`} />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && count > 0 && (
        <Badge
          variant="secondary"
          className="ml-auto text-[10px] h-5 min-w-[20px] px-1.5 flex items-center justify-center"
        >
          {count}
        </Badge>
      )}
      {collapsed && count > 0 && (
        <span className="absolute top-1 right-1 h-4 min-w-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center">
          {count > 99 ? '99+' : count}
        </span>
      )}
      {hasNotification && !isActive && (
        <span
          className={`w-2 h-2 rounded-full bg-emerald-500 animate-pulse ${
            collapsed ? 'absolute top-1.5 right-1.5' : 'mr-1 ml-0'
          }`}
        />
      )}
    </button>
  );

  if (collapsed) {
    return (
      <Tooltip key={item.id}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right">
          {item.label}
          {count > 0 && ` (${count})`}
        </TooltipContent>
      </Tooltip>
    );
  }

  return <div key={item.id}>{button}</div>;
}

// ──────────────────────────────────────────
// NavGroupSection
// ──────────────────────────────────────────

interface NavGroupSectionProps {
  group: NavGroup;
  items: NavItem[];
  activeSection: string;
  expanded: boolean;
  countMap: Record<string, number>;
  sectionsWithNotifications: Set<string>;
  collapsed: boolean;
  onNavClick: (_sectionId: string) => void;
  onToggleGroup: (_groupId: string, _ctrlKey: boolean) => void;
}

function NavGroupSection({
  group,
  items,
  activeSection,
  expanded,
  countMap,
  sectionsWithNotifications,
  collapsed,
  onNavClick,
  onToggleGroup,
}: NavGroupSectionProps) {
  const GroupIcon = group.icon;
  const isActiveInGroup = items.some((item) => item.id === activeSection);
  const groupCount = items.reduce((sum, item) => sum + (countMap[item.id] ?? 0), 0);
  const hasGroupNotification = items.some((item) =>
    sectionsWithNotifications.has(item.id)
  );

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleGroup(group.id, e.ctrlKey || e.metaKey);
    },
    [group.id, onToggleGroup]
  );

  // ── Collapsed ──
  if (collapsed) {
    return (
      <Tooltip key={group.id}>
        <TooltipTrigger asChild>
          <button
            onClick={handleToggle}
            className={`w-full flex items-center justify-center py-2.5 text-sm transition-all duration-200 relative ${
              isActiveInGroup
                ? 'bg-emerald-500/10 text-emerald-500'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            <GroupIcon className="w-5 h-5" />
            {groupCount > 0 && (
              <span className="absolute top-0.5 right-0.5 h-4 min-w-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center">
                {groupCount > 99 ? '99+' : groupCount}
              </span>
            )}
            {hasGroupNotification && !isActiveInGroup && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {group.label}
          {groupCount > 0 && ` (${groupCount})`}
        </TooltipContent>
      </Tooltip>
    );
  }

  // ── Expanded ──
  return (
    <div key={group.id}>
      <button
        onClick={handleToggle}
        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-all duration-200 ${
          isActiveInGroup
            ? 'text-foreground font-semibold'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        }`}
      >
        <GroupIcon
          className={`w-5 h-5 flex-shrink-0 ${
            isActiveInGroup ? 'text-emerald-500' : ''
          }`}
        />
        <span className="flex-1 truncate text-left">{group.label}</span>
        {groupCount > 0 && (
          <Badge
            variant="secondary"
            className="text-[10px] h-5 min-w-[20px] px-1.5 flex items-center justify-center"
          >
            {groupCount}
          </Badge>
        )}
        {hasGroupNotification && !isActiveInGroup && (
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        )}
        <ChevronDown
          className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${
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
            {items.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                isActive={activeSection === item.id}
                count={countMap[item.id] ?? 0}
                hasNotification={sectionsWithNotifications.has(item.id)}
                collapsed={false}
                onNavClick={onNavClick}
                indent
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ──────────────────────────────────────────
// Sidebar
// ──────────────────────────────────────────

export function Sidebar({
  activeSection,
  countMap,
  sectionsWithNotifications,
  collapsed,
  onNavClick,
  onToggleCollapse,
  expandedGroups,
  onToggleGroup,
  mode,
}: SidebarProps) {
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

  return (
    <aside
      className={`hidden md:flex flex-col border-r border-border bg-card/50 backdrop-blur-sm transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      {/* Logo area */}
      <div className="flex items-center gap-2 px-4 h-14 border-b border-border">
        <Image
          src="/logo.jpg"
          alt="AgentTeams"
          width={32}
          height={32}
          className="rounded-lg flex-shrink-0"
        />
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col min-w-0"
          >
            <span className="font-bold text-lg leading-tight">AgentTeams</span>
            {mode && (
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-medium leading-tight ${
                  mode === 'embedded'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-blue-600 dark:text-blue-400'
                }`}
              >
                {mode === 'embedded' ? (
                  <Box className="w-2.5 h-2.5" />
                ) : (
                  <Cloud className="w-2.5 h-2.5" />
                )}
                {mode === 'embedded' ? '嵌入模式' : 'K8s 模式'}
              </span>
            )}
          </motion.div>
        )}
        {collapsed && mode && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={`absolute bottom-0.5 right-0.5 ${
                  mode === 'embedded' ? 'text-emerald-500' : 'text-blue-500'
                }`}
              >
                {mode === 'embedded' ? (
                  <Box className="w-3 h-3" />
                ) : (
                  <Cloud className="w-3 h-3" />
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">
              {mode === 'embedded' ? '嵌入模式' : 'K8s 模式'}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 overflow-y-auto custom-scrollbar">
        {visibleGroups.map((group) => {
          const groupItems = getGroupItems(group.id, navItems, mode);
          return (
            <NavGroupSection
              key={group.id}
              group={group}
              items={groupItems}
              activeSection={activeSection}
              expanded={expandedGroups.has(group.id)}
              countMap={countMap}
              sectionsWithNotifications={sectionsWithNotifications}
              collapsed={collapsed}
              onNavClick={onNavClick}
              onToggleGroup={onToggleGroup}
            />
          );
        })}

        {persistentItems.length > 0 && (
          <>
            <div className="px-3 py-1">
              <Separator />
            </div>
            {persistentItems.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                isActive={activeSection === item.id}
                count={countMap[item.id] ?? 0}
                hasNotification={sectionsWithNotifications.has(item.id)}
                collapsed={collapsed}
                onNavClick={onNavClick}
              />
            ))}
          </>
        )}
      </nav>

      {/* Collapse toggle */}
      <div className="p-2 border-t border-border">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center"
          onClick={onToggleCollapse}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </Button>
      </div>
    </aside>
  );
}
