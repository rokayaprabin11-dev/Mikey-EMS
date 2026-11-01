import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// From shadcn/ui, as the banners of docs/DESIGN_SYSTEM.md: a status tint behind the status's own
// strong colour, an icon, a bold sentence saying what happened and a plain one saying what to do.
const alertVariants = cva(
  "flex w-full items-start gap-2.5 rounded-lg px-3.5 py-3 [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:flex-none",
  {
    variants: {
      variant: {
        ok: "bg-ok-tint text-ok",
        warn: "bg-warn-tint text-warn",
        bad: "bg-bad-tint text-bad",
      },
    },
  }
)

// A problem interrupts; good news and things waiting are announced politely.
function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & Required<VariantProps<typeof alertVariants>>) {
  return (
    <div
      data-slot="alert"
      role={variant === "bad" ? "alert" : "status"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="alert-title"
      className={cn("font-semibold", className)}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="alert-description"
      className={cn("mt-0.5 text-[13px] leading-normal text-ink-soft", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }
