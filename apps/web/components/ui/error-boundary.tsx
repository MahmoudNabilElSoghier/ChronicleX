'use client';

import * as React from 'react';

interface ErrorBoundaryProps {
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * Catches render crashes (e.g. a malformed PDF killing the viewer) while
 * keeping siblings — like the metadata/audit tabs — fully functional.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary]', error, errorInfo);
    }
  }

  render(): React.ReactNode {
    if (this.state.failed) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
