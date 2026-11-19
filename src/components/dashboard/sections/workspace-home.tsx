'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModels } from '@/hooks/use-agentteams-models';
import { useSkills } from '@/hooks/use-skill-center';
import { useMcpServers } from '@/hooks/use-agentteams-mcps';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useSectionStore } from '@/lib/section-store';
import { openChatRoom } from '@/lib/open-chat-room';
import { mainTasks, subtaskProgress } from '@/lib/task-hierarchy';
import { taskStatus } from '@/lib/task-status';
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

export function WorkspaceHome({ teams, managers, workerCount, tasks, loading, degraded }: {
  teams?: TeamResponse[]; managers?: ManagerResponse[]; workerCount?: number;
  tasks: BoardTask[]; loading: boolean; degraded: boolean;
}) {
  const level = useAgentTeamsStore(state => state.userLevel);
  const models = useModels();
  const skills = useSkills();
  const tools = useMcpServers();
  const roots = mainTasks(tasks);
  const active = roots.filter(task => ['assigned', 'in_progress', 'revision', 'submitted'].includes(task.status));
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
  const metrics = [
    { label: '协作团队', count: teams?.length, section: 'teams' },
    { label: 'Agent', count: workerCount === undefined || managers === undefined ? undefined : workerCount + managers.length, section: 'workers' },
    { label: '任务', count: loading || degraded ? undefined : roots.length, section: 'tasks' },
    { label: '模型、技能和工具', count: assetCount, section: 'skills' },
  ];
  return <div className={styles.home}>
    <section className={styles.hero} aria-label="你的协作工作区">
      <div className={styles.copy}>
        <h1>
          <span>一站式AI工作台</span>
          <span className={styles.headlineDetail}>构建-协作-治理</span>
        </h1>
        <WorkspaceClock />
        <div className="flex flex-wrap items-center gap-3">
          {level >= 3 && <Button size="lg" className="h-12 rounded-full text-base" onClick={() => { const room = managers?.find(manager => manager.roomID)?.roomID; if (room) openChatRoom(room); else navigate('chat'); }}>与AT助手对话<ArrowRight className="size-5" /></Button>}
          <Button size="lg" variant="ghost" className="h-12 rounded-full text-base" onClick={() => openTasks()}>查看任务<ArrowRight className="size-5" /></Button>
        </div>
      </div>
      {featured && <div className={styles.feature}>
        <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{taskStatus(featured.status).label}</span><ArrowUpRight className="size-4" /></div>
        <h2 className="mt-1 truncate text-base font-semibold" title={featured.title}>{featured.title}</h2>
        <p className="my-2 truncate text-xs text-muted-foreground">{teams?.find(team => team.name === featured.teamId)?.teamName || featured.teamId || '协作任务'} · 子任务 {progress?.completed} / {progress?.total}</p>
        <Button variant="link" className="h-auto p-0 text-sm" onClick={() => openTasks(featured)}>查看任务<ArrowUpRight className="size-4" /></Button>
      </div>}
    </section>
    <div className={styles.metrics} aria-label="工作区摘要">
      {metrics.map(metric => <button key={metric.section} type="button" onClick={() => navigate(metric.section)}><strong>{metric.count === undefined ? '—' : String(metric.count).padStart(2, '0')}</strong><span>{metric.label}</span></button>)}
    </div>
    <div className={styles.lower}>
      <section><div className={styles.sectionTitle}><h2>正在推进</h2><Button variant="link" onClick={() => openTasks()}>任务看板<ArrowRight className="size-3.5" /></Button></div>
        <div className={styles.list}>{active.length ? active.slice(0, 3).map(task => <div key={task.runId} className={styles.row}><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" title={task.title}>{task.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{task.teamId || task.projectId || task.runId}</p></div><span className="flex shrink-0 items-center gap-1 text-xs"><span className="size-2 rounded-full" style={{ backgroundColor: taskStatus(task.status).color }} />{taskStatus(task.status).label}</span><Button variant="link" size="sm" onClick={() => openTasks(task)}>查看<ArrowUpRight className="size-3.5" /></Button></div>) : <p role="status" className="p-5 text-sm text-muted-foreground">{loading ? '正在加载任务…' : degraded ? '任务暂时无法加载，请稍后重试。' : '暂无正在推进的任务'}</p>}</div>
      </section>
      <section><div className={styles.sectionTitle}><h2>工作区资产</h2></div><div className={styles.list}>{assets.map(asset => <div key={asset.section} className={styles.row}><div className="min-w-0 flex-1"><p className="text-sm font-medium">{asset.label}</p><p className="mt-1 text-xs text-muted-foreground">{asset.count === undefined ? '数据待加载' : `${asset.count} 项资产`}</p></div><Button variant="link" size="sm" onClick={() => navigate(asset.section)}>打开<ArrowRight className="size-3.5" /></Button></div>)}</div></section>
    </div>
  </div>;
}
