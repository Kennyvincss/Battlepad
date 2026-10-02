import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; name?: string; page?: boolean }
interface State { error: Error | null }

/**
 * Keeps one broken part of the UI from blanking the whole site. A crash shows a
 * small card with the error text (so it can be reported) and a retry button.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[BATTLE] ${this.props.name ?? 'view'} crashed:`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={`panel panel-pad crash ${this.props.page ? 'crash-page' : ''}`} role="alert">
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 22 }}>⚠️</span>
          <div className="grow">
            <b>{this.props.page ? 'This page hit a problem.' : `${this.props.name ?? 'This section'} couldn't load.`}</b>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>The rest of the site still works. Try again, or reload if it keeps happening.</div>
            <div className="crash-msg mono">{error.message || String(error)}</div>
          </div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn btn-sm btn-primary" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="btn btn-sm" onClick={() => location.reload()}>Reload page</button>
        </div>
      </div>
    );
  }
}

/** Shorthand for wrapping one panel. */
export const Safe = ({ name, children }: { name: string; children: ReactNode }) => <ErrorBoundary name={name}>{children}</ErrorBoundary>;
