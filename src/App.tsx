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
import NotFound from '@/pages/NotFound'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<SignUp />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<Home />} />
              <Route path="explore" element={<Explore />} />
              <Route path="library" element={<LibraryPage />} />
              <Route path="profile" element={<Profile />} />
              <Route path="song/:id" element={<Song />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
