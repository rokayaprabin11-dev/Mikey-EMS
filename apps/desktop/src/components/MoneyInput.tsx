import { cn } from 'cn'
import type { ComponentProps } from 'react'

import { en } from '../i18n/en.ts'

// docs/DESIGN_SYSTEM.md, Money input: "Rs." before a right-aligned amount in rupees, which the
// screen reads with parseRupees. `invalid` marks it as the Inputs row says.
export function MoneyInput({ className, invalid = false, ...props }: ComponentProps<'input'> & { invalid?: boolean }) {
  return (
    <span
      className={cn(
        'flex h-10 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-action',
        invalid && 'border-2 border-bad',
        props.disabled === true && 'bg-surface-muted',
        className,
      )}
    >
      <span aria-hidden="true" className="text-[13px] text-ink-muted">
        {en.rupees}
      </span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={invalid || undefined}
        className="w-full min-w-0 bg-transparent text-right font-semibold text-ink tabular-nums outline-none disabled:cursor-not-allowed disabled:text-ink-muted"
        {...props}
      />
    </span>
  )
}
