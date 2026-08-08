import { describe, expect, it } from 'vitest';
import { redactJsonStrings, redactPii } from './redact';

describe('redactPii', () => {
  it('returns empty text unchanged', () => {
    expect(redactPii('')).toBe('');
  });

  it('masks Chinese ID card numbers', () => {
    expect(redactPii('id 110101199003077758 here')).toBe('id **** here');
  });

  it('masks Chinese phone numbers', () => {
    expect(redactPii('call 13812345678 now')).toBe('call **** now');
  });

  it('masks email addresses', () => {
    expect(redactPii('mail ops@example.com please')).toBe('mail **** please');
  });

  it('masks IPv4 addresses', () => {
    expect(redactPii('from 192.168.1.10:8080')).toBe('from ****:8080');
  });

  it('masks OpenAI-style API keys', () => {
    expect(redactPii('key sk-abcdefghij0123456789abcd end')).toBe('key **** end');
  });

  it('masks Aliyun access key ids', () => {
    expect(redactPii('ak LTAI5tabcdef1234567 end')).toBe('ak **** end');
  });

  it('masks Matrix access tokens', () => {
    expect(redactPii('token syt_bWFuYWdlcg_abcd1234 end')).toBe('token **** end');
  });

  it('masks long hex secrets', () => {
    expect(redactPii('hex 0123456789abcdef0123456789abcdef end')).toBe('hex **** end');
  });

  it('masks bearer tokens but keeps the scheme', () => {
    expect(redactPii('Authorization: Bearer abcdef0123456789abcdef01')).toBe(
      'Authorization: Bearer ****'
    );
  });

  it('masks secret key-value pairs but keeps the key', () => {
    expect(redactPii('password=hunter2')).toBe('password=****');
    expect(redactPii('api_key: abcdefghij0123456789')).toBe('api_key: ****');
  });

  it('masks access key secret assignments but keeps the key', () => {
    expect(redactPii('access_key_secret = abcdefghij0123456789abcd')).toBe(
      'access_key_secret = ****'
    );
  });

  it('leaves ordinary text untouched', () => {
    const text = 'Worker agentteams-worker-a woke up in room !abc:example';
    expect(redactPii(text)).toBe(text);
  });
});

describe('redactJsonStrings', () => {
  it('redacts string values recursively', () => {
    expect(
      redactJsonStrings({
        outer: { email: 'ops@example.com' },
        list: ['call 13812345678'],
        n: 42,
        ok: null,
      })
    ).toEqual({
      outer: { email: '****' },
      list: ['call ****'],
      n: 42,
      ok: null,
    });
  });

  it('blanks fields whose name marks them as secrets', () => {
    expect(
      redactJsonStrings({ password: 'hunter2', nested: { apiKey: 'abc' }, note: 'fine' })
    ).toEqual({ password: '****', nested: { apiKey: '****' }, note: 'fine' });
  });

  it('handles arrays at the top level', () => {
    expect(redactJsonStrings(['ops@example.com'])).toEqual(['****']);
  });
});
