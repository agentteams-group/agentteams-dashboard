import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { GET, PUT } from './[kind]/[name]/route';
import { GET as getPresets } from './presets/route';
import { defaultAvatarPreset, type AvatarCatalog, type AvatarKind } from '@/lib/avatars';

vi.mock('../proxy-helper', () => ({
  getControllerUrl: () => 'http://controller',
  proxyToAgentTeams: vi.fn(async () => new Response('{}')),
}));

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'agentteams-avatars-'));
  vi.stubEnv('DASHBOARD_CONFIG_FILE', join(directory, 'config.json'));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

function request(user: string, level: number, body?: string | Uint8Array<ArrayBuffer>, contentType = 'application/json') {
  return new NextRequest('http://dashboard.test/api/agentteams/avatars/human/alice/', {
    method: body ? 'PUT' : 'GET', body,
    headers: { 'Content-Type': contentType, 'x-agentteams-user': user, 'x-agentteams-user-level': String(level) },
  });
}

const human = { params: Promise.resolve({ kind: 'human', name: 'alice' }) };
const agent = { params: Promise.resolve({ kind: 'agent', name: 'worker' }) };

it('assigns a stable preset and allows a member to save another for their own account', async () => {
  const first = await GET(request('alice', 2), human);
  const defaultImage = Buffer.from(await first.arrayBuffer());
  expect(first.headers.get('content-type')).toBe('image/png');
  expect(defaultImage).toEqual(Buffer.from(await (await GET(request('alice', 2), human)).arrayBuffer()));
  const result = await PUT(request('alice', 2, JSON.stringify({ preset: 'shapes-2' })), human);
  expect(result.status).toBe(204);
  const image = await GET(request('alice', 2), human);
  expect(Buffer.from(await image.arrayBuffer())).toEqual(await readFile(join(process.cwd(), 'public/avatars/shapes-2.png')));
});

it('rejects another member, allows the administrator to edit an Agent, and normalizes uploads', async () => {
  const preset = JSON.stringify({ preset: 'pixelbot-2' });
  expect((await PUT(request('bob', 2, preset), human)).status).toBe(403);
  expect((await PUT(request('alice', 2, preset), agent)).status).toBe(403);
  expect((await PUT(request('admin', 3, preset), agent)).status).toBe(204);
  const svgAsPng = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>');
  expect((await PUT(request('alice', 2, svgAsPng, 'image/png'), human)).status).toBe(400);
  const photo = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#3a6' } }).jpeg().toBuffer();
  expect((await PUT(request('alice', 2, new Uint8Array(photo), 'image/jpeg'), human)).status).toBe(204);
  const normalized = await GET(request('alice', 2), human);
  expect(await sharp(Buffer.from(await normalized.arrayBuffer())).metadata()).toMatchObject({ format: 'png', width: 192, height: 192 });
});

it.each(['gif', 'webp'] as const)('keeps animated %s frames and timing when stored as WebP', async format => {
  const frameSize = 32 * 24 * 3;
  const pixels = Buffer.concat([Buffer.alloc(frameSize, 30), Buffer.alloc(frameSize, 220)]);
  const source = sharp(pixels, { raw: { width: 32, height: 48, pageHeight: 24, channels: 3 } });
  const settings = { delay: [120, 240], loop: 3 };
  const data = await (format === 'gif' ? source.gif(settings) : source.webp(settings)).toBuffer();
  const saved = await PUT(request('alice', 2, new Uint8Array(data), `image/${format}`), human);
  expect(saved.status).toBe(204);
  const result = await GET(request('alice', 2), human);
  expect(result.headers.get('content-type')).toBe('image/webp');
  expect(await sharp(Buffer.from(await result.arrayBuffer()), { animated: true }).metadata()).toMatchObject({
    format: 'webp', pages: 2, delay: [120, 240], loop: 3,
  });
});

async function catalog(kind: AvatarKind): Promise<AvatarCatalog> {
  const response = await getPresets(new NextRequest(
    `http://dashboard.test/api/agentteams/avatars/presets/?kind=${kind}`,
    { headers: { 'x-agentteams-user': 'admin', 'x-agentteams-user-level': '3' } },
  ));
  expect(response.status).toBe(200);
  return response.json();
}

it('shows animal presets for Agents and keeps the account catalogs separate', async () => {
  const agentCatalog = await catalog('agent');
  expect(agentCatalog.series.map(({ id }) => id)).toEqual(['animal', 'pixelbot', 'model-girl']);
  expect(agentCatalog.series).toContainEqual({ id: 'model-girl', label: '模型娘' });
  expect(agentCatalog.presets.filter(({ series }) => series === 'animal')).toHaveLength(16);
  const humanCatalog = await catalog('human');
  const humanSeries = humanCatalog.series.map(({ id }) => id);
  expect(humanSeries).not.toContain('animal');
  expect(humanSeries).not.toContain('model-girl');
  expect((await PUT(request('alice', 2, JSON.stringify({ preset: 'model-girl-gpt' })), human)).status).toBe(400);

  const initial = await GET(request('admin', 3), agent);
  const preset = defaultAvatarPreset('agent', 'worker');
  expect(preset).toMatch(/^animal-/);
  expect(Buffer.from(await initial.arrayBuffer())).toEqual(await readFile(join(process.cwd(), 'public/avatars', `${preset}.png`)));
  expect((await PUT(request('alice', 2, JSON.stringify({ preset: 'animal-1' })), human)).status).toBe(400);
  expect((await PUT(request('admin', 3, JSON.stringify({ preset: 'animal-1' })), agent)).status).toBe(204);
});

it('saves and serves each model girl portrait offered to Workers', async () => {
  const { presets } = await catalog('agent');
  const choices = presets.filter(item => item.series === 'model-girl');
  expect(choices.map(item => item.label)).toEqual(['DeepSeek', 'GPT', '千问', 'Claude', 'Kimi', 'GLM', 'Gemini', 'Grok']);
  for (const { id } of choices) {
    const saved = await PUT(request('admin', 3, JSON.stringify({ preset: id })), agent);
    expect(saved.status).toBe(204);
    const avatar = await GET(request('admin', 3), agent);
    expect(avatar.headers.get('content-type')).toBe('image/png');
    const data = Buffer.from(await avatar.arrayBuffer());
    expect(data.equals(await readFile(join(process.cwd(), 'public/avatars', `${id}.png`)))).toBe(true);
    expect(await sharp(data).metadata()).toMatchObject({ format: 'png', width: 256, height: 256 });
  }
});
