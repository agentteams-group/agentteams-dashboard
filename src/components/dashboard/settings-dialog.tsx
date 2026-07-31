'use client';

import { useState, useEffect } from 'react';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { apiUrl } from '@/lib/api-base';
import { useTourState } from '@/components/onboarding/tour';
import { Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Wifi, WifiOff, Loader2, RotateCcw, Clock, Server, History, Stethoscope } from 'lucide-react';
import { useInfrastructure } from '@/hooks/use-agentteams-infrastructure';
import { TroubleshootTab } from './settings/troubleshoot-tab';
import { AlertSettingsPage } from './settings/alert-settings';

// Empty default means "use the server-side AGENTTEAMS_CONTROLLER_URL" so the same
// image works in embedded (localhost) and Kubernetes (in-cluster) modes.
const DEFAULT_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_AGENTTEAMS_CONTROLLER_URL) ||
  '';

export function SettingsDialog() {
  const {
    controllerUrl,
    setControllerUrl,
    isConnected,
    isChecking,
    connectionError,
    settingsOpen,
    closeSettings,
    autoReconnect,
    setAutoReconnect,
    reconnectInterval,
    setReconnectInterval,
    connectionLatency,
    lastConnectedAt,
    connectionHistory,
  } = useAgentTeamsStore();

  const { restartTour } = useTourState();

  const { data: infrastructure } = useInfrastructure();

  const [tempUrl, setTempUrl] = useState(controllerUrl);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latency: number | null;
    error: string | null;
    timestamp: number;
  } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const homeserverUrl = infrastructure?.matrix?.homeserver || null;

  const handleOpen = (open: boolean) => {
    if (open) {
      setTempUrl(controllerUrl);
      setTestResult(null);
    } else {
      closeSettings();
    }
  };

  const handleSave = () => {
    setControllerUrl(tempUrl);
    closeSettings();
  };

  // Test connection against tempUrl WITHOUT saving to global state
  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    const start = performance.now();
    try {
      const testPath = tempUrl.trim()
        ? `/api/agentteams/healthz/?controllerUrl=${encodeURIComponent(tempUrl)}`
        : '/api/agentteams/healthz/';
      const res = await fetch(apiUrl(testPath));
      const latency = Math.round(performance.now() - start);
      if (res.ok) {
        const text = await res.text();
        if (text.trim() === 'ok') {
          setTestResult({ success: true, latency, error: null, timestamp: Date.now() });
        } else {
          setTestResult({ success: false, latency, error: '响应异常', timestamp: Date.now() });
        }
      } else {
        setTestResult({ success: false, latency, error: `HTTP ${res.status}`, timestamp: Date.now() });
      }
    } catch (err) {
      const latency = Math.round(performance.now() - start);
      const message = err instanceof Error ? err.message : '连接失败';
      setTestResult({ success: false, latency, error: message, timestamp: Date.now() });
    } finally {
      setIsTesting(false);
    }
  };

  const handleReset = () => {
    setTempUrl(DEFAULT_URL);
    setTestResult(null);
  };

  return (
    <Dialog open={settingsOpen} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="connection" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="connection">连接</TabsTrigger>
            <TabsTrigger value="alerts">告警</TabsTrigger>
            <TabsTrigger value="troubleshoot">
              <Stethoscope className="w-3.5 h-3.5 mr-1" />
              AI 诊断
            </TabsTrigger>
          </TabsList>

          <TabsContent value="connection" className="space-y-5 py-4">
            {/* Controller URL */}
            <div className="space-y-2">
              <Label htmlFor="controller-url">Controller 地址</Label>
              <div className="flex gap-2">
                <Input
                  id="controller-url"
                  value={tempUrl}
                  onChange={(e) => { setTempUrl(e.target.value); setTestResult(null); }}
                  placeholder="留空以使用服务端配置 (AGENTTEAMS_CONTROLLER_URL)"
                  className="flex-1"
                />
                <Button variant="outline" size="icon" onClick={handleReset} title="重置为默认">
                  <RotateCcw className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Connection Status */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">连接状态：</span>
              {isConnected ? (
                <Badge variant="default" className="gap-1">
                  <Wifi className="w-3 h-3" />
                  已连接
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <WifiOff className="w-3 h-3" />
                  未连接
                </Badge>
              )}
              {isChecking && (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              )}
            </div>

            {connectionError && (
              <p className="text-sm text-destructive">{connectionError}</p>
            )}

            {/* Connection Latency */}
            {isConnected && connectionLatency !== null && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">连接延迟：</span>
                <Badge variant="outline" className="text-xs">
                  {connectionLatency}ms
                </Badge>
              </div>
            )}

            {/* Last Connected At */}
            {lastConnectedAt && (
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  上次连接: {new Date(lastConnectedAt).toLocaleTimeString('zh-CN')}
                </span>
              </div>
            )}

            {/* Matrix Homeserver URL */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Server className="w-3.5 h-3.5" />
                Matrix Homeserver
              </Label>
              {homeserverUrl ? (
                <Input
                  value={homeserverUrl}
                  readOnly
                  className="bg-muted text-muted-foreground"
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {isConnected ? '未从基础设施 API 获取到 Homeserver 地址' : '连接 Controller 后自动获取'}
                </p>
              )}
            </div>

            {/* Auto Reconnect */}
            <div className="flex items-center justify-between">
              <div>
                <Label>自动重连</Label>
                <p className="text-xs text-muted-foreground">断开连接时自动尝试重连（全局生效）</p>
              </div>
              <Switch
                checked={autoReconnect}
                onCheckedChange={setAutoReconnect}
              />
            </div>

            {/* Reconnect Interval */}
            {autoReconnect && (
              <div className="space-y-2 pl-1">
                <Label className="text-xs text-muted-foreground">重连间隔 (秒)</Label>
                <Input
                  type="number"
                  min={5}
                  max={120}
                  value={Math.round(reconnectInterval / 1000)}
                  onChange={(e) => {
                    const secs = parseInt(e.target.value, 10);
                    if (!isNaN(secs) && secs >= 5) {
                      setReconnectInterval(secs * 1000);
                    }
                  }}
                  className="w-24"
                />
              </div>
            )}

            {/* Test Result */}
            {testResult && (
              <div className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <Badge variant="default" className="gap-1">
                      <Wifi className="w-3 h-3" />
                      测试成功
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <WifiOff className="w-3 h-3" />
                      测试失败
                    </Badge>
                  )}
                  {testResult.latency !== null && (
                    <Badge variant="outline" className="text-xs">{testResult.latency}ms</Badge>
                  )}
                </div>
                {testResult.error && (
                  <p className="text-xs text-destructive">{testResult.error}</p>
                )}
                <p className="text-[10px] text-muted-foreground">
                  测试地址: {tempUrl} · {new Date(testResult.timestamp).toLocaleTimeString('zh-CN')}
                </p>
              </div>
            )}

            {/* Connection History */}
            {connectionHistory.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <History className="w-3.5 h-3.5 text-muted-foreground" />
                  <Label className="text-sm">连接历史</Label>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {connectionHistory.map((attempt, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-xs p-2 rounded-lg bg-muted/50"
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          attempt.success ? 'bg-emerald-500' : 'bg-red-500'
                        }`}
                      />
                      <span className="text-muted-foreground shrink-0">
                        {new Date(attempt.timestamp).toLocaleTimeString('zh-CN')}
                      </span>
                      <span className="truncate flex-1">{attempt.url}</span>
                      {attempt.latency !== null && (
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {attempt.latency}ms
                        </Badge>
                      )}
                      {attempt.error && (
                        <span className="text-destructive truncate shrink-0">{attempt.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Restart Tour */}
            <div className="flex items-center gap-3 pt-2 border-t">
              <Sparkles className="h-4 w-4 text-emerald-500 shrink-0" />
              <span className="text-sm text-muted-foreground">使用引导</span>
              <Button variant="outline" size="sm" onClick={restartTour} className="ml-auto">
                重新体验引导
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="alerts" className="py-4">
            <AlertSettingsPage />
          </TabsContent>

          <TabsContent value="troubleshoot" className="py-4">
            <TroubleshootTab />
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleTest} disabled={isTesting}>
            {isTesting ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Wifi className="w-4 h-4 mr-1" />
            )}
            测试连接
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
