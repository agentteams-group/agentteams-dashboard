'use client';

// 千锻源切换 + pack 选择——Segmented（GitHub/GitCode/自定义，自定义才显
// URL 输入）+ 派生 resolved_url + 「导入 / 更新」（POST /millforge/import，
// ref 默认 main）；切换即 PUT /millforge/source 持久化；无 pack → 就地引导导入。

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MillforgeCore, MillforgeSourceSeg } from './use-millforge-core';

const SEGMENTS: { value: MillforgeSourceSeg; label: string }[] = [
  { value: 'github', label: 'GitHub' },
  { value: 'gitcode', label: 'GitCode' },
  { value: 'custom', label: '自定义' },
];

export function MillforgeSourcePack({ core }: { core: MillforgeCore }) {
  const {
    source,
    sourceError,
    seg,
    changeSeg,
    persistRepo,
    persistCustomUrl,
    ref,
    setRef,
    importing,
    importMsg,
    doImport,
    packs,
    packsLoading,
    packsError,
    pack,
    setPack,
    activePack,
  } = core;

  // 文本输入本地草稿（失焦/回车才 PUT——避免逐键持久化）。
  const [repoDraft, setRepoDraft] = useState('');
  const [urlDraft, setUrlDraft] = useState('');
  useEffect(() => {
    setRepoDraft(source?.repo || '');
  }, [source?.repo]);
  useEffect(() => {
    setUrlDraft(source?.custom_url || '');
  }, [source?.custom_url]);

  const hasPack = packs.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border" role="group" aria-label="千锻源">
          {SEGMENTS.map((segment) => (
            <button
              key={segment.value}
              type="button"
              aria-pressed={seg === segment.value}
              onClick={() => changeSeg(segment.value)}
              className={`min-h-9 px-2.5 text-xs transition-colors ${
                seg === segment.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-transparent hover:bg-muted'
              }`}
            >
              {segment.label}
            </button>
          ))}
        </div>
        {seg === 'custom' ? (
          <Input
            aria-label="自定义仓库 URL"
            className="h-9 min-w-0 flex-[2_1_240px] text-xs"
            placeholder="自定义仓库 URL（https）"
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            onBlur={() => {
              if (urlDraft.trim() !== (source?.custom_url || '')) persistCustomUrl(urlDraft.trim());
            }}
          />
        ) : (
          <Input
            aria-label="仓库（org/repo）"
            className="h-9 min-w-0 flex-[2_1_240px] text-xs"
            placeholder="repo（org/repo）"
            value={repoDraft}
            onChange={(event) => setRepoDraft(event.target.value)}
            onBlur={() => {
              if (repoDraft.trim() !== (source?.repo || '')) persistRepo(repoDraft.trim());
            }}
          />
        )}
        <Input
          aria-label="分支 / Tag（ref）"
          className="h-9 w-28 text-xs"
          placeholder="ref"
          value={ref}
          onChange={(event) => setRef(event.target.value)}
        />
        <Button
          size="sm"
          className="h-9"
          data-testid="millforge-import"
          disabled={importing}
          onClick={() => void doImport()}
        >
          {importing ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden="true" />
          )}
          {hasPack ? '更新' : '导入'}
        </Button>
      </div>

      {source?.resolved_url ? (
        <p className="truncate font-mono text-xs text-muted-foreground">
          派生 URL：{source.resolved_url}
        </p>
      ) : null}

      {sourceError ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>源配置失败</AlertTitle>
          <AlertDescription className="break-all font-mono text-xs">{sourceError}</AlertDescription>
        </Alert>
      ) : null}

      {importMsg ? (
        <Alert variant={importMsg.ok ? 'default' : 'destructive'}>
          {importMsg.ok ? (
            <CheckCircle2 className="size-4" aria-hidden="true" />
          ) : (
            <AlertCircle className="size-4" aria-hidden="true" />
          )}
          <AlertDescription className="break-all text-xs">{importMsg.text}</AlertDescription>
        </Alert>
      ) : null}

      {packsError ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>模板包列表加载失败</AlertTitle>
          <AlertDescription className="break-all font-mono text-xs">{packsError}</AlertDescription>
        </Alert>
      ) : null}

      {hasPack ? (
        <div className="space-y-1">
          <Label htmlFor="millforge-pack" className="text-xs font-semibold text-muted-foreground">
            模板包（pack）
          </Label>
          <Select value={pack || undefined} onValueChange={setPack}>
            <SelectTrigger id="millforge-pack" className="h-9 w-full text-xs">
              <SelectValue placeholder="选择已导入的模板包" />
            </SelectTrigger>
            <SelectContent>
              {packs.map((candidate) => (
                <SelectItem key={candidate.pack} value={candidate.pack} className="text-xs">
                  {candidate.pack}
                  {candidate.meta?.commit ? ` · ${String(candidate.meta.commit).slice(0, 7)}` : ''}
                  {candidate.parse_error ? '（INDEX 解析失败）' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {activePack ? (
            <p className="truncate text-xs text-muted-foreground">
              {activePack.meta?.url
                ? `${activePack.meta.url}${activePack.meta.ref ? ` · ref ${activePack.meta.ref}` : ''}`
                : ''}
              {activePack.meta?.imported_at ? ` · 导入时间 ${activePack.meta.imported_at}` : ''}
              {activePack.parse_error ? ` · INDEX 解析失败：${activePack.parse_error}` : ''}
            </p>
          ) : null}
        </div>
      ) : !packsLoading ? (
        <Alert>
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertDescription className="text-xs">
            尚未导入模板包——选择源（GitHub / GitCode / 自定义）后点「导入」。
            {packsError ? '' : '若提示控制器不支持，请升级 Controller。'}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
