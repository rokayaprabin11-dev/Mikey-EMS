"use client"

import * as React from "react"
import { cn } from "cn"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

// From shadcn/ui. The choices in the designs are whole cards with the round mark at the start,
// so the item is a card: the selected one has a 2px action border.
function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-3", className)}
      {...props}
    />
  )
}

function RadioCard({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-card"
      className={cn(
        "group flex cursor-pointer items-start gap-4 rounded-xl border border-line-strong bg-surface p-5 text-left text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:bg-surface-muted data-[state=checked]:border-2 data-[state=checked]:border-action",
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="grid size-5.5 flex-none place-items-center rounded-full border-2 border-ink-muted group-data-[state=checked]:border-action"
      >
        <RadioGroupPrimitive.Indicator className="size-2.5 rounded-full bg-action" />
      </span>
      {children}
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioCard }
