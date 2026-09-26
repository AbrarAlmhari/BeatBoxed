import { LogOut } from 'lucide-react'
import { PagePlaceholder } from '@/components/ui/PagePlaceholder'
import { useAuth } from '@/lib/auth'

export default function Profile() {
  const { user, signOut } = useAuth()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface p-4 shadow-card">
        <div className="min-w-0">
          <p className="text-card-title">Signed in</p>
          <p className="truncate text-secondary text-muted-foreground">
            {user?.email}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex shrink-0 items-center gap-2 rounded-button bg-surface-2 px-3.5 py-2.5 text-button text-muted-foreground transition-all duration-200 ease-soft hover:bg-white/10 hover:text-foreground active:scale-[0.98]"
        >
          <LogOut className="size-[18px]" strokeWidth={1.75} />
          Log out
        </button>
      </div>

      <PagePlaceholder
        title="Profile"
        description="Customization, stats, and your reviews and playlists tabs."
      />
    </div>
  )
}
