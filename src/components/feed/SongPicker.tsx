import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { AudioLines, ChevronRight, Loader2, Search } from 'lucide-react'
import { Artwork } from './Artwork'
import { usePlayer } from '@/lib/player'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { normalizeSearch, searchCatalog } from '@/lib/catalog'
import { cn } from '@/lib/cn'
import type { SongCardModel } from '@/lib/types'

type Option = { song: SongCardModel; group: 'now-playing' | 'results' }

/**
 * "Which song is this about?": a combobox over the same searchCatalog()
 * Explore uses, including its Spotify top-up. The input and its listbox share
 * one border so they read as one control. Whatever is playing is offered
 * first, under "Now playing".
 *
 * Shared by the review composer and Home's Ask Beatie sheet. The query is
 * the caller's state, so going back to this step keeps what was typed.
 */
export function SongPicker({
  query,
  onQueryChange,
  onPick,
  inputRef,
  label = 'Which song is this about?',
  renderBadge,
  onOptionIdsChange,
}: {
  query: string
  onQueryChange: (q: string) => void
  onPick: (song: SongCardModel) => void
  inputRef?: RefObject<HTMLInputElement | null>
  label?: string
  /** Shown at the end of a row in place of the chevron, e.g. "Reviewed". */
  renderBadge?: (song: SongCardModel) => ReactNode | null
  /** Every song currently offered, so a caller can look things up for them. */
  onOptionIdsChange?: (ids: string[]) => void
}) {
  const player = usePlayer()
  const listId = useId()
  const debounced = useDebouncedValue(query, 250)
  const [results, setResults] = useState<SongCardModel[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [toppingUp, setToppingUp] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [active, setActive] = useState(-1)

  // Cached matches first, then whatever the Spotify top-up adds.
  useEffect(() => {
    const q = debounced.trim()
    if (!q) {
      setResults(null)
      setSearching(false)
      setToppingUp(false)
      setSearchError(false)
      return
    }
    let current = true
    setSearching(true)
    setSearchError(false)
    searchCatalog(q, 'songs', null, {
      onLocalResults: (songs) => {
        if (!current) return
        setResults(songs)
        setToppingUp(true)
      },
    })
      .then((r) => {
        if (current && r.mode === 'songs') setResults(r.songs)
      })
      .catch((err: unknown) => {
        console.error('[beatboxed] song picker search failed:', err)
        if (current) setSearchError(true)
      })
      .finally(() => {
        if (!current) return
        setSearching(false)
        setToppingUp(false)
      })
    return () => {
      current = false
    }
  }, [debounced])

  const nowPlaying = player.current
  const options: Option[] = useMemo(() => {
    const list: Option[] = []
    if (nowPlaying) list.push({ song: nowPlaying, group: 'now-playing' })
    for (const song of results ?? []) {
      // Already offered under Now playing; once is enough.
      if (song.id !== nowPlaying?.id) list.push({ song, group: 'results' })
    }
    return list
  }, [nowPlaying, results])

  const optionIds = options.map((o) => o.song.id).join(',')
  useEffect(() => {
    onOptionIdsChange?.(optionIds ? optionIds.split(',') : [])
    // onOptionIdsChange is a fresh closure each render; the ids are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionIds])

  // A new result list starts with nothing highlighted.
  useEffect(() => setActive(-1), [results])

  const typed = query.trim().length > 0
  const listOpen = options.length > 0 || (typed && (results !== null || searching || searchError))

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (options.length) setActive((i) => (i + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (options.length) setActive((i) => (i <= 0 ? options.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const option = options[active] ?? (options.length === 1 ? options[0] : undefined)
      if (option) onPick(option.song)
    } else if (e.key === 'Escape' && (query || active >= 0)) {
      // First Escape clears the search; a second one closes the sheet.
      e.preventDefault()
      e.stopPropagation()
      onQueryChange('')
      setActive(-1)
    }
  }

  const activeId = active >= 0 ? `${listId}-opt-${active}` : undefined
  const words = useMemo(() => normalizeSearch(query).split(' ').filter(Boolean), [query])

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={`${listId}-search`} className="text-secondary text-muted-foreground">
        {label}
      </label>
      {/* One bordered control: the input, and the list hanging off it. */}
      <div className="overflow-hidden rounded-card border border-white/10 bg-surface-2 transition-colors duration-200 ease-soft focus-within:border-primary/70">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            ref={inputRef}
            id={`${listId}-search`}
            type="text"
            role="combobox"
            aria-expanded={Boolean(listOpen)}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            autoComplete="off"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search for a song or artist"
            className="w-full bg-transparent py-3.5 pl-11 pr-4 text-body text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          />
        </div>

        {listOpen && (
          <div className="border-t border-white/5">
            <ul id={listId} role="listbox" aria-label="Songs" className="flex flex-col py-1">
              {options.map((o, i) => (
                <Fragment key={`${o.group}-${o.song.id}`}>
                  {(i === 0 || options[i - 1].group !== o.group) && (
                    <li
                      role="presentation"
                      className={cn(
                        'px-4 pb-1.5 pt-2.5 text-meta uppercase tracking-wide text-muted-foreground',
                        i > 0 && 'mt-1 border-t border-white/5'
                      )}
                    >
                      {o.group === 'now-playing' ? 'Now playing' : 'Songs'}
                    </li>
                  )}
                  <SongOption
                    id={`${listId}-opt-${i}`}
                    song={o.song}
                    words={o.group === 'results' ? words : []}
                    active={i === active}
                    badge={renderBadge?.(o.song) ?? null}
                    nowPlaying={o.group === 'now-playing'}
                    onHover={() => setActive(i)}
                    onPick={() => onPick(o.song)}
                  />
                </Fragment>
              ))}
            </ul>

            {typed && searchError && (
              <p className="px-4 py-3 text-secondary text-danger">
                Search failed. Check your connection and try again.
              </p>
            )}
            {typed && !searching && !searchError && results?.length === 0 && (
              <p className="px-4 py-3 text-secondary text-muted-foreground">
                No songs found. Try adding the artist's name.
              </p>
            )}
            {typed && (toppingUp || (searching && results === null)) && (
              <p
                role="status"
                className="flex items-center gap-2 border-t border-white/5 px-4 py-3 text-secondary text-muted-foreground"
              >
                <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
                {toppingUp ? 'Looking on Spotify for more matches…' : 'Searching…'}
              </p>
            )}
          </div>
        )}
      </div>
      <p className="text-secondary text-muted-foreground">
        Tip: add the artist to narrow it down, like “karma radiohead”.
      </p>
    </div>
  )
}

function SongOption({
  id,
  song,
  words,
  active,
  badge,
  nowPlaying,
  onHover,
  onPick,
}: {
  id: string
  song: SongCardModel
  words: string[]
  active: boolean
  badge: ReactNode | null
  nowPlaying: boolean
  onHover: () => void
  onPick: () => void
}) {
  return (
    <li
      ref={(el) => {
        // Keep the keyboard's current option in view inside the sheet.
        if (active) el?.scrollIntoView({ block: 'nearest' })
      }}
      id={id}
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      // mousedown, not click: keeps focus in the input, as a combobox should.
      onMouseDown={(e) => {
        e.preventDefault()
        onPick()
      }}
      className={cn(
        'flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors duration-150 ease-soft',
        active ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'
      )}
    >
      <Artwork src={song.coverUrl} seed={song.id} className="size-11" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span dir="auto" className="truncate text-card-title">
          <Highlighted text={song.title} words={words} />
        </span>
        <span className="truncate text-secondary text-muted-foreground">
          {[song.artistName, song.albumTitle].filter(Boolean).join(' · ')}
        </span>
      </span>
      {badge ? (
        badge
      ) : nowPlaying ? (
        <AudioLines className="size-4 shrink-0 text-primary" strokeWidth={2} aria-label="Playing" />
      ) : (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
      )}
    </li>
  )
}

/** The title with the typed words picked out in the accent colour. */
function Highlighted({ text, words }: { text: string; words: string[] }) {
  if (words.length === 0) return <>{text}</>
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-transparent text-accent">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  )
}
