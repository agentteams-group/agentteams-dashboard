'use client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { resetInitialResolutionForTests, useActiveSection } from './use-active-section';
import { STORAGE_KEY } from './nav-items';
import { useSectionStore } from '@/lib/section-store';

function setHash(hash: string) {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, hash },
  });
}

describe('useActiveSection', () => {
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetInitialResolutionForTests();
    useSectionStore.setState({ activeSection: 'overview' });
    localStorage.clear();
    replaceStateSpy = vi.spyOn(window.history, 'replaceState');
  });

  // Unmount hooks between tests: a lingering hook's hash-sync effect
  // re-fires on the next test's beforeEach setState and clobbers the
  // location mock (writes an unprefixed section id), poisoning resolution.
  afterEach(cleanup);

  afterEach(() => {
    replaceStateSpy.mockRestore();
    localStorage.clear();
  });

  describe('initial active section', () => {
    it('defaults to the collaboration space when no hash or localStorage is set', () => {
      setHash('');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('chat');
    });

    it('resolves the layered space hash (PRD §5.3)', () => {
      setHash('#workbench/space');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('chat');
    });

    it('resolves a legacy flat hash and normalizes the URL in place', () => {
      setHash('#workers');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('workers');
      expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '#console/resources/workers');
    });

    it('normalizes #chat to the layered space hash', () => {
      setHash('#chat');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('chat');
      expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '#workbench/space');
    });

    it('keeps layered deep-link hashes untouched in the URL', () => {
      setHash('#workbench/space/!room:example.org');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('chat');
      expect(replaceStateSpy).not.toHaveBeenCalled();
    });

    it('routes the legacy grouped hash through to the fallback default', () => {
      // Unknown grouped hashes were never a supported surface; they fall
      // through to the collaboration-space default.
      setHash('#overview/overview');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('chat');
    });

    it('falls back to localStorage when hash is empty', () => {
      setHash('');
      localStorage.setItem(STORAGE_KEY, 'teams');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('teams');
    });

    it('falls back to chat when hash is invalid', () => {
      setHash('#unknown-section');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('chat');
    });

    it('does not clobber the URL hash with the stale pre-resolution default', () => {
      // Regression: the hash-sync effect used to write the closure-captured
      // initial value ('overview') during the mount effect flush, racing the
      // resolved section and bouncing the user back to overview.
      setHash('#workbench/tasks');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('tasks');
      expect(window.location.hash).toBe('#workbench/tasks');
    });
  });

  describe('remount keeps the live selection', () => {
    it('does not roll the selection back when the hook remounts (chat→tasks revert bug)', () => {
      // Root cause of "click 任务看板 first time does nothing": TasksSection
      // remounts useActiveSection in the same commit as the selection change;
      // the old mount effect re-read the still-stale space hash and clobbered
      // the fresh 'tasks' selection back. The once-guard keeps the live value.
      setHash('#workbench/space');
      const first = renderHook(() => useActiveSection());
      expect(first.result.current.activeSection).toBe('chat');
      act(() => {
        first.result.current.setActiveSection('tasks');
      });
      expect(useSectionStore.getState().activeSection).toBe('tasks');

      // Simulate the same-commit window: the shell's hash-sync effect has
      // yet to observe the change, so the URL hash still says the space hash.
      setHash('#workbench/space');

      const second = renderHook(() => useActiveSection());
      expect(second.result.current.activeSection).toBe('tasks');
      expect(useSectionStore.getState().activeSection).toBe('tasks');
    });
  });

  describe('setActiveSection', () => {
    it('writes the canonical layered hash for workers', () => {
      setHash('');
      const { result } = renderHook(() => useActiveSection());
      act(() => {
        result.current.setActiveSection('workers');
      });
      expect(window.location.hash).toBe('#console/resources/workers');
    });

    it('writes the canonical layered hash for the collaboration space', () => {
      setHash('');
      const { result } = renderHook(() => useActiveSection());
      act(() => {
        result.current.setActiveSection('chat');
      });
      expect(window.location.hash).toBe('#workbench/space');
    });

    it('writes plain section hash for unmapped ids (fallback)', () => {
      setHash('');
      const { result } = renderHook(() => useActiveSection());
      act(() => {
        result.current.setActiveSection('plugin-route:foo/bar');
      });
      expect(window.location.hash).toBe('#plugin-route:foo/bar');
    });

    it('persists active section to localStorage', () => {
      setHash('');
      const { result } = renderHook(() => useActiveSection());
      act(() => {
        result.current.setActiveSection('chat');
      });
      expect(localStorage.getItem(STORAGE_KEY)).toBe('chat');
    });
  });

});
