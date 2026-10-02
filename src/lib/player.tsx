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
import { getPreview } from './preview'
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

type PlayerState = {
  current: PlayerTrack | null
  queue: PlayerTrack[]
  index: number
  isPlaying: boolean
  /** True while the preview URL is being resolved. */
  loading: boolean
  /** No iTunes match — offer Spotify instead of a dead play button. */
  unavailable: boolean
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

  const load = useCallback(async (track: PlayerTrack, autoplay: boolean) => {
    const audio = audioRef.current
    if (!audio) return

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
      position: 0,
      duration: 0,
    }))

    const result = await getPreview({
      id: track.id,
      title: track.title,
      artistName: track.artistName,
      itunesTrackId: track.itunesTrackId,
      itunesCheckedAt: track.itunesCheckedAt,
    })
    if (token !== loadToken.current) return

    if (result.status !== 'ok') {
      audio.pause()
      setState((s) => ({ ...s, loading: false, unavailable: true, isPlaying: false }))
      return
    }

    audio.src = result.url
    setState((s) => ({ ...s, loading: false, unavailable: false }))
    if (autoplay) {
      try {
        await audio.play()
      } catch (err) {
        // Autoplay policies can refuse playback not tied to a gesture.
        console.warn('[beatboxed] playback blocked:', err)
        setState((s) => ({ ...s, isPlaying: false }))
      }
    }
  }, [flushPosition])

  const playQueue = useCallback(
    (tracks: PlayerTrack[], startIndex: number) => {
      const track = tracks[startIndex]
      if (!track) return
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

  const next = useCallback(() => {
    const at = state.index + 1
    const track = state.queue[at]
    if (!track) return
    setState((s) => ({ ...s, index: at }))
    void load(track, true)
  }, [load, state.index, state.queue])

  const previous = useCallback(() => {
    const audio = audioRef.current
    // Restart first, like every other player, before stepping back.
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0
      return
    }
    const at = state.index - 1
    const track = state.queue[at]
    if (!track) {
      if (audio) audio.currentTime = 0
      return
    }
    setState((s) => ({ ...s, index: at }))
    void load(track, true)
  }, [load, state.index, state.queue])

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (audio) audio.currentTime = seconds
  }, [])

  const stop = useCallback(() => {
    const audio = audioRef.current
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
      position: 0,
      duration: 0,
    })
    recorded.current = null
    resuming.current = null
    resumeCandidate.current = null
  }, [flushPosition])

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
