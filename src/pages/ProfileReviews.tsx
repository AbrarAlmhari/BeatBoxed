import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Chip } from '@/components/ui/Chip'
import { ProfileReviewCard } from '@/components/profile/ProfileReviewCard'
import { ListPageShell } from '@/components/profile/ListPageShell'
import { useAuth } from '@/lib/auth'
import { getProfileDetail, getReviewsByUserPage, type ReviewSort } from '@/lib/catalog'
import type { ReviewWithSong } from '@/lib/types'

const PAGE = 30

const SORTS: { value: ReviewSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'highest', label: 'Highest rated' },
  { value: 'lowest', label: 'Lowest rated' },
]

export default function ProfileReviews() {
  const { userId } = useParams()
  const { user } = useAuth()
  const targetId = userId ?? user?.id ?? ''
  const isOwn = Boolean(user && targetId === user.id)

  const [name, setName] = useState<string | null>(null)
  const [reviews, setReviews] = useState<ReviewWithSong[]>([])
  const [sort, setSort] = useState<ReviewSort>('newest')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)

  useEffect(() => {
    if (!targetId) return
    let cancelled = false
    setLoading(true)

    // Re-reads from the server on sort change: ordering the loaded page only
    // would sort a slice rather than the whole list.
    Promise.all([
      getProfileDetail(targetId),
      getReviewsByUserPage(targetId, { limit: PAGE, sort }),
    ])
      .then(([profile, page]) => {
        if (cancelled) return
        setName(profile?.displayName || profile?.username || 'Listener')
        setReviews(page)
        setExhausted(page.length < PAGE)
      })
      .catch((err) => console.error('[beatboxed] reviews list failed:', err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [targetId, sort])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const next = await getReviewsByUserPage(targetId, {
        limit: PAGE,
        offset: reviews.length,
        sort,
      })
      setReviews((prev) => [...prev, ...next])
      setExhausted(next.length < PAGE)
    } catch (err) {
      console.error('[beatboxed] load more reviews failed:', err)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <ListPageShell
      title={isOwn ? 'Your reviews' : `${name ?? 'Listener'}'s reviews`}
      toolbar={
        <div
          className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
          role="group"
          aria-label="Sort reviews"
        >
          {SORTS.map((s) => (
            <Chip key={s.value} active={sort === s.value} onClick={() => setSort(s.value)}>
              {s.label}
            </Chip>
          ))}
        </div>
      }
      loading={loading}
      isEmpty={reviews.length === 0}
      emptyTitle="No reviews yet"
      emptyDetail={
        isOwn
          ? "Rate a song and it'll show up here."
          : `${name ?? 'This listener'} hasn't reviewed anything yet.`
      }
      hasMore={!exhausted}
      loadingMore={loadingMore}
      onLoadMore={loadMore}
    >
      <div className="flex flex-col gap-3">
        {reviews.map((r) => (
          <ProfileReviewCard key={r.id} review={r} />
        ))}
      </div>
    </ListPageShell>
  )
}
