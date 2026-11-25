import { describe, expect, it } from 'vitest';
import { MemberConfigError } from './member-config-api';
import { classifyLoadError, classifyWriteError } from './member-config-errors';

describe('member config error classification', () => {
  it('classifies controller write errors by body code', () => {
    expect(classifyWriteError(new MemberConfigError(409, 'stale', 'stale_rev', {}))).toEqual({
      kind: 'stale_rev',
    });
    expect(
      classifyWriteError(new MemberConfigError(422, 'unknown', 'unknown_field', { fields: ['a.b'] })),
    ).toEqual({ kind: 'unknown_field', fields: ['a.b'] });
    expect(
      classifyWriteError(
        new MemberConfigError(422, 'no keys', 'no_writable_keys', {
          unsupported: [{ key: 'a', reason: 'denied' }],
        }),
      ),
    ).toEqual({ kind: 'no_writable_keys', unsupported: [{ key: 'a', reason: 'denied' }] });
    expect(
      classifyWriteError(
        new MemberConfigError(422, 'bad', 'invalid_value', { key: 'a', detail: 'must be > 0' }),
      ),
    ).toEqual({ kind: 'invalid_value', key: 'a', detail: 'must be > 0' });
    expect(
      classifyWriteError(
        new MemberConfigError(409, 'runtime', 'runtime_unknown', { supported: ['openclaw', 'hermes'] }),
      ),
    ).toEqual({ kind: 'runtime_unknown', supported: 'openclaw、hermes' });
  });

  it('maps HTTP-only failures to forbidden / gone / retryable', () => {
    expect(classifyWriteError(new MemberConfigError(403, 'HTTP 403'))).toEqual({ kind: 'forbidden' });
    expect(classifyWriteError(new MemberConfigError(404, 'HTTP 404'))).toEqual({ kind: 'gone' });
    expect(classifyWriteError(new MemberConfigError(502, 'HTTP 502', undefined, 'boom'))).toEqual({
      kind: 'retryable',
      detail: 'boom',
    });
  });

  it('classifies load failures (404/405/501 → gone, 403 → forbidden)', () => {
    expect(classifyLoadError(new MemberConfigError(404, 'missing'))).toEqual({ kind: 'gone' });
    expect(classifyLoadError(new MemberConfigError(501, 'not implemented'))).toEqual({ kind: 'gone' });
    expect(classifyLoadError(new MemberConfigError(403, 'forbidden'))).toEqual({ kind: 'forbidden' });
    expect(classifyLoadError(new Error('network down'))).toEqual({
      kind: 'other',
      detail: 'network down',
    });
  });
});
