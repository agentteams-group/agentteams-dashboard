'use client';

import { useMemo } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Box,
  Cloud,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  navItems,
  navGroups,
  isNavItemVisible,
  type NavItem,
  type DeploymentMode,
  type NavGroup,
} from './nav-items';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { PluginNavItems } from '@/components/plugins/plugin-nav-items';

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
}

function NavButton({
  item,
  isActive,
  count,
  hasNotification,
  collapsed,
  onNavClick,
}: NavButtonProps) {
  const Icon = item.icon;
  const button = (
    <button
      onClick={() => onNavClick(item.id)}
      data-nav-section={item.id}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-all duration-200 relative ${
        isActive
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
// GroupHeader
// ──────────────────────────────────────────

function GroupHeader({ group }: { group: { id: NavGroup; label: string } }) {
  if (!group.label) return null;
  return (
    <div className="px-4 py-2 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
      {group.label}
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
  mode,
}: SidebarProps) {
  const taskBoardVisible = useAgentTeamsStore((s) => s.taskBoardVisible);
  const visibleItems = useMemo(
    () => navItems.filter((item) => isNavItemVisible(item, mode, taskBoardVisible)),
    [mode, taskBoardVisible]
  );

  // Group items by their group field
  const groupedItems = navGroups.map((group) => ({
    group,
    items: visibleItems.filter((item) => item.group === group.id),
  })).filter(({ items }) => items.length > 0);

  return (
    <aside
      className={`hidden md:flex min-h-0 flex-col border-r border-border bg-card/50 backdrop-blur-sm transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      {/* Logo area */}
      <div className="flex items-center gap-2 px-4 h-14 border-b border-border">
        <Image
          src="/logo.svg"
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
        {groupedItems.map(({ group, items }) => (
          <div key={group.id}>
            {!collapsed && <GroupHeader group={group} />}
            {items.map((item) => (
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
          </div>
        ))}

        {/* Plugin-contributed menu items (extension point: sidebar-menu) */}
        <PluginNavItems
          activeSection={activeSection}
          collapsed={collapsed}
          onNavClick={onNavClick}
        />
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
