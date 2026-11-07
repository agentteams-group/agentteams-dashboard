export const SCHEDULED_THEME_ID = 'scheduled';

export interface ThemeSchedule {
  lightStart: string;
  darkStart: string;
  dayTheme: 'light' | 'warm';
}

// These two pure functions are also embedded in the pre-paint script. Keep
// them self-contained so hydration and the first frame use the same rules.
export function normalizeThemeSchedule(input: unknown): ThemeSchedule {
  const value = input && typeof input === 'object' ? input as Partial<ThemeSchedule> : {};
  const validTime = (time: unknown): time is string => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  let lightStart = validTime(value.lightStart) ? value.lightStart : '07:00';
  let darkStart = validTime(value.darkStart) ? value.darkStart : '19:00';
  if (lightStart === darkStart) {
    lightStart = '07:00';
    darkStart = '19:00';
  }
  return { lightStart, darkStart, dayTheme: value.dayTheme === 'warm' ? 'warm' : 'light' };
}

export function scheduledThemeId(schedule: ThemeSchedule, minuteOfDay: number): 'light' | 'warm' | 'dark' {
  const [lightHour, lightMinute] = schedule.lightStart.split(':').map(Number);
  const [darkHour, darkMinute] = schedule.darkStart.split(':').map(Number);
  const light = lightHour * 60 + lightMinute;
  const dark = darkHour * 60 + darkMinute;
  const daytime = light < dark
    ? minuteOfDay >= light && minuteOfDay < dark
    : minuteOfDay >= light || minuteOfDay < dark;
  return daytime ? schedule.dayTheme : 'dark';
}
