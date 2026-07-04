import { promises as fs } from 'fs';
import path from 'path';
import type { ModelResponse } from '@/lib/hiclaw-api';

const DATA_DIR = process.env.MODEL_REGISTRY_DIR || '/app/db';
const REGISTRY_FILE = path.join(DATA_DIR, 'models.json');

type StoredModel = ModelResponse & { apiKey?: string };

function maskApiKey(key: string): string {
  if (key.length <= 8) return '***';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function toPublicModel(model: StoredModel): ModelResponse {
  const { apiKey: _, ...publicModel } = model;
  return publicModel;
}

async function ensureDataDir(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

async function readRegistry(): Promise<StoredModel[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(REGISTRY_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as { models?: StoredModel[] };
    return Array.isArray(parsed.models) ? parsed.models : [];
  } catch {
    return [];
  }
}

async function writeRegistry(models: StoredModel[]): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(REGISTRY_FILE, JSON.stringify({ models }, null, 2), 'utf-8');
}

export async function listModels(): Promise<ModelResponse[]> {
  const models = await readRegistry();
  return models.map(toPublicModel);
}

export async function getModel(name: string): Promise<ModelResponse | null> {
  const models = await readRegistry();
  const model = models.find((m) => m.name === name);
  return model ? toPublicModel(model) : null;
}

export async function createModel(data: {
  name: string;
  provider: string;
  apiKey: string;
  baseUrl?: string;
  capabilities?: string[];
  default?: boolean;
}): Promise<ModelResponse> {
  const models = await readRegistry();
  if (models.some((m) => m.name === data.name)) {
    throw new Error(`Model ${data.name} already exists`);
  }

  let registry = models;
  if (data.default) {
    registry = registry.map((m) => ({ ...m, default: false }));
  }

  const storedModel: StoredModel = {
    name: data.name,
    provider: data.provider,
    baseUrl: data.baseUrl,
    apiKeyMasked: maskApiKey(data.apiKey),
    capabilities: data.capabilities,
    default: data.default,
    apiKey: data.apiKey,
  };

  // Store the full API key in the same JSON but masked in the public response.
  // In production this should be encrypted or stored in a secrets manager.
  registry.push(storedModel);
  await writeRegistry(registry);

  return toPublicModel(storedModel);
}

export async function updateModel(
  name: string,
  data: {
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
    capabilities?: string[];
    default?: boolean;
  }
): Promise<ModelResponse | null> {
  const models = await readRegistry();
  const idx = models.findIndex((m) => m.name === name);
  if (idx === -1) return null;

  let registry = [...models];
  if (data.default) {
    registry = registry.map((m) => ({ ...m, default: false }));
  }

  const existing = registry[idx];
  const updated: StoredModel = {
    ...existing,
    ...(data.provider !== undefined && { provider: data.provider }),
    ...(data.baseUrl !== undefined && { baseUrl: data.baseUrl }),
    ...(data.capabilities !== undefined && { capabilities: data.capabilities }),
    ...(data.default !== undefined && { default: data.default }),
  };

  if (data.apiKey) {
    updated.apiKey = data.apiKey;
    updated.apiKeyMasked = maskApiKey(data.apiKey);
  }

  registry[idx] = updated;
  await writeRegistry(registry);

  return toPublicModel(updated);
}

export async function deleteModel(name: string): Promise<boolean> {
  const models = await readRegistry();
  const next = models.filter((m) => m.name !== name);
  if (next.length === models.length) return false;
  await writeRegistry(next);
  return true;
}

export async function getDefaultModel(): Promise<ModelResponse | null> {
  const models = await readRegistry();
  const model = models.find((m) => m.default) || models[0] || null;
  return model ? toPublicModel(model) : null;
}

export async function setDefaultModel(name: string): Promise<ModelResponse | null> {
  const models = await readRegistry();
  const idx = models.findIndex((m) => m.name === name);
  if (idx === -1) return null;

  const registry = models.map((m, i) => ({ ...m, default: i === idx }));
  await writeRegistry(registry);

  return toPublicModel(registry[idx]);
}

export async function getModelApiKey(name: string): Promise<string | null> {
  const models = await readRegistry();
  const model = models.find((m) => m.name === name);
  return model?.apiKey || null;
}
