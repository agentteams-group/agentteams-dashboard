'use client';

// 技能分配（worker × skill 矩阵）：Worker 详情内 spec.skills 勾选。
// 语义 = 全量覆盖（以本页为准）：PUT /workers skills 非 nil 即整表替换
// （controller resource_handler.go `if req.Skills != nil { worker.Spec.Skills = req.Skills }`），
// 保存提交勾选全集，取消勾选 = 移除该技能。保存前不做重读合并：本组件是
// spec.skills 的全量管理面，期间其他入口（上传/分发）写入的技能会被覆盖——
// 文案已注明「以本页为准」。
// 目录 = GET /skills（技能中心同源，MinIO skills bucket）；勾选基线 =
// 最近一次保存成功的集合（本地基线 savedBase），初始 = worker.skills
// （CR spec.skills）。不在目录中的存量条目单列（琥珀标记）——真实
// 场景 = 目录里的技能条目被删除/改名后 spec.skills 的残留（目录技能名
// 是纯 SkillEntry.name；nacos:// 在仓库里只作注册中心 URL，不是技能名
// 形态）。全量覆盖会清掉残留，必须让用户看得见。
// 保存成功后显式 restartWorker：controller 的 spec hash 不含 skills，
// reconcile 不会重建容器，reconcileMemberSkills 只补文件不重启——与
// useUploadWorkerSkill 同款：restart 失败 = 软失败（spec 已持久化）。
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSkills } from '@/hooks/use-skill-center';
import { useUpdateWorker } from '@/hooks/use-agentteams-mutations';
import { agentteamsApi } from '@/lib/agentteams-api';
import type { WorkerResponse } from '@/lib/agentteams-api';

export function WorkerSkillAssign({
  worker,
  onSaved,
}: {
  worker: WorkerResponse;
  onSaved?: () => void;
}) {
  // 目录必须全量：stray 判定依赖完整集合。useSkills 默认 pageSize=200，
  // 超过 200 条的技能会全部落进 strays 被标「不在目录」，全量覆盖语义下
  // 可能被用户误判清掉——skills route 无硬上限（内存 slice），传大值一次取全。
  const { data: catalog = { skills: [], total: 0 } } = useSkills(undefined, undefined, 1, 10000);
  const qc = useQueryClient();
  // 仓库既有 worker 更新单一入口：统一失效集合（workers / worker-detail /
  // cluster-status）+ toast + 通知，不再自建 useMutation。
  const updateWorker = useUpdateWorker();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [inited, setInited] = useState<string | null>(null);
  // 本地基线 = 最近一次保存成功的集合。保存成功后父级 detailWorker 快照
  // 不会刷新（onSaved 只 refetch 列表），若仍拿 worker.skills 当基线，
  // dirty 恒为 true、「已保存」徽章在继续改选时也不消失。
  const [savedBase, setSavedBase] = useState<string[] | null>(null);
  // 成功提示的计数在保存成功瞬间锁定——checked 随后随用户操作继续变化，
  // 直接渲染 [...checked].length 会把「未保存的当前勾选集」当已保存数。
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [restartNote, setRestartNote] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  // 勾选基线 = CR spec.skills。React 官方「reset state to respond to props
  // changes」模式：渲染期间按 name 重置（换 Worker / 重开详情时生效；保存
  // 成功后 prop 未变 → 不重置，避免把用户勾选冲掉）。
  if (inited !== worker.name) {
    setInited(worker.name);
    setChecked(new Set(worker.skills ?? []));
    setSavedBase(null);
  }

  const catalogNames = useMemo(
    () => new Set(catalog.skills.map((s) => s.name)),
    [catalog.skills],
  );
  const strays = useMemo(
    () => [...(worker.skills ?? [])].filter((s) => !catalogNames.has(s)),
    [worker.skills, catalogNames],
  );
  const baseSkills = useMemo(
    () => new Set(savedBase ?? worker.skills ?? []),
    [savedBase, worker.skills],
  );

  const dirty = useMemo(() => {
    if (inited !== worker.name) return false;
    if (checked.size !== baseSkills.size) return true;
    for (const s of checked) if (!baseSkills.has(s)) return true;
    return false;
  }, [checked, baseSkills, inited, worker.name]);

  const saving = updateWorker.isPending || restarting;

  const handleSave = async () => {
    const skills = [...checked];
    setSavedCount(null);
    setRestartNote(null);
    try {
      // PUT /workers skills 非 nil = 全表替换（controller 语义）
      await updateWorker.mutateAsync({ name: worker.name, data: { skills } });
    } catch {
      // 失败 toast 已由 useUpdateWorker.onSuccess 之外的 onError 统一给出
      return;
    }
    // spec.skills 变更不触发 controller 重建容器（qwenpaw spec hash 不含
    // skills），必须显式 restart 才能让运行中的 Worker 加载新技能集合。
    // restart 失败 = 软失败：spec 已持久化，下次重启/重建即生效
    // （同 useUploadWorkerSkill 的软失败处理）。
    setRestarting(true);
    let note: string | null = null;
    try {
      const reload = await agentteamsApi.restartWorker(worker.name);
      if (reload?.success === false) note = reload?.note || 'Worker 重启未确认';
    } catch (err) {
      note = err instanceof Error ? err.message : 'Worker 重启失败';
    } finally {
      setRestarting(false);
    }
    // 基线切到刚提交的集合 → dirty 归零，「已保存」徽章在继续改选时
    // 随 setSavedCount(null) 消失
    setSavedBase(skills);
    setSavedCount(skills.length);
    setRestartNote(note);
    // chips（磁盘已分发文件）同步失效——useUpdateWorker 的失效集合不含此查询
    qc.invalidateQueries({ queryKey: ['agentteams-worker-skills', worker.name] });
    onSaved?.();
  };

  const clearSavedBadge = () => {
    setSavedCount(null);
    setRestartNote(null);
  };

  const toggle = (name: string) => {
    clearSavedBadge();
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const allNames = useMemo(
    () => [...new Set([...catalog.skills.map((s) => s.name), ...strays])],
    [catalog.skills, strays],
  );

  if (allNames.length === 0 && baseSkills.size === 0) {
    return (
      <div className="pt-2">
        <p className="text-muted-foreground mb-1">技能分配</p>
        <p className="text-xs text-muted-foreground">
          技能目录为空——先在「资源中心 → 技能」上传技能包，或直接在上方上传。
        </p>
        <p className="text-xs text-muted-foreground">
          此处改动不影响上方「已分发技能（磁盘文件）」列表。
        </p>
      </div>
    );
  }

  return (
    <div className="pt-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-muted-foreground">技能分配（保存 = 以本页为准全量覆盖）</p>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => { setChecked(new Set(allNames)); clearSavedBadge(); }}
          >
            全选
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => { setChecked(new Set()); clearSavedBadge(); }}
          >
            清空
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-2">
        勾选要分配给该 Worker 的技能；取消勾选即移除。保存将按勾选全集覆盖
        spec.skills 并重启 Worker——期间由其他入口（上传/分发）写入的技能会被覆盖。
        此处改动不影响上方「已分发技能（磁盘文件）」列表。
        {strays.length > 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            有 {strays.length} 个已分配技能不在目录中，保存前请确认是否保留。
          </span>
        )}
      </p>
      <div className="space-y-1 max-h-48 overflow-y-auto rounded-md border border-border/60 p-2">
        {catalog.skills.map((s) => (
          <label
            key={s.name}
            className="flex items-center gap-2 text-xs cursor-pointer py-0.5"
          >
            <input
              type="checkbox"
              className="accent-primary"
              checked={checked.has(s.name)}
              onChange={() => toggle(s.name)}
            />
            <span className="font-mono">{s.name}</span>
            {s.source === 'nacos' && (
              <Badge variant="secondary" className="text-xs px-1 h-4">
                nacos
              </Badge>
            )}
            {s.description && (
              <span className="text-muted-foreground truncate flex-1">
                {s.description}
              </span>
            )}
          </label>
        ))}
        {strays.map((s) => (
          <label
            key={s}
            className="flex items-center gap-2 text-xs cursor-pointer py-0.5"
          >
            <input
              type="checkbox"
              className="accent-amber-500"
              checked={checked.has(s)}
              onChange={() => toggle(s)}
            />
            <span className="font-mono">{s}</span>
            <Badge variant="outline" className="text-xs px-1 h-4 text-amber-600 dark:text-amber-400">
              不在目录
            </Badge>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-2">
        <Button
          size="sm"
          disabled={!dirty || saving}
          onClick={handleSave}
        >
          {saving ? (
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          ) : (
            <Check className="w-3 h-3 mr-1" />
          )}
          保存分配
        </Button>
        {savedCount !== null && (
          <span className="text-xs text-green-600 dark:text-green-400">
            已保存（{savedCount} 个技能）
          </span>
        )}
        {savedCount !== null && restartNote && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            {restartNote}（技能分配已保存，重启后生效）
          </span>
        )}
      </div>
    </div>
  );
}
