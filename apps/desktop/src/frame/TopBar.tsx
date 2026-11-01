import {
  adToBs,
  type CurrentUser,
  formatAdDate,
  formatBsDateLong,
  formatKathmanduTime,
  kathmanduDate,
  type StudentSummary,
} from '@mikey/shared'
import { cn } from 'cn'
import { LogOut } from 'lucide-react'
import type { Ref } from 'react'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu.tsx'
import { en } from '../i18n/en.ts'
import { weekdayOf } from '../today.ts'
import { useLink } from './link.tsx'
import { StudentSearch } from './StudentSearch.tsx'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : ''
  return `${first}${last}`.toUpperCase()
}

// Today on Computer 1's clock: "Thursday, 12 Kartik 2083" over "29 Oct 2026, 10:54 AM".
function Today() {
  const link = useLink()
  if (link.last === null) {
    return null
  }
  const time = new Date(link.last.check.health.time)
  const ad = kathmanduDate(time)
  return (
    <div className="flex-none text-right text-[13px] leading-snug tabular-nums">
      <div className="font-semibold">{`${weekdayOf(ad)}, ${formatBsDateLong(adToBs(ad))}`}</div>
      <div className="text-ink-muted">{`${formatAdDate(ad)}, ${formatKathmanduTime(time)}`}</div>
    </div>
  )
}

function LinkPill() {
  const { state } = useLink()
  const shown = state === 'unavailable' ? 'reconnecting' : state
  return (
    <span
      role="status"
      className={cn(
        'flex h-8 flex-none items-center gap-2 rounded-full px-3 text-[13px] font-semibold',
        shown === 'connected' ? 'bg-ok-tint text-ok' : 'bg-warn-tint text-warn',
      )}
    >
      <span aria-hidden="true" className="size-2 rounded-full bg-current" />
      {en.link.pill[shown]}
    </span>
  )
}

function UserMenu({ user, onSignOut }: { user: CurrentUser; onSignOut: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={en.frame.account(user.fullName)}
        className="flex flex-none cursor-pointer items-center gap-2.5 rounded-md py-1 pr-1.5 pl-1 text-left outline-none hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      >
        <span
          aria-hidden="true"
          className="grid size-10 flex-none place-items-center rounded-full bg-chrome-accountant text-sm font-semibold text-surface"
        >
          {initials(user.fullName)}
        </span>
        <span className="flex flex-col leading-tight">
          <span className="font-semibold">{user.fullName}</span>
          <span className="text-[13px] text-ink-muted">{en.roles[user.role]}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut aria-hidden="true" />
          {en.frame.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TopBar({
  title,
  subtitle,
  user,
  searchRef,
  onChooseStudent,
  onSignOut,
}: {
  title: string
  subtitle: string
  user: CurrentUser
  searchRef: Ref<HTMLInputElement>
  onChooseStudent: (student: StudentSummary) => void
  onSignOut: () => void
}) {
  return (
    <header className="flex flex-none items-center gap-5 border-b border-line bg-surface px-7 py-3.5">
      <div className="flex min-w-0 flex-none flex-col">
        <h1 className="font-display text-[26px] leading-tight font-semibold">{title}</h1>
        <p className="text-[13px] text-ink-muted">{subtitle}</p>
      </div>
      <StudentSearch inputRef={searchRef} onChoose={onChooseStudent} />
      <Today />
      <LinkPill />
      <UserMenu user={user} onSignOut={onSignOut} />
    </header>
  )
}
