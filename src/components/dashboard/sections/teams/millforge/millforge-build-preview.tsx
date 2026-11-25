'use client';

// 千锻编译预览——SOUL tabs（role/kind、行数/预算，超支红标、sha256、SOUL
// 全文）+ fragments/spawn-specs 清单 + provenance（SOUL 头注释解析）。
// 数据 = POST /millforge/compile 响应（SOUL 全文仅在编译响应内）。

import { CheckCircle2, Copy, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { MillforgeBuildResult } from '@/lib/agentteams-api';

function copyText(text: string) {
  try {
    void navigator.clipboard?.writeText(text).then(
      () => toast.success('已复制'),
      () => toast.info('复制失败，请手动选择'),
    );
  } catch {
    toast.info('复制失败，请手动选择');
  }
}

export function MillforgeBuildPreview({ build }: { build: MillforgeBuildResult }) {
  const hasProvenance = Object.keys(build.provenance || {}).length > 0;

  return (
    <div className="space-y-2">
      <Tabs defaultValue={build.roles[0]?.role} className="w-full">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
          {build.roles.map((role) => (
            <TabsTrigger key={role.role} value={role.role} className="h-8 px-2 text-xs">
              <span className="font-mono">{role.role}</span>
              <span className="text-muted-foreground">（{role.kind}）</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {build.roles.map((role) => (
          <TabsContent key={role.role} value={role.role} className="space-y-2 pt-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={role.budget_ok ? 'font-bold' : 'font-bold text-destructive'}>
                {role.lines} / {role.budget} 行
              </span>
              {role.budget_ok ? (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-3" aria-hidden="true" />
                  预算内
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1 text-destructive"
                  title="超支：行数超出预算（须回模板层减片段或提预算走人审，否则不可注入）"
                >
                  <XCircle className="size-3" aria-hidden="true" />
                  超支
                </span>
              )}
              <button
                type="button"
                className="inline-flex items-center gap-1 font-mono text-muted-foreground hover:text-foreground"
                title="点击复制完整 sha256"
                onClick={() => copyText(role.soul_sha256)}
              >
                <Copy className="size-3" aria-hidden="true" />
                {role.soul_sha256.slice(0, 12)}…
              </button>
            </div>
            {hasProvenance ? (
              <div className="flex flex-wrap gap-1">
                {Object.entries(build.provenance).map(([key, value]) => (
                  <Badge key={key} variant="outline" className="font-mono text-xs">
                    {key}={String(value)}
                  </Badge>
                ))}
              </div>
            ) : null}
            <pre className="max-h-96 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
              {role.soul}
            </pre>
          </TabsContent>
        ))}
      </Tabs>

      <div className="space-y-1">
        <p className="text-xs font-semibold text-muted-foreground">
          fragments 清单（{build.fragments.length}）
        </p>
        {build.fragments.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {build.fragments.map((fragment) => (
              <Badge key={fragment} variant="outline" className="font-mono text-xs">
                {fragment}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">（无）</p>
        )}
        <p className="text-xs font-semibold text-muted-foreground">
          spawn-specs 清单（{build.spawn_specs.length}）
        </p>
        {build.spawn_specs.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {build.spawn_specs.map((spec) => (
              <Badge key={spec} variant="outline" className="font-mono text-xs">
                {spec}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">（无）</p>
        )}
      </div>
    </div>
  );
}
