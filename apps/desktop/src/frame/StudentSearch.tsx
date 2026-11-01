import { formatRupees, type StudentSummary } from '@mikey/shared'
import { useQuery } from '@tanstack/react-query'
import { cn } from 'cn'
import { Search } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, type Ref, useEffect, useId, useState } from 'react'

import { api } from '../api/client.ts'
import { problemOf } from '../connection.ts'
import { en } from '../i18n/en.ts'
import { useLink } from './link.tsx'

const words = en.search
// Waits for a pause in typing before asking Computer 1.
const PAUSE_MS = 250

// The top bar's student search (Ctrl+K): name, student ID, roll number or guardian phone, the
// first or the last digits (DOMAIN_RULES §11).
export function StudentSearch({ inputRef, onChoose }: { inputRef: Ref<HTMLInputElement>; onChoose: (student: StudentSummary) => void }) {
  const link = useLink()
  const [typed, setTyped] = useState('')
  const [asked, setAsked] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()

  useEffect(() => {
    const timer = setTimeout(() => {
      setAsked(typed.trim())
      setActive(0)
    }, PAUSE_MS)
    return () => clearTimeout(timer)
  }, [typed])

  const results = useQuery({
    queryKey: ['students', 'search', asked],
    queryFn: () => api.call('searchStudents', { query: { q: asked } }),
    enabled: asked !== '',
  })
  const students = results.data?.students ?? []
  const showing = open && asked !== ''

  function choose(student: StudentSummary): void {
    onChoose(student)
    setTyped('')
    setAsked('')
    setOpen(false)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((index) => (students.length === 0 ? 0 : (index + step + students.length) % students.length))
    } else if (event.key === 'Enter') {
      const student = students[active]
      if (showing && student !== undefined) {
        event.preventDefault()
        choose(student)
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  let panel: ReactNode
  if (results.isPending) {
    panel = <p className="px-3.5 py-3 text-ink-muted">{words.searching}</p>
  } else if (results.isError) {
    panel = <p className="px-3.5 py-3 text-bad">{problemOf(results.error, link.address).title}</p>
  } else if (students.length === 0) {
    panel = (
      <div className="flex flex-col gap-1 px-3.5 py-3">
        <strong className="font-semibold">{words.noMatch(asked)}</strong>
        <span className="text-ink-soft">{words.noMatchHelp}</span>
      </div>
    )
  } else {
    panel = (
      <ul role="listbox" id={listId} aria-label={words.results} className="max-h-96 overflow-y-auto py-1">
        {students.map((student, index) => (
          <li
            key={student.id}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => {
              // Keeps the focus in the box, so the click chooses before the list closes.
              event.preventDefault()
              choose(student)
            }}
            onMouseEnter={() => setActive(index)}
            className={cn('flex cursor-pointer items-start justify-between gap-4 px-3.5 py-2.5', index === active && 'bg-action-tint')}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <strong className="font-semibold">{student.fullName}</strong>
              <span className="text-[13px] text-ink-muted">
                {words.place(student.className, student.sectionName, student.rollNo, student.code)}
              </span>
              {student.guardianName !== null && (
                <span className="text-[13px] text-ink-muted">{words.guardian(student.guardianName, student.guardianPhone)}</span>
              )}
            </span>
            <span className={cn('flex-none text-[13px] font-semibold tabular-nums', student.outstanding > 0 ? 'text-warn' : 'text-ok')}>
              {student.outstanding > 0 ? words.owes(formatRupees(student.outstanding)) : words.noDues}
            </span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="relative min-w-0 flex-1 basis-56">
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-ink-muted" />
      <input
        ref={inputRef}
        role="combobox"
        aria-label={words.label}
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing && students.length > 0 ? `${listId}-${active}` : undefined}
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder={words.placeholder}
        className="h-11 w-full rounded-md border border-line-strong bg-surface-muted pr-16 pl-10 text-ink outline-none placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-action"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded-sm border border-line-strong bg-surface px-1.5 font-sans text-xs text-ink-muted">
        {words.shortcut}
      </kbd>
      {showing && (
        <div className="absolute top-full right-0 left-0 z-30 mt-1.5 rounded-md border border-line-strong bg-surface text-sm">{panel}</div>
      )}
    </div>
  )
}
