'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, ArrowRight, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useModels } from '@/hooks/use-agentteams-models';
import { useSkills } from '@/hooks/use-skill-center';
import { useMcpServers } from '@/hooks/use-agentteams-mcps';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useSectionStore } from '@/lib/section-store';
import { openChatRoom } from '@/lib/open-chat-room';
import { mainTasks, subtaskProgress } from '@/lib/task-hierarchy';
import { taskStatus } from '@/lib/task-status';
import { seedChatDraft } from './chat/hooks/usePersistedDraft';
import { HitlInboxCard } from './hitl-inbox-card';
import { PluginWidgetsGrid } from '@/components/plugins/plugin-widgets';
import type { BoardTask } from '@/hooks/use-task-board';
import type { TeamResponse, ManagerResponse } from '@/lib/agentteams-api';
import styles from './workspace-home.module.css';

const dateFormatter = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const weekdayFormatter = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' });

const ACTIVE_STATUSES = ['assigned', 'in_progress', 'revision', 'submitted'];

/** 本周完成口径：completed 且 completedAt 落在本周一 00:00 之后。 */
function weekStart(now: Date): number {
  const monday = new Date(now);
  const sinceMonday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - sinceMonday);
  monday.setHours(0, 0, 0, 0);
  return monday.getTime();
}

const QUICK_COMMANDS = [
  { label: '今天先做什么', prompt: '汇总今天需要我优先处理的事项，按紧急程度排序列出。' },
  { label: '生成本周周报', prompt: '根据本周的任务进展，生成一份团队周报。' },
];

function WorkspaceClock() {
  const [now, setNow] = useState<Date>();

  useEffect(() => {
    function update() {
      const current = new Date();
      setNow(current);
      timer = window.setTimeout(update, 60_000 - current.getTime() % 60_000);
    }

    let timer = window.setTimeout(update, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <time className={styles.clock} dateTime={now?.toISOString()}>
      {now ? `${dateFormatter.format(now)} ${timeFormatter.format(now)} · ${weekdayFormatter.format(now)}` : '\u00a0'}
    </time>
  );
}

/**
 * 命令编排器（P1）：一句指令直达 AT 助手会话。提交时把文本写进目标房间的
 * 聊天草稿（ChatRoom 的 usePersistedDraft 会在房间切换渲染时读回），再经
 * openChatRoom 深链进入会话；拿不到助手房间时退回聊天分区。
 */
function CommandComposer({ managers }: { managers?: ManagerResponse[] }) {
  const [value, setValue] = useState('');

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const room = managers?.find(manager => manager.roomID)?.roomID;
    if (room) {
      seedChatDraft(room, trimmed);
      openChatRoom(room);
    } else {
      useSectionStore.getState().setActiveSection('chat');
    }
    setValue('');
  }

  return (
    <section className={styles.composer} data-testid="home-composer" aria-label="命令编排器">
      <form
        className={styles.composerForm}
        onSubmit={(event) => {
          event.preventDefault();
          send(value);
        }}
      >
        <Sparkles className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input
          className={styles.composerInput}
          placeholder="和助手说一句，问进展、改计划、派任务…"
          aria-label="向 AT 助手输入指令"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="submit" size="sm" className="rounded-full" disabled={!value.trim()}>
          发送<Send className="size-4" aria-hidden="true" />
        </Button>
      </form>
      <div className={styles.composerChips}>
        {QUICK_COMMANDS.map(command => (
          <Button
            key={command.label}
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full text-xs"
            onClick={() => send(command.prompt)}
          >
            {command.label}
          </Button>
        ))}
      </div>
    </section>
  );
}

export function WorkspaceHome({ teams, managers, workerCount, tasks, loading, degraded }: {
  teams?: TeamResponse[]; managers?: ManagerResponse[]; workerCount?: number;
  tasks: BoardTask[]; loading: boolean; degraded: boolean;
}) {
  const level = useAgentTeamsStore(state => state.userLevel);
  const models = useModels();
  const skills = useSkills();
  const tools = useMcpServers();
  const roots = useMemo(() => mainTasks(tasks), [tasks]);
  const active = useMemo(() => roots.filter(task => ACTIVE_STATUSES.includes(task.status)), [roots]);
  const monday = useMemo(() => weekStart(new Date()), []);
  const featured = active[0];
  const progress = featured ? subtaskProgress(featured, tasks) : null;
  const navigate = (section: string) => useSectionStore.getState().setActiveSection(section);
  const openTasks = (task?: BoardTask) => {
    if (task?.projectId) window.location.hash = `workbench/tasks?project=${encodeURIComponent(task.projectId)}`;
    else navigate('tasks');
  };
  const assets = [
    { section: 'models', label: '模型管理', count: models.isSuccess && !models.isPlaceholderData ? models.data?.length : undefined },
    { section: 'skills', label: '技能管理', count: skills.isSuccess && !skills.isPlaceholderData ? skills.data?.total : undefined },
    { section: 'tools', label: 'MCP 工具', count: tools.isSuccess && !tools.isPlaceholderData ? tools.data?.length : undefined },
  ];
  const assetCount = assets.every(asset => asset.count !== undefined) ? assets.reduce((sum, asset) => sum + (asset.count ?? 0), 0) : undefined;
  const memberCount = teams === undefined || managers === undefined || workerCount === undefined ? undefined : teams.length + workerCount + managers.length;
  const completedThisWeek = loading || degraded ? undefined : roots.filter(task => task.status === 'completed' && task.completedAt !== undefined && task.completedAt >= monday).length;
  const metrics = [
    { label: '进行中', count: loading || degraded ? undefined : active.length, section: 'tasks' },
    { label: '本周完成', count: completedThisWeek, section: 'tasks' },
    { label: '协作成员', count: memberCount, section: 'teams' },
    { label: '工作区资产', count: assetCount, section: 'skills' },
  ];
  return <div className={styles.home}>
    <section className={styles.hero} data-testid="home-hero" aria-label="你的协作工作区">
      <div className={styles.copy}>
        <h1>
          <span>一站式 AI 工作台</span>
          <span className={styles.headlineDetail}>从一句需求，到一支协作团队。</span>
        </h1>
        <WorkspaceClock />
        <div className="flex flex-wrap items-center gap-3">
          {level >= 3 && <Button size="lg" className="h-12 rounded-full text-base" onClick={() => { const room = managers?.find(manager => manager.roomID)?.roomID; if (room) openChatRoom(room); else navigate('chat'); }}>与AT助手对话<ArrowRight className="size-5" aria-hidden="true" /></Button>}
          <Button size="lg" variant="ghost" className="h-12 rounded-full text-base" onClick={() => openTasks()}>查看任务<ArrowRight className="size-5" aria-hidden="true" /></Button>
        </div>
      </div>
      {featured && <aside className={styles.feature} data-testid="home-hero-aside">
        <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{taskStatus(featured.status).label}</span><ArrowUpRight className="size-4" aria-hidden="true" /></div>
        <h2 className="mt-1 truncate text-base font-semibold" title={featured.title}>{featured.title}</h2>
        <p className="my-2 truncate text-xs text-muted-foreground">{teams?.find(team => team.name === featured.teamId)?.teamName || featured.teamId || '协作任务'} · 子任务 {progress?.completed} / {progress?.total}</p>
        <progress className="h-1.5 w-full accent-[var(--action-primary)]" aria-label="焦点任务进度" max={100} value={progress?.percent ?? 0} />
        <Button variant="link" className="mt-2 h-auto p-0 text-sm" onClick={() => openTasks(featured)}>继续推进<ArrowUpRight className="size-4" aria-hidden="true" /></Button>
      </aside>}
    </section>
    <div className={styles.metrics} data-testid="home-metrics" aria-label="工作区摘要">
      {metrics.map(metric => <button key={metric.label} type="button" onClick={() => navigate(metric.section)}><strong>{metric.count === undefined ? '—' : String(metric.count).padStart(2, '0')}</strong><span>{metric.label}</span></button>)}
    </div>
    <div data-testid="home-hitl">
      <HitlInboxCard />
    </div>
    <CommandComposer managers={managers} />
    <section data-testid="home-focus">
      <div className={styles.sectionTitle}><h2>今日焦点</h2><Button variant="link" onClick={() => openTasks()}>任务看板<ArrowRight className="size-3.5" aria-hidden="true" /></Button></div>
      <div className={styles.list}>{active.length ? active.slice(0, 3).map(task => {
        const taskProgress = subtaskProgress(task, tasks);
        return <div key={task.runId} className={styles.row}><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" title={task.title}>{task.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{[task.assignedTo, task.teamId || task.projectId || task.runId].filter(Boolean).join(' · ')} · 子任务 {taskProgress.completed} / {taskProgress.total}</p></div><span className="flex shrink-0 items-center gap-1 text-xs"><span className="size-2 rounded-full" style={{ backgroundColor: taskStatus(task.status).color }} aria-hidden="true" />{taskStatus(task.status).label}</span><Button variant="link" size="sm" onClick={() => openTasks(task)}>查看<ArrowUpRight className="size-3.5" aria-hidden="true" /></Button></div>;
      }) : <p role="status" className="p-5 text-sm text-muted-foreground">{loading ? '正在加载任务…' : degraded ? '任务暂时无法加载，请稍后重试。' : '暂无正在推进的任务'}</p>}</div>
    </section>
    <section data-testid="home-assets">
      <div className={styles.sectionTitle}><h2>工作区资产</h2></div>
      <div className={styles.list}>{assets.map(asset => <div key={asset.section} className={styles.row}><div className="min-w-0 flex-1"><p className="text-sm font-medium">{asset.label}</p><p className="mt-1 text-xs text-muted-foreground">{asset.count === undefined ? '数据待加载' : `${asset.count} 项资产`}</p></div><Button variant="link" size="sm" onClick={() => navigate(asset.section)}>打开<ArrowRight className="size-3.5" aria-hidden="true" /></Button></div>)}</div>
    </section>
    <PluginWidgetsGrid />
  </div>;
}
