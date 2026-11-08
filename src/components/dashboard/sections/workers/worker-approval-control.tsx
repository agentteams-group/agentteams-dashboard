'use client';

// 工具执行安全（QwenPaw 原生四模式）——workbench 插件同款官方 ToolExecutionLevelCard
// 卡片式四档选择器（9/18 装验定案「照插件做」）：内联 SVG 图标（lucide ISC 路径逐字
// 取自插件 ApprovalControl.tsx）+ 官方模式名/描述 + 选中=模式色 2px 边框整卡可点。
//
// 数据面（BFF 双平面，REST 优先）：
//   REST = Controller #1216（本团队 Worker 可读写；OFF→403；team leader 只读；
//          跨团队 404(W8) 防探测）
//   Docker = Controller Docker 代理（env flag AGENTTEAMS_APPROVAL_DOCKER_PLANE=1
//          才启用，默认关；仅 L1：archive 直读 agent.json / exec 容器内
//          running-config 整对象写——live 热加载+落盘+MinIO 同步）
//   404（Worker 不存在/无可用平面）→ 整节隐藏；读 403 → 琥珀提示不报错（文案
//   由 BFF l2_hint 给出，区分「端点未上线」与「账号无权限」）。

import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useWorkerApproval, APPROVAL_LEVELS, APPROVAL_LEVEL_LABELS } from '@/hooks/use-worker-approval';

const APPROVAL_ICON: Record<string, { d: string; circle?: boolean }> = {
  STRICT: { circle: true, d: 'm4.9 4.9 14.2 14.2' }, // lucide Ban
  SMART: { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z M12 9v4 M12 17h.01' }, // lucide AlertTriangle
  AUTO: { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' }, // lucide Shield
  OFF: { circle: true, d: 'm9 12 2 2 4-4' }, // lucide CircleCheck
};
const APPROVAL_CARD_LABEL: Record<string, string> = {
  OFF: '关闭模式',
  AUTO: '自动模式',
  SMART: '智能模式',
  STRICT: '严格模式',
};
const APPROVAL_DESC: Record<string, string> = {
  OFF: '关闭所有工具审批，所有工具自动执行',
  AUTO: '仅被明确标记为需要审批的工具才会要求审批（默认）',
  SMART: '低风险工具自动放行，中高风险工具需要审批',
  STRICT: '所有工具调用都需要审批，最高安全级别',
};
const APPROVAL_COLOR: Record<string, string> = {
  OFF: '#52c41a',
  AUTO: '#1890ff',
  SMART: '#faad14',
  STRICT: '#ff4d4f',
};
const LEVEL_ORDER = ['STRICT', 'SMART', 'AUTO', 'OFF'] as const;

function ApprovalLevelIcon({ lv, size, color }: { lv: string; size: number; color: string }) {
  const spec = APPROVAL_ICON[lv];
  if (!spec) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {spec.circle ? <circle cx={12} cy={12} r={10} /> : null}
      <path d={spec.d} />
    </svg>
  );
}

export function WorkerApprovalControl({ workerName }: { workerName: string }) {
  const { off, l2Hint, l2HintText, loading, level, saving, error, setLevel, reload } = useWorkerApproval(workerName);
  // draft = 用户暂选（null = 跟随当前 level）。不用 effect 同步（避免
  // set-state-in-effect 级联）：选中=draft??level，应用成功后重置 draft=null。
  const [draft, setDraft] = useState<string | null>(null);
  if (off) return null; // 404 → 整节隐藏（Worker 不存在/两平面均不可用）
  const effective = draft ?? level;
  const changed = draft !== null && effective !== level;
  return (
    <div className="rounded-lg border p-2.5 pt-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold" title="QwenPaw 原生「工具执行安全」四模式（设置页同款）">
          <ApprovalLevelIcon lv="AUTO" size={15} color={APPROVAL_COLOR.AUTO} />
          工具执行安全
        </span>
        <span className="flex-basis-full text-xs text-blue-500">
          ℹ️ 配置工具调用的审批策略，控制 Agent 执行工具时的安全级别
        </span>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          加载工具执行安全...
        </div>
      ) : l2Hint ? (
        <p className="py-2 text-xs text-amber-600">{l2HintText ?? '工具执行安全级别当前不可读（Controller 升级后自动开放）'}</p>
      ) : level ? (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            {LEVEL_ORDER.map((lv) => {
              const active = effective === lv;
              return (
                <div
                  key={lv}
                  onClick={() => !saving && setDraft(lv)}
                  className="flex cursor-pointer items-start gap-2 rounded-md p-2 transition-all"
                  style={{
                    border: `1px solid ${active ? APPROVAL_COLOR[lv] : 'var(--border)'}`,
                    borderWidth: active ? 2 : 1,
                    background: active ? 'var(--muted)' : 'transparent',
                    minWidth: 0,
                  }}
                >
                  <div className="mt-0.5">
                    <ApprovalLevelIcon lv={lv} size={17} color={APPROVAL_COLOR[lv]} />
                  </div>
                  <div className="min-w-0 text-xs leading-snug">
                    <div className="text-xs font-bold">{APPROVAL_CARD_LABEL[lv]}</div>
                    <div className="text-muted-foreground">{APPROVAL_DESC[lv]}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-xs" style={{ color: APPROVAL_COLOR[level] }}>
              当前模式: {APPROVAL_LEVEL_LABELS[level]}（{level}）
            </Badge>
            {changed && effective ? (
              <Button
                size="sm"
                disabled={saving}
                onClick={async () => {
                  const ok = await setLevel(effective as (typeof APPROVAL_LEVELS)[number]);
                  if (ok) setDraft(null);
                }}
              >
                {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                应用: {APPROVAL_CARD_LABEL[effective]}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground/60">无变更</span>
            )}
            <Button size="sm" variant="ghost" className="h-6 px-2" onClick={reload}>
              <RotateCcw className="h-3 w-3" />
            </Button>
          </div>
        </>
      ) : (
        <p className="py-2 text-xs text-destructive">⚠ {error ?? '该 Worker 未读到工具执行安全级别'}</p>
      )}
      {error && level && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
