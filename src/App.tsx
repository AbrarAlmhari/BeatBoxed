import { BrowserRouter, Route, Routes } from 'react-router-dom'
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
import Notifications from '@/pages/Notifications'
import FriendRequests from '@/pages/FriendRequests'
import ProfileFriends from '@/pages/ProfileFriends'
import ProfileArtists from '@/pages/ProfileArtists'
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
              <Route path="profile/:userId/friends" element={<ProfileFriends />} />
              <Route path="profile/:userId/artists" element={<ProfileArtists />} />
              <Route path="profile/:userId/reviews" element={<ProfileReviews />} />
              <Route path="song/:id" element={<Song />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="notifications/requests" element={<FriendRequests />} />
              <Route path="now-playing" element={<NowPlaying />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
