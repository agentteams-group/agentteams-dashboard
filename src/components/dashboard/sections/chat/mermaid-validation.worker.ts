import mermaid from 'mermaid';
import { MERMAID_LIMITS } from '@/lib/mermaid-limits';

interface ValidationRequest { id: number; chart: string }

const workerScope = self as unknown as {
  onmessage: ((_event: MessageEvent<ValidationRequest>) => void) | null;
  postMessage: (_message: unknown) => void;
};

workerScope.onmessage = async (event) => {
  const { id, chart } = event.data;
  try {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    await mermaid.parse(chart);
    workerScope.postMessage({ id, ok: true });
  } catch (error) {
    workerScope.postMessage({
      id,
      ok: false,
      reason: error instanceof Error ? error.message : '图表语法无效',
    });
  }
};

export const MERMAID_WORKER_TIMEOUT_MS = MERMAID_LIMITS.timeoutMs;
