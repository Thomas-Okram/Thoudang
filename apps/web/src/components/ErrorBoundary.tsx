import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Never show a blank screen in a live demo: catch render errors and offer a reload. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[thoudang] render error', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-8">
        <div className="max-w-md rounded-panel bg-white p-8 text-center shadow-raised">
          <h1 className="text-xl font-bold text-navy-900">Something went wrong on this screen</h1>
          <p className="mt-2 text-slate-600">
            Your data is safe — cases are stored on this computer.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 rounded-lg bg-teal-deep px-5 py-2.5 font-semibold text-white hover:bg-teal-darker"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
