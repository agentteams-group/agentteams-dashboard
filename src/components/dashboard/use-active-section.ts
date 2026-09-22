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

/**
 * Legacy section ids merged away from the nav: the standalone projects
 * section was folded into the task board's 项目 view, so old #projects deep
 * links and stored sections keep working by resolving to 'tasks'.
 */
const SECTION_ALIASES: Record<string, string> = {
  projects: 'tasks',
};

function resolveSection(hash: string): string | null {
  if (navItems.some((n) => n.id === hash)) return hash;
  const alias = SECTION_ALIASES[hash];
  if (alias && navItems.some((n) => n.id === alias)) return alias;
  if (isPluginSectionId(hash)) return hash;
  return null;
}

function resolveInitialSection(): string {
  if (typeof window === 'undefined') return 'chat';

  const hash = window.location.hash.slice(1);
  const known = hash ? resolveSection(hash) : null;
  if (known) return known;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isKnownSection(stored)) return stored;
    if (stored && SECTION_ALIASES[stored]) return SECTION_ALIASES[stored];
  } catch {
    /* localStorage unavailable */
  }

  // F-5 / 需求 3.1-3.2: the conversation-first shell opens on chat unless
  // the operator already pinned a section via deep link / localStorage.
  return 'chat';
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
    // Read the live store value instead of the captured `activeSection`:
    // on mount the initial-resolution effect above has already written the
    // resolved section into the store, while this effect's closure still
    // holds the pre-resolution default ('overview'). Writing that stale
    // value would momentarily clobber the URL hash, and the resulting
    // hashchange event races the re-render — when the event wins, the
    // handler reads the stale hash and bounces the user back to overview.
    const section = useSectionStore.getState().activeSection;
    if (window.location.hash.slice(1) !== section) {
      window.location.hash = section;
    }
  }, [activeSection]);

  // --- Listen for external hash changes (browser back/forward) ---
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);

      // Pure echo of our own programmatic write — nothing to sync.
      if (hash === useSectionStore.getState().activeSection) return;

      const known = hash ? resolveSection(hash) : null;
      if (known) {
        useSectionStore.getState().setActiveSection(known);
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
