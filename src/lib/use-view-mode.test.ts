import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useViewMode } from '@/lib/use-view-mode';

describe('useViewMode', () => {
  it('defaults to card view', () => {
    const { result } = renderHook(() => useViewMode());
    expect(result.current.viewMode).toBe('card');
  });

  it('honors provided initial value', () => {
    const { result } = renderHook(() => useViewMode('table'));
    expect(result.current.viewMode).toBe('table');
  });

  it('updates viewMode through handleViewModeChange', () => {
    const { result } = renderHook(() => useViewMode('card'));
    act(() => result.current.handleViewModeChange('table'));
    expect(result.current.viewMode).toBe('table');
    act(() => result.current.handleViewModeChange('card'));
    expect(result.current.viewMode).toBe('card');
  });

  it('returns a stable setViewMode setter', () => {
    const { result, rerender } = renderHook(() => useViewMode('card'));
    const setter = result.current.setViewMode;
    rerender();
    expect(result.current.setViewMode).toBe(setter);
  });

  it('persists the preference to localStorage when a storageKey is given', () => {
    window.localStorage.removeItem('test-view-mode');
    const { result } = renderHook(() => useViewMode('card', 'test-view-mode'));
    act(() => result.current.handleViewModeChange('compact'));
    expect(result.current.viewMode).toBe('compact');
    expect(window.localStorage.getItem('test-view-mode')).toBe('compact');
  });

  it('restores a stored preference after mount', async () => {
    window.localStorage.setItem('test-view-mode-restore', 'table');
    const { result } = renderHook(() => useViewMode('card', 'test-view-mode-restore'));
    await act(async () => {});
    expect(result.current.viewMode).toBe('table');
    window.localStorage.removeItem('test-view-mode-restore');
  });

  it('ignores invalid stored values and invalid mode changes', () => {
    window.localStorage.setItem('test-view-mode-invalid', 'grid');
    const { result } = renderHook(() => useViewMode('card', 'test-view-mode-invalid'));
    expect(result.current.viewMode).toBe('card');
    act(() => result.current.handleViewModeChange('grid'));
    expect(result.current.viewMode).toBe('card');
    window.localStorage.removeItem('test-view-mode-invalid');
  });
});
