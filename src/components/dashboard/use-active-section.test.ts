'use client';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useActiveSection } from './use-active-section';
import { STORAGE_KEY, EXPANDED_GROUPS_KEY } from './nav-items';

function setHash(hash: string) {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, hash },
  });
}

describe('useActiveSection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('initial active section', () => {
    it('defaults to overview when no hash or localStorage is set', () => {
      setHash('');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('overview');
    });

    it('resolves section from new format hash (#agents/workers)', () => {
      setHash('#agents/workers');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('workers');
    });

    it('resolves section from new format hash (#overview/overview)', () => {
      setHash('#overview/overview');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('overview');
    });

    it('maps legacy #workers to #agents/workers and activates workers', () => {
      setHash('#workers');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('workers');
      // jsdom strips the leading # from location.hash
      expect(window.location.hash).toBe('agents/workers');
    });

    it('falls back to localStorage when hash is empty', () => {
      setHash('');
      localStorage.setItem(STORAGE_KEY, 'teams');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('teams');
    });

    it('falls back to overview when hash is invalid', () => {
      setHash('#unknown-section');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('overview');
    });
  });

  describe('setActiveSection', () => {
    it('writes #group/section format to URL hash', () => {
      setHash('');
      const { result } = renderHook(() => useActiveSection());
      act(() => {
        result.current.setActiveSection('workers');
      });
      expect(window.location.hash).toBe('agents/workers');
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

  describe('expanded groups', () => {
    it('auto-expands the group containing the active section on init', () => {
      setHash('#agents/teams');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.expandedGroups.has('agents')).toBe(true);
    });

    it('auto-expands the group on setActiveSection', () => {
      setHash('');
      const { result } = renderHook(() => useActiveSection());
      act(() => {
        result.current.setActiveSection('policies');
      });
      expect(result.current.expandedGroups.has('governance')).toBe(true);
    });

    it('persists expanded groups to localStorage', () => {
      setHash('#agents/workers');
      renderHook(() => useActiveSection());
      const stored = localStorage.getItem(EXPANDED_GROUPS_KEY);
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed).toContain('agents');
    });

    it('restores expanded groups from localStorage', () => {
      setHash('');
      localStorage.setItem(EXPANDED_GROUPS_KEY, JSON.stringify(['agents', 'platform']));
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.expandedGroups.has('agents')).toBe(true);
      expect(result.current.expandedGroups.has('platform')).toBe(true);
    });

    it('always includes active section group even if localStorage had something else', () => {
      localStorage.setItem(EXPANDED_GROUPS_KEY, JSON.stringify(['platform']));
      setHash('#agents/chat');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.expandedGroups.has('agents')).toBe(true);
      expect(result.current.expandedGroups.has('platform')).toBe(true);
    });
  });
});
