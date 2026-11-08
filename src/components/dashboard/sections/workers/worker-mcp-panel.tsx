'use client';

// Worker MCP 面板（只读合并视图，与工作台插件右栏 WorkerMcpPanel 对齐）：
// - declared = worker detail `spec.mcpServers`（props 传入，Controller 透传）；
// - self-registered = GET /api/agentteams/workers/{name}/mcp（Next 代理
//   Controller 的 worker MCP 注册表只读端点，200 响应已在服务端脱敏）。
//
// 合并按 name：同一 name 一行 + 双来源徽标（声明 / 注册）；字段冲突自注册
// 优先（运行时注册是真相）。env/headers 只显示键名，值恒 ***；url 剥内嵌
// 凭据；command/args 的 home 路径换 ~（归一化已在 lib 做过，这里是兜底）。
//
// 诚实降级：404（Controller 未提供该端点）/ 401（无凭据）/ 403（无权限）/
// 400/503（非 qwenpaw 运行时或部署形态不支持）→ 一行 info，declared 照常
// 显示，不宣称「无 MCP」；其余错误（5xx/网络）→ 一行 warning + 重试。
//
// 只读：无编辑/保存入口；刷新按钮只重拉自注册一路。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  fetchWorkerMcp,
  type WorkerMcpResult,
  type WorkerResponse,
} from '@/lib/agentteams-api';
import { shortErrorMessage } from '@/lib/api-error';
import {
  mergeWorkerMcpRows,
  workerMcpEndpoint,
  workerMcpTransport,
} from '@/lib/worker-mcp';

function degradeMessage(reason: string | undefined): string {
  switch (reason) {
    case 'controller_too_old':
      return '当前 controller 不支持读取 worker 自注册 MCP（需升级 controller）';
    case 'no_token':
      return '未配置 controller 凭据，暂不能读取 worker 自注册 MCP';
    case 'forbidden':
      return '当前账号无权限读取 worker 自注册 MCP，仅显示 CRD 声明';
    case 'unsupported':
      return '当前部署或运行时不支持读取 worker 自注册 MCP，仅显示 CRD 声明';
    default:
      return `读取 worker 自注册 MCP 失败（${reason || 'unknown'}），仅显示 CRD 声明`;
  }
}

/** 只读 MCP 合并视图。挂载即拉自注册一路（抽屉折叠卡保证展开才挂载）。 */
export function WorkerMcpPanel({ worker }: { worker: WorkerResponse }) {
  const [self, setSelf] = useState<WorkerMcpResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setSelf(await fetchWorkerMcp(worker.name));
    } catch (err) {
      setLoadError(shortErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [worker.name]);

  // load 的 catch 分支含 setState——延迟一个宏任务，避免 effect 同步阶段进入
  // setState 链（react-hooks/set-state-in-effect，同其他 worker 面板惯例）。
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const rows = useMemo(
    () => mergeWorkerMcpRows(worker.mcpServers, self?.items),
    [worker.mcpServers, self],
  );
  const degraded = self != null && !self.available;
  // 空态只在两路都读成功且真的为空时成立：降级/失败是「读不到」而非「没有」。
  const empty = !loading && !loadError && !degraded && rows.length === 0;

  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          CRD 声明（spec.mcpServers）+ worker 自注册（容器启动时注册进 QwenPaw 的 MCP）。
          env/headers 仅显示键名，值已脱敏。
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-2 text-xs"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw className={`mr-1 h-3 w-3 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          刷新
        </Button>
      </div>

      {degraded && self && (
        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{degradeMessage(self.reason)}</span>
        </div>
      )}

      {loadError && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">读取 worker 自注册 MCP 失败：{loadError}</span>
        </div>
      )}

      {loading && !self && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          自注册 MCP 加载中…
        </p>
      )}

      {empty && <p className="text-xs text-muted-foreground">无 MCP server</p>}

      {rows.length > 0 && (
        <ul className="space-y-1">
          {rows.map((row) => {
            const endpoint = workerMcpEndpoint(row);
            const transport = workerMcpTransport(row);
            const envKeys = row.self?.envKeys ?? [];
            const headerKeys = row.self?.headerKeys ?? [];
            return (
              <li key={row.name} className="space-y-1 rounded-md border px-2 py-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className="max-w-full truncate font-mono text-xs font-medium"
                    title={row.name}
                  >
                    {row.self?.displayName || row.name}
                  </span>
                  {row.declared && (
                    <Badge
                      variant="outline"
                      className="h-4 border-blue-500/40 bg-blue-500/10 px-1 text-[10px] text-blue-700 dark:text-blue-300"
                    >
                      声明
                    </Badge>
                  )}
                  {row.self && (
                    <Badge
                      variant="outline"
                      className="h-4 border-emerald-500/40 bg-emerald-500/10 px-1 text-[10px] text-emerald-700 dark:text-emerald-400"
                    >
                      注册
                    </Badge>
                  )}
                  {row.self?.enabled === false && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      停用
                    </Badge>
                  )}
                  {transport && (
                    <Badge variant="secondary" className="h-4 px-1 font-mono text-[10px]">
                      {transport}
                    </Badge>
                  )}
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
                    title={endpoint}
                  >
                    {endpoint || '（无端点）'}
                  </span>
                </div>
                {envKeys.length > 0 && (
                  <p className="truncate font-mono text-xs text-muted-foreground" title="值已脱敏">
                    env: {envKeys.map((key) => `${key}=***`).join('  ')}
                  </p>
                )}
                {headerKeys.length > 0 && (
                  <p className="truncate font-mono text-xs text-muted-foreground" title="值已脱敏">
                    headers: {headerKeys.map((key) => `${key}=***`).join('  ')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
