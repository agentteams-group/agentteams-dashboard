import { describe, expect, it } from 'vitest';
import {
  buildDraft,
  diffNested,
  expandEntries,
  isReadOnlyField,
  isSensitiveUnchanged,
  normalizeSurface,
  pushRev,
  type RuntimeSurface,
} from './runtime-surface';

const surface: RuntimeSurface = {
  runtime: 'openclaw',
  surfaceVersion: '1',
  faces: [
    {
      id: 'gateway',
      fields: [
        { key: 'gateway.port', type: 'number', applies: 'restart', label: 'Gateway port' },
        { key: 'gateway.token', type: 'secret', applies: 'hot', sensitive: true, default: '***' },
        { key: 'gateway.enabled', type: 'boolean', applies: 'hot', default: true },
      ],
    },
    {
      id: 'models',
      fields: [
        { key: 'models.providers.*.id', type: 'string', applies: 'hot' },
        { key: 'models.providers.*.models.*.id', type: 'string', applies: 'hot' },
      ],
    },
  ],
};

const values = {
  gateway: { port: 8080, token: '***' },
  models: { providers: { primary: { id: 'openai', models: { a: { id: 'gpt' } } } } },
};

describe('runtime surface form model', () => {
  it('builds a flat draft with nested values, defaults and sensitive sentinel', () => {
    const draft = buildDraft(surface, values);
    expect(draft['gateway.port']).toBe(8080);
    expect(draft['gateway.token']).toBeUndefined();
    expect(draft['gateway.enabled']).toBe(true);
    expect(draft['models.providers.primary.id']).toBe('openai');
    // double-star template stays out of the draft (read-only in v1)
    expect(Object.keys(draft).some((key) => (key.match(/\*/g) ?? []).length >= 2)).toBe(false);
  });

  it('expands single-star entries and keeps double-star fields read-only', () => {
    expect(expandEntries('models.providers.*.id', values)).toEqual(['primary']);
    expect(isReadOnlyField({ key: 'models.providers.*.models.*.id', type: 'string', applies: 'hot' })).toBe(true);
    expect(isReadOnlyField({ key: 'models.providers.*.id', type: 'string', applies: 'hot' })).toBe(false);
  });

  it('diffs only changed leaves into a nested patch', () => {
    const draft = buildDraft(surface, values);
    draft['gateway.port'] = 9090;
    const patch = diffNested(draft, values);
    expect(patch).toEqual({ gateway: { port: 9090, enabled: true } });
    // masked secret and untouched fields never enter the patch
    expect(JSON.stringify(patch)).not.toContain('token');
    expect(
      diffNested(draft, {
        gateway: { port: 9090, enabled: true },
        models: { providers: { primary: { id: 'openai' } } },
      }),
    ).toEqual({});
  });

  it('treats masked/empty sensitive values as unchanged', () => {
    const field = { key: 'gateway.token', type: 'secret' as const, applies: 'hot' as const, sensitive: true };
    expect(isSensitiveUnchanged(field, '***')).toBe(true);
    expect(isSensitiveUnchanged(field, undefined)).toBe(true);
    expect(isSensitiveUnchanged(field, '')).toBe(true);
    expect(isSensitiveUnchanged(field, 'new-token')).toBe(false);
  });

  it('pushes rev history newest-first, deduplicated and capped', () => {
    expect(pushRev([], 'r1')).toEqual(['r1']);
    expect(pushRev(['r2', 'r1'], 'r1')).toEqual(['r1', 'r2']);
    expect(pushRev(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual(['f', 'a', 'b', 'c', 'd']);
  });

  it('normalizes legacy type aliases idempotently', () => {
    const legacy: RuntimeSurface = {
      runtime: 'x',
      faces: [
        {
          id: 'f',
          fields: [
            { key: 'a', type: 'int', applies: 'hot' },
            { key: 'b', type: 'float', applies: 'hot' },
            { key: 'c', type: 'bool', applies: 'hot' },
            { key: 'd', type: 'string-list', applies: 'hot' },
            { key: 'e', type: 'enum', applies: 'hot', enum: ['x'] },
          ],
        },
      ],
    };
    const once = normalizeSurface(legacy);
    expect(once.faces[0].fields.map((field) => field.type)).toEqual([
      'number',
      'number',
      'boolean',
      'array',
      'string',
    ]);
    expect(once.faces[0].fields[4].enum).toEqual(['x']);
    expect(normalizeSurface(once)).toEqual(once);
  });
});
