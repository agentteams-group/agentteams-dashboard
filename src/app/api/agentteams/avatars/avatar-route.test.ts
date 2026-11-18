import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { GET, PUT } from './[kind]/[name]/route';

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
