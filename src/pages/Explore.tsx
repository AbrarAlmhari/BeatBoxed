import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Search, SearchX, X } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { MediaCard } from '@/components/ui/MediaCard'
import { GenreTile } from '@/components/explore/GenreTile'
import { ArtistResultCard } from '@/components/explore/ArtistResultCard'
import { LyricResultCard } from '@/components/explore/LyricResultCard'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { getGenres, popularSearches, searchCatalog } from '@/lib/mockData'
import type { SearchMode } from '@/lib/types'

/** Router state set by the Home search button; see src/pages/Home.tsx. */
type ExploreNavState = { autoFocus?: boolean } | null

const MODES: { value: SearchMode; label: string }[] = [
  { value: 'songs', label: 'Songs' },
  { value: 'artists', label: 'Artists' },
  { value: 'lyrics', label: 'Lyrics' },
]

export default function Explore() {
  const inputRef = useRef<HTMLInputElement>(null)
  const location = useLocation()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<SearchMode>('songs')
  const [genre, setGenre] = useState<string | null>(null)

  const debouncedQuery = useDebouncedValue(query, 250)
  const genres = useMemo(getGenres, [])

  const results = useMemo(
    () => searchCatalog(debouncedQuery, mode, genre),
    [debouncedQuery, mode, genre]
  )

  useEffect(() => {
    const state = location.state as ExploreNavState
    if (!state?.autoFocus) return

    inputRef.current?.focus()

    // Drop the flag so back/forward onto this entry doesn't steal focus again.
    // Replacing with null state re-runs this effect, which then exits above.
    navigate(location.pathname, { replace: true, state: null })
  }, [location, navigate])

  const isBrowsing = debouncedQuery.trim() === '' && genre === null
  const resultCount =
    results.mode === 'songs'
      ? results.songs.length
      : results.mode === 'artists'
        ? results.artists.length
        : results.lyrics.length

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <h1 className="text-page-title">Explore</h1>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search songs, artists, or lyrics..."
            aria-label="Search songs, artists, or lyrics"
            className="w-full rounded-button border border-white/5 bg-surface-2 py-3 pl-11 pr-11 text-body text-foreground transition-colors duration-200 ease-soft placeholder:text-muted-foreground/70 hover:border-white/10 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
              aria-label="Clear search"
              className="absolute right-0 top-0 grid h-full w-11 place-items-center rounded-r-button text-muted-foreground transition-colors duration-200 hover:text-foreground"
            >
              <X className="size-[18px]" strokeWidth={1.75} />
            </button>
          )}
        </div>

        <div
          className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
          role="group"
          aria-label="Search mode"
        >
          {MODES.map((m) => (
            <Chip
              key={m.value}
              active={mode === m.value}
              onClick={() => setMode(m.value)}
            >
              {m.label}
            </Chip>
          ))}
        </div>

        <div
          className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
          role="group"
          aria-label="Filter by genre"
        >
          <Chip active={genre === null} onClick={() => setGenre(null)}>
            All genres
          </Chip>
          {genres.map((g) => (
            <Chip
              key={g}
              active={genre === g}
              onClick={() => setGenre(genre === g ? null : g)}
            >
              <span className="capitalize">{g}</span>
            </Chip>
          ))}
        </div>
      </div>

      {isBrowsing ? (
        <>
          <section className="flex flex-col gap-4">
            <h2 className="text-section-title">Browse by genre</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
              {genres.map((g) => (
                <GenreTile key={g} genre={g} onClick={() => setGenre(g)} />
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="text-section-title">Popular searches</h2>
            <div className="flex flex-wrap gap-2">
              {popularSearches.map((term) => (
                <Chip
                  key={term}
                  active={false}
                  onClick={() => {
                    setQuery(term)
                    inputRef.current?.focus()
                  }}
                >
                  {term}
                </Chip>
              ))}
            </div>
          </section>
        </>
      ) : resultCount === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-14 text-center">
          <SearchX
            className="size-7 text-muted-foreground"
            strokeWidth={1.5}
            aria-hidden
          />
          <p className="text-card-title">No matches</p>
          <p className="max-w-sm text-body text-muted-foreground">
            Nothing here for {debouncedQuery ? `"${debouncedQuery}"` : 'that filter'}.
            Try a different spelling, or switch search mode.
          </p>
        </div>
      ) : (
        <section className="flex flex-col gap-4">
          <h2 className="text-section-title">
            {resultCount} {resultCount === 1 ? 'result' : 'results'}
          </h2>

          {results.mode === 'songs' && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
              {results.songs.map((song, i) => (
                <MediaCard
                  key={song.id}
                  title={song.title}
                  subtitle={song.artistName}
                  coverUrl={song.coverUrl}
                  ratingAvg={song.ratingAvg}
                  reviewCount={song.reviewCount}
                  tint={
                    results.songs.length > 1 ? i / (results.songs.length - 1) : 0.5
                  }
                />
              ))}
            </div>
          )}

          {results.mode === 'artists' && (
            <div className="flex flex-col gap-3">
              {results.artists.map((artist) => (
                <ArtistResultCard key={artist.id} artist={artist} />
              ))}
            </div>
          )}

          {results.mode === 'lyrics' && (
            <div className="flex flex-col gap-3">
              {results.lyrics.map((match) => (
                <LyricResultCard
                  key={`${match.songId}-${match.line}`}
                  match={match}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
