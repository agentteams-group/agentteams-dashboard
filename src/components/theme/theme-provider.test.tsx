'use client';

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from './theme-provider';
import { useThemeStore } from '@/lib/theme/theme-store';
import { clearTheme } from '@/lib/theme/apply';
import type { ThemeDefinition } from '@/lib/theme/types';

function Probe() {
  const { theme, resolvedTheme, setTheme, themes } = useTheme();
  return (
    <div>
      <span data-testid="theme-id">{theme}</span>
      <span data-testid="resolved">{resolvedTheme.id}</span>
      <span data-testid="count">{themes.length}</span>
      <button onClick={() => setTheme('light')}>go light</button>
      <button onClick={() => setTheme('dark')}>go dark</button>
    </div>
  );
}

function notFoundFetch() {
  return vi.fn(async () => new Response(null, { status: 404 }));
}

describe('ThemeProvider + useTheme', () => {
  beforeEach(() => {
    clearTheme();
    useThemeStore.setState({
      themeId: 'system',
      customThemes: [],
      enterpriseThemes: [],
      enterpriseDefaultTheme: null,
      enterpriseLocked: false,
      enterpriseLoaded: false,
    });
    vi.stubGlobal('fetch', notFoundFetch());
  });
  afterEach(() => {
    cleanup();
    clearTheme();
    vi.unstubAllGlobals();
  });

  it('applies the selected built-in theme to the document', async () => {
    useThemeStore.setState({ themeId: 'dark' });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
  });

  it('switches themes at runtime without a reload', async () => {
    useThemeStore.setState({ themeId: 'dark' });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));

    fireEvent.click(screen.getByText('go light'));
    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('applies a custom theme variables inline', async () => {
    const custom: ThemeDefinition = {
      id: 'brand',
      name: 'Brand',
      base: 'light',
      variables: { '--primary': '#ff0000' },
    };
    useThemeStore.setState({ themeId: 'brand', customThemes: [custom] });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#ff0000');
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('brand');
  });

  it('exposes built-in themes and reflects the selection', () => {
    useThemeStore.setState({ themeId: 'dark' });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    expect(screen.getByTestId('theme-id').textContent).toBe('dark');
    expect(Number(screen.getByTestId('count').textContent)).toBeGreaterThanOrEqual(3);
  });

  it('useTheme throws outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Bare() {
      useTheme();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/ThemeProvider/);
    spy.mockRestore();
  });
});
