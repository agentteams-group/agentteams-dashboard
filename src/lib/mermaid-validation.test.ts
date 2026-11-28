// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MERMAID_LIMITS, validateMermaidBounds } from './mermaid-limits';
import { validateMermaidInWorker } from './mermaid-validation';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((_event: MessageEvent<{ ok: boolean; reason?: string }>) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: unknown;
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(data: unknown) {
    this.posted = data;
  }

  terminate() {
    this.terminated = true;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});

describe('validateMermaidInWorker', () => {
  it('rejects over-budget charts before creating a Worker', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const result = await validateMermaidInWorker('x'.repeat(MERMAID_LIMITS.characters + 1));
    expect(result.ok).toBe(false);
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('returns the Worker parse result and terminates it', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const pending = validateMermaidInWorker('flowchart TD\nA --> B');
    const worker = FakeWorker.instances[0];
    expect(worker.posted).toEqual({ id: 1, chart: 'flowchart TD\nA --> B' });
    worker.onmessage?.({ data: { ok: true } } as MessageEvent<{ ok: boolean }>);

    await expect(pending).resolves.toEqual({ ok: true });
    expect(worker.terminated).toBe(true);
  });

  it('enforces the parse deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
    const pending = validateMermaidInWorker('flowchart TD\nA --> B');
    await vi.advanceTimersByTimeAsync(MERMAID_LIMITS.timeoutMs);

    await expect(pending).resolves.toEqual({ ok: false, reason: '图表解析超时' });
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it('terminates the Worker when the render is aborted', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const controller = new AbortController();
    const pending = validateMermaidInWorker('flowchart TD\nA --> B', controller.signal);
    controller.abort();

    await expect(pending).resolves.toEqual({ ok: false, reason: '图表渲染已取消' });
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it('keeps the cheap preflight available to standalone callers', () => {
    expect(validateMermaidBounds('flowchart TD\nA --> B')).toEqual({ ok: true });
  });
});
