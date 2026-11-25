import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  META_MAX_BYTES,
  MetaApiError,
  buildMetaHeaders,
  classifyMetaError,
  formatMetaText,
  getProjectMeta,
  getTaskMeta,
  isMetaEndpointUnavailable,
  saveProjectMeta,
  saveTaskMeta,
  validateMetaJson,
} from './meta-api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(impl: () => Response): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => impl());
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('validateMetaJson', () => {
  it('接受 JSON 对象（含空对象 {} = 清空）', () => {
    expect(validateMetaJson('{}')).toEqual({ ok: true });
    expect(validateMetaJson('{"a":1}')).toEqual({ ok: true });
  });

  it('拒绝空串 / 非法 JSON / 数组 / 标量', () => {
    expect(validateMetaJson('   ')).toEqual({ ok: false, error: 'empty' });
    expect(validateMetaJson('{')).toEqual({ ok: false, error: 'invalid_json' });
    expect(validateMetaJson('[1,2]')).toEqual({ ok: false, error: 'not_object' });
    expect(validateMetaJson('null')).toEqual({ ok: false, error: 'not_object' });
    expect(validateMetaJson('"text"')).toEqual({ ok: false, error: 'not_object' });
  });

  it('拒绝超过 256 KiB 的大文本', () => {
    const huge = `{"k":"${'x'.repeat(META_MAX_BYTES)}"}`;
    expect(validateMetaJson(huge)).toEqual({ ok: false, error: 'oversize' });
  });
});

describe('buildMetaHeaders', () => {
  it('GET 不带任何头；PUT 带 Content-Type + If-Match', () => {
    expect(buildMetaHeaders('GET')).toEqual({});
    expect(buildMetaHeaders('PUT', 'W/"v1"')).toEqual({
      'Content-Type': 'application/json',
      'If-Match': 'W/"v1"',
    });
    expect(buildMetaHeaders('PUT')).toEqual({ 'Content-Type': 'application/json' });
  });
});

describe('formatMetaText', () => {
  it('空 meta → {}；合法 JSON pretty；非法原文原样', () => {
    expect(formatMetaText('')).toBe('{}');
    expect(formatMetaText('  \n')).toBe('{}');
    expect(formatMetaText('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(formatMetaText('{oops')).toBe('{oops');
  });
});

describe('classifyMetaError', () => {
  it('405 = unsupported（老 Controller），404 = not_found，均视为端点不可用', () => {
    const unsupported = new MetaApiError('HTTP 405', 405, '/projects/p/meta');
    const notFound = new MetaApiError('HTTP 404', 404, '/projects/p/meta');
    expect(classifyMetaError(unsupported)).toBe('unsupported');
    expect(classifyMetaError(notFound)).toBe('not_found');
    expect(isMetaEndpointUnavailable(unsupported)).toBe(true);
    expect(isMetaEndpointUnavailable(notFound)).toBe(true);
  });

  it('409 区分 conflict / ambiguous_task；401/403 = forbidden', () => {
    expect(classifyMetaError(new MetaApiError('HTTP 409', 409, '/x', 'conflict'))).toBe('conflict');
    expect(classifyMetaError(new MetaApiError('HTTP 409', 409, '/x', 'ambiguous_task'))).toBe(
      'ambiguous',
    );
    expect(classifyMetaError(new MetaApiError('HTTP 403', 403, '/x'))).toBe('forbidden');
    expect(classifyMetaError(new MetaApiError('HTTP 401', 401, '/x'))).toBe('forbidden');
    expect(classifyMetaError(new MetaApiError('HTTP 428', 428, '/x'))).toBe('other');
  });

  it('回退到消息里的 HTTP 状态码（非 MetaApiError）', () => {
    expect(classifyMetaError(new Error('HTTP 405: nope'))).toBe('unsupported');
    expect(classifyMetaError(new Error('boom'))).toBe('other');
  });
});

describe('meta 传输：GET 原文 + ETag', () => {
  it('GET 项目 meta 透传原文与 ETag 响应头', async () => {
    const fetchMock = stubFetch(
      () =>
        new Response('{\n  "team": "biz"\n}', {
          status: 200,
          headers: { 'content-type': 'application/json', ETag: 'W/"v1"' },
        }),
    );

    const result = await getProjectMeta('p/1');

    expect(result).toEqual({ raw: '{\n  "team": "biz"\n}', etag: 'W/"v1"' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/agentteams/projects/p%2F1/meta');
    expect(init?.method).toBe('GET');
    expect(init?.headers).toEqual({});
  });

  it('GET 任务 meta 带 ?team= 消歧并读 ETag', async () => {
    const fetchMock = stubFetch(
      () => new Response('{}', { status: 200, headers: { ETag: 'W/"t1"' } }),
    );

    const result = await getTaskMeta('t1', 'team a');

    expect(result).toEqual({ raw: '{}', etag: 'W/"t1"' });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/agentteams/tasks/t1/meta/?team=team%20a');
  });
});

describe('meta 传输：PUT + If-Match', () => {
  it('项目保存带 If-Match 与原文 body，并回读新 ETag', async () => {
    const fetchMock = stubFetch(
      () => new Response('{"a":2}', { status: 200, headers: { ETag: 'W/"v2"' } }),
    );

    const result = await saveProjectMeta('p1', '{"a":2}', 'W/"v1"');

    expect(result).toEqual({ raw: '{"a":2}', etag: 'W/"v2"' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/agentteams/projects/p1/meta');
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe('{"a":2}');
    expect((init?.headers as Record<string, string>)['If-Match']).toBe('W/"v1"');
  });

  it('任务保存带 ?team= 消歧', async () => {
    const fetchMock = stubFetch(() => new Response('{}', { status: 200, headers: { ETag: 'W/"t2"' } }));

    await saveTaskMeta('t1', '{}', 'W/"t1"', 'biz-team');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/agentteams/tasks/t1/meta/?team=biz-team');
    expect((init?.headers as Record<string, string>)['If-Match']).toBe('W/"t1"');
  });
});

describe('meta 传输：错误码原样', () => {
  it('405 → MetaApiError(405)，分类 unsupported', async () => {
    stubFetch(() => new Response('', { status: 405 }));

    const error = await getProjectMeta('p1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MetaApiError);
    expect((error as MetaApiError).status).toBe(405);
    expect(classifyMetaError(error)).toBe('unsupported');
  });

  it('409 conflict body 的 code 被保留', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ code: 'conflict', message: 'etag mismatch' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const error = await saveProjectMeta('p1', '{}', 'W/"old"').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MetaApiError);
    expect((error as MetaApiError).code).toBe('conflict');
    expect(classifyMetaError(error)).toBe('conflict');
    expect((error as MetaApiError).message).toContain('etag mismatch');
  });

  it('409 ambiguous_task 分类为 ambiguous', async () => {
    stubFetch(
      () => new Response(JSON.stringify({ code: 'ambiguous_task' }), { status: 409 }),
    );

    const error = await getTaskMeta('t1').catch((e: unknown) => e);
    expect(classifyMetaError(error)).toBe('ambiguous');
  });

  it('400 原样透出服务端 detail', async () => {
    stubFetch(
      () => new Response(JSON.stringify({ message: 'meta must be an object' }), { status: 400 }),
    );

    const error = await saveTaskMeta('t1', '[]', 'W/"t1"').catch((e: unknown) => e);
    expect((error as MetaApiError).status).toBe(400);
    expect((error as MetaApiError).message).toBe('HTTP 400: meta must be an object');
  });
});
