'use client';

import { create } from 'zustand';

/**
 * Global active-section state.
 *
 * The dashboard historically kept this in component state; plugins need to
 * navigate programmatically (api.dashboard.navigate), so it now lives in a
 * tiny store that both the dashboard shell and the plugin API can reach.
 */

interface SectionState {
  activeSection: string;
  setActiveSection: (_sectionId: string) => void;
}

export const useSectionStore = create<SectionState>()((set) => ({
  activeSection: 'overview',
  setActiveSection: (sectionId: string) => set({ activeSection: sectionId }),
}));
