import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// From shadcn/ui, with the variants and sizes of docs/DESIGN_SYSTEM.md (Components, Shape and
// spacing): 40px buttons, 44–48px for main actions, and a 2px action focus ring.
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-action text-surface hover:bg-action-hover disabled:bg-line-strong disabled:text-ink-soft",
        secondary:
          "border border-line-strong bg-surface text-ink hover:bg-surface-muted disabled:text-ink-muted",
        dark: "bg-ink text-surface hover:bg-ink-soft disabled:bg-line-strong disabled:text-ink-soft",
        destructive: "bg-bad text-surface hover:bg-bad/90 disabled:bg-line-strong disabled:text-ink-soft",
      },
      size: {
        default: "h-10 px-3.5",
        lg: "h-11 px-4",
        xl: "h-12 rounded-lg px-6 text-[15px]",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "primary",
  size = "default",
  asChild = false,
  type = "button",
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      type={asChild ? undefined : type}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
