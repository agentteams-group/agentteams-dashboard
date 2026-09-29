'use client';

import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  sectionName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const CHUNK_HEAL_KEY = 'agentteams-chunk-heal';

/**
 * Lazy-section chunks are content-addressed per build, so after a redeploy an
 * already-open page requests .next chunks that the new container (or CDN
 * cache) no longer serves. One automatic reload picks up the fresh page and
 * its chunks; the sessionStorage guard caps self-heal at one attempt per
 * browser session so a genuinely broken deployment degrades to the error
 * card instead of an infinite refresh loop.
 */
function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false;
  return (
    error.name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module/i.test(error.message) ||
    /Loading (chunk|CSS chunk) \S+ failed/i.test(error.message) ||
    /error loading dynamically imported module/i.test(error.message)
  );
}

export class SectionErrorBoundary extends Component<Props, State> {
  private healScheduled = false;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error): void {
    if (this.healScheduled) return;
    if (typeof window === 'undefined') return;
    if (!isChunkLoadError(error)) return;
    if (window.sessionStorage.getItem(CHUNK_HEAL_KEY)) return;
    this.healScheduled = true;
    window.sessionStorage.setItem(CHUNK_HEAL_KEY, '1');
    window.setTimeout(() => window.location.reload(), 1500);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-16 px-4">
          <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
            <AlertTriangle className="w-7 h-7 text-amber-500" />
          </div>
          <p className="text-lg font-medium mb-1">该模块遇到了问题</p>
          <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
            {this.props.sectionName ? `"${this.props.sectionName}" ` : ''}渲染时发生错误
          </p>
          <p className="text-xs text-muted-foreground font-mono mb-4 max-w-md text-center break-all">
            {this.state.error?.message}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            <RefreshCw className="w-4 h-4 mr-1.5" />
            重试
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
