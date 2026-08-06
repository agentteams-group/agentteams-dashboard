'use client';

import { useState, useMemo, useCallback } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSkills } from '@/hooks/use-skill-center';
import type { SkillEntry } from '@/lib/skill-center-types';

interface SkillSelectorProps {
  value: string[];
  onChange: (_skills: string[]) => void;
  placeholder?: string;
}

export function SkillSelector({ value, onChange, placeholder = '搜索并选择技能...' }: SkillSelectorProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'custom' | 'nacos'>('all');
  const [open, setOpen] = useState(false);

  const { data: result = { skills: [], total: 0 }, isLoading, isError, error } = useSkills(search || undefined, filter === 'all' ? null : filter);
  const skills = result.skills;

  const selectedSkills = useMemo(
    () => skills.filter((s) => value.includes(s.name)),
    [skills, value]
  );

  const availableSkills = useMemo(() => {
    return skills.filter((s) => !value.includes(s.name));
  }, [skills, value]);

  const handleSelect = useCallback(
    (skill: SkillEntry) => {
      if (value.includes(skill.name)) {
        onChange(value.filter((v) => v !== skill.name));
      } else {
        onChange([...value, skill.name]);
      }
    },
    [value, onChange]
  );

  const handleRemove = useCallback(
    (name: string) => {
      onChange(value.filter((v) => v !== name));
    },
    [value, onChange]
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setOpen(open);
      if (!open) {
        setSearch('');
        setFilter('all');
      }
    },
    []
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1 min-h-[2rem]">
        {selectedSkills.map((skill) => (
          <Badge
            key={skill.name}
            variant="secondary"
            className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground group pr-1"
          >
            <span className="max-w-[160px] truncate">{skill.name}</span>
            <X
              className="ml-1 h-3 w-3 shrink-0 opacity-50 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove(skill.name);
              }}
            />
          </Badge>
        ))}
        {value.length === 0 && (
          <span className="text-sm text-muted-foreground">{placeholder}</span>
        )}
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={() => setOpen(true)}
        >
          <Search className="h-4 w-4 mr-2" />
          {value.length > 0
            ? `${value.length} 个技能已选择，点击查看更多...`
            : '选择技能...'}
        </Button>

        <DialogContent className="sm:max-w-md max-w-[95vw] overflow-hidden">
          <DialogHeader>
            <DialogTitle>选择技能</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-3 overflow-hidden">
            <div className="flex gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <Input
                  placeholder="搜索技能..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as 'all' | 'custom' | 'nacos')}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm shrink-0"
              >
                <option value="all">全部</option>
                <option value="custom">自定义</option>
                <option value="nacos">Nacos</option>
              </select>
            </div>

            <div className="max-h-60 min-h-0 overflow-y-auto space-y-1">
              {isLoading ? (
                <p className="text-center text-sm text-muted-foreground py-4">加载中...</p>
              ) : isError ? (
                <p className="text-center text-sm text-red-500 py-4">
                  加载失败: {error instanceof Error ? error.message : '未知错误'}
                </p>
              ) : availableSkills.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-4">
                  {skills.length === 0 ? '暂无可用技能' : '没有匹配的技能'}
                </p>
              ) : (
                availableSkills.map((skill) => (
                  <button
                    key={skill.name}
                    className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-muted text-left min-w-0"
                    onClick={() => handleSelect(skill)}
                  >
                    <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium truncate max-w-[180px]">{skill.name}</span>
                        {skill.source === 'nacos' ? (
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            Nacos
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] shrink-0">
                            自定义
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate max-w-[280px]">{skill.description}</p>
                    </div>
                  </button>
                ))
              )}
            </div>

            {selectedSkills.length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground mb-2">
                  已选择 ({selectedSkills.length}):
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1 text-xs text-destructive hover:text-destructive ml-2"
                    onClick={() => onChange([])}
                  >
                    全部取消
                  </Button>
                </p>
                <div className="flex flex-wrap gap-1">
                  {selectedSkills.map((skill) => (
                    <Badge
                      key={skill.name}
                      variant="secondary"
                      className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground text-xs pr-1"
                      onClick={() => handleRemove(skill.name)}
                    >
                      <span className="max-w-[140px] truncate">{skill.name}</span>
                      <X className="ml-1 h-3 w-3 shrink-0" />
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={() => setOpen(false)}>
              确定（{value.length} 个）
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
