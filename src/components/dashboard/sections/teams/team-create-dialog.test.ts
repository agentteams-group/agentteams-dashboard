import { describe, expect, it } from 'vitest';
import { parseWorkerNames } from './team-create-dialog';

describe('parseWorkerNames', () => {
  it('accepts Chinese and English commas while omitting blank names', () => {
    expect(parseWorkerNames('worker-a, worker-b， worker-c，，')).toEqual([
      'worker-a', 'worker-b', 'worker-c',
    ]);
  });
});
