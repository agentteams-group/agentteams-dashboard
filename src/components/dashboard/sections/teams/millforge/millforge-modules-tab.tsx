'use client';

// 千锻弹窗「模块更新」tab——三平面（团队 / manager / worker，团队面默认
// 当前团队）：发布索引（GET /millforge/index）× 已装注册表（teams/{name}/
// modules、workers|managers/{name}/plugins）。每个模块一行：状态标签
// （可更新 / 已是最新 / 版本不一致）+ 单个版本下拉 + 单个安装/更新按钮
// （不逐版本堆按钮）。安装复用 Controller 现有 install 端点，执行前二次确认。
// 旧 Controller 无该读端点（404/405）→ 该平面显示「控制器不支持」，不影响其它 tab。
//
// CodingCLI 桥（qwenpaw-qwencode-bridge / pluginId qwen-code-bridge）不在此面：
// 它只服务 QwenPaw × QwenCode，安装/更新入口固定在 CodingCLI → QwenCode 卡，
// 索引里有也要过滤掉，避免同一模块两处入口版本打架。

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Download, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { agentteamsApi, type MillforgeIndexQuery, type ModuleInstallRequest } from '@/lib/agentteams-api';
import { isCodingCliBridgeModule } from '@/lib/qwen-code-bridge';
import { ApiError } from '@/lib/api-error';
import { formatErrorMessage } from '@/lib/api-error';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useManagers } from '@/hooks/use-agentteams-managers';
import {
  buildModuleVersionOptions,
  indexModules,
  installedVersionsLabel,
  moduleInstallDirection,
  moduleUpdateState,
  pickDefaultModuleVersion,
  type IndexModule,
  type MillforgeModuleEntry,
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
  module: string;
  name?: string;
  versions: string[];
  consistent?: boolean;
  loaded?: boolean;
  members?: { worker: string; version?: string; loaded: boolean }[];
}

const STATE_LABELS: Record<ModuleUpdateState | 'inconsistent', string> = {
  'update-available': '可更新',
  uptodate: '已是最新',
  'not-installed': '未安装',
  unknown: '未知',
  inconsistent: '版本不一致',
};

const STATE_CLASSES: Record<ModuleUpdateState | 'inconsistent', string> = {
  'update-available': 'text-amber-600 dark:text-amber-400 border-amber-500/40',
  uptodate: 'text-emerald-600 dark:text-emerald-400 border-emerald-500/40',
  'not-installed': 'text-muted-foreground',
  unknown: 'text-muted-foreground',
  inconsistent: 'text-amber-600 dark:text-amber-400 border-amber-500/40',
};

/** 404/405 = Controller 尚未提供该路由（旧版本）→ 诚实降级。 */
function isUnsupported(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 405);
}

async function loadInstalled(kind: TargetKind, name: string): Promise<InstalledRow[]> {
  if (kind === 'team') {
    const { modules } = await agentteamsApi.getTeamModules(name);
    return (modules ?? []).map((module) => ({
      module: module.module,
      name: module.name,
      versions: Object.keys(module.versions ?? {}),
      consistent: module.consistent,
      members: module.members,
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

interface PendingInstall {
  entry: IndexModule;
  version: string;
  currentVersion: string | null;
  installedLabel: string;
}

function ModuleRow({
  entry,
  rawEntry,
  installed,
  canInstall,
  onStart,
}: {
  entry: IndexModule;
  rawEntry: MillforgeModuleEntry | undefined;
  installed: InstalledRow | undefined;
  canInstall: boolean;
  onStart: (_target: {
    entry: IndexModule;
    version: string;
    currentVersion: string | null;
    installedLabel: string;
  }) => void;
}) {
  const versions = installed?.versions ?? [];
  const currentVersion = versions.length === 1 ? versions[0] : null;
  const state: ModuleUpdateState | 'inconsistent' =
    installed?.consistent === false
      ? 'inconsistent'
      : moduleUpdateState(versions, entry.latest);
  const options = buildModuleVersionOptions(rawEntry, currentVersion);
  const [picked, setPicked] = useState<string | null>(() => pickDefaultModuleVersion(options));
  const versionKey = options.map((option) => option.value).join(',');

  useEffect(() => {
    setPicked(pickDefaultModuleVersion(buildModuleVersionOptions(rawEntry, currentVersion)));
  }, [versionKey, currentVersion, rawEntry]);

  const pickable =
    state === 'update-available' || state === 'not-installed' || state === 'inconsistent';
  const pickedDisabled = !!options.find((option) => option.value === picked)?.disabled;
  const direction = picked ? moduleInstallDirection(picked, currentVersion) : 'install';
  const actionLabel = state === 'inconsistent'
    ? '统一到此版本'
    : direction === 'install'
      ? '安装'
      : direction === 'downgrade'
        ? '降级'
        : '更新';
  const isRunner = entry.kind === 'runner';

  return (
    <div className="space-y-1.5 rounded-lg border p-2.5" data-testid={`module-row-${entry.module}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium">{entry.module}</span>
        {entry.pluginId && entry.pluginId !== entry.module ? (
          <span className="font-mono text-xs text-muted-foreground">{entry.pluginId}</span>
        ) : null}
        {entry.kind ? (
          <Badge variant="secondary" className="text-xs">
            {isRunner ? 'runner（不可安装）' : entry.kind}
          </Badge>
        ) : null}
        <Badge variant="outline" className={`text-xs ${STATE_CLASSES[state]}`}>
          {STATE_LABELS[state]}
        </Badge>
        {installed?.consistent === false ? (
          <Badge variant="outline" className={`text-xs ${STATE_CLASSES.inconsistent}`}>
            团队内版本不一致
          </Badge>
        ) : null}
        {installed?.loaded === false ? (
          <Badge variant="outline" className="text-xs text-muted-foreground">
            未加载
          </Badge>
        ) : null}
        <span className="ml-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            当前 <span className="font-mono">{installedVersionsLabel(versions)}</span>
          </span>
          <span>
            最新 <span className="font-mono">{entry.latest ?? '—'}</span>
          </span>
        </span>
      </div>

      {installed?.members && installed.members.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {installed.members.map((member) => (
            <span key={member.worker} className="inline-flex items-center gap-1">
              <span
                className={`size-1.5 rounded-full ${member.loaded ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
                aria-hidden="true"
              />
              <span className="font-mono">{member.worker}</span>
              <span className="font-mono text-muted-foreground">{member.version || '—'}</span>
            </span>
          ))}
        </div>
      ) : null}

      {entry.note ? <p className="text-xs text-muted-foreground">{entry.note}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        {!isRunner && pickable && options.length > 0 ? (
          <>
            <Select value={picked ?? undefined} onValueChange={setPicked}>
              <SelectTrigger className="h-9 min-w-40 text-xs" aria-label={`${entry.module} 版本`}>
                <SelectValue placeholder="选择版本" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className="text-xs"
                  >
                    {option.value}
                    {option.reason === 'current'
                      ? '（当前）'
                      : option.reason === 'unavailable'
                        ? '（不可用）'
                        : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-9 min-h-9 min-w-24"
              disabled={!canInstall || !picked || pickedDisabled}
              onClick={() => {
                if (!picked) return;
                onStart({
                  entry,
                  version: picked,
                  currentVersion,
                  installedLabel: installedVersionsLabel(versions),
                });
              }}
            >
              <Download className="size-3.5" aria-hidden="true" />
              {actionLabel}
            </Button>
          </>
        ) : null}
        {!canInstall && pickable ? (
          <span className="text-xs text-muted-foreground">更新需要管理员（L1）权限。</span>
        ) : null}
        {isRunner ? (
          <span className="text-xs text-muted-foreground">runner 模块不通过插件安装。</span>
        ) : null}
        {!isRunner && pickable && options.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            索引中无版本条目（制品/校验字段缺失），暂不可安装。
          </span>
        ) : null}
        {state === 'uptodate' ? (
          <span className="text-xs text-muted-foreground">已是最新，无需操作。</span>
        ) : null}
        {state === 'unknown' && !isRunner ? (
          <span className="text-xs text-muted-foreground">索引未给出可更新版本。</span>
        ) : null}
      </div>
    </div>
  );
}

export function MillforgeModulesTab({
  defaultTeam,
  canInstall,
}: {
  /** 团队面默认目标（团队抽屉 = 当前团队）。 */
  defaultTeam: string;
  canInstall: boolean;
}) {
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState<ReleaseChannel>('beta');
  const [targetKind, setTargetKind] = useState<TargetKind>('team');
  const [teamName, setTeamName] = useState(defaultTeam);
  const [workerName, setWorkerName] = useState('');
  const [managerName, setManagerName] = useState('');
  const [pending, setPending] = useState<PendingInstall | null>(null);
  const [installing, setInstalling] = useState(false);

  const { data: teams } = useTeams();
  const { data: workers } = useWorkers();
  const { data: managers } = useManagers();

  const teamOptions = useMemo(
    () => [...(teams ?? []).map((team) => team.name)].sort((a, b) => a.localeCompare(b)),
    [teams],
  );
  const workerOptions = useMemo(
    () => [...(workers ?? []).map((worker) => worker.name)].sort((a, b) => a.localeCompare(b)),
    [workers],
  );
  const managerOptions = useMemo(
    () => [...(managers ?? []).map((manager) => manager.name)].sort((a, b) => a.localeCompare(b)),
    [managers],
  );

  // 团队面默认当前团队；列表里没有该团队时仍用它（抽屉来源即团队 CR）。
  const target = targetKind === 'team' ? teamName : targetKind === 'worker' ? workerName : managerName;
  const targetOptions =
    targetKind === 'team' ? teamOptions : targetKind === 'worker' ? workerOptions : managerOptions;

  const indexQuery = useQuery({
    queryKey: ['millforge-index', channel],
    queryFn: () => agentteamsApi.getMillforgeIndex({ source: 'github', channel }),
    retry: 1,
    staleTime: 60_000,
  });

  const installedQuery = useQuery({
    queryKey: ['module-installed', targetKind, target],
    queryFn: () => loadInstalled(targetKind, target),
    enabled: !!target,
    retry: 1,
  });

  const installed = useMemo(
    () => (installedQuery.data ?? []).filter((row) => !isCodingCliBridgeModule(row.module)),
    [installedQuery.data],
  );
  const entries = useMemo(
    () =>
      indexModules(indexQuery.data).filter(
        (entry) => !isCodingCliBridgeModule(entry.module, entry.pluginId),
      ),
    [indexQuery.data],
  );

  const rows = useMemo(() => {
    const byKey = new Map(installed.map((row) => [row.module, row] as const));
    return entries.map((entry) => ({
      entry,
      rawEntry: indexQuery.data?.modules?.[entry.module],
      installed: byKey.get(entry.module) ?? byKey.get(entry.pluginId),
    }));
  }, [entries, installed, indexQuery.data]);

  const unmatched = useMemo(
    () =>
      installed.filter(
        (row) =>
          !entries.some((entry) => entry.module === row.module || entry.pluginId === row.module),
      ),
    [entries, installed],
  );

  const runInstall = async () => {
    if (!pending || !target) return;
    setInstalling(true);
    try {
      const body: ModuleInstallRequest = {
        module: pending.entry.module,
        source: 'github',
        channel,
        version: pending.version,
      };
      const result = targetKind === 'team'
        ? await agentteamsApi.installTeamModule(target, pending.entry.module, body)
        : targetKind === 'worker'
          ? await agentteamsApi.installWorkerPlugin(target, body)
          : await agentteamsApi.installManagerPlugin(target, body);
      const memberCount = result.updated?.length ?? 0;
      toast.success(
        `模块「${pending.entry.module}」已更新${memberCount > 0 ? `（${memberCount} 个成员）` : ''}`,
      );
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: ['module-installed'] });
    } catch (error) {
      toast.error(`模块更新失败：${formatErrorMessage(error)}`);
    } finally {
      setInstalling(false);
    }
  };

  const indexUnsupported = isUnsupported(indexQuery.error);
  const installedUnsupported = isUnsupported(installedQuery.error);

  return (
    <div className="space-y-3" data-testid="millforge-modules-tab">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">发布通道</Label>
          <Select value={channel} onValueChange={(value) => setChannel(value as ReleaseChannel)}>
            <SelectTrigger className="h-8 w-24 text-xs" aria-label="发布通道">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNELS.map((value) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">目标类型</Label>
          <Select
            value={targetKind}
            onValueChange={(value) => setTargetKind(value as TargetKind)}
          >
            <SelectTrigger className="h-8 w-28 text-xs" aria-label="目标类型">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TARGET_LABELS) as TargetKind[]).map((kind) => (
                <SelectItem key={kind} value={kind} className="text-xs">
                  {TARGET_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{TARGET_LABELS[targetKind]}</Label>
          <Select
            value={target || undefined}
            onValueChange={(value) => {
              if (targetKind === 'team') setTeamName(value);
              else if (targetKind === 'worker') setWorkerName(value);
              else setManagerName(value);
            }}
            disabled={targetOptions.length === 0}
          >
            <SelectTrigger className="h-8 w-44 text-xs" aria-label={TARGET_LABELS[targetKind]}>
              <SelectValue placeholder={targetOptions.length === 0 ? '暂无可选目标' : '选择目标'} />
            </SelectTrigger>
            <SelectContent>
              {targetOptions.map((name) => (
                <SelectItem key={name} value={name} className="text-xs">
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={indexQuery.isFetching || installedQuery.isFetching}
          onClick={() => {
            void indexQuery.refetch();
            void installedQuery.refetch();
          }}
        >
          <RefreshCw
            className={`size-3.5 ${indexQuery.isFetching || installedQuery.isFetching ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          刷新
        </Button>
      </div>

      {indexQuery.isLoading ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          正在读取发布索引…
        </p>
      ) : null}

      {indexQuery.isError ? (
        <Alert variant={indexUnsupported ? 'default' : 'destructive'} className="py-2">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>{indexUnsupported ? '控制器不支持' : '发布索引读取失败'}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2 text-xs">
            <span>
              {indexUnsupported
                ? '当前 Controller 未提供 /millforge/index（404/405）——升级 Controller 后可用。'
                : formatErrorMessage(indexQuery.error)}
            </span>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void indexQuery.refetch()}>
              重试
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {installedQuery.isError ? (
        <Alert variant={installedUnsupported ? 'default' : 'destructive'} className="py-2">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>{installedUnsupported ? '控制器不支持' : '已安装模块读取失败'}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2 text-xs">
            <span>
              {installedUnsupported
                ? `当前 Controller 未提供 ${TARGET_LABELS[targetKind]} 模块读端点（404/405）——升级 Controller 后可用。`
                : formatErrorMessage(installedQuery.error)}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void installedQuery.refetch()}
            >
              重试
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!target ? <p className="text-xs text-muted-foreground">请选择一个目标以查看已安装版本。</p> : null}

      {!indexQuery.isLoading && !indexQuery.isError ? (
        <div className="space-y-2">
          {rows.length === 0 ? <p className="text-xs text-muted-foreground">索引中暂无模块</p> : null}
          {rows.map(({ entry, rawEntry, installed: current }) => (
            <ModuleRow
              key={entry.module}
              entry={entry}
              rawEntry={rawEntry}
              installed={current}
              canInstall={canInstall}
              onStart={(next) => setPending(next)}
            />
          ))}
          {unmatched.length > 0 ? (
            <div className="space-y-1 pt-1">
              <p className="text-xs text-muted-foreground">索引外的已安装模块（只读）</p>
              <div className="flex flex-wrap gap-1">
                {unmatched.map((row) => (
                  <Badge key={row.module} variant="outline" className="font-mono text-xs">
                    {row.module}
                    {row.versions.length > 0 ? `@${row.versions.join('/')}` : ''}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <AlertDialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open && !installing) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending
                ? `${moduleInstallDirection(pending.version, pending.currentVersion) === 'install' ? '安装' : '更新'} ${pending.entry.module}`
                : '确认更新模块'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              将把{TARGET_LABELS[targetKind]}「{target}」的模块
              <span className="font-mono"> {pending?.entry.module} </span>
              从 {pending?.installedLabel ?? '未安装'} 更新到
              <span className="font-mono"> {pending?.version} </span>（{channel} 通道）。更新会下载并校验发布包，
              然后推送到目标运行时。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={installing}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={installing}
              onClick={(event) => {
                event.preventDefault();
                void runInstall();
              }}
            >
              {installing ? (
                <Loader2 className="mr-1 size-4 animate-spin" aria-hidden="true" />
              ) : null}
              确认更新
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
