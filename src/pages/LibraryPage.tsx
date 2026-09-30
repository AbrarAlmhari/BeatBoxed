import { useEffect, useState } from 'react'
import { Chip } from '@/components/ui/Chip'
import { MediaCard } from '@/components/ui/MediaCard'
import { FollowedArtistsGrid } from '@/components/profile/FollowedArtistsGrid'
import { useAuth } from '@/lib/auth'
import { getFollowedArtists, getLikedSongs } from '@/lib/catalog'
import type { ArtistCardModel, SongCardModel } from '@/lib/types'

type Tab = 'liked' | 'playlists' | 'artists'

const TABS: { id: Tab; label: string }[] = [
  { id: 'liked', label: 'Liked Songs' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'artists', label: 'Artists' },
]

/** Always the signed-in user's own library — there's no view of someone else's. */
export default function LibraryPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('liked')

  const [liked, setLiked] = useState<SongCardModel[] | null>(null)
  const [artists, setArtists] = useState<ArtistCardModel[] | null>(null)

  useEffect(() => {
    if (tab !== 'liked' || !user || liked) return
    getLikedSongs(user.id)
      .then(setLiked)
      .catch((err) => {
        console.error('[beatboxed] liked songs failed:', err)
        setLiked([])
      })
  }, [tab, user, liked])

  useEffect(() => {
    if (tab !== 'artists' || !user || artists) return
    getFollowedArtists(user.id)
      .then(setArtists)
      .catch((err) => {
        console.error('[beatboxed] followed artists failed:', err)
        setArtists([])
      })
  }, [tab, user, artists])

  return (
    <div className="flex flex-col gap-8 pt-2">
      <h1 className="text-page-title">Library</h1>

      <div
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
        role="tablist"
      >
        {TABS.map((t) => (
          <Chip key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </Chip>
        ))}
      </div>

      {tab === 'liked' && (
        <section>
          {liked === null ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="flex flex-col gap-3 rounded-card bg-surface p-3">
                  <div className="aspect-square w-full animate-pulse rounded-[10px] bg-surface-2" />
                  <div className="flex flex-col gap-2 pb-1">
                    <div className="h-3.5 w-3/4 animate-pulse rounded bg-surface-2" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
                  </div>
                </div>
              ))}
            </div>
          ) : liked.length === 0 ? (
            <EmptyPanel
              title="No liked songs yet"
              detail="Open a song and tap Like to keep it here."
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
              {liked.map((song, i) => (
                <MediaCard
                  key={song.id}
                  to={`/song/${song.id}`}
                  title={song.title}
                  subtitle={song.artistName}
                  coverUrl={song.coverUrl}
                  ratingAvg={song.ratingAvg}
                  reviewCount={song.reviewCount}
                  tint={liked.length > 1 ? i / (liked.length - 1) : 0.5}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'playlists' && (
        <EmptyPanel
          title="No playlists yet"
          detail="Playlist creation is still to come."
        />
      )}

      {tab === 'artists' && (
        <section>
          {artists === null ? (
            <div className="h-28 animate-pulse rounded-card bg-surface" />
          ) : artists.length === 0 ? (
            <EmptyPanel
              title="No artists followed"
              detail="Follow an artist from a song page or from search."
            />
          ) : (
            <FollowedArtistsGrid
              artists={artists}
              showUnfollow
              onUnfollowed={(artistId) =>
                setArtists((prev) => (prev ?? []).filter((a) => a.id !== artistId))
              }
            />
          )}
        </section>
      )}
    </div>
  )
}

function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card bg-surface px-6 py-12 text-center">
      <p className="text-card-title">{title}</p>
      <p className="max-w-sm text-body text-muted-foreground">{detail}</p>
    </div>
  )
}
