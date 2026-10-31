import { en } from './i18n/en.ts'

export function App() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="rounded-lg border border-line bg-surface px-7 py-5.5">
        <h1 className="font-display text-[26px] font-semibold">{en.appName}</h1>
        <p className="mt-1.5 text-ink-muted">{en.tagline}</p>
      </div>
    </main>
  )
}
