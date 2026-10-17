import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
import { BeatieImage } from '@/components/beatie/BeatieImage'
import { cn } from '@/lib/cn'

/**
 * One short confirmation at a time, optionally with an Undo.
 *
 * Adding a song to a playlist and removing one are both easy to do by
 * accident and awkward to reverse by hand, so each reports what happened and
 * offers a way back rather than relying on the user noticing a list change.
 *
 * One at a time on purpose: these sit above the mini player on a phone, and a
 * stack would bury it.
 */
type Toast = {
  id: number
  message: string
  /** A bold first phrase, e.g. "You're ready!". */
  lead?: string
  /** Beatie's mark at the start, and a close button (the tour's message). */
  beatie?: boolean
  /**
   * A small icon at the start (the bookmark on "Saved to your Library").
   * These toasts wrap instead of cutting off and show the action as a pill.
   */
  icon?: ReactNode
  actionLabel?: string
  onAction?: () => void
}

type ToastApi = {
  show: (toast: Omit<Toast, 'id'>) => void
}

const ToastContext = createContext<ToastApi | null>(null)

/** Long enough to read and act on, short enough not to linger. */
const DISMISS_MS = 6000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextId = useRef(0)

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setToast(null)
  }, [])

  const show = useCallback(
    (next: Omit<Toast, 'id'>) => {
      if (timer.current) clearTimeout(timer.current)
      const id = ++nextId.current
      setToast({ ...next, id })
      timer.current = setTimeout(() => setToast(null), DISMISS_MS)
    },
    []
  )

  useEffect(() => () => clear(), [clear])

  const value = useMemo<ToastApi>(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div
          // polite, not assertive: a confirmation shouldn't interrupt what a
          // screen reader is already saying.
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 sm:bottom-6 lg:pl-64"
        >
          <div
            className={cn(
              'pointer-events-auto flex max-w-md items-center gap-3 rounded-card bg-surface-2 px-4 py-3 shadow-card',
              (toast.beatie || toast.icon != null) && 'w-full border border-primary/50'
            )}
          >
            {toast.icon && <span className="shrink-0 text-accent">{toast.icon}</span>}
            {toast.beatie && (
              <span className="grid size-11 shrink-0 place-items-center rounded-full border border-primary/40 bg-background">
                <BeatieImage mood="mark" size={28} />
              </span>
            )}
            <p className={cn('min-w-0 flex-1 text-body', !toast.beatie && toast.icon == null && 'truncate')}>
              {toast.lead && <b>{toast.lead} </b>}
              {toast.message}
            </p>
            {toast.actionLabel && (
              <button
                type="button"
                onClick={() => {
                  toast.onAction?.()
                  clear()
                }}
                className={cn(
                  'shrink-0 text-button transition-colors duration-200 ease-soft',
                  toast.icon
                    ? 'min-h-10 rounded-chip bg-primary/25 px-4 text-accent hover:bg-primary/35'
                    : 'rounded-button px-2 py-1 text-accent hover:text-foreground'
                )}
              >
                {toast.actionLabel}
              </button>
            )}
            {toast.beatie && (
              <button
                type="button"
                onClick={clear}
                aria-label="Close"
                className="-mr-2 grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors duration-200 ease-soft hover:text-foreground"
              >
                <X className="size-5" strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
