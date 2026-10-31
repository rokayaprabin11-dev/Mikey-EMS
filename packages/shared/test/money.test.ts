import { describe, expect, it } from 'vitest'

import {
  amountInWords,
  formatReceiptAmount,
  formatRupees,
  InvalidAmountError,
  parseRupees,
  toPaisaNumber,
} from '../src/money.ts'

describe('toPaisaNumber', () => {
  it('turns a database bigint into a number', () => {
    expect(toPaisaNumber(390_000n)).toBe(390_000)
    expect(toPaisaNumber(-100n)).toBe(-100)
    expect(toPaisaNumber(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('refuses values a number cannot hold exactly', () => {
    expect(() => toPaisaNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError)
    expect(() => toPaisaNumber(BigInt(Number.MIN_SAFE_INTEGER) - 1n)).toThrow(RangeError)
  })
})

describe('parseRupees', () => {
  it.each([
    ['3900', 390_000],
    ['3,900', 390_000],
    ['3900.50', 390_050],
    ['3,900.5', 390_050],
    ['12,34,567', 123_456_700],
    ['1,234,567', 123_456_700],
    ['0', 0],
    ['  3900  ', 390_000],
    ['90071992547409.91', Number.MAX_SAFE_INTEGER],
  ])('reads %j as %d paisa', (input, paisa) => {
    expect(parseRupees(input)).toBe(paisa)
  })

  function rejection(input: string): string {
    try {
      parseRupees(input)
      return 'accepted'
    } catch (error) {
      return error instanceof InvalidAmountError ? error.reason : 'wrong error type'
    }
  }

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['-100', 'negative'],
    ['-0.50', 'negative'],
    ['3900.505', 'too_many_decimals'],
    ['abc', 'format'],
    ['3,900.', 'format'],
    ['.5', 'format'],
    ['Rs. 3900', 'format'],
    ['3900.5.0', 'format'],
    ['1e5', 'format'],
    ['90071992547409.92', 'too_large'],
  ])('rejects %j because of %s', (input, reason) => {
    expect(rejection(input)).toBe(reason)
  })
})

describe('formatRupees', () => {
  it.each([
    [0, 'Rs. 0'],
    [500, 'Rs. 5'],
    [99_900, 'Rs. 999'],
    [100_000, 'Rs. 1,000'],
    [390_000, 'Rs. 3,900'],
    [390_050, 'Rs. 3,900.50'],
    [390_005, 'Rs. 3,900.05'],
    [10_000_000, 'Rs. 1,00,000'],
    [123_456_700, 'Rs. 12,34,567'],
    [1_000_000_000, 'Rs. 1,00,00,000'],
  ])('shows %d paisa as %j', (paisa, text) => {
    expect(formatRupees(paisa)).toBe(text)
  })

  it('refuses negative and fractional paisa', () => {
    expect(() => formatRupees(-100)).toThrow(RangeError)
    expect(() => formatRupees(1.5)).toThrow(RangeError)
  })
})

describe('formatReceiptAmount', () => {
  it.each([
    [0, '0.00'],
    [390_000, '3,900.00'],
    [546_000, '5,460.00'],
    [123_456_789, '12,34,567.89'],
  ])('always shows two decimals: %d paisa is %j', (paisa, text) => {
    expect(formatReceiptAmount(paisa)).toBe(text)
  })
})

describe('amountInWords', () => {
  it.each([
    [0, 'Rupees Zero Only'],
    [500, 'Rupees Five Only'],
    [1_900, 'Rupees Nineteen Only'],
    [10_000, 'Rupees One Hundred Only'],
    [10_100, 'Rupees One Hundred One Only'],
    [546_000, 'Rupees Five Thousand Four Hundred Sixty Only'],
    [10_000_000, 'Rupees One Lakh Only'],
    [10_010_000, 'Rupees One Lakh One Hundred Only'],
    [123_456_700, 'Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Only'],
    [1_000_000_000, 'Rupees One Crore Only'],
    [12_345_678_900, 'Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only'],
    [390_050, 'Rupees Three Thousand Nine Hundred and Fifty Paisa Only'],
  ])('writes %d paisa as %j', (paisa, words) => {
    expect(amountInWords(paisa)).toBe(words)
  })
})
