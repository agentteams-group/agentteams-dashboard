'use client';

import { useRef, useEffect, useState, useMemo } from 'react';
import type { RefObject } from 'react';
import { useTheme } from '@/components/theme/theme-provider';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import {
  Search,
  Bot,
  Users,
  Crown,
  Zap,
  RefreshCw,
  Sun,
  Moon,
  Contrast,
  Settings,
  Menu,
  UserCircle,
  LogOut,
} from 'lucide-react';
import { apiUrl } from '@/lib/api-base';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { NotificationPopover } from './notification-popover';
import { PluginToolbarButtons } from '@/components/plugins/plugin-toolbar-buttons';
import { createActions, isCreateActionVisible, type CreateAction, type DeploymentMode } from './nav-items';
import { CommandPalette, useGlobalSearch, type SearchResult } from './command-palette';
import { openChatRoom } from '@/lib/open-chat-room';
import type { WorkerResponse, TeamResponse, ManagerResponse, HumanResponse } from '@/lib/agentteams-api';

interface DashboardHeaderProps {
  isConnected: boolean;
  workerCount: number;
  teamCount: number;
  managerCount: number;
  versionString: string | undefined;
  isRefreshingAll: boolean;
  searchQuery: string;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  onSearchChange: (_query: string) => void;
  onNavClick: (_sectionId: string) => void;
  onRefreshAll: () => void;
  onOpenMobileMenu: () => void;
  onOpenSettings: () => void;
  mode?: DeploymentMode | null;
  createActions?: readonly CreateAction[];
  workers?: WorkerResponse[];
  teams?: TeamResponse[];
  managers?: ManagerResponse[];
  humans?: HumanResponse[];
}

export function DashboardHeader({
  isConnected,
  workerCount,
  teamCount,
  managerCount,
  versionString,
  isRefreshingAll,
  searchQuery,
  searchInputRef: externalRef,
  onSearchChange,
  onNavClick,
  onRefreshAll,
  onOpenMobileMenu,
  onOpenSettings,
  mode,
  createActions: actions = createActions,
  workers,
  teams,
  managers,
  humans,
}: DashboardHeaderProps) {
  const { resolvedTheme, setTheme, locked: themeLocked } = useTheme();
  const internalRef = useRef<HTMLInputElement>(null);
  const searchInputRef = externalRef ?? internalRef;
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // 只在命令面板真的打开时才拉四类新实体（方案 v3 C-2）：
  // 顶栏不输字的时候不该多带两份后台请求。
  const searchResults = useGlobalSearch(debouncedQuery, workers, teams, managers, humans, {
    enabled: paletteOpen,
  });
  const userLevel = useAgentTeamsStore((s) => s.userLevel);
  const sessionUser = useAgentTeamsStore((s) => s.sessionUser);

  // 退出登录：清服务端 session（at_dash_sess + 残留 _hi_sess）→ 回登录页。
  const handleLogout = () => {
    // The login UI is rendered at the ROOT path (page.tsx shows LoginPage when
    // unauthenticated) — there is no /login route (404).
    void fetch(apiUrl('/api/auth/logout'), { method: 'POST', credentials: 'same-origin' }).finally(() => {
      window.location.replace('/');
    });
  };

  const levelLabel = userLevel === 3 ? '管理员' : userLevel === 2 ? '团队成员' : '观察者';

  const visibleActions = useMemo(
    () => actions.filter((action) => isCreateActionVisible(action, mode, undefined, userLevel)),
    [actions, mode, userLevel]
  );

  // Cycle through the built-in themes: light → dark → high-contrast → light.
  const cycleTheme = () => {
    const order = ['light', 'dark', 'high-contrast'];
    const index = order.indexOf(resolvedTheme.id);
    setTheme(order[(index + 1) % order.length]);
  };
  const themeLabel =
    resolvedTheme.id === 'high-contrast'
      ? '高对比度主题'
      : resolvedTheme.base === 'dark'
        ? '暗色主题'
        : '亮色主题';

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      onSearchChange(debouncedQuery);
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [debouncedQuery, onSearchChange]);

  useEffect(() => {
    const input = searchInputRef.current;
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && e.key === 'k') {
        e.preventDefault();
        input?.focus();
      }
      if (e.key === 'Escape') {
        if (document.activeElement === input) {
          input?.blur();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchInputRef]);

  return (
    <header className="h-16 shrink-0 border-b border-border/40 bg-background flex items-center gap-1 px-3 sm:gap-3 sm:px-6 sticky top-0 z-30">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onOpenMobileMenu}
        aria-label="打开导航菜单"
      >
        <Menu className="w-5 h-5" aria-hidden="true" />
      </Button>

      <div className={`${paletteOpen ? 'absolute inset-x-3 top-3 z-40 sm:relative sm:inset-auto' : 'relative'} min-w-0 flex-1 max-w-md`}>
        <Search className={`absolute left-3 top-1/2 -translate-y-1/2 ${paletteOpen ? 'block' : 'hidden sm:block'} w-4 h-4 text-muted-foreground z-10`} />
        <Input
          ref={searchInputRef}
          placeholder="搜索 Agent、任务和工具…"
          aria-label="搜索工作区"
          value={debouncedQuery}
          onChange={(e) => setDebouncedQuery(e.target.value)}
          onFocus={() => setPaletteOpen(true)}
          onBlur={() => {
            // Delay closing so click events on results can fire
            setTimeout(() => setPaletteOpen(false), 200);
          }}
          className={`${paletteOpen ? '' : 'sr-only sm:not-sr-only'} pl-9 h-9 border-transparent bg-muted/45 shadow-none focus-visible:bg-background`}
        />
        {paletteOpen && searchResults.length > 0 && (
          <CommandPalette
            results={searchResults}
            onSelect={(result: SearchResult) => {
              if (result.roomId) {
                openChatRoom(result.roomId);
              }
              // 单一导航路径（C-1 定的规矩）：生产者只写 hash，由
              // use-active-section 的 hashchange 监听器解析。带深链参数的命中
              // （?project= / ?loop= / ?entity=）必须走这条路，否则 onNavClick
              // 写的规范 hash 会把它覆盖掉，参数就丢了。
              if (result.hash) {
                window.location.hash = result.hash;
              } else {
                onNavClick(result.section);
              }
              setDebouncedQuery('');
              setPaletteOpen(false);
              searchInputRef.current?.blur();
            }}
            onClose={() => setPaletteOpen(false)}
          />
        )}
      </div>

      {isConnected && (
        <div className="hidden lg:flex items-center">
          {/* 资源计数合并为一枚胶囊（优化反馈：三个独立徽章视觉噪音），
              tooltip 分项说明 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="text-xs h-6 gap-2 px-2 bg-background/40 text-muted-foreground"
              >
                <span className="flex items-center gap-1">
                  <Bot className="w-3 h-3" />
                  {workerCount}
                </span>
                <span className="h-3 w-px bg-border" aria-hidden="true" />
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {teamCount}
                </span>
                <span className="h-3 w-px bg-border" aria-hidden="true" />
                <span className="flex items-center gap-1">
                  <Crown className="w-3 h-3" />
                  {managerCount}
                </span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              Workers {workerCount} · 团队 {teamCount} · Managers {managerCount}
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs" aria-label="创建">
            <Zap className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">创建</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>快速操作</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {visibleActions.map((action) => {
            const ActionIcon = action.icon;
            return (
              <DropdownMenuItem
                key={action.id}
                onClick={() => onNavClick(action.section)}
                className="cursor-pointer"
              >
                <ActionIcon className="w-4 h-4" />
                {action.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex items-center gap-1 sm:gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={onRefreshAll}
              disabled={isRefreshingAll}
              aria-label="刷新所有数据"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshingAll ? 'animate-spin' : ''}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>刷新所有数据</TooltipContent>
        </Tooltip>

        {/* Plugin-contributed toolbar buttons (extension point: toolbar) */}
        <PluginToolbarButtons />

        {/* 连接状态 + 版本合并为单状态胶囊（优化反馈：减少独立徽章；
            hover 显示版本与延迟详情） */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              className={`hidden sm:inline-flex gap-1.5 text-xs cursor-default ${
                isConnected
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20'
              }`}
              variant="outline"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">{isConnected ? '在线' : '离线'}</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {isConnected ? '平台服务已连接' : '平台服务未连接'}
            {versionString && <div className="text-xs opacity-80">版本 v{versionString}</div>}
          </TooltipContent>
        </Tooltip>

        <NotificationPopover />

        {sessionUser && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-9 gap-2 px-2 text-xs" aria-label={sessionUser}>
                <UserCircle className="h-4 w-4" />
                <span className="hidden sm:inline max-w-[120px] truncate">{sessionUser}</span>
                <Badge
                  variant="secondary"
                  className="hidden text-xs bg-primary/10 text-primary xl:inline-flex"
                >
                  {levelLabel}
                </Badge>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>当前账号</DropdownMenuLabel>
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                {sessionUser} · {levelLabel}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400">
                <LogOut className="mr-2 h-4 w-4" />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={cycleTheme}
              disabled={themeLocked}
              className="h-9 w-9"
              aria-label="切换主题"
            >
              {resolvedTheme.id === 'high-contrast' ? (
                <Contrast className="h-4 w-4" />
              ) : resolvedTheme.base === 'dark' ? (
                <Moon className="h-4 w-4" />
              ) : (
                <Sun className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>切换主题（当前：{themeLabel}）</TooltipContent>
        </Tooltip>

        <Button variant="ghost" size="icon" onClick={onOpenSettings} className="h-9 w-9" aria-label="打开设置">
          <Settings className="w-4 h-4" aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
}
