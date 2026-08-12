'use client';

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginErrorBoundary } from './plugin-error-boundary';

function Boom(): never {
  throw new Error('plugin render exploded');
}

function Ok() {
  return <div>healthy content</div>;
}

describe('PluginErrorBoundary', () => {
  beforeEach(() => {
    // Error boundaries log via console.error; keep test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders children when there is no error', () => {
    render(
      <PluginErrorBoundary pluginId="demo">
        <Ok />
      </PluginErrorBoundary>
    );
    expect(screen.getByText('healthy content')).toBeInTheDocument();
  });

  it('renders a fallback card when the plugin throws, isolating the crash', () => {
    render(
      <PluginErrorBoundary pluginId="demo" pluginName="Demo Plugin">
        <Boom />
      </PluginErrorBoundary>
    );
    expect(screen.getByText(/Demo Plugin/)).toBeInTheDocument();
    expect(screen.getByText(/渲染失败/)).toBeInTheDocument();
    expect(screen.getByText(/plugin render exploded/)).toBeInTheDocument();
  });

  it('tags the fallback with the plugin id for diagnostics', () => {
    const { container } = render(
      <PluginErrorBoundary pluginId="broken-plugin">
        <Boom />
      </PluginErrorBoundary>
    );
    expect(container.querySelector('[data-plugin-error="broken-plugin"]')).not.toBeNull();
  });

  it('supports the inline variant', () => {
    render(
      <PluginErrorBoundary pluginId="demo" pluginName="Demo" variant="inline">
        <Boom />
      </PluginErrorBoundary>
    );
    expect(screen.getByText(/加载失败/)).toBeInTheDocument();
  });
});
