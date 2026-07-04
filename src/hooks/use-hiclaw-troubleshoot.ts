'use client';

import { useState, useCallback } from 'react';
import { hiclawApi } from '@/lib/hiclaw-api';
import type { TroubleshootRequest } from '@/lib/hiclaw-api';

export function useTroubleshoot() {
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const diagnose = useCallback(
    async (request: TroubleshootRequest) => {
      setLoading(true);
      setAnswer('');
      setError(null);
      try {
        const res = await hiclawApi.troubleshoot(request);
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          setAnswer(data.answer || '');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '诊断失败');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const reset = useCallback(() => {
    setAnswer('');
    setError(null);
    setLoading(false);
  }, []);

  return { answer, loading, error, diagnose, reset };
}
