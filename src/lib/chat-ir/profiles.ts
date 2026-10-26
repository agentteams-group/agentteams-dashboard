import type { ChatRuntimeProfile } from './types';

/**
 * Per-runtime answer policy. Runtimes differ in where the user-visible answer
 * lands, so one generic "last message wins" rule either buries narration in
 * the answer or hides the real answer behind a thread placeholder.
 */
export interface RuntimeProfileRules {
  /**
   * Top-level m.notice process steps may join the currently open turn.
   * False for runtimes that open a fresh root per turn (qwenpaw/openclaw) or
   * emit flat conversation (manager).
   */
  foldsTopLevelProcess: boolean;
  /**
   * root      – only the root event edit is the answer (qwenpaw)
   * last-text – the last text step is the answer (hermes/copaw/openhuman)
   * single    – the message is self-contained (openclaw/manager)
   */
  answer: 'root' | 'last-text' | 'single';
}

const PROFILES: Record<ChatRuntimeProfile, RuntimeProfileRules> = {
  openclaw: { foldsTopLevelProcess: false, answer: 'single' },
  qwenpaw: { foldsTopLevelProcess: false, answer: 'root' },
  hermes: { foldsTopLevelProcess: true, answer: 'last-text' },
  openhuman: { foldsTopLevelProcess: true, answer: 'last-text' },
  copaw: { foldsTopLevelProcess: true, answer: 'last-text' },
  manager: { foldsTopLevelProcess: false, answer: 'single' },
  unknown: { foldsTopLevelProcess: true, answer: 'last-text' },
};

export function resolveRuntimeProfile(runtime?: string | null): ChatRuntimeProfile {
  switch ((runtime ?? '').toLowerCase()) {
    case 'openclaw':
      return 'openclaw';
    case 'qwenpaw':
      return 'qwenpaw';
    case 'hermes':
      return 'hermes';
    case 'copaw':
      return 'copaw';
    case 'manager':
      return 'manager';
    case 'openhuman':
      return 'openhuman';
    default:
      return 'unknown';
  }
}

export function rulesFor(profile: ChatRuntimeProfile): RuntimeProfileRules {
  return PROFILES[profile];
}
