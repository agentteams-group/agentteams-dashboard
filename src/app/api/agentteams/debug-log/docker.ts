// Docker Engine API client that talks through the AgentTeams Controller's
// reverse proxy (/docker/v1.41/...). The controller allows all read-only GET
// endpoints plus exec create/start, which is everything the debug-log
// exporter needs — no direct access to the docker socket required.

const DOCKER_API_VERSION = 'v1.41';
const EXEC_TIMEOUT_MS = 30000;
const REQUEST_TIMEOUT_MS = 60000;
// Cap a single Docker response so a stuck or oversized stream cannot exhaust
// memory; the route enforces a separate aggregate budget across all files.
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export interface DockerContext {
  controllerUrl: string;
  token?: string;
}

interface DockerFetchResult {
  ok: boolean;
  status: number;
  data: ArrayBuffer;
}

/** Read a response body up to a byte limit. The read shares the same
 *  AbortSignal deadline as the fetch, so a stalled body is aborted too. */
async function readBodyWithLimit(
  res: Response,
  limitBytes: number
): Promise<ArrayBuffer> {
  if (!res.body) return new ArrayBuffer(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > limitBytes) {
          throw new Error(`Response body exceeds size limit of ${limitBytes} bytes`);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (chunks.length === 0) return new ArrayBuffer(0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

function decodeBody(data: ArrayBuffer): string {
  return new TextDecoder('utf-8').decode(data);
}

function truncateText(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function dockerFetch(
  ctx: DockerContext,
  path: string,
  options: { method?: string; body?: unknown; timeout?: number } = {}
): Promise<DockerFetchResult> {
  const { method = 'GET', body, timeout = REQUEST_TIMEOUT_MS } = options;
  const url = new URL(`/docker/${DOCKER_API_VERSION}${path}`, ctx.controllerUrl).toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const headers: Record<string, string> = {};
    if (ctx.token) headers['Authorization'] = `Bearer ${ctx.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await readBodyWithLimit(res, MAX_RESPONSE_BYTES);
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/** Demultiplex a Docker raw stream (8-byte frame headers, Tty=false). */
export function demuxDockerStream(buffer: ArrayBuffer): string {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder('utf-8');
  const parts: string[] = [];
  let offset = 0;

  while (offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset + 4, false); // big-endian
    if (offset + 8 + length > view.byteLength) break;
    parts.push(decoder.decode(bytes.subarray(offset + 8, offset + 8 + length)));
    offset += 8 + length;
  }
  // Tty streams (or an empty attachment) have no multiplex headers.
  if (parts.length === 0 && buffer.byteLength > 0) {
    return decoder.decode(bytes);
  }
  return parts.join('');
}

/** List agentteams-* container names (running and stopped). */
export async function listAgentTeamsContainers(ctx: DockerContext): Promise<string[]> {
  const filters = encodeURIComponent(JSON.stringify({ name: ['agentteams-'] }));
  const { ok, status, data } = await dockerFetch(
    ctx,
    `/containers/json?all=1&filters=${filters}`
  );
  if (!ok) {
    throw new Error(`Docker API returned ${status} while listing containers`);
  }
  const containers = JSON.parse(decodeBody(data)) as Array<{ Names?: string[] }>;
  const names = containers
    .flatMap((c) => c.Names ?? [])
    .map((n) => n.replace(/^\//, ''))
    .filter(Boolean);
  return [...new Set(names)].sort();
}

export interface ContainerDiagnostic {
  container: string;
  image: string;
  restart_count: number | null;
  state: unknown;
}

/** docker inspect → { state, image, restartCount } */
export async function inspectContainer(
  ctx: DockerContext,
  name: string
): Promise<ContainerDiagnostic> {
  const { ok, status, data } = await dockerFetch(
    ctx,
    `/containers/${encodeURIComponent(name)}/json`
  );
  if (!ok) {
    return {
      container: name,
      image: '',
      restart_count: null,
      state: { inspect_error: `Docker API returned ${status}` },
    };
  }
  const parsed = JSON.parse(decodeBody(data)) as {
    State?: unknown;
    Config?: { Image?: string };
    RestartCount?: number;
  };
  return {
    container: name,
    image: parsed.Config?.Image ?? '',
    restart_count: typeof parsed.RestartCount === 'number' ? parsed.RestartCount : null,
    state: parsed.State ?? null,
  };
}

/** docker logs --timestamps --since <epoch seconds> */
export async function getContainerLogs(
  ctx: DockerContext,
  name: string,
  sinceEpochSec: number
): Promise<string> {
  const { ok, status, data } = await dockerFetch(
    ctx,
    `/containers/${encodeURIComponent(name)}/logs?stdout=1&stderr=1&timestamps=1&since=${Math.floor(sinceEpochSec)}`
  );
  if (!ok) {
    throw new Error(`Docker logs returned ${status}: ${truncateText(decodeBody(data))}`);
  }
  return demuxDockerStream(data);
}

/** docker exec sh -c <cmd> → combined stdout (mirrors the Python docker_exec helper). */
export async function dockerExec(
  ctx: DockerContext,
  container: string,
  cmd: string
): Promise<string> {
  const createRes = await dockerFetch(
    ctx,
    `/containers/${encodeURIComponent(container)}/exec`,
    {
      method: 'POST',
      body: {
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
        Cmd: ['sh', '-c', cmd],
      },
      timeout: EXEC_TIMEOUT_MS,
    }
  );
  if (!createRes.ok) {
    throw new Error(
      `exec create failed (${createRes.status}): ${truncateText(decodeBody(createRes.data))}`
    );
  }
  const created = JSON.parse(decodeBody(createRes.data)) as { Id?: string };
  if (!created.Id) {
    throw new Error('exec create returned no Id');
  }

  const startRes = await dockerFetch(ctx, `/exec/${created.Id}/start`, {
    method: 'POST',
    body: { Detach: false, Tty: false },
    timeout: EXEC_TIMEOUT_MS,
  });
  if (!startRes.ok) {
    throw new Error(
      `exec start failed (${startRes.status}): ${truncateText(decodeBody(startRes.data))}`
    );
  }
  return demuxDockerStream(startRes.data);
}
