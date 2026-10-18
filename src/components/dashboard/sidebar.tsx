'use client';

import { useEffect, useState } from 'react';
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
import type { NavItem, DeploymentMode } from './nav-items';
import { useNavSections } from './use-nav-sections';
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
      {!collapsed && (
        <span className="truncate">{item.label}</span>
      )}
      {!collapsed && count > 0 && (
        <Badge
          variant="secondary"
          className="ml-auto text-[10px] h-5 min-w-[20px] px-1.5 flex items-center justify-center"
        >
          {count}
        </Badge>
      )}
      {collapsed && count > 0 && (
        <span className="absolute top-1 right-1 h-4 min-w-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[11px] flex items-center justify-center">
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

function GroupHeader({ label }: { label: string }) {
  return (
    <div className="px-4 py-2 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
      {label}
    </div>
  );
}

/** Area header (工作台 / 控制台) — only rendered in Workbench mode.
 *  角色自适应（PRD §5.3）：控制台区默认对观察者/协作者折叠，管理员展开；
 *  点击区头切换（§5.2 可达性：命令面板仍可达全部 14 项）。 */
function AreaHeader({
  label,
  collapsed,
  areaCollapsed,
  onToggle,
}: {
  label: string;
  collapsed: boolean;
  areaCollapsed: boolean;
  onToggle: () => void;
}) {
  if (collapsed) {
    return <div className="mx-3 my-2 border-t border-border" aria-label={label} />;
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!areaCollapsed}
      className="w-full px-4 pt-3 pb-1 text-xs font-bold text-foreground/80 flex items-center gap-1.5 hover:text-foreground transition-colors"
    >
      {label}
      <span className={`ml-auto text-[10px] text-muted-foreground transition-transform ${areaCollapsed ? '' : 'rotate-90'}`} aria-hidden="true">
        ▸
      </span>
    </button>
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
  const userLevel = useAgentTeamsStore((s) => s.userLevel);
  const classicNavigation = useAgentTeamsStore((s) => s.classicNavigation);
  const areaSections = useNavSections(mode, taskBoardVisible, userLevel, classicNavigation);
  // 角色自适应默认视图（§5.3）：控制台区非管理员默认折叠；用户手动切换后
  // 以本会话态为准（不持久化，尊重默认口径）。userLevel 从 fail-open 默认
  // 值变为真实等级时重置一次。
  const [consoleCollapsed, setConsoleCollapsed] = useState(() => userLevel < 3);
  useEffect(() => {
    setConsoleCollapsed(userLevel < 3);
  }, [userLevel]);

  return (
    <aside
      className={`hidden md:flex min-h-0 flex-col border-r border-border bg-card/50 backdrop-blur-sm transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      {/* Logo area */}
      <div className="flex items-center gap-2 px-4 h-14 border-b border-border">
        <Image
          src="/agentteams-logo.svg"
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
        {areaSections.map((area) => {
          const areaCollapsed = area.key === 'console' && consoleCollapsed;
          return (
            <div key={area.key}>
              {area.label && (
                <AreaHeader
                  label={area.label}
                  collapsed={collapsed}
                  areaCollapsed={areaCollapsed}
                  onToggle={() => setConsoleCollapsed((v) => !v)}
                />
              )}
              {!areaCollapsed &&
                area.groups.map((group) => (
                  <div key={group.key}>
                    {!collapsed && <GroupHeader label={group.label} />}
                    {group.items.map((item) => (
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
            </div>
          );
        })}

        {/* Plugin-contributed menu items (extension point: sidebar-menu).
            挂载点随控制台收敛迁移（PRD §9），仍追加在侧栏尾部。 */}
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
