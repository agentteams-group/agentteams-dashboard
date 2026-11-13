'use client';

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

export function McpServersSection() {
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerConfig | undefined>();
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
    await deleteMutation.mutateAsync(deleteTarget);
    setDeleteTarget(null);
  }, [deleteTarget, deleteMutation]);

  const handleTest = useCallback(async (server: McpServerConfig) => {
    setTestingServer(server.name);
    try {
      const { agentteamsApi } = await import('@/lib/agentteams-api');
      const result = await agentteamsApi.testMcpServer({
        url: server.url,
        transport: server.transport,
        headers: server.headers,
        timeout: server.timeout,
      });
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
  }, []);

  return (
    <div className="space-y-4">
      <SectionHeader title={`MCP 工具 · ${servers.length}`} onRefresh={handleRefresh} isRefreshing={isRefetching}
        meta={<Input aria-label="搜索 MCP" placeholder="搜索 MCP 服务器..." value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 w-72" />}
        actions={<Button size="sm" onClick={() => { setEditingServer(undefined); setDialogOpen(true); }}>登记 MCP 地址</Button>} />
      <McpOnboardingPanel />

      {filteredServers.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <SectionEmptyState
              icon={Wifi}
              title={servers.length === 0 ? '暂无 MCP 服务器配置' : '没有匹配的 MCP 服务器'}
              description={
                servers.length === 0 ? '登记一条网关上的 MCP 地址，Worker 才能引用它' : undefined
              }
              action={
                servers.length === 0
                  ? {
                      label: '登记 MCP 地址',
                      onClick: () => {
                        setEditingServer(undefined);
                        setDialogOpen(true);
                      },
                    }
                  : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/40 text-left"><th className="px-4 py-3 font-medium">名称 / 用途</th><th className="px-4 py-3 font-medium">服务地址</th><th className="px-4 py-3 font-medium">传输方式</th>{!catalog.off && <th className="px-4 py-3 font-medium">已配置 Worker</th>}<th className="px-4 py-3 text-right font-medium">操作</th></tr></thead>
            <tbody>{filteredServers.map((server) => <tr key={server.name} className="border-b last:border-0 hover:bg-muted/20">
              <td className="px-4 py-4"><p className="font-medium">{server.name}</p><p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">{server.description}</p>
                {testResults[server.name] && <p className={`mt-2 text-xs ${testResults[server.name].success ? 'text-emerald-600' : 'text-destructive'}`}>{testResults[server.name].success ? '连接成功' : '连接失败'}：{testResults[server.name].message}</p>}
              </td>
              <td className="px-4 py-4"><p className="max-w-sm truncate text-xs text-muted-foreground" title={server.url}>{server.url}</p></td>
              <td className="px-4 py-4"><Badge variant="outline">{server.transport}</Badge></td>
              {!catalog.off && <td className="px-4 py-4 text-xs text-muted-foreground">{(catalog.workersByServer.get(server.name) ?? []).map((worker) => worker.name).join('、') || '尚未分配'}<span className="block pt-1">配置关系，未验证调用</span></td>}
              <td className="px-4 py-4"><div className="flex items-center justify-end gap-1 whitespace-nowrap">
                <Button variant="ghost" size="sm" disabled={testingServer === server.name} onClick={() => handleTest(server)}>{testingServer === server.name ? '测试中…' : '测试'}</Button>
                <Button variant="ghost" size="sm" onClick={() => { setEditingServer(server); setDialogOpen(true); }}>编辑</Button>
                <ResourceListMenu label={`更多操作 ${server.name}`} items={[{ label: '删除登记', onSelect: () => setDeleteTarget(server.name) }]} />
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

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>仅删除目录登记，不撤销网关授权，也不修改 Worker 配置。受影响 Worker：{deleteTarget ? (catalog.workersByServer.get(deleteTarget) ?? []).map((worker) => worker.name).join("、") || "未查询到，请核对 Worker 配置" : ""}。
              确定要删除 MCP 服务器"{deleteTarget}"吗？此操作不可撤销。
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
