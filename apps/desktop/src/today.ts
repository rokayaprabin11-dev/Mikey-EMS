import { type AdDate, kathmanduClock } from '@mikey/shared'

import { en } from './i18n/en.ts'

// The screens show today on Computer 1's clock (the `time` of its /health reply), which dates
// every record, rather than this computer's.

export function weekdayOf(ad: AdDate): string {
  return en.weekdays[new Date(`${ad}T00:00:00Z`).getUTCDay()] ?? ''
}

// The hour in Kathmandu, 0 to 23.
export function kathmanduHour(instant: Date): number {
  return Number(kathmanduClock(instant).slice(0, 2))
}
