import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MarkdownMessage } from './markdown-message';

vi.mock('./mermaid-renderer', () => ({
  MermaidRenderer: () => null,
}));

afterEach(cleanup);

describe('MarkdownMessage', () => {
  it('renders plain text through markdown', () => {
    render(<MarkdownMessage content="hello **world**" />);

    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'hello world')).toBeInTheDocument();
  });

  it('renders a code fence as a highlighted code block', () => {
    const { container } = render(<MarkdownMessage content={'```js\nconst a = 1;\n```'} />);

    expect(container.querySelector('pre code')).not.toBeNull();
  });

  it('streaming + plain text uses the lightweight pre path with a cursor', () => {
    const { container } = render(<MarkdownMessage content="正在生成答案" isStreaming />);

    expect(container.querySelector('pre.whitespace-pre-wrap')).toBeInTheDocument();
    expect(screen.getByText('正在生成答案')).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('streaming + block-level features keeps the full markdown renderer', () => {
    const { container } = render(
      <MarkdownMessage content={'```js\nconst a = 1;\n```'} isStreaming />
    );

    expect(container.querySelector('pre.whitespace-pre-wrap')).not.toBeInTheDocument();
    expect(container.querySelector('pre code')).not.toBeNull();
  });

  it('renders a GFM table', () => {
    const { container } = render(
      <MarkdownMessage content={"| 列1 | 列2 |\n| --- | --- |\n| A | B |"} />
    );

    const table = container.querySelector('table');
    expect(table).toBeInTheDocument();
    expect(screen.getByText('列1')).toBeInTheDocument();
    expect(screen.getByText('列2')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('adds table styling to HTML formatted content', () => {
    const { container } = render(
      <MarkdownMessage
        content="| 列1 | 列2 |\n| --- | --- |\n| A | B |"
        formattedContent="<table><thead><tr><th>列1</th><th>列2</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody></table>"
      />
    );

    // HTML formatted content takes precedence and should have table styling
    const table = container.querySelector('.matrix-message-content table');
    expect(table).toBeInTheDocument();
    expect(table?.className).toContain('border-collapse');
    expect(table?.className).toContain('border');
    
    // Check that the HTML content is rendered (not parsed as markdown)
    const htmlContent = table?.innerHTML || '';
    expect(htmlContent).toContain('列1');
    expect(htmlContent).toContain('列2');
    expect(htmlContent).toContain('A');
    expect(htmlContent).toContain('B');
  });

  it('renders markdown pipes inside formatted_body as a GFM table when no real table element exists', () => {
    const { container } = render(
      <MarkdownMessage
        content={'| 名称 | 值 |\n| --- | --- |\n| CPU | 90% |'}
        formattedContent={'<p>| 名称 | 值 |<br />| --- | --- |<br />| CPU | 90% |</p>'}
      />
    );

    const table = container.querySelector('.matrix-message-content table');
    expect(table).toBeInTheDocument();
    const headers = table?.querySelectorAll('th') ?? [];
    expect(headers[0]?.textContent).toBe('名称');
    expect(headers[1]?.textContent).toBe('值');
    expect(table?.textContent).toContain('CPU');
    expect(table?.textContent).toContain('90%');
  });

  it('keeps the raw HTML path when formatted_body has no markdown table', () => {
    const { container } = render(
      <MarkdownMessage
        content="hello **world**"
        formattedContent="<p>hello <strong>world</strong></p>"
      />
    );

    expect(container.querySelector('.matrix-message-content table')).not.toBeInTheDocument();
    const strong = container.querySelector('.matrix-message-content strong');
    expect(strong?.textContent).toBe('world');
  });

  it('renders manager-style fenced tables from formatted_body as real tables', () => {
    const { container } = render(
      <MarkdownMessage
        content={'```\n| 维度 | 状态 |\n| ----- | --- |\n| 进行中任务 | 0 |\n```'}
        formattedContent={
          '<p>🎯 任务与项目</p>\n<pre><code>| 维度    | 状态 |\n| ----- | --- |\n| 进行中任务 | 0  |\n</code></pre>'
        }
      />
    );

    const table = container.querySelector('.matrix-message-content table');
    expect(table).toBeInTheDocument();
    expect(table?.className).toContain('border-collapse');
    const ths = table?.querySelectorAll('th') ?? [];
    expect(ths[0]?.textContent).toBe('维度');
    expect(ths[1]?.textContent).toBe('状态');
    expect(table?.textContent).toContain('进行中任务');
  });

  it('renders fenced tables from a plain body as GFM tables', () => {
    const { container } = render(
      <MarkdownMessage
        content={'汇报\n\n```\n| Team | 状态 |\n| --- | --- |\n| ceshi | Active |\n```'}
      />
    );

    const table = container.querySelector('.matrix-message-content table');
    expect(table).toBeInTheDocument();
    const ths = table?.querySelectorAll('th') ?? [];
    expect(ths[0]?.textContent).toBe('Team');
    expect(table?.textContent).toContain('ceshi');
    expect(table?.textContent).toContain('Active');
  });

  it('renders an image message as a clickable thumbnail', () => {
    const { container } = render(
      <MarkdownMessage
        content="截图.png"
        msgType="m.image"
        mediaUrl="mxc://example.org/abc123"
        homeserver="https://hs.example.org"
      />
    );

    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img?.getAttribute('src')).toBe(
      'https://hs.example.org/_matrix/media/v3/download/example.org/abc123'
    );
    // The thumbnail is wrapped in a zoom-in trigger button.
    const trigger = img?.closest('button');
    expect(trigger).toBeInTheDocument();
    expect(trigger?.className).toContain('cursor-zoom-in');
    // A forced-download link is offered next to the caption.
    const links = Array.from(container.querySelectorAll('a'));
    expect(links.some((a) => a.href.endsWith('?download=true'))).toBe(true);
  });

  it('opens the full-screen viewer when the thumbnail is clicked', async () => {
    const { container } = render(
      <MarkdownMessage
        content="架构图.png"
        msgType="m.image"
        mediaUrl="mxc://example.org/abc123"
        homeserver="https://hs.example.org"
      />
    );

    const trigger = container.querySelector('img')?.closest('button');
    trigger?.click();

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // The viewer header shows the filename (the only copy once opened).
    expect(screen.getAllByText('架构图.png').length).toBeGreaterThan(0);
  });

  it('renders a video message with a native video element', () => {
    const { container } = render(
      <MarkdownMessage
        content="demo.mp4"
        msgType="m.video"
        mediaUrl="mxc://example.org/vid1"
        homeserver="https://hs.example.org"
      />
    );

    const video = container.querySelector('video');
    expect(video).toBeInTheDocument();
    expect(video?.getAttribute('controls')).not.toBeNull();
    expect(video?.getAttribute('src')).toBe(
      'https://hs.example.org/_matrix/media/v3/download/example.org/vid1'
    );
  });

  it('renders an audio message with a native audio element', () => {
    const { container } = render(
      <MarkdownMessage
        content="voice.ogg"
        msgType="m.audio"
        mediaUrl="mxc://example.org/aud1"
        homeserver="https://hs.example.org"
      />
    );

    const audio = container.querySelector('audio');
    expect(audio).toBeInTheDocument();
    expect(audio?.getAttribute('controls')).not.toBeNull();
  });

  it('renders a file message with a forced download link and size', () => {
    const { container } = render(
      <MarkdownMessage
        content="report.pdf"
        msgType="m.file"
        mediaUrl="mxc://example.org/doc1"
        mediaInfo={{ mimetype: 'application/pdf', size: 2048 }}
        homeserver="https://hs.example.org"
      />
    );

    const link = container.querySelector('a');
    expect(link).toBeInTheDocument();
    expect(link?.href).toBe(
      'https://hs.example.org/_matrix/media/v3/download/example.org/doc1?download=true'
    );
    expect(screen.getByText('(2.0 KB)')).toBeInTheDocument();
  });

  it('linkifies bare mxc:// URIs in plain text bodies', () => {
    render(
      <MarkdownMessage content="产物已上传: mxc://example.org/xyz789 可下载" homeserver="https://hs.example.org" />
    );

    const link = screen.getByRole('link', { name: /mxc:\/\/example\.org\/xyz789/ });
    expect(link.getAttribute('href')).toBe(
      'https://hs.example.org/_matrix/media/v3/download/example.org/xyz789?download=true'
    );
  });
});
