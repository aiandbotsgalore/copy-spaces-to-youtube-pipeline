import React, { Component } from 'react';
import { AlertCircle } from 'lucide-react';

interface OverlayErrorBoundaryProps {
  children: React.ReactNode;
  name?: string;
  compactFallback?: boolean;
}

interface OverlayErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class OverlayErrorBoundary extends Component<
  OverlayErrorBoundaryProps,
  OverlayErrorBoundaryState
> {
  constructor(props: OverlayErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): OverlayErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[OverlayErrorBoundary:${this.props.name || 'overlay'}]`, error, info);
  }

  render() {
    if (this.state.hasError) {
      if (!this.props.compactFallback) return null;
      return (
        <div className="p-2.5 rounded-xl bg-rose-950/50 border border-rose-500/30 text-[11px] text-rose-200 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 truncate">
            <AlertCircle size={12} className="text-rose-400 shrink-0" />
            <span className="truncate">{this.props.name || 'Widget'} failed to load</span>
          </span>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="text-[10px] font-semibold px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 shrink-0 cursor-pointer"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
