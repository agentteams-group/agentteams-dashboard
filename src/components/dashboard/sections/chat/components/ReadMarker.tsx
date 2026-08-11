'use client';

interface ReadMarkerProps {
  label?: string;
  /** Number of unread messages below the divider (locally computed). */
  unreadCount?: number;
}

export function ReadMarker({ label = '未读消息', unreadCount }: ReadMarkerProps) {
  const displayLabel =
    typeof unreadCount === 'number' && unreadCount > 0 ? `${label} · ${unreadCount} 条` : label;
  return (
    <div
      className="flex items-center gap-2 px-4 py-2 select-none"
      role="separator"
      aria-label={displayLabel}
    >
      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-primary/40" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-primary/50 whitespace-nowrap">
        {displayLabel}
      </span>
      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-primary/40" />
    </div>
  );
}
