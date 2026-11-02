import {
  type AdDate,
  formatBsWithAd,
  formatReceiptAmount,
  formatRupees,
  type PaymentMethod,
  printEn,
  type ReceiptPreview,
  type ReceiptSnapshot,
} from '@mikey/shared'
import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Crest } from '../components/Crest.tsx'
import { en } from '../i18n/en.ts'

const words = en.collect.preview
const printed = printEn.receipt

// "Paid by Fonepay QR, reference 2083-1123", in the receipt's own words.
export function paidBy(method: PaymentMethod, reference: string | null): string {
  const paid = `${printed.paidBy} ${printEn.paymentMethods[method]}`
  return reference === null ? paid : `${paid}, ${printed.reference} ${reference}`
}

// The receipt on the right of Collect fee, on paper with a torn edge.
export function ReceiptPaper({ school, children }: { school: string; children: ReactNode }) {
  return (
    <div>
      <section aria-label={words.label} className="flex flex-col gap-3 rounded-t-lg border border-b-0 border-line bg-surface px-5.5 pt-5 pb-3.5 tabular-nums">
        <header className="flex items-center gap-2.5">
          <Crest width={30} />
          <div className="flex flex-col">
            <span className="font-display text-base font-semibold">{school}</span>
            <span className="text-xs text-ink-muted">{words.subtitle}</span>
          </div>
        </header>
        {children}
      </section>
      <div
        aria-hidden="true"
        className="h-3 bg-[radial-gradient(circle_at_8px_0,transparent_7px,var(--color-surface)_7.5px)] bg-size-[16px_12px] bg-repeat-x"
      />
    </div>
  )
}

export interface ReceiptFace {
  // Null until Computer 1 gives it on save.
  number: string | null
  date: AdDate
  student: { fullName: string; className: string; sectionName: string; rollNo: number | null }
  money: ReceiptPreview
  method: PaymentMethod
  reference: string | null
  receivedBy: string
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('flex justify-between gap-3', className)}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

// What the receipt will say, or says: every number and word is Computer 1's.
export function ReceiptFaceView({ face, stale = false }: { face: ReceiptFace; stale?: boolean }) {
  const { money, student } = face
  const { totals } = money
  return (
    <div aria-busy={stale} className={cn('flex flex-col gap-3', stale && 'opacity-60')}>
      <div className="flex justify-between gap-3 border-t border-dashed border-line-strong pt-2.5 text-[12.5px] text-ink-muted">
        <span>{face.number === null ? words.numberOnSave : words.number(face.number)}</span>
        <span>{formatBsWithAd(face.date)}</span>
      </div>
      <div className="flex flex-col gap-0.5 text-[13px]">
        <p>
          <strong className="font-semibold">{student.fullName}</strong>, {words.place(student.className, student.sectionName, student.rollNo)}
        </p>
        {money.months !== null && <p className="text-ink-muted">{`${printed.forTheMonthsOf} ${money.months}`}</p>}
      </div>
      <ul aria-label={printed.particulars} className="flex flex-col gap-1.5 text-[13.5px]">
        {money.lines.map((line, index) => (
          // Lines have no id of their own, and the same label can come twice (two fines with one reason).
          <li key={`${index}-${line.label}`} className="flex justify-between gap-2.5">
            <span>{line.label}</span>
            <span className="whitespace-nowrap">{formatRupees(line.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1 border-t border-ink pt-2.5 text-[13px]">
        <Row label={words.duesBefore} value={formatRupees(totals.duesBefore)} className="text-ink-muted" />
        {totals.discount > 0 && <Row label={printed.discount} value={formatRupees(totals.discount)} className="text-ink-muted" />}
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold">{words.payingNow}</span>
          <span className="font-display text-[30px] leading-tight font-bold">{formatRupees(totals.amountPaid)}</span>
        </div>
        <Row
          label={words.stillDue}
          value={formatRupees(totals.balanceAfter)}
          className={cn('font-semibold', totals.balanceAfter > 0 ? 'text-warn' : 'text-ok')}
        />
      </div>
      <p className="text-[12.5px] text-ink-soft italic">{money.amountInWords}</p>
      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[12.5px] text-ink-muted">
        <span>{paidBy(face.method, face.reference)}</span>
        <span>{`${printed.receivedBy} ${face.receivedBy}`}</span>
      </div>
    </div>
  )
}

export function snapshotFace(snapshot: ReceiptSnapshot): ReceiptFace {
  return {
    number: snapshot.receiptNo,
    date: snapshot.date.ad,
    student: snapshot.student,
    money: snapshot,
    method: snapshot.method,
    reference: snapshot.reference,
    receivedBy: snapshot.receivedBy,
  }
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <p>
      {`${label} `}
      <strong className="font-semibold">{value}</strong>
    </p>
  )
}

// "View receipt": the whole receipt as it was saved, in the receipt's own words, drawn from its
// snapshot. It never asks for the PDF, because every PDF is a recorded print (DOMAIN_RULES §5).
export function SavedReceipt({ snapshot }: { snapshot: ReceiptSnapshot }) {
  const { student, totals } = snapshot
  return (
    <div className="flex flex-col gap-3.5 rounded-lg border border-line p-5 text-[13.5px] tabular-nums">
      <header className="flex items-start justify-between gap-4 border-b-2 border-ink pb-3">
        <div className="flex items-center gap-2.5">
          <Crest width={30} />
          <span className="font-display text-lg font-semibold">{snapshot.school.name}</span>
        </div>
        <span className="font-display text-lg font-semibold">{printed.title}</span>
      </header>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <Field label={printed.receiptNo} value={snapshot.receiptNo} />
        <Field label={printed.date} value={formatBsWithAd(snapshot.date.ad)} />
        <Field label={printed.fiscalYear} value={snapshot.fiscalYear} />
        <Field label={printed.session} value={snapshot.sessionName} />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-ink-muted px-3.5 py-2.5">
        <Field label={printed.student} value={student.fullName} />
        <Field label={printed.studentId} value={student.code} />
        <p>{words.place(student.className, student.sectionName, student.rollNo)}</p>
        {student.guardianName !== null && <Field label={printed.guardian} value={student.guardianName} />}
        {snapshot.months !== null && (
          <div className="col-span-2">
            <Field label={printed.forTheMonthsOf} value={snapshot.months} />
          </div>
        )}
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-ink text-left">
            <th className="py-1.5 pr-3 font-semibold">{printed.serialNo}</th>
            <th className="py-1.5 font-semibold">{printed.particulars}</th>
            <th className="py-1.5 text-right font-semibold">{printed.amountColumn}</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.lines.map((line, index) => (
            <tr key={`${index}-${line.label}`} className="border-b border-line">
              <td className="py-1.5 pr-3">{index + 1}</td>
              <td className="py-1.5">{line.label}</td>
              <td className="py-1.5 text-right">{formatReceiptAmount(line.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ml-auto flex w-full max-w-72 flex-col gap-1">
        <Row label={printed.duesBefore} value={formatReceiptAmount(totals.duesBefore)} />
        <Row label={printed.discount} value={formatReceiptAmount(totals.discount)} />
        <Row label={printed.amountPaid} value={formatReceiptAmount(totals.amountPaid)} className="border-y border-ink py-1 font-semibold" />
        <Row label={printed.balanceAfter} value={formatReceiptAmount(totals.balanceAfter)} />
      </div>
      <Field label={printed.inWords} value={snapshot.amountInWords} />
      <p>{`${paidBy(snapshot.method, snapshot.reference)}. ${printed.thanks}`}</p>
      <p className="text-ink-muted">{`${printed.receivedBy} ${snapshot.receivedBy}`}</p>
    </div>
  )
}
