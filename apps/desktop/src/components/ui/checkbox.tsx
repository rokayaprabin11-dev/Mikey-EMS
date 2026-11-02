import * as React from "react"
import { cn } from "cn"
import { CheckIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

// From shadcn/ui, marked like the round mark of a RadioCard: an 18px box with a 2px ink-muted
// border, filled with action and a white tick when checked, and the 2px action focus ring.
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "grid size-4.5 shrink-0 cursor-pointer place-items-center rounded-sm border-2 border-ink-muted bg-surface text-surface outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-surface-muted data-[state=checked]:border-action data-[state=checked]:bg-action",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator">
        <CheckIcon aria-hidden="true" className="size-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
