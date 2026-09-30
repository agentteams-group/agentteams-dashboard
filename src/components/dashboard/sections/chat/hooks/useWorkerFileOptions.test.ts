import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useWorkerFileOptions } from './useWorkerFileOptions';

describe('useWorkerFileOptions', () => {
  const emptyRuntimeMap = {};

  it('falls back to a plain option for the room default (manager rooms, #87)', () => {
    const { result } = renderHook(() =>
      useWorkerFileOptions({
        team: undefined,
        roomMembers: [],
        runtimeMap: emptyRuntimeMap,
        defaultWorkerName: 'm1',
      })
    );
    expect(result.current.workerOptions).toEqual([
      { userId: 'worker:m1', workerName: 'm1', label: 'm1 · 工作空间' },
    ]);
    expect(result.current.effectiveSelectedWorker).toBe('m1');
    expect(result.current.selectedIsTeamShared).toBe(false);
  });

  it('stays empty for rooms with no members and no default', () => {
    const { result } = renderHook(() =>
      useWorkerFileOptions({
        team: undefined,
        roomMembers: [],
        runtimeMap: emptyRuntimeMap,
      })
    );
    expect(result.current.workerOptions).toEqual([]);
    expect(result.current.effectiveSelectedWorker).toBeNull();
  });

  it('prefers runtimeMap-resolved members over the default fallback', () => {
    const { result } = renderHook(() =>
      useWorkerFileOptions({
        team: undefined,
        roomMembers: [{ userId: '@w1:matrix', displayName: 'w1' } as never],
        runtimeMap: {
          '@w1:matrix': { workerName: 'w1', runtime: 'openclaw' },
        } as never,
        defaultWorkerName: 'm1',
      })
    );
    expect(result.current.workerOptions).toEqual([
      { userId: '@w1:matrix', workerName: 'w1', label: 'w1 · OpenClaw' },
    ]);
    expect(result.current.effectiveSelectedWorker).toBe('m1');
  });
});
