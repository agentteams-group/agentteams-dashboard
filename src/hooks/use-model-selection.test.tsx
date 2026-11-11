import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useModelSelection } from './use-model-selection';

const state = vi.hoisted(() => ({
  modelsError: null as Error | null,
  routesError: null as Error | null,
}));

vi.mock('@/hooks/use-agentteams-models', () => ({
  useModels: () => ({ data: undefined, isLoading: false, error: state.modelsError }),
  useAiRoutes: () => ({ data: undefined, isLoading: false, error: state.routesError }),
  useSglangModels: () => ({ data: undefined, isLoading: false, error: null }),
}));

describe('useModelSelection sessionIssue', () => {
  it('turns a missing Console session into an actionable admin-login hint', () => {
    state.modelsError = new Error('A valid Higress Console session is required');
    state.routesError = null;

    const { result } = renderHook(() => useModelSelection());

    expect(result.current.sessionIssue).toContain('需要管理员 Console 登录');
    expect(result.current.options.length).toBeGreaterThan(0);
  });

  it('maps the Controller/Console "Login required" sentence the same way', () => {
    state.modelsError = new Error('Login required');
    state.routesError = null;

    const { result } = renderHook(() => useModelSelection());

    expect(result.current.sessionIssue).toContain('需要管理员 Console 登录');
  });

  it('keeps unrelated failures verbatim instead of blaming the session', () => {
    state.modelsError = null;
    state.routesError = new Error('后端地址全部不可达 (all 2 backend address(es) unreachable)');

    const { result } = renderHook(() => useModelSelection());

    expect(result.current.sessionIssue).toBe('后端地址全部不可达 (all 2 backend address(es) unreachable)');
  });

  it('reports no issue while the catalog loads normally', () => {
    state.modelsError = null;
    state.routesError = null;

    const { result } = renderHook(() => useModelSelection());

    expect(result.current.sessionIssue).toBeNull();
  });
});
