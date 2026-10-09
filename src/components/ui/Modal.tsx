import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A modal surface for a task or a decision: a bottom sheet on phones, a
 * centred dialog on wider screens.
 *
 * Sheet.tsx is the other surface, and the two aren't interchangeable. Sheet
 * is a popover anchored to its trigger and leaves the page usable behind it;
 * this blocks the page until it's dismissed, so it's for things that need an
 * answer — the private-to-public warning, the review composer.
 *
 * Every way out — Escape, the backdrop, a close button inside — goes through
 * onClose, so a caller that needs to intercept a close (unsaved text, a
 * setting that must stay unchanged) has exactly one place to do it.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  initialFocus,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  /** id of the visible heading inside, which names the dialog. */
  labelledBy: string
  /** What gets focus on open; defaults to the first control inside. */
  initialFocus?: RefObject<HTMLElement | null>
  children: ReactNode
  className?: string
}) {
  const panel = useRef<HTMLDivElement>(null)
  // Read through a ref so a parent re-rendering with a new closure doesn't
  // tear down and re-run the effect below, which would steal focus back.
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null

    // Focus the given control, else the first one, rather than the panel, so
    // a keyboard user can act straight away.
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(initialFocus?.current ?? first ?? panel.current)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close.current()
        return
      }
      // Keep Tab inside the dialog; aria-modal alone doesn't stop the
      // browser walking into the page behind it.
      if (e.key !== 'Tab' || !panel.current) return
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) return
      const head = items[0]
      const tail = items[items.length - 1]
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault()
        tail.focus()
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault()
        head.focus()
      }
    }
    document.addEventListener('keydown', onKey)

    // The page behind shouldn't scroll under a phone sheet.
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      opener?.focus?.()
    }
    // initialFocus is a ref: reading .current at open time is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div
        aria-hidden
        onClick={() => close.current()}
        className="animate-fade-in absolute inset-0 bg-black/60"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cn(
          'animate-page-in relative flex w-full flex-col bg-surface shadow-card outline-none',
          // Phone: bottom sheet, full width, rounded top corners only.
          'max-h-[92dvh] rounded-t-[20px] pb-[env(safe-area-inset-bottom)]',
          // Desktop: centred dialog.
          'sm:max-h-[85vh] sm:max-w-lg sm:rounded-card sm:pb-0',
          className
        )}
      >
        {/* Grab handle: tells a phone user this is a sheet. Decorative. */}
        <span
          aria-hidden
          className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-white/15 sm:hidden"
        />
        {children}
      </div>
    </div>,
    document.body
  )
}
