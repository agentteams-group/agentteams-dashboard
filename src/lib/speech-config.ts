import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { configFilePath } from './backend-config';

export interface SpeechConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

function speechConfigPath(): string {
  return join(dirname(configFilePath()), 'speech.json');
}

export async function readSpeechConfig(): Promise<SpeechConfig> {
  try {
    return JSON.parse(await readFile(speechConfigPath(), 'utf8')) as SpeechConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {
      apiKey: process.env.DASHBOARD_SPEECH_DASHSCOPE_API_KEY?.trim() || '',
      baseUrl: (process.env.DASHBOARD_SPEECH_DASHSCOPE_BASE_URL?.trim() || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, ''),
      model: process.env.DASHBOARD_SPEECH_DASHSCOPE_MODEL?.trim() || 'qwen3-asr-flash',
    };
  }
}

export async function writeSpeechConfig(config: SpeechConfig): Promise<void> {
  const file = speechConfigPath();
  const temp = `${file}.${randomUUID()}.tmp`;
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temp, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}
