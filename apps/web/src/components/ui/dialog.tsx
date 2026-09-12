import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { cn } from "@/lib/utils"

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80" />
      <DialogPrimitive.Content
        className={cn(
          // Graphite: two shades above the canvas, which is the whole of the
          // elevation language. No shadow, no glow.
          "fixed left-1/2 top-1/2 z-50 w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2",
          "border border-[#2a2a2a] bg-graphite p-10",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("display display-md", className)} {...props} />
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("meta mt-3", className)} {...props} />
}
