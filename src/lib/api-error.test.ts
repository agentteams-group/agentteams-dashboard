import { describe, it, expect } from 'vitest';
import { ApiError, NetworkError, describeWorkerDeleteError, formatErrorMessage } from '@/lib/api-error';

describe('ApiError', () => {
  it('exposes status and endpoint', () => {
    const err = new ApiError('boom', 503, '/workers');
    expect(err.status).toBe(503);
    expect(err.endpoint).toBe('/workers');
    expect(err.message).toBe('boom');
    expect(err.name).toBe('ApiError');
  });

  it('classifies client and server errors', () => {
    expect(new ApiError('x', 404, '/a').isClientError).toBe(true);
    expect(new ApiError('x', 400, '/a').isClientError).toBe(true);
    expect(new ApiError('x', 499, '/a').isClientError).toBe(true);
    expect(new ApiError('x', 500, '/a').isClientError).toBe(false);
    expect(new ApiError('x', 503, '/a').isClientError).toBe(false);
  });

  it('classifies server errors', () => {
    expect(new ApiError('x', 500, '/a').isServerError).toBe(true);
    expect(new ApiError('x', 599, '/a').isServerError).toBe(true);
    expect(new ApiError('x', 200, '/a').isServerError).toBe(false);
    expect(new ApiError('x', 400, '/a').isServerError).toBe(false);
  });

  it('classifies network errors via status 0', () => {
    const err = new ApiError('x', 0, '/a');
    expect(err.isNetworkError).toBe(true);
    expect(err.isClientError).toBe(false);
    expect(err.isServerError).toBe(false);
  });

  it('preserves the cause', () => {
    const cause = new Error('inner');
    const err = new ApiError('outer', 502, '/x', cause);
    expect(err.cause).toBe(cause);
  });
});

describe('NetworkError', () => {
  it('is an ApiError with status 0', () => {
    const err = new NetworkError('/sync');
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.endpoint).toBe('/sync');
    expect(err.isNetworkError).toBe(true);
    expect(err.name).toBe('NetworkError');
  });
});

describe('formatErrorMessage', () => {
  it('returns ApiError message for client errors', () => {
    expect(formatErrorMessage(new ApiError('Name required', 400, '/workers'))).toBe('Name required');
  });

  it('prefixes server errors with status', () => {
    expect(formatErrorMessage(new ApiError('db down', 500, '/workers'))).toBe(
      '服务器错误 (500): db down'
    );
  });

  it('returns network error message verbatim', () => {
    expect(formatErrorMessage(new NetworkError('/sync'))).toBe('网络请求失败，请检查连接');
  });

  it('falls back to Error.message for non-ApiError Error instances', () => {
    expect(formatErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('uses fallback for unknown values', () => {
    expect(formatErrorMessage('plain string')).toBe('操作失败');
    expect(formatErrorMessage('plain string', '自定义')).toBe('自定义');
    expect(formatErrorMessage(null)).toBe('操作失败');
  });

  it('surfaces the proxy message instead of raw API Error JSON', () => {
    const err = new ApiError(
      'API Error 502: {"message":"上游返回了 HTML 页面而非 API 数据","upstream_status":502}',
      502,
      '/workers/w1'
    );
    expect(formatErrorMessage(err)).toBe(
      '服务器错误 (502): 上游返回了 HTML 页面而非 API 数据'
    );
  });

  it('prefers message over error and notes a differing upstream status', () => {
    const err = new ApiError(
      'API Error 502: {"error":"fallback text","message":"真实原因","upstream_status":503}',
      502,
      '/workers/w1'
    );
    expect(formatErrorMessage(err)).toBe('服务器错误 (502): 真实原因（upstream 503）');
  });
});

describe('describeWorkerDeleteError', () => {
  it('turns a 409 member-of-team error into an actionable hint', () => {
    const err = new ApiError(
      'API Error 409: {"message":"worker is a member of team ceshi; remove via PUT/DELETE /api/v1/teams/ceshi"}',
      409,
      '/workers/leader123'
    );
    expect(describeWorkerDeleteError(err, 'leader123')).toBe(
      'Worker "leader123" 属于团队 "ceshi"，请先在团队详情中将其移出后再删除'
    );
  });

  it('falls back to formatErrorMessage for other errors', () => {
    expect(describeWorkerDeleteError(new ApiError('not found', 404, '/workers/x'), 'x')).toBe('not found');
    expect(describeWorkerDeleteError(new Error('boom'), 'x')).toBe('boom');
    expect(describeWorkerDeleteError(new NetworkError('/workers/x'), 'x')).toBe('网络请求失败，请检查连接');
  });
});
