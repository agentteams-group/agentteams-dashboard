import { createHash, randomUUID, randomInt } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { configFilePath } from './backend-config';
import { AVATAR_PRESETS, defaultAvatarPreset, type AvatarKind } from './avatars';

export function readAvatarPreset(preset: string) {
  return readFile(join(process.cwd(), 'public', 'avatars', `${preset}.png`));
}

function avatarPath(kind: AvatarKind, name: string) {
  const key = createHash('sha256').update(`${kind}:${name}`).digest('hex');
  return join(dirname(configFilePath()), 'avatars', `${key}.png`);
}

export async function readAvatar(kind: AvatarKind, name: string) {
  try {
    return await readFile(avatarPath(kind, name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return readAvatarPreset(defaultAvatarPreset(kind, name));
  }
}

export async function writeAvatar(kind: AvatarKind, name: string, image: Buffer) {
  const target = avatarPath(kind, name);
  const temp = `${target}.${randomUUID()}.tmp`;
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temp, image, { mode: 0o600, flag: 'wx' });
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
}

export async function assignRandomAvatar(kind: AvatarKind, name: string) {
  const series = kind === 'agent' ? 'pixelbot' : 'open-peeps';
  const choices = AVATAR_PRESETS.filter(preset => preset.series === series);
  await writeAvatar(kind, name, await readAvatarPreset(choices[randomInt(choices.length)].id));
}

export async function assignAvatarAfterCreate(response: Response, kind: AvatarKind) {
  if (response.status !== 201) return;
  try {
    const { name } = await response.clone().json();
    if (typeof name === 'string' && name) await assignRandomAvatar(kind, name);
  } catch {
    // The resource already exists. Its deterministic fallback still renders.
    console.warn('[avatars] Could not store the default avatar for a new account');
  }
}
