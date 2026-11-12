import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { LogoMark } from '@/components/ui/LogoMark';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Cadence encountered an unrecoverable error.', error, info);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
        <LogoMark className="size-12" />
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em]">Something went sideways.</h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-secondary">
            Your books and audio are safe on this device. Reloading usually clears a transient
            startup problem.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={() => window.location.reload()}>Reload Cadence</Button>
          <Button variant="outline" onClick={this.reset}>
            Try again
          </Button>
        </div>
        {import.meta.env.DEV ? (
          <pre className="max-w-xl overflow-auto rounded-card border border-hairline bg-surface-muted p-4 text-left text-[11px] text-ink-secondary">
            {this.state.error.stack ?? this.state.error.message}
          </pre>
        ) : null}
      </div>
    );
  }
}
