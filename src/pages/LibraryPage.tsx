import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageGlow } from '@/components/ui/PageGlow'
import { SkeletonMediaGrid } from '@/components/ui/Skeleton'
import { TabPanel, Tabs } from '@/components/ui/Tabs'
import { PlaylistGrid, PlaylistGridSkeleton } from '@/components/playlist/PlaylistGrid'
import { PlaylistForm } from '@/components/playlist/PlaylistForm'
import {
  createPlaylist,
  getUserPlaylists,
  uploadPlaylistCover,
  type PlaylistSummary,
} from '@/lib/playlists'
import { MediaCard } from '@/components/ui/MediaCard'
import { FollowedArtistsGrid } from '@/components/profile/FollowedArtistsGrid'
import { useAuth } from '@/lib/auth'
import { usePlayer } from '@/lib/player'
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
  const player = usePlayer()
  const [tab, setTab] = useState<Tab>('liked')

  const [liked, setLiked] = useState<SongCardModel[] | null>(null)
  const [artists, setArtists] = useState<ArtistCardModel[] | null>(null)
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null)
  const [creating, setCreating] = useState(false)

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
    if (tab !== 'playlists' || !user || playlists) return
    getUserPlaylists(user.id)
      .then(setPlaylists)
      .catch((err) => {
        console.error('[beatboxed] playlists failed:', err)
        setPlaylists([])
      })
  }, [tab, user, playlists])

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
    <div className="relative isolate flex flex-col gap-6 pt-2">
      <PageGlow strength="soft" />
      <h1 className="text-page-title">Library</h1>

      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Library" idPrefix="library" sticky />

      <TabPanel idPrefix="library" value={tab}>

      {tab === 'liked' && (
        <section>
          {liked === null ? (
            <SkeletonMediaGrid count={10} />
          ) : liked.length === 0 ? (
            <EmptyState
              face="happy-sticker"
              title="No liked songs yet"
              detail="Open a song and tap Like to keep it here."
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
              {liked.map((song, i) => (
                <MediaCard
                  key={song.id}
                  to={`/song/${song.id}`}
                  onPlay={() =>
                    player.current?.id === song.id
                      ? player.toggle()
                      : player.playQueue(liked, i)
                  }
                  isCurrent={player.current?.id === song.id}
                  isPlaying={player.current?.id === song.id && player.isPlaying}
                  isLoading={player.current?.id === song.id && player.loading}
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
        <section className="flex flex-col gap-5">
          {creating ? (
            <Card className="sm:max-w-md">
              <PlaylistForm
                submitLabel="Create playlist"
                onCancel={() => setCreating(false)}
                onSubmit={async ({ title, description, coverFile }) => {
                  if (!user) return
                  const made = await createPlaylist(user.id, title, description)
                  // The upload needs an id, so it can only happen now.
                  if (coverFile) {
                    made.coverUrl = await uploadPlaylistCover(
                      user.id,
                      made.id,
                      coverFile
                    )
                  }
                  setPlaylists((prev) => [made, ...(prev ?? [])])
                  setCreating(false)
                }}
              />
            </Card>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex min-h-11 w-fit items-center gap-2 rounded-button bg-primary px-4 text-button text-white transition-all duration-200 ease-soft hover:bg-primary/90 active:scale-[0.97]"
            >
              <Plus className="size-4" strokeWidth={2} aria-hidden />
              New playlist
            </button>
          )}

          {playlists === null ? (
            <PlaylistGridSkeleton />
          ) : playlists.length === 0 ? (
            <EmptyState
              face="happy-sticker"
              title="No playlists yet"
              detail="Make one above, then add songs from any song page."
            />
          ) : (
            <PlaylistGrid playlists={playlists} />
          )}
        </section>
      )}

      {tab === 'artists' && (
        <section>
          {artists === null ? (
            <SkeletonMediaGrid count={4} />
          ) : artists.length === 0 ? (
            <EmptyState
              face="sleepy-sticker"
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
      </TabPanel>
    </div>
  )
}
