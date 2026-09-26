import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { Rail, RailSkeleton } from '@/components/home/Rail'
import { useProfile } from '@/hooks/useProfile'
import { getHomeFeedData, type HomeFeed } from '@/lib/mockData'

function greetingFor(hour: number) {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function Home() {
  const navigate = useNavigate()
  const { displayName, loading: profileLoading } = useProfile()
  const [feed, setFeed] = useState<HomeFeed | null>(null)

  useEffect(() => {
    let cancelled = false
    getHomeFeedData().then((data) => {
      if (!cancelled) setFeed(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const greeting = greetingFor(new Date().getHours())

  return (
    <div className="flex flex-col gap-10 pb-4">
      <header className="flex items-center gap-3">
        <Logo variant="icon" glow="sm" className="size-10" />
        <h1 className="min-w-0 text-page-title">
          {greeting}
          {profileLoading ? (
            <span className="ml-2 inline-block h-6 w-28 animate-pulse rounded bg-surface-2 align-middle" />
          ) : (
            <>
              , <span className="text-accent">{displayName}</span>
            </>
          )}
        </h1>

        <button
          type="button"
          onClick={() => navigate('/explore', { state: { autoFocus: true } })}
          aria-label="Search"
          className="ml-auto grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-all duration-200 ease-soft hover:bg-white/5 hover:text-foreground active:scale-95"
        >
          <Search className="size-5" strokeWidth={1.75} />
        </button>
      </header>

      {feed === null ? (
        <>
          <RailSkeleton title="Continue Listening" />
          <RailSkeleton title="Trending" />
          <RailSkeleton title="For You" />
        </>
      ) : (
        <>
          <Rail
            title="Continue Listening"
            songs={feed.continueListening}
            emptyMessage="Nothing here yet — play something and it'll show up."
          />
          <Rail
            title="Trending"
            songs={feed.trending}
            emptyMessage="No reviews yet. Be the first to rate a song."
          />
          <Rail
            title="For You"
            songs={feed.forYou}
            emptyMessage="Follow a few artists and we'll build you a feed."
          />
        </>
      )}
    </div>
  )
}
