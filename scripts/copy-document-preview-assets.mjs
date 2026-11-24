import { copyFileSync, cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const target = new URL('../public/document-preview/', import.meta.url);
mkdirSync(target, { recursive: true });
for (const [source, name] of [
  ['pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['@extend-ai/react-pptx/pptx_wasm_bg.wasm', 'pptx_wasm_bg.wasm'],
]) {
  copyFileSync(require.resolve(source), new URL(name, target));
}
const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'));
copyFileSync(join(pdfRoot, 'LICENSE'), new URL('pdfjs-LICENSE', target));
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  cpSync(join(pdfRoot, directory), new URL(directory, target), { recursive: true });
}
const pptxRoot = dirname(require.resolve('@extend-ai/react-pptx/package.json'));
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_LICENSES']) {
  cpSync(join(pptxRoot, name), new URL(`react-pptx-${name}`, target), { recursive: true });
}
