// Policy Store — Manages user-defined governance policies

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BUILTIN_POLICIES, type Policy } from './policy-engine';

interface PolicyState {
  policies: Policy[];
  addPolicy: (_policy: Policy) => void;
  updatePolicy: (_id: string, _updates: Partial<Policy>) => void;
  deletePolicy: (_id: string) => void;
  togglePolicy: (_id: string) => void;
}

export const usePolicyStore = create<PolicyState>()(
  persist(
    (set) => ({
      policies: BUILTIN_POLICIES,

      addPolicy: (policy) => {
        set((state) => ({
          policies: [...state.policies, { ...policy, createdAt: Date.now(), updatedAt: Date.now() }],
        }));
      },

      updatePolicy: (id, updates) => {
        set((state) => ({
          policies: state.policies.map((p) =>
            p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
          ),
        }));
      },

      deletePolicy: (id) => {
        // Don't allow deleting built-in policies
        if (BUILTIN_POLICIES.some((p) => p.id === id)) return;
        set((state) => ({
          policies: state.policies.filter((p) => p.id !== id),
        }));
      },

      togglePolicy: (id) => {
        set((state) => ({
          policies: state.policies.map((p) =>
            p.id === id ? { ...p, enabled: !p.enabled, updatedAt: Date.now() } : p
          ),
        }));
      },
    }),
    {
      name: 'hiclaw-policies',
      version: 1,
    }
  )
);
