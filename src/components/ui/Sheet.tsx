import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'
import { isPhoneWidth, useBackToClose, useScrollLock, useSwipeToClose } from '@/lib/sheets'
import { SHEET_HANDLE } from './Modal'

/** Space kept between a pop-up menu and its button, and the screen's edges. */
const GAP = 8

/**
 * A small surface anchored to the control that opened it: a bottom sheet on
 * phones, a pop-up menu next to the button on wider screens. Put it inside
 * the same `relative` wrapper as its button; the wrapper is the anchor.
 *
 * Drawn over the whole screen (a portal), so nothing on the page (a sliding
 * page, a card's overflow) can trap or clip it. It closes by tapping
 * outside, Cancel (phones), Escape, the phone's Back button, or swiping it
 * down; the page behind doesn't scroll while it's open. On a computer the
 * menu opens below and to the left of its button, and flips up or right
 * when there's no room, so it's always fully on screen.
 *
 * The app's existing confirmations (unfollow, delete comment) swap the button
 * for a two-step inline choice, and that stays the pattern for destructive
 * yes/no questions. It can't hold a scrollable list of playlists, which is
 * why this exists.
 */
export function Sheet({
  open,
  onClose,
  title,
  align = 'end',
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  /** Names the dialog for screen readers, and titles the mobile sheet. */
  title: string
  /** Computer: line the menu up with the button's right edge (end) or left edge (start). */
  align?: 'start' | 'end'
  children: ReactNode
  className?: string
}) {
  const marker = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const [phone, setPhone] = useState(isPhoneWidth)
  const [place, setPlace] = useState<CSSProperties | null>(null)

  useBackToClose(open, onClose)
  useScrollLock(open)
  useSwipeToClose(panel, onClose, open && phone)

  // Escape closes; focus moves into the panel so keyboard users aren't left
  // behind on the trigger, and goes back to the trigger afterwards.
  useEffect(() => {
    if (!open) return
    setPhone(isPhoneWidth())
    const opener = document.activeElement as HTMLElement | null
    // Caught first (window, capture), so inside a bigger sheet (a comment's
    // menu in the comments sheet) Escape closes only this one.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    panel.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey, true)
      opener?.focus?.({ preventScroll: true })
    }
  }, [open])

  // Computer: next to the button, kept on screen.
  useLayoutEffect(() => {
    if (!open || phone) {
      setPlace(null)
      return
    }
    const position = () => {
      const anchor = marker.current?.parentElement
      const el = panel.current
      if (!anchor || !el) return
      const a = anchor.getBoundingClientRect()
      const w = el.offsetWidth
      const h = el.offsetHeight
      const vw = document.documentElement.clientWidth
      const vh = window.innerHeight
      let top = a.bottom + GAP
      if (top + h > vh - GAP && a.top - GAP - h >= GAP) top = a.top - GAP - h
      top = Math.max(GAP, Math.min(top, vh - GAP - h))
      // Edges lined up with the button's; the other way if that runs off.
      let left = align === 'end' ? a.right - w : a.left
      if (left < GAP) left = a.left
      else if (left + w > vw - GAP) left = a.right - w
      left = Math.max(GAP, Math.min(left, vw - GAP - w))
      setPlace({ top, left })
    }
    position()
    window.addEventListener('resize', position)
    return () => window.removeEventListener('resize', position)
  }, [open, phone, align])

  return (
    <>
      <span ref={marker} hidden />
      {open &&
        createPortal(
          <>
            {/* Catches the outside tap. Dim only on phones, where the sheet
                covers the bottom of the screen; a menu on a computer
                shouldn't darken the page. */}
            <button
              type="button"
              aria-label="Close"
              tabIndex={-1}
              onClick={() => close.current()}
              data-sheet-backdrop
              className={cn('fixed inset-0 z-[60] cursor-default', phone ? 'animate-fade-in bg-black/50' : 'bg-transparent')}
            />
            <div
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-label={title}
              tabIndex={-1}
              data-sheet
              style={phone ? undefined : (place ?? { visibility: 'hidden', top: 0, left: 0 })}
              className={cn(
                'fixed z-[61] flex flex-col gap-1 border border-line bg-surface shadow-raised outline-none',
                phone
                  ? // Phone: bottom sheet, full width, rounded top corners only.
                    'animate-sheet-up inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto overscroll-contain rounded-t-sheet border-b-0 p-4 pt-0 pb-[max(1rem,env(safe-area-inset-bottom))] motion-reduce:animate-none'
                  : // Computer: a pop-up menu.
                    'max-h-80 w-72 max-w-[calc(100vw-16px)] overflow-y-auto rounded-card p-2',
                className
              )}
            >
              {phone && (
                <span data-sheet-handle className="-mx-4 flex justify-center pb-2 pt-0.5">
                  <span aria-hidden className={SHEET_HANDLE} />
                </span>
              )}
              {phone && <p className="px-1 pb-2 text-card-title">{title}</p>}
              {children}
              {phone && (
                <button
                  type="button"
                  onClick={() => close.current()}
                  className="mt-2 min-h-12 rounded-button bg-surface-2 text-button text-foreground transition-colors duration-200 ease-soft hover:bg-white/10"
                >
                  Cancel
                </button>
              )}
            </div>
          </>,
          document.body
        )}
    </>
  )
}
