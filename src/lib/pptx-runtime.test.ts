// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { setWasmSource } = vi.hoisted(() => ({ setWasmSource: vi.fn() }));
vi.mock('@extend-ai/react-pptx', () => ({ setWasmSource }));

describe('prefetchPowerPointRuntime', () => {
  beforeEach(() => {
    vi.resetModules();
    setWasmSource.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shares one manifest fetch, WASM fetch and compilation across concurrent callers', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ file: 'parser-abc123.wasm' }) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    vi.stubGlobal('fetch', fetchMock);
    const compiled = {} as WebAssembly.Module;
    const compile = vi.spyOn(WebAssembly, 'compile').mockResolvedValue(compiled);
    const { prefetchPowerPointRuntime } = await import('./pptx-runtime');

    await Promise.all([prefetchPowerPointRuntime(), prefetchPowerPointRuntime()]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(compile).toHaveBeenCalledOnce();
    expect(setWasmSource).toHaveBeenCalledOnce();
    expect(setWasmSource).toHaveBeenCalledWith(compiled);
    compile.mockRestore();
  });

  it('clears a failed cache so a later preview can retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ file: 'parser-retry.wasm' }) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    vi.stubGlobal('fetch', fetchMock);
    const compile = vi.spyOn(WebAssembly, 'compile').mockResolvedValue({} as WebAssembly.Module);
    const { prefetchPowerPointRuntime } = await import('./pptx-runtime');

    await expect(prefetchPowerPointRuntime()).rejects.toThrow('PPT manifest HTTP 503');
    await expect(prefetchPowerPointRuntime()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(setWasmSource).toHaveBeenCalledOnce();
    compile.mockRestore();
  });
});
