// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetBackendUrlResolutionForTests,
  isAddressLike,
  resolveBackendUrl,
} from './backend-url-resolve';
import { EgressPolicyError, egressFetch } from './egress-policy';

vi.mock('./egress-policy', async (importOriginal) => {
  const original = await importOriginal<typeof import('./egress-policy')>();
  return { ...original, egressFetch: vi.fn() };
});

const egressFetchMock = vi.mocked(egressFetch);

beforeEach(() => {
  __resetBackendUrlResolutionForTests();
  egressFetchMock.mockReset();
});

/** egressFetch follows the URL prefix to simulate a TLS or plaintext port. */
function respondFor(prefix: string): void {
  egressFetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith(prefix)) return { status: 401, headers: new Headers() };
    throw new TypeError('fetch failed');
  });
}

describe('resolveBackendUrl — https 优先的协议识别', () => {
  it('显式 https:// → 原样采用，不探测、不改写', async () => {
    const r = await resolveBackendUrl('https://gw.example.com:8443/');
    expect(r).toEqual({
      url: 'https://gw.example.com:8443',
      scheme: 'https',
      resolved: true,
      changed: false,
    });
    expect(egressFetchMock).not.toHaveBeenCalled();
  });

  it('显式 http:// → 不升级（用户明确要求明文），不探测', async () => {
    const r = await resolveBackendUrl('http://192.168.1.10:8080');
    expect(r).toEqual({
      url: 'http://192.168.1.10:8080',
      scheme: 'http',
      resolved: true,
      changed: false,
    });
    expect(egressFetchMock).not.toHaveBeenCalled();
  });

  it('无协议 + https 命中（任何 HTTP 响应都算，TLS 已通）→ https', async () => {
    egressFetchMock.mockResolvedValue({ status: 400, headers: new Headers() });
    const r = await resolveBackendUrl('gw.example.com:8443');
    expect(r).toMatchObject({
      url: 'https://gw.example.com:8443',
      scheme: 'https',
      resolved: true,
      changed: true,
    });
    expect(r.warning).toBeUndefined();
    expect(egressFetchMock).toHaveBeenCalledTimes(1);
    expect(egressFetchMock.mock.calls[0][0]).toBe('https://gw.example.com:8443');
  });

  it('无协议 + https 失败 → 回退 http 探测命中', async () => {
    respondFor('http://');
    const r = await resolveBackendUrl('192.168.54.107:6866');
    expect(r).toMatchObject({
      url: 'http://192.168.54.107:6866',
      scheme: 'http',
      resolved: true,
      changed: true,
    });
    expect(egressFetchMock).toHaveBeenCalledTimes(2);
    expect(egressFetchMock.mock.calls[0][0]).toBe('https://192.168.54.107:6866');
    expect(egressFetchMock.mock.calls[1][0]).toBe('http://192.168.54.107:6866');
  });

  it('两路都不通 → 按 https 落地 + scheme_unresolved（绝不静默 http）', async () => {
    egressFetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const r = await resolveBackendUrl('gw.example.com:8443');
    expect(r).toEqual({
      url: 'https://gw.example.com:8443',
      scheme: 'https',
      resolved: false,
      changed: true,
      warning: 'scheme_unresolved',
    });
    expect(egressFetchMock).toHaveBeenCalledTimes(2);
  });

  it('SSRF policy denial is rethrown without trying another scheme', async () => {
    egressFetchMock.mockRejectedValue(new EgressPolicyError('denied'));
    await expect(resolveBackendUrl('169.254.169.254:80')).rejects.toBeInstanceOf(EgressPolicyError);
    expect(egressFetchMock).toHaveBeenCalledTimes(1);
  });

  it('非 http(s) scheme 原样返回、不探测（交由 isHttpUrl 拒绝）', async () => {
    const r = await resolveBackendUrl('ftp://files:21');
    expect(r).toEqual({ url: 'ftp://files:21', scheme: null, resolved: false, changed: false });
    expect(egressFetchMock).not.toHaveBeenCalled();
  });

  it('空串 → 空结果', async () => {
    expect(await resolveBackendUrl('   ')).toEqual({
      url: '',
      scheme: null,
      resolved: false,
      changed: false,
    });
    expect(egressFetchMock).not.toHaveBeenCalled();
  });

  it('命中结果在进程内缓存 10 分钟（同一 host:port 只探测一次）', async () => {
    respondFor('https://');
    const first = await resolveBackendUrl('gw.example.com:8443');
    const second = await resolveBackendUrl('gw.example.com:8443');
    expect(second).toEqual(first);
    expect(egressFetchMock).toHaveBeenCalledTimes(1);
  });

  it('探测失败不缓存 —— 服务起来后重测要重新探测', async () => {
    egressFetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await resolveBackendUrl('late.example.com:8443');
    egressFetchMock.mockReset();
    respondFor('https://');
    const r = await resolveBackendUrl('late.example.com:8443');
    expect(r).toMatchObject({ url: 'https://late.example.com:8443', resolved: true });
    expect(egressFetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('isAddressLike', () => {
  it('accepts http(s) URLs and bare host:port', () => {
    expect(isAddressLike('http://h:1')).toBe(true);
    expect(isAddressLike('https://h')).toBe(true);
    expect(isAddressLike('192.168.54.107:6866')).toBe(true);
    expect(isAddressLike('controller.local:8090/api')).toBe(true);
  });

  it('rejects other schemes and junk', () => {
    expect(isAddressLike('ftp://h')).toBe(false);
    expect(isAddressLike('javascript:alert(1)')).toBe(false);
    expect(isAddressLike('not a url')).toBe(false);
    expect(isAddressLike('')).toBe(false);
  });
});
