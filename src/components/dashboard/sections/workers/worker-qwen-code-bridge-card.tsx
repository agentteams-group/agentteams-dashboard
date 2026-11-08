'use client';

// Coding CLI 面板 QwenCode 卡内的「QwenPaw × QwenCode 桥」安装/更新栏。
//
// 口径与工作台 QwenCodeBridgeSection（release-1669）逐条对齐：状态标签 +
// 频道选择（stable/beta/alpha，默认 stable）+ 版本下拉 + 单个安装/更新/降级
// 按钮——不逐版本渲染按钮。纯逻辑在 @/lib/qwen-code-bridge（可单测）。
//
// 显隐：仅 QwenPaw 运行时渲染（非 qwenpaw 整段不出现，不留 disabled 占位）。
// 数据面：GET /millforge/index（索引，模块键 qwenpaw-qwencode-bridge）+
// GET /workers/{name}/plugins（已装，plugin id qwen-code-bridge）+
// POST /workers/{name}/plugins/install（安装）。

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { agentteamsApi, type WorkerRuntime } from '@/lib/agentteams-api';
import { ApiError, formatErrorMessage } from '@/lib/api-error';
import {
  BRIDGE_CHANNELS,
  BRIDGE_DEFAULT_CHANNEL,
  BRIDGE_MODULE_KEY,
  BRIDGE_REF,
  BRIDGE_REPO,
  BRIDGE_SOURCE,
  bridgeDirection,
  bridgeHasAction,
  bridgeInstallBody,
  bridgeInstallErrorText,
  bridgeInstalledVersion,
  bridgeModuleFromIndex,
  bridgeOptions,
  bridgeState,
  bridgeVersions,
  showQwenCodeBridge,
  type BridgeChannel,
  type BridgeModule,
  type BridgeState,
} from '@/lib/qwen-code-bridge';
import { toast } from 'sonner';

type Props = {
  workerName: string;
  runtime?: WorkerRuntime;
  /** 安装/更新成功后通知父级（抽屉刷新详情）。 */
  onChanged?: () => void;
};

const STATUS_LABEL: Record<BridgeState, string> = {
  'not-installed': '未装',
  'update-available': '可更新',
  'up-to-date': '已是最新',
  ahead: '该频道无更新',
  'no-versions': '该频道暂无版本',
};

const STATUS_CLASS: Record<BridgeState, string> = {
  'not-installed': 'border-transparent bg-muted text-muted-foreground',
  'update-available': 'border-transparent bg-status-waiting/15 text-status-waiting',
  'up-to-date': 'border-transparent bg-status-done/15 text-status-done',
  ahead: 'border-transparent bg-status-info/15 text-status-info',
  'no-versions': 'border-transparent bg-muted text-muted-foreground',
};

/** 非 qwenpaw 整段不渲染：外层只做判据，状态/请求都在内层组件里。 */
export function WorkerQwenCodeBridgeCard(props: Props) {
  if (!showQwenCodeBridge(props.runtime)) return null;
  return <QwenCodeBridgeBody workerName={props.workerName} onChanged={props.onChanged} />;
}

function QwenCodeBridgeBody({ workerName, onChanged }: Omit<Props, 'runtime'>) {
  const [channel, setChannel] = useState<BridgeChannel>(BRIDGE_DEFAULT_CHANNEL);
  const [module, setModule] = useState<BridgeModule | null>(null);
  const [indexLoading, setIndexLoading] = useState(true);
  const [indexError, setIndexError] = useState('');
  const [installed, setInstalled] = useState<string | null>(null);
  const [pluginsNote, setPluginsNote] = useState('');
  const [selectedVersion, setSelectedVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [installError, setInstallError] = useState('');
  const aliveRef = useRef(true);
  const indexReqRef = useRef(0);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const loadPlugins = useCallback(async () => {
    try {
      const plugins = await agentteamsApi.getWorkerPlugins(workerName);
      if (!aliveRef.current) return;
      setPluginsNote('');
      setInstalled(bridgeInstalledVersion(plugins));
    } catch (err) {
      if (!aliveRef.current) return;
      setInstalled(null);
      setPluginsNote(
        err instanceof ApiError && (err.status === 404 || err.status === 403)
          ? '该 Worker 未提供插件列表（无法检测已装版本）'
          : `已装版本读取失败：${formatErrorMessage(err)}`,
      );
    }
  }, [workerName]);

  const loadIndex = useCallback(async (target: BridgeChannel) => {
    const reqId = indexReqRef.current + 1;
    indexReqRef.current = reqId;
    setIndexLoading(true);
    setIndexError('');
    try {
      const index = await agentteamsApi.getMillforgeIndex({
        source: BRIDGE_SOURCE,
        repo: BRIDGE_REPO,
        ref: BRIDGE_REF,
        channel: target,
      });
      if (!aliveRef.current || reqId !== indexReqRef.current) return;
      setModule(bridgeModuleFromIndex(index));
    } catch (err) {
      if (!aliveRef.current || reqId !== indexReqRef.current) return;
      setModule(null);
      setIndexError(formatErrorMessage(err, '索引获取失败'));
    } finally {
      if (aliveRef.current && reqId === indexReqRef.current) setIndexLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  // 切频道：重拉该频道索引并重置版本选择（不整卡 reload）。
  useEffect(() => {
    setSelectedVersion('');
    setInstallError('');
    void loadIndex(channel);
  }, [channel, loadIndex]);

  const versions = bridgeVersions(module);
  const state = bridgeState({ installedVersion: installed, versions, latest: module?.latest });
  const options = bridgeOptions(versions, installed);
  const defaultVersion = options.find((option) => option.defaultSelected)?.version ?? '';
  const activeVersion =
    options.find((option) => option.version === selectedVersion && !option.disabled)?.version ??
    defaultVersion;
  const target = versions.find((version) => version.version === activeVersion) ?? null;
  const direction = bridgeDirection(activeVersion, installed);
  const actionLabel =
    direction === 'update' ? '更新' : direction === 'downgrade' ? '降级' : '安装';
  const selectable = options.some((option) => !option.disabled);

  const doInstall = async () => {
    if (!target || busy) return;
    setBusy(true);
    setInstallError('');
    const currentDirection = bridgeDirection(target.version, installed);
    try {
      await agentteamsApi.installWorkerPlugin(workerName, bridgeInstallBody(target, channel));
      if (!aliveRef.current) return;
      setInstalled(target.version);
      toast.success(
        currentDirection === 'update'
          ? `QwenPaw × QwenCode 桥已更新到 ${target.version}`
          : currentDirection === 'downgrade'
            ? `QwenPaw × QwenCode 桥已降级到 ${target.version}`
            : `QwenPaw × QwenCode 桥已安装 ${target.version}`,
      );
      onChanged?.();
      // 写成功后重拉已装列表；刷新失败保留本次安装版本，下次展开重拉。
      try {
        const plugins = await agentteamsApi.getWorkerPlugins(workerName);
        if (aliveRef.current) {
          setInstalled(bridgeInstalledVersion(plugins) ?? target.version);
        }
      } catch {
        // 保留乐观值
      }
    } catch (err) {
      if (!aliveRef.current) return;
      const status = err instanceof ApiError ? err.status : 0;
      const text = bridgeInstallErrorText(status, err instanceof Error ? err.message : '');
      setInstallError(text);
      toast.error(text);
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  return (
    <Card className="gap-0 py-0" aria-label="QwenPaw × QwenCode 桥">
      <CardContent className="space-y-2 p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold">QwenPaw × QwenCode 桥</span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {BRIDGE_MODULE_KEY}
          </span>
          <span className="ml-auto flex items-center gap-1">
            {indexLoading ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                索引加载中
              </span>
            ) : (
              <Badge className={`text-xs ${STATUS_CLASS[state]}`} aria-label="桥安装状态">
                {state === 'ahead' && installed
                  ? `已装 ${installed}`
                  : STATUS_LABEL[state]}
              </Badge>
            )}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">频道</span>
          <Select
            value={channel}
            onValueChange={(value) => setChannel(value as BridgeChannel)}
            disabled={busy}
          >
            <SelectTrigger size="sm" className="min-w-28 text-xs" aria-label="发布频道">
              {/* 直接给 children：未展开过下拉时 Radix 不会回填选中项文本 */}
              <SelectValue>{channel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {BRIDGE_CHANNELS.map((item) => (
                <SelectItem key={item} value={item} className="text-xs">
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            className="px-3 text-xs"
            disabled={busy || indexLoading}
            onClick={() => void loadIndex(channel)}
          >
            <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
            刷新
          </Button>
        </div>

        {!indexLoading && state === 'ahead' && (
          <p className="text-xs text-muted-foreground">
            该频道无更新（已装 {installed} 高于索引最新 {module?.latest ?? '—'}）。
          </p>
        )}

        {!indexLoading && state === 'no-versions' && (
          <p className="text-xs text-muted-foreground">
            {installed ? `该频道暂无可用版本（已装 ${installed}）。` : '该频道暂无可用版本。'}
          </p>
        )}

        {indexError && (
          <Alert variant="destructive" className="p-2">
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            <AlertTitle className="flex flex-wrap items-center gap-2 text-xs">
              索引获取失败 · 重试
              <Button
                variant="outline"
                size="sm"
                className="px-3 text-xs"
                disabled={busy || indexLoading}
                onClick={() => void loadIndex(channel)}
              >
                重试
              </Button>
            </AlertTitle>
            <AlertDescription className="text-xs">{indexError}</AlertDescription>
          </Alert>
        )}

        {pluginsNote && <p className="text-xs text-muted-foreground">{pluginsNote}</p>}

        {!indexLoading && bridgeHasAction(state) && selectable && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              value={activeVersion || undefined}
              onValueChange={setSelectedVersion}
              disabled={busy}
            >
              <SelectTrigger size="sm" className="w-full text-xs sm:flex-1" aria-label="目标版本">
                <SelectValue placeholder="选择版本">
                  {activeVersion || undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem
                    key={option.version}
                    value={option.version}
                    disabled={option.disabled}
                    className="text-xs"
                  >
                    {option.current
                      ? `${option.version} · 当前`
                      : option.disabled
                        ? `${option.version} · 不可用`
                        : option.version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="h-11 w-full text-sm sm:w-auto"
              disabled={busy || !activeVersion}
              aria-busy={busy}
              onClick={() => void doInstall()}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="h-4 w-4" aria-hidden="true" />
              )}
              {actionLabel}
              {target ? ` ${target.version}` : ''}
            </Button>
          </div>
        )}

        {installError && (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            {installError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
