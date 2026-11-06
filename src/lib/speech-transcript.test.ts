import { describe, expect, it } from 'vitest';
import { normalizeSpeechTranscript } from './speech-transcript';

describe('speech transcript text', () => {
  it('defaults Chinese speech to simplified characters, preserving English and punctuation', async () => {
    expect(await normalizeSpeechTranscript(' 請幫我檢查服務器配置，然後告訴我檢查結果。Nacos v3.0 ', 'zh'))
      .toBe('请帮我检查服务器配置，然后告诉我检查结果。Nacos v3.0');
  });

  it('also simplifies Chinese in auto detection', async () => {
    expect(await normalizeSpeechTranscript('檔案已經上傳，請確認。', 'auto')).toBe('档案已经上传，请确认。');
  });

  it('leaves explicitly selected English unchanged', async () => {
    expect(await normalizeSpeechTranscript('  Check Nacos configuration.  ', 'en')).toBe('Check Nacos configuration.');
    expect(await normalizeSpeechTranscript('English label: 檔案', 'en')).toBe('English label: 檔案');
  });
});
