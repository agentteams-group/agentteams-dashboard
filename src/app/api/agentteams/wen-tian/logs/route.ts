// POST /api/agentteams/wen-tian/logs — collect debug logs with SSE progress,
// then run them through the default LLM and stream the diagnosis back.
//
// SSE events:
//   progress  { phase, pct, message }
//   summary   { summary, fileCount, totalBytes }
//   chunk     { content }           (LLM token)
//   result    { answer }
//   error     { error }

import { NextRequest } from 'next/server';
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

interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}
function getLlmConfig(): LlmConfig {
  return {
    baseUrl: process.env.AGENTTEAMS_OPENAI_BASE_URL || process.env.AGENTTEAMS_AI_GATEWAY_URL || 'https://api.openai.com/v1',
    apiKey: process.env.AGENTTEAMS_LLM_API_KEY || '',
    model: process.env.AGENTTEAMS_DEFAULT_MODEL || 'gpt-4',
  };
}

export async function POST(request: NextRequest) {
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
   const symptom = String(request.nextUrl.searchParams.get('symptom') ?? '').trim();
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

        // Phase 2: inspect + logs
        let containersWithLogs = 0;
        for (const name of containers) {
          if (budgetExhausted(budget)) break;
          try {
            await inspectContainer(ctx, name);
          } catch (err) { notes.push(noteFor(`${name}: inspect failed`, err)); }
          if (budgetExhausted(budget)) break;
          try {
            const logs = await getContainerLogs(ctx, name, sinceEpochSec);
            const redacted = redact ? redactPii(logs) : logs;
            if (!budgetExhausted(budget)) {
              budget.totalBytes += redacted.length;
              containersWithLogs += 1;
              send('progress', {
                phase: 'collecting',
                pct: 15 + Math.round((containersWithLogs / Math.max(containers.length, 1)) * 40),
                message: `正在收集 ${name} 的日志…`,
              });
            }
          } catch (err) { notes.push(noteFor(`${name}: logs failed`, err)); }
        }

        // Phase 3: sessions
        let sessionStats = { sessions: 0, events: 0 };
        if (containers.length > 0 && !budgetExhausted(budget)) {
          send('progress', { phase: 'sessions', pct: 60, message: '正在导出 Agent 会话记录…' });
          try {
            const stop = () => budgetExhausted(budget);
            const sessions = await exportAgentSessions(ctx, containers, sinceEpochSec, redact, stop);
            sessionStats = { sessions: sessions.sessions, events: sessions.events };
            notes.push(...sessions.errors);
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
        send('summary', { summary, fileCount: 0, totalBytes: budget.totalBytes });

        // Phase 5: LLM analysis (streaming)
        const cfg = getLlmConfig();
        if (!cfg.apiKey) {
          send('error', { error: 'LLM API key is not configured. Set AGENTTEAMS_LLM_API_KEY.' });
          controller.terminate();
          return;
        }

         const prompt = [
           '你是 AgentTeams 平台的资深故障排查专家。AgentTeams 是一个多智能体协作平台，常见模块包括 Orchestrator/Controller、Agent Worker、任务队列、消息中间件、工具网关、模型 API 网关、状态存储等。',
           '',
           '# 目标',
           '根据用户提供的问题描述、环境信息、日志文件内容，完成故障诊断，输出结构化报告。',
           '',
           '# 输入信息',
           '用户会提供以下内容（可能不完整）：',
           '- 问题描述：现象、影响范围、期望行为 vs 实际行为、已尝试操作',
           '- 发生时间：问题开始时间、持续时间、时区',
           '- 环境信息：部署方式（Docker/K8s/裸机）、版本号、配置摘要、资源配额、网络拓扑',
           '- 日志内容：相关模块的日志文本，可能包含多个文件，请按服务/时间合并分析',
           '- 近期变更：代码发布、配置修改、流量变化、依赖升级等',
           '如果用户只提供日志文件路径，请提醒用户粘贴日志文本，因为助手无法直接读取文件系统。',
           '',
           '# 分析步骤',
           '1. 提炼症状：明确故障现象、影响范围、紧急程度。',
           '2. 日志扫描：识别 ERROR、WARN、Exception、Timeout、Retry、OOM、Panic、Connection refused、Permission denied 等关键事件。',
           '3. 时间线重建：按时间排序，找出第一个异常，标注事件因果关系。',
           '4. 关联上下文：利用 trace_id、request_id、session_id、agent_id 等标识串联不同模块日志。',
           '5. 假设验证：列出可能根因，并用日志证据支持或排除。常见根因包括：',
           '   - 配置错误',
           '   - 资源瓶颈（CPU/内存/磁盘/网络）',
           '   - 依赖服务故障',
           '   - 并发冲突',
           '   - 代码缺陷',
           '   - 上下文溢出',
           '   - 任务死锁',
           '   - 模型返回异常',
           '   - 工具调用失败',
           '   - 消息队列积压',
           '   - 模型 API 限流',
           '   - Agent 间通信超时',
           '6. 给出方案：按紧急程度给出临时规避措施和根本修复建议，含具体命令、配置示例或代码修改方向。',
           '7. 缺失信息：如果证据不足，明确列出需要补充的日志、指标或配置。',
           '',
           '# 输出格式',
           '请严格按以下结构输出：',
           '',
           '## 一、问题摘要',
           '## 二、日志关键事件时间线',
           '| 时间 | 服务/模块 | 级别 | 事件摘要 | 证据 |',
           '## 三、根因分析（按可能性排序，标注证据强度）',
           '## 四、解决方案',
           '### 临时措施',
           '### 根本修复',
           '## 五、预防措施',
           '## 六、需要补充的信息',
           '',
           '# 注意事项',
           '- 不得编造日志中不存在的证据。',
           '- 明确区分"已确认事实"与"推测"。',
           '- 对敏感信息（IP、账号、密钥等）脱敏。',
           '- 生产环境操作建议先备份、灰度、观察。',
           '- 优先关注最近变更、资源使用率和配置漂移等常见诱因。',
           '- 输出语言：中文。',
           '',
           symptom ? `## 用户报告的症状` : '',
           symptom ? symptom : '',
           symptom ? '' : '',
           '',
           '--- DEBUG LOG BUNDLE ---',
           summary,
         ].join('\n');

        send('progress', { phase: 'analyzing', pct: 95, message: 'AI 正在分析日志…' });

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
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              const text = new TextDecoder().decode(value);
              for (const line of text.split('\n')) {
                const m = /^data: (.*)$/.exec(line);
                if (m) {
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
