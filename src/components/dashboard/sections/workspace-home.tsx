'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Asterisk, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useModels } from '@/hooks/use-agentteams-models';
import { useSkills } from '@/hooks/use-skill-center';
import { useMcpServers } from '@/hooks/use-agentteams-mcps';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useSectionStore } from '@/lib/section-store';
import { openChatRoom } from '@/lib/open-chat-room';
import { selectConfirmationList, useHitlInboxStore } from '@/lib/hitl-inbox';
import { mainTasks, subtaskProgress } from '@/lib/task-hierarchy';
import { taskStatus } from '@/lib/task-status';
import { workerDisplayName } from '@/lib/worker-display-name';
import { seedChatDraft } from './chat/hooks/usePersistedDraft';
import { HitlInboxCard } from './hitl-inbox-card';
import { PluginWidgetsGrid } from '@/components/plugins/plugin-widgets';
import type { BoardTask } from '@/hooks/use-task-board';
import type { TeamResponse, ManagerResponse, WorkerResponse } from '@/lib/agentteams-api';
import styles from './workspace-home.module.css';

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const weekdayFormatter = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' });

const ACTIVE_STATUSES = ['assigned', 'in_progress', 'revision', 'submitted'];

/** 参与 LIVE 协作卡的运行相位；休眠/停止/失败的 Agent 不上拓扑。 */
const LIVE_PHASES = new Set(['Running', 'Ready', 'Updating']);

/** 本周完成口径：completed 且 completedAt 落在本周一 00:00 之后。 */
function weekStart(now: Date): number {
  const monday = new Date(now);
  const sinceMonday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - sinceMonday);
  monday.setHours(0, 0, 0, 0);
  return monday.getTime();
}

function greetingFor(hour: number): string {
  if (hour < 12) return '上午好';
  if (hour < 18) return '下午好';
  return '晚上好';
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

  const text = now
    ? `${now.getMonth() + 1}月${now.getDate()}日，${weekdayFormatter.format(now)} · ${timeFormatter.format(now)}`
    : '\u00a0';

  return (
    <time className={styles.clock} dateTime={now?.toISOString()}>
      {text}
    </time>
  );
}

/**
 * 助手卡片（hero 左列）：问候 + 命令编排器。编排器提交时把文本写进目标房间的
 * 聊天草稿（ChatRoom 的 usePersistedDraft 会在房间切换渲染时读回），再经
 * openChatRoom 深链进入会话；拿不到助手房间时退回聊天分区。
 */
function AssistantCard({ managers, pendingCount }: { managers?: ManagerResponse[]; pendingCount: number }) {
  const [value, setValue] = useState('');
  const [greeting, setGreeting] = useState('');

  useEffect(() => {
    // 问候依赖本地时间，挂载后再渲染，避免服务端水合不一致。
    setGreeting(greetingFor(new Date().getHours()));
  }, []);

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
    <section className={styles.assistant} data-testid="home-composer" aria-label="助手">
      <header className={styles.assistantHead}>
        <span className={styles.assistantDot} aria-hidden="true" />
        <span>助手</span>
        <span className={styles.assistantCaption}>已关联工作区</span>
      </header>
      <p className={styles.assistantGreeting}>
        {greeting
          ? (pendingCount > 0
            ? `${greeting}。今天有 ${pendingCount} 事需要你确认，其余交给 Agent 就好。`
            : `${greeting}。一切按计划推进，交给 Agent 就好。`)
          : '\u00a0'}
      </p>
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
        <Button
          type="submit"
          size="sm"
          className="rounded-full bg-[var(--action-primary)] text-[var(--action-primary-foreground)] hover:bg-[var(--action-primary-hover)]"
          disabled={!value.trim()}
        >
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
            className="rounded-full bg-background text-xs"
            onClick={() => send(command.prompt)}
          >
            {command.label}
          </Button>
        ))}
      </div>
    </section>
  );
}

interface LiveAgentRow {
  key: string;
  name: string;
  percent?: number;
  output?: string;
}

/** LIVE COLLABORATION 卡：用真实 Worker 相位与在办任务渲染一句需求的协作拓扑。 */
function LiveCollaboration({ workers, teams, tasks }: {
  workers?: WorkerResponse[]; teams?: TeamResponse[]; tasks: BoardTask[];
}) {
  const rows = useMemo<LiveAgentRow[]>(() => (workers ?? [])
    .filter(worker => LIVE_PHASES.has(worker.phase))
    .slice(0, 2)
    .map(worker => {
      const task = tasks.find(candidate => candidate.status === 'in_progress'
        && typeof candidate.assignedTo === 'string' && candidate.assignedTo.includes(worker.name));
      const progress = task ? subtaskProgress(task, tasks) : null;
      const team = worker.team ? teams?.find(entry => entry.name === worker.team)?.teamName ?? worker.team : undefined;
      return {
        key: worker.name,
        name: workerDisplayName(worker),
        percent: progress?.percent,
        output: task?.title ?? team,
      };
    }), [workers, teams, tasks]);
  const total = workers?.length;

  return (
    <aside className={styles.live} data-testid="home-live" aria-label="实时协作概览">
      <header className={styles.liveHead}>
        <span className={styles.liveTitle}><span className={styles.liveDot} aria-hidden="true" />LIVE COLLABORATION</span>
        <span>{total === undefined ? '— AGENTS' : `${String(total).padStart(2, '0')} AGENTS`}</span>
      </header>
      <div className={styles.liveBody}>
        {rows.length ? (
          <>
            <div className={styles.youNode}>
              <span className={styles.youCircle}>你</span>
              <span className={styles.youCaption}>一句需求</span>
            </div>
            <div className={styles.agentRows}>
              {rows.map(row => (
                <div key={row.key} className={styles.agentRow}>
                  <span className={styles.agentPill}><span className={styles.agentDot} aria-hidden="true" />{row.name}</span>
                  <span className={styles.agentOutput}>{row.output ?? '待命'}</span>
                </div>
              ))}
            </div>
          </>
        ) : <p className={styles.liveEmpty}>等待 Agent 接入</p>}
      </div>
      <footer className={styles.liveFoot}>
        {rows.length
          ? `${rows.map(row => `${row.name}${row.percent !== undefined ? ` ${row.percent}%` : ''}`).join(' · ')} · 持续交付中`
          : '队列空闲，等待一句需求'}
      </footer>
    </aside>
  );
}

export function WorkspaceHome({ teams, managers, workerCount, tasks, loading, degraded }: {
  teams?: TeamResponse[]; managers?: ManagerResponse[]; workerCount?: number;
  tasks: BoardTask[]; loading: boolean; degraded: boolean;
}) {
  const models = useModels();
  const skills = useSkills();
  const tools = useMcpServers();
  const { data: workers } = useWorkers();
  const confirmationsMap = useHitlInboxStore(state => state.confirmations);
  const roots = useMemo(() => mainTasks(tasks), [tasks]);
  const active = useMemo(() => roots.filter(task => ACTIVE_STATUSES.includes(task.status)), [roots]);
  const monday = useMemo(() => weekStart(new Date()), []);
  const featured = active[0];
  const progress = featured ? subtaskProgress(featured, tasks) : null;
  const downstream = featured ? tasks.filter(task => task.dependsOn?.includes(featured.runId)).length : 0;
  const pendingCount = useMemo(() => selectConfirmationList(confirmationsMap).length, [confirmationsMap]);
  const navigate = (section: string) => useSectionStore.getState().setActiveSection(section);
  const openTasks = (task?: BoardTask) => {
    if (task?.projectId) window.location.hash = `workbench/tasks?project=${encodeURIComponent(task.projectId)}`;
    else navigate('tasks');
  };
  const memberCount = teams === undefined || managers === undefined || workerCount === undefined ? undefined : teams.length + workerCount + managers.length;
  const assets = [
    { section: 'resources', label: '成员与权限', count: memberCount },
    { section: 'models', label: '模型', count: models.isSuccess && !models.isPlaceholderData ? models.data?.length : undefined },
    { section: 'skills', label: '技能', count: skills.isSuccess && !skills.isPlaceholderData ? skills.data?.total : undefined },
    { section: 'tools', label: 'MCP 工具', count: tools.isSuccess && !tools.isPlaceholderData ? tools.data?.length : undefined },
  ];
  const assetCount = assets.every(asset => asset.count !== undefined) ? assets.reduce((sum, asset) => sum + (asset.count ?? 0), 0) : undefined;
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
        <WorkspaceClock />
        <h1>
          <span>一站式 AI 工作台</span>
          <span className={styles.headlineDetail}>从一句需求，到一支协作团队。</span>
        </h1>
        <AssistantCard managers={managers} pendingCount={pendingCount} />
      </div>
      <LiveCollaboration workers={workers} teams={teams} tasks={tasks} />
    </section>
    <div className={styles.metrics} data-testid="home-metrics" aria-label="工作区摘要">
      {metrics.map(metric => <button key={metric.label} type="button" onClick={() => navigate(metric.section)}><strong>{metric.count === undefined ? '—' : String(metric.count).padStart(2, '0')}</strong><span>{metric.label}</span></button>)}
    </div>
    <div className={styles.lower}>
      <section data-testid="home-followups" aria-label="优先跟进">
        <div className={styles.sectionHead}>
          <span className={styles.sectionIdx}>01</span>
          <h2>优先跟进</h2>
          <span className={styles.sectionCaption}>助手排序</span>
        </div>
        {featured ? <div className={styles.featured} data-testid="home-featured">
          <div className={styles.featuredEyebrow}>
            <span>{taskStatus(featured.status).label}{downstream > 0 ? ` · 阻塞下游 ${downstream} 项` : ''}</span>
            <span>{teams?.find(team => team.name === featured.teamId)?.teamName || featured.teamId || '协作任务'}</span>
          </div>
          <h3 className="truncate" title={featured.title}>{featured.title}</h3>
          <p className={styles.featuredDesc}>子任务 {progress?.completed} / {progress?.total}</p>
          <div className={styles.featuredAction}>
            <progress className={styles.featuredBar} aria-label="焦点任务进度" max={100} value={progress?.percent ?? 0} />
            <span className={styles.featuredPct}>{progress?.percent ?? 0}%</span>
            <Button
              size="sm"
              className="rounded-full bg-[var(--action-primary)] text-[var(--action-primary-foreground)] hover:bg-[var(--action-primary-hover)]"
              onClick={() => openTasks(featured)}
            >
              继续推进<ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div> : null}
        {!featured && <p role="status" className={styles.followEmpty}>{loading ? '正在加载任务…' : degraded ? '任务暂时无法加载，请稍后重试。' : '暂无需要跟进的事项'}</p>}
        <HitlInboxCard />
      </section>
      <section data-testid="home-assets" aria-label="工作区资产">
        <div className={styles.sectionHead}>
          <span className={styles.sectionIdx}>02</span>
          <h2>工作区资产</h2>
          <span className={styles.sectionCaption}>{assetCount === undefined ? '统计中' : `${assetCount} 项`}</span>
        </div>
        <div className={styles.assetsGrid}>
          {assets.map(asset => <button key={asset.section} type="button" className={styles.assetTile} onClick={() => navigate(asset.section)}>
            <span>{asset.label}</span>
            <strong>{asset.count === undefined ? '—' : String(asset.count).padStart(2, '0')}</strong>
          </button>)}
        </div>
      </section>
    </div>
    <PluginWidgetsGrid />
    <footer className={styles.wordmark} aria-hidden="true">
      <Asterisk className="size-3.5" />
      <span>BUILD · COLLABORATE · GOVERN</span>
    </footer>
  </div>;
}
