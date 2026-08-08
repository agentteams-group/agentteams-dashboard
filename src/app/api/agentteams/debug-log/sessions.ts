// Agent session export — TypeScript port of the OpenClaw / Hermes / CoPaw
// session collectors from export-debug-log.py. Session files live inside the
// agent containers, so they are read through docker exec (via the Controller
// proxy). To keep the number of exec round-trips low, each export stage is
// batched into a single sh script whose output is split locally.

import { redactJsonStrings, redactPii } from './redact';
import { dockerExec, DockerContext } from './docker';

const FILE_MARKER = '===DEBUGLOG_FILE===';
const INDEX_MARKER = '===DEBUGLOG_INDEX===';

export interface SessionExportResult {
  containers: number;
  sessions: number;
  events: number;
  files: Record<string, string>;
  errors: string[];
}

function parseTs(ts: unknown): number {
  if (typeof ts !== 'string' || !ts) return 0;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? 0 : ms / 1000;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\-. ]/g, '_').trim().slice(0, 80);
}

/** Split a batched `echo MARKER path; cat path` output into per-file chunks. */
function splitBatchedFiles(raw: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  let current: { path: string; lines: string[] } | null = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith(FILE_MARKER)) {
      if (current) files.push({ path: current.path, content: current.lines.join('\n') });
      current = { path: line.slice(FILE_MARKER.length).trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) files.push({ path: current.path, content: current.lines.join('\n') });
  return files;
}

// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------

type Runtime = 'openclaw' | 'hermes' | 'copaw' | '';

async function detectRuntime(
  ctx: DockerContext,
  container: string
): Promise<{ runtime: Runtime; sessionsDir: string }> {
  // One exec: print the worker name, then probe every candidate session dir
  // (manager layouts first, then worker layouts derived from $AGENTTEAMS_WORKER_NAME).
  const probeScript = [
    'wn="$AGENTTEAMS_WORKER_NAME"',
    'for d in \\',
    '  /root/manager-workspace/.openclaw/agents/main/sessions \\',
    '  /root/manager-workspace/.hermes/sessions \\',
    '  /root/manager-workspace/.copaw/workspaces/default/sessions; do',
    '  [ -d "$d" ] && echo "FOUND $d"',
    'done',
    'if [ -n "$wn" ]; then',
    '  for d in \\',
    '    "/root/agentteams-fs/agents/$wn/.openclaw/agents/main/sessions" \\',
    '    "/root/agentteams-fs/agents/$wn/.hermes/sessions" \\',
    '    "/root/.agentteams-worker/$wn/.copaw/workspaces/default/sessions" \\',
    '    /root/agentteams-fs/.copaw/workspaces/default/sessions; do',
    '    [ -d "$d" ] && echo "FOUND $d"',
    '  done',
    'fi',
  ].join('\n');

  const probe = await dockerExec(ctx, container, probeScript);
  const found = probe
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('FOUND '))
    .map((l) => l.slice('FOUND '.length));

  for (const dir of found) {
    if (dir.includes('/.openclaw/')) return { runtime: 'openclaw', sessionsDir: dir };
    if (dir.includes('/.hermes/')) return { runtime: 'hermes', sessionsDir: dir };
    if (dir.includes('/.copaw/')) return { runtime: 'copaw', sessionsDir: dir };
  }

  // Last resort: scan the filesystem for a known session-dir layout.
  const scan = await dockerExec(
    ctx,
    container,
    "find / -maxdepth 7 \\( -path '*/.openclaw/agents/main/sessions' -o -path '*/.hermes/sessions' -o -path '*/.copaw/workspaces/default/sessions' \\) -type d 2>/dev/null | head -1"
  );
  const dir = scan.trim();
  if (!dir) return { runtime: '', sessionsDir: '' };
  if (dir.includes('/.openclaw/')) return { runtime: 'openclaw', sessionsDir: dir };
  if (dir.includes('/.hermes/')) return { runtime: 'hermes', sessionsDir: dir };
  return { runtime: 'copaw', sessionsDir: dir };
}

// ---------------------------------------------------------------------------
// OpenClaw sessions
// ---------------------------------------------------------------------------

async function exportOpenClawSessions(
  ctx: DockerContext,
  container: string,
  sessionsDir: string,
  sinceEpochSec: number,
  redact: boolean,
  out: SessionExportResult,
  prefix: string
): Promise<void> {
  const script = [
    `for f in '${sessionsDir}'/*.jsonl; do`,
    `  [ -f "$f" ] || continue`,
    `  echo "${FILE_MARKER} $f"`,
    `  cat "$f"`,
    'done',
    `echo "${INDEX_MARKER}"`,
    `cat '${sessionsDir}/sessions.json' 2>/dev/null || true`,
  ].join('\n');

  const raw = await dockerExec(ctx, container, script);
  const [filesPart, indexPart] = raw.split(INDEX_MARKER);
  const files = splitBatchedFiles(filesPart);

  for (const file of files) {
    const filename = file.path.split('/').pop() ?? '';
    if (!filename.endsWith('.jsonl')) continue;

    const events: string[] = [];
    for (const line of file.content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      const eventTs = parseTs(event.timestamp);
      if (event.type !== 'session' && eventTs < sinceEpochSec && eventTs > 0) continue;
      events.push(JSON.stringify(redact ? redactJsonStrings(event) : event));
    }

    // header only (or empty) → nothing useful in range
    if (events.length <= 1) continue;

    out.files[`${prefix}/${sanitizeFilename(filename)}`] = events.join('\n') + '\n';
    out.sessions += 1;
    out.events += events.length - 1;
  }

  const indexRaw = (indexPart ?? '').trim();
  if (indexRaw) {
    try {
      const index = JSON.parse(indexRaw);
      out.files[`${prefix}/sessions.json`] =
        JSON.stringify(redact ? redactJsonStrings(index) : index, null, 2) + '\n';
    } catch {
      // Ignore a malformed sessions.json index.
    }
  }
}

// ---------------------------------------------------------------------------
// CoPaw sessions
// ---------------------------------------------------------------------------

async function exportCopawSessions(
  ctx: DockerContext,
  container: string,
  sessionsDir: string,
  sinceEpochSec: number,
  redact: boolean,
  out: SessionExportResult,
  prefix: string
): Promise<void> {
  const script = [
    `find '${sessionsDir}' -name '*.json' -type f 2>/dev/null | while read f; do`,
    `  echo "${FILE_MARKER} $f"`,
    `  cat "$f"`,
    'done',
  ].join('\n');

  const raw = await dockerExec(ctx, container, script);
  const files = splitBatchedFiles(raw);

  for (const file of files) {
    let data: {
      agent?: {
        name?: string;
        memory?: { content?: unknown; _compressed_summary?: string };
      };
    };
    try {
      data = JSON.parse(file.content);
    } catch {
      continue;
    }
    const agent = data.agent ?? {};
    const memory = agent.memory ?? {};
    const content = memory.content;
    if (!Array.isArray(content) || content.length === 0) continue;

    const basename = (file.path.split('/').pop() ?? '').replace(/\.json$/, '');
    let header: Record<string, unknown> = {
      type: 'session',
      runtime: 'copaw',
      agent_name: agent.name ?? '',
      session_key: basename,
      compressed_summary: memory._compressed_summary ?? '',
    };

    const messagesInRange: Array<Record<string, unknown>> = [];
    for (let turnIdx = 0; turnIdx < content.length; turnIdx++) {
      const turn = content[turnIdx];
      if (!Array.isArray(turn)) continue;
      for (const msg of turn) {
        if (msg === null || typeof msg !== 'object') continue;
        const m = msg as Record<string, unknown>;
        const msgTs = parseTs(m.timestamp);
        if (msgTs >= sinceEpochSec || msgTs === 0) {
          const event: Record<string, unknown> = {
            type: 'message',
            turn: turnIdx,
            id: m.id ?? '',
            role: m.role ?? '',
            name: m.name ?? '',
            timestamp: m.timestamp ?? '',
            content: m.content ?? [],
          };
          if (m.metadata) event.metadata = m.metadata;
          messagesInRange.push(event);
        }
      }
    }
    if (messagesInRange.length === 0) continue;

    if (redact) header = redactJsonStrings(header);
    const lines = [JSON.stringify(header)];
    for (const event of messagesInRange) {
      lines.push(JSON.stringify(redact ? redactJsonStrings(event) : event));
    }

    out.files[`${prefix}/${sanitizeFilename(basename)}.jsonl`] = lines.join('\n') + '\n';
    out.sessions += 1;
    out.events += messagesInRange.length;
  }
}

// ---------------------------------------------------------------------------
// Hermes sessions
// ---------------------------------------------------------------------------

async function exportHermesSessions(
  ctx: DockerContext,
  container: string,
  sessionsDir: string,
  sinceEpochSec: number,
  redact: boolean,
  out: SessionExportResult,
  prefix: string
): Promise<void> {
  const script = [
    `for f in '${sessionsDir}'/*.jsonl; do`,
    `  [ -f "$f" ] || continue`,
    `  echo "${FILE_MARKER} $f"`,
    `  cat "$f"`,
    'done',
  ].join('\n');

  const raw = await dockerExec(ctx, container, script);
  const files = splitBatchedFiles(raw);

  for (const file of files) {
    const filename = file.path.split('/').pop() ?? '';
    if (!filename.endsWith('.jsonl')) continue;

    const lines: string[] = [];
    let lastTs = 0;
    for (const line of file.content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      const eventTs = parseTs(event.timestamp);
      if (eventTs) lastTs = Math.max(lastTs, eventTs);
      if (event.role !== 'session_meta' && eventTs < sinceEpochSec && eventTs > 0) continue;
      lines.push(JSON.stringify(redact ? redactJsonStrings(event) : event));
    }

    if (lines.length === 0) continue;
    // The whole session is older than the requested range.
    if (lastTs < sinceEpochSec && lastTs > 0) continue;

    out.files[`${prefix}/${sanitizeFilename(filename)}`] = lines.join('\n') + '\n';
    out.sessions += 1;
    const firstIsMeta = lines[0].includes('"role": "session_meta"') || lines[0].includes('"role":"session_meta"');
    out.events += firstIsMeta ? lines.length - 1 : lines.length;
  }

  // Hermes keeps a sqlite session index plus plain-text logs next to sessions/.
  const hermesHome = sessionsDir.replace(/\/sessions\/?$/, '');
  const auxScript = [
    `if command -v python3 >/dev/null 2>&1 && [ -f '${hermesHome}/state.db' ]; then`,
    `  python3 -c "import json,sqlite3;conn=sqlite3.connect('${hermesHome}/state.db');conn.row_factory=sqlite3.Row;rows=conn.execute('SELECT * FROM sessions ORDER BY started_at DESC LIMIT 200').fetchall();print(json.dumps([dict(r) for r in rows],ensure_ascii=False))" 2>/dev/null || true`,
    'fi',
    `echo "${INDEX_MARKER}"`,
    `for n in agent.log errors.log gateway.log; do`,
    `  if [ -f '${hermesHome}/logs/'"$n" ]; then`,
    `    echo "${FILE_MARKER} $n"`,
    `    cat '${hermesHome}/logs/'"$n"`,
    '  fi',
    'done',
  ].join('\n');

  const aux = await dockerExec(ctx, container, auxScript);
  const [dbPart, logsPart] = aux.split(INDEX_MARKER);

  const dbRaw = (dbPart ?? '').trim();
  if (dbRaw) {
    try {
      const data = JSON.parse(dbRaw);
      out.files[`${prefix}/sessions-db.json`] =
        JSON.stringify(redact ? redactJsonStrings(data) : data, null, 2) + '\n';
    } catch {
      // Ignore malformed sqlite dump output.
    }
  }

  for (const log of splitBatchedFiles(logsPart ?? '')) {
    if (!log.content.trim()) continue;
    out.files[`${prefix}/${sanitizeFilename(log.path)}`] = redact
      ? redactPii(log.content)
      : log.content;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function exportAgentSessions(
  ctx: DockerContext,
  containers: string[],
  sinceEpochSec: number,
  redact: boolean
): Promise<SessionExportResult> {
  const out: SessionExportResult = {
    containers: 0,
    sessions: 0,
    events: 0,
    files: {},
    errors: [],
  };

  for (const container of containers) {
    const prefix = `agent-sessions/${sanitizeFilename(container)}`;
    try {
      const { runtime, sessionsDir } = await detectRuntime(ctx, container);
      if (!runtime) continue;

      const before = out.sessions;
      if (runtime === 'openclaw') {
        await exportOpenClawSessions(ctx, container, sessionsDir, sinceEpochSec, redact, out, prefix);
      } else if (runtime === 'hermes') {
        await exportHermesSessions(ctx, container, sessionsDir, sinceEpochSec, redact, out, prefix);
      } else {
        await exportCopawSessions(ctx, container, sessionsDir, sinceEpochSec, redact, out, prefix);
      }
      if (out.sessions > before) out.containers += 1;
    } catch (err) {
      out.errors.push(
        `${container}: ${err instanceof Error ? err.message : 'session export failed'}`
      );
    }
  }

  return out;
}
