'use client';

import dynamic from 'next/dynamic';

/**
 * Keep the Markdown/KaTeX/highlight/Mermaid renderer out of section entry
 * chunks. It is fetched only when a Markdown preview is actually rendered.
 */
export const LazyMarkdownMessage = dynamic(
  () => import('./markdown-message').then((module) => ({ default: module.MarkdownMessage })),
  {
    ssr: false,
    loading: () => (
      <div className="py-2 text-xs text-muted-foreground" role="status">
        正在加载 Markdown 预览…
      </div>
    ),
  },
);
