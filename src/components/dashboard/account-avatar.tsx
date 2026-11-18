'use client';

import { create } from 'zustand';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { avatarEndpoint, type AvatarKind } from '@/lib/avatars';

const useAvatarRevisions = create<Record<string, number>>(() => ({}));

export function refreshAccountAvatar(kind: AvatarKind, name: string) {
  const key = `${kind}:${name}`;
  useAvatarRevisions.setState(state => ({ [key]: Math.max(Date.now(), (state[key] ?? 0) + 1) }));
}

export function AccountAvatar({ kind, name, label = name, className, fallbackClassName }: {
  kind: AvatarKind;
  name: string;
  label?: string;
  className?: string;
  fallbackClassName?: string;
}) {
  const revision = useAvatarRevisions(state => state[`${kind}:${name}`]);
  return (
    <Avatar className={className} title={label}>
      {name && <AvatarImage src={avatarEndpoint(kind, name, revision)} alt="" className="object-cover" />}
      <AvatarFallback className={fallbackClassName || 'text-xs'}>{label.slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}
