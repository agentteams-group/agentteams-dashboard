import { describe, expect, it } from 'vitest';
import { apiUrl } from './api-base';

describe('apiUrl', () => {
  it('places the trailing slash before query parameters', () => {
    expect(apiUrl('/api/agentteams/workers/manager/files/download?key=manager%2Fopenclaw.json')).toBe(
      '/api/agentteams/workers/manager/files/download/?key=manager%2Fopenclaw.json'
    );
  });
});
