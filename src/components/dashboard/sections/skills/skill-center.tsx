'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Search, Plus, Pencil, Trash2, RefreshCw, Info, AlertCircle } from 'lucide-react';
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
import { useSkills, useDeleteSkill } from '@/hooks/use-skill-center';
import { SkillEntry } from '@/lib/skill-center-types';
import { SkillUploadDialog } from './skill-upload-dialog';
import { NacosConfigDialog } from './nacos-config-dialog';
import { SkillEditDialog } from './skill-edit-dialog';
import { SkillDetailDialog } from './skill-detail-dialog';

interface SkillCenterProps {
  onRefresh?: () => void;
  mcpServers?: { name: string; url: string; transport: string }[];
}

export function SkillCenter({ onRefresh, mcpServers = [] }: SkillCenterProps) {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'custom' | 'nacos' | 'builtin'>('all');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [nacosConfigOpen, setNacosConfigOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SkillEntry | null>(null);
  const [detailSkill, setDetailSkill] = useState<SkillEntry | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const { data: result = { skills: [], total: 0 }, refetch, error, isError } = useSkills(search || undefined, sourceFilter === 'all' ? null : sourceFilter, page, PAGE_SIZE);
  const skills = result.skills;
  const total = result.total;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const deleteMutation = useDeleteSkill();

  useEffect(() => {
    setPage(1);
  }, [search, sourceFilter]);

  const handleRefresh = useCallback(() => {
    refetch();
    onRefresh?.();
  }, [refetch, onRefresh]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    await deleteMutation.mutateAsync(deleteTarget.name);
    setDeleteTarget(null);
  }, [deleteTarget, deleteMutation]);

  const handleUploadSuccess = useCallback((skill: SkillEntry) => {
    if (skill.source === 'custom') {
      refetch();
    }
    setUploadOpen(false);
  }, [refetch]);

  const filteredSkills = useMemo(() => {
    if (sourceFilter === 'all') return skills;
    return skills.filter((s) => s.source === sourceFilter);
  }, [skills, sourceFilter]);

  const filteredMcp = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return mcpServers;
    return mcpServers.filter(
      (s) => s.name.toLowerCase().includes(q) || s.url.toLowerCase().includes(q)
    );
  }, [mcpServers, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-1" />
            刷新
          </Button>
          <Button variant="outline" size="sm" onClick={() => setNacosConfigOpen(true)}>
            配置 Nacos
          </Button>
        </div>
        <Button onClick={() => setUploadOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          上传技能
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索技能..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as 'all' | 'custom' | 'nacos' | 'builtin')}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="all">全部</option>
          <option value="builtin">内置</option>
          <option value="custom">自定义</option>
          <option value="nacos">Nacos</option>
        </select>
      </div>

      {isError && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">获取技能列表失败</p>
            <p className="mt-1">{error?.message ?? '无法连接后端服务，请检查 API 状态'}</p>
          </div>
        </div>
      )}

      {!isError && filteredSkills.length === 0 && filteredMcp.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {skills.length === 0 && mcpServers.length === 0 ? '暂无技能，点击"上传技能"添加' : '没有匹配的技能'}
            </p>
          </CardContent>
        </Card>
      )}

      {!isError && (filteredSkills.length > 0 || filteredMcp.length > 0) && (
        <div className="border rounded-md">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">技能名称</th>
                <th className="text-left p-3 font-medium">描述</th>
                <th className="text-left p-3 font-medium">来源</th>
                <th className="text-left p-3 font-medium">文件数</th>
                <th className="text-right p-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredSkills.map((skill) => (
                <tr key={skill.name} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-3 font-mono font-medium">{skill.name}</td>
                  <td className="p-3 max-w-xs truncate">{skill.description}</td>
                  <td className="p-3">
                    {skill.source === 'nacos' ? (
                      <Badge variant="outline" className="text-xs max-w-[120px] truncate" title={skill.sourceAlias}>
                        {skill.sourceAlias || 'Nacos'}
                      </Badge>
                    ) : skill.source === 'builtin' ? (
                      <Badge variant="outline" className="text-xs">
                        内置
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        自定义
                      </Badge>
                    )}
                  </td>
                  <td className="p-3">{skill.fileCount}</td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => setDetailSkill(skill)}
                      >
                        <Info className="h-3.5 w-3.5" />
                      </Button>
                      {skill.source === 'custom' && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setEditingSkill(skill)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(skill)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredMcp.map((mcp) => (
                <tr key={`mcp-${mcp.name}`} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-3 font-mono font-medium">{mcp.name}</td>
                  <td className="p-3 max-w-xs truncate font-mono text-muted-foreground" title={mcp.url}>
                    {mcp.url}
                  </td>
                  <td className="p-3">
                    <Badge variant="outline" className="text-xs">MCP</Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">—</td>
                  <td className="p-3 text-right">
                    <span className="text-xs text-muted-foreground">{mcp.transport}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isError && total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>共 {total} 项，第 {page}/{totalPages} 页</span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}

      <SkillUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onSuccess={handleUploadSuccess}
      />

      <NacosConfigDialog
        open={nacosConfigOpen}
        onOpenChange={setNacosConfigOpen}
      />

      <SkillEditDialog
        skill={editingSkill}
        open={!!editingSkill}
        onOpenChange={(open) => !open && setEditingSkill(null)}
        onSuccess={handleRefresh}
      />

      <SkillDetailDialog
        skill={detailSkill}
        open={!!detailSkill}
        onOpenChange={(open) => !open && setDetailSkill(null)}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除技能"{deleteTarget?.name}"吗？此操作不可撤销。
              {deleteTarget && (
                <p className="mt-2 text-xs text-muted-foreground">
                  注意：已使用此技能的 Worker 可能受影响。
                </p>
              )}
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
