'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface StreamingCardProps {
  payload: Record<string, unknown>;
}

export function StreamingCard({ payload }: StreamingCardProps) {
  const title = typeof payload.title === 'string' ? payload.title : '卡片';
  const content = typeof payload.content === 'string' ? payload.content : JSON.stringify(payload, null, 2);
  const actions = Array.isArray(payload.actions) ? payload.actions as { label: string; url?: string }[] : [];

  return (
    <Card className="my-2 border-l-4 border-l-orange-500">
      <CardHeader className="py-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="py-2">
        <pre className="text-xs whitespace-pre-wrap font-mono">{content}</pre>
        {actions.length > 0 && (
          <div className="flex gap-2 mt-2">
            {actions.map((action, idx) => (
              <a
                key={idx}
                href={action.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-orange-600 hover:underline"
              >
                {action.label}
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
