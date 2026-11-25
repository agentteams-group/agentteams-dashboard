'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { parseObservabilityLink } from '@/lib/observability-links';

function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

export function useObservabilityTarget() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => '');
  return useMemo(() => parseObservabilityLink(hash), [hash]);
}
