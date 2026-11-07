import { describe, expect, it } from 'vitest';
import { normalizeThemeSchedule, scheduledThemeId } from './schedule';

const schedule = { lightStart: '07:00', darkStart: '19:00', dayTheme: 'light' as const };

describe('theme schedule', () => {
  it.each([
    [0, 'dark'], [419, 'dark'], [420, 'light'], [1139, 'light'], [1140, 'dark'], [1439, 'dark'],
  ])('resolves local minute %s to %s, including exact boundaries', (minute, expected) => {
    expect(scheduledThemeId(schedule, minute)).toBe(expected);
  });

  it('supports a daytime interval crossing midnight', () => {
    const overnight = { ...schedule, lightStart: '19:00', darkStart: '07:00' };
    expect(scheduledThemeId(overnight, 23 * 60)).toBe('light');
    expect(scheduledThemeId(overnight, 6 * 60)).toBe('light');
    expect(scheduledThemeId(overnight, 7 * 60)).toBe('dark');
    expect(scheduledThemeId(overnight, 12 * 60)).toBe('dark');
  });

  it('can use warm white during the day, keeping graphite at night', () => {
    expect(scheduledThemeId({ ...schedule, dayTheme: 'warm' }, 10 * 60)).toBe('warm');
    expect(scheduledThemeId({ ...schedule, dayTheme: 'warm' }, 23 * 60)).toBe('dark');
  });

  it.each([undefined, null, {}, { lightStart: '25:00' }, { lightStart: '19:00', darkStart: '19:00' }])(
    'normalizes absent or unusable persisted settings', (input) => {
      expect(normalizeThemeSchedule(input)).toEqual(schedule);
    }
  );

  it('keeps valid custom times and only accepts a built-in daytime palette', () => {
    expect(normalizeThemeSchedule({ lightStart: '08:30', darkStart: '20:15', dayTheme: 'warm' }))
      .toEqual({ lightStart: '08:30', darkStart: '20:15', dayTheme: 'warm' });
    expect(normalizeThemeSchedule({ ...schedule, dayTheme: 'missing' }).dayTheme).toBe('light');
  });
});
