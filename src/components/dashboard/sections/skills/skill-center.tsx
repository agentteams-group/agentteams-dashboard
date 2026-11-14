'use client';

import { useState, useMemo, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import { SectionHeader } from '@/components/dashboard/section-header';
import { OverflowText } from '@/components/dashboard/overflow-text';
import { ResourceListMenu } from '@/components/dashboard/resource-list-menu';
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
import { useSkills, useDeleteSkill } from '@/hooks/use-skill-center';
import { SkillEntry } from '@/lib/skill-center-types';
import { SkillUploadDialog } from './skill-upload-dialog';
import { NacosConfigDialog } from './nacos-config-dialog';
import { SkillEditDialog } from './skill-edit-dialog';
import { SkillDetailDialog } from './skill-detail-dialog';
import { SkillDistributeToWorkerDialog } from './skill-distribute-to-worker-dialog';

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
  const [distributeSkill, setDistributeSkill] = useState<SkillEntry | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const { data: result = { skills: [], total: 0 }, refetch, error, isError, isRefetching } = useSkills(search || undefined, sourceFilter === 'all' ? null : sourceFilter, page, PAGE_SIZE);
  const skills = result.skills;
  const total = result.total;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const deleteMutation = useDeleteSkill();

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
      <SectionHeader title={`技能 · ${total}`} onRefresh={handleRefresh} isRefreshing={isRefetching}
        meta={<div className="flex flex-wrap items-center gap-2">
          <Input aria-label="搜索技能" placeholder="搜索技能..." value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="h-9 w-64" />
          <select aria-label="技能来源" value={sourceFilter} onChange={(event) => { setSourceFilter(event.target.value as typeof sourceFilter); setPage(1); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="all">全部来源</option><option value="builtin">内置</option><option value="custom">自定义</option><option value="nacos">Nacos</option>
          </select>
        </div>}
        actions={<><Button variant="outline" size="sm" onClick={() => setNacosConfigOpen(true)}>配置 Nacos</Button><Button size="sm" onClick={() => setUploadOpen(true)}>上传技能</Button></>} />

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
          <CardContent className="p-0">
            <SectionEmptyState
              title={skills.length === 0 && mcpServers.length === 0 ? '暂无技能' : '没有匹配的技能'}
              description={
                skills.length === 0 && mcpServers.length === 0
                  ? '技能可以从本地包上传，也可以下发给 Worker'
                  : undefined
              }
              action={
                skills.length === 0 && mcpServers.length === 0
                  ? { label: '上传技能', onClick: () => setUploadOpen(true) }
                  : undefined
              }
            />
          </CardContent>
        </Card>
      )}

      {!isError && (filteredSkills.length > 0 || filteredMcp.length > 0) && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[800px] table-fixed text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">技能名称</th>
                <th className="w-[30%] text-left p-3 font-medium">描述</th>
                <th className="text-left p-3 font-medium">来源</th>
                <th className="w-20 text-left p-3 font-medium">文件数</th>
                <th className="w-[240px] text-right p-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredSkills.map((skill) => (
                <tr key={skill.name} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-3 font-mono font-medium"><OverflowText text={skill.name} /></td>
                  <td className="p-3"><OverflowText text={skill.description || ''} /></td>
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
                      <Button variant="ghost" size="sm" onClick={() => setDetailSkill(skill)}>详情</Button>
                      {skill.source === 'custom' && <Button variant="ghost" size="sm" onClick={() => setEditingSkill(skill)}>编辑</Button>}
                      <Button variant="ghost" size="sm" onClick={() => setDistributeSkill(skill)}>分发</Button>
                      {skill.source === 'custom' && <ResourceListMenu label={`更多操作 ${skill.name}`} items={[{ label: '删除技能', onSelect: () => setDeleteTarget(skill) }]} />}

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
        key={editingSkill?.name ?? 'closed'}
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

      <SkillDistributeToWorkerDialog
        skillName={distributeSkill?.name ?? ''}
        open={!!distributeSkill}
        onOpenChange={(open) => !open && setDistributeSkill(null)}
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
