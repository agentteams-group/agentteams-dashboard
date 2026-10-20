'use client';

import { useEffect, useCallback } from 'react';
import { navItems, STORAGE_KEY } from './nav-items';
import { useSectionStore } from '@/lib/section-store';
import { isPluginSectionId } from '@/lib/plugins/types';
import {
  hashForActiveSection,
  hashForSection,
  needsHashNormalization,
  resolveHash,
} from '@/lib/nav-hash';
import { useHitlInboxStore } from '@/lib/hitl-inbox';

/**
 * Active section resolution for the Workbench IA.
 *
 * The store keeps flat section ids ('chat', 'tasks', plugin routes, …); the
 * URL carries layered hashes (`#workbench/space/<roomId>`,
 * `#console/resources/workers`, …). Legacy flat hashes (#chat, #workers…)
 * resolve through the compat table and are normalized in place via
 * history.replaceState, so old bookmarks keep working without polluting the
 * history stack (PRD §5.4). Plugin routes keep their flat
 * `plugin-route:<pluginId>/<routeId>` form.
 */

function isKnownSection(hash: string): boolean {
  if (navItems.some((n) => n.id === hash)) return true;
  return isPluginSectionId(hash);
}

/** Apply a resolved hash's deep-link payload (room id) to the target store. */
function applyDeepLinks(resolved: ReturnType<typeof resolveHash>): void {
  if (resolved?.section === 'chat' && resolved.roomId) {
    useHitlInboxStore.getState().setPendingChatRoomId(resolved.roomId);
  }
}

function resolveInitialSection(): string {
  if (typeof window === 'undefined') return 'chat';

  const hash = window.location.hash.slice(1);
  if (hash) {
    const resolved = resolveHash(hash, isKnownSection);
    if (resolved) {
      applyDeepLinks(resolved);
      // Normalize legacy flat hashes (#chat → #workbench/space) in place —
      // replaceState keeps the history stack clean for redirected bookmarks.
      // Layered hashes stay untouched: they may carry deep-link segments
      // (room id, query params) that must survive in the URL.
      if (needsHashNormalization(hash)) {
        window.history.replaceState(null, '', `#${hashForSection(resolved.section)}`);
      }
      return resolved.section;
    }
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isKnownSection(stored)) return stored;
    // Pre-Workbench stored ids remain valid section ids — they were flat.
  } catch {
    /* localStorage unavailable */
  }

  // Default landing section: the collaboration space (conversation-first
  // shell). Operators can pin another surface via a layered deep link or
  // localStorage.
  return 'chat';
}

// Initial resolution must run once per app lifetime. TasksSection (and any
// future caller) remounts useActiveSection whenever its section mounts; a
// remount re-reads the URL hash, which still holds the PREVIOUS section in
// the same-commit path (chat→tasks bypasses AnimatePresence, so the section
// component mounts before the shell's hash-sync effect writes the layered
// hash). That re-read clobbered the fresh 'tasks' selection straight back to
// 'chat' — the operator-visible "click 任务看板 first time does nothing" bug.
let initialResolutionDone = false;

/** Test seam: reset the once-guard so each test gets a fresh resolution. */
export function resetInitialResolutionForTests(): void {
  initialResolutionDone = false;
}

export function useActiveSection() {
  const activeSection = useSectionStore((s) => s.activeSection);

  // Resolve the initial section once on mount (hash / localStorage / default).
  // Subsequent mounts (TasksSection etc.) keep the live store value.
  useEffect(() => {
    if (initialResolutionDone) return;
    initialResolutionDone = true;
    useSectionStore.getState().setActiveSection(resolveInitialSection());
  }, []);

  const setActiveSection = useCallback((section: string) => {
    useSectionStore.getState().setActiveSection(section);
  }, []);

  // --- Sync URL hash (flat section → layered hash) ---
  useEffect(() => {
    // Read the live store value instead of the captured `activeSection`:
    // on mount the initial-resolution effect above has already written the
    // resolved section into the store, while this effect's closure still
    // holds the pre-resolution default ('chat'). Writing that stale
    // value would momentarily clobber the URL hash, and the resulting
    // hashchange event races the re-render — when the event wins, the
    // handler reads the stale hash and bounces the user back to overview.
    const section = useSectionStore.getState().activeSection;
    // Preserve a valid resource-tab deep link (`#console/resources/<tab>`)
    // instead of collapsing it to `#console/resources` on mount.
    const canonical = `#${hashForActiveSection(section, window.location.hash)}`;
    if (window.location.hash !== canonical) {
      window.location.hash = canonical;
    }
  }, [activeSection]);

  // --- Listen for external hash changes (browser back/forward) ---
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      const canonical = `#${hashForSection(useSectionStore.getState().activeSection)}`;

      // Pure echo of our own programmatic write — nothing to sync.
      if (window.location.hash === canonical) return;

      const resolved = hash ? resolveHash(hash, isKnownSection) : null;
      if (resolved) {
        applyDeepLinks(resolved);
        useSectionStore.getState().setActiveSection(resolved.section);
        return;
      }

      useSectionStore.getState().setActiveSection('chat');
      window.location.hash = '#workbench/space';
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
