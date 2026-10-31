export type AmountProblem = 'empty' | 'format' | 'negative' | 'too_many_decimals' | 'too_large'

export class InvalidAmountError extends Error {
  readonly reason: AmountProblem

  constructor(reason: AmountProblem, input: string) {
    super(`"${input}" is not a valid amount in rupees (${reason}).`)
    this.name = 'InvalidAmountError'
    this.reason = reason
  }
}

const MAX_PAISA = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_PAISA = BigInt(Number.MIN_SAFE_INTEGER)

export function toPaisaNumber(value: bigint): number {
  if (value > MAX_PAISA || value < MIN_PAISA) {
    throw new RangeError(`${value} paisa is too large to handle as a number.`)
  }
  return Number(value)
}

const RUPEES_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/
const TOO_MANY_DECIMALS_PATTERN = /^\d+\.\d{3,}$/

export function parseRupees(input: string): number {
  const text = input.trim()
  if (text === '') {
    throw new InvalidAmountError('empty', input)
  }
  if (text.startsWith('-')) {
    throw new InvalidAmountError('negative', input)
  }

  const digits = text.replaceAll(',', '')
  const match = RUPEES_PATTERN.exec(digits)
  if (!match) {
    throw new InvalidAmountError(TOO_MANY_DECIMALS_PATTERN.test(digits) ? 'too_many_decimals' : 'format', input)
  }

  const [, rupees = '0', paisa = ''] = match
  const total = BigInt(rupees) * 100n + BigInt(paisa.padEnd(2, '0'))
  if (total > MAX_PAISA) {
    throw new InvalidAmountError('too_large', input)
  }
  return Number(total)
}

function splitPaisa(paisa: number): { rupees: number; paisa: number } {
  if (!Number.isSafeInteger(paisa) || paisa < 0) {
    throw new RangeError(`Cannot show ${paisa} paisa: amounts are whole paisa and never negative.`)
  }
  const remainder = paisa % 100
  return { rupees: (paisa - remainder) / 100, paisa: remainder }
}

function groupLakh(rupees: number): string {
  const digits = String(rupees)
  if (digits.length <= 3) {
    return digits
  }
  const leading = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')
  return `${leading},${digits.slice(-3)}`
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatRupees(paisa: number): string {
  const amount = splitPaisa(paisa)
  const rupees = `Rs. ${groupLakh(amount.rupees)}`
  return amount.paisa === 0 ? rupees : `${rupees}.${twoDigits(amount.paisa)}`
}

export function formatReceiptAmount(paisa: number): string {
  const amount = splitPaisa(paisa)
  return `${groupLakh(amount.rupees)}.${twoDigits(amount.paisa)}`
}

const UNITS = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function wordAt(list: string[], index: number): string {
  const word = list[index]
  if (word === undefined) {
    throw new RangeError(`No word for ${index}.`)
  }
  return word
}

function belowHundred(value: number): string {
  if (value < 20) {
    return wordAt(UNITS, value)
  }
  const ones = value % 10
  const tens = wordAt(TENS, (value - ones) / 10)
  return ones === 0 ? tens : `${tens} ${wordAt(UNITS, ones)}`
}

function belowThousand(value: number): string {
  const rest = value % 100
  const hundreds = (value - rest) / 100
  const parts = []
  if (hundreds > 0) {
    parts.push(`${wordAt(UNITS, hundreds)} Hundred`)
  }
  if (rest > 0) {
    parts.push(belowHundred(rest))
  }
  return parts.join(' ')
}

function inIndianWords(value: number): string {
  const crore = Math.floor(value / 10_000_000)
  const lakh = Math.floor((value % 10_000_000) / 100_000)
  const thousand = Math.floor((value % 100_000) / 1_000)
  const rest = value % 1_000
  const parts = []
  if (crore > 0) {
    parts.push(`${inIndianWords(crore)} Crore`)
  }
  if (lakh > 0) {
    parts.push(`${belowHundred(lakh)} Lakh`)
  }
  if (thousand > 0) {
    parts.push(`${belowHundred(thousand)} Thousand`)
  }
  if (rest > 0) {
    parts.push(belowThousand(rest))
  }
  return parts.join(' ')
}

export function amountInWords(paisa: number): string {
  const amount = splitPaisa(paisa)
  const rupees = amount.rupees === 0 ? 'Zero' : inIndianWords(amount.rupees)
  const paisaPart = amount.paisa === 0 ? '' : ` and ${belowHundred(amount.paisa)} Paisa`
  return `Rupees ${rupees}${paisaPart} Only`
}
