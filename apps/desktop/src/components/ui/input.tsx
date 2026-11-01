import * as React from "react"
import { cn } from "cn"

// From shadcn/ui, styled as docs/DESIGN_SYSTEM.md says: 40px high, a line-strong border, and a
// 2px bad border when the field is marked aria-invalid.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-ink tabular-nums outline-none placeholder:text-ink-muted disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-action",
        "aria-invalid:border-2 aria-invalid:border-bad",
        className
      )}
      {...props}
    />
  )
}

export { Input }
