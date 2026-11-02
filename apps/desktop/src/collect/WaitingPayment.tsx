import { formatKathmanduTime, formatRupees } from '@mikey/shared'

import { Button } from '../components/ui/button.tsx'
import { en } from '../i18n/en.ts'
import { type LastSaved, type Pending, useCollect } from './payment.tsx'

const words = en.collect.waiting

// "Not confirmed yet. Don't hand over a receipt.": a confirmed payment that Computer 1 has not
// answered for, on Collect fee and on the Can't reach Computer 1 screen. It says who and how much,
// and that the same payment is sent again, so it is never entered a second time.
export function WaitingPayment({ pending, lastSaved, userId }: { pending: Pending; lastSaved: LastSaved | null; userId: string }) {
  const { sendAgain } = useCollect()
  const { student } = pending.draft
  const who = `${student.ref.fullName}, ${student.ref.className} ${student.ref.sectionName}`
  const amount = formatRupees(pending.preview.totals.amountPaid)
  const { method } = pending.request
  const { stage } = pending
  const manual = stage.kind === 'waiting' && stage.retry === 'manual' ? stage : null

  let next: string
  if (pending.owner.id !== userId) {
    next = words.otherUser(pending.owner.fullName)
  } else if (manual !== null) {
    next = words.manual(manual.problem)
  } else {
    next = words.auto
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="alert" className="flex flex-col items-start gap-2 rounded-lg bg-bad-tint px-5.5 py-4.5">
        <p className="font-semibold text-bad">{words.title}</p>
        <p className="text-[15px] leading-normal text-ink">
          {`${method === 'cash' ? words.cash(who, amount) : words.other(who, amount, en.collect.byMethod[method])} ${next}`}
        </p>
        {manual !== null && pending.owner.id === userId && (
          <Button className="mt-1" onClick={sendAgain}>
            {words.sendAgain}
          </Button>
        )}
        {stage.kind === 'sending' && <p className="text-[13.5px] text-ink-soft">{words.sending}</p>}
      </div>
      {lastSaved !== null && (
        <p className="text-[13.5px] text-ink-soft">{words.lastSaved(lastSaved.receiptNo, formatKathmanduTime(new Date(lastSaved.issuedAt)))}</p>
      )}
    </div>
  )
}
