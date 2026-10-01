import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, Loader2, MicVocal, Search, SearchX, X } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { MediaCard } from '@/components/ui/MediaCard'
import { GenreTile } from '@/components/explore/GenreTile'
import { ArtistResultCard } from '@/components/explore/ArtistResultCard'
import { LyricResultCard } from '@/components/explore/LyricResultCard'
import { PersonCard } from '@/components/people/PersonCard'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useAuth } from '@/lib/auth'
import {
  getFollowedArtistIds,
  getFriendStates,
  getGenres,
  popularSearches,
  searchCatalog,
  searchEverything,
} from '@/lib/catalog'
import type {
  FriendState,
  LyricMatch,
  UnifiedResults,
} from '@/lib/types'

/** Router state set by the Home search button; see src/pages/Home.tsx. */
type ExploreNavState = { autoFocus?: boolean } | null

/** `all` is the default — nobody should pick a type before they can search. */
type Filter = 'all' | 'songs' | 'artists' | 'people' | 'lyrics'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'songs', label: 'Songs' },
  { value: 'artists', label: 'Artists' },
  { value: 'people', label: 'People' },
  { value: 'lyrics', label: 'Lyrics' },
]

/** How many of each section show before "See all". */
const PREVIEW = 4

export default function Explore() {
  const { user } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const location = useLocation()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [genre, setGenre] = useState<string | null>(null)

  const debouncedQuery = useDebouncedValue(query, 250)
  const [genres, setGenres] = useState<string[]>([])
  const [followed, setFollowed] = useState<Set<string>>(new Set())
  const [friendStates, setFriendStates] = useState<Map<string, FriendState>>(
    new Map()
  )

  const [results, setResults] = useState<UnifiedResults | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Lyrics are opt-in: one Edge Function call per candidate song is far too
  // slow to fire on every keystroke.
  const [lyrics, setLyrics] = useState<LyricMatch[] | null>(null)
  const [lyricsLoading, setLyricsLoading] = useState(false)

  useEffect(() => {
    getGenres()
      .then(setGenres)
      .catch((err) => console.warn('[beatboxed] genre list failed:', err))
  }, [])

  useEffect(() => {
    if (!user) return setFollowed(new Set())
    getFollowedArtistIds(user.id)
      .then(setFollowed)
      .catch((err) => console.warn('[beatboxed] follow state failed:', err))
  }, [user])

  useEffect(() => {
    let current = true
    setSearching(true)
    setError(null)
    setExpanded(new Set())
    setLyrics(null)

    searchEverything(debouncedQuery, genre, user?.id)
      .then(async (r) => {
        if (!current) return
        setResults(r)
        if (user && r.people.length > 0) {
          try {
            setFriendStates(
              await getFriendStates(user.id, r.people.map((p) => p.id))
            )
          } catch (err) {
            console.warn('[beatboxed] friend states failed:', err)
          }
        }
      })
      .catch((err: unknown) => {
        if (!current) return
        console.error('[beatboxed] search failed:', err)
        setError('Search failed. Check your connection and try again.')
      })
      .finally(() => {
        if (current) setSearching(false)
      })

    return () => {
      current = false
    }
  }, [debouncedQuery, genre, user])

  // Lyrics run only when asked for — chip selected, or the explicit row tapped.
  useEffect(() => {
    if (filter !== 'lyrics' || !debouncedQuery.trim() || lyrics) return
    let current = true
    setLyricsLoading(true)
    searchCatalog(debouncedQuery, 'lyrics', genre)
      .then((r) => {
        if (current && r.mode === 'lyrics') setLyrics(r.lyrics)
      })
      .catch((err) => {
        console.error('[beatboxed] lyrics search failed:', err)
        if (current) setLyrics([])
      })
      .finally(() => {
        if (current) setLyricsLoading(false)
      })
    return () => {
      current = false
    }
  }, [filter, debouncedQuery, genre, lyrics])

  useEffect(() => {
    const state = location.state as ExploreNavState
    if (!state?.autoFocus) return
    inputRef.current?.focus()
    // Drop the flag so back/forward onto this entry doesn't steal focus again.
    navigate(location.pathname, { replace: true, state: null })
  }, [location, navigate])

  const isBrowsing = debouncedQuery.trim() === '' && genre === null
  const show = (section: Filter) => filter === 'all' || filter === section
  const sliceFor = (key: string, items: unknown[]) =>
    expanded.has(key) ? items.length : PREVIEW

  const total =
    (results?.songs.length ?? 0) +
    (results?.artists.length ?? 0) +
    (results?.people.length ?? 0)

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
            placeholder="Search songs, artists, people, or lyrics..."
            aria-label="Search"
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
          aria-label="Filter results"
        >
          {FILTERS.map((f) => (
            <Chip
              key={f.value}
              active={filter === f.value}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Chip>
          ))}
        </div>

        {filter !== 'people' && (
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
        )}
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
      ) : error ? (
        <div className="rounded-card bg-surface px-6 py-14 text-center">
          <p className="text-body text-danger">{error}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {results?.warning && (
            <div
              role="status"
              className="animate-fade-in flex items-start gap-2.5 rounded-button bg-surface-2 px-3.5 py-3 text-secondary"
            >
              <AlertTriangle
                className="mt-px size-[18px] shrink-0 text-star"
                strokeWidth={2}
                aria-hidden
              />
              <span className="text-muted-foreground">{results.warning}</span>
            </div>
          )}

          {searching && !results && (
            <div className="flex items-center gap-2 px-1 text-body text-muted-foreground">
              <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
              Searching…
            </div>
          )}

          {show('songs') && results && results.songs.length > 0 && (
            <Section
              title="Songs"
              count={results.songs.length}
              shown={sliceFor('songs', results.songs)}
              onSeeAll={() => setExpanded((p) => new Set(p).add('songs'))}
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
                {results.songs
                  .slice(0, sliceFor('songs', results.songs))
                  .map((song, i) => (
                    <MediaCard
                      key={song.id}
                      to={`/song/${song.id}`}
                      title={song.title}
                      subtitle={song.artistName}
                      coverUrl={song.coverUrl}
                      ratingAvg={song.ratingAvg}
                      reviewCount={song.reviewCount}
                      tint={
                        results.songs.length > 1
                          ? i / (results.songs.length - 1)
                          : 0.5
                      }
                    />
                  ))}
              </div>
            </Section>
          )}

          {show('artists') && results && results.artists.length > 0 && (
            <Section
              title="Artists"
              count={results.artists.length}
              shown={sliceFor('artists', results.artists)}
              onSeeAll={() => setExpanded((p) => new Set(p).add('artists'))}
            >
              <div className="flex flex-col gap-3">
                {results.artists
                  .slice(0, sliceFor('artists', results.artists))
                  .map((artist) => (
                    <ArtistResultCard
                      key={artist.id}
                      artist={artist}
                      following={followed.has(artist.id)}
                      onFollowChange={(next) =>
                        setFollowed((prev) => {
                          const copy = new Set(prev)
                          if (next) copy.add(artist.id)
                          else copy.delete(artist.id)
                          return copy
                        })
                      }
                    />
                  ))}
              </div>
            </Section>
          )}

          {show('people') && results && results.people.length > 0 && (
            <Section
              title="People"
              count={results.people.length}
              shown={sliceFor('people', results.people)}
              onSeeAll={() => setExpanded((p) => new Set(p).add('people'))}
            >
              <div className="flex flex-col gap-3">
                {results.people
                  .slice(0, sliceFor('people', results.people))
                  .map((person) => (
                    <PersonCard
                      key={person.id}
                      person={person}
                      state={friendStates.get(person.id) ?? 'none'}
                      onStateChange={(next) =>
                        setFriendStates((prev) =>
                          new Map(prev).set(person.id, next)
                        )
                      }
                    />
                  ))}
              </div>
            </Section>
          )}

          {/* Lyrics: a tap away in All, automatic once the chip is selected. */}
          {filter === 'all' && debouncedQuery.trim() && (
            <button
              type="button"
              onClick={() => setFilter('lyrics')}
              className="flex items-center gap-2.5 rounded-card bg-surface px-5 py-4 text-left shadow-card transition-colors duration-200 ease-soft hover:bg-surface-2"
            >
              <MicVocal className="size-[18px] shrink-0 text-primary" strokeWidth={1.75} />
              <span className="text-button text-foreground">
                Search lyrics for “{debouncedQuery.trim()}”
              </span>
            </button>
          )}

          {filter === 'lyrics' && (
            <section className="flex flex-col gap-4">
              <h2 className="text-section-title">Lyrics</h2>
              {lyricsLoading ? (
                <div className="flex items-center gap-2 px-1 text-body text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
                  Searching lyrics… this one takes a moment.
                </div>
              ) : !lyrics || lyrics.length === 0 ? (
                <EmptyPanel
                  title="No lyric matches"
                  detail={`Nothing in the lyrics we have for “${debouncedQuery.trim()}”.`}
                />
              ) : (
                <div className="flex flex-col gap-3">
                  {lyrics.map((m) => (
                    <LyricResultCard key={`${m.songId}-${m.line}`} match={m} />
                  ))}
                </div>
              )}
            </section>
          )}

          {!searching && results && total === 0 && filter !== 'lyrics' && (
            <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-14 text-center">
              <SearchX className="size-7 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              <p className="text-card-title">No matches</p>
              <p className="max-w-sm text-body text-muted-foreground">
                Nothing here for{' '}
                {debouncedQuery ? `“${debouncedQuery}”` : 'that filter'}. Try a
                different spelling, or search the lyrics instead.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Section({
  title,
  count,
  shown,
  onSeeAll,
  children,
}: {
  title: string
  count: number
  shown: number
  onSeeAll: () => void
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-section-title">
          {title}{' '}
          <span className="text-secondary text-muted-foreground">({count})</span>
        </h2>
        {shown < count && (
          <button
            type="button"
            onClick={onSeeAll}
            className="shrink-0 rounded-button px-2 py-1 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-accent"
          >
            See all
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card bg-surface px-6 py-12 text-center">
      <p className="text-card-title">{title}</p>
      <p className="max-w-sm text-body text-muted-foreground">{detail}</p>
    </div>
  )
}
