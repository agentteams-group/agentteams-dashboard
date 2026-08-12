'use client';

import React, { useContext } from 'react';
import type { WorkerRuntime } from '@/lib/agentteams-api';

/**
 * MXID → owning worker lookup. Built in ChatSection from the workers list
 * (`WorkerResponse.matrixUserID`) and consumed by ChatRoom to stamp each
 * DisplayMessage with its runtime / workerName (任务书 §6.2.1 / R1).
 *
 * The context is optional: message components render fine without a provider
 * (runtime stays unknown, no corner badges), which keeps standalone tests
 * and story-style usage free of provider wiring.
 */
export interface RuntimeMapEntry {
  runtime: WorkerRuntime;
  workerName: string;
}

export type RuntimeMap = Record<string, RuntimeMapEntry>;

const RuntimeMapContext = React.createContext<RuntimeMap | null>(null);

const EMPTY_MAP: RuntimeMap = {};

export function RuntimeMapProvider({
  map,
  children,
}: {
  map: RuntimeMap;
  children: React.ReactNode;
}) {
  return <RuntimeMapContext.Provider value={map}>{children}</RuntimeMapContext.Provider>;
}

/** Returns the MXID → worker map, or an empty object outside a provider. */
export function useRuntimeMap(): RuntimeMap {
  return useContext(RuntimeMapContext) ?? EMPTY_MAP;
}
