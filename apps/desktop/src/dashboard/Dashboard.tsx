import {
  type Account,
  adToBs,
  bsMonthName,
  type FinanceDashboard,
  formatKathmanduTime,
  formatRupees,
  printEn,
  type RecordStatus,
} from '@mikey/shared'
import { useQuery } from '@tanstack/react-query'
import { cn } from 'cn'
import { CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { api } from '../api/client.ts'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx'
import { Button } from '../components/ui/button.tsx'
import { problemOf } from '../connection.ts'
import { useLink } from '../frame/link.tsx'
import type { Screen } from '../frame/screens.ts'
import { en } from '../i18n/en.ts'
import { CollectionChart } from './CollectionChart.tsx'
import { describeDues } from './dues.ts'

const words = en.dashboard

const ACTIONS: { screen: Screen; words: { title: string; text: string } }[] = [
  { screen: 'students', words: words.actions.findStudent },
  { screen: 'incomeExpenses', words: words.actions.addExpense },
  { screen: 'incomeExpenses', words: words.actions.recordIncome },
  { screen: 'payments', words: words.actions.payments },
  { screen: 'reports', words: words.actions.report },
]

function QuickActions({ onOpen }: { onOpen: (screen: Screen) => void }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3.5">
      <button
        type="button"
        onClick={() => onOpen('collectFee')}
        className="col-span-2 flex cursor-pointer items-center justify-between gap-4 rounded-lg bg-action px-7 py-5 text-left text-surface outline-none hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      >
        <span className="flex flex-col gap-1">
          <span className="font-display text-[26px] leading-tight font-semibold">{words.actions.collectFee.title}</span>
          <span className="text-[14.5px] text-surface/85">{words.actions.collectFee.text}</span>
        </span>
        <kbd className="rounded-sm border border-surface/70 px-1.5 font-sans text-[13px]">F2</kbd>
      </button>
      {ACTIONS.map((action) => (
        <button
          key={action.words.title}
          type="button"
          onClick={() => onOpen(action.screen)}
          className="flex cursor-pointer flex-col gap-1 rounded-lg border border-line bg-surface px-5 py-4.5 text-left outline-none hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
        >
          <span className="text-base font-semibold">{action.words.title}</span>
          <span className="text-[13.5px] text-ink-muted">{action.words.text}</span>
        </button>
      ))}
    </div>
  )
}

function Tile({ label, value, caption, tone }: { label: string; value: string; caption: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className="flex flex-[1_1_9rem] flex-col gap-1 bg-surface px-5 py-4.5">
      <dt className="text-[13.5px] text-ink-muted">{label}</dt>
      <dd className={cn('font-display text-[26px] leading-[1.1] font-semibold tabular-nums', tone === 'warn' && 'text-warn')}>{value}</dd>
      <dd className={cn('text-[13px]', tone === 'bad' ? 'font-semibold text-bad' : 'text-ink-muted')}>{caption}</dd>
    </div>
  )
}

// An account's balance can be below zero (opening balances are not entered yet, Q20); the reply
// says when, and the tile says so rather than show a minus sign.
function AccountTile({ account }: { account: Account }) {
  const value = account.belowZero ? words.belowZeroCash(formatRupees(-account.balance)) : formatRupees(account.balance)
  const caption = account.belowZero ? words.belowZero : account.kind === 'cash' ? words.perCashbook : account.name
  return (
    <Tile label={account.kind === 'cash' ? words.cash : words.bank} value={value} caption={caption} tone={account.belowZero ? 'bad' : undefined} />
  )
}

function Totals({ dashboard }: { dashboard: FinanceDashboard }) {
  const { collectedToday, voidsToday, collectedThisMonth, feesOutstanding, spentToday } = dashboard
  const month = bsMonthName(adToBs(dashboard.date).month)
  const upTo = adToBs(collectedThisMonth.upTo)
  return (
    // Each row of tiles fills the width, however many fit, so no row ends in a gap.
    <dl className="flex flex-wrap gap-px overflow-hidden rounded-lg border border-line bg-line">
      <Tile
        label={words.collectedToday}
        value={formatRupees(collectedToday.amount)}
        caption={words.receipts(collectedToday.receiptCount, collectedToday.receiptCountByYou)}
      />
      <Tile label={words.voidsToday} value={formatRupees(voidsToday.amount)} caption={words.voidsTodayText(voidsToday.receiptCount)} />
      <Tile
        label={words.collectedIn(month)}
        value={formatRupees(collectedThisMonth.amount)}
        caption={words.upTo(`${upTo.day} ${bsMonthName(upTo.month)}`)}
      />
      <Tile label={words.outstanding} value={formatRupees(feesOutstanding.amount)} caption={words.students(feesOutstanding.studentCount)} tone="warn" />
      <Tile label={words.spentToday} value={formatRupees(spentToday.amount)} caption={words.entries(spentToday.entryCount)} />
      {[...dashboard.accounts]
        .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'cash' ? -1 : 1))
        .map((account) => (
          <AccountTile key={account.id} account={account} />
        ))}
    </dl>
  )
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-line bg-surface">
      <header className="flex items-center justify-between gap-3 px-5 pt-4.5 pb-3">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  )
}

function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer text-action underline underline-offset-2 outline-none hover:text-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
    >
      {children}
    </button>
  )
}

function StatusChip({ status }: { status: RecordStatus }) {
  if (status === 'posted') {
    return null
  }
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-1 text-[12.5px] font-semibold whitespace-nowrap',
        status === 'void_requested' ? 'bg-warn-tint text-warn' : 'bg-neutral-tint text-ink-soft',
      )}
    >
      {words.status[status]}
    </span>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="border-t border-line-soft px-5 py-4 text-ink-muted">{children}</p>
}

function LatestReceipts({ receipts, onOpen }: { receipts: FinanceDashboard['latestReceipts']; onOpen: (screen: Screen) => void }) {
  return (
    <Panel title={words.latestReceipts} action={<LinkButton onClick={() => onOpen('payments')}>{words.allPayments}</LinkButton>}>
      {receipts.length === 0 ? (
        <Empty>{words.noReceipts}</Empty>
      ) : (
        <table className="w-full text-[13.5px]">
          <thead className="sr-only">
            <tr>
              <th>{words.columns.time}</th>
              <th>{words.columns.student}</th>
              <th>{words.columns.method}</th>
              <th>{words.columns.status}</th>
              <th>{words.columns.amount}</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr key={receipt.paymentId} className="border-t border-line-soft">
                <td className="py-3 pr-3 pl-5 whitespace-nowrap text-ink-muted tabular-nums">{formatKathmanduTime(new Date(receipt.takenAt))}</td>
                <td className="px-3 py-3">
                  <div className="font-semibold">{receipt.student.fullName}</div>
                  <div className="text-ink-muted tabular-nums">{receipt.receiptNo}</div>
                </td>
                <td className="px-3 py-3">{printEn.paymentMethods[receipt.method]}</td>
                <td className="px-3 py-3">
                  <StatusChip status={receipt.status} />
                </td>
                <td className="py-3 pr-5 pl-3 text-right font-semibold whitespace-nowrap tabular-nums">{formatRupees(receipt.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}

function LargestDues({ dues, onOpen }: { dues: FinanceDashboard['largestDues']; onOpen: (screen: Screen) => void }) {
  return (
    <Panel title={words.largestDues} action={<LinkButton onClick={() => onOpen('reports')}>{words.duesReport}</LinkButton>}>
      {dues.length === 0 ? (
        <Empty>{words.noDues}</Empty>
      ) : (
        <ul>
          {dues.map((due) => (
            <li key={due.student.id} className="flex items-start justify-between gap-4 border-t border-line-soft px-5 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-semibold">{due.student.fullName}</span>
                <span className="text-[13px] text-ink-muted">
                  {`${words.classOf(due.student.className, due.student.sectionName)}, ${describeDues(due.items)}`}
                </span>
              </div>
              <span className="font-semibold whitespace-nowrap text-warn tabular-nums">{formatRupees(due.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function TodaysExpenses({ expenses, onOpen }: { expenses: FinanceDashboard['todaysExpenses']; onOpen: (screen: Screen) => void }) {
  return (
    <Panel title={words.expenses} action={<LinkButton onClick={() => onOpen('incomeExpenses')}>{words.addExpense}</LinkButton>}>
      {expenses.length === 0 ? (
        <Empty>{words.noExpenses}</Empty>
      ) : (
        <ul>
          {expenses.map((expense) => (
            <li key={expense.id} className="flex items-start justify-between gap-4 border-t border-line-soft px-5 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-semibold">{expense.description}</span>
                <span className="text-[13px] text-ink-muted">{`${expense.categoryName}, ${words.paidFrom[expense.accountKind]}`}</span>
              </div>
              <div className="flex flex-none items-center gap-3">
                <StatusChip status={expense.status} />
                <span className="font-semibold tabular-nums">{formatRupees(expense.amount)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function CloseTheDay({ dashboard, onOpen }: { dashboard: FinanceDashboard; onOpen: (screen: Screen) => void }) {
  const { expectedCash, last } = dashboard.dayClose
  const closedToday = last !== null && last.date === dashboard.date
  const expected = expectedCash < 0 ? words.belowZeroCash(formatRupees(-expectedCash)) : formatRupees(expectedCash)
  return (
    <section className="flex flex-col items-start gap-3 rounded-lg bg-ink px-7 py-6 text-surface">
      <h2 className="font-display text-[22px] font-semibold">{words.closeDay}</h2>
      {closedToday ? (
        <p className="text-surface/85">{words.closedToday(formatKathmanduTime(new Date(last.closedAt)), last.closedBy)}</p>
      ) : (
        <p className="text-surface/85">
          {`${words.closeDayText} `}
          <strong className="text-surface tabular-nums">{expected}</strong>.
        </p>
      )}
      <button
        type="button"
        onClick={() => onOpen('cashBank')}
        className="mt-1 h-11 cursor-pointer rounded-md bg-surface px-4.5 font-semibold text-ink outline-none hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface"
      >
        {closedToday ? words.seeDayClose : words.startDayClose}
      </button>
    </section>
  )
}

// The Accountant's Main screen (DOMAIN_RULES §12, `GET /dashboard/finance`). Its figures are
// asked for each time the screen opens and are never refreshed behind the screen's back, so an
// unused app is still signed out when idle.
export function Dashboard({ onOpen }: { onOpen: (screen: Screen) => void }) {
  const link = useLink()
  const dashboard = useQuery({ queryKey: ['dashboard', 'finance'], queryFn: () => api.call('financeDashboard') })

  let content: ReactNode
  if (dashboard.isPending) {
    content = <p className="text-ink-muted">{words.loading}</p>
  } else if (dashboard.isError) {
    const problem = problemOf(dashboard.error, link.address)
    content = (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="bad">
          <CircleAlert aria-hidden="true" />
          <div>
            <AlertTitle>{problem.title}</AlertTitle>
            {problem.help !== null && <AlertDescription>{problem.help}</AlertDescription>}
          </div>
        </Alert>
        <Button variant="secondary" onClick={() => void dashboard.refetch()}>
          {words.tryAgain}
        </Button>
      </div>
    )
  } else {
    const data = dashboard.data
    content = (
      <>
        <Totals dashboard={data} />
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <LatestReceipts receipts={data.latestReceipts} onOpen={onOpen} />
          <Panel title={words.chart}>
            <CollectionChart days={data.collectionByDay} today={data.date} todayAmount={data.collectedToday.amount} />
          </Panel>
        </div>
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <LargestDues dues={data.largestDues} onOpen={onOpen} />
          <TodaysExpenses expenses={data.todaysExpenses} onOpen={onOpen} />
        </div>
        <CloseTheDay dashboard={data} onOpen={onOpen} />
      </>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <QuickActions onOpen={onOpen} />
      {content}
    </div>
  )
}
