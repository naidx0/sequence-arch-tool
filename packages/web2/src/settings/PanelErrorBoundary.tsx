import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';

/**
 * APP-01. A throw inside one Settings tab must not take the app with it.
 *
 * React unmounts the whole tree on an uncaught render error, so without this a
 * bad value in one panel blanks Settings (and, in the packaged app, was one of
 * the ways a window ended up dead). The boundary keeps the damage the size of
 * the panel and says so in one card: nothing was lost, and the reader has two
 * ways forward. Reload panel remounts the children from scratch; Copy details
 * puts the error text on the clipboard for a bug report.
 *
 * What this does NOT claim: a native renderer crash (the SIGBUS in main.log) is
 * not a JavaScript exception and never reaches a boundary. That is the main
 * process's job (rendererRecovery.ts). This is the other half of the mitigation.
 *
 * `resetKey` clears the card by itself when it changes, so moving to another
 * tab never leaves the previous tab's failure standing in front of a healthy
 * panel.
 */
interface Props {
  children: ReactNode;
  /** Changing this clears a shown failure (the tab id). */
  resetKey?: string;
  /** The card replaces a whole `.settings-scope` panel, so it must bring the scope's styling with it. */
  scoped?: boolean;
}

interface State {
  failure: { message: string; stack: string } | null;
  /** Bumped by Reload panel so the children remount rather than merely re-render. */
  attempt: number;
  seenKey: string | undefined;
}

export class PanelErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { failure: null, attempt: 0, seenKey: props.resetKey };
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    const e = error instanceof Error ? error : new Error(String(error));
    return { failure: { message: e.message, stack: e.stack ?? '' } };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.seenKey) return { seenKey: props.resetKey, failure: null };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[settings] a panel threw', error, info.componentStack);
  }

  private copy = (): void => {
    const f = this.state.failure;
    if (f === null) return;
    const text = `Settings panel error: ${f.message}\n${f.stack}`.trim();
    try {
      void navigator.clipboard?.writeText(text)?.catch(() => {});
    } catch {
      /* no clipboard (an insecure context, a denied permission): nothing to do, and nothing may throw from here */
    }
  };

  private reload = (): void => {
    this.setState((s) => ({ failure: null, attempt: s.attempt + 1 }));
  };

  render(): ReactNode {
    if (this.state.failure === null) {
      return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
    }
    const card = (
      <div className="sb-card" data-testid="panel-error" role="alert">
        <p className="sb-note">
          <strong>This panel hit a problem.</strong> Your settings are safe.
        </p>
        <div className="sb-acts">
          <button type="button" className="sb-pill sb-pill-solid" onClick={this.reload}>
            Reload panel
          </button>
          <button type="button" className="sb-pill" onClick={this.copy}>
            Copy details
          </button>
        </div>
      </div>
    );
    return this.props.scoped ? <div className="settings-scope">{card}</div> : card;
  }
}
