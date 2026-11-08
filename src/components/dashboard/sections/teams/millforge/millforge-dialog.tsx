'use client';

// 团队详情抽屉「千锻」对话框——顶层四 tab：注入（源/模板/编译预览/注入面板）/
// 自定义团队 / 模块更新（三平面，团队面默认当前团队）/ 注入历史。
// mapping 默认按该团队现有成员（leaderName + workerNames）预填；注入成功
// 静默刷新抽屉数据。无新页面/路由。

import { useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import { MillforgeBuildPreview } from './millforge-build-preview';
import { MillforgeCustomTab } from './millforge-custom-tab';
import { MillforgeHistory } from './millforge-history';
import { MillforgeInjectPanel } from './millforge-inject-panel';
import { MillforgeModulesTab } from './millforge-modules-tab';
import { MillforgeSourcePack } from './millforge-source-pack';
import { MillforgeTemplatePicker } from './millforge-template-picker';
import { useMillforgeCore } from './use-millforge-core';

const PANE = 'min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3';

function MillforgeDialogBody({
  team,
  workers,
  canInstall,
  onInjected,
}: {
  team: TeamResponse;
  workers: WorkerResponse[];
  canInstall: boolean;
  onInjected?: () => void;
}) {
  const core = useMillforgeCore({ team, workers, onInjected });
  const [activeTab, setActiveTab] = useState('inject');

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <TabsList className="mx-4 mt-2 h-auto w-fit flex-wrap justify-start gap-1">
        <TabsTrigger value="inject" className="h-9 px-3 text-xs">
          注入
        </TabsTrigger>
        <TabsTrigger value="custom" className="h-9 px-3 text-xs">
          自定义团队
        </TabsTrigger>
        <TabsTrigger value="modules" className="h-9 px-3 text-xs">
          模块更新
        </TabsTrigger>
        <TabsTrigger value="history" className="h-9 px-3 text-xs">
          注入历史
        </TabsTrigger>
      </TabsList>

      <TabsContent value="inject" className={PANE}>
        <MillforgeSourcePack core={core} />
        <MillforgeTemplatePicker core={core} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="h-9"
            data-testid="millforge-compile"
            disabled={!core.pack || core.compiling}
            onClick={() => void core.compileWithTemplate(core.teamName)}
          >
            {core.compiling ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            编译预览
          </Button>
          <span className="text-xs text-muted-foreground">
            编译仅预览 SOUL——注入才写入 Worker CR
          </span>
        </div>

        {core.compileError ? (
          <Alert variant="destructive">
            <AlertCircle className="size-4" aria-hidden="true" />
            <AlertTitle>编译失败</AlertTitle>
            <AlertDescription className="max-h-40 overflow-auto font-mono text-xs break-all whitespace-pre-wrap">
              {core.compileError}
            </AlertDescription>
          </Alert>
        ) : null}

        {core.build ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">
              编译预览（build {core.build.build_id} ·{' '}
              {core.build.source === 'custom' ? '自定义（team_json）' : '模板'}）
            </p>
            <MillforgeBuildPreview build={core.build} />
            <MillforgeInjectPanel core={core} workers={workers} teamName={core.teamName} />
          </div>
        ) : null}
      </TabsContent>

      <TabsContent value="custom" className={PANE}>
        <MillforgeCustomTab core={core} fallbackTeamName={core.teamName} />
      </TabsContent>

      <TabsContent value="modules" className={PANE}>
        <MillforgeModulesTab defaultTeam={team.name} canInstall={canInstall} />
      </TabsContent>

      <TabsContent value="history" className={PANE}>
        <MillforgeHistory core={core} />
      </TabsContent>
    </Tabs>
  );
}

export function MillforgeDialog({
  open,
  team,
  workers,
  canInstall,
  onOpenChange,
  onInjected,
}: {
  open: boolean;
  team: TeamResponse;
  workers: WorkerResponse[];
  canInstall: boolean;
  onOpenChange: (_open: boolean) => void;
  onInjected?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="millforge-dialog"
        className={cn(
          'flex flex-col gap-0 overflow-hidden p-0',
          'max-h-[80vh] w-full sm:w-[900px] sm:max-w-[900px]',
          'max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0',
        )}
      >
        <DialogHeader className="border-b px-4 py-3 text-left">
          <DialogTitle className="truncate text-base">千锻 — {team.name}</DialogTitle>
          <DialogDescription className="text-xs">
            注入 / 自定义团队 / 模块更新 / 注入历史
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <MillforgeDialogBody
            key={team.name}
            team={team}
            workers={workers}
            canInstall={canInstall}
            onInjected={onInjected}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
