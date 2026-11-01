import NepaliDate, { dateConfigMap } from 'nepali-date-converter'

export interface BsDate {
  year: number
  month: number
  day: number
}

/** An AD calendar date written as YYYY-MM-DD, the form the database and the API use. */
export type AdDate = string

export type DateProblem = 'format' | 'no_such_day' | 'out_of_range'

export class InvalidDateError extends Error {
  readonly reason: DateProblem

  constructor(reason: DateProblem, message: string) {
    super(message)
    this.name = 'InvalidDateError'
    this.reason = reason
  }
}

export const BS_MONTH_NAMES = [
  'Baishakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Ashwin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
] as const

const TABLE_MONTH_KEYS = [
  'Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Aswin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
] as const

const AD_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

const SHRAWAN = 4

const tableYears = Object.keys(dateConfigMap).map(Number)
export const FIRST_BS_YEAR = Math.min(...tableYears)
export const LAST_BS_YEAR = Math.max(...tableYears)

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

function toAdDate(year: number, month: number, day: number): AdDate {
  return `${year}-${twoDigits(month)}-${twoDigits(day)}`
}

export function daysInBsMonth(year: number, month: number): number {
  const yearTable = dateConfigMap[String(year)]
  if (yearTable === undefined) {
    throw new InvalidDateError(
      'out_of_range',
      `BS ${year} is outside the calendar table, which covers ${FIRST_BS_YEAR} to ${LAST_BS_YEAR}.`,
    )
  }
  const key = TABLE_MONTH_KEYS[month - 1]
  if (key === undefined) {
    throw new InvalidDateError('no_such_day', `There is no BS month ${month}.`)
  }
  return yearTable[key]
}

function checkBsDate(date: BsDate): void {
  const { year, month, day } = date
  if (![year, month, day].every(Number.isInteger)) {
    throw new InvalidDateError('no_such_day', `${year}-${month}-${day} is not a BS date.`)
  }
  if (year < FIRST_BS_YEAR || year > LAST_BS_YEAR) {
    throw new InvalidDateError(
      'out_of_range',
      `BS ${year} is outside the calendar table, which covers ${FIRST_BS_YEAR} to ${LAST_BS_YEAR}.`,
    )
  }
  if (month < 1 || month > 12 || day < 1 || day > daysInBsMonth(year, month)) {
    throw new InvalidDateError('no_such_day', `BS ${formatBsDate(date)} does not exist.`)
  }
}

const BS_DATE_PATTERN = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})$/

export function parseBsDate(text: string): BsDate {
  const match = BS_DATE_PATTERN.exec(text.trim())
  if (!match) {
    throw new InvalidDateError('format', `"${text}" is not a BS date like 2083-07-12.`)
  }
  const date = { year: Number(match[1]), month: Number(match[3]), day: Number(match[4]) }
  checkBsDate(date)
  return date
}

const AD_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function readAdDate(ad: AdDate): { year: number; month: number; day: number } {
  const match = AD_DATE_PATTERN.exec(ad)
  if (!match) {
    throw new InvalidDateError('format', `"${ad}" is not an AD date like 2026-10-29.`)
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new InvalidDateError('no_such_day', `AD ${ad} does not exist.`)
  }
  return { year, month, day }
}

function tableAdRange(): { first: AdDate; last: AdDate } {
  const first = new NepaliDate(FIRST_BS_YEAR, 0, 1).getAD()
  const last = new NepaliDate(LAST_BS_YEAR, 11, daysInBsMonth(LAST_BS_YEAR, 12)).getAD()
  return {
    first: toAdDate(first.year, first.month + 1, first.date),
    last: toAdDate(last.year, last.month + 1, last.date),
  }
}

const TABLE_AD_RANGE = tableAdRange()

export function adToBs(ad: AdDate): BsDate {
  const { year, month, day } = readAdDate(ad)
  if (ad < TABLE_AD_RANGE.first || ad > TABLE_AD_RANGE.last) {
    throw new InvalidDateError(
      'out_of_range',
      `AD ${ad} is outside the calendar table (${TABLE_AD_RANGE.first} to ${TABLE_AD_RANGE.last}).`,
    )
  }
  // The library reads a Date's local calendar fields, so build the Date from local fields too.
  const bs = new NepaliDate(new Date(year, month - 1, day)).getBS()
  return { year: bs.year, month: bs.month + 1, day: bs.date }
}

export function bsToAd(bs: BsDate): AdDate {
  checkBsDate(bs)
  const ad = new NepaliDate(bs.year, bs.month - 1, bs.day).getAD()
  return toAdDate(ad.year, ad.month + 1, ad.date)
}

export function bsMonthToAdRange(year: number, month: number): { from: AdDate; to: AdDate } {
  return {
    from: bsToAd({ year, month, day: 1 }),
    to: bsToAd({ year, month, day: daysInBsMonth(year, month) }),
  }
}

export function fiscalYearOf(bs: BsDate): string {
  const startYear = bs.month >= SHRAWAN ? bs.year : bs.year - 1
  return `${startYear}/${twoDigits((startYear + 1) % 100)}`
}

export function bsMonthName(month: number): string {
  const name = BS_MONTH_NAMES[month - 1]
  if (name === undefined) {
    throw new InvalidDateError('no_such_day', `There is no BS month ${month}.`)
  }
  return name
}

export function formatBsDate(bs: BsDate): string {
  return `${bs.year}-${twoDigits(bs.month)}-${twoDigits(bs.day)}`
}

export function formatBsDateLong(bs: BsDate): string {
  return `${bs.day} ${bsMonthName(bs.month)} ${bs.year}`
}

export function formatAdDate(ad: AdDate): string {
  const { year, month, day } = readAdDate(ad)
  return `${day} ${AD_MONTH_NAMES[month - 1] ?? ''} ${year}`
}

export function formatBsWithAd(ad: AdDate): string {
  return `${formatBsDateLong(adToBs(ad))} (${formatAdDate(ad)})`
}

// Nepal has used UTC+05:45 all year, with no daylight saving, since 1986.
const KATHMANDU_OFFSET_MS = (5 * 60 + 45) * 60 * 1000

export function kathmanduDate(instant: Date): AdDate {
  const local = new Date(instant.getTime() + KATHMANDU_OFFSET_MS)
  return toAdDate(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate())
}

/** Kathmandu wall-clock time on the 24-hour clock, for example `16:05`, as settings store times. */
export function kathmanduClock(instant: Date): string {
  const local = new Date(instant.getTime() + KATHMANDU_OFFSET_MS)
  return `${twoDigits(local.getUTCHours())}:${twoDigits(local.getUTCMinutes())}`
}

/** Kathmandu wall-clock time, for example `10:58 AM`. */
export function formatKathmanduTime(instant: Date): string {
  const local = new Date(instant.getTime() + KATHMANDU_OFFSET_MS)
  const hours = local.getUTCHours()
  const hour = hours % 12 === 0 ? 12 : hours % 12
  return `${hour}:${twoDigits(local.getUTCMinutes())} ${hours < 12 ? 'AM' : 'PM'}`
}
