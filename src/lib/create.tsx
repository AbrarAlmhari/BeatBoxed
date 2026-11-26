import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ReviewComposer } from '@/components/feed/ReviewComposer'
import { AskBeatieSheet } from '@/components/beatie/AskBeatieSheet'
import { useToast } from '@/lib/toast'
import type { FeedReview } from '@/lib/feed'

type PostedHandler = (review: FeedReview, wasEdit: boolean) => void

type CreateApi = {
  /** The review composer (the same one Home always used). */
  openComposer: () => void
  /** Ask Beatie's song picker and chat. */
  openBeatie: () => void
  /**
   * Home shows a posted review at the top of its feed; while it's on
   * screen it handles "posted". Anywhere else a toast links to the song.
   */
  setPostedHandler: (fn: PostedHandler | null) => void
}

const Ctx = createContext<CreateApi | null>(null)

/**
 * One composer and one Ask Beatie sheet for the whole app, so the bottom
 * bar's Create button and Home open the very same ones.
 */
export function CreateProvider({ children }: { children: ReactNode }) {
  const [composing, setComposing] = useState(false)
  const [asking, setAsking] = useState(false)
  const handler = useRef<PostedHandler | null>(null)
  const toast = useToast()
  const navigate = useNavigate()

  const api = useMemo<CreateApi>(
    () => ({
      openComposer: () => setComposing(true),
      openBeatie: () => setAsking(true),
      setPostedHandler: (fn) => {
        handler.current = fn
      },
    }),
    []
  )

  const onPosted = useCallback(
    (review: FeedReview, wasEdit: boolean) => {
      setComposing(false)
      if (handler.current) return handler.current(review, wasEdit)
      toast.show({
        message: wasEdit ? 'Review updated' : 'Review posted',
        actionLabel: 'View song',
        onAction: () => navigate(`/song/${review.song.id}`),
      })
    },
    [toast, navigate]
  )

  return (
    <Ctx.Provider value={api}>
      {children}
      <ReviewComposer open={composing} onClose={() => setComposing(false)} onPosted={onPosted} />
      <AskBeatieSheet open={asking} onClose={() => setAsking(false)} />
    </Ctx.Provider>
  )
}

export function useCreate() {
  const api = useContext(Ctx)
  if (!api) throw new Error('useCreate outside CreateProvider')
  return api
}
