'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseCopyToClipboardOptions {
  resetMs?: number;
  onCopy?: (_text: string) => void;
}

/**
 * 写剪贴板，如实返回成没成。
 *
 * `navigator.clipboard` 只在安全上下文（https 或 localhost）里存在，而本产品的
 * 常见部署是公司内网的 http 地址：那种环境下 `navigator.clipboard` 是
 * undefined，原来那句 `await navigator.clipboard.writeText(...)` 直接抛
 * TypeError 被 catch 吞掉，于是「复制」按钮点了没有任何反应也看不出失败
 * （方案 v3 B-4）。所以留一条 textarea + execCommand 的兜底。
 */
async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒或页面失去焦点，落到下面的兜底。
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function useCopyToClipboard({ resetMs = 2000, onCopy }: UseCopyToClipboardOptions = {}) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const copy = useCallback(
    async (text: string) => {
      const ok = await writeClipboardText(text);
      if (!ok) {
        setCopied(false);
        return false;
      }
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), resetMs);
      onCopy?.(text);
      return true;
    },
    [resetMs, onCopy]
  );

  return { copied, copy };
}
