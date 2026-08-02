import { escapeHtml, sanitizeHtml } from '@/lib/utils';

const AVATAR_COLORS = [
  'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
  'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400',
  'bg-violet-500/20 text-violet-600 dark:text-violet-400',
  'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
  'bg-rose-500/20 text-rose-600 dark:text-rose-400',
  'bg-amber-500/20 text-amber-600 dark:text-amber-400',
  'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  'bg-pink-500/20 text-pink-600 dark:text-pink-400',
];

export function getAvatarColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return '今天';
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

export function isDifferentDay(ts1: number, ts2: number): boolean {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return (
    d1.getFullYear() !== d2.getFullYear() ||
    d1.getMonth() !== d2.getMonth() ||
    d1.getDate() !== d2.getDate()
  );
}

export function renderFormattedContent(formatted: string, fallback: string): { html: string; isHtml: boolean } {
  if (!formatted) {
    return { html: escapeHtml(fallback).replace(/\n/g, '<br />'), isHtml: true };
  }
  return { html: sanitizeHtml(formatted), isHtml: true };
}

export function shortUserId(userId: string): string {
  if (!userId) return userId;
  return userId.startsWith('@') ? userId.split(':')[0].slice(1) : userId;
}

export interface MemberMap {
  [userId: string]: string;
}

const MENTION_PATTERN = /@[\w.-]+(?::[\w.-]+)?/g;

function resolveMention(match: string, memberMap: MemberMap): string | null {
  const direct = memberMap[match];
  if (direct) return direct;
  const shortName = match.slice(1).split(':')[0];
  const byDisplayName = Object.entries(memberMap).find(
    ([, displayName]) => displayName.toLowerCase() === shortName.toLowerCase()
  );
  return byDisplayName ? byDisplayName[1] : null;
}

export function resolveMentionsToDisplayNames(
  text: string,
  memberMap: MemberMap | undefined
): string {
  if (!memberMap || Object.keys(memberMap).length === 0) return text;
  return text.replace(MENTION_PATTERN, (match) => resolveMention(match, memberMap) ?? match);
}

export function resolveMentionsInHtml(
  html: string,
  memberMap: MemberMap | undefined,
  wrap?: (_escapedDisplayName: string) => string
): string {
  if (!memberMap || Object.keys(memberMap).length === 0) return html;
  const render = wrap ?? ((name) => name);
  return html.replace(/<[^>]*>|@[\w.-]+(?::[\w.-]+)?/g, (token) => {
    if (token.startsWith('<')) return token;
    const resolved = resolveMention(token, memberMap);
    if (resolved === null) return token;
    return render(escapeHtml(resolved));
  });
}

export function resolveMentionsInText(text: string, memberMap: MemberMap | undefined): string {
  return resolveMentionsToDisplayNames(text, memberMap);
}
