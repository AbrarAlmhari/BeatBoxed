import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AuthProvider } from '@/lib/auth'
import { RequireAuth } from '@/components/auth/RequireAuth'
import { AppShell } from '@/components/layout/AppShell'
import Login from '@/pages/Login'
import SignUp from '@/pages/SignUp'
import Home from '@/pages/Home'
import Explore from '@/pages/Explore'
import LibraryPage from '@/pages/LibraryPage'
import Profile from '@/pages/Profile'
import Song from '@/pages/Song'
import Playlist from '@/pages/Playlist'
import Artist from '@/pages/Artist'
import Album from '@/pages/Album'
import SettingsPage from '@/pages/Settings'
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
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<SignUp />} />

          <Route element={<RequireAuth />}>
            {/* Inside RequireAuth so logging out tears the player down with it. */}
            <Route element={<AppShell />}>
              <Route index element={<Home />} />
              <Route path="explore" element={<Explore />} />
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
              <Route path="notifications" element={<Notifications />} />
              <Route path="notifications/requests" element={<FollowRequests />} />
              <Route path="now-playing" element={<NowPlaying />} />
              <Route path="*" element={<NotFound />} />
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
