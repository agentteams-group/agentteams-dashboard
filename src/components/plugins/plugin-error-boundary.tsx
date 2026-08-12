'use client';

import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Error boundary isolating a single plugin contribution.
 * A throwing plugin renders this card instead of crashing the host view.
 */

interface Props {
  children: ReactNode;
  pluginId: string;
  pluginName?: string;
  /** Visual variant: 'block' for pages/widgets, 'inline' for compact spots. */
  variant?: 'block' | 'inline';
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class PluginErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error): void {
    console.error(`[plugins] 插件 ${this.props.pluginId} 渲染出错:`, error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const label = this.props.pluginName || this.props.pluginId;

    if (this.props.variant === 'inline') {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <AlertTriangle className="w-3 h-3" />
          插件「{label}」加载失败
        </span>
      );
    }

    return (
      <div
        className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex flex-col items-center gap-2"
        data-plugin-error={this.props.pluginId}
      >
        <AlertTriangle className="w-6 h-6 text-destructive" />
        <p className="text-sm font-medium">插件「{label}」渲染失败</p>
        <p className="text-xs text-muted-foreground font-mono break-all max-w-md text-center">
          {this.state.error?.message}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => this.setState({ hasError: false, error: null })}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1" />
          重试
        </Button>
      </div>
    );
  }
}
