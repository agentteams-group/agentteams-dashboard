import { useCallback, useRef, type KeyboardEvent } from 'react';

export function useImeGuard() {
  const composing = useRef(false);
  const endedAt = useRef(-Infinity);
  const onCompositionStart = useCallback(() => {
    composing.current = true;
  }, []);
  const onCompositionEnd = useCallback(() => {
    composing.current = false;
    endedAt.current = Date.now();
  }, []);
  const isImeKey = useCallback((event: KeyboardEvent) => {
    // Some IMEs end composition before the confirming Enter keydown,
    // with neither isComposing nor keyCode 229 set on that event.
    return composing.current || event.nativeEvent.isComposing
      || event.nativeEvent.keyCode === 229
      || (event.key === 'Enter' && Date.now() - endedAt.current < 100);
  }, []);
  return { onCompositionStart, onCompositionEnd, isImeKey };
}
