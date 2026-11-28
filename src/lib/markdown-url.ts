import { defaultUrlTransform } from 'react-markdown';
import { apiUrl } from './api-base';

/** Reports use the same authenticated file endpoints under every deployment base path. */
export function markdownUrl(url: string): string {
  const safe = defaultUrlTransform(url);
  return safe.startsWith('/api/agentteams/') ? apiUrl(safe) : safe;
}
