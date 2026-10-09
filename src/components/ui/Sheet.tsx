import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * A small surface anchored to the control that opened it: a bottom sheet on
 * phones, a popover on wider screens.
 *
 * The app's existing confirmations (unfollow, delete comment) swap the button
 * for a two-step inline choice, and that stays the pattern for destructive
 * yes/no questions. It can't hold a scrollable list of playlists, which is
 * why this exists. Everything here is built from the same tokens — surface,
 * rounded-card, ease-soft — so it reads as the same system rather than a new
 * one.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  /** Names the dialog for screen readers, and titles the mobile sheet. */
  title: string
  children: ReactNode
  className?: string
}) {
  const panel = useRef<HTMLDivElement>(null)

  // Escape closes, and focus moves into the panel so keyboard users aren't
  // left behind on the trigger.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    panel.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      {/* Catches the outside click. Only dim on phones, where the sheet
          covers the bottom of the screen; a desktop popover shouldn't
          darken the page behind it. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-black/50 sm:bg-transparent"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'z-50 flex flex-col gap-1 bg-surface shadow-card outline-none',
          // Phone: bottom sheet, full width, rounded top corners only.
          'fixed inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto rounded-t-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]',
          // Desktop: popover anchored under the trigger.
          'sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-80 sm:w-72 sm:rounded-card sm:p-2 sm:pb-2',
          className
        )}
      >
        <p className="px-1 pb-2 text-card-title sm:hidden">{title}</p>
        {children}
      </div>
    </>
  )
}
