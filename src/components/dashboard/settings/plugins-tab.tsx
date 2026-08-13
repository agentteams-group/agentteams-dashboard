'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Puzzle,
  Loader2,
  Trash2,
  RefreshCw,
  DownloadCloud,
  Upload,
  FileJson,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { selectPluginList, usePluginRegistry } from '@/lib/plugins/registry';
import { pluginManager } from '@/lib/plugins/manager';
import {
  EXTENSION_POINT_LABELS,
  type ExtensionPointId,
  type PluginRecord,
} from '@/lib/plugins/types';

/**
 * Settings → 插件 tab: install / enable / disable / uninstall plugins and
 * inspect their status.
 */

const STATUS_LABELS: Record<PluginRecord['status'], string> = {
  installed: '已安装',
  enabled: '加载中',
  active: '运行中',
  disabled: '已停用',
  error: '错误',
};

export function PluginsTab() {
  const records = usePluginRegistry((s) => s.records);
  const disabledIds = usePluginRegistry((s) => s.disabledIds);
  const ready = usePluginRegistry((s) => s.ready);
  const [installUrl, setInstallUrl] = useState('');
  const [installing, setInstalling] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const plugins = selectPluginList({ records });

  const handleInstall = async () => {
    const url = installUrl.trim();
    if (!url) return;
    setInstalling(true);
    try {
      const record = await pluginManager.installFromUrl(url);
      toast.success(`插件「${record.manifest.name}」安装成功`);
      setInstallUrl('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '插件安装失败');
    } finally {
      setInstalling(false);
    }
  };

  const handleUploadFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const record = await pluginManager.installFromManifestJson(parsed, {
        manifestUrl: `uploaded://${file.name}`,
      });
      toast.success(`插件「${record.manifest.name}」上传并安装成功`);
    } catch (err) {
      if (err instanceof SyntaxError) {
        toast.error('plugin.json 不是合法的 JSON');
      } else {
        toast.error(err instanceof Error ? err.message : '插件上传失败');
      }
    }
  };

  const handleDownloadManifest = (record: PluginRecord) => {
    const manifest = record.manifest;
    const blob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${manifest.id}-${manifest.version}.plugin.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`已下载「${manifest.name}」的清单`);
  };

  const handleToggle = async (record: PluginRecord, nextEnabled: boolean) => {
    setBusyId(record.manifest.id);
    try {
      if (nextEnabled) {
        await pluginManager.enable(record.manifest.id);
        const after = usePluginRegistry.getState().records[record.manifest.id];
        if (after?.status === 'error') {
          toast.error(`插件激活失败: ${after.error ?? '未知错误'}`);
        } else {
          toast.success(`插件「${record.manifest.name}」已启用`);
        }
      } else {
        await pluginManager.disable(record.manifest.id);
        toast.success(`插件「${record.manifest.name}」已停用`);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleUninstall = async (record: PluginRecord) => {
    setBusyId(record.manifest.id);
    try {
      await pluginManager.uninstall(record.manifest.id);
      toast.success(`插件「${record.manifest.name}」已卸载`);
    } finally {
      setBusyId(null);
    }
  };

  const handleReload = async (record: PluginRecord) => {
    setBusyId(record.manifest.id);
    try {
      await pluginManager.reload(record.manifest.id);
      toast.success(`插件「${record.manifest.name}」已重新加载`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Install from URL */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <DownloadCloud className="w-3.5 h-3.5" />
          从 URL 安装插件
        </Label>
        <div className="flex gap-2">
          <Input
            value={installUrl}
            onChange={(e) => setInstallUrl(e.target.value)}
            placeholder="https://example.com/my-plugin/plugin.json"
            className="flex-1"
          />
          <Button onClick={() => void handleInstall()} disabled={installing || !installUrl.trim()}>
            {installing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
            安装
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          指向插件的 plugin.json 清单文件。开发模式下可用 create-dashboard-plugin
          脚手架启动本地开发服务器后,将其地址填入此处联调。
        </p>
      </div>

      {/* Upload plugin.json from local file */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Upload className="w-3.5 h-3.5" />
          上传 plugin.json
        </Label>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUploadFile(file);
              e.target.value = '';
            }}
          />
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileJson className="w-3.5 h-3.5 mr-1" />
            选择文件并安装
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          直接选择本地的 plugin.json；清单验证通过后即与 URL 安装走同一通道。
        </p>
      </div>

      {/* Plugin list */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Puzzle className="w-3.5 h-3.5" />
          已安装插件（{plugins.length}）
        </Label>

        {!ready && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            正在发现并加载插件…
          </p>
        )}

        {plugins.length === 0 && ready && (
          <p className="text-xs text-muted-foreground">暂无插件</p>
        )}

        {plugins.map((record) => {
          const { manifest } = record;
          const enabled = !disabledIds.includes(manifest.id);
          const busy = busyId === manifest.id;
          return (
            <div
              key={manifest.id}
              className="rounded-lg border p-3 space-y-2"
              data-testid={`plugin-row-${manifest.id}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm flex-1 truncate">
                  {manifest.name}
                  <span className="text-xs text-muted-foreground ml-2">
                    v{manifest.version}
                  </span>
                </span>
                <Badge
                  variant={record.status === 'error' ? 'destructive' : 'outline'}
                  className="text-[10px]"
                >
                  {STATUS_LABELS[record.status]}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {record.source.kind === 'bundled' ? '内置' : 'URL'}
                </Badge>
                <Switch
                  checked={enabled}
                  disabled={busy}
                  onCheckedChange={(next) => void handleToggle(record, next)}
                  aria-label={`启用插件 ${manifest.name}`}
                />
              </div>

              {manifest.description && (
                <p className="text-xs text-muted-foreground">{manifest.description}</p>
              )}

              <div className="flex flex-wrap items-center gap-1">
                {(manifest.extensionPoints ?? []).map((point) => (
                  <Badge key={point} variant="outline" className="text-[9px] px-1 h-4">
                    {EXTENSION_POINT_LABELS[point as ExtensionPointId] ?? point}
                  </Badge>
                ))}
                <span className="ml-auto flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handleDownloadManifest(record)}
                    title="下载 plugin.json"
                  >
                    <DownloadCloud className="w-3.5 h-3.5" />
                  </Button>
                  {record.source.kind === 'url' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={busy}
                      onClick={() => void handleReload(record)}
                      title="重新加载"
                    >
                      {busy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  )}
                  {record.source.kind === 'url' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      disabled={busy}
                      onClick={() => void handleUninstall(record)}
                      title="卸载"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </span>
              </div>

              {record.status === 'error' && record.error && (
                <p className="text-xs text-destructive flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  <span className="break-all">{record.error}</span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
