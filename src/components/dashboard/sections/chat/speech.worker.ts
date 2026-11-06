import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

let transcriber: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

self.onmessage = async (event: MessageEvent<{ audio: Float32Array; assetBase: string; language: 'zh' | 'en' | 'auto' }>) => {
  try {
    const { audio, assetBase, language } = event.data;
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = `${assetBase}/models/`;
    env.backends.onnx.wasm!.wasmPaths = `${assetBase}/wasm/`;
    // One thread works without COOP/COEP and keeps inference off the UI thread.
    env.backends.onnx.wasm!.numThreads = 1;
    transcriber ??= pipeline<'automatic-speech-recognition'>('automatic-speech-recognition', 'onnx-community/whisper-tiny', {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: progress => {
        if (progress.status === 'progress') self.postMessage({ type: 'progress', progress: Math.round(progress.progress) });
      },
    });
    const recognizer = await transcriber;
    self.postMessage({ type: 'recognizing' });
    const result = await recognizer(audio, {
      task: 'transcribe',
      language: language === 'zh' ? 'chinese' : language === 'en' ? 'english' : undefined,
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const text = (Array.isArray(result) ? result.map(part => part.text).join(' ') : result.text).trim();
    if (!text) throw new Error('未识别到语音，请重试');
    self.postMessage({ type: 'result', text });
  } catch (error) {
    console.error('Local speech recognition failed', error);
    transcriber = null;
    self.postMessage({ type: 'error', error: '本地语音识别失败，请重试或联系管理员检查语音资源' });
  }
};
