'use client';

import {
  AlertCircle,
  ArrowUpCircle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useUpdateCheck } from '@/hooks/use-update-check';
import { useAgentTeamsStore } from '@/lib/agentteams-store';

/**
 * 「设置 → 更新」tab: shows the page's own build identity and runs the
 * manual update check (stale-page detection + upstream release advisory).
 * Admins (dashboard level 3 = CR L1) additionally get the in-app hot patch
 * action — download the latest release bundle, hot-swap the app files, and
 * let the supervisor restart the process, with the page polling until the
 * new build is live.
 */
export function UpdateTab() {
  const { state, check, applyUpdate, updateContainer, pageBuildId, pageBuiltAt, pageVersion } =
    useUpdateCheck();
  const userLevel = useAgentTeamsStore((s) => s.userLevel);
  const isAdmin = userLevel >= 3;

  return (
    <div className="space-y-5 py-4">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">当前版本</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="font-mono text-[10px]">
            v{pageVersion}
          </Badge>
          <Badge variant="outline" className="font-mono text-[10px]">
            {pageBuildId.slice(0, 16)}
          </Badge>
          {pageBuiltAt && (
            <span>构建于 {new Date(pageBuiltAt).toLocaleString('zh-CN')}</span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <Button size="sm" onClick={check} disabled={state.phase === 'checking'}>
          {state.phase === 'checking' ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-1.5" />
          )}
          检查更新
        </Button>

        {state.phase === 'uptodate' && (
          <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            已是最新版本
          </p>
        )}

        {state.phase === 'update-available' && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <ArrowUpCircle className="w-4 h-4 text-amber-500" />
              发现新版本{state.serverVersion ? ` v${state.serverVersion}` : ''}，页面需要刷新追平
            </p>
            <p className="text-xs break-all text-muted-foreground font-mono">
              服务器构建号：{state.serverBuildId.slice(0, 16)}
              {state.builtAt ? ` · ${new Date(state.builtAt).toLocaleString('zh-CN')}` : ''}
            </p>
            <Button size="sm" onClick={applyUpdate}>
              <Download className="w-4 h-4 mr-1.5" />
              立即更新
            </Button>
          </div>
        )}

        {state.phase === 'upstream-available' && (
          <div className="space-y-2 rounded-md border border-blue-500/40 bg-blue-500/5 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <ArrowUpCircle className="w-4 h-4 text-blue-500" />
              上游有新版本 {state.latestVersion}
            </p>
            <p className="text-xs text-muted-foreground">
              {isAdmin
                ? '可一键热更新：应用内下载最新构建并自动重启（约 1-3 分钟，期间页面会自动等待并刷新）。'
                : '当前页面与服务器构建一致；请联系管理员（L1）触发热更新。'}
            </p>
            {isAdmin && (
              <Button size="sm" onClick={updateContainer}>
                <ArrowUpCircle className="w-4 h-4 mr-1.5" />
                热更新
              </Button>
            )}
          </div>
        )}

        {state.phase === 'updating' && (
          <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
              正在应用热更新，请勿关闭页面
            </p>
            <p className="text-xs text-muted-foreground">
              下载补丁包并热替换应用文件，随后服务自动重启（最长约 5 分钟）；完成后页面将自动刷新进入新版本。
            </p>
          </div>
        )}

        {state.phase === 'error' && (
          <p className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertCircle className="w-4 h-4" />
            {state.message}
          </p>
        )}
      </div>
    </div>
  );
}
