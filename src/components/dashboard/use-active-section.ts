'use client';

import { useState, useEffect, useCallback } from 'react';
import { navItems, STORAGE_KEY } from './nav-items';

function resolveInitialSection(): string {
  if (typeof window === 'undefined') return 'overview';

  const hash = window.location.hash.slice(1);
  if (hash && !hash.includes('/') && navItems.some((n) => n.id === hash)) return hash;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && navItems.some((n) => n.id === stored)) return stored;
  } catch {
    /* localStorage unavailable */
  }

  return 'overview';
}

export function useActiveSection() {
  const [activeSection, setActiveSectionInternal] = useState<string>(resolveInitialSection);

  const setActiveSection = useCallback((section: string) => {
    setActiveSectionInternal(section);
  }, []);

  // --- Sync URL hash ---
  useEffect(() => {
    window.location.hash = activeSection;
  }, [activeSection]);

  // --- Listen for external hash changes (browser back/forward) ---
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);

      if (hash && !hash.includes('/') && navItems.some((n) => n.id === hash)) {
        setActiveSectionInternal(hash);
        return;
      }

      setActiveSectionInternal('overview');
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
