'use client';

import { useState, useMemo, useCallback } from 'react';
import { Search, Plus, Pencil, Trash2, RefreshCw } from 'lucide-react';
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

interface SkillCenterProps {
  onRefresh?: () => void;
}

export function SkillCenter({ onRefresh }: SkillCenterProps) {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'custom' | 'nacos'>('all');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [nacosConfigOpen, setNacosConfigOpen] = useState(false);
  const [_editingSkill, _setEditingSkill] = useState<SkillEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SkillEntry | null>(null);
  const [_conflictSkill, _setConflictSkill] = useState<SkillEntry | null>(null);

  const { data: skills = [], refetch } = useSkills(search || undefined, sourceFilter === 'all' ? null : sourceFilter);
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
          onChange={(e) => setSourceFilter(e.target.value as 'all' | 'custom' | 'nacos')}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="all">全部</option>
          <option value="custom">自定义</option>
          <option value="nacos">Nacos</option>
        </select>
      </div>

      {filteredSkills.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {skills.length === 0 ? '暂无技能，点击"上传技能"添加' : '没有匹配的技能'}
            </p>
          </CardContent>
        </Card>
      ) : (
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
                      <Badge variant="outline" className="text-xs">
                        {skill.sourceAlias || 'Nacos'}
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
                      {skill.source === 'custom' && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => _setEditingSkill(skill)}
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
            </tbody>
          </table>
        </div>
      )}

      <SkillUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onSuccess={handleUploadSuccess}
        onConflict={_setConflictSkill}
      />

      <NacosConfigDialog
        open={nacosConfigOpen}
        onOpenChange={setNacosConfigOpen}
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
