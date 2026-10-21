import { useEffect, useRef, type RefObject } from 'react'

/**
 * What every sheet and pop-up menu shares (Sheet.tsx, Modal.tsx): the
 * phone's Back button closes it, the page behind doesn't scroll, and on a
 * phone it can be swiped down.
 */

/* ------------------------------------------------------------ Back button */

/**
 * Opening a sheet adds one step to the browser history, so Back closes the
 * sheet instead of leaving the page. Closing it any other way takes that
 * step out again, so the next Back leaves the page as usual.
 *
 * One step however many sheets are open (a menu that opens a confirmation).
 * Taking it out waits only until React has finished the current update, so
 * a sheet handing over to the next keeps it, and nothing that follows (a
 * new page loading) can be cut short by it.
 */
const open: { id: number; close: () => void }[] = []
let stepAdded = false
let ignoreNextPop = false
let nextId = 1
const MARK = '__sheet'

/*
 * While the step exists, the browser mustn't restore scroll positions on
 * its own: going back over the step would otherwise jump the page to
 * wherever it was when that entry was recorded.
 */
let savedRestoration: ScrollRestoration | null = null
function holdScroll() {
  if (savedRestoration !== null) return
  savedRestoration = window.history.scrollRestoration
  window.history.scrollRestoration = 'manual'
}
function releaseScroll() {
  if (savedRestoration === null) return
  window.history.scrollRestoration = savedRestoration
  savedRestoration = null
}

function addStep() {
  if (stepAdded) return
  holdScroll()
  window.history.pushState({ ...(window.history.state ?? {}), [MARK]: true }, '')
  stepAdded = true
}

function removeStepSoon() {
  queueMicrotask(() => {
    if (open.length > 0 || !stepAdded) return
    stepAdded = false
    // Gone already: the sheet closed because a link inside it navigated.
    if (!window.history.state?.[MARK]) {
      releaseScroll()
      return
    }
    ignoreNextPop = true
    window.history.back()
  })
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ignoreNextPop) {
      ignoreNextPop = false
      releaseScroll()
      return
    }
    if (!stepAdded || window.history.state?.[MARK]) return
    // Back was pressed: it took our step; close the top sheet.
    stepAdded = false
    open[open.length - 1]?.close()
    // A sheet underneath is still open: it needs its own step.
    if (open.length > 0) addStep()
    else releaseScroll()
  })
}

export function useBackToClose(isOpen: boolean, onClose: () => void) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!isOpen) return
    const entry = { id: nextId++, close: () => close.current() }
    open.push(entry)
    addStep()
    return () => {
      const i = open.indexOf(entry)
      if (i >= 0) open.splice(i, 1)
      removeStepSoon()
    }
  }, [isOpen])
}

/* ------------------------------------------------------------ scroll lock */

let locks = 0
let saved: { overflow: string; bodyOverflow: string; padding: string } | null = null

/** The page behind stays put while anything is open; nested sheets count. */
export function useScrollLock(isOpen: boolean) {
  useEffect(() => {
    if (!isOpen) return
    if (locks++ === 0) {
      const root = document.documentElement
      const gutter = window.innerWidth - root.clientWidth
      saved = { overflow: root.style.overflow, bodyOverflow: document.body.style.overflow, padding: document.body.style.paddingRight }
      root.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
      // Keep the page from shifting sideways where the scrollbar was.
      if (gutter > 0) document.body.style.paddingRight = `${gutter}px`
    }
    return () => {
      if (--locks === 0 && saved) {
        document.documentElement.style.overflow = saved.overflow
        document.body.style.overflow = saved.bodyOverflow
        document.body.style.paddingRight = saved.padding
        saved = null
      }
    }
  }, [isOpen])
}

/* ------------------------------------------------------------ swipe down */

/**
 * On a phone, dragging the sheet down moves it with the finger; let go past
 * a third of its height (or with a quick flick) and it closes, otherwise it
 * springs back. A drag only starts from the top of the sheet's content (or
 * on the handle), so scrolling a long list inside still works.
 *
 * `enabled` is false where the surface isn't a bottom sheet (desktop).
 */
export function useSwipeToClose(panel: RefObject<HTMLElement | null>, onClose: () => void, enabled: boolean) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const el = panel.current
    if (!enabled || !el) return
    let startY = 0
    let startT = 0
    let dy = 0
    let tracking = false
    let dragging = false

    const scrolledInside = (target: EventTarget | null) => {
      for (let n = target as HTMLElement | null; n && n !== el.parentElement; n = n.parentElement) {
        if (n.scrollTop > 0) return true
      }
      return false
    }
    const set = (y: number, animate: boolean) => {
      el.style.transition = animate ? 'transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none'
      el.style.transform = y ? `translateY(${y}px)` : ''
    }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const onHandle = (e.target as HTMLElement).closest('[data-sheet-handle]')
      if (!onHandle && scrolledInside(e.target)) return
      tracking = true
      dragging = false
      startY = e.touches[0].clientY
      startT = performance.now()
      dy = 0
    }
    const onMove = (e: TouchEvent) => {
      if (!tracking) return
      dy = e.touches[0].clientY - startY
      if (!dragging) {
        if (dy < 6) {
          if (dy < 0) tracking = false // an upward move is a scroll
          return
        }
        dragging = true
        // The opening animation would otherwise hold the sheet in place.
        el.style.animation = 'none'
      }
      e.preventDefault()
      set(Math.max(0, dy), false)
    }
    const onEnd = () => {
      if (!tracking) return
      tracking = false
      if (!dragging) return
      dragging = false
      const speed = dy / Math.max(1, performance.now() - startT)
      if (dy > el.offsetHeight / 3 || (dy > 40 && speed > 0.6)) {
        set(el.offsetHeight, true)
        window.setTimeout(() => {
          close.current()
          // Still here (the sheet asked first, e.g. unsaved text): back up.
          if (el.isConnected) set(0, true)
        }, 200)
      } else {
        set(0, true)
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [panel, enabled])
}

/** True below the `sm` breakpoint, where sheets sit at the bottom of the screen. */
export function isPhoneWidth() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 639.98px)').matches
}
