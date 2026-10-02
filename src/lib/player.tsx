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
import { getPreview, type PreviewResult } from './preview'
import { recordPlay, savePlayPosition } from './catalog'
import { useAuth } from './auth'
import type { SongCardModel } from './types'

export type PlayerTrack = SongCardModel & {
  itunesTrackId?: number | null
  itunesCheckedAt?: string | null
  spotifyId?: string | null
  /** Seconds to pick up from, when this came out of Continue Listening. */
  resumeAt?: number
}

/**
 * A play only counts once it has run this long. Tapping a card and skipping
 * straight on isn't listening, and letting it count would fill Continue
 * Listening with songs the user rejected.
 */
const MIN_PLAY_SECONDS = 5

/**
 * Treat a stored position this close to the end as finished and start over.
 * Resuming someone at 0:29 of a 30-second preview is useless.
 */
const NEARLY_DONE_SECONDS = 3

/**
 * How long "no preview, skipping" stays up before moving on. Long enough to
 * read why the song changed by itself, short enough not to feel stuck.
 */
const SKIP_NOTICE_MS = 2000

type PlayerState = {
  current: PlayerTrack | null
  queue: PlayerTrack[]
  index: number
  isPlaying: boolean
  /** True while the preview URL is being resolved. */
  loading: boolean
  /** No iTunes match — offer Spotify instead of a dead play button. */
  unavailable: boolean
  /**
   * Why the player is about to move on by itself, shown where the mini
   * player normally puts the artist name. Null when nothing to say.
   */
  skipNotice: string | null
  position: number
  duration: number
}

type PlayerApi = PlayerState & {
  /**
   * Bumped whenever a play is recorded. Home watches it so Continue
   * Listening refreshes without a reload.
   */
  historyVersion: number
  /** Queues the whole list from the tapped song, so next/previous work. */
  playQueue: (tracks: PlayerTrack[], startIndex: number) => void
  toggle: (track?: PlayerTrack) => void
  next: () => void
  previous: () => void
  seek: (seconds: number) => void
  stop: () => void
}

const PlayerContext = createContext<PlayerApi | null>(null)

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  // One element for the whole app, so audio survives navigation.
  const audioRef = useRef<HTMLAudioElement | null>(null)
  if (!audioRef.current && typeof Audio !== 'undefined') {
    audioRef.current = new Audio()
    audioRef.current.preload = 'none'
  }

  const [state, setState] = useState<PlayerState>({
    current: null,
    queue: [],
    index: -1,
    isPlaying: false,
    loading: false,
    unavailable: false,
    skipNotice: null,
    position: 0,
    duration: 0,
  })

  // Guards against a slow lookup for a track the user already moved past.
  const loadToken = useRef(0)

  const [historyVersion, setHistoryVersion] = useState(0)
  /** Real seconds of audio heard for the current track, seeks excluded. */
  const listened = useRef(0)
  /** Previous currentTime, to turn timeupdate into a delta. */
  const lastTime = useRef(0)
  /** Song id already written to play_history, and so safe to update. */
  const recorded = useRef<string | null>(null)
  /**
   * A Continue Listening card already has its row, so moving its resume point
   * isn't counting a play and needs no 5-second wait: pausing a resumed song
   * after 2 seconds should still remember where it stopped. Armed only once
   * the new source's metadata loads, so a late pause from the outgoing track
   * can't write its position onto this song.
   */
  const resumeCandidate = useRef<string | null>(null)
  const resuming = useRef<string | null>(null)
  /** Positions saved this session, newer than any card already on screen. */
  const savedPositions = useRef(new Map<string, number>())
  /** Resume point to apply once metadata gives us a duration. */
  const pendingSeek = useRef<number | null>(null)
  /** Handlers fire outside render; they need these without a redraw. */
  const currentTrack = useRef<PlayerTrack | null>(null)
  /**
   * play_history writes, chained so they land in the order they were made.
   * Otherwise a pause right after the 5-second mark can update a row whose
   * insert hasn't arrived yet, and the resume point is silently lost.
   */
  const writes = useRef<Promise<unknown>>(Promise.resolve())
  const enqueueWrite = useCallback((write: () => Promise<unknown>) => {
    // A failed write must not wedge the chain for every write after it.
    writes.current = writes.current.then(write).catch((err: unknown) => {
      console.warn('[beatboxed] play history write failed:', err)
    })
  }, [])
  /**
   * Songs known to have no preview, for this session. iTunes is rate
   * limited and the answer doesn't change mid-session, so a queue full of
   * unplayable songs costs one lookup each rather than one per attempt.
   */
  const noPreview = useRef(new Set<string>())
  /** One song looked up ahead of time, so the next track starts instantly. */
  const prefetched = useRef(new Map<string, PreviewResult>())
  /** The pending auto-skip, so Next can pre-empt it. */
  const skipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Queue and position, readable from async code without a stale closure. */
  const queueRef = useRef<PlayerTrack[]>([])
  const indexRef = useRef(-1)
  /** load() needs to start the next track, which is defined after it. */
  const playAtRef = useRef<(index: number, direction: 1 | -1) => void>(() => {})

  const cancelSkip = useCallback(() => {
    if (skipTimer.current) clearTimeout(skipTimer.current)
    skipTimer.current = null
  }, [])

  /** Preview lookup with the session cache and the one-ahead prefetch in front. */
  const resolvePreview = useCallback(
    async (track: PlayerTrack): Promise<PreviewResult> => {
      if (noPreview.current.has(track.id)) return { status: 'unavailable' }
      const ready = prefetched.current.get(track.id)
      if (ready) {
        prefetched.current.delete(track.id)
        return ready
      }
      const result = await getPreview({
        id: track.id,
        title: track.title,
        artistName: track.artistName,
        itunesTrackId: track.itunesTrackId,
        itunesCheckedAt: track.itunesCheckedAt,
      })
      if (result.status !== 'ok') noPreview.current.add(track.id)
      return result
    },
    []
  )

  const userId = useRef<string | null>(null)
  useEffect(() => {
    userId.current = user?.id ?? null
  }, [user])
  useEffect(() => {
    currentTrack.current = state.current
  }, [state.current])

  /**
   * Writes the resume point for whatever is loaded. Only ever touches a song
   * that already has a row, so a skip leaves no trace.
   */
  const flushPosition = useCallback((position?: number) => {
    const audio = audioRef.current
    const songId = recorded.current ?? resuming.current
    const uid = userId.current
    if (!audio || !songId || !uid) return
    // Heard to the end means next time starts over, not at 0:30. Read now:
    // currentTime is gone by the time a queued write runs.
    const at = position ?? (audio.ended ? 0 : audio.currentTime)
    savedPositions.current.set(songId, at)
    enqueueWrite(() => savePlayPosition(uid, songId, at))
  }, [enqueueWrite])

  const load = useCallback(async (
    track: PlayerTrack,
    autoplay: boolean,
    /** Which way to keep going if this song turns out to be unplayable. */
    direction: 1 | -1 = 1
  ) => {
    const audio = audioRef.current
    if (!audio) return
    cancelSkip()

    // Save where the outgoing track got to before its currentTime is lost.
    flushPosition()
    listened.current = 0
    lastTime.current = 0
    recorded.current = null
    resuming.current = null
    resumeCandidate.current = track.resumeAt === undefined ? null : track.id
    // Only Continue Listening cards carry resumeAt; anywhere else starts at 0.
    // A position saved since the rail loaded is newer than the card's copy.
    const resumeAt =
      track.resumeAt === undefined
        ? undefined
        : savedPositions.current.get(track.id) ?? track.resumeAt
    pendingSeek.current = resumeAt && resumeAt > 0 ? resumeAt : null

    const token = ++loadToken.current

    setState((s) => ({
      ...s,
      current: track,
      loading: true,
      unavailable: false,
      skipNotice: null,
      position: 0,
      duration: 0,
    }))

    const result = await resolvePreview(track)
    if (token !== loadToken.current) return

    if (result.status !== 'ok') {
      audio.pause()

      // A song played on its own isn't a queue to move through: there's
      // nowhere to skip to, so it keeps the existing dead-end treatment with
      // the Open in Spotify fallback.
      const queue = queueRef.current
      if (queue.length <= 1) {
        setState((s) => ({
          ...s,
          loading: false,
          unavailable: true,
          isPlaying: false,
          skipNotice: null,
        }))
        return
      }

      const nextIndex = indexRef.current + direction
      if (!queue[nextIndex]) {
        // Walked off the end with nothing playable. Stop and say so rather
        // than leaving a silent player that looks broken.
        setState((s) => ({
          ...s,
          loading: false,
          unavailable: true,
          isPlaying: false,
          skipNotice: 'No previews available for the rest of this list.',
        }))
        return
      }

      setState((s) => ({
        ...s,
        loading: false,
        unavailable: true,
        isPlaying: false,
        skipNotice: `No preview for ${track.title} — skipping`,
      }))
      skipTimer.current = setTimeout(() => {
        skipTimer.current = null
        playAtRef.current(nextIndex, direction)
      }, SKIP_NOTICE_MS)
      return
    }

    audio.src = result.url
    setState((s) => ({ ...s, loading: false, unavailable: false, skipNotice: null }))
    if (autoplay) {
      try {
        await audio.play()
      } catch (err) {
        // Autoplay policies can refuse playback not tied to a gesture.
        console.warn('[beatboxed] playback blocked:', err)
        setState((s) => ({ ...s, isPlaying: false }))
      }
    }
  }, [cancelSkip, flushPosition, resolvePreview])

  /** Moves to a queue position and starts it, remembering which way we're going. */
  const playAt = useCallback(
    (index: number, direction: 1 | -1) => {
      const track = queueRef.current[index]
      if (!track) return
      indexRef.current = index
      setState((s) => ({ ...s, index }))
      void load(track, true, direction)
    },
    [load]
  )
  useEffect(() => {
    playAtRef.current = playAt
  }, [playAt])

  const playQueue = useCallback(
    (tracks: PlayerTrack[], startIndex: number) => {
      const track = tracks[startIndex]
      if (!track) return
      queueRef.current = tracks
      indexRef.current = startIndex
      setState((s) => ({ ...s, queue: tracks, index: startIndex }))
      void load(track, true)
    },
    [load]
  )

  const toggle = useCallback(
    (track?: PlayerTrack) => {
      const audio = audioRef.current
      if (!audio) return

      // Tapping a different song replaces what's playing.
      if (track && track.id !== state.current?.id) {
        queueRef.current = [track]
        indexRef.current = 0
        setState((s) => ({ ...s, queue: [track], index: 0 }))
        void load(track, true)
        return
      }
      if (!state.current) return

      if (audio.paused) void audio.play().catch(() => {})
      else audio.pause()
    },
    [load, state.current]
  )

  // Reads the refs, not state, so it still works while a load is in flight
  // or an auto-skip is counting down — and pre-empts that countdown.
  const next = useCallback(() => {
    cancelSkip()
    playAt(indexRef.current + 1, 1)
  }, [cancelSkip, playAt])

  const previous = useCallback(() => {
    const audio = audioRef.current
    const skipping = skipTimer.current !== null
    // Restart first, like every other player, before stepping back — but not
    // while the current song is failing, where restarting means nothing.
    if (!skipping && audio && audio.currentTime > 3) {
      audio.currentTime = 0
      return
    }
    cancelSkip()
    const at = indexRef.current - 1
    if (!queueRef.current[at]) {
      if (audio) audio.currentTime = 0
      return
    }
    playAt(at, -1)
  }, [cancelSkip, playAt])

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (audio) audio.currentTime = seconds
  }, [])

  const stop = useCallback(() => {
    const audio = audioRef.current
    cancelSkip()
    flushPosition()
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    loadToken.current++
    setState({
      current: null,
      queue: [],
      index: -1,
      isPlaying: false,
      loading: false,
      unavailable: false,
      skipNotice: null,
      position: 0,
      duration: 0,
    })
    queueRef.current = []
    indexRef.current = -1
    recorded.current = null
    resuming.current = null
    resumeCandidate.current = null
  }, [cancelSkip, flushPosition])

  /**
   * Look one song ahead while the current one plays, so a skip is instant and
   * an unplayable next track is usually known before the user gets there.
   * One ahead only — iTunes is rate limited and a whole queue of lookups on
   * every track change would be rude.
   */
  useEffect(() => {
    const upcoming = state.queue[state.index + 1]
    if (!upcoming) return
    if (noPreview.current.has(upcoming.id)) return
    if (prefetched.current.has(upcoming.id)) return

    let cancelled = false
    void getPreview({
      id: upcoming.id,
      title: upcoming.title,
      artistName: upcoming.artistName,
      itunesTrackId: upcoming.itunesTrackId,
      itunesCheckedAt: upcoming.itunesCheckedAt,
    })
      .then((result) => {
        if (cancelled) return
        if (result.status === 'ok') prefetched.current.set(upcoming.id, result)
        else noPreview.current.add(upcoming.id)
      })
      .catch((err: unknown) => {
        console.warn('[beatboxed] preview prefetch failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [state.queue, state.index])

  // Clearing the countdown on unmount keeps a torn-down provider from
  // starting a track nobody is listening to.
  useEffect(() => cancelSkip, [cancelSkip])

  // Audio element -> state
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onPlay = () => setState((s) => ({ ...s, isPlaying: true }))

    const onPause = () => {
      setState((s) => ({ ...s, isPlaying: false }))
      flushPosition()
    }

    const onTime = () => {
      const now = audio.currentTime
      const delta = now - lastTime.current
      lastTime.current = now
      // Only forward movement at roughly real-time counts; this filters out
      // seeks, the resume jump, and the reset to zero on a new source, so
      // dragging the scrubber can't fake a play.
      if (delta > 0 && delta < 1.5) listened.current += delta

      setState((s) => ({ ...s, position: now }))

      const uid = userId.current
      const track = currentTrack.current
      if (
        uid &&
        track &&
        recorded.current !== track.id &&
        listened.current >= MIN_PLAY_SECONDS
      ) {
        recorded.current = track.id
        // Tells Home its rail is stale, but only once the row exists, or the
        // refetch could beat the write and miss it.
        enqueueWrite(async () => {
          await recordPlay(uid, track.id, now)
          setHistoryVersion((v) => v + 1)
        })
      }
    }

    const onMeta = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0
      const resumeAt = pendingSeek.current
      pendingSeek.current = null
      resuming.current = resumeCandidate.current
      resumeCandidate.current = null
      if (
        resumeAt != null &&
        duration > 0 &&
        resumeAt < duration - NEARLY_DONE_SECONDS
      ) {
        audio.currentTime = resumeAt
        lastTime.current = resumeAt
      }
      setState((s) => ({ ...s, duration }))
    }

    // The pause that precedes 'ended' already saved position 0.
    const onEnded = () => setState((s) => ({ ...s, isPlaying: false, position: 0 }))

    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('ended', onEnded)
    }
  }, [flushPosition, enqueueWrite])

  // A finished preview rolls on to the next queued track.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onEnded = () => next()
    audio.addEventListener('ended', onEnded)
    return () => audio.removeEventListener('ended', onEnded)
  }, [next])

  // Lock screens and keyboard media keys.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !state.current) return
    const t = state.current
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artistName,
      album: 'Beatboxed — 30s preview',
      artwork: t.coverUrl ? [{ src: t.coverUrl, sizes: '512x512', type: 'image/jpeg' }] : [],
    })
    navigator.mediaSession.setActionHandler('play', () => toggle())
    navigator.mediaSession.setActionHandler('pause', () => toggle())
    navigator.mediaSession.setActionHandler('nexttrack', () => next())
    navigator.mediaSession.setActionHandler('previoustrack', () => previous())
  }, [state.current, toggle, next, previous])

  /**
   * Closing the tab, backgrounding the app, or navigating away still owes us
   * a resume point. Best-effort by nature: the request is fired on the way
   * out and the browser may not wait for it, which costs at most the few
   * seconds since the last pause.
   */
  useEffect(() => {
    const onLeave = () => flushPosition()
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushPosition()
    }
    window.addEventListener('pagehide', onLeave)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', onLeave)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [flushPosition])

  // Logging out must not leave someone else's music playing.
  useEffect(() => {
    if (user) return
    stop()
    // Nor their resume points for whoever signs in next.
    savedPositions.current.clear()
  }, [user, stop])

  const value = useMemo<PlayerApi>(
    () => ({ ...state, historyVersion, playQueue, toggle, next, previous, seek, stop }),
    [state, historyVersion, playQueue, toggle, next, previous, seek, stop]
  )

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export function usePlayer() {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>')
  return ctx
}
