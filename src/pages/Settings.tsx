import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { Toggle } from '@/components/ui/Toggle'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import {
  DEFAULT_NOTIFICATION_PREFS,
  getAccountSettings,
  getNotificationPrefs,
  LANGUAGES,
  setNotificationPref,
  updateAccountSettings,
  type AccountSettings,
  type NotificationPrefKey,
  type NotificationPrefs,
} from '@/lib/settings'

const NOTIFICATION_ROWS: { key: NotificationPrefKey; label: string; hint?: string }[] = [
  { key: 'review_liked', label: 'Likes on your reviews' },
  { key: 'review_commented', label: 'Comments on your reviews' },
  { key: 'thread_reply', label: 'Replies in threads you’ve commented in' },
  { key: 'friend_accepted', label: 'Friend request accepted' },
  {
    key: 'artist_release',
    label: 'New releases from artists you follow',
  },
  {
    key: 'friend_requests',
    label: 'New friend requests',
    // Worth saying plainly: this hides the badge, not the requests.
    hint: 'Requests still appear on the Friend requests page.',
  },
  { key: 'announcements', label: 'Beatboxed updates' },
]

export default function Settings() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [account, setAccount] = useState<AccountSettings | null>(null)
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoading(true)
    Promise.all([getAccountSettings(user.id), getNotificationPrefs(user.id)])
      .then(([a, p]) => {
        if (cancelled) return
        setAccount(a)
        setPrefs(p)
      })
      .catch((err: unknown) => {
        console.error('[beatboxed] settings failed to load:', err)
        if (!cancelled) toast.show({ message: "Couldn't load your settings." })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user, toast])

  /**
   * Every control saves on change. The new value shows straight away and is
   * put back if the write fails, so the switch never claims something the
   * database didn't accept.
   */
  async function saveAccount(patch: Partial<AccountSettings>) {
    if (!user || !account) return
    const previous = account
    setAccount({ ...account, ...patch })
    try {
      await updateAccountSettings(user.id, {
        ...(patch.translationLanguage !== undefined && {
          translation_language: patch.translationLanguage,
        }),
        ...(patch.isPrivate !== undefined && { is_private: patch.isPrivate }),
        ...(patch.friendsListVisible !== undefined && {
          friends_list_visible: patch.friendsListVisible,
        }),
      })
      toast.show({ message: 'Saved' })
    } catch (err) {
      console.error('[beatboxed] setting save failed:', err)
      setAccount(previous)
      toast.show({ message: "That didn't save. Try again." })
    }
  }

  async function savePref(key: NotificationPrefKey, value: boolean) {
    if (!user) return
    const previous = prefs
    setPrefs({ ...prefs, [key]: value })
    try {
      await setNotificationPref(user.id, key, value)
      toast.show({ message: 'Saved' })
    } catch (err) {
      console.error('[beatboxed] notification setting failed:', err)
      setPrefs(previous)
      toast.show({ message: "That didn't save. Try again." })
    }
  }

  if (loading || !account) {
    return (
      <div className="flex flex-col gap-4 pt-2">
        <div className="h-8 w-40 animate-pulse rounded bg-surface" />
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-card bg-surface" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex max-w-2xl flex-col gap-8 pt-2">
      <h1 className="text-page-title">Settings</h1>

      <Section title="Language">
        <div className="flex flex-col gap-2">
          <span className="text-body text-foreground">Translation language</span>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => void saveAccount({ translationLanguage: l.code })}
                aria-pressed={account.translationLanguage === l.code}
                className={cn(
                  'rounded-button border px-3 py-1.5 text-button transition-colors duration-200 ease-soft',
                  account.translationLanguage === l.code
                    ? 'border-primary/60 bg-primary/15 text-foreground'
                    : 'border-white/10 bg-surface-2 text-muted-foreground hover:text-foreground'
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="text-meta text-muted-foreground">
            Used by Beatie for lyric translations.
          </p>
        </div>
      </Section>

      <Section title="Notifications">
        <div className="flex flex-col divide-y divide-white/5">
          {NOTIFICATION_ROWS.map((row) => (
            <Toggle
              key={row.key}
              label={row.label}
              hint={row.hint}
              checked={prefs[row.key]}
              onChange={(next) => void savePref(row.key, next)}
            />
          ))}
        </div>
      </Section>

      <Section title="Privacy">
        <div className="flex flex-col divide-y divide-white/5">
          <Toggle
            label="Private account"
            hint="Only friends can see your reviews, playlists, followed artists and friends. Everyone else sees your name, bio and counts."
            checked={account.isPrivate}
            onChange={(next) => void saveAccount({ isPrivate: next })}
          />
          <Toggle
            label="Show my friends list"
            hint="When off, nobody but you can see who you're friends with — not even your friends."
            checked={account.friendsListVisible}
            onChange={(next) => void saveAccount({ friendsListVisible: next })}
          />
        </div>
      </Section>

      <Section title="Account">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-meta text-muted-foreground">Signed in as</span>
            <span className="truncate text-body text-foreground">{user?.email}</span>
          </div>

          <button
            type="button"
            onClick={async () => {
              await signOut()
              navigate('/login', { replace: true })
            }}
            className="flex w-fit items-center gap-2 rounded-button bg-surface-2 px-3.5 py-2 text-button text-muted-foreground transition-colors duration-200 ease-soft hover:text-danger"
          >
            <LogOut className="size-4" strokeWidth={1.75} aria-hidden />
            Log out
          </button>
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-section-title">{title}</h2>
      <div className="rounded-card bg-surface p-4 shadow-card">{children}</div>
    </section>
  )
}
