'use client';

import { useMemo } from 'react';
import { escapeHtml } from '@/lib/utils';

/**
 * Sandboxed HTML preview. The document is injected with srcDoc so the
 * generated markup never runs inside the dashboard origin: the sandbox
 * intentionally omits `allow-same-origin`, which gives the frame an opaque
 * origin and keeps its scripts away from cookies / storage / the parent DOM.
 *
 * `baseHref` lets a single-file artifact resolve relative asset URLs against
 * its own location (the download proxy URL).
 */
export function HtmlPreview({
  html,
  title,
  baseHref,
  className,
}: {
  html: string;
  title: string;
  baseHref?: string;
  className?: string;
}) {
  const document = useMemo(() => {
    if (!baseHref) return html;
    const base = `<base href="${escapeHtml(baseHref)}" target="_blank" />`;
    return /<head(?=[\s>])/i.test(html)
      ? html.replace(/<head(?=[\s>])([^>]*)>/i, `<head$1>${base}`)
      : `${base}${html}`;
  }, [html, baseHref]);

  return (
    <iframe
      sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
      referrerPolicy="no-referrer"
      srcDoc={document}
      title={title}
      className={className ?? 'h-[60vh] min-h-[320px] w-full rounded-md border bg-white'}
    />
  );
}
