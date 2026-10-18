'use client';

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { CircleAlert, Download, Library, Save, Send, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SectionHeader } from '@/components/dashboard/section-header';
import { toast } from 'sonner';
import {
  LOOP_STATE_EVENT,
  LOOP_TEMPLATES,
  canPublish,
  isValidLoopDefinition,
  templateToDraft,
  type LoopDefinition,
} from '@/lib/loop-definition';
import { useCapabilityStore, capabilityNote } from '@/lib/capability-probe';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { useRoomMetaStore } from '@/hooks/use-matrix';

// 画布按需分包（§8.4）：主 bundle 零画布字节（@xyflow/react ~100KB+）。
const LoopCanvas = lazy(() => import('./loops/loop-canvas'));

const DRAFTS_STORAGE_KEY = 'agentteams-loop-drafts';

interface StoredLoopDraft {
  id: string;
  name: string;
  definition: LoopDefinition;
}

function readDrafts(): StoredLoopDraft[] {
  try {
    const raw = localStorage.getItem(DRAFTS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredLoopDraft[]) : [];
    return parsed.filter((d) => isValidLoopDefinition(d.definition));
  } catch {
    return [];
  }
}

function writeDrafts(drafts: StoredLoopDraft[]): void {
  try {
    localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    /* localStorage unavailable */
  }
}

/** 向房间写循环定义（复用 state-event BFF；管理员）。 */
async function publishLoopToRoom(roomId: string, def: LoopDefinition): Promise<void> {
  // state-event BFF 只接受 com.agentteams.* 前缀 —— 循环定义直接复用。
  const res = await fetch(`/api/matrix/rooms/${encodeURIComponent(roomId)}/state-event`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventType: LOOP_STATE_EVENT,
      stateKey: `loop:${def.id}:v${def.version}`,
      content: def,
    }),
  });
  if (!res.ok) throw new Error(`发布失败（${res.status}）`);
}

export function LoopsSection() {
  const userLevel = useAgentTeamsStore((s) => s.userLevel);
  const currentUserId = useMatrixStore((s) => s.userId);
  const roomMeta = useRoomMetaStore((s) => s.meta);
  const loopsWrite = useCapabilityStore((s) => s.loopsWrite);
  const probeLoops = useCapabilityStore((s) => s.probeLoops);

  const [drafts, setDrafts] = useState<StoredLoopDraft[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<LoopDefinition | null>(null);
  const [bindRoomId, setBindRoomId] = useState<string>('');

  // F5.6：进入循环域即探测 loops 写能力（404=未接通 → 降级徽标）。
  useEffect(() => {
    void probeLoops();
  }, [probeLoops]);

  useEffect(() => {
    setDrafts(readDrafts());
  }, []);

  const roomOptions = useMemo(
    () =>
      Object.entries(roomMeta)
        .filter(([, meta]) => Boolean(meta.roomName))
        .map(([id, meta]) => ({ id, name: meta.roomName! })),
    [roomMeta],
  );

  const selected = useMemo(
    () => drafts.find((d) => d.id === selectedId) ?? null,
    [drafts, selectedId],
  );

  useEffect(() => {
    setEditing(selected?.definition ?? null);
  }, [selected]);

  const persistDrafts = useCallback((next: StoredLoopDraft[]) => {
    setDrafts(next);
    writeDrafts(next);
  }, []);

  const instantiateTemplate = (tpl: (typeof LOOP_TEMPLATES)[number]) => {
    const def = templateToDraft(tpl, currentUserId ?? 'unknown');
    const stored: StoredLoopDraft = { id: `${def.id}-${Date.now().toString(36)}`, name: def.name, definition: def };
    persistDrafts([stored, ...drafts]);
    setSelectedId(stored.id);
    toast.success(`已从模板创建草稿：${def.name}`);
  };

  const saveDraft = () => {
    if (!editing || !selected) return;
    const next = drafts.map((d) =>
      d.id === selected.id ? { ...d, name: editing.name, definition: { ...editing, status: 'draft' as const } } : d,
    );
    persistDrafts(next);
    toast.success('草稿已保存');
  };

  const publish = async () => {
    if (!editing || !selected) return;
    if (userLevel < 3) {
      toast.error('发布/回滚仅管理员可操作（PRD §7.2）');
      return;
    }
    const check = canPublish(editing);
    if (!check.ok) {
      toast.error(check.reason ?? '无法发布');
      return;
    }
    if (!bindRoomId) {
      toast.error('请先选择绑定空间（发布以房间状态事件存储）');
      return;
    }
    const version: LoopDefinition = {
      ...editing,
      status: 'published',
      publishedBy: currentUserId ?? 'unknown',
      publishedAt: Date.now(),
    };
    try {
      await publishLoopToRoom(bindRoomId, version);
      const next = drafts.map((d) =>
        d.id === selected.id ? { ...d, definition: version } : d,
      );
      persistDrafts(next);
      toast.success(`已发布 v${version.version} 到绑定空间`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发布失败');
    }
  };

  const exportJson = () => {
    if (!editing) return;
    const blob = new Blob([JSON.stringify(editing, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${editing.id}-v${editing.version}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file: File) => {
    void file.text().then((text) => {
      try {
        const parsed = JSON.parse(text) as LoopDefinition;
        if (!isValidLoopDefinition(parsed)) throw new Error('结构校验失败');
        const stored: StoredLoopDraft = {
          id: `${parsed.id}-import-${Date.now().toString(36)}`,
          name: parsed.name,
          definition: { ...parsed, status: 'draft', version: 1 },
        };
        persistDrafts([stored, ...drafts]);
        setSelectedId(stored.id);
        toast.success(`已导入：${parsed.name}（导入为 v1 草稿）`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '导入失败');
      }
    });
  };

  const rooms = roomOptions.length > 0 ? roomOptions : Object.entries(roomMeta).map(([id]) => ({ id, name: id }));

  return (
    <div className="space-y-4">
      <SectionHeader
        title="循环"
        description="流程画一次，复用无数次 —— 定义/发布/复用由 Dashboard 承载，执行由上游 Controller 运行"
      />

      {/* F5.6 能力徽标（§7.4 降级可见）：loops 写接口未接通时常显 */}
      {!loopsWrite && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{capabilityNote('loopsWrite')}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* 左栏：模板库 + 我的循环 */}
        <div className="space-y-3">
          <Card className="py-3">
            <CardContent className="px-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Library className="h-3.5 w-3.5" aria-hidden="true" />
                模板库
              </p>
              {LOOP_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => instantiateTemplate(tpl)}
                  className="w-full text-left rounded-md border border-border/60 hover:border-sky-500/40 hover:bg-accent/50 px-2.5 py-1.5 transition-colors"
                >
                  <span className="block text-xs font-medium">{tpl.name}</span>
                  <span className="block text-[10px] text-muted-foreground truncate">{tpl.description}</span>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="py-3">
            <CardContent className="px-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground">我的循环（{drafts.length}）</p>
                <label className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                  <Upload className="h-3 w-3" aria-hidden="true" />
                  导入
                  <input
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) importJson(file);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              {drafts.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelectedId(d.id)}
                  className={`w-full text-left rounded-md border px-2.5 py-1.5 transition-colors ${
                    selectedId === d.id ? 'border-sky-500/60 bg-sky-500/10' : 'border-border/60 hover:bg-accent/50'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium truncate">{d.name}</span>
                    <Badge variant="outline" className="text-[9px] shrink-0">
                      v{d.definition.version} · {d.definition.status === 'published' ? '已发布' : '草稿'}
                    </Badge>
                  </span>
                </button>
              ))}
              {drafts.length === 0 && (
                <p className="text-[10px] text-muted-foreground">
                  从模板一键实例化，或导入 JSON 定义。
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 右栏：画布 + 工具栏 */}
        <Card className="py-3">
          <CardContent className="px-3 space-y-3">
            {!editing ? (
              <div className="flex h-[480px] items-center justify-center text-sm text-muted-foreground">
                从左侧选择一个循环，或从模板库实例化开始编排。
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <Input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="h-8 w-56 text-sm"
                    aria-label="循环名称"
                  />
                  <Badge variant="outline" className="text-[10px]">
                    v{editing.version} · {editing.status === 'published' ? '已发布' : '草稿'}
                  </Badge>
                  <span className="ml-auto flex items-center gap-1.5 flex-wrap">
                    <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={saveDraft}>
                      <Save className="h-3 w-3" aria-hidden="true" />
                      存草稿
                    </Button>
                    <select
                      value={bindRoomId}
                      onChange={(e) => setBindRoomId(e.target.value)}
                      className="h-7 rounded-md border border-border/60 bg-background/60 px-1.5 text-xs"
                      aria-label="绑定空间"
                    >
                      <option value="">绑定空间…</option>
                      {rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 text-xs border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                      onClick={() => void publish()}
                      disabled={userLevel < 3}
                      title={userLevel < 3 ? '发布/回滚仅管理员（§7.2）' : '发布为不可变版本（写入绑定空间状态事件）'}
                    >
                      <Send className="h-3 w-3" aria-hidden="true" />
                      发布
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={exportJson}>
                      <Download className="h-3 w-3" aria-hidden="true" />
                      导出 JSON
                    </Button>
                  </span>
                </div>

                <Suspense
                  fallback={
                    <div className="h-[480px] flex items-center justify-center text-sm text-muted-foreground">
                      加载画布…
                    </div>
                  }
                >
                  <LoopCanvas
                    definition={editing}
                    onChange={setEditing}
                    readOnly={false}
                  />
                </Suspense>

                <p className="text-[10px] text-muted-foreground">
                  节点：蓝色 A=Agent · 黄 人=人工 · 紫 审=审查 · 虚线动画连线=条件退回路由；
                  拖动节点微调布局（自动保存在 definition.layout）。发布后版本不可变，修改请从模板重新实例化。
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
