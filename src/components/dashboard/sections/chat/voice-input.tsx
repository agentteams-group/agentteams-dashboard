'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Mic, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { apiUrl } from '@/lib/api-base';
import { decodeSpeechRecording, encodeSpeechWav, MAX_SPEECH_SECONDS } from '@/lib/speech-audio';

type Phase = 'idle' | 'requesting' | 'recording' | 'transcribing';

interface VoiceInputProps {
  disabled: boolean;
  onTranscript: (_text: string) => void;
  onBusyChange: (_busy: boolean) => void;
}

export function VoiceInput({ disabled, onTranscript, onBusyChange }: VoiceInputProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [provider, setProvider] = useState<'local' | 'dashscope'>('local');
  const [language, setLanguage] = useState<'zh' | 'en' | 'auto'>('zh');
  const [dashscopeAvailable, setDashscopeAvailable] = useState(false);
  const generation = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const worker = useRef<Worker | null>(null);
  const request = useRef<AbortController | null>(null);

  const releaseMicrophone = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
  }, []);

  const dispose = useCallback(() => {
    generation.current++;
    if (recorder.current) {
      recorder.current.onstop = null;
      if (recorder.current.state !== 'inactive') recorder.current.stop();
      recorder.current = null;
    }
    releaseMicrophone();
    worker.current?.terminate();
    worker.current = null;
    request.current?.abort();
    request.current = null;
  }, [releaseMicrophone]);

  useEffect(() => () => {
    dispose();
    onBusyChange(false);
  }, [dispose, onBusyChange]);

  useEffect(() => {
    if (!settingsOpen) return;
    const controller = new AbortController();
    fetch(apiUrl('/api/agentteams/speech'), { signal: controller.signal, cache: 'no-store' })
      .then(async response => response.ok ? response.json() : null)
      .then(config => { if (!controller.signal.aborted) setDashscopeAvailable(config?.dashscopeAvailable === true); })
      .catch(() => { if (!controller.signal.aborted) setDashscopeAvailable(false); });
    return () => controller.abort();
  }, [settingsOpen]);

  const cancel = () => {
    dispose();
    setPhase('idle');
    setError(null);
    onBusyChange(false);
  };

  const finishRecording = () => {
    setPhase('transcribing');
    setProgress('正在处理录音…');
    recorder.current?.stop();
    releaseMicrophone();
  };

  const start = async () => {
    if (phase !== 'idle' || disabled) return;
    setError(null);
    if (!globalThis.isSecureContext) {
      setError('语音输入需要 HTTPS 或 localhost，请使用安全地址打开 Dashboard');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('当前浏览器不支持录音，请使用新版 Chrome、Edge 或 Safari');
      return;
    }
    const current = ++generation.current;
    setPhase('requesting');
    setSettingsOpen(false);
    onBusyChange(true);

    const fail = (message: string) => {
      if (current !== generation.current) return;
      dispose();
      setPhase('idle');
      setError(message);
      onBusyChange(false);
    };
    const accept = (text: string) => {
      if (current !== generation.current) return;
      if (!text.trim()) { fail('未识别到语音，请重试'); return; }
      onTranscript(text.trim());
      setPhase('idle');
      onBusyChange(false);
    };

    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current !== generation.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      const capture = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = capture;
      const chunks: Blob[] = [];
      capture.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      capture.onerror = () => fail('麦克风录音中断，请重试');
      capture.onstop = async () => {
        releaseMicrophone();
        if (current !== generation.current) return;
        setPhase('transcribing');
        try {
          const audio = await decodeSpeechRecording(new Blob(chunks, { type: capture.mimeType }));
          if (current !== generation.current) return;
          if (provider === 'dashscope') {
            setProgress('百炼正在识别…');
            const controller = new AbortController();
            request.current = controller;
            const timeout = setTimeout(() => controller.abort(), 65000);
            try {
              const response = await fetch(apiUrl(`/api/agentteams/speech?language=${language}`), {
                method: 'POST', headers: { 'Content-Type': 'audio/wav' },
                body: encodeSpeechWav(audio), signal: controller.signal,
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error || '语音识别失败，请重试');
              accept(result.text);
            } finally {
              clearTimeout(timeout);
            }
          } else {
            setProgress('正在加载本地语音模型，首次使用需要稍等…');
            worker.current ??= new Worker(new URL('./speech.worker.ts', import.meta.url), { type: 'module' });
            worker.current.onmessage = event => {
              if (current !== generation.current) return;
              const result = event.data;
              if (result.type === 'progress') setProgress(`正在加载本地语音模型 ${result.progress}%`);
              if (result.type === 'recognizing') setProgress('正在本地识别…');
              if (result.type === 'result') accept(result.text);
              if (result.type === 'error') fail(result.error);
            };
            worker.current.onerror = () => fail('本地语音识别无法启动，请重试');
            const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
            worker.current.postMessage({ audio, language, assetBase: new URL(`${basePath}/speech/ff41770`, window.location.origin).href }, [audio.buffer]);
          }
        } catch (cause) {
          fail(cause instanceof Error && cause.name !== 'AbortError' ? cause.message : '语音识别超时，请重试');
        }
      };
      capture.start();
      setSeconds(0);
      setPhase('recording');
      const started = Date.now();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(Math.min(elapsed, MAX_SPEECH_SECONDS));
        if (elapsed >= MAX_SPEECH_SECONDS && capture.state === 'recording') finishRecording();
      }, 250);
    } catch (cause) {
      fail(cause instanceof DOMException && cause.name === 'NotAllowedError'
        ? '麦克风权限未开启，请允许录音后重试'
        : '无法打开麦克风，请检查设备后重试');
    }
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {phase === 'idle' ? (
        <>
          <Button variant="ghost" size="sm" className="h-7 w-7 shrink-0 p-0 text-muted-foreground"
            onClick={start} disabled={disabled} aria-label="开始语音输入" title={`语音输入（${provider === 'local' ? '本地免费' : '百炼付费'}）`}>
            <Mic className="h-4 w-4" />
          </Button>
          <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-5 shrink-0 p-0" disabled={disabled} aria-label="语音设置">
                <ChevronDown className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="space-y-2 text-xs">
              <label className="block space-y-1">
                <span>语音识别方式</span>
                <select aria-label="语音识别方式" value={provider} onChange={event => setProvider(event.target.value as 'local' | 'dashscope')}
                  className="w-full rounded-md border bg-background p-2 text-sm">
                  <option value="local">本地免费（音频不上传）</option>
                  <option value="dashscope" disabled={!dashscopeAvailable}>百炼（按量付费）</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span>识别语言</span>
                <select aria-label="识别语言" value={language} onChange={event => setLanguage(event.target.value as 'zh' | 'en' | 'auto')}
                  className="w-full rounded-md border bg-background p-2 text-sm">
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                  <option value="auto">自动识别</option>
                </select>
              </label>
              <p className="text-muted-foreground">本地模型首次使用需要加载，之后会缓存。每次最多录制 60 秒，转写后可编辑再发送。</p>
              {!dashscopeAvailable && <p className="text-muted-foreground">百炼需管理员在服务端配置语音 API Key 后启用。</p>}
              {provider === 'dashscope' && <p className="text-muted-foreground">录音将发送至百炼，按管理员配置的服务计费。</p>}
            </PopoverContent>
          </Popover>
        </>
      ) : (
        <>
          {phase === 'recording' ? (
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-1.5 text-red-600" onClick={finishRecording} aria-label="完成录音">
              <Square className="h-3 w-3 fill-current" /> {seconds}s · 完成
            </Button>
          ) : <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
          <span role="status" className="max-w-36 truncate text-xs text-muted-foreground" title={progress}>
            {phase === 'requesting' ? '等待麦克风权限…' : phase === 'recording' ? `${provider === 'local' ? '本地免费' : '百炼付费'} · 录音中` : progress}
          </span>
          <Button variant="ghost" size="sm" className="h-7 w-7 shrink-0 p-0" onClick={cancel} aria-label="取消语音输入" title="取消语音输入">
            <X className="h-4 w-4" />
          </Button>
        </>
      )}
      {error && <span role="alert" className="max-w-60 text-xs text-destructive">{error}</span>}
    </div>
  );
}
