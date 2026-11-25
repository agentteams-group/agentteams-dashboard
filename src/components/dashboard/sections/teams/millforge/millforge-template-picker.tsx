'use client';

// 千锻模板选择——industry 单选 + domains 多选 + 可选整队组合（INDEX teams，
// 选中自动填 members 比例/domains）+ members 成员数 + lang；附紧凑浏览：
// 四组 INDEX 条目点选 → 单文件只读预览（GET /millforge/packs/{pack}/file）。

import { useEffect, useState } from 'react';
import { AlertCircle, ChevronDown, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { agentteamsApi, type MillforgePackEntry } from '@/lib/agentteams-api';
import type { MillforgeCore } from './use-millforge-core';

const BROWSE_SECTIONS: { key: 'skeletons' | 'industry' | 'domain' | 'fragments'; label: string }[] = [
  { key: 'skeletons', label: 'skeletons（骨架）' },
  { key: 'industry', label: 'industry（行业）' },
  { key: 'domain', label: 'domain（领域）' },
  { key: 'fragments', label: 'fragments（片段）' },
];

export function MillforgeTemplatePicker({ core }: { core: MillforgeCore }) {
  const { spec, setSpec, pickCombo, comboWarning, setComboWarning, lang, setLang, index, pack } = core;

  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseSection, setBrowseSection] = useState<string>('industry');
  const [browseFile, setBrowseFile] = useState('');
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // pack/INDEX 变化 → 复位浏览选择。
  useEffect(() => {
    setBrowseFile('');
    setPreview(null);
    setPreviewError('');
  }, [pack, index]);

  const sectionEntries: MillforgePackEntry[] = index
    ? index[browseSection as 'skeletons' | 'industry' | 'domain' | 'fragments'] || []
    : [];
  const selectedEntry = sectionEntries.find((entry) => entry.file === browseFile) || null;

  useEffect(() => {
    if (!pack || !selectedEntry?.file) {
      setPreview(null);
      setPreviewError('');
      return;
    }
    let alive = true;
    setPreviewLoading(true);
    setPreviewError('');
    agentteamsApi
      .getMillforgePackFile(pack, selectedEntry.file)
      .then((data) => {
        if (alive) setPreview({ path: data.path, content: data.content });
      })
      .catch((error: unknown) => {
        if (alive) setPreviewError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (alive) setPreviewLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [pack, selectedEntry?.file]);

  const members = spec.members || { leader: 1, workers: 2, critic: 0 };
  const total = (members.leader || 0) + (members.workers || 0) + (members.critic || 0);
  const setMember = (key: 'leader' | 'workers' | 'critic', value: string) => {
    const parsed = Number.parseInt(value, 10);
    setSpec((previous) => ({
      ...previous,
      members: {
        leader: 1,
        workers: 2,
        critic: 0,
        ...previous.members,
        [key]: Number.isFinite(parsed) ? Math.max(0, Math.min(8, parsed)) : 0,
      },
    }));
  };

  // 行业 → 领域级联：已选 industry 时 domains 只显示该行业下的域；
  // 未选 industry 或 INDEX 无 industry 字段（旧包）→ 全显（诚实降级）。
  const domainEntries = (index?.domain || []).filter((entry) => entry.id);
  const hasIndustryInfo = domainEntries.some((entry) => entry.industry);
  const cascadedDomains = spec.industry && hasIndustryInfo
    ? domainEntries.filter((entry) => entry.industry === spec.industry)
    : domainEntries;

  const onIndustryChange = (value: string) => {
    const next = value === '__none__' ? '' : value;
    setSpec((previous) => {
      // 级联：切换行业清掉不属于新行业的已选 domains。
      let domains = previous.domains || [];
      if (next && hasIndustryInfo) {
        const belonging = new Set(
          domainEntries.filter((entry) => entry.industry === next).map((entry) => entry.id),
        );
        domains = domains.filter((domain) => belonging.has(domain));
      }
      return { ...previous, industry: next, domains };
    });
    if (comboWarning) setComboWarning('');
  };

  const toggleDomain = (domain: string, checked: boolean) => {
    setSpec((previous) => {
      const current = previous.domains || [];
      const next = checked
        ? Array.from(new Set([...current, domain]))
        : current.filter((entry) => entry !== domain);
      return { ...previous, domains: next };
    });
    if (comboWarning) setComboWarning('');
  };

  return (
    <div className="space-y-2">
      {index && index.teams.length > 0 ? (
        <div className="space-y-1">
          <Label htmlFor="millforge-combo" className="text-xs font-semibold text-muted-foreground">
            整队组合（可选，选中自动填成员比例/领域）
          </Label>
          <Select value={spec.team_combo || undefined} onValueChange={(value) => pickCombo(value)}>
            <SelectTrigger id="millforge-combo" className="h-9 w-full text-xs">
              <SelectValue placeholder="不选 = 按下方 industry/domains/members 组装" />
            </SelectTrigger>
            <SelectContent>
              {index.teams.map((combo) => (
                <SelectItem key={combo.id} value={combo.id} className="text-xs">
                  {`${combo.name || combo.id}（${combo.industry || '—'} · L${combo.members.leader || '?'}/W${combo.members.workers || '?'}/C${combo.members.critic || '?'}${
                    combo.experimental === 'true' || combo.source === 'llm' ? ' · 实验' : ''
                  }）`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {comboWarning ? (
            <Alert className="py-2">
              <AlertCircle className="size-4" aria-hidden="true" />
              <AlertDescription className="text-xs">{comboWarning}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="millforge-industry" className="text-xs font-semibold text-muted-foreground">
            行业（industry，单选）
          </Label>
          <Select value={spec.industry || '__none__'} onValueChange={onIndustryChange}>
            <SelectTrigger id="millforge-industry" className="h-9 w-full text-xs">
              <SelectValue placeholder="不选 = 通用" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs">
                不选 = 通用
              </SelectItem>
              {(index?.industry || [])
                .filter((entry) => entry.id)
                .map((entry) => (
                  <SelectItem key={entry.id} value={entry.id} className="text-xs">
                    {entry.id}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <span className="text-xs font-semibold text-muted-foreground">
            领域（domains，多选）
          </span>
          <div
            className="max-h-24 overflow-y-auto rounded-md border p-1.5"
            role="group"
            aria-label="领域（domains，多选）"
          >
            {cascadedDomains.length === 0 ? (
              <p className="px-1 py-0.5 text-xs text-muted-foreground">
                {index ? '该行业下暂无领域条目' : '选择模板包后可选领域'}
              </p>
            ) : (
              cascadedDomains.map((entry) => (
                <label
                  key={entry.id}
                  className="flex min-h-7 cursor-pointer items-center gap-1.5 rounded px-1 text-xs hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    className="size-3.5"
                    checked={(spec.domains || []).includes(entry.id)}
                    onChange={(event) => toggleDomain(entry.id, event.target.checked)}
                  />
                  <span className="truncate font-mono">{entry.id}</span>
                </label>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">
          成员（leader/workers/critic）
        </span>
        {(
          [
            ['leader', 'Leader'],
            ['workers', 'Worker'],
            ['critic', 'Critic'],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1">
            <Label htmlFor={`millforge-member-${key}`} className="text-xs text-muted-foreground">
              {label}
            </Label>
            <Input
              id={`millforge-member-${key}`}
              type="number"
              min={key === 'leader' ? 1 : 0}
              max={8}
              className="h-8 w-16 text-xs"
              value={members[key] ?? 0}
              onChange={(event) => setMember(key, event.target.value)}
            />
          </div>
        ))}
        <span
          className={`text-xs ${total >= 2 && total <= 8 ? 'text-muted-foreground' : 'text-destructive'}`}
        >
          {total >= 2 && total <= 8 ? `合计 ${total} 个角色` : '角色总数须 2-8'}
        </span>
        <div className="ml-auto inline-flex overflow-hidden rounded-md border" role="group" aria-label="SOUL 语言">
          {(
            [
              ['zh', '中文'],
              ['en', 'EN'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={lang === value}
              onClick={() => setLang(value)}
              className={`min-h-8 px-2 text-xs ${
                lang === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-md border">
        <button
          type="button"
          aria-expanded={browseOpen}
          onClick={() => setBrowseOpen((open) => !open)}
          className="flex min-h-9 w-full items-center gap-2 px-2 text-left text-xs font-medium hover:bg-muted/50"
        >
          浏览模板条目（只读预览）
          <ChevronDown
            className={`ml-auto size-3.5 transition-transform ${browseOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
        {browseOpen ? (
          <div className="space-y-2 border-t p-2">
            <div className="flex flex-wrap gap-2">
              <Select
                value={browseSection}
                onValueChange={(value) => {
                  setBrowseSection(value);
                  setBrowseFile('');
                }}
              >
                <SelectTrigger className="h-8 w-44 text-xs" aria-label="模板条目分组">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BROWSE_SECTIONS.map((section) => (
                    <SelectItem key={section.key} value={section.key} className="text-xs">
                      {section.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={browseFile || '__none__'}
                onValueChange={(value) => setBrowseFile(value === '__none__' ? '' : value)}
              >
                <SelectTrigger className="h-8 min-w-0 flex-1 text-xs" aria-label="模板条目">
                  <SelectValue placeholder="选择条目查看文件预览" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs">
                    选择条目查看文件预览
                  </SelectItem>
                  {sectionEntries
                    .filter((entry) => entry.file)
                    .map((entry) => (
                      <SelectItem key={entry.file} value={entry.file} className="text-xs">
                        {entry.id || entry.file}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {previewError ? (
              <Alert variant="destructive" className="py-2">
                <AlertCircle className="size-4" aria-hidden="true" />
                <AlertDescription className="break-all font-mono text-xs">
                  读取模板文件失败：{previewError}
                </AlertDescription>
              </Alert>
            ) : previewLoading ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                读取中…
              </p>
            ) : preview ? (
              <pre className="max-h-80 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
                {preview.content}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground">选择上方条目查看文件预览（只读）。</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
