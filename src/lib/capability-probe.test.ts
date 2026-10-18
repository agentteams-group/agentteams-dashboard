import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useCapabilityStore, capabilityNote } from './capability-probe';

describe('capability-probe（F5.6 能力探测）', () => {
  beforeEach(() => {
    useCapabilityStore.setState({ loopsWrite: false, projectWrite: false, reviewProtocol: false, probedAt: 0 });
  });

  it('loops/status 404 → loopsWrite=false（旧 Controller）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404 }));
    await useCapabilityStore.getState().probeLoops();
    expect(useCapabilityStore.getState().loopsWrite).toBe(false);
    expect(useCapabilityStore.getState().probedAt).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it('loops/status 200 → loopsWrite=true；网络错误安全回退', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));
    await useCapabilityStore.getState().probeLoops();
    expect(useCapabilityStore.getState().loopsWrite).toBe(true);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await useCapabilityStore.getState().probeLoops();
    expect(useCapabilityStore.getState().loopsWrite).toBe(false);
    vi.unstubAllGlobals();
  });

  it('markReviewProtocolSeen 置位（会话级，首次命中 v2 块时调用）', () => {
    useCapabilityStore.getState().markReviewProtocolSeen();
    expect(useCapabilityStore.getState().reviewProtocol).toBe(true);
  });

  it('降级原因文案齐全（§7.4 降级可见）', () => {
    for (const key of ['loopsWrite', 'projectWrite', 'reviewProtocol'] as const) {
      expect(capabilityNote(key).length).toBeGreaterThan(10);
    }
  });
});
