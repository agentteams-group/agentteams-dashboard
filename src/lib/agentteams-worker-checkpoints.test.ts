// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getWorkerCheckpointGraph,
  getWorkerCheckpointStatus,
  CheckpointUnavailableError,
} from './agentteams-worker-checkpoints';
import { ApiError } from './api-error';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockJson(payload: unknown, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), { status }),
  ) as never;
}

describe('getWorkerCheckpointGraph', () => {
  it('returns parsed graph with summary', async () => {
    mockJson({
      nodes: [{ ref: 'refs/auto/a', kind: 'auto', sha: 'abc', timestamp_ms: 1723 }],
      sessions: [],
      summary: { total: 1, auto: 1, snapshots: 0, safety: 0, heads: 1 },
      truncated: false,
    });
    const graph = await getWorkerCheckpointGraph('daily-luo', 100);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.summary.total).toBe(1);
    expect(graph.truncated).toBe(false);
  });

  it('maps 502 "requires QwenPaw 2.1" to CheckpointUnavailableError', async () => {
    mockJson(
      { message: 'checkpoint API unavailable (requires QwenPaw 2.1)' },
      502,
    );
    await expect(getWorkerCheckpointGraph('daily-luo')).rejects.toBeInstanceOf(
      CheckpointUnavailableError,
    );
  });

  it('rethrows other errors with the controller message', async () => {
    mockJson({ message: 'worker not found' }, 404);
    await expect(getWorkerCheckpointStatus('ghost')).rejects.toThrow(
      'worker not found',
    );
  });
});

describe('getWorkerCheckpointStatus', () => {
  it('returns auto flag and presence', async () => {
    mockJson({ auto_enabled: true, has_checkpoints: true, workspace_dir: '/w' });
    const status = await getWorkerCheckpointStatus('daily-luo');
    expect(status.auto_enabled).toBe(true);
    expect(status.has_checkpoints).toBe(true);
  });

  it('maps 502 to CheckpointUnavailableError for status too', async () => {
    mockJson(
      { message: 'checkpoint API unavailable (requires QwenPaw 2.1)' },
      502,
    );
    await expect(getWorkerCheckpointStatus('daily-luo')).rejects.toBeInstanceOf(
      CheckpointUnavailableError,
    );
  });
});

describe('CheckpointUnavailableError contract', () => {
  it('carries an explicit name, status 502 and ApiError lineage', async () => {
    mockJson(
      { message: 'checkpoint API unavailable (requires QwenPaw 2.1)' },
      502,
    );
    const err = await getWorkerCheckpointGraph('daily-luo').catch((e) => e);
    expect(err).toBeInstanceOf(CheckpointUnavailableError);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.name).toBe('CheckpointUnavailableError');
    expect(err.status).toBe(502);
  });

  it('502 without the contractual marker stays a plain ApiError (no placeholder)', async () => {
    mockJson({ message: 'upstream unreachable' }, 502);
    const err = await getWorkerCheckpointGraph('daily-luo').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(CheckpointUnavailableError);
    expect(err.status).toBe(502);
  });
});
