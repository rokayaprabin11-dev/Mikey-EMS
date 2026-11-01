import * as React from "react"
import { cn } from "cn"
import { Label as LabelPrimitive } from "radix-ui"

// From shadcn/ui; a label sits above its field (docs/DESIGN_SYSTEM.md, Components).
function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex flex-col gap-1.5 text-[13px] font-semibold text-ink select-none peer-disabled:cursor-not-allowed",
        className
      )}
      {...props}
    />
  )
}

export { Label }
