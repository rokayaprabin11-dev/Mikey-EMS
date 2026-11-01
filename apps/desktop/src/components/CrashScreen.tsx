import { Component, type ReactNode } from 'react'

import { en } from '../i18n/en.ts'
import { CopyDetailsButton } from './CopyDetailsButton.tsx'

interface State {
  crashed: boolean
  error: unknown
}

function describe(error: unknown): string {
  return error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error)
}

// The renderer's last resort: an error no screen handles, whether thrown while drawing or left
// unhandled in a promise, replaces the window's content with a plain message and its details.
export class CrashScreen extends Component<{ children: ReactNode }, State> {
  override state: State = { crashed: false, error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { crashed: true, error }
  }

  private readonly onUnhandled = (event: PromiseRejectionEvent | ErrorEvent): void => {
    this.setState({ crashed: true, error: 'reason' in event ? event.reason : event.error })
  }

  override componentDidMount(): void {
    window.addEventListener('unhandledrejection', this.onUnhandled)
    window.addEventListener('error', this.onUnhandled)
  }

  override componentWillUnmount(): void {
    window.removeEventListener('unhandledrejection', this.onUnhandled)
    window.removeEventListener('error', this.onUnhandled)
  }

  override render(): ReactNode {
    const { crashed, error } = this.state
    if (!crashed) {
      return this.props.children
    }
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper p-6 text-ink">
        <div role="alert" className="flex max-w-120 flex-col gap-2 rounded-lg border border-line bg-surface px-5 py-4.5">
          <strong className="text-[15px] text-bad">{en.crash.title}</strong>
          <p className="text-[13px] leading-normal text-ink-soft">{en.crash.help}</p>
          <CopyDetailsButton className="mt-1 h-9 self-start text-[13px]" details={() => describe(error)} />
        </div>
      </main>
    )
  }
}
