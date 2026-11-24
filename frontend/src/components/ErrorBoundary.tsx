import { Component, type ErrorInfo, type ReactNode } from 'react';

import { reportError } from '../lib/reportError';

/**
 * If a page fails to draw, show a calm message with a way out instead of a blank screen, and report the
 * error (with the component where it happened) to the administrators' System issues page.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode; where?: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error.message, `${error.stack ?? ''}\n\nComponents:${info.componentStack ?? ''}`, this.props.where ?? '');
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="panel">
        <div className="blocked" role="alert">
          <span className="b-ico" aria-hidden="true">!</span>
          <h2>This page could not be shown</h2>
          <p>Something went wrong while drawing it. The administrators have been told. Reload the page, or go back to the overview; your saved data is not affected.</p>
          <div className="acts">
            <button type="button" className="btn pri" onClick={() => location.reload()}>Reload the page</button>
            <a className="btn" href="/">Go to the overview</a>
          </div>
        </div>
      </div>
    );
  }
}
