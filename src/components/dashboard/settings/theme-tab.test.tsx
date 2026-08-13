'use client';

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeTab } from './theme-tab';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { useThemeStore } from '@/lib/theme/theme-store';
import { clearTheme } from '@/lib/theme/apply';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

function renderTab() {
  return render(
    <ThemeProvider>
      <ThemeTab />
    </ThemeProvider>
  );
}

describe('ThemeTab (settings → 外观)', () => {
  beforeEach(() => {
    clearTheme();
    useThemeStore.setState({
      themeId: 'dark',
      customThemes: [],
      enterpriseThemes: [],
      enterpriseDefaultTheme: null,
      enterpriseLocked: false,
      enterpriseLoaded: false,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
  });
  afterEach(() => {
    cleanup();
    clearTheme();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('lists the built-in themes and the system option', () => {
    renderTab();
    expect(screen.getByText('跟随系统')).toBeInTheDocument();
    expect(screen.getByText('亮色')).toBeInTheDocument();
    expect(screen.getByText('暗色')).toBeInTheDocument();
    expect(screen.getByText('高对比度')).toBeInTheDocument();
  });

  it('creates a custom theme and opens the editor', async () => {
    renderTab();
    fireEvent.click(screen.getByText('新建'));
    await waitFor(() => {
      expect(useThemeStore.getState().customThemes).toHaveLength(1);
    });
    // The editor appears for the newly created (active) custom theme.
    expect(screen.getByTestId('theme-editor')).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalled();
  });

  it('exposes at least 8 editable visual parameters in the editor', async () => {
    renderTab();
    fireEvent.click(screen.getByText('新建'));
    await waitFor(() => expect(screen.getByTestId('theme-editor')).toBeInTheDocument());
    // 8 color pickers + radius slider + font-size slider
    const colorInputs = screen.getAllByRole('button', { hidden: false });
    expect(screen.getByLabelText('圆角大小')).toBeInTheDocument();
    expect(screen.getByLabelText('字号')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/主色|背景色|文字色|卡片背景|边框色|危险色|次要文字色/).length).toBeGreaterThanOrEqual(7);
    expect(colorInputs.length).toBeGreaterThan(0);
  });

  it('shows new visual effect controls in the editor', async () => {
    renderTab();
    fireEvent.click(screen.getByText('新建'));
    await waitFor(() => expect(screen.getByTestId('theme-editor')).toBeInTheDocument());
    // New sections should be visible
    expect(screen.getByText('视觉效果')).toBeInTheDocument();
    expect(screen.getByText('表面透明度与毛玻璃')).toBeInTheDocument();
    expect(screen.getByText('布局参数')).toBeInTheDocument();
    // Animation speed selector
    expect(screen.getByText('动画速度')).toBeInTheDocument();
    // Background type buttons
    expect(screen.getByText('纯色')).toBeInTheDocument();
    expect(screen.getByText('渐变')).toBeInTheDocument();
    expect(screen.getByText('网格')).toBeInTheDocument();
    expect(screen.getByText('噪点')).toBeInTheDocument();
    expect(screen.getByText('粒子')).toBeInTheDocument();
    // Transparency controls
    expect(screen.getByLabelText('表面透明度')).toBeInTheDocument();
    expect(screen.getByLabelText('毛玻璃模糊')).toBeInTheDocument();
  });

  it('switching theme updates the document', async () => {
    renderTab();
    fireEvent.click(screen.getByText('亮色'));
    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  it('offers export/import actions for custom themes', async () => {
    renderTab();
    fireEvent.click(screen.getByText('新建'));
    await waitFor(() => expect(screen.getByTestId('theme-editor')).toBeInTheDocument());
    expect(screen.getByText('导入 JSON')).toBeInTheDocument();
    expect(screen.getByText('导出')).toBeInTheDocument();
  });
});
