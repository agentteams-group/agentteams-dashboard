// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { requireHigressConsoleAccess } from '@/app/api/higress/access';
import { saveManagedMcp, verifyManagedMcp } from '@/lib/server/mcp-management';
import { POST } from './route';

vi.mock('@/app/api/higress/access', () => ({ requireHigressConsoleAccess: vi.fn() }));
vi.mock('@/lib/server/mcp-management', async (original) => ({ ...await original<typeof import('@/lib/server/mcp-management')>(), saveManagedMcp: vi.fn(), verifyManagedMcp: vi.fn() }));

const request = (body: unknown) => new NextRequest('http://dashboard/api/agentteams/mcps/manage', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(requireHigressConsoleAccess).mockResolvedValue(null); });
describe('MCP management administrator boundary', () => {
  it('rejects unauthorized mutations before touching gateway configuration', async () => {
    vi.mocked(requireHigressConsoleAccess).mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }));
    expect((await POST(request({ action: 'save', input: {} }))).status).toBe(403);
    expect(saveManagedMcp).not.toHaveBeenCalled();
  });
  it('separates saving from tool verification', async () => {
    vi.mocked(saveManagedMcp).mockResolvedValue({ name: 'docs' } as never);
    expect((await POST(request({ action: 'save', input: { name: 'docs' } }))).status).toBe(200);
    expect(verifyManagedMcp).not.toHaveBeenCalled();
  });
  it('does not echo upstream error responses containing credentials', async () => {
    vi.mocked(saveManagedMcp).mockRejectedValue(new Error('request Authorization: Bearer private-token'));
    const result = await POST(request({ action: 'save', input: {} }));
    expect(result.status).toBe(502);
    expect(await result.text()).not.toContain('private-token');
  });
});
