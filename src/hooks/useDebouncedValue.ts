import { useEffect, useState } from 'react'

/**
 * Local search is instant, but debouncing now means the interaction pattern is
 * already right when this becomes a Supabase / lrclib round-trip.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])

  return debounced
}
