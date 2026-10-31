import { describe, expect, it } from 'vitest'

import {
  adToBs,
  bsMonthToAdRange,
  bsToAd,
  daysInBsMonth,
  fiscalYearOf,
  formatAdDate,
  formatBsDate,
  formatBsDateLong,
  formatBsWithAd,
  InvalidDateError,
  kathmanduDate,
  parseBsDate,
} from '../src/date.ts'

const KNOWN_PAIRS = [
  ['2026-04-14', { year: 2083, month: 1, day: 1 }],
  ['2026-07-16', { year: 2083, month: 3, day: 32 }],
  ['2026-07-17', { year: 2083, month: 4, day: 1 }],
  ['2026-10-29', { year: 2083, month: 7, day: 12 }],
  ['2026-10-31', { year: 2083, month: 7, day: 14 }],
] as const

function rejection(action: () => unknown): string {
  try {
    action()
    return 'accepted'
  } catch (error) {
    return error instanceof InvalidDateError ? error.reason : 'wrong error type'
  }
}

describe('AD to BS and back', () => {
  it.each(KNOWN_PAIRS)('%s AD is BS %o', (ad, bs) => {
    expect(adToBs(ad)).toEqual(bs)
  })

  it.each(KNOWN_PAIRS)('%s AD comes back from BS %o', (ad, bs) => {
    expect(bsToAd(bs)).toBe(ad)
  })

  it('gives the same answer whatever time zone the computer is set to', () => {
    const original = process.env.TZ
    try {
      for (const zone of ['America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Kathmandu']) {
        process.env.TZ = zone
        for (const [ad, bs] of KNOWN_PAIRS) {
          expect(adToBs(ad)).toEqual(bs)
          expect(bsToAd(bs)).toBe(ad)
        }
      }
    } finally {
      if (original === undefined) {
        delete process.env.TZ
      } else {
        process.env.TZ = original
      }
    }
  })

  it('refuses a BS day the month does not have instead of rolling into the next month', () => {
    expect(rejection(() => bsToAd({ year: 2083, month: 4, day: 32 }))).toBe('no_such_day')
  })

  it('refuses dates outside the lookup table', () => {
    expect(rejection(() => adToBs('1940-01-01'))).toBe('out_of_range')
    expect(rejection(() => bsToAd({ year: 2091, month: 1, day: 1 }))).toBe('out_of_range')
  })

  it('refuses AD dates that do not exist or are badly written', () => {
    expect(rejection(() => adToBs('2026-02-30'))).toBe('no_such_day')
    expect(rejection(() => adToBs('2026-1-5'))).toBe('format')
  })
})

describe('parseBsDate', () => {
  it.each([
    ['2083-03-32', { year: 2083, month: 3, day: 32 }],
    ['2083/07/12', { year: 2083, month: 7, day: 12 }],
    ['2083-7-5', { year: 2083, month: 7, day: 5 }],
    [' 2083-07-12 ', { year: 2083, month: 7, day: 12 }],
  ])('reads %j', (text, date) => {
    expect(parseBsDate(text)).toEqual(date)
  })

  it.each([
    ['2083-04-32', 'no_such_day'],
    ['2083-07-31', 'no_such_day'],
    ['2083-13-01', 'no_such_day'],
    ['2083-00-10', 'no_such_day'],
    ['2091-01-01', 'out_of_range'],
    ['1999-12-30', 'out_of_range'],
    ['2083-07/12', 'format'],
    ['2083-07', 'format'],
    ['20830712', 'format'],
    ['', 'format'],
  ])('rejects %j because of %s', (text, reason) => {
    expect(rejection(() => parseBsDate(text))).toBe(reason)
  })
})

describe('daysInBsMonth', () => {
  it('reads month lengths from the lookup table', () => {
    expect(daysInBsMonth(2083, 3)).toBe(32)
    expect(daysInBsMonth(2083, 7)).toBe(30)
    expect(daysInBsMonth(2083, 8)).toBe(29)
  })
})

describe('bsMonthToAdRange', () => {
  it('gives the first and last AD dates of a BS month', () => {
    expect(bsMonthToAdRange(2083, 7)).toEqual({ from: '2026-10-18', to: '2026-11-16' })
    expect(bsMonthToAdRange(2083, 3)).toEqual({ from: '2026-06-15', to: '2026-07-16' })
  })
})

describe('fiscalYearOf', () => {
  it.each([
    [{ year: 2083, month: 1, day: 1 }, '2082/83'],
    [{ year: 2083, month: 3, day: 32 }, '2082/83'],
    [{ year: 2083, month: 4, day: 1 }, '2083/84'],
    [{ year: 2083, month: 12, day: 30 }, '2083/84'],
    [{ year: 2099, month: 4, day: 1 }, '2099/00'],
  ])('puts BS %o in fiscal year %s', (date, fiscalYear) => {
    expect(fiscalYearOf(date)).toBe(fiscalYear)
  })
})

describe('formatting', () => {
  it('writes BS dates for tables and inputs', () => {
    expect(formatBsDate({ year: 2083, month: 7, day: 5 })).toBe('2083-07-05')
  })

  it('writes BS dates for headers, receipts and reports', () => {
    expect(formatBsDateLong({ year: 2083, month: 7, day: 12 })).toBe('12 Kartik 2083')
    expect(formatAdDate('2026-10-29')).toBe('29 Oct 2026')
    expect(formatAdDate('2026-11-01')).toBe('1 Nov 2026')
    expect(formatBsWithAd('2026-10-29')).toBe('12 Kartik 2083 (29 Oct 2026)')
  })
})

describe('kathmanduDate', () => {
  it('starts the business day at midnight in Kathmandu (UTC+05:45)', () => {
    expect(kathmanduDate(new Date('2026-10-30T18:14:59.999Z'))).toBe('2026-10-30')
    expect(kathmanduDate(new Date('2026-10-30T18:15:00.000Z'))).toBe('2026-10-31')
  })
})
