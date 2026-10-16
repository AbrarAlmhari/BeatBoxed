import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { PageGlow } from '@/components/ui/PageGlow'
import {
  AllSetStep,
  StepArtists,
  StepPeople,
  StepProfile,
  StepReview,
  StepSongs,
  StepTags,
  StepUsername,
  type SetupProfile,
} from '@/components/onboarding/SetupSteps'
import { FollowsProvider } from '@/lib/follows'
import { PlayerProvider } from '@/lib/player'
import { ToastProvider } from '@/lib/toast'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { getLikedSongs } from '@/lib/catalog'
import { useOnboarding } from '@/lib/onboardingContext'
import { SETUP_ALL_SET, saveSetupStep } from '@/lib/onboarding'
import type { SongCardModel } from '@/lib/types'

/**
 * /welcome: first-time setup, seven steps then "All set", as in
 * docs/mockups/onboarding. Only for accounts that haven't finished it; the
 * step is saved as they go, so closing the app resumes where they were.
 *
 * It sits outside the app's shell (no navigation), so it brings its own
 * follows, player and toast providers.
 */
export default function Welcome() {
  const { state, loading } = useOnboarding()
  // Decided once, when the page opens: someone who had already finished
  // goes to Home. Finishing here navigates on its own (with the tour or the
  // "You're ready!" message), so the page mustn't redirect over it.
  const [finishedBefore, setFinishedBefore] = useState<boolean | null>(null)
  useEffect(() => {
    if (!loading && finishedBefore === null) setFinishedBefore(!state || Boolean(state.setupCompletedAt))
  }, [loading, state, finishedBefore])

  if (loading || finishedBefore === null) return <Loading />
  if (finishedBefore) return <Navigate to="/" replace />
  return (
    <FollowsProvider>
      <PlayerProvider>
        <ToastProvider>
          <WelcomeFlow initialStep={state?.setupStep ?? 1} />
        </ToastProvider>
      </PlayerProvider>
    </FollowsProvider>
  )
}

function Loading() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" strokeWidth={2} />
      <span className="sr-only">Loading</span>
    </div>
  )
}

function WelcomeFlow({ initialStep }: { initialStep: number }) {
  const { user } = useAuth()
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 1), SETUP_ALL_SET))
  const [profile, setProfile] = useState<SetupProfile | null>(null)
  // Liked songs, kept across steps 6 and 7 and across searching.
  const [liked, setLiked] = useState<Map<string, SongCardModel>>(new Map())

  useEffect(() => {
    if (!user || !supabase) return
    let cancelled = false
    void Promise.all([
      supabase
        .from('profiles')
        .select('username, display_name, avatar_url, bio, favorite_genres')
        .eq('id', user.id)
        .single(),
      getLikedSongs(user.id).catch(() => [] as SongCardModel[]),
    ]).then(([{ data }, likes]) => {
      if (cancelled || !data) return
      setProfile({
        username: data.username ?? '',
        displayName: data.display_name ?? '',
        avatarUrl: data.avatar_url,
        bio: data.bio ?? '',
        tags: data.favorite_genres ?? [],
      })
      setLiked(new Map(likes.map((s) => [s.id, s])))
    })
    return () => {
      cancelled = true
    }
  }, [user])

  const go = useCallback(
    (next: number) => {
      setStep(next)
      window.scrollTo({ top: 0 })
      if (user) void saveSetupStep(user.id, next).catch((err) => console.warn('[beatboxed] setup step not saved:', err))
    },
    [user]
  )

  if (!user || !profile) return <Loading />

  const common = {
    userId: user.id,
    profile,
    setProfile: (patch: Partial<SetupProfile>) => setProfile((p) => (p ? { ...p, ...patch } : p)),
    next: () => go(step + 1),
    back: () => go(step - 1),
  }

  return (
    <div className="relative isolate min-h-dvh overflow-x-hidden bg-background">
      {step === SETUP_ALL_SET && <PageGlow strength="soft" />}
      {step === 1 && <StepUsername {...common} />}
      {step === 2 && <StepProfile {...common} />}
      {step === 3 && <StepTags {...common} />}
      {step === 4 && <StepPeople {...common} />}
      {step === 5 && <StepArtists {...common} />}
      {step === 6 && <StepSongs {...common} liked={liked} setLiked={setLiked} />}
      {step === 7 && <StepReview {...common} liked={liked} />}
      {step === SETUP_ALL_SET && <AllSetStep {...common} likedCount={liked.size} />}
    </div>
  )
}
