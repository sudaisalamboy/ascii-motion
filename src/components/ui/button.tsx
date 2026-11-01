import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-foreground text-background border-2 border-[var(--brutal-border)] shadow-[4px_4px_0_0_var(--brutal-shadow)] hover:shadow-[6px_6px_0_0_var(--brutal-shadow)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none",
        destructive:
          "bg-destructive text-white border-2 border-[var(--brutal-border)] shadow-[4px_4px_0_0_var(--brutal-shadow)] hover:shadow-[6px_6px_0_0_var(--brutal-shadow)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "bg-card text-foreground border-2 border-[var(--brutal-border)] shadow-[4px_4px_0_0_var(--brutal-shadow)] hover:bg-muted hover:shadow-[6px_6px_0_0_var(--brutal-shadow)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none",
        secondary:
          "bg-secondary text-secondary-foreground border-2 border-[var(--brutal-border)] shadow-[4px_4px_0_0_var(--brutal-shadow)] hover:shadow-[6px_6px_0_0_var(--brutal-shadow)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none",
        ghost:
          "bg-transparent text-foreground border-2 border-transparent hover:bg-muted hover:border-[var(--brutal-border)]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-none gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-none px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
