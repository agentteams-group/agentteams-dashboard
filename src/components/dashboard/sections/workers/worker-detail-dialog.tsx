'use client';

import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge, RuntimeBadge } from '@/components/dashboard/phase-badge';
import { HealthRing } from '@/components/dashboard/health-ring';
import { useAgentHealth } from '@/hooks/use-agent-health';
import { RUNTIME_LABELS } from '@/lib/phase-colors';
import type { WorkerResponse } from '@/lib/agentteams-api';
import { Upload, Check, AlertCircle, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useWorkerSkills, useUploadWorkerSkill } from '@/hooks/use-agentteams-worker-skills';
import { useWorkerApproval, APPROVAL_LEVELS, APPROVAL_LEVEL_LABELS } from '@/hooks/use-worker-approval';
import { PluginDetailBlocks } from '@/components/plugins/plugin-detail-blocks';
import { WorkerRuntimeConfigPanel } from '@/components/dashboard/sections/workers/worker-runtime-config-panel';
import { WorkerSkillAssign } from './worker-skill-assign';
import { WorkerChannelsPanel } from '@/components/dashboard/sections/workers/worker-channels-panel';
import { WorkerToolsPanel } from '@/components/dashboard/sections/workers/worker-tools-panel';

const DETAIL_FIELDS: Array<[string, (_w: WorkerResponse) => string]> = [
  ['名称', (w) => w.name],
  ['状态', (w) => w.state],
  ['运行时', (w) => RUNTIME_LABELS[w.runtime] || w.runtime],
  ['模型', (w) => w.model || '-'],
  ['镜像', (w) => w.image || '-'],
  ['团队', (w) => w.team || '-'],
  ['角色', (w) => w.role || '-'],
  ['关联 Agents', (w) => w.agents || '-'],
  ['Matrix 用户', (w) => w.matrixUserID || '-'],
  ['房间 ID', (w) => w.roomID || '-'],
  ['容器管理', (w) => (w.containerManaged ? '是' : '否')],
  ['容器状态', (w) => w.containerState || '-'],
  ['消息', (w) => w.message || '-'],
];

export function WorkerDetailDialog({
  worker,
  onOpenChange,
  onSaved,
}: {
  worker: WorkerResponse | null;
  onOpenChange: (_open: boolean) => void;
  /** 技能分配保存后回调（父层刷新 Worker 列表） */
  onSaved?: () => void;
}) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  const { data: currentSkills = [] } = useWorkerSkills(worker?.name ?? null);
  const uploadMutation = useUploadWorkerSkill();

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!worker?.name || !file) return;
    await uploadMutation.mutateAsync({ workerName: worker.name, file });
    setFile(null);
    setUploadOpen(false);
  }, [worker, file, uploadMutation]);

  const uploadResult = uploadMutation.data;
  type UploadStatus = 'success' | 'spec-failed' | 'reload-failed' | null;
  const uploadStatus: UploadStatus = !uploadResult
    ? null
    : !uploadResult.specUpdated
      ? 'spec-failed'
      : uploadResult.reloadError
        ? 'reload-failed'
        : 'success';

  return (
    <>
      <Dialog open={!!worker} onOpenChange={onOpenChange}>
        <DialogContent className="w-full max-w-[min(100%-2rem,56rem)] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Worker 详情 - {worker?.name}</span>
              {worker && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setUploadOpen(true)}
                  className="text-xs"
                >
                  <Upload className="w-3 h-3 mr-1" />
                  上传技能包
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>
          {worker && (
            <div className="space-y-3 py-4 text-sm">
              <div className="flex items-center gap-2 mb-3">
                <StatusDot phase={worker.phase} />
                <PhaseBadge kind="worker" phase={worker.phase} />
                <RuntimeBadge runtime={worker.runtime} />
              </div>
              <WorkerHealthBreakdown worker={worker} />
              {DETAIL_FIELDS.map(([label, read]) => (
                <div
                  key={label}
                  className="flex justify-between py-1 border-b border-border/50"
                >
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono text-xs max-w-[75%] text-right break-all">
                    {read(worker)}
                  </span>
                </div>
              ))}
              {(worker.mcpServers?.length ?? 0) > 0 && (
                <div className="pt-2">
                  <p className="text-muted-foreground mb-1">MCP Servers</p>
                  {worker.mcpServers?.map((s, i) => (
                    <div key={i} className="text-xs font-mono flex items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted-foreground">({s.transport})</span>
                      <span className="truncate">{s.url}</span>
                    </div>
                  ))}
                </div>
              )}
              {(worker.exposedPorts?.length ?? 0) > 0 && (
                <div className="pt-2">
                  <p className="text-muted-foreground mb-1">暴露端口</p>
                  {worker.exposedPorts?.map((p, i) => (
                    <div key={i} className="text-xs font-mono">
                      {p.port} → {p.domain}
                    </div>
                  ))}
                </div>
              )}
              {currentSkills.length > 0 && (
                <div className="pt-2">
                  <p
                    className="text-muted-foreground mb-1"
                    title="磁盘视角：列出 MinIO agents/{worker.name}/skills/ 下的已分发文件。与下方「技能分配」不是同一数据源——后者是 CR spec.skills（期望态）；取消勾选并保存只改 spec.skills，不会删除这里的磁盘文件。"
                  >
                    已分发技能（磁盘文件）
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {currentSkills.map((s) => (
                      <Badge key={s} variant="secondary" className="text-xs">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* B5: runtime-config 编辑（#1231 消费；上游未合并时 404 占位横幅）。
                  key=worker.name：换 worker 重挂载，编辑态自然清零 */}
              <WorkerRuntimeConfigPanel key={worker.name} workerName={worker.name} />

              <WorkerSkillAssign worker={worker} onSaved={onSaved} />

              {/* key=worker.name：换 worker 重挂载，状态自然清零（插件同款模式） */}
              <WorkerApprovalControl key={worker.name} workerName={worker.name} />

              {/* Plugin-contributed blocks (extension point: detail-panel) */}
              <PluginDetailBlocks entity="worker" data={worker} />

              {/* B6: 内置工具设置（#1255 消费；Controller 版本未含该端点 / L2 跨团队时 404 占位横幅）。
                  挂载在 B4（channels）之前——与各块独立 hunk，零重叠 */}
              <WorkerToolsPanel key={`tools-${worker.name}`} workerName={worker.name} />

              {/* B4: 频道接入矩阵（#1219 消费；上游未合并时 404 占位横幅）。
                  挂载在 PluginDetailBlocks 之后——与 B5（runtime-config，挂在其前）
                  保持独立 PR 零 hunk 重叠 */}
              <WorkerChannelsPanel key={`channels-${worker.name}`} workerName={worker.name} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Skill Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-md max-w-[95vw]">
          <DialogHeader>
            <DialogTitle>向 {worker?.name} 分发技能包</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">技能包 (ZIP) *</label>
              <div
                className={`relative rounded-md border-2 border-dashed p-6 text-center transition-colors ${
                  dragging
                    ? 'border-primary bg-primary/5'
                    : 'border-dashed border-border hover:border-primary/50'
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  accept=".zip"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={handleFileChange}
                />
                {file ? (
                  <div className="flex flex-col items-center gap-2">
                    <Check className="h-6 w-6 text-green-500" />
                    <p className="text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="h-6 w-6 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      拖拽 ZIP 文件到此处，或点击选择
                    </p>
                    <p className="text-xs text-muted-foreground">
                      须包含 SKILL.md（含 name / description 字段）
                    </p>
                  </div>
                )}
              </div>
            </div>

            {uploadMutation.isError && (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <p>{uploadMutation.error?.message ?? '上传失败'}</p>
              </div>
            )}

            {uploadMutation.isSuccess && uploadMutation.data && (
              uploadStatus === 'success' ? (
                <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
                  <Check className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">{uploadMutation.data.skillName}</p>
                    <p className="text-xs opacity-80">{uploadMutation.data.description}</p>
                    <p className="text-xs opacity-75 mt-1">{uploadMutation.data.note}</p>
                  </div>
                </div>
              ) : uploadStatus === 'reload-failed' ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">技能已就位，但 Worker 重启未确认</p>
                    <p className="text-xs opacity-80">
                      {uploadMutation.data.skillName} · 文件与 spec.skills 已写入
                    </p>
                    <p className="text-xs opacity-75 mt-1">
                      {uploadMutation.data.reloadError ?? '稍后会自动 reload，或手动触发 ensure-ready。'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">技能文件已上传，但声明式分配更新失败</p>
                    <p className="text-xs opacity-80">
                      {uploadMutation.data.skillName} ·{' '}
                      {uploadMutation.data.filesCount} 个文件
                    </p>
                    <p className="text-xs opacity-75 mt-1">
                      {uploadMutation.data.specError ?? '请稍后重试，或手动刷新 Worker 详情。'}
                    </p>
                    <button
                      type="button"
                      className="mt-2 text-xs underline underline-offset-2"
                      onClick={() => uploadMutation.reset()}
                    >
                      重试
                    </button>
                  </div>
                </div>
              )
            )}

            {currentSkills.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">该 Worker 已有技能</p>
                <div className="flex flex-wrap gap-1">
                  {currentSkills.map((s) => (
                    <Badge key={s} variant="secondary" className="text-xs">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setUploadOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!file || uploadMutation.isPending}
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  上传中...
                </>
              ) : (
                '分发技能'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function WorkerHealthBreakdown({ worker }: { worker: WorkerResponse }) {
  const health = useAgentHealth(worker);
  if (!health) return null;

  return (
    <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/30 border border-border/50">
      <HealthRing score={health.overall} size={56} strokeWidth={4} label={health.label} />
      <div className="flex-1 space-y-1.5">
        <HealthBar label="可用性" value={health.availability} />
        <HealthBar label="稳定性" value={health.stability} />
        <HealthBar label="就绪度" value={health.readiness} />
      </div>
    </div>
  );
}

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
        <span className="flex-basis-full text-[11px] text-blue-500">
          ℹ️ 配置工具调用的审批策略，控制智能体执行工具时的安全级别
        </span>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          加载工具执行安全...
        </div>
      ) : l2Hint ? (
        <p className="py-2 text-[11.5px] text-amber-600">{l2HintText ?? '工具执行安全级别当前不可读（Controller 升级后自动开放）'}</p>
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
                  <div className="min-w-0 text-[11.5px] leading-snug">
                    <div className="text-xs font-bold">{APPROVAL_CARD_LABEL[lv]}</div>
                    <div className="text-muted-foreground">{APPROVAL_DESC[lv]}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-[11px]" style={{ color: APPROVAL_COLOR[level] }}>
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
              <span className="text-[11px] text-muted-foreground/60">无变更</span>
            )}
            <Button size="sm" variant="ghost" className="h-6 px-2" onClick={reload}>
              <RotateCcw className="h-3 w-3" />
            </Button>
          </div>
        </>
      ) : (
        <p className="py-2 text-[11.5px] text-destructive">⚠ {error ?? '该 Worker 未读到工具执行安全级别'}</p>
      )}
      {error && level && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function HealthBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? 'bg-emerald-500' : value >= 60 ? 'bg-green-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-10">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-[10px] font-mono w-6 text-right">{value}</span>
    </div>
  );
}
