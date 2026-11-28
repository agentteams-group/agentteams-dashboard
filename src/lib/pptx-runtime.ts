import { setWasmSource } from '@extend-ai/react-pptx';

const WASM_MANIFEST_URL = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/document-preview/pptx-wasm-manifest.json`;
let runtimePromise: Promise<void> | null = null;

/**
 * Fetch once, compile once, then hand the compiled module to the viewer worker.
 * Reopening a deck reuses this module and performs no second WASM transfer.
 */
export function prefetchPowerPointRuntime(): Promise<void> {
  runtimePromise ??= (async () => {
    // The manifest is stable and cached; the content-addressed parser is immutable.
    const manifestResponse = await fetch(WASM_MANIFEST_URL, { credentials: 'same-origin' });
    if (!manifestResponse.ok) throw new Error(`PPT manifest HTTP ${manifestResponse.status}`);
    const manifest = await manifestResponse.json() as { file: string };
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/document-preview/${manifest.file}`,
      { credentials: 'same-origin' },
    );
    if (!response.ok) throw new Error(`PPT parser HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const compiled = await WebAssembly.compile(bytes);
    setWasmSource(compiled);
  })().catch((error) => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}
