'use client';

import { useRef, useEffect, useState, useMemo } from 'react';
import type { RefObject } from 'react';
import { useTheme } from 'next-themes';
import {
  Search,
  Bot,
  Users,
  Crown,
  Zap,
  RefreshCw,
  Wifi,
  WifiOff,
  Sun,
  Moon,
  Settings,
  Menu,
} from 'lucide-react';
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
import { createActions, isCreateActionVisible, type CreateAction, type DeploymentMode } from './nav-items';
import { CommandPalette, useGlobalSearch, type SearchResult } from './command-palette';
import type { WorkerResponse, TeamResponse, ManagerResponse, HumanResponse } from '@/lib/hiclaw-api';

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
  const { theme, setTheme } = useTheme();
  const internalRef = useRef<HTMLInputElement>(null);
  const searchInputRef = externalRef ?? internalRef;
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const searchResults = useGlobalSearch(debouncedQuery, workers, teams, managers, humans);

  const visibleActions = useMemo(
    () => actions.filter((action) => isCreateActionVisible(action, mode)),
    [actions, mode]
  );

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
    <header className="h-14 border-b border-border bg-card/50 backdrop-blur-sm flex items-center gap-3 px-4 sticky top-0 z-30">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onOpenMobileMenu}
      >
        <Menu className="w-5 h-5" />
      </Button>

      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
        <Input
          ref={searchInputRef}
          placeholder="搜索 Workers、团队、Manager... (K)"
          value={debouncedQuery}
          onChange={(e) => setDebouncedQuery(e.target.value)}
          onFocus={() => setPaletteOpen(true)}
          onBlur={() => {
            // Delay closing so click events on results can fire
            setTimeout(() => setPaletteOpen(false), 200);
          }}
          className="pl-9 h-9 bg-background/50"
        />
        {paletteOpen && searchResults.length > 0 && (
          <CommandPalette
            results={searchResults}
            onSelect={(result: SearchResult) => {
              onNavClick(result.section);
              setDebouncedQuery('');
              setPaletteOpen(false);
              searchInputRef.current?.blur();
            }}
            onClose={() => setPaletteOpen(false)}
          />
        )}
      </div>

      {isConnected && (
        <div className="hidden lg:flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px] h-6 gap-1 px-1.5">
            <Bot className="w-3 h-3" />
            {workerCount}
          </Badge>
          <Badge variant="outline" className="text-[10px] h-6 gap-1 px-1.5">
            <Users className="w-3 h-3" />
            {teamCount}
          </Badge>
          <Badge variant="outline" className="text-[10px] h-6 gap-1 px-1.5">
            <Crown className="w-3 h-3" />
            {managerCount}
          </Badge>
        </div>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
            <Zap className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">快速操作</span>
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

      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={onRefreshAll}
              disabled={isRefreshingAll}
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshingAll ? 'animate-spin' : ''}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>刷新所有数据</TooltipContent>
        </Tooltip>

        <Badge
          className={`gap-1 text-xs ${
            isConnected
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20'
          }`}
          variant="outline"
        >
          {isConnected ? (
            <Wifi className="w-3 h-3" />
          ) : (
            <WifiOff className="w-3 h-3" />
          )}
          {isConnected ? '已连接' : '未连接'}
        </Badge>

        {versionString && (
          <Badge variant="outline" className="text-xs hidden sm:flex">
            v{versionString}
          </Badge>
        )}

        <NotificationPopover />

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="h-9 w-9"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>

        <Button variant="ghost" size="icon" onClick={onOpenSettings} className="h-9 w-9">
          <Settings className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
}
