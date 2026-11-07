'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertCircle, ArrowUpCircle, Loader2, Puzzle, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  agentteamsApi,
  type MillforgeIndexQuery,
  type ModuleInstallRequest,
} from '@/lib/agentteams-api';
import { formatErrorMessage } from '@/lib/api-error';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useManagers } from '@/hooks/use-agentteams-managers';
import {
  indexModules,
  installedVersionsLabel,
  moduleUpdateState,
  type IndexModule,
  type ModuleUpdateState,
} from '@/lib/module-updates';

type TargetKind = 'team' | 'worker' | 'manager';
type ReleaseChannel = NonNullable<MillforgeIndexQuery['channel']>;

const CHANNELS: ReleaseChannel[] = ['alpha', 'beta', 'stable'];

const TARGET_LABELS: Record<TargetKind, string> = {
  team: '团队',
  worker: 'Worker',
  manager: 'Manager',
};

interface InstalledRow {
  /** Plugin registry id — the index `pluginId` for bundle modules. */
  module: string;
  name?: string;
  versions: string[];
  consistent?: boolean;
  loaded?: boolean;
}

const STATE_LABELS: Record<ModuleUpdateState, string> = {
  'update-available': '可更新',
  uptodate: '已是最新',
  'not-installed': '未安装',
  unknown: '未知',
};

const STATE_CLASSES: Record<ModuleUpdateState, string> = {
  'update-available': 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  uptodate: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  'not-installed': 'text-muted-foreground',
  unknown: 'text-muted-foreground',
};

async function loadInstalled(kind: TargetKind, name: string): Promise<InstalledRow[]> {
  if (kind === 'team') {
    const { modules } = await agentteamsApi.getTeamModules(name);
    return modules.map((module) => ({
      module: module.module,
      name: module.name,
      versions: Object.keys(module.versions ?? {}),
      consistent: module.consistent,
    }));
  }
  const entries = kind === 'worker'
    ? await agentteamsApi.getWorkerPlugins(name)
    : await agentteamsApi.getManagerPlugins(name);
  return entries
    .map((entry) => ({
      module: entry.id || entry.name || '',
      name: entry.name,
      versions: entry.version ? [entry.version] : [],
      loaded: entry.loaded,
    }))
    .filter((row) => row.module.length > 0);
}

interface PendingUpdate {
  entry: IndexModule;
  installed?: InstalledRow;
}

/**
 * 「设置 → 模块」: the module-update panel (#1526).
 *
 * Read-only first: the Millforge index (latest versions) and the selected
 * target's installed registry (current versions) are both reads. An update
 * reuses the controller's existing install endpoints and always goes through
 * an explicit confirmation dialog; non-L1 sessions get the read-only view.
 */
export function ModulesTab() {
  const userLevel = useAgentTeamsStore((state) => state.userLevel);
  const canInstall = userLevel >= 3;
  const queryClient = useQueryClient();

  const [channel, setChannel] = useState<ReleaseChannel>('beta');
  const [targetKind, setTargetKind] = useState<TargetKind>('team');
  const [targetName, setTargetName] = useState('');
  const [pending, setPending] = useState<PendingUpdate | null>(null);
  const [installing, setInstalling] = useState(false);

  const { data: teams } = useTeams();
  const { data: workers } = useWorkers();
  const { data: managers } = useManagers();

  const targets = useMemo(() => {
    const names = targetKind === 'team'
      ? (teams ?? []).map((team) => team.name)
      : targetKind === 'worker'
        ? (workers ?? []).map((worker) => worker.name)
        : (managers ?? []).map((manager) => manager.name);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [targetKind, teams, workers, managers]);

  const selectedTarget = targetName && targets.includes(targetName) ? targetName : targets[0] ?? '';

  const indexQuery = useQuery({
    queryKey: ['millforge-index', channel],
    queryFn: () => agentteamsApi.getMillforgeIndex({ source: 'github', channel }),
    retry: 1,
    staleTime: 60_000,
  });

  const installedQuery = useQuery({
    queryKey: ['module-installed', targetKind, selectedTarget],
    queryFn: () => loadInstalled(targetKind, selectedTarget),
    enabled: !!selectedTarget,
    retry: 1,
  });

  const installed = installedQuery.data ?? [];
  const entries = indexModules(indexQuery.data);

  const rows = useMemo(() => {
    const byKey = new Map(installed.map((row) => [row.module, row] as const));
    return entries.map((entry) => {
      const current = byKey.get(entry.module) ?? byKey.get(entry.pluginId);
      return {
        entry,
        installed: current,
        state: moduleUpdateState(current?.versions, entry.latest),
      };
    });
  }, [entries, installed]);

  const unmatched = useMemo(
    () => installed.filter((row) => !entries.some(
      (entry) => entry.module === row.module || entry.pluginId === row.module,
    )),
    [entries, installed],
  );

  const runInstall = async () => {
    if (!pending || !selectedTarget) return;
    setInstalling(true);
    try {
      const body: ModuleInstallRequest = {
        module: pending.entry.module,
        source: 'github',
        channel,
        version: pending.entry.latest ?? undefined,
      };
      const result = targetKind === 'team'
        ? await agentteamsApi.installTeamModule(selectedTarget, pending.entry.module, body)
        : targetKind === 'worker'
          ? await agentteamsApi.installWorkerPlugin(selectedTarget, body)
          : await agentteamsApi.installManagerPlugin(selectedTarget, body);
      const memberCount = result.updated?.length ?? 0;
      toast.success(
        `模块「${pending.entry.module}」已更新${memberCount > 0 ? `（${memberCount} 个成员）` : ''}`,
      );
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: ['module-installed'] });
    } catch (err) {
      toast.error(`模块更新失败：${formatErrorMessage(err)}`);
    } finally {
      setInstalling(false);
    }
  };

  const switchTargetKind = (kind: TargetKind) => {
    setTargetKind(kind);
    setTargetName('');
  };

  return (
    <div className="space-y-5" data-testid="modules-tab">
      <div className="space-y-1">
        <p className="text-sm font-medium flex items-center gap-2">
          <Puzzle className="w-4 h-4" aria-hidden="true" />
          模块更新
        </p>
        <p className="text-xs text-muted-foreground">
          从 Millforge 发布索引读取最新版本，并与所选目标的已安装插件对比。
          {canInstall
            ? '更新会调用 Controller 现有的安装端点，执行前需要二次确认。'
            : '当前身份仅可查看；更新需要 L1 管理员权限。'}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">发布通道</Label>
          <Select value={channel} onValueChange={(value) => setChannel(value as ReleaseChannel)}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNELS.map((value) => (
                <SelectItem key={value} value={value}>{value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">目标类型</Label>
          <Select value={targetKind} onValueChange={(value) => switchTargetKind(value as TargetKind)}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TARGET_LABELS) as TargetKind[]).map((kind) => (
                <SelectItem key={kind} value={kind}>{TARGET_LABELS[kind]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">{TARGET_LABELS[targetKind]}</Label>
          <Select
            value={selectedTarget}
            onValueChange={setTargetName}
            disabled={targets.length === 0}
          >
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder={targets.length === 0 ? '暂无可选目标' : '选择目标'} />
            </SelectTrigger>
            <SelectContent>
              {targets.map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => {
            void indexQuery.refetch();
            void installedQuery.refetch();
          }}
          disabled={indexQuery.isFetching || installedQuery.isFetching}
        >
          <RefreshCw
            className={`w-3.5 h-3.5 mr-1 ${
              indexQuery.isFetching || installedQuery.isFetching ? 'animate-spin' : ''
            }`}
            aria-hidden="true"
          />
          刷新
        </Button>
      </div>

      {indexQuery.isLoading && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
          正在读取发布索引…
        </p>
      )}

      {indexQuery.isError && (
        <p className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          发布索引读取失败：{formatErrorMessage(indexQuery.error)}
        </p>
      )}

      {!selectedTarget && targetKind !== 'manager' && (
        <p className="text-xs text-muted-foreground">请选择一个{TARGET_LABELS[targetKind]}以查看已安装版本。</p>
      )}

      {installedQuery.isError && (
        <p className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          已安装模块读取失败：{formatErrorMessage(installedQuery.error)}
        </p>
      )}

      {!indexQuery.isLoading && !indexQuery.isError && (
        <div className="space-y-2">
          {rows.length === 0 && (
            <p className="text-xs text-muted-foreground">索引中暂无模块</p>
          )}
          {rows.map(({ entry, installed: current, state }) => {
            const canUpdate = canInstall
              && !!entry.latest
              && entry.kind !== 'runner'
              && (state === 'update-available' || state === 'not-installed');
            return (
              <div key={entry.module} className="rounded-lg border p-3 space-y-2" data-testid={`module-row-${entry.module}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm font-mono">{entry.module}</span>
                  {entry.kind && <Badge variant="secondary" className="text-xs">{entry.kind}</Badge>}
                  <Badge variant="outline" className={`text-xs ${STATE_CLASSES[state]}`}>
                    {STATE_LABELS[state]}
                  </Badge>
                  {current?.consistent === false && (
                    <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
                      团队内版本不一致
                    </Badge>
                  )}
                  {current?.loaded === false && (
                    <Badge variant="outline" className="text-xs text-muted-foreground">未加载</Badge>
                  )}
                  <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                    <span>当前 <span className="font-mono">{installedVersionsLabel(current?.versions)}</span></span>
                    <span>最新 <span className="font-mono">{entry.latest ?? '—'}</span></span>
                    {canUpdate && (
                      <Button size="sm" className="h-7" onClick={() => setPending({ entry, installed: current })}>
                        <ArrowUpCircle className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                        更新
                      </Button>
                    )}
                  </span>
                </div>
                {entry.note && <p className="text-xs text-muted-foreground">{entry.note}</p>}
              </div>
            );
          })}

          {unmatched.length > 0 && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground mb-1">索引外的已安装模块（只读）</p>
              <div className="flex flex-wrap gap-1">
                {unmatched.map((row) => (
                  <Badge key={row.module} variant="outline" className="text-xs font-mono">
                    {row.module}{row.versions.length > 0 ? `@${row.versions.join('/')}` : ''}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <AlertDialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open && !installing) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认更新模块</AlertDialogTitle>
            <AlertDialogDescription>
              将把{TARGET_LABELS[targetKind]}「{selectedTarget}」的模块
              <span className="font-mono"> {pending?.entry.module} </span>
              从 {installedVersionsLabel(pending?.installed?.versions)} 更新到
              <span className="font-mono"> {pending?.entry.latest} </span>
              （{channel} 通道）。更新会下载并校验发布包，然后推送到目标运行时。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={installing}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void runInstall();
              }}
              disabled={installing}
            >
              {installing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" aria-hidden="true" /> : null}
              确认更新
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
