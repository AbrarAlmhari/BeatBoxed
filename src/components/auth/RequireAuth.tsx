import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth'

export function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()

  // Session restore is async; redirecting before it settles would bounce
  // already-logged-in users to /login on every refresh.
  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <Loader2
          className="size-6 animate-spin text-muted-foreground"
          strokeWidth={2}
        />
        <span className="sr-only">Loading</span>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
