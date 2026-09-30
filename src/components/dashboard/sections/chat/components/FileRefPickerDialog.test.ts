import { describe, expect, it } from 'vitest';
import { computeRefPrefix, parentRefPrefix } from './FileRefPickerDialog';

describe('computeRefPrefix', () => {
  it('enters a directory from the root', () => {
    expect(computeRefPrefix('', 'docs/')).toBe('docs/');
  });

  it('appends to the current prefix when entering a nested directory', () => {
    expect(computeRefPrefix('docs/', 'api/')).toBe('docs/api/');
  });

  it('keeps the prefix unchanged for malformed keys', () => {
    expect(computeRefPrefix('docs/', '')).toBe('docs/');
    expect(computeRefPrefix('docs/', 'a//b/')).toBe('docs/');
  });
});

describe('parentRefPrefix', () => {
  it('walks up to the root', () => {
    expect(parentRefPrefix('docs/')).toBe('');
    expect(parentRefPrefix('docs/api/')).toBe('docs/');
    expect(parentRefPrefix('')).toBe('');
  });
});
