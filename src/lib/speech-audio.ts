export const SPEECH_SAMPLE_RATE = 16000;
export const MAX_SPEECH_SECONDS = 60;
export const MAX_SPEECH_BYTES = 44 + SPEECH_SAMPLE_RATE * 2 * MAX_SPEECH_SECONDS;

/** The browser and paid API exchange a fixed 16 kHz, mono, 16-bit PCM WAV. */
export function encodeSpeechWav(audio: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + audio.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  write(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SPEECH_SAMPLE_RATE, true);
  view.setUint32(28, SPEECH_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, audio.length * 2, true);
  for (let i = 0; i < audio.length; i++) {
    const sample = Math.max(-1, Math.min(1, audio[i]));
    view.setInt16(44 + i * 2, sample * (sample < 0 ? 32768 : 32767), true);
  }
  return buffer;
}

export function validateSpeechWav(buffer: ArrayBuffer): number {
  if (buffer.byteLength <= 44 || buffer.byteLength > MAX_SPEECH_BYTES) throw new Error('录音为空或超过 60 秒');
  const view = new DataView(buffer);
  const text = (offset: number, length: number) => String.fromCharCode(...new Uint8Array(buffer, offset, length));
  if (text(0, 4) !== 'RIFF' || text(8, 8) !== 'WAVEfmt ' || text(36, 4) !== 'data'
    || view.getUint32(4, true) !== buffer.byteLength - 8 || view.getUint32(16, true) !== 16
    || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1
    || view.getUint32(24, true) !== SPEECH_SAMPLE_RATE || view.getUint32(28, true) !== SPEECH_SAMPLE_RATE * 2
    || view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16
    || view.getUint32(40, true) !== buffer.byteLength - 44 || (buffer.byteLength - 44) % 2 !== 0) {
    throw new Error('录音格式必须为 16 kHz 单声道 PCM WAV');
  }
  return (buffer.byteLength - 44) / (SPEECH_SAMPLE_RATE * 2);
}

export async function decodeSpeechRecording(blob: Blob): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, 1, SPEECH_SAMPLE_RATE);
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  const length = Math.min(decoded.length, SPEECH_SAMPLE_RATE * MAX_SPEECH_SECONDS);
  const audio = new Float32Array(length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const samples = decoded.getChannelData(channel);
    for (let i = 0; i < length; i++) audio[i] += samples[i] / decoded.numberOfChannels;
  }
  if (!audio.some(sample => Math.abs(sample) > 0.001)) throw new Error('未检测到语音，请靠近麦克风后重试');
  return audio;
}
