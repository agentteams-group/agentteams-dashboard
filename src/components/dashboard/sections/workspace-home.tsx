'use client';

import { useEffect, useMemo, useState } from 'react';
import { useModels } from '@/hooks/use-agentteams-models';
import { useSkills } from '@/hooks/use-skill-center';
import { useMcpServers } from '@/hooks/use-agentteams-mcps';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useProjects } from '@/hooks/use-projects';
import { useSectionStore } from '@/lib/section-store';
import { openChatRoom } from '@/lib/open-chat-room';
import {
  selectConfirmationList,
  useHitlInboxStore,
  type HitlConfirmation,
} from '@/lib/hitl-inbox';
import { useInviteStore } from '@/lib/matrix-invite-store';
import { formatInterventionTimeout, partitionByAge, useInterventionTimeoutMs } from '@/lib/intervention-timeout';
import { mainTasks, subtaskProgress } from '@/lib/task-hierarchy';
import { taskStatus } from '@/lib/task-status';
import { workerDisplayName } from '@/lib/worker-display-name';
import { seedChatDraft } from './chat/hooks/usePersistedDraft';
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

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return `${Math.max(1, Math.floor(diff / 1000))}秒前`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${Math.floor(diff / 86400000)}天前`;
}

/** SVG 舞台内的文案截断：按显示宽度近似（CJK 记 1、拉丁记 0.5）。 */
function ellipse(text: string, maxUnits: number): string {
  let width = 0;
  for (let index = 0; index < text.length; index += 1) {
    width += text.charCodeAt(index) > 0x2e7f ? 1 : 0.5;
    if (width > maxUnits) return `${text.slice(0, index)}…`;
  }
  return text;
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
    ? `${now.getMonth() + 1} 月 ${now.getDate()} 日，${weekdayFormatter.format(now)} · ${timeFormatter.format(now)}`
    : '\u00a0';

  return (
    <time className={styles.date} dateTime={now?.toISOString()}>
      {text}
    </time>
  );
}

/**
 * 助手卡片（hero 左列）：问候 + 命令编排器。编排器提交时把文本写进目标房间的
 * 聊天草稿（ChatRoom 的 usePersistedDraft 会在房间切换渲染时读回），再经
 * openChatRoom 深链进入会话；拿不到助手房间时退回聊天分区。
 */
function AssistantCard({ managers, pendingCount, activeCount }: {
  managers?: ManagerResponse[]; pendingCount: number; activeCount: number;
}) {
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
        <i className={styles.assistantDot} aria-hidden="true" />
        助手
        <span className={styles.assistantCaption}>已关联工作区</span>
      </header>
      <p className={styles.assistantMsg}>
        {greeting
          ? (pendingCount > 0
            ? <>{greeting}。今天只有 <b>{pendingCount} 件事</b>需要你确认。<br />其余 {activeCount} 项，交给 Agent 就好。</>
            : <>{greeting}。一切按计划推进。<br />都交给 Agent 就好。</>)
          : '\u00a0'}
      </p>
      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          send(value);
        }}
      >
        <input
          className={styles.composerInput}
          placeholder="和助手说一句，问进展、改计划、派任务…"
          aria-label="向 AT 助手输入指令"
          value={value}
          maxLength={60}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" className={styles.send} disabled={!value.trim()}>
          发送 ↑
        </button>
      </form>
      <div className={styles.chips}>
        {QUICK_COMMANDS.map(command => (
          <button key={command.label} type="button" className={styles.chip} onClick={() => send(command.prompt)}>
            {command.label}
          </button>
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

/**
 * LIVE COLLABORATION 卡：用真实 Worker 相位与在办任务渲染「你 → Agent →
 * 输出物」的 SVG 协作拓扑。几何取自 WORKSPACE 设计稿（440×180 舞台，
 * 双 Agent 行 57/123，单 Agent 居中 90）。
 */
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
  const centers = rows.length === 2 ? [57, 123] : rows.length === 1 ? [90] : [];

  return (
    <aside className={styles.scene} data-testid="home-live" aria-label="实时协作概览">
      <header className={styles.sceneHead}>
        <span className={styles.liveTag}><i className={styles.liveDot} aria-hidden="true" />LIVE COLLABORATION</span>
        <span>{total === undefined ? '— AGENTS' : `${String(total).padStart(2, '0')} AGENTS`}</span>
      </header>
      {rows.length ? <svg
        className={styles.sceneSvg}
        viewBox="0 0 440 180"
        role="img"
        aria-label={`你提出需求，${rows.map(row => row.name).join('、')} 协作交付${rows.map(row => row.output).filter(Boolean).join('、') || '任务'}`}
      >
        {centers.map((cy, index) => {
          const row = rows[index];
          const outY = rows.length === 2 ? (index === 0 ? 63 : 111) : 90;
          return (
            <g key={row.key}>
              <path d={`M64 90 C110 90 110 ${cy} 150 ${cy}`} fill="none" stroke="#7F9586" strokeWidth="1.2" />
              <path d={`M260 ${cy} C300 ${cy} 296 ${outY} 330 ${outY}`} fill="none" stroke="#7F9586" strokeWidth="1.2" />
              <rect fill="#2B4035" height="34" rx="17" stroke="#597060" strokeWidth=".7" width="110" x="150" y={cy - 17} />
              <circle cx="167" cy={cy} fill="#A9CB6B" r="4.5" />
              <text fill="#EDF2E9" fontSize="12" x="181" y={cy + 4}>{ellipse(row.name, 6)}</text>
              <rect fill="#EFF3E8" height="30" rx="9" width="78" x="330" y={outY - 15} />
              <text fill="#243229" fontSize="11" textAnchor="middle" x="369" y={outY + 4}>{ellipse(row.output ?? '待命', 6)}</text>
            </g>
          );
        })}
        <circle cx="42" cy="90" fill="#A9CB6B" r="22" />
        <text fill="#24301B" fontSize="13" fontWeight="600" textAnchor="middle" x="42" y="95">你</text>
        <text fill="#A8B8AD" fontSize="10" textAnchor="middle" x="42" y="132">一句需求</text>
      </svg> : <p className={styles.sceneEmpty}>等待 Agent 接入</p>}
      <footer className={styles.sceneFoot}>
        {rows.length
          ? `${rows.map(row => `${ellipse(row.name, 8)}${row.percent !== undefined ? ` ${row.percent}%` : ''}`).join(' · ')} · 持续交付中`
          : '队列空闲，等待一句需求'}
      </footer>
    </aside>
  );
}

/** 优先跟进行：HITL 审批 / 执行提问、暂停项目与 Matrix 邀请统一为编号行。 */
function followRows(input: {
  confirmations: HitlConfirmation[];
  roomLabels: Record<string, string>;
  paused: Array<{ project_id: string; team_id?: string | null; title: string }>;
  inviteCount: number;
}): Array<{ key: string; title: string; meta: string; action: string; onOpen: () => void }> {
  const rows: Array<{ key: string; title: string; meta: string; action: string; onOpen: () => void }> = [];
  for (const item of input.confirmations) {
    const label = input.roomLabels[item.roomId] ?? item.roomId;
    rows.push({
      key: `confirm:${item.id}`,
      title: item.question ? `${item.question}` : `确认 ${item.toolName}`,
      meta: `${relativeTime(item.timestamp)} · ${label}`,
      action: item.question ? '去回应' : '去确认',
      onOpen: () => openChatRoom(item.roomId),
    });
  }
  for (const project of input.paused) {
    rows.push({
      key: `paused:${project.team_id ?? ''}:${project.project_id}`,
      title: project.title,
      meta: `已暂停项目 · ${project.project_id}`,
      action: '去恢复',
      onOpen: () => {
        useHitlInboxStore.getState().setPendingProjectKey({ id: project.project_id, team: project.team_id ?? undefined });
        useSectionStore.getState().setActiveSection('tasks');
      },
    });
  }
  if (input.inviteCount > 0) {
    rows.push({
      key: 'invites',
      title: `${input.inviteCount} 个房间邀请未处理`,
      meta: '打开聊天面板查看',
      action: '去接受',
      onOpen: () => useSectionStore.getState().setActiveSection('chat'),
    });
  }
  return rows;
}

export function WorkspaceHome({ teams, managers, workerCount, tasks, loading, degraded }: {
  teams?: TeamResponse[]; managers?: ManagerResponse[]; workerCount?: number;
  tasks: BoardTask[]; loading: boolean; degraded: boolean;
}) {
  const models = useModels();
  const skills = useSkills();
  const tools = useMcpServers();
  const { data: workers } = useWorkers();
  const { data: projectList } = useProjects();
  const timeoutMs = useInterventionTimeoutMs();
  const confirmationsMap = useHitlInboxStore(state => state.confirmations);
  const invitesMap = useInviteStore(state => state.invites);
  const roots = useMemo(() => mainTasks(tasks), [tasks]);
  const active = useMemo(() => roots.filter(task => ACTIVE_STATUSES.includes(task.status)), [roots]);
  const monday = useMemo(() => weekStart(new Date()), []);
  const featured = active[0];
  const progress = featured ? subtaskProgress(featured, tasks) : null;
  const downstream = featured ? tasks.filter(task => task.dependsOn?.includes(featured.runId)).length : 0;
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

  const confirmations = useMemo(() => selectConfirmationList(confirmationsMap), [confirmationsMap]);
  const { fresh, aged } = useMemo(() => partitionByAge(confirmations, timeoutMs), [confirmations, timeoutMs]);
  const pausedProjects = useMemo(
    () => (projectList?.projects ?? []).filter(project => project.status === 'paused'),
    [projectList],
  );
  const inviteCount = useMemo(() => Object.values(invitesMap).length, [invitesMap]);
  const roomLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const worker of workers ?? []) {
      if (worker.roomID) labels[worker.roomID] = worker.name;
    }
    for (const team of teams ?? []) {
      if (team.teamRoomID) labels[team.teamRoomID] = team.teamName || team.name;
    }
    for (const manager of managers ?? []) {
      if (manager.roomID) labels[manager.roomID] = manager.name;
    }
    return labels;
  }, [workers, teams, managers]);
  const rows = useMemo(
    () => followRows({ confirmations: fresh, roomLabels, paused: pausedProjects, inviteCount }),
    [fresh, roomLabels, pausedProjects, inviteCount],
  );

  return <div className={styles.home}>
    <div className={styles.top}>
      <div className={styles.brand}>
        <i className={styles.brandMark} aria-hidden="true">✳</i>
        AGENTTEAMS
        <span className={styles.brandPath}>/ WORKSPACE</span>
      </div>
    </div>
    <div className={styles.hero} data-testid="home-hero">
      <div className={styles.copy}>
        <WorkspaceClock />
        <h1 className={styles.title}>一站式 AI 工作台</h1>
        <p className={styles.slogan}>从一句需求，<span>到一支协作团队。</span></p>
        <AssistantCard managers={managers} pendingCount={fresh.length} activeCount={active.length} />
      </div>
      <LiveCollaboration workers={workers} teams={teams} tasks={tasks} />
    </div>
    <div className={styles.metrics} data-testid="home-metrics" aria-label="工作区摘要">
      {metrics.map(metric => <button key={metric.label} type="button" className={styles.stat} onClick={() => navigate(metric.section)}><span className={styles.statValue}>{metric.count === undefined ? '—' : String(metric.count).padStart(2, '0')}</span><span className={styles.statLabel}>{metric.label}</span></button>)}
    </div>
    <div className={styles.main}>
      <section data-testid="home-followups" aria-label="优先跟进">
        <div className={styles.secHead}>
          <span className={styles.secNo}>01</span>
          <h2 className={styles.secTitle}>优先跟进</h2>
          <span className={styles.secNote}>助手推荐</span>
        </div>
        {featured ? <div className={styles.focus} data-testid="home-featured">
          <div className={styles.focusTop}>
            <span>{taskStatus(featured.status).label}{downstream > 0 ? ` · 阻塞下游 ${downstream} 项` : ''}</span>
            <span>{teams?.find(team => team.name === featured.teamId)?.teamName || featured.teamId || '协作任务'}</span>
          </div>
          <h3 className={styles.focusTitle} title={featured.title}>{featured.title}</h3>
          <p className={styles.focusWhy}>子任务 {progress?.completed} / {progress?.total}{downstream > 0 ? `，完成后解锁下游 ${downstream} 项。` : '。'}</p>
          <div className={styles.focusBottom}>
            <div
              className={styles.track}
              role="progressbar"
              aria-label="焦点任务进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress?.percent ?? 0}
            >
              <div className={styles.fill} style={{ width: `${progress?.percent ?? 0}%` }} />
            </div>
            <span className={styles.pct}>{progress?.percent ?? 0}%</span>
            <button type="button" className={styles.go} onClick={() => openTasks(featured)}>继续推进 →</button>
          </div>
        </div> : <p role="status" className={styles.followEmpty}>{loading ? '正在加载任务…' : degraded ? '任务暂时无法加载，请稍后重试。' : '暂无需要跟进的事项'}</p>}
        {rows.map((row, index) => <div key={row.key} className={styles.next}>
          <span className={styles.nextNo}>{String(index + (featured ? 2 : 1)).padStart(2, '0')}</span>
          <div className={styles.nextBody}>
            <div className={styles.nextTitle} title={row.title}>{row.title}</div>
            <div className={styles.nextMeta}>{row.meta}</div>
          </div>
          <button type="button" className={styles.goGhost} onClick={row.onOpen}>{row.action}</button>
        </div>)}
        {aged.length > 0 && <p className={styles.agedNote}>另有 {aged.length} 条更早待处理（超过 {formatInterventionTimeout(timeoutMs)}），可在任务看板收件箱查看。</p>}
      </section>
      <aside data-testid="home-assets" aria-label="工作区资产">
        <div className={styles.secHead}>
          <span className={styles.secNo}>02</span>
          <h2 className={styles.secTitle}>工作区资产</h2>
          <span className={styles.secNote}>{assetCount === undefined ? '统计中' : `${assetCount} 项`}</span>
        </div>
        <div className={styles.assets}>
          {assets.map(asset => <button key={asset.section} type="button" className={styles.asset} onClick={() => navigate(asset.section)}>
            <span className={styles.assetName}>{asset.label}</span>
            <span className={styles.assetValue}>{asset.count === undefined ? '—' : String(asset.count).padStart(2, '0')}</span>
          </button>)}
        </div>
      </aside>
    </div>
    <PluginWidgetsGrid />
    <footer className={styles.foot} aria-hidden="true">
      <b>✳</b>BUILD · COLLABORATE · GOVERN
    </footer>
  </div>;
}
