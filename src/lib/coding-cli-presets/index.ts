import pAndroid from './p-android.json';
import pEmbedded from './p-embedded.json';
import pGencode from './p-gencode.json';
import pHarmony from './p-harmony.json';
import pIos from './p-ios.json';
import pWeb from './p-web.json';
import type { CodingCliPreset } from './types';

export const CODING_CLI_PRESETS: CodingCliPreset[] = [
  pHarmony,
  pWeb,
  pAndroid,
  pIos,
  pEmbedded,
  pGencode,
] as CodingCliPreset[];

export {
  CODING_CLI_IDS,
  isCodingCliId,
  isRedacted,
  localizedText,
} from './types';
export type {
  CodingCliId,
  CodingCliPreset,
  CodingCliProbeItem,
  InstallRequest,
  InstallTask,
  Localized,
  Redacted,
  SettingsObject,
  SettingsValue,
} from './types';
