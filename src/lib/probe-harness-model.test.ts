import { afterEach, expect, it, vi } from 'vitest';
import { probeHarnessModel } from './probe-harness-model';

const id = 'a'.repeat(32);
const queued = () => Response.json({ status: 'pending', queued: true, request_id: id, expires_at: new Date(Date.now() + 20_000).toISOString() }, { status: 202 });
const report = (status = 'ok', reason = 'ok', request_id = id) => Response.json({ version: 1, status, reason, request_id });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('keeps legacy synchronous Controllers working', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, message: 'verified' })));
  await expect(probeHarnessModel('workers', 'alice')).resolves.toEqual({ success: true, message: 'verified' });
});
it('waits for its own Harness result and never accepts an older success', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValueOnce(queued()).mockResolvedValueOnce(report('ok', 'ok', 'b'.repeat(32))).mockResolvedValueOnce(report());
  vi.stubGlobal('fetch', fetcher);
  const progress = vi.fn();
  const result = probeHarnessModel('managers', 'a/b', progress);
  await vi.advanceTimersByTimeAsync(5000);
  await expect(result).resolves.toEqual({ success: true, message: 'Harness 模型验证通过。', reason: 'ok' });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls[1][0]).toBe('/api/agentteams/managers/a%2Fb/health/');
  expect(fetcher.mock.calls[1][1]).toMatchObject({ cache: 'no-store' });
  expect(progress).toHaveBeenCalledWith('正在等待 Harness 回报模型验证结果…');
});
it('reports an acknowledged failure without exposing generated output', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(queued()).mockResolvedValueOnce(report('failed', 'authentication')));
  await expect(probeHarnessModel('workers', 'alice')).resolves.toMatchObject({ success: false, reason: 'authentication', message: '模型认证失败，请检查模型凭据。' });
});
it('does not turn unknown into a successful model check', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(queued()).mockResolvedValueOnce(report('unknown', 'unsupported')));
  await expect(probeHarnessModel('workers', 'alice')).resolves.toMatchObject({ success: false, reason: 'unsupported' });
});
it('expires a request whose Harness never acknowledges it', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(queued()).mockImplementation(() => Promise.resolve(report('unknown', 'missing_report', ''))));
  const result = probeHarnessModel('workers', 'alice');
  await vi.advanceTimersByTimeAsync(20_000);
  await expect(result).resolves.toMatchObject({ success: false, reason: 'timeout' });
});
it('rejects malformed queued requests before polling', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ status: 'pending', queued: true }, { status: 202 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(probeHarnessModel('workers', 'alice')).resolves.toMatchObject({ success: false });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('reports unsupported older routes rather than success', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
  await expect(probeHarnessModel('workers', 'alice')).resolves.toMatchObject({ success: false, message: expect.stringContaining('Controller 暂不支持') });
});
