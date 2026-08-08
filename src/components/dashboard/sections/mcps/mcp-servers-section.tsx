'use client';

import { useState, useMemo, useCallback } from 'react';
import { Search, Plus, Edit, Trash2, RefreshCw, TestTube, Wifi, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
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
import { useMcpServers, useDeleteMcpServer } from '@/hooks/use-agentteams-mcps';
import type { McpServerConfig } from '@/lib/agentteams-api';

export function McpServersSection() {
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerConfig | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [testingServer, setTestingServer] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

  const { data: servers = [], refetch, isRefetching } = useMcpServers();
  const deleteMutation = useDeleteMcpServer();

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
      });
      setTestResults((prev) => ({
        ...prev,
        [server.name]: { success: result.success, message: result.message },
      }));
    } catch (error: any) {
      setTestResults((prev) => ({
        ...prev,
        [server.name]: { success: false, message: error.message || '测试失败' },
      }));
    } finally {
      setTestingServer(null);
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isRefetching ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
        <Button onClick={() => { setEditingServer(undefined); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" />
          添加 MCP 服务器
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索 MCP 服务器..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {filteredServers.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Wifi className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {servers.length === 0
                ? '暂无 MCP 服务器配置。点击"添加 MCP 服务器"创建新的 MCP 服务器。'
                : '没有匹配的 MCP 服务器'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredServers.map((server) => (
            <Card key={server.name} className="glass-card">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                      <Wifi className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{server.name}</span>
                        <Badge variant="outline" className="text-[10px]">{server.transport}</Badge>
                        {server.type && (
                          <Badge variant="secondary" className="text-[10px]">{server.type}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono truncate max-w-[400px]" title={server.url}>
                        {server.url}
                      </p>
                      {server.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[400px]">
                          {server.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => handleTest(server)}
                      disabled={testingServer === server.name}
                      title="测试连接"
                    >
                      {testingServer === server.name ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <TestTube className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => { setEditingServer(server); setDialogOpen(true); }}
                      title="编辑"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(server.name)}
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {testResults[server.name] && (
                  <div className={`mt-3 text-xs flex items-center gap-1 ${
                    testResults[server.name].success ? 'text-emerald-600' : 'text-red-600'
                  }`}>
                    {testResults[server.name].success ? (
                      <span>连接成功: {testResults[server.name].message}</span>
                    ) : (
                      <>
                        <AlertCircle className="h-3 w-3" />
                        <span>连接失败: {testResults[server.name].message}</span>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <McpServerDialog
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
            <AlertDialogDescription>
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
