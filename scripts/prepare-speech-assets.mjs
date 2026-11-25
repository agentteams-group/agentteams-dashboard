// Bundle a pinned multilingual Whisper model and WASM runtime for same-origin use.
import { mkdir, stat, rename, copyFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const revision = 'ff41770';
const model = 'onnx-community/whisper-tiny';
const root = join(process.cwd(), 'public', 'speech', revision);
const files = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
// A mirror must expose the same pinned model files under this base URL.
const source = process.env.SPEECH_MODEL_DOWNLOAD_BASE_URL || `https://huggingface.co/${model}/resolve/${revision}`;

await Promise.all(files.map(async file => {
  const target = join(root, 'models', model, file);
  if (await stat(target).then(info => info.size > 0).catch(() => false)) return;
  await mkdir(dirname(target), { recursive: true });
  process.stdout.write(`Preparing speech model: ${file}\n`);
  const response = await fetch(`${source.replace(/\/$/, '')}/${file}`, { signal: AbortSignal.timeout(180000) });
  if (!response.ok || !response.body) throw new Error(`Speech asset ${file}: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(`${target}.tmp`));
  await rename(`${target}.tmp`, target);
}));

const runtimeDir = dirname(require.resolve('onnxruntime-web'));
await mkdir(join(root, 'wasm'), { recursive: true });
for (const file of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
  await copyFile(join(runtimeDir, file), join(root, 'wasm', file));
}
await copyFile(new URL('./whisper-LICENSE', import.meta.url), join(root, 'models', model, 'LICENSE'));
await copyFile(new URL('./onnxruntime-LICENSE', import.meta.url), join(root, 'wasm', 'LICENSE'));
process.stdout.write('Speech assets ready (loaded by the browser only when recording).\n');
