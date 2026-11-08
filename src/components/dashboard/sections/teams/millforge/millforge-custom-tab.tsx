'use client';

// 千锻自定义团队——描述需求表单（成员/任务类型/运行时/最痛 3 问题/团队名）
// →「生成提示词」（POST /millforge/prompt）+ 复制；粘贴 LLM 返回 JSON →
//「校验」（POST /millforge/parse-team-json）→ 字段级错误列表；校验通过 →
//「编译（team_json）」（同一 build 预览，注入仍走「注入」tab）。

import { AlertCircle, CheckCircle2, Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { MillforgeCore } from './use-millforge-core';

export function MillforgeCustomTab({
  core,
  fallbackTeamName,
}: {
  core: MillforgeCore;
  fallbackTeamName: string;
}) {
  const { custom, setCustom, genPrompt, parseJson, compileWithTeamJson, compiling, pack } = core;

  const set = (patch: Partial<MillforgeCore['custom']>) =>
    setCustom((state) => ({ ...state, ...patch }));

  const parseTeam = custom.parseResult?.ok ? custom.parseResult.team : undefined;
  const parseErrors =
    custom.parseResult && !custom.parseResult.ok ? custom.parseResult.errors || [] : [];
  const roleCount = parseTeam && Array.isArray(parseTeam.roles) ? parseTeam.roles.length : 0;
  const teamName = (custom.team_name || '').trim() || fallbackTeamName || 'team';

  const copyPrompt = () => {
    try {
      void navigator.clipboard?.writeText(custom.prompt).then(
        () => toast.success('已复制'),
        () => toast.info('复制失败，请手动选择'),
      );
    } catch {
      toast.info('复制失败，请手动选择');
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="millforge-custom-members" className="text-xs font-semibold text-muted-foreground">
            成员（成员/任务类型/运行时 之一）
          </Label>
          <Textarea
            id="millforge-custom-members"
            className="min-h-14 text-xs"
            rows={2}
            placeholder="例：3 个前端工程师 + 1 个测试 + 1 个架构评审"
            value={custom.members}
            onChange={(event) => set({ members: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="millforge-custom-tasks" className="text-xs font-semibold text-muted-foreground">
            任务类型（members 缺省时必填）
          </Label>
          <Textarea
            id="millforge-custom-tasks"
            className="min-h-14 text-xs"
            rows={2}
            placeholder="例：React 组件开发、接口联调、回归测试"
            value={custom.task_types}
            onChange={(event) => set({ task_types: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="millforge-custom-runtime" className="text-xs font-semibold text-muted-foreground">
            运行时（选填）
          </Label>
          <Input
            id="millforge-custom-runtime"
            className="h-9 text-xs"
            placeholder="qwenpaw"
            value={custom.runtime}
            onChange={(event) => set({ runtime: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="millforge-custom-team" className="text-xs font-semibold text-muted-foreground">
            团队名（选填）
          </Label>
          <Input
            id="millforge-custom-team"
            className="h-9 text-xs"
            placeholder="留空用当前团队名"
            value={custom.team_name}
            onChange={(event) => set({ team_name: event.target.value })}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="millforge-custom-pains" className="text-xs font-semibold text-muted-foreground">
          最痛的 3 个问题（必填）
        </Label>
        <Textarea
          id="millforge-custom-pains"
          className="min-h-16 text-xs"
          rows={3}
          placeholder="例：1) 联调环境不稳 2) 回归全靠人 3) 架构决策没记录"
          value={custom.pains}
          onChange={(event) => set({ pains: event.target.value })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="h-9"
          data-testid="millforge-prompt"
          disabled={!pack || custom.promptBusy}
          onClick={() => void genPrompt()}
        >
          {custom.promptBusy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : null}
          生成提示词
        </Button>
        <span className="text-xs text-muted-foreground">
          把提示词发给 LLM，将其返回的 JSON 粘回下方「校验」。
        </span>
      </div>

      {custom.promptError ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>生成提示词失败</AlertTitle>
          <AlertDescription className="break-all font-mono text-xs">
            {custom.promptError}
          </AlertDescription>
        </Alert>
      ) : null}

      {custom.prompt ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">提示词（发给 LLM）</span>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={copyPrompt}>
              <Copy className="size-3" aria-hidden="true" />
              复制
            </Button>
          </div>
          <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
            {custom.prompt}
          </pre>
        </div>
      ) : null}

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">
            LLM 返回的 JSON（粘贴）
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            data-testid="millforge-parse"
            disabled={!pack || custom.parseBusy}
            onClick={() => void parseJson()}
          >
            {custom.parseBusy ? (
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            ) : null}
            校验
          </Button>
          {parseTeam ? (
            <Button
              size="sm"
              className="h-7 text-xs"
              data-testid="millforge-compile-json"
              disabled={!pack || compiling}
              onClick={() => void compileWithTeamJson(teamName, parseTeam)}
            >
              {compiling ? (
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              ) : null}
              编译（team_json）
            </Button>
          ) : null}
        </div>
        <Textarea
          aria-label="LLM 返回的 JSON"
          className="min-h-24 font-mono text-xs"
          rows={5}
          placeholder="粘贴 LLM 返回的 JSON 全文"
          value={custom.jsonText}
          onChange={(event) =>
            set({ jsonText: event.target.value, parseError: '', parseResult: null })
          }
        />
        {custom.parseError ? (
          <Alert variant="destructive" className="py-2">
            <AlertCircle className="size-4" aria-hidden="true" />
            <AlertTitle>校验失败</AlertTitle>
            <AlertDescription className="break-all font-mono text-xs">
              {custom.parseError}
            </AlertDescription>
          </Alert>
        ) : null}
        {parseErrors.length > 0 ? (
          <Alert variant="destructive" className="py-2">
            <AlertCircle className="size-4" aria-hidden="true" />
            <AlertTitle>校验未通过（{parseErrors.length} 处）</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4 font-mono text-xs">
                {parseErrors.map((error, index) => (
                  <li key={`${error.path}-${index}`}>
                    {error.path} — {error.message}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        {parseTeam ? (
          <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-3" aria-hidden="true" />
            校验通过（{roleCount} 个角色）——点「编译（team_json）」进入预览，再到「注入」tab 注入。
          </p>
        ) : null}
      </div>
    </div>
  );
}
