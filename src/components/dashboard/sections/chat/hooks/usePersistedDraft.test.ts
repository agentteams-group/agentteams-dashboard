import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePersistedDraft } from './usePersistedDraft';

const KEY_PREFIX = 'agentteams-chat-draft:';

beforeEach(() => {
  localStorage.clear();
});

describe('usePersistedDraft', () => {
  it('starts empty when no draft is stored', () => {
    const { result } = renderHook(() => usePersistedDraft('room-a'));
    expect(result.current.value).toBe('');
  });

  it('restores the draft saved for the matching room', () => {
    localStorage.setItem(`${KEY_PREFIX}room-a`, 'half-typed message');
    const { result } = renderHook(() => usePersistedDraft('room-a'));
    expect(result.current.value).toBe('half-typed message');
  });

  it('does not persist whitespace-only drafts', () => {
    const { result } = renderHook(() => usePersistedDraft('room-a'));
    act(() => result.current.setValue('   '));
    expect(localStorage.getItem(`${KEY_PREFIX}room-a`)).toBeNull();
  });

  it('switches drafts when roomId changes', () => {
    localStorage.setItem(`${KEY_PREFIX}room-a`, 'alpha draft');
    localStorage.setItem(`${KEY_PREFIX}room-b`, 'beta draft');

    const { result, rerender } = renderHook(({ roomId }) => usePersistedDraft(roomId), {
      initialProps: { roomId: 'room-a' },
    });
    expect(result.current.value).toBe('alpha draft');

    rerender({ roomId: 'room-b' });
    expect(result.current.value).toBe('beta draft');
  });

  it('clear() removes the persisted entry and resets the in-memory value', () => {
    localStorage.setItem(`${KEY_PREFIX}room-a`, 'will be cleared');
    const { result } = renderHook(() => usePersistedDraft('room-a'));
    expect(result.current.value).toBe('will be cleared');

    act(() => result.current.clear());
    expect(result.current.value).toBe('');
    expect(localStorage.getItem(`${KEY_PREFIX}room-a`)).toBeNull();
  });

  it('setValueLocal does not write to storage (edit session reuse)', () => {
    const { result } = renderHook(() => usePersistedDraft('room-a'));
    act(() => result.current.setValueLocal('editing existing message'));
    expect(result.current.value).toBe('editing existing message');
    expect(localStorage.getItem(`${KEY_PREFIX}room-a`)).toBeNull();
  });

  it('survives a broken localStorage without throwing', () => {
    const original = localStorage.getItem;
    localStorage.getItem = () => {
      throw new Error('storage disabled');
    };
    try {
      const { result } = renderHook(() => usePersistedDraft('room-a'));
      expect(result.current.value).toBe('');
      act(() => result.current.setValue('typed'));
      expect(result.current.value).toBe('typed');
    } finally {
      localStorage.getItem = original;
    }
  });
});