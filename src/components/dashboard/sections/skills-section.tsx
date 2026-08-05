'use client';

import { useState, useMemo, useCallback } from 'react';
import { Server, Upload, Plus, Wifi, Pencil, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionHeader } from '@/components/dashboard/section-header';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useMcpServers, useDeleteMcpServer } from '@/hooks/use-agentteams-mcps';
import { useSearch } from '@/lib/search-context';
import { SkillDistributeDialog } from '@/components/dashboard/sections/skills/skill-distribute-dialog';
import { McpServerDialog } from '@/components/dashboard/sections/mcps/mcp-server-dialog';
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
import { SkillCenter } from '@/components/dashboard/sections/skills/skill-center';

export function SkillsSection() {
  const { data: _workers, refetch, isRefetching } = useWorkers();
  const { data: mcpServerList } = useMcpServers();
  const deleteMcp = useDeleteMcpServer();
  const { searchQuery } = useSearch();
  const [localFilter, _setLocalFilter] = useState('');
  const [distributeOpen, setDistributeOpen] = useState(false);
  const [mcpDialogOpen, setMcpDialogOpen] = useState(false);
  const [editingMcp, setEditingMcp] = useState<{ name: string; url: string; transport: 'sse' | 'streaminghttp' } | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const filteredMcp = useMemo(() => {
    const q = (searchQuery || localFilter).toLowerCase();
    if (!q) return mcpServerList || [];
    return (mcpServerList || []).filter(
      (s) =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.url || '').toLowerCase().includes(q)
    );
  }, [mcpServerList, searchQuery, localFilter]);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="技能中心"
        description="集中化管理技能包，支持 MinIO 自定义技能与 Nacos 注册中心同步"
        onRefresh={handleRefresh}
        isRefreshing={isRefetching}
        actions={
          <Button variant="outline" size="sm" onClick={() => setDistributeOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            分发技能
          </Button>
        }
      />

      <SkillCenter onRefresh={handleRefresh} />

      {/* MCP Server Section */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Server className="w-5 h-5 text-emerald-500" />
          MCP 服务器配置
          <Badge variant="outline" className="text-[10px]">{filteredMcp.length}</Badge>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs"
            onClick={() => { setEditingMcp(undefined); setMcpDialogOpen(true); }}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            添加
          </Button>
        </h2>
        {filteredMcp.length === 0 ? (
          <Card className="glass-card">
            <CardContent className="p-8 text-center">
              <Server className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {mcpServerList?.length === 0
                  ? '暂无 MCP 服务器配置。点击"添加"按钮创建新的 MCP 服务器。'
                  : '没有匹配的 MCP 服务器'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredMcp.map((mcp) => (
              <Card key={`${mcp.name}-${mcp.url}`} className="glass-card">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                        <Wifi className="w-4 h-4 text-emerald-500" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{mcp.name}</span>
                          <Badge variant="outline" className="text-[10px]">{mcp.transport}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono truncate max-w-[400px]" title={mcp.url}>
                          {mcp.url}
                        </p>
                        {mcp.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[400px]">{mcp.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setEditingMcp({ name: mcp.name, url: mcp.url, transport: mcp.transport as 'sse' | 'streaminghttp' })}
                        className="p-1.5 hover:bg-accent rounded"
                        title="编辑"
                      >
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(mcp.name)}
                        className="p-1.5 hover:bg-destructive/10 rounded"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <SkillDistributeDialog dialogOpen={distributeOpen} onOpenChange={setDistributeOpen} />
      <McpServerDialog
        open={mcpDialogOpen}
        onOpenChange={setMcpDialogOpen}
        server={editingMcp}
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
              onClick={async () => {
                if (deleteTarget) {
                  await deleteMcp.mutateAsync(deleteTarget);
                  setDeleteTarget(null);
                }
              }}
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
