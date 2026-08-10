'use client';

import { useMemo, useCallback, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { motion } from 'framer-motion';
import {
  ListTodo,
  Search,
  CircleCheck,
  CircleX,
  Loader2,
  Clock,
  ChevronDown,
  ChevronUp,
  MessageSquare,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { SectionHeader } from '@/components/dashboard/section-header';
import { useTaskStore, selectTaskList, type TaskEntry } from '@/lib/task-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { useActiveSection } from '@/components/dashboard/use-active-section';
import type { WorkflowItem } from '@/lib/a2ui/workflow';

const COMPLETE_STATUSES = new Set(['completed', 'success', 'done']);
const ERROR_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled']);
const RUNNING_STATUSES = new Set(['in_progress', 'running']);

type StatusFilter = 'all' | 'running' | 'completed' | 'failed';

function taskStatus(task: TaskEntry): StatusFilter {
  if (COMPLETE_STATUSES.has(task.status)) return 'completed';
  if (ERROR_STATUSES.has(task.status)) return 'failed';
  if (RUNNING_STATUSES.has(task.status)) return 'running';
  return 'all';
}

function statusLabel(status?: string): string {
  if (!status) return '等待中';
  if (COMPLETE_STATUSES.has(status)) return '已完成';
  if (ERROR_STATUSES.has(status)) return '失败';
  if (RUNNING_STATUSES.has(status)) return '进行中';
  return status;
}

function statusClass(status?: string): string {
  if (!status) return 'bg-muted text-muted-foreground';
  if (COMPLETE_STATUSES.has(status)) return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400';
  if (ERROR_STATUSES.has(status)) return 'bg-red-500/15 text-red-700 dark:text-red-400';
  if (RUNNING_STATUSES.has(status)) return 'bg-violet-500/15 text-violet-700 dark:text-violet-400';
  return 'bg-muted text-muted-foreground';
}

function StatusBadge({ status }: { status?: string }) {
  return <Badge className={statusClass(status)}>{statusLabel(status)}</Badge>;
}

function roomDisplayName(roomId: string): string {
  const parts = roomId.split(':');
  const local = parts[0]?.replace(/^!/, '') || roomId;
  return local.length > 24 ? local.slice(0, 22) + '...' : local;
}

function TaskDetail({ task }: { task: TaskEntry }) {
  const completedSteps = task.steps.filter((s) => COMPLETE_STATUSES.has(s.status || '')).length;

  return (
    <div className="space-y-4 px-3 pb-3">
      {/* Sub-agents */}
      {task.subagents.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">子智能体</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {task.subagents.map((agent, i) => (
              <div
                key={agent.id || agent.name || String(i)}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-muted/30 text-xs"
              >
                <span className="truncate">{agent.title || agent.name || agent.id || `智能体 ${i + 1}`}</span>
                <StatusBadge status={agent.status || 'pending'} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Steps */}
      {task.steps.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground">执行步骤</p>
            <span className="text-xs text-muted-foreground">
              {completedSteps}/{task.steps.length}
            </span>
          </div>
          <Progress value={(completedSteps / task.steps.length) * 100} className="mb-2" />
          <div className="space-y-1.5">
            {task.steps.map((step, i) => {
              const complete = COMPLETE_STATUSES.has(step.status || '');
              const failed = ERROR_STATUSES.has(step.status || '');
              return (
                <div
                  key={step.id || step.name || String(i)}
                  className="flex items-center gap-2 text-xs"
                >
                  {complete ? (
                    <CircleCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  ) : failed ? (
                    <CircleX className="h-3.5 w-3.5 text-red-500 shrink-0" />
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500 shrink-0" />
                  )}
                  <span className="flex-1 truncate">{step.title || step.name || `步骤 ${i + 1}`}</span>
                  <span className="text-muted-foreground">{statusLabel(step.status)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground pt-2 border-t">
        <span className="flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {roomDisplayName(task.roomId)}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {new Date(task.updatedAt).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

export function TasksSection() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { setActiveSection } = useActiveSection();

  const tasks = useTaskStore(useShallow((s) => selectTaskList(s.tasks)));
  const matrixLoggedIn = useMatrixStore((s) => s.isLoggedIn);
  const clearTasks = useTaskStore((s) => s.clearTasks);
  const [reloadKey, setReloadKey] = useState(0);

  const handleReload = useCallback(() => {
    clearTasks();
    setReloadKey((k) => k + 1);
  }, [clearTasks]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (statusFilter !== 'all' && taskStatus(t) !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!t.title.toLowerCase().includes(q) && !t.runId.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [tasks, statusFilter, search]);

  const toggleExpand = useCallback((runId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }, []);

  const counts = useMemo(() => {
    let running = 0;
    let completed = 0;
    let failed = 0;
    for (const t of tasks) {
      const s = taskStatus(t);
      if (s === 'running') running++;
      else if (s === 'completed') completed++;
      else if (s === 'failed') failed++;
    }
    return { running, completed, failed };
  }, [tasks]);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="任务面板"
        description={
          matrixLoggedIn
            ? '实时查看 AgentTeams 任务分解与执行状态'
            : '需要先登录 Matrix 才能拉取任务数据'
        }
        actions={
          <Button variant="outline" size="sm" onClick={handleReload} title="清空当前任务并等待新事件">
            <Loader2 className="h-3.5 w-3.5 mr-1" />
            重新加载
          </Button>
        }
      />
      {/* Reload trigger — re-renders this hidden block to force a fresh sync cycle */}
      <div data-reload-key={reloadKey} hidden />

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: '进行中', count: counts.running, color: 'text-violet-500', bg: 'bg-violet-500/10 border-violet-500/20' },
          { label: '已完成', count: counts.completed, color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20' },
          { label: '失败', count: counts.failed, color: 'text-red-500', bg: 'bg-red-500/10 border-red-500/20' },
        ].map((s) => (
          <Card key={s.label} className={`glass-card ${s.bg} border`}>
            <CardContent className="p-4 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索任务名称或 Run ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          {([
            ['all', '全部'],
            ['running', '进行中'],
            ['completed', '已完成'],
            ['failed', '失败'],
          ] as const).map(([key, label]) => (
            <Button
              key={key}
              variant={statusFilter === key ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {tasks.length === 0 && (
        <Card className="glass-card">
          <CardContent className="p-12 text-center">
            <ListTodo className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            {matrixLoggedIn ? (
              <>
                <p className="text-sm font-medium">暂无任务</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Manager Agent 开始工作后，任务将自动出现在这里
                </p>
                <p className="text-xs text-muted-foreground/70 mt-3">
                  任务数据来自 Matrix 房间中的 agentteams.workflow 消息，首次同步最长需要 15 秒
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">尚未登录 Matrix</p>
                <p className="text-xs text-muted-foreground mt-1">
                  任务面板依赖 Matrix 房间消息，请先在「聊天」中登录
                </p>
                <Button
                  variant="default"
                  size="sm"
                  className="mt-4"
                  onClick={() => setActiveSection('chat')}
                >
                  <MessageSquare className="h-3.5 w-3.5 mr-1" />
                  前往聊天登录
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Task list */}
      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((task, i) => {
            const isExpanded = expanded.has(task.runId);
            const completedSteps = task.steps.filter((s) => COMPLETE_STATUSES.has(s.status || '')).length;
            const totalSteps = task.steps.length;

            return (
              <motion.div
                key={task.runId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <Card className="glass-card hover-lift overflow-hidden">
                  {/* Header row */}
                  <button
                    className="w-full text-left"
                    onClick={() => toggleExpand(task.runId)}
                  >
                    <div className="flex items-center gap-3 p-3">
                      {/* Status icon */}
                      {COMPLETE_STATUSES.has(task.status) ? (
                        <CircleCheck className="h-5 w-5 text-emerald-500 shrink-0" />
                      ) : ERROR_STATUSES.has(task.status) ? (
                        <CircleX className="h-5 w-5 text-red-500 shrink-0" />
                      ) : (
                        <Loader2 className="h-5 w-5 animate-spin text-violet-500 shrink-0" />
                      )}

                      {/* Title and meta */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{task.title}</span>
                          <StatusBadge status={task.status} />
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          <span className="font-mono">{task.runId.slice(0, 8)}</span>
                          <span className="flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />
                            {roomDisplayName(task.roomId)}
                          </span>
                          <span>{new Date(task.updatedAt).toLocaleTimeString()}</span>
                        </div>
                      </div>

                      {/* Progress indicator */}
                      {totalSteps > 0 && (
                        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                          <Progress value={(completedSteps / totalSteps) * 100} className="w-20 h-1.5" />
                          <span className="text-xs text-muted-foreground w-10 text-right">
                            {completedSteps}/{totalSteps}
                          </span>
                        </div>
                      )}

                      {/* Expand icon */}
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && <TaskDetail task={task} />}
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* No results after filter */}
      {tasks.length > 0 && filtered.length === 0 && (
        <Card className="glass-card">
          <CardContent className="p-8 text-center">
            <Search className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">没有匹配的任务</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
