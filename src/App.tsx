import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/lib/auth'
import { arrival } from '@/lib/authLinks'
import { RequireAuth } from '@/components/auth/RequireAuth'
import { AppShell } from '@/components/layout/AppShell'
import Login from '@/pages/Login'
import SignUp from '@/pages/SignUp'
import ForgotPassword from '@/pages/ForgotPassword'
import ResetPassword from '@/pages/ResetPassword'
import Home from '@/pages/Home'
import Explore from '@/pages/Explore'
import RailList from '@/pages/RailList'
import Welcome from '@/pages/Welcome'
import { OnboardingRoot, RequireSetup } from '@/lib/onboardingContext'
import LibraryPage from '@/pages/LibraryPage'
import Profile from '@/pages/Profile'
import Song from '@/pages/Song'
import Playlist from '@/pages/Playlist'
import Artist from '@/pages/Artist'
import Album from '@/pages/Album'
import SettingsPage from '@/pages/Settings'
import MutedAccounts from '@/pages/MutedAccounts'
import WeeklySong from '@/pages/WeeklySong'
import Notifications from '@/pages/Notifications'
import FollowRequests from '@/pages/FollowRequests'
import ProfileFollows from '@/pages/ProfileFollows'
import ProfileArtists from '@/pages/ProfileArtists'
import ProfilePlaylists from '@/pages/ProfilePlaylists'
import ProfileReviews from '@/pages/ProfileReviews'
import NowPlaying from '@/pages/NowPlaying'
import NotFound from '@/pages/NotFound'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <RecoveryToResetPage />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route element={<RequireAuth />}>
            {/* Setup and tour state for the signed-in user, read once. */}
            <Route element={<OnboardingRoot />}>
            {/* First-time setup: outside the shell, so no navigation. */}
            <Route path="/welcome" element={<Welcome />} />
            {/* Anyone who hasn't finished setup goes to /welcome first. */}
            <Route element={<RequireSetup />}>
            {/* Inside RequireAuth so logging out tears the player down with it. */}
            <Route element={<AppShell />}>
              <Route index element={<Home />} />
              <Route path="explore" element={<Explore />} />
              <Route path="explore/:rail" element={<RailList />} />
              <Route path="library" element={<LibraryPage />} />
              <Route path="profile" element={<Profile />} />
              <Route path="profile/:userId" element={<Profile />} />
              <Route
                path="profile/:userId/followers"
                element={<ProfileFollows key="followers" kind="followers" />}
              />
              <Route
                path="profile/:userId/following"
                element={<ProfileFollows key="following" kind="following" />}
              />
              {/* Old links (bookmarks, notifications) still land somewhere. */}
              <Route path="profile/:userId/friends" element={<FriendsRedirect />} />
              <Route path="profile/:userId/artists" element={<ProfileArtists />} />
              <Route path="profile/:userId/playlists" element={<ProfilePlaylists />} />
              <Route path="profile/:userId/reviews" element={<ProfileReviews />} />
              <Route path="song/:id" element={<Song />} />
              <Route path="playlist/:id" element={<Playlist />} />
              <Route path="artist/:id" element={<Artist />} />
              <Route path="album/:id" element={<Album />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="settings/muted" element={<MutedAccounts />} />
              <Route path="week" element={<WeeklySong />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="notifications/requests" element={<FollowRequests />} />
              <Route path="now-playing" element={<NowPlaying />} />
              <Route path="*" element={<NotFound />} />
            </Route>
            </Route>
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

/** The friends list became the followers list. */
function FriendsRedirect() {
  const { userId } = useParams()
  return <Navigate to={`/profile/${userId}/followers`} replace />
}

/**
 * A reset link that Supabase sent somewhere other than /reset-password
 * (it falls back to the Site URL when /reset-password isn't in its Redirect
 * URLs list): take it to the reset page, once, wherever it landed.
 */
let recoveryHandled = false
function RecoveryToResetPage() {
  const navigate = useNavigate()
  const { loading } = useAuth()
  useEffect(() => {
    // Only once Supabase has read the link from the address, which moving
    // to another page would wipe.
    if (loading || !arrival.recovery || recoveryHandled) return
    recoveryHandled = true
    if (window.location.pathname !== '/reset-password') navigate('/reset-password', { replace: true })
  }, [loading, navigate])
  return null
}
