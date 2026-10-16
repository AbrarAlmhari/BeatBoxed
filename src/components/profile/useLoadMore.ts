import { useEffect, useRef } from 'react'

/**
 * Calls `onMore` when the returned element scrolls near the viewport, for
 * as long as `enabled` is true: the profile tabs' infinite scroll.
 */
export function useLoadMore(onMore: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const latest = useRef(onMore)
  latest.current = onMore

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) latest.current()
      },
      { rootMargin: '600px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [enabled])

  return ref
}
