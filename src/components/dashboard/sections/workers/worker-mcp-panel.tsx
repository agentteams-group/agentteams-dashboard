'use client';

// Worker MCP 面板（合并视图，与工作台插件右栏 WorkerMcpPanel 对齐）：
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
// 编辑：declared 一路可写（PUT /workers/{name} 只提交 mcpServers，避免整表单
// 覆盖别人刚改的字段）；self-registered 来自 worker 自己的 QwenPaw 注册表，
// 不在 spec 内，永远不会被这次保存改动。刷新按钮只重拉自注册一路。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, Pencil, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  McpSelector,
  type SelectedMcpServer,
} from '@/components/dashboard/sections/mcps/mcp-selector';
import {
  agentteamsApi,
  fetchWorkerMcp,
  type WorkerMcpResult,
  type WorkerResponse,
} from '@/lib/agentteams-api';
import { formatErrorMessage, shortErrorMessage } from '@/lib/api-error';
import { mergeWorkerMcpRows } from '@/lib/worker-mcp';

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

/** MCP 合并视图 + declared 编辑入口（仅 canEdit 时可见）。挂载即拉自注册一路
 * （抽屉折叠卡保证展开才挂载）。 */
export function WorkerMcpPanel({
  worker,
  workerName,
  workerTeam,
  canEdit,
  onChanged,
}: {
  worker: WorkerResponse;
  workerName: string;
  workerTeam?: string;
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const declaredOnly = worker.runtime === 'codex';
  const [self, setSelf] = useState<WorkerMcpResult | null>(null);
  const [loading, setLoading] = useState(!declaredOnly);
  const [loadError, setLoadError] = useState('');
  const [policyName, setPolicyName] = useState<string>();
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<SelectedMcpServer[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = useCallback(async () => {
    if (declaredOnly) return;
    setLoading(true);
    setLoadError('');
    try {
      setSelf(await fetchWorkerMcp(workerName));
    } catch (err) {
      setLoadError(shortErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [declaredOnly, workerName]);

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

  const openEdit = useCallback((name?: string) => {
    setPolicyName(name);
    setDraft(worker.mcpServers ?? []);
    setSaveError('');
    setEditOpen(true);
  }, [worker.mcpServers]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    try {
      // 只提交 mcpServers：PUT /workers 是全字段更新，带整表单会冲掉别人刚
      // 改的 model/env 等字段。
      await agentteamsApi.updateWorker(workerName, { mcpServers: draft });
    } catch (err) {
      // 403/400 的后端 message 原样展示（如控制器 RBAC / 校验失败原因）。
      setSaveError(formatErrorMessage(err));
      setSaving(false);
      return;
    }
    setSaving(false);
    setEditOpen(false);
    onChanged?.();
    // declared 由父级 detail 刷新带回；这里先重拉自注册一路，合并视图立即更新。
    void load();
  }, [draft, load, onChanged, saving, workerName]);

  return (
    <div className="space-y-2 pt-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {declaredOnly ? '管理分配给此 Agent 的 MCP 服务及工具审批。' : '查看分配给此 Agent 的 MCP 服务和运行时注册的服务。'}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="h-11 px-3 text-sm"
              onClick={() => openEdit()}
            >
              <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              编辑分配
            </Button>
          )}
          {!declaredOnly && <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw className={`mr-1 h-3 w-3 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            刷新
          </Button>}
        </div>
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
        <ul aria-label="MCP 服务" className="divide-y rounded-md border">
          {rows.map((row) => (
            <li key={row.name} className="flex min-w-0 items-center gap-3 px-3 py-2">
              <span className="min-w-0 max-w-[22ch] truncate text-sm font-medium"
                title={row.self?.displayName || row.name}>{row.self?.displayName || row.name}</span>
              {row.self?.enabled === false && <span className="text-xs text-muted-foreground">停用</span>}
              {!row.declared && <span className="text-xs text-muted-foreground">运行时注册，只读</span>}
              {declaredOnly && canEdit && row.declared && (
                <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={() => openEdit(row.name)}>
                  审批策略
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={editOpen}
        onOpenChange={(next) => {
          if (saving) return;
          setEditOpen(next);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-[95vw] overflow-y-auto sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{policyName ? '审批策略' : `MCP 分配 — ${workerName}`}</DialogTitle>
            <DialogDescription className="text-xs">
              {policyName ? '设置此 MCP 服务调用工具时的审批方式。' : '选择此 Agent 可使用的 MCP 服务。'}
              {!policyName && workerTeam ? `所属团队：${workerTeam}。` : ''}
            </DialogDescription>
          </DialogHeader>
          {!policyName && <McpSelector value={draft} onChange={setDraft} />}
          {policyName && draft.filter(server => server.name === policyName).map(server => (
            <label key={server.name} className="flex min-w-0 items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block max-w-[22ch] truncate font-medium" title={server.name}>{server.name}</span>
                <span className="text-xs text-muted-foreground">全部工具审批</span>
              </span>
              <select aria-label={`${server.name} · 全部工具审批`} className="shrink-0 rounded-md border bg-background px-2 py-1" value={server.approvals?.mode ?? ''}
                onChange={event => {
                  const mode = event.target.value;
                  setDraft(items => items.map(item => {
                    if (item.name !== server.name) return item;
                    const next = { ...item };
                    if (mode === 'allow' || mode === 'ask') next.approvals = { tools: '*', mode };
                    else delete next.approvals;
                    return next;
                  }));
                }}>
                <option value="">运行时默认</option>
                <option value="ask">请求审批</option>
                <option value="allow">自动通过</option>
              </select>
            </label>
          ))}
          {saveError && (
            <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 break-words">{saveError}</span>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setEditOpen(false)}
            >
              取消
            </Button>
            <Button disabled={saving} onClick={() => void handleSave()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
