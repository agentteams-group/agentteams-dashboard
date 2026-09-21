// @vitest-environment node
import { NextRequest } from 'next/server';
import { expect, it } from 'vitest';
import { filterEnvironmentResponse, rejectEnvironmentWrite } from './environment-access';

function request(level: string, body?: unknown) {
 return new NextRequest('http://localhost/api/workers', { method: body ? 'PUT' : 'GET', headers: { 'x-agentteams-user': 'alice', 'x-agentteams-user-level': level }, body: body ? JSON.stringify(body) : undefined });
}
it('removes environment values from list/detail responses for low privilege sessions', async () => {
 for (const body of [{ env: { TOKEN: 'secret' }, envEditable: true }, { workers: [{ env: { TOKEN: 'secret' }, envEditable: true }] }]) {
  const result = await filterEnvironmentResponse(request('2'), Response.json(body));
  expect(await result.text()).not.toContain('secret');
 }
});
it('preserves admin values and gates empty-object writes as well as nonempty writes', async () => {
 const result = await filterEnvironmentResponse(request('3'), Response.json({ env: { TOKEN: 'secret' } }));
 expect(await result.json()).toEqual({ env: { TOKEN: 'secret' } });
 expect((await rejectEnvironmentWrite(request('2', { env: {} })))?.status).toBe(403);
 expect(await rejectEnvironmentWrite(request('3', { env: {} }))).toBeNull();
 expect(await rejectEnvironmentWrite(request('2', { model: 'model' }))).toBeNull();
});
