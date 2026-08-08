// Docker Engine API client that talks through the AgentTeams Controller's
// reverse proxy (/docker/v1.41/...). The controller allows all read-only GET
// endpoints plus exec create/start, which is everything the debug-log
// exporter needs — no direct access to the docker socket required.

const DOCKER_API_VERSION = 'v1.41';
const EXEC_TIMEOUT_MS = 30000;
const REQUEST_TIMEOUT_MS = 60000;

export interface DockerContext {
  controllerUrl: string;
  token?: string;
}

async function dockerFetch(
  ctx: DockerContext,
  path: string,
  options: { method?: string; body?: unknown; timeout?: number } = {}
): Promise<Response> {
  const { method = 'GET', body, timeout = REQUEST_TIMEOUT_MS } = options;
  const url = new URL(`/docker/${DOCKER_API_VERSION}${path}`, ctx.controllerUrl).toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const headers: Record<string, string> = {};
    if (ctx.token) headers['Authorization'] = `Bearer ${ctx.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    return await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
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
  const res = await dockerFetch(ctx, `/containers/json?all=1&filters=${filters}`);
  if (!res.ok) {
    throw new Error(`Docker API returned ${res.status} while listing containers`);
  }
  const containers = (await res.json()) as Array<{ Names?: string[] }>;
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
  const res = await dockerFetch(ctx, `/containers/${encodeURIComponent(name)}/json`);
  if (!res.ok) {
    return {
      container: name,
      image: '',
      restart_count: null,
      state: { inspect_error: `Docker API returned ${res.status}` },
    };
  }
  const data = (await res.json()) as {
    State?: unknown;
    Config?: { Image?: string };
    RestartCount?: number;
  };
  return {
    container: name,
    image: data.Config?.Image ?? '',
    restart_count: typeof data.RestartCount === 'number' ? data.RestartCount : null,
    state: data.State ?? null,
  };
}

/** docker logs --timestamps --since <epoch seconds> */
export async function getContainerLogs(
  ctx: DockerContext,
  name: string,
  sinceEpochSec: number
): Promise<string> {
  const res = await dockerFetch(
    ctx,
    `/containers/${encodeURIComponent(name)}/logs?stdout=1&stderr=1&timestamps=1&since=${Math.floor(sinceEpochSec)}`
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Docker logs returned ${res.status}: ${text}`);
  }
  return demuxDockerStream(await res.arrayBuffer());
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
    const text = await createRes.text().catch(() => '');
    throw new Error(`exec create failed (${createRes.status}): ${text}`);
  }
  const { Id } = (await createRes.json()) as { Id?: string };
  if (!Id) {
    throw new Error('exec create returned no Id');
  }

  const startRes = await dockerFetch(ctx, `/exec/${Id}/start`, {
    method: 'POST',
    body: { Detach: false, Tty: false },
    timeout: EXEC_TIMEOUT_MS,
  });
  if (!startRes.ok) {
    const text = await startRes.text().catch(() => '');
    throw new Error(`exec start failed (${startRes.status}): ${text}`);
  }
  return demuxDockerStream(await startRes.arrayBuffer());
}
