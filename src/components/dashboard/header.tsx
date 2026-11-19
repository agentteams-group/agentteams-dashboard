'use client';

import { useRef, useEffect, useState, useMemo } from 'react';
import Image from 'next/image';
import type { RefObject } from 'react';
import { useTheme } from '@/components/theme/theme-provider';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import {
  Search,
  X,
  Zap,
  RefreshCw,
  Sun,
  Moon,
  Contrast,
  Settings,
  Menu,
  ImageIcon,
  LogOut,
  ChevronRight,
} from 'lucide-react';
import { isComposing, isDesktopHover } from '@/lib/desktop-interactions';
import { apiUrl } from '@/lib/api-base';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { ConnectionStatus } from './connection-status';
import { NotificationPopover } from './notification-popover';
import { PluginToolbarButtons } from '@/components/plugins/plugin-toolbar-buttons';
import { createActions, isCreateActionVisible, type CreateAction, type DeploymentMode } from './nav-items';
import { CommandPalette, useGlobalSearch, type SearchResult } from './command-palette';
import { openChatRoom } from '@/lib/open-chat-room';
import { AccountAvatar } from './account-avatar';
import { AvatarEditor } from './avatar-editor';
import type { WorkerResponse, TeamResponse, ManagerResponse, HumanResponse } from '@/lib/agentteams-api';

interface DashboardHeaderProps {
  pageLabel?: string;
  groupLabel?: string;
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
  pageLabel = '首页',
  groupLabel,
  isConnected,
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
  const [query, setQuery] = useState(searchQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  const waitingForQuery = !!query.trim() && query !== debouncedQuery;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);

  const searchResults = useGlobalSearch(query.trim() ? debouncedQuery : '', workers, teams, managers, humans, {
    enabled: paletteOpen && !waitingForQuery,
    mode,
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
  const themeLabel = resolvedTheme.nameZh || resolvedTheme.name;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      onSearchChange(query);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, onSearchChange]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || isComposing()) return;
      const input = searchInputRef.current;
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
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [searchInputRef]);

  return (
    <header className="workspace-header min-h-14 shrink-0 border-b border-border bg-background flex flex-wrap items-center gap-2 py-2 sticky top-0 z-30">
      <div className="workspace-header-main flex min-w-0 flex-wrap items-center gap-3">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onOpenMobileMenu}
        aria-label="打开导航菜单"
      >
        <Menu className="w-5 h-5" aria-hidden="true" />
      </Button>

      <nav aria-label="面包屑" className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <span className="hidden sm:inline">AgentTeams</span><Image src="/agentteams-logo.svg" alt="AgentTeams" width={20} height={20} className="shrink-0 sm:hidden" /><ChevronRight className="size-3 shrink-0" aria-hidden />
        {groupLabel && groupLabel !== pageLabel && <><span className="hidden sm:inline">{groupLabel}</span><ChevronRight className="hidden size-3 shrink-0 sm:block" aria-hidden /></>}
        <span aria-current="page" title={pageLabel} className="truncate font-semibold text-foreground">{pageLabel}</span>
      </nav>
      <div className="workspace-search relative min-w-0" data-open={paletteOpen}
        onPointerEnter={event => { if (isDesktopHover(event)) { setPaletteOpen(true); searchInputRef.current?.focus({ preventScroll: true }); } }}
        onPointerLeave={event => {
          if (event.pointerType !== 'mouse' || isComposing()) return;
          setPaletteOpen(false);
          if (document.activeElement === searchInputRef.current) searchInputRef.current?.blur();
        }}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaletteOpen(false); }}>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          ref={searchInputRef}
          placeholder={paletteOpen ? "搜索页面、任务、技能或工具…" : "搜索工作区"}
          aria-label="搜索工作区"
          value={query}
          onChange={event => { setQuery(event.target.value); setPaletteOpen(true); }}
          onFocus={() => setPaletteOpen(true)}
          onClick={() => setPaletteOpen(true)}
          className="h-9 rounded-full border-border bg-background pl-9 pr-8 shadow-none"
        />
        {query && <button type="button" aria-label="清除搜索" title="清除搜索"
          className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            setQuery('');
            setDebouncedQuery('');
            setPaletteOpen(true);
            searchInputRef.current?.focus({ preventScroll: true });
          }}>
          <X className="size-4" aria-hidden="true" />
        </button>}
        {paletteOpen && <CommandPalette
          key={query.trim()}
          inputRef={searchInputRef}
          query={query.trim()}
          loading={waitingForQuery}
          results={waitingForQuery ? [] : searchResults}
          onSelect={(result: SearchResult) => {
            if (result.roomId) openChatRoom(result.roomId);
            if (result.hash) window.location.hash = result.hash;
            else onNavClick(result.section);
            setQuery('');
            setDebouncedQuery('');
            setPaletteOpen(false);
            searchInputRef.current?.blur();
          }}
          onClose={() => setPaletteOpen(false)}
        />}
      </div>
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 text-sm" aria-label="创建">
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
                onClick={() => {
                  // 精确深链（如团队与Agent 的 tab）优先；其余仍走 section 导航。
                  if (action.hash) window.location.hash = action.hash;
                  else onNavClick(action.section);
                }}
                className="cursor-pointer"
              >
                <ActionIcon className="w-4 h-4" />
                {action.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

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

        <ConnectionStatus isConnected={isConnected} versionString={versionString} mode={mode} />

        <NotificationPopover />

        {sessionUser && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-9 gap-2 px-2 text-sm" aria-label={sessionUser}>
                <AccountAvatar kind="human" name={sessionUser} className="size-6" />
                <span className="hidden sm:inline max-w-[120px] truncate">{sessionUser}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>当前账号</DropdownMenuLabel>
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                {sessionUser} · {levelLabel}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setAvatarOpen(true)}>
                <ImageIcon className="mr-2 h-4 w-4" />
                更换我的头像
              </DropdownMenuItem>
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
      {avatarOpen && sessionUser && <AvatarEditor key={sessionUser} kind="human" name={sessionUser} onClose={() => setAvatarOpen(false)} />}
    </header>
  );
}
