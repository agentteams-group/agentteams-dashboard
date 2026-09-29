'use client';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  beforeEach(() => {
    resetInitialResolutionForTests();
    useSectionStore.setState({ activeSection: 'overview' });
    localStorage.clear();
  });

  // Unmount hooks between tests: a lingering hook's hash-sync effect
  // re-fires on the next test's beforeEach setState and clobbers the
  // location mock (writes an unprefixed section id), poisoning resolution.
  afterEach(cleanup);

  afterEach(() => {
    localStorage.clear();
  });

  describe('initial active section', () => {
    it('defaults to chat when no hash or localStorage is set', () => {
      // v1.2.4.9: chat-first — the default surface is the matrix chat sidebar
      // when the user has no hash or stored preference.
      setHash('');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('chat');
    });

    it('falls back to chat for a legacy grouped hash', () => {
      // A legacy flat hash that doesn't match a known section falls through
      // to the chat-first default (the previous behavior was overview).
      setHash('#agents/workers');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('chat');
    });

    it('does not resolve a grouped overview hash and keeps chat default', () => {
      // resolveSection() only accepts flat section ids; the legacy grouped
      // form (#overview/overview) never made it to the supported surface.
      // It is not a known section, so the chat-first default wins.
      setHash('#overview/overview');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('chat');
    });

    it('resolves a flat Worker hash', () => {
      setHash('#workers');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('workers');
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
      setHash('#tasks');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('tasks');
      expect(window.location.hash).toBe('#tasks');
    });
  });

  describe('remount keeps the live selection', () => {
    it('does not roll the selection back when the hook remounts (chat→tasks revert bug)', () => {
      // Root cause of "click 任务看板 first time does nothing": TasksSection
      // remounts useActiveSection in the same commit as the selection change;
      // the old mount effect re-read the still-stale '#chat' hash and clobbered
      // the fresh 'tasks' selection back. The once-guard keeps the live value.
      setHash('#chat');
      const first = renderHook(() => useActiveSection());
      expect(first.result.current.activeSection).toBe('chat');
      act(() => {
        first.result.current.setActiveSection('tasks');
      });
      expect(useSectionStore.getState().activeSection).toBe('tasks');

      // Simulate the same-commit window: the shell's hash-sync effect has
      // yet to observe the change, so the URL hash still says '#chat'.
      setHash('#chat');

      const second = renderHook(() => useActiveSection());
      expect(second.result.current.activeSection).toBe('tasks');
      expect(useSectionStore.getState().activeSection).toBe('tasks');
    });
  });

  describe('setActiveSection', () => {
    it('writes a flat section hash to URL hash', () => {
      setHash('');
      const { result } = renderHook(() => useActiveSection());
      act(() => {
        result.current.setActiveSection('workers');
      });
      expect(window.location.hash).toBe('workers');
    });

    it('writes plain section hash for persistent items (docs)', () => {
      setHash('');
      const { result } = renderHook(() => useActiveSection());
      act(() => {
        result.current.setActiveSection('docs');
      });
      expect(window.location.hash).toBe('docs');
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
