import { apiUrl } from './api-base';

export type AvatarKind = 'human' | 'agent';

export interface AvatarCatalog {
  series: { id: string; label: string }[];
  presets: { id: string; series: string; label: string }[];
}

const ANIMAL_NAMES = [
  '狐狸', '熊猫', '小猫', '兔子', '水豚', '浣熊', '猫头鹰', '柴犬',
  '企鹅', '海獭', '小象', '小鹿', '刺猬', '考拉', '小狮子', '青蛙',
];

export function builtInAvatarCatalog(kind: AvatarKind): AvatarCatalog {
  const series = kind === 'agent'
    ? [{ id: 'animal', label: '卡通动物' }, { id: 'pixelbot', label: '像素机器人' }]
    : [{ id: 'open-peeps', label: '手绘人物' }, { id: 'shapes', label: '几何图形' }];
  return {
    series,
    presets: series.flatMap(({ id, label }) => {
      const names = id === 'animal' ? ANIMAL_NAMES : Array.from({ length: 6 }, (_, i) => `${label} ${i + 1}`);
      return names.map((name, i) => ({ id: `${id}-${i + 1}`, series: id, label: name }));
    }),
  };
}

export function defaultAvatarSeries(kind: AvatarKind) {
  return kind === 'agent' ? 'animal' : 'open-peeps';
}

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function defaultAvatarPreset(kind: AvatarKind, name: string) {
  const series = defaultAvatarSeries(kind);
  const count = kind === 'agent' ? ANIMAL_NAMES.length : 6;
  let hash = 2166136261;
  for (const character of name) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  }
  return `${series}-${(hash >>> 0) % count + 1}`;
}

export function avatarAssetPath(preset: string): string {
  return `${preset.startsWith('local-') ? 'local/' : ''}${preset}.png`;
}

export function avatarAssetUrl(preset: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/avatars/${avatarAssetPath(preset)}`;
}

export function avatarEndpoint(kind: AvatarKind, name: string, revision?: number): string {
  return apiUrl(`/api/agentteams/avatars/${kind}/${encodeURIComponent(name)}${revision ? `?v=${revision}` : ''}`);
}
