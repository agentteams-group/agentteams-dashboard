import { afterEach, expect, it, vi } from 'vitest';
import { markdownUrl } from './markdown-url';

afterEach(() => vi.unstubAllEnvs());

it('retains protocol filtering and leaves external image URLs unchanged', () => {
  expect(markdownUrl('javascript:alert(1)')).toBe('');
  expect(markdownUrl('https://example.test/image.png')).toBe('https://example.test/image.png');
});

it('resolves internal report resources under the deployed base path once', () => {
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/dashboard');
  expect(markdownUrl('/api/agentteams/tasks/t/files?artifactId=a')).toBe('/dashboard/api/agentteams/tasks/t/files/?artifactId=a');
  expect(markdownUrl('/dashboard/api/agentteams/tasks/t/files/?artifactId=a')).toBe('/dashboard/api/agentteams/tasks/t/files/?artifactId=a');
});
