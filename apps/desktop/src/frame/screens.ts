import { en } from '../i18n/en.ts'

export type Screen = keyof typeof en.frame.screens

// The Phase 6 step that builds each screen not built yet (DECISIONS D26).
export const BUILT_IN: Partial<Record<Screen, string>> = {
  collectFee: '6a',
  payments: '6b',
  incomeExpenses: '6c',
  cashBank: '6c',
  reports: '6f',
  students: '6f',
  attendance: '6f',
}
