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
import { useAuth } from './auth'
import type { SongCardModel } from './types'

export type PlayerTrack = SongCardModel & {
  itunesTrackId?: number | null
  itunesCheckedAt?: string | null
  spotifyId?: string | null
}

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

  const load = useCallback(async (track: PlayerTrack, autoplay: boolean) => {
    const audio = audioRef.current
    if (!audio) return
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
  }, [])

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
  }, [])

  // Audio element -> state
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onPlay = () => setState((s) => ({ ...s, isPlaying: true }))
    const onPause = () => setState((s) => ({ ...s, isPlaying: false }))
    const onTime = () => setState((s) => ({ ...s, position: audio.currentTime }))
    const onMeta = () =>
      setState((s) => ({ ...s, duration: Number.isFinite(audio.duration) ? audio.duration : 0 }))
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
  }, [])

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

  // Logging out must not leave someone else's music playing.
  useEffect(() => {
    if (!user) stop()
  }, [user, stop])

  const value = useMemo<PlayerApi>(
    () => ({ ...state, playQueue, toggle, next, previous, seek, stop }),
    [state, playQueue, toggle, next, previous, seek, stop]
  )

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export function usePlayer() {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>')
  return ctx
}
