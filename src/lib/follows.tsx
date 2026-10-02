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
import { getFollowedArtistIds, setArtistFollow } from './catalog'
import { useAuth } from './auth'

/**
 * One shared set of followed artist ids for the whole session, so a follow
 * made anywhere shows everywhere without a refetch.
 *
 * Two bugs shaped this file, both worth not repeating:
 *
 * 1. FollowButton used to copy a `following` prop into useState once. Pages
 *    resolve follow state asynchronously, so the prop landed after mount and
 *    the button never updated — a second song by an artist you already follow
 *    still said "Follow".
 *
 * 2. The first version of this provider keyed its load effect on the `user`
 *    object and disabled the button until `ready`. AuthProvider calls
 *    setSession from both getSession() and onAuthStateChange, and the latter
 *    also fires on subscribe and on every token refresh — each producing a new
 *    session object, so `user` changed identity repeatedly. Every change
 *    re-ran the effect, whose cleanup cancelled the in-flight load, so `ready`
 *    could stall at false and leave the button permanently dead.
 *
 * Hence: key on user.id (a string), keep `ready` monotonic per user, and never
 * let a failed or slow load render the control unusable.
 */
type FollowsApi = {
  isFollowing: (artistId: string) => boolean
  /** True only for the very first load of a user's set. */
  loading: boolean
  /** Set when the load failed; the button offers a retry. */
  error: boolean
  retry: () => void
  /** Optimistic; rolls back and rethrows if the write fails. */
  toggleFollow: (artistId: string) => Promise<boolean>
}

const FollowsContext = createContext<FollowsApi | null>(null)

export function FollowsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null

  const [ids, setIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  /**
   * Artists with a write in flight, purely to stop a double tap sending two
   * contradictory writes. Deliberately a ref and deliberately not rendered:
   * the optimistic label is the feedback, so a pending write needs no
   * spinner. It used to drive one, and because clearing a ref triggers no
   * re-render — and the `setError(false)` after a successful write bails out
   * when error is already false — the last render was the optimistic one,
   * with the spinner on. It then span forever and made an instant toggle
   * look like it was still saving.
   */
  const busy = useRef<Set<string>>(new Set())

  useEffect(() => {
    // Signed out is a finished state with an empty set, not a pending one.
    if (!userId) {
      setIds(new Set())
      setLoading(false)
      setError(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(false)

    getFollowedArtistIds(userId)
      .then((serverIds) => {
        if (cancelled) return
        setIds(serverIds)
      })
      .catch((err) => {
        console.error('[beatboxed] could not load followed artists:', err)
        // Loaded-with-error, never a permanently pending button.
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // userId is a string, so a refreshed token can't retrigger this.
  }, [userId, reloadKey])

  const isFollowing = useCallback((artistId: string) => ids.has(artistId), [ids])
  const retry = useCallback(() => setReloadKey((k) => k + 1), [])

  const toggleFollow = useCallback(
    async (artistId: string) => {
      if (!userId) return false
      // A second tap before the first settles would send a contradictory write.
      if (busy.current.has(artistId)) return ids.has(artistId)

      const next = !ids.has(artistId)
      busy.current.add(artistId)

      setIds((prev) => {
        const copy = new Set(prev)
        if (next) copy.add(artistId)
        else copy.delete(artistId)
        return copy
      })

      try {
        await setArtistFollow(userId, artistId, next)
        setError(false)
        return next
      } catch (err) {
        console.error('[beatboxed] follow write failed:', err)
        setIds((prev) => {
          const copy = new Set(prev)
          if (next) copy.delete(artistId)
          else copy.add(artistId)
          return copy
        })
        setError(true)
        throw err
      } finally {
        busy.current.delete(artistId)
      }
    },
    [ids, userId]
  )

  const value = useMemo<FollowsApi>(
    () => ({ isFollowing, loading, error, retry, toggleFollow }),
    [isFollowing, loading, error, retry, toggleFollow]
  )

  return <FollowsContext.Provider value={value}>{children}</FollowsContext.Provider>
}

export function useFollows() {
  const ctx = useContext(FollowsContext)
  if (!ctx) {
    // Loud on purpose: a button outside the provider should fail in
    // development rather than quietly never working.
    throw new Error(
      'useFollows must be used inside <FollowsProvider>. ' +
        'FollowButton needs the provider above it in the tree.'
    )
  }
  return ctx
}
