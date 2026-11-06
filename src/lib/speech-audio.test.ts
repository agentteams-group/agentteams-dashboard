import { describe, expect, it } from 'vitest';
import { encodeSpeechWav, validateSpeechWav, MAX_SPEECH_SECONDS, SPEECH_SAMPLE_RATE } from './speech-audio';

describe('speech audio', () => {
  it('encodes 16 kHz mono PCM with a duration the server can verify', () => {
    const wav = encodeSpeechWav(new Float32Array(SPEECH_SAMPLE_RATE));
    expect(validateSpeechWav(wav)).toBe(1);
    expect(new DataView(wav).getUint32(24, true)).toBe(16000);
  });

  it('rejects empty, truncated, oversized and incorrectly labelled audio', () => {
    expect(() => validateSpeechWav(new ArrayBuffer(0))).toThrow();
    const wav = encodeSpeechWav(new Float32Array(160));
    expect(() => validateSpeechWav(wav.slice(0, -1))).toThrow();
    new DataView(wav).setUint32(24, 48000, true);
    expect(() => validateSpeechWav(wav)).toThrow();
    expect(() => validateSpeechWav(encodeSpeechWav(new Float32Array(16000 * (MAX_SPEECH_SECONDS + 1))))).toThrow();
  });
});
