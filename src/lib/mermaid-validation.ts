import { MERMAID_LIMITS, validateMermaidBounds, type MermaidValidation } from './mermaid-limits';

/** Parse in a disposable Worker with a hard deadline; layout still needs the browser DOM. */
export function validateMermaidInWorker(chart: string, signal?: AbortSignal): Promise<MermaidValidation> {
  const preflight = validateMermaidBounds(chart);
  if (!preflight.ok) return Promise.resolve(preflight);
  if (typeof Worker === 'undefined') return Promise.resolve({ ok: false, reason: '当前环境不支持图表校验 Worker' });

  return new Promise((resolve) => {
    const worker = new Worker(new URL('../components/dashboard/sections/chat/mermaid-validation.worker.ts', import.meta.url), { type: 'module' });
    const finish = (result: MermaidValidation) => {
      clearTimeout(timer);
      worker.terminate();
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = () => finish({ ok: false, reason: '图表渲染已取消' });
    const timer = setTimeout(() => finish({ ok: false, reason: '图表解析超时' }), MERMAID_LIMITS.timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ ok: boolean; reason?: string }>) => {
      finish(event.data.ok ? { ok: true } : { ok: false, reason: event.data.reason ?? '图表语法无效' });
    };
    worker.onerror = () => finish({ ok: false, reason: '图表解析失败' });
    worker.postMessage({ id: 1, chart });
  });
}
