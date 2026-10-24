import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Short name of the area, used in the message. */
  area?: string
}
interface State {
  error: Error | null
}

/** Keeps a rendering bug in one view from blanking the whole window; edits already saved are unaffected. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="grid h-full place-items-center p-6">
        <div className="max-w-sm rounded-2xl border border-line-strong bg-surface p-5 text-text shadow-lg">
          <h2 className="text-base font-semibold">This {this.props.area ?? 'view'} stopped working</h2>
          <p className="mt-2 text-sm text-soft">
            Your notes are safe: everything you typed was saved before this happened. Reload to continue.
          </p>
          <pre className="mt-3 max-h-24 overflow-auto rounded-lg bg-surface-3 p-2 text-xs text-faint">{this.state.error.message}</pre>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
