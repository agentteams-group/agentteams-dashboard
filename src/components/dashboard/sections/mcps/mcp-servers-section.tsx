'use client';

import { OverflowText } from '@/components/dashboard/overflow-text';
import { useState, useMemo, useCallback } from 'react';
import { Wifi } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { SectionEmptyState } from '@/components/dashboard/section-empty-state';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
import { McpServerDialog } from './mcp-server-dialog';
import { McpOnboardingPanel } from './mcp-onboarding-panel';
import { useMcpServers, useDeleteMcpServer } from '@/hooks/use-agentteams-mcps';
import { useMcpCatalog } from '@/hooks/use-mcp-catalog';
import type { McpServerConfig } from '@/lib/agentteams-api';
import { SectionHeader } from '@/components/dashboard/section-header';
import { ResourceListMenu } from '@/components/dashboard/resource-list-menu';
import { McpSetupDialog } from './mcp-setup-dialog';
import { McpDetailDialog } from './mcp-detail-dialog';
import { mcpManagementApi } from '@/lib/mcp-management-api';
import { MCP_KIND_LABELS } from '@/lib/mcp-management';

export function McpServersSection() {
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerConfig | undefined>();
  const [setupOpen, setSetupOpen] = useState(false);
  const [managedEdit, setManagedEdit] = useState<McpServerConfig>();
  const [detail, setDetail] = useState<McpServerConfig>();
  const [actionError, setActionError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [testingServer, setTestingServer] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

  const { data: servers = [], refetch, isRefetching } = useMcpServers();
  const deleteMutation = useDeleteMcpServer();
  // 「谁接了它」列（上游 #1250 部署目录，Controller 只读）——MinIO 注册表不带
  // 接线关系，此目录是权威源。旧 Controller 404 → catalog.off=true → 隐藏列。
  const catalog = useMcpCatalog();

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const filteredServers = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return servers;
    return servers.filter(
      (s) =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.url || '').toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q)
    );
  }, [servers, search]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setActionError('');
    try {
      if (servers.find((s) => s.name === deleteTarget)?.managed) { await mcpManagementApi.remove(deleteTarget); refetch(); }
      else await deleteMutation.mutateAsync(deleteTarget);
      setDeleteTarget(null);
    } catch (e) { setActionError(e instanceof Error ? e.message : '删除失败。'); setDeleteTarget(null); }
  }, [deleteTarget, deleteMutation, servers, refetch]);

  const handleTest = useCallback(async (server: McpServerConfig) => {
    setTestingServer(server.name);
    try {
      const { agentteamsApi } = await import('@/lib/agentteams-api');
      const result = server.managed ? await mcpManagementApi.verify(server.name) : await agentteamsApi.testMcpServer({
        url: server.url,
        transport: server.transport,
        headers: server.headers,
        timeout: server.timeout,
      });
      if (server.managed) refetch();
      setTestResults((prev) => ({
        ...prev,
        [server.name]: { success: result.success, message: result.message },
      }));
    } catch (error) {
      setTestResults((prev) => ({
        ...prev,
        [server.name]: { success: false, message: error instanceof Error ? (error.message || '测试失败') : '测试失败' },
      }));
    } finally {
      setTestingServer(null);
    }
  }, [refetch]);

  return (
    <div className="space-y-4">
      <SectionHeader title={`MCP 工具 · ${servers.length}`} onRefresh={handleRefresh} isRefreshing={isRefetching}
        meta={<Input aria-label="搜索 MCP" placeholder="搜索 MCP 服务器..." value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 w-72" />}
        actions={<><Button size="sm" onClick={() => { setManagedEdit(undefined); setSetupOpen(true); }}>接入 MCP</Button><ResourceListMenu label="MCP 更多操作" items={[{ label: '登记已有网关地址', onSelect: () => { setEditingServer(undefined); setDialogOpen(true); } }]} /></>} />
      <McpOnboardingPanel />
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}

      {filteredServers.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <SectionEmptyState
              icon={Wifi}
              title={servers.length === 0 ? '暂无 MCP 服务器配置' : '没有匹配的 MCP 服务器'}
              description={
                servers.length === 0 ? '接入已有 MCP、HTTP API 或数据库，再分配给需要使用的 Agent。' : undefined
              }
              action={
                servers.length === 0
                  ? {
                      label: '接入 MCP',
                      onClick: () => {
                        setManagedEdit(undefined);
                        setSetupOpen(true);
                      },
                    }
                  : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[940px] table-fixed text-sm">
            <thead><tr className="border-b bg-muted/40 text-left"><th className="w-[28%] px-4 py-3 font-medium">名称 / 用途</th><th className="w-[160px] px-4 py-3 font-medium">接入方式</th><th className="px-4 py-3 font-medium">网关状态</th><th className="w-[100px] px-4 py-3 font-medium">Agent</th><th className="w-[190px] px-4 py-3 text-right font-medium">操作</th></tr></thead>
            <tbody>{filteredServers.map((server) => <tr key={server.name} className="border-b last:border-0 hover:bg-muted/20">
              <td className="px-4 py-4"><button type="button" disabled={server.managed && !server.connection} title={server.name} className={`block max-w-full truncate font-medium ${server.managed && server.connection ? 'hover:underline underline-offset-4' : ''}`} onClick={() => { if (server.managed && server.connection) setDetail(server); }}>{server.name}</button><OverflowText text={server.description || ''} className="mt-1 text-xs leading-5 text-muted-foreground" />
                {testResults[server.name] && <p className={`mt-2 text-xs ${testResults[server.name].success ? 'text-emerald-600' : 'text-destructive'}`}>{testResults[server.name].success ? '连接成功' : '连接失败'}：{testResults[server.name].message}</p>}
              </td>
              <td className="px-4 py-4"><Badge variant="outline">{server.kind ? MCP_KIND_LABELS[server.kind] : server.connection ? MCP_KIND_LABELS[server.connection.kind] : '地址登记'}</Badge><p className="mt-1.5 text-xs text-muted-foreground">{server.transport === 'sse' ? 'SSE' : 'Streamable HTTP'}</p></td>
              <td className="px-4 py-4"><span className={`text-xs ${server.verification?.success ? 'text-emerald-600' : server.gatewayState === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{server.gatewayState === 'error' ? '接入失败' : server.verification?.success ? `已验证 · ${server.toolCount ?? server.verification.tools?.length ?? 0} 个工具` : server.managed ? '已启用 · 待验证' : '未验证网关'}</span><OverflowText text={server.url} className="mt-1.5 text-xs text-muted-foreground" /></td>
              <td className="whitespace-nowrap px-4 py-4 text-xs text-muted-foreground">{server.managed ? `${server.authorizedWorkerCount ?? server.authorizedWorkers?.length ?? 0} 个已授权` : catalog.off ? '待分配' : `${(catalog.workersByServer.get(server.name) ?? []).length} 个已配置`}</td>
              <td className="px-4 py-4"><div className="flex items-center justify-end gap-1 whitespace-nowrap">
                {server.managed && !server.connection ? <span className="text-xs text-muted-foreground">管理员可管理</span> : <><Button variant="ghost" size="sm" disabled={testingServer === server.name} onClick={() => handleTest(server)}>{testingServer === server.name ? '测试中…' : '测试'}</Button>
                  <Button variant="ghost" size="sm" onClick={() => { if (server.managed) setDetail(server); else { setEditingServer(server); setDialogOpen(true); } }}>{server.managed ? '详情' : '编辑'}</Button>
                  <ResourceListMenu label={`更多操作 ${server.name}`} items={[{ label: server.managed ? '删除服务' : '删除登记', onSelect: () => setDeleteTarget(server.name) }]} /></>}
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}

      <McpServerDialog
        key={dialogOpen ? editingServer?.name ?? 'new' : 'closed'}
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingServer(undefined);
          }
        }}
        server={editingServer ? {
          name: editingServer.name,
          url: editingServer.url,
          transport: editingServer.transport,
          type: editingServer.type,
          timeout: editingServer.timeout,
          headers: editingServer.headers,
          description: editingServer.description,
        } : undefined}
        onSuccess={() => {
          handleRefresh();
          setDialogOpen(false);
          setEditingServer(undefined);
        }}
      />

      <McpSetupDialog key={setupOpen ? managedEdit?.name ?? 'new-managed' : 'closed-managed'} open={setupOpen} onOpenChange={setSetupOpen} server={managedEdit} onSaved={(saved) => { refetch(); setDetail(saved); }} />
      {detail && <McpDetailDialog server={servers.find((s) => s.name === detail.name) ?? detail} onClose={() => setDetail(undefined)} onChanged={() => { refetch(); }} onEdit={() => { setManagedEdit(servers.find((s) => s.name === detail.name) ?? detail); setDetail(undefined); setSetupOpen(true); }} />}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>{servers.find((s) => s.name === deleteTarget)?.managed ? '将删除网关服务和目录记录。请先移除已授权 Agent，服务仍有 Agent 使用时无法删除。' : '仅删除目录登记，不撤销网关授权，也不修改 Worker 配置。'}
              确定要删除 MCP 服务器“{deleteTarget}”吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
