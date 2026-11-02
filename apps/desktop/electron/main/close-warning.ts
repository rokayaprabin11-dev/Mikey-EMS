import type { CloseWarning } from '../bridge.ts'

// The answer to "Close anyway?": the button chosen, 0 being Stay.
export type Ask = (warning: CloseWarning) => number

export const STAY = 0
export const CLOSE = 1

// Whether the app window may close: always without a warning; with one, only when the person
// chooses Close anyway. Stay is the default, so Enter or Esc keeps the window open.
export function mayClose(warning: CloseWarning | null, ask: Ask): boolean {
  return warning === null || ask(warning) === CLOSE
}
