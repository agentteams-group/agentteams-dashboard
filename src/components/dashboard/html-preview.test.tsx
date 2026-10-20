import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { HtmlPreview } from './html-preview';

describe('HtmlPreview', () => {
  it('runs the document in an opaque-origin sandbox', () => {
    const { container } = render(<HtmlPreview html="<p>hi</p>" title="demo" />);
    const frame = container.querySelector('iframe');

    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frame?.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame?.getAttribute('srcdoc')).toContain('<p>hi</p>');
  });

  it('injects a base href into an existing head', () => {
    const { container } = render(
      <HtmlPreview
        html="<html><head><title>x</title></head><body></body></html>"
        title="demo"
        baseHref="https://example.com/a.html"
      />
    );
    const doc = container.querySelector('iframe')?.getAttribute('srcdoc') ?? '';

    expect(doc.indexOf('<base href="https://example.com/a.html"')).toBeLessThan(
      doc.indexOf('<title>')
    );
  });

  it('escapes the base href and handles documents without a head', () => {
    const { container } = render(
      <HtmlPreview html="<p>hi</p>" title="demo" baseHref={'https://example.com/"><script>'} />
    );
    const doc = container.querySelector('iframe')?.getAttribute('srcdoc') ?? '';

    expect(doc).toContain('&quot;&gt;&lt;script&gt;');
    expect(doc).not.toContain('"><script>');
  });
});
