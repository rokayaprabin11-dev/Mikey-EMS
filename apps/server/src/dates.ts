import type { AdDate } from '@mikey/shared'

// PostgreSQL `date` columns reach Prisma as a Date at midnight UTC.

export function fromDbDate(date: Date): AdDate {
  return date.toISOString().slice(0, 10)
}

export function toDbDate(ad: AdDate): Date {
  return new Date(`${ad}T00:00:00.000Z`)
}
