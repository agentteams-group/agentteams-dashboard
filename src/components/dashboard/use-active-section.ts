'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  navItems,
  STORAGE_KEY,
  EXPANDED_GROUPS_KEY,
  getNewHashFromOld,
} from './nav-items';

/**
 * Parse a URL hash into its hierarchical parts.
 *
 * New format:  "#agents/workers"   => { group: "agents", section: "workers" }
 * Old format:  "#workers"          => { group: undefined,  section: "workers"  }
 * Empty:       ""                  => { group: undefined,  section: ""         }
 */
function parseHash(hash: string): { group?: string; section: string } {
  if (!hash) return { section: '' };
  const slashIdx = hash.indexOf('/');
  if (slashIdx >= 0) {
    return {
      group: hash.slice(0, slashIdx),
      section: hash.slice(slashIdx + 1),
    };
  }
  return { section: hash };
}

function resolveInitialSection(): string {
  if (typeof window === 'undefined') return 'overview';

  const hash = window.location.hash.slice(1);
  const { section } = parseHash(hash);

  if (section && navItems.some((n) => n.id === section)) return section;

  // Backward-compat: try legacy flat hash
  const newHash = getNewHashFromOld(hash);
  if (newHash) {
    window.location.hash = newHash;
    const { section: mappedSection } = parseHash(newHash);
    if (mappedSection) return mappedSection;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && navItems.some((n) => n.id === stored)) return stored;
  } catch {
    /* localStorage unavailable */
  }

  return 'overview';
}

function resolveInitialExpandedGroups(activeSection: string): Set<string> {
  const item = navItems.find((n) => n.id === activeSection);
  const activeGroup = item?.group;

  // Always try restoring previous expanded groups first
  try {
    const stored = localStorage.getItem(EXPANDED_GROUPS_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const storedGroups = new Set<string>(parsed.filter((v): v is string => typeof v === 'string'));
        // Ensure active section's group is always expanded
        if (activeGroup) storedGroups.add(activeGroup);
        return storedGroups;
      }
    }
  } catch {
    /* localStorage unavailable */
  }

  // Fallback: just the group containing the active section
  return activeGroup ? new Set([activeGroup]) : new Set();
}

export function useActiveSection() {
  const [activeSection, setActiveSectionInternal] = useState<string>(resolveInitialSection);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() =>
    resolveInitialExpandedGroups(resolveInitialSection())
  );

  const setActiveSection = useCallback((section: string) => {
    setActiveSectionInternal(section);

    // Auto-expand the group that contains the target section
    const item = navItems.find((n) => n.id === section);
    if (item?.group) {
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        next.add(item.group!);
        return next;
      });
    }
  }, []);

  // --- Sync URL hash ---
  useEffect(() => {
    const item = navItems.find((n) => n.id === activeSection);
    if (item?.group) {
      window.location.hash = `${item.group}/${item.id}`;
    } else {
      window.location.hash = activeSection;
    }
  }, [activeSection]);

  // --- Listen for external hash changes (browser back/forward) ---
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);

      // Try new format first
      const { group, section } = parseHash(hash);
      if (section && navItems.some((n) => n.id === section)) {
        setActiveSectionInternal(section);
        if (group) {
          setExpandedGroups((prev) => {
            const next = new Set(prev);
            next.add(group);
            return next;
          });
        }
        return;
      }

      // Fallback: legacy flat hash
      const newHash = getNewHashFromOld(hash);
      if (newHash) {
        window.location.hash = newHash;
        const { section: mappedSection } = parseHash(newHash);
        if (mappedSection) setActiveSectionInternal(mappedSection);
      }
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

  // --- Persist expanded groups ---
  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_GROUPS_KEY, JSON.stringify([...expandedGroups]));
    } catch {
      /* localStorage unavailable */
    }
  }, [expandedGroups]);

  return { activeSection, setActiveSection, expandedGroups, setExpandedGroups };
}
