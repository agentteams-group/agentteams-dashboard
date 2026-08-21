'use client';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useActiveSection } from './use-active-section';
import { STORAGE_KEY } from './nav-items';

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

    it('falls back to overview for a legacy grouped hash', () => {
      setHash('#agents/workers');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('overview');
    });

    it('falls back to overview for a grouped overview hash', () => {
      setHash('#overview/overview');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('overview');
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

    it('falls back to overview when hash is invalid', () => {
      setHash('#unknown-section');
      const { result } = renderHook(() => useActiveSection());
      expect(result.current.activeSection).toBe('overview');
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
