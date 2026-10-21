import type { MouseEvent } from 'react'
import { useLocation } from 'react-router-dom'

/** True when the person asked their device for less motion. */
export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Back to the very top of the page. Smooth unless the person asked for
 * less motion, or `instant` (switching tabs, where gliding past the old
 * tab's posts would only be noise).
 */
export function scrollToTop({ instant = false }: { instant?: boolean } = {}) {
  window.scrollTo({ top: 0, behavior: instant || prefersReducedMotion() ? 'auto' : 'smooth' })
}

/**
 * For the bottom bar's and sidebar's links: tapping the page you're
 * already on goes back to its top instead of reloading it. On Home this
 * also keeps the tab you're on (the link itself would switch to For You).
 */
export function useTapToTop() {
  const { pathname } = useLocation()
  return (to: string) => (e: MouseEvent) => {
    if (to !== pathname) return
    e.preventDefault()
    scrollToTop()
  }
}
