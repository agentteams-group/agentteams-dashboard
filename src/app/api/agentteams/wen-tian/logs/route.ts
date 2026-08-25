// POST /api/agentteams/wen-tian/logs — collect debug logs with SSE progress,
// then run them (plus the user's symptom description and a dashboard snapshot)
// through an LLM and stream the diagnosis report back.
//
// Body:
//   range      string  log window, e.g. "1h" (default) — max 30d
//   redact     boolean PII redaction, default true
//   container  string  substring filter on agentteams-* container names
//   room       string  Matrix room name filter
//   homeserver string  Matrix homeserver (paired with the Authorization header)
//   symptom    string  user-reported problem description
//   model      string  model alias override (routed by the AI gateway)
//   snapshot   string  dashboard health snapshot injected into the prompt
//
// SSE events:
//   progress  { phase, pct, message }
//   summary   { summary, fileCount, totalBytes }
//   chunk     { content }           (LLM token)
//   result    { answer }
//   error     { error }

import { NextRequest } from 'next/server';
import { enforceLevelOnlyRbac } from '@/lib/server-auth';
import { redactPii } from '../../debug-log/redact';
import {
  DockerContext,
  getContainerLogs,
  inspectContainer,
  listAgentTeamsContainers,
} from '../../debug-log/docker';
import { exportAgentSessions } from '../../debug-log/sessions';
import { exportMatrixMessages } from '../../debug-log/matrix';
import { getAuthToken, getControllerUrl } from '../../proxy-helper';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_RANGE_SECONDS = 30 * 24 * 3600;
const MAX_CONTAINERS = 100;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const COLLECT_DEADLINE_MS = 240_000;

// Prompt size guards — the collected bundle can be huge, but only bounded
// excerpts are actually fed to the LLM (container log tails, session tails,
// per-container inspect facts). Full logs stay available via the ZIP export.
const MAX_SYMPTOM_CHARS = 4000;
const MAX_SNAPSHOT_CHARS = 8192;
const MAX_CONTAINER_TAIL_BYTES = 16 * 1024;
const MAX_CONTAINER_LOG_PROMPT_BYTES = 96 * 1024;
const MAX_SESSION_FILES_IN_PROMPT = 12;
const MAX_SESSION_FILE_TAIL_LINES = 50;
const MAX_SESSION_PROMPT_BYTES = 32 * 1024;

function parseRange(rangeStr: string): number {
  const m = /^(\d+)\s*(m|min|h|hr|hour|d|day)s?$/i.exec(rangeStr.trim());
  if (!m) throw new Error(`Invalid range format: '${rangeStr}'`);
  const value = parseInt(m[1], 10);
  const unit = m[2][0].toLowerCase();
  const multiplier = unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  if (value <= 0) throw new Error('Range must be a positive number');
  const seconds = value * multiplier;
  if (seconds > MAX_RANGE_SECONDS) throw new Error('Range too large: maximum is 30d');
  return seconds;
}

interface CollectBudget {
  startedAt: number;
  totalBytes: number;
  exhausted: boolean;
  reason: string;
}
function createBudget(): CollectBudget {
  return { startedAt: Date.now(), totalBytes: 0, exhausted: false, reason: '' };
}
function budgetExhausted(b: CollectBudget): boolean {
  if (b.exhausted) return true;
  if (Date.now() - b.startedAt > COLLECT_DEADLINE_MS) {
    b.exhausted = true; b.reason = 'time budget exceeded'; return true;
  }
  if (b.totalBytes >= MAX_TOTAL_BYTES) {
    b.exhausted = true; b.reason = 'byte budget exceeded'; return true;
  }
  return false;
}
function noteFor(prefix: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : 'unknown error';
  return `${prefix}: ${redactPii(msg).slice(0, 500)}`;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Keep the last `maxBytes` of `text`, dropping the (usually partial) first line. */
function tailText(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text;
  const cut = text.slice(text.length - maxBytes);
  const firstNl = cut.indexOf('\n');
  const aligned = firstNl >= 0 ? cut.slice(firstNl + 1) : cut;
  return `…(前文已截断，仅保留尾部)\n${aligned}`;
}

/** Compact one-line docker inspect facts for the prompt. */
function containerFactLine(name: string, image: string, restartCount: number | null, state: unknown): string {
  const s = typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : {};
  const bits = [
    `image=${image || 'unknown'}`,
    `state=${asString(s['Status']) ?? 'unknown'}`,
    `running=${s['Running'] === true}`,
  ];
  const exitCode = asNumber(s['ExitCode']);
  if (exitCode !== undefined && exitCode !== 0) bits.push(`exitCode=${exitCode}`);
  if (s['OOMKilled'] === true) bits.push('OOMKilled=true');
  const error = asString(s['Error']);
  if (error) bits.push(`error=${error.slice(0, 120)}`);
  if (restartCount !== null && restartCount > 0) bits.push(`restarts=${restartCount}`);
  return `- ${name}: ${bits.join(' ')}`;
}

interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}
function getLlmConfig(modelOverride?: string): LlmConfig {
  return {
    baseUrl: process.env.AGENTTEAMS_OPENAI_BASE_URL || process.env.AGENTTEAMS_AI_GATEWAY_URL || 'https://api.openai.com/v1',
    apiKey: process.env.AGENTTEAMS_LLM_API_KEY || '',
    model: modelOverride || process.env.AGENTTEAMS_DEFAULT_MODEL || 'gpt-4',
  };
}

function buildPrompt(args: {
  symptom: string;
  snapshot: string;
  summary: string;
  containerFacts: string[];
  containerLogExcerpts: string[];
  sessionExcerpts: string[];
}): string {
  const { symptom, snapshot, summary, containerFacts, containerLogExcerpts, sessionExcerpts } = args;
  return [
    '你是 AgentTeams 多智能体协作平台的资深 SRE 故障诊断专家，擅长从症状描述、环境快照与日志证据中定位根因并给出可落地的修复方案。',
    '',
    '# AgentTeams 平台背景',
    '- Controller / Orchestrator：平台控制面，管理 Worker、团队（Team）、Human 的生命周期与任务调度，并反向代理 Docker API',
    '- Agent Worker：承载智能体的容器，运行时为 OpenClaw / Hermes / CoPaw，通过环境变量 AGENTTEAMS_WORKER_NAME 标识',
    '- 团队（Team）/ Human：多智能体协作单元与人类成员；团队有 Leader（manager Worker）与成员 Worker，就绪状态依赖心跳',
    '- Matrix：消息中间件，承载团队房间、DM、Human 登录；房间创建失败会阻塞协作流程',
    '- MinIO：对象存储，保存工件与部分会话数据',
    '- Higress AI 网关：模型流量入口（Provider → AI Route → 模型别名），负责认证、路由与限流',
    '- 部署形态：Docker 嵌入式（embedded）或 Kubernetes 集群内（incluster）',
    '',
    '# 常见故障域（按此清单系统排查）',
    '- Worker 一直 Pending / Failed：镜像拉取失败、端口冲突、容器启动即退出（看 exitCode/OOMKilled/重启次数）',
    '- 模型调用失败：API Key 无效、模型别名无 AI 路由、网关限流（429）、上游超时',
    '- Matrix 故障：homeserver 不可达、Human 登录失败、房间创建/加入失败、消息发送超时',
    '- MinIO 故障：endpoint 不可达、bucket 不存在、凭据失效',
    '- 团队协作故障：Leader 未就绪、成员 Worker 不足、心跳超时、任务队列积压、Agent 间通信超时',
    '- 会话/上下文问题：上下文溢出、会话文件损坏、工具调用失败循环',
    '- 资源问题：CPU/内存/磁盘耗尽、容器被 OOM Kill、重启循环',
    '',
    '# 分析步骤',
    '1. 提炼症状：明确故障现象、影响范围与紧急程度；将用户描述与日志证据相互印证。',
    '2. 容器状态扫描：先看容器 facts（state/exitCode/restarts/OOMKilled），异常容器优先深入。',
    '3. 日志扫描：在容器日志与会话摘录中识别 ERROR、WARN、Exception、Traceback、Timeout、Retry、refused、panic、OOM 等关键事件。',
    '4. 时间线重建：按时间戳排序关键事件，找出第一个异常，标注因果链。',
    '5. 关联上下文：用 trace_id / request_id / session_id / agent_id / 房间 ID 串联不同模块的日志。',
    '6. 假设验证：对照上面故障域清单逐项排查，用日志证据支持或排除，按置信度排序。',
    '7. 给出方案与缺口：输出可执行的修复步骤；证据不足时明确列出需要补充的信息。',
    '',
    '# 输出格式（严格遵循，输出中文，将渲染为 Markdown 报告）',
    '## 🩺 诊断结论',
    '第一行：一句话结论。第二行：`严重程度：🔴 紧急 | 🟠 严重 | 🟡 注意 | 🟢 健康`（四选一）。',
    '',
    '## 📋 诊断概要',
    '| 检查项 | 结果 |',
    '| --- | --- |',
    '覆盖：用户症状是否复现、容器健康、模型链路、消息链路、存储链路等 4-8 行。',
    '',
    '## 🕐 关键事件时间线',
    '| 时间 | 服务/模块 | 级别 | 事件摘要 | 证据 |',
    '| --- | --- | --- | --- | --- |',
    '按时间升序；证据列引用原始日志片段（简短引用）。没有可靠事件时写“未捕获到关键异常事件”。',
    '',
    '## 🔍 根因分析',
    '按置信度从高到低编号列出，每条格式：`### 根因 N：<标题>（置信度：高/中/低）`，正文给出证据链与推理，明确区分“已确认事实”与“推测”。',
    '',
    '## 🛠️ 修复建议',
    '### 立即执行',
    '编号步骤；命令、配置修改用 ```bash / ```yaml 代码块给出，可直接复制执行。',
    '### 后续优化',
    '编号列表，防止问题复发的长期改进项。',
    '',
    '## 🛡️ 预防措施',
    '2-5 条建议（监控告警、配额、演练等）。',
    '',
    '## ❓ 需要补充的信息',
    '证据不足需用户补充的日志/指标/配置；没有则写“暂无，当前证据已足够支撑结论”。',
    '',
    '# 注意事项',
    '- 不得编造日志中不存在的证据；引用日志时保持原文。',
    '- 用户症状描述只是线索，必须以日志证据为准；两者矛盾时要指出。',
    '- 日志摘录可能被截断，结论需考虑截断的影响。',
    '- 建议的生产环境操作：先备份、灰度、观察，再全量。',
    '- 全文使用中文，术语（如 Worker、Team、Matrix、MinIO）保留英文原名。',
    '',
    '---',
    '',
    '以下为本次诊断的输入数据：',
    '',
    '## 用户症状描述',
    symptom || '（用户未填写症状描述，请基于日志与环境快照做全面巡检式诊断）',
    '',
    ...(snapshot ? ['## 环境快照（Dashboard 采集）', snapshot, ''] : []),
    '## 采集统计',
    summary,
    '',
    '## 容器状态 Facts',
    ...(containerFacts.length > 0 ? containerFacts : ['- 未采集到容器信息']),
    '',
    '## 容器日志摘录（尾部）',
    ...(containerLogExcerpts.length > 0 ? containerLogExcerpts : ['（无容器日志）']),
    '',
    '## Agent 会话摘录（尾部）',
    ...(sessionExcerpts.length > 0 ? sessionExcerpts : ['（无会话数据）']),
  ].join('\n');
}

export async function POST(request: NextRequest) {
  const denied = await enforceLevelOnlyRbac(request, 'view', 'wen-tian', 'logs');
  if (denied) return denied;
  let rawBody: unknown;
  try { rawBody = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (rawBody === null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const body = rawBody as Record<string, unknown>;
  if (body['range'] !== undefined && typeof body['range'] !== 'string') {
    return Response.json({ error: "'range' must be a string" }, { status: 400 });
  }
  if (body['redact'] !== undefined && typeof body['redact'] !== 'boolean') {
    return Response.json({ error: "'redact' must be a boolean" }, { status: 400 });
  }
  if (body['symptom'] !== undefined && typeof body['symptom'] !== 'string') {
    return Response.json({ error: "'symptom' must be a string" }, { status: 400 });
  }
  if (body['model'] !== undefined && typeof body['model'] !== 'string') {
    return Response.json({ error: "'model' must be a string" }, { status: 400 });
  }
  if (body['snapshot'] !== undefined && typeof body['snapshot'] !== 'string') {
    return Response.json({ error: "'snapshot' must be a string" }, { status: 400 });
  }

  const rangeStr = (body['range'] as string) || '1h';
  let rangeSeconds: number;
  try { rangeSeconds = parseRange(rangeStr); } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Invalid range' }, { status: 400 });
  }
  const redact = (body['redact'] as boolean | undefined) !== false;
  const containerFilter = String(body['container'] ?? '').trim();
  const roomFilter = String(body['room'] ?? '').trim();
  const sinceEpochSec = Date.now() / 1000 - rangeSeconds;
  const matrixToken = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  const homeserver = String(body['homeserver'] ?? request.nextUrl.searchParams.get('homeserver') ?? '');
  const symptom = String(body['symptom'] ?? request.nextUrl.searchParams.get('symptom') ?? '')
    .trim()
    .slice(0, MAX_SYMPTOM_CHARS);
  const modelOverride = String(body['model'] ?? '').trim();
  if (modelOverride && !/^[\w:.\-/]{1,128}$/.test(modelOverride)) {
    return Response.json({ error: "'model' contains invalid characters" }, { status: 400 });
  }
  const snapshot = redactPii(String(body['snapshot'] ?? '').slice(0, MAX_SNAPSHOT_CHARS));
  const controllerUrl = getControllerUrl(request);
  const token = await getAuthToken();
  const ctx: DockerContext = { controllerUrl, token };
  const budget = createBudget();
  const notes: string[] = [];

  const encoder = new TextEncoder();
  const transform = new TransformStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        // Phase 1: list containers
        send('progress', { phase: 'listing', pct: 5, message: '正在扫描容器…' });
        let containers: string[] = [];
        try {
          containers = await listAgentTeamsContainers(ctx);
          if (containerFilter) containers = containers.filter((n) => n.includes(containerFilter));
          containers = containers.slice(0, MAX_CONTAINERS);
          if (containers.length === MAX_CONTAINERS) notes.push(`Container listing truncated to ${MAX_CONTAINERS}`);
        } catch (err) { notes.push(noteFor('Container listing failed', err)); }

        // Phase 2: inspect + logs (keep bounded excerpts for the prompt)
        const containerFacts: string[] = [];
        const containerLogExcerpts: string[] = [];
        let containerLogPromptBytes = 0;
        let containersWithLogs = 0;
        for (const name of containers) {
          if (budgetExhausted(budget)) break;
          try {
            const diag = await inspectContainer(ctx, name);
            containerFacts.push(containerFactLine(name, diag.image, diag.restart_count, diag.state));
          } catch (err) { notes.push(noteFor(`${name}: inspect failed`, err)); }
          if (budgetExhausted(budget)) break;
          try {
            const logs = await getContainerLogs(ctx, name, sinceEpochSec);
            const redacted = redact ? redactPii(logs) : logs;
            budget.totalBytes += redacted.length;
            containersWithLogs += 1;
            if (redacted.trim() && containerLogPromptBytes < MAX_CONTAINER_LOG_PROMPT_BYTES) {
              const tail = tailText(redacted, MAX_CONTAINER_TAIL_BYTES);
              containerLogPromptBytes += tail.length;
              containerLogExcerpts.push(`### ${name}\n\`\`\`\n${tail}\n\`\`\``);
            }
            send('progress', {
              phase: 'collecting',
              pct: 15 + Math.round((containersWithLogs / Math.max(containers.length, 1)) * 40),
              message: `正在收集 ${name} 的日志…`,
            });
          } catch (err) { notes.push(noteFor(`${name}: logs failed`, err)); }
        }

        // Phase 3: sessions
        const sessionExcerpts: string[] = [];
        let sessionPromptBytes = 0;
        let sessionStats = { sessions: 0, events: 0 };
        if (containers.length > 0 && !budgetExhausted(budget)) {
          send('progress', { phase: 'sessions', pct: 60, message: '正在导出 Agent 会话记录…' });
          try {
            const stop = () => budgetExhausted(budget);
            const sessions = await exportAgentSessions(ctx, containers, sinceEpochSec, redact, stop);
            sessionStats = { sessions: sessions.sessions, events: sessions.events };
            notes.push(...sessions.errors);
            for (const [path, content] of Object.entries(sessions.files)) {
              if (sessionExcerpts.length >= MAX_SESSION_FILES_IN_PROMPT) break;
              if (sessionPromptBytes >= MAX_SESSION_PROMPT_BYTES) break;
              const tailLines = content.split('\n').slice(-MAX_SESSION_FILE_TAIL_LINES).join('\n');
              if (!tailLines.trim()) continue;
              const snippet = tailText(tailLines, 8 * 1024);
              sessionPromptBytes += snippet.length;
              sessionExcerpts.push(`### ${path}\n\`\`\`\n${snippet}\n\`\`\``);
            }
            if (Object.keys(sessions.files).length > sessionExcerpts.length) {
              notes.push(`Session excerpts truncated to ${sessionExcerpts.length} files in prompt`);
            }
          } catch (err) { notes.push(noteFor('Session export failed', err)); }
        }

        // Phase 4: Matrix
        let matrixStats = { rooms: 0, messages: 0 };
        if (matrixToken && homeserver) {
          send('progress', { phase: 'matrix', pct: 75, message: '正在导出 Matrix 消息…' });
          try {
            const stop = () => budgetExhausted(budget);
            const matrix = await exportMatrixMessages({
              homeserver, token: matrixToken, sinceEpochSec, redact,
              roomFilter: roomFilter || undefined, messagesOnly: false, stop,
            });
            matrixStats = { rooms: matrix.rooms, messages: matrix.messages };
            if (matrix.error) notes.push(redactPii(matrix.error).slice(0, 500));
          } catch (err) { notes.push(noteFor('Matrix export failed', err)); }
        }

        if (budget.exhausted) notes.push(`Collection stopped early: ${budget.reason}`);

        const summary = [
          'AgentTeams Debug Log',
          `Exported at: ${new Date().toISOString()}`,
          `Range: last ${rangeStr} (since ${new Date(sinceEpochSec * 1000).toISOString()})`,
          `PII redaction: ${redact ? 'on' : 'off'}`,
          '',
          `Matrix messages: ${matrixStats.messages} messages from ${matrixStats.rooms} rooms`,
          `Agent sessions: ${sessionStats.events} events from ${sessionStats.sessions} sessions`,
          `Container diagnostics: ${containersWithLogs} containers`,
          ...(notes.length > 0 ? ['', 'Notes:', ...notes.map((n) => `  - ${n}`)] : []),
          '',
        ].join('\n');

        send('progress', { phase: 'bundling', pct: 90, message: '日志收集完成，正在提交 AI 分析…' });
        send('summary', { summary, fileCount: containerLogExcerpts.length + sessionExcerpts.length, totalBytes: budget.totalBytes });

        // Phase 5: LLM analysis (streaming)
        const cfg = getLlmConfig(modelOverride);
        if (!cfg.apiKey) {
          send('error', { error: 'LLM API key is not configured. Set AGENTTEAMS_LLM_API_KEY.' });
          controller.terminate();
          return;
        }

        const prompt = buildPrompt({ symptom, snapshot, summary, containerFacts, containerLogExcerpts, sessionExcerpts });

        send('progress', { phase: 'analyzing', pct: 95, message: `AI（${cfg.model}）正在分析日志…` });

        const chatUrl = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
        let answer = '';
        try {
          const res = await fetch(chatUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
            body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }], stream: true }),
          });
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            send('error', { error: `LLM returned ${res.status}: ${text}` });
            controller.terminate();
            return;
          }
          const reader = res.body!.getReader();
          try {
            // Buffer before splitting lines: a `data:` JSON payload can be split
            // across network chunks and would otherwise be dropped.
            let sseBuffer = '';
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              sseBuffer += new TextDecoder().decode(value, { stream: true });
              let nl: number;
              while ((nl = sseBuffer.indexOf('\n')) >= 0) {
                const line = sseBuffer.slice(0, nl);
                sseBuffer = sseBuffer.slice(nl + 1);
                const m = /^data: (.*)$/.exec(line);
                if (!m) continue;
                if (m[1].trim() === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(m[1]);
                  const content = parsed.choices?.[0]?.delta?.content;
                  if (content) {
                    answer += content;
                    send('chunk', { content });
                  }
                } catch { /* ignore SSE parse errors */ }
              }
            }
          } finally { reader.releaseLock(); }
        } catch (err) {
          send('error', { error: err instanceof Error ? err.message : 'LLM call failed' });
          controller.terminate();
          return;
        }

        send('progress', { phase: 'done', pct: 100, message: '分析完成' });
        send('result', { answer });
        controller.terminate();
      } catch (err) {
        send('error', { error: err instanceof Error ? err.message : 'Unknown error' });
        controller.terminate();
      }
    },
  });

  return new Response(transform.readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
  });
}
