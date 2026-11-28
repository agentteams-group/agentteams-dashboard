import { expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
vi.mock('../../../proxy-helper', () => ({
  getControllerUrl: vi.fn(() => 'http://controller'),
  proxyToAgentTeams: vi.fn(),
}));
import { proxyToAgentTeams } from '../../../proxy-helper';
import { GET } from './route';

it('reads the immutable Task image through the existing authorized Controller proxy', async () => {
  const response = new NextResponse(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
  vi.mocked(proxyToAgentTeams).mockResolvedValue(response);
  const request = new NextRequest('http://localhost/api/agentteams/tasks/exec/files?team=own&artifactId=picture&version=frozen&url=http://untrusted');
  expect(await GET(request, { params: Promise.resolve({ id: 'exec' }) })).toBe(response);
  expect(proxyToAgentTeams).toHaveBeenCalledWith(request, 'http://controller',
    '/api/v1/tasks/exec/files?team=own&artifactId=picture&version=frozen', {
      forwardBody: false, stream: true, passthroughHeaders: ['content-disposition', 'content-length'],
    });
});
