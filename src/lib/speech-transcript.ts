let toSimplified: ((_text: string) => string) | undefined;

export async function normalizeSpeechTranscript(text: string, language: 'zh' | 'en' | 'auto'): Promise<string> {
  const trimmed = text.trim();
  if (language === 'en') return trimmed;
  const { Converter } = await import('opencc-js/t2cn');
  toSimplified ??= Converter({ from: 't', to: 'cn' });
  return toSimplified(trimmed);
}
