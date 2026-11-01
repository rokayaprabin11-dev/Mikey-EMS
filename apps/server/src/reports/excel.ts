import {
  adToBs,
  formatBsDateLong,
  formatBsWithAd,
  formatKathmanduTime,
  kathmanduDate,
  printEn,
  type Report,
} from '@mikey/shared'
import ExcelJS from 'exceljs'

import { toDbDate } from '../dates.ts'
import { columnTotal, type ReportTable, reportTable, type Value } from './table.ts'

const words = printEn.reports

// Rupees with lakh grouping (Rs. 12,34,567.00). Excel groups digits in threes only, so lakhs and
// crores need their own sections.
export const RUPEES_FORMAT = '[>=10000000]"Rs. "##\\,##\\,##\\,##0.00;[>=100000]"Rs. "##\\,##\\,##0.00;"Rs. "##,##0.00'
const AD_DATE_FORMAT = 'd mmm yyyy'
const SHARE_FORMAT = '0%'

const HEADER_ROW = 7
// Excel's paper size number for A4.
const A4_PAPER = 9

// The spreadsheet keeps amounts as numbers of rupees, as Excel needs them to add up. Paisa are
// whole numbers, so dividing by 100 gives exactly the rupees and paisa shown.
function rupees(paisa: number): number {
  return paisa / 100
}

function letter(index: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + index)
}

function setCell(cell: ExcelJS.Cell, table: ReportTable, row: readonly Value[], index: number, rowNumber: number): void {
  const column = table.columns[index]
  const value = row[index] ?? null
  if (column === undefined) {
    return
  }
  if (column.kind === 'share' && column.share !== undefined) {
    const [part, whole] = column.share.map((at) => `${letter(at)}${rowNumber}`)
    const partValue = row[column.share[0]]
    const wholeValue = row[column.share[1]]
    const result = typeof partValue === 'number' && typeof wholeValue === 'number' && wholeValue > 0 ? partValue / wholeValue : 0
    cell.value = { formula: `IF(${whole ?? ''}=0,0,${part ?? ''}/${whole ?? ''})`, result }
    cell.numFmt = SHARE_FORMAT
    return
  }
  if (value === null) {
    return
  }
  switch (column.kind) {
    case 'bsDate':
      cell.value = formatBsDateLong(adToBs(String(value)))
      return
    case 'adDate':
      cell.value = toDbDate(String(value))
      cell.numFmt = AD_DATE_FORMAT
      cell.alignment = { horizontal: 'left' }
      return
    case 'amount':
      cell.value = rupees(Number(value))
      cell.numFmt = RUPEES_FORMAT
      return
    default:
      cell.value = value
      // The column that takes what is left on the PDF wraps here too.
      if (column.width === 0) {
        cell.alignment = { wrapText: true, vertical: 'top' }
      }
  }
}

export async function renderReportExcel(report: Report): Promise<Buffer> {
  const table = reportTable(report)
  const { header } = report
  const generated = new Date(header.generatedAt)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = header.schoolName
  workbook.created = generated
  // Printed from the spreadsheet, a report fits one A4 page across.
  const sheet = workbook.addWorksheet(table.title, {
    views: [{ state: 'frozen', ySplit: HEADER_ROW }],
    pageSetup: { paperSize: A4_PAPER, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  sheet.columns = table.columns.map((column) => ({ width: column.excelWidth }))

  sheet.getCell('A1').value = header.schoolName
  sheet.getCell('A1').font = { bold: true, size: 14 }
  sheet.getCell('A2').value = table.title
  sheet.getCell('A2').font = { bold: true, size: 12 }
  sheet.getCell('A3').value = words.period(formatBsWithAd(header.from), formatBsWithAd(header.to))
  sheet.getCell('A4').value = words.generated(formatBsWithAd(kathmanduDate(generated)), formatKathmanduTime(generated), header.generatedBy)
  sheet.getCell('A5').value = table.note

  const headings = sheet.getRow(HEADER_ROW)
  table.columns.forEach((column, index) => {
    const cell = headings.getCell(index + 1)
    cell.value = column.header
    cell.font = { bold: true }
    cell.border = { bottom: { style: 'thin' } }
    cell.alignment = { horizontal: column.kind === 'text' || column.kind === 'bsDate' || column.kind === 'adDate' ? 'left' : 'right' }
  })

  const first = HEADER_ROW + 1
  table.rows.forEach((row, offset) => {
    const rowNumber = first + offset
    row.forEach((_value, index) => {
      setCell(sheet.getCell(rowNumber, index + 1), table, row, index, rowNumber)
    })
  })
  if (table.rows.length === 0) {
    sheet.getCell(first, 1).value = words.none
    return Buffer.from(await workbook.xlsx.writeBuffer())
  }

  const last = first + table.rows.length - 1
  if (table.totals) {
    const totalsNumber = last + 1
    const totals = sheet.getRow(totalsNumber)
    totals.getCell(1).value = words.total
    table.columns.forEach((column, index) => {
      const cell = totals.getCell(index + 1)
      cell.font = { bold: true }
      cell.border = { top: { style: 'thin' } }
      if (column.total === true) {
        const total = columnTotal(table, index)
        cell.value = {
          formula: `SUM(${letter(index)}${first}:${letter(index)}${last})`,
          result: column.kind === 'amount' ? rupees(total) : total,
        }
        if (column.kind === 'amount') {
          cell.numFmt = RUPEES_FORMAT
        }
      } else if (column.kind === 'share') {
        const totalsRow = table.columns.map((_column, at) => (table.columns[at]?.total === true ? columnTotal(table, at) : null))
        setCell(cell, table, totalsRow, index, totalsNumber)
      }
    })

    // The net line takes the smaller total from the larger, so it is never below zero.
    if (table.net !== null) {
      const [plus, minus] = table.net.columns
      const value = columnTotal(table, plus) - columnTotal(table, minus)
      const [from, take] = value < 0 ? [minus, plus] : [plus, minus]
      const net = sheet.getRow(totalsNumber + 1)
      net.getCell(plus).value = value < 0 ? table.net.negative : table.net.positive
      net.getCell(plus).font = { bold: true }
      const cell = net.getCell(plus + 1)
      cell.value = {
        formula: `${letter(from)}${totalsNumber}-${letter(take)}${totalsNumber}`,
        result: rupees(Math.abs(value)),
      }
      cell.numFmt = RUPEES_FORMAT
      cell.font = { bold: true }
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
