'use client';

interface ReadMarkerProps {
  label?: string;
}

export function ReadMarker({ label = '未读消息' }: ReadMarkerProps) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-2 select-none"
      role="separator"
      aria-label={label}
    >
      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-primary/40" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-primary/50 whitespace-nowrap">
        {label}
      </span>
      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-primary/40" />
    </div>
  );
}
