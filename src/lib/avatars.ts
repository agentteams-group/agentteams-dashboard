import { apiUrl } from './api-base';

export type AvatarKind = 'human' | 'agent';

export const AVATAR_SERIES = [
  { id: 'pixelbot', label: '像素机器人' },
  { id: 'open-peeps', label: '手绘人物' },
  { id: 'shapes', label: '几何图形' },
] as const;

export const AVATAR_PRESETS = AVATAR_SERIES.flatMap(({ id, label }) =>
  [1, 2, 3, 4, 5, 6].map(number => ({ id: `${id}-${number}`, series: id, label: `${label} ${number}` })),
);
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function defaultAvatarPreset(kind: AvatarKind, name: string) {
  const series = kind === 'agent' ? 'pixelbot' : 'open-peeps';
  let hash = 2166136261;
  for (const character of name) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  }
  return `${series}-${(hash >>> 0) % 6 + 1}`;
}

export function avatarAssetUrl(preset: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/avatars/${preset}.png`;
}

export function avatarEndpoint(kind: AvatarKind, name: string, revision?: number): string {
  return apiUrl(`/api/agentteams/avatars/${kind}/${encodeURIComponent(name)}${revision ? `?v=${revision}` : ''}`);
}
