import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import Home from '@/pages/Home'
import Explore from '@/pages/Explore'
import LibraryPage from '@/pages/LibraryPage'
import Profile from '@/pages/Profile'
import NotFound from '@/pages/NotFound'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="explore" element={<Explore />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
