'use client';

import { useEffect, useCallback } from 'react';
import { navItems, STORAGE_KEY } from './nav-items';
import { useSectionStore } from '@/lib/section-store';
import { isPluginSectionId } from '@/lib/plugins/types';

/**
 * Active section resolution.
 *
 * Built-in sections come from nav-items; plugin routes use the
 * `plugin-route:<pluginId>/<routeId>` form contributed at runtime. Plugin
 * ids look like hash fragments already, so they survive the URL-hash round
 * trip. Existence of the plugin route itself is verified by the dashboard
 * shell (which falls back to overview when a plugin is absent/disabled).
 */

function isKnownSection(hash: string): boolean {
  if (navItems.some((n) => n.id === hash)) return true;
  return isPluginSectionId(hash);
}

function resolveInitialSection(): string {
  if (typeof window === 'undefined') return 'overview';

  const hash = window.location.hash.slice(1);
  if (hash && !hash.includes('/') && isKnownSection(hash)) return hash;
  // Plugin section ids contain '/'; accept them verbatim.
  if (hash && isPluginSectionId(hash)) return hash;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isKnownSection(stored)) return stored;
  } catch {
    /* localStorage unavailable */
  }

  return 'overview';
}

export function useActiveSection() {
  const activeSection = useSectionStore((s) => s.activeSection);

  // Resolve the initial section once on mount (hash / localStorage / default).
  useEffect(() => {
    useSectionStore.getState().setActiveSection(resolveInitialSection());
  }, []);

  const setActiveSection = useCallback((section: string) => {
    useSectionStore.getState().setActiveSection(section);
  }, []);

  // --- Sync URL hash ---
  useEffect(() => {
    window.location.hash = activeSection;
  }, [activeSection]);

  // --- Listen for external hash changes (browser back/forward) ---
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);

      if (hash && !hash.includes('/') && isKnownSection(hash)) {
        useSectionStore.getState().setActiveSection(hash);
        return;
      }
      if (hash && isPluginSectionId(hash)) {
        useSectionStore.getState().setActiveSection(hash);
        return;
      }

      useSectionStore.getState().setActiveSection('overview');
      window.location.hash = 'overview';
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // --- Persist active section ---
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, activeSection);
    } catch {
      /* localStorage unavailable */
    }
  }, [activeSection]);

  return { activeSection, setActiveSection };
}
