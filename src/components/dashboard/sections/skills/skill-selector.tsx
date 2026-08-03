'use client';

import { useState, useMemo, useCallback } from 'react';
import { Search, Check, X } from 'lucide-react';
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

  const { data: skills = [] } = useSkills(search || undefined, filter === 'all' ? null : filter);

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
            className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground group"
            onClick={() => handleSelect(skill)}
          >
            {skill.name}
            <X className="ml-1 h-3 w-3 opacity-50 group-hover:opacity-100" />
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
            ? `${value.length} 个技能已选择，点击选择更多...`
            : '选择技能...'}
        </Button>

        <DialogContent className="sm:max-w-md max-w-[95vw]">
          <DialogHeader>
            <DialogTitle>选择技能</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-3">
            <div className="flex gap-2">
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
                value={filter}
                onChange={(e) => setFilter(e.target.value as 'all' | 'custom' | 'nacos')}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                <option value="all">全部</option>
                <option value="custom">自定义</option>
                <option value="nacos">Nacos</option>
              </select>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1">
              {availableSkills.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-4">
                  {skills.length === 0 ? '暂无可用技能' : '没有匹配的技能'}
                </p>
              ) : (
                availableSkills.map((skill) => (
                  <button
                    key={skill.name}
                    className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-muted text-left"
                    onClick={() => handleSelect(skill)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium">{skill.name}</span>
                        {skill.source === 'nacos' ? (
                          <Badge variant="outline" className="text-[10px]">
                            {skill.sourceAlias || 'Nacos'}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">
                            自定义
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{skill.description}</p>
                    </div>
                    <Check className="h-4 w-4 text-green-500" />
                  </button>
                ))
              )}
            </div>

            {selectedSkills.length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground mb-2">已选择 ({selectedSkills.length}):</p>
                <div className="flex flex-wrap gap-1">
                  {selectedSkills.map((skill) => (
                    <Badge key={skill.name} variant="secondary" className="text-xs">
                      {skill.name}
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
