import { cn } from 'cn'
import { CalendarCheck, DollarSign, FileText, Landmark, LayoutDashboard, type LucideIcon, ReceiptText, Users } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Crest } from '../components/Crest.tsx'
import { en } from '../i18n/en.ts'
import { useLink } from './link.tsx'
import type { Screen } from './screens.ts'

const words = en.frame

const GROUPS: { label: string; items: { screen: Screen; icon: LucideIcon }[] }[] = [
  {
    label: words.groups.today,
    items: [
      { screen: 'dashboard', icon: LayoutDashboard },
      { screen: 'payments', icon: ReceiptText },
    ],
  },
  {
    label: words.groups.money,
    items: [
      { screen: 'incomeExpenses', icon: DollarSign },
      { screen: 'cashBank', icon: Landmark },
      { screen: 'reports', icon: FileText },
    ],
  },
  {
    label: words.groups.lookUp,
    items: [
      { screen: 'students', icon: Users },
      { screen: 'attendance', icon: CalendarCheck },
    ],
  },
]

const TICK_MS = 1_000

// "Checked 4 seconds ago", counting up on its own between checks.
function CheckedAgo({ at, address }: { at: number; address: string }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])
  return <>{en.link.checked(address, Math.max(0, Math.round((now - at) / 1_000)))}</>
}

function LinkBox() {
  const link = useLink()
  const good = link.state === 'connected'
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-surface/20 p-3">
      <div className="flex items-center gap-2 text-[13.5px] font-semibold">
        <span aria-hidden="true" className={cn('size-2 flex-none rounded-full', good ? 'bg-ok-tint' : 'bg-warn-tint')} />
        {link.state === 'unavailable' ? en.link.title.reconnecting : en.link.title[link.state]}
      </div>
      {link.last !== null && (
        <p className="text-[13px] leading-normal text-surface/85">
          <CheckedAgo at={link.last.at} address={link.address} />
        </p>
      )}
      <p className="text-[12.5px] leading-normal text-surface/70">{en.link.nothingStored}</p>
    </div>
  )
}

// The Accountant's sidebar (docs/DESIGN_SYSTEM.md, Layout): the school, Collect fee with its key,
// the screens in three groups, and whether Computer 1 answers.
export function Sidebar({ screen, onOpen }: { screen: Screen; onOpen: (screen: Screen) => void }) {
  const link = useLink()
  const check = link.last?.check.health
  const school = check?.db === 'ok' ? check.schoolName : null
  return (
    <aside className="flex w-58 flex-none flex-col gap-5 overflow-y-auto bg-chrome-accountant px-3.5 py-4.5 text-surface">
      <div className="flex items-center gap-3 px-1">
        <Crest width={40} />
        <div className="flex flex-col gap-0.5">
          <span className="font-display text-lg leading-[1.1] font-semibold">{school ?? en.appName}</span>
          <span className="text-[12.5px] text-surface/70">{words.counter}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onOpen('collectFee')}
        className="flex h-12 flex-none cursor-pointer items-center justify-between rounded-lg bg-surface px-4 text-[15px] font-semibold text-chrome-accountant outline-none hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface"
      >
        {words.screens.collectFee}
        <kbd className="rounded-sm border border-chrome-accountant px-1.5 font-sans text-[13px]">F2</kbd>
      </button>

      <nav aria-label={words.menu} className="flex flex-col gap-4">
        {GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <span className="px-3 text-[12.5px] text-surface/70">{group.label}</span>
            <ul className="flex flex-col gap-0.5">
              {group.items.map(({ screen: item, icon: Icon }) => (
                <li key={item}>
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    aria-current={item === screen ? 'page' : undefined}
                    className={cn(
                      'flex h-9 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-left outline-none hover:bg-chrome-accountant-active/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface',
                      item === screen && 'bg-chrome-accountant-active font-semibold hover:bg-chrome-accountant-active',
                    )}
                  >
                    <Icon aria-hidden="true" className="size-5 flex-none" strokeWidth={1.75} />
                    {words.screens[item]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="mt-auto">
        <LinkBox />
      </div>
    </aside>
  )
}
