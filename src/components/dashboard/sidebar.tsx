'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Box, Cloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { navItems, isNavItemVisible, type NavItem, type DeploymentMode } from './nav-items';

interface SidebarProps {
  activeSection: string;
  countMap: Record<string, number>;
  sectionsWithNotifications: Set<string>;
  collapsed: boolean;
  onNavClick: (_sectionId: string) => void;
  onToggleCollapse: () => void;
  mode?: DeploymentMode | null;
}

interface NavButtonProps {
  item: NavItem;
  idx: number;
  isActive: boolean;
  count: number;
  hasNotification: boolean;
  collapsed: boolean;
  onNavClick: (_sectionId: string) => void;
}

function NavButton({ item, idx, isActive, count, hasNotification, collapsed, onNavClick }: NavButtonProps) {
  const Icon = item.icon;
  const button = (
    <button
      onClick={() => onNavClick(item.id)}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-all duration-200 relative ${
        isActive
          ? 'bg-primary/10 text-primary dark:text-primary font-medium border-r-2 border-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      }`}
      title={collapsed ? item.label : undefined}
    >
      <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-primary' : ''}`} />
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
        <span className={`w-2 h-2 rounded-full bg-primary animate-pulse ${collapsed ? 'absolute top-1.5 right-1.5' : 'mr-1 ml-0'}`} />
      )}
      {!collapsed && !count && (
        <kbd className="ml-auto text-[10px] text-muted-foreground/50 hidden lg:inline-block">
          {idx + 1}
        </kbd>
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

export function Sidebar({
  activeSection,
  countMap,
  sectionsWithNotifications,
  collapsed,
  onNavClick,
  onToggleCollapse,
  mode,
}: SidebarProps) {
  const visibleItems = useMemo(
    () => navItems.filter((item) => isNavItemVisible(item, mode)),
    [mode]
  );

  return (
    <aside
      className={`hidden md:flex flex-col border-r border-border bg-card/50 backdrop-blur-sm transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      <div className="flex items-center gap-2 px-4 h-14 border-b border-border">
        <div className="w-8 h-8 rounded-lg mesh-gradient flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
          A
        </div>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col min-w-0"
          >
            <span className="font-bold text-lg leading-tight">AgentTeams</span>
            {mode && (
              <span className={`inline-flex items-center gap-1 text-[10px] font-medium leading-tight ${
                mode === 'embedded' ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'
              }`}>
                {mode === 'embedded' ? <Box className="w-2.5 h-2.5" /> : <Cloud className="w-2.5 h-2.5" />}
                {mode === 'embedded' ? '嵌入模式' : 'K8s 模式'}
              </span>
            )}
          </motion.div>
        )}
        {collapsed && mode && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`absolute bottom-0.5 right-0.5 ${
                mode === 'embedded' ? 'text-emerald-500' : 'text-blue-500'
              }`}>
                {mode === 'embedded' ? <Box className="w-3 h-3" /> : <Cloud className="w-3 h-3" />}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">
              {mode === 'embedded' ? '嵌入模式' : 'K8s 模式'}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <nav className="flex-1 py-2 overflow-y-auto custom-scrollbar">
        {visibleItems.map((item, idx) => (
          <NavButton
            key={item.id}
            item={item}
            idx={idx}
            isActive={activeSection === item.id}
            count={countMap[item.id] ?? 0}
            hasNotification={sectionsWithNotifications.has(item.id)}
            collapsed={collapsed}
            onNavClick={onNavClick}
          />
        ))}
      </nav>

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
