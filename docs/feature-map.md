# Feature Map — MVP vs. Stretch

## MVP (build first, in roughly this order)

1. Auth — login / create account (Supabase Auth)
2. Home — the review feed: For You and Following tabs with an Ask Beatie pill at the end of the tab row (see 10), and a "What song is on your mind?" composer
   - The song rails (Trending, For You, Recently viewed) live on Explore's browse view.
   - **Trending** ranks by `songs.popularity` (Deezer rank) descending, falling back to `cached_at` for unmatched tracks. It is *not* review-based: it ranks only songs already in Beatboxed's cache, so it means "most popular of what we've cached", not a global chart.
   - **Recently viewed** merges songs the user opened (`song_views`) and played (`play_history`), newest first, each once.
   - **For You** (the song rail) is in-catalog affinity: seeds are songs the user reviewed or opened (`song_views`) plus followed artists; from those we take the artists and genres and surface *other* cached songs matching them, ranked by popularity, same-artist before same-genre. Falls back to Trending for a user with no history. Search queries are deliberately not a signal — typing something and never opening it is weak evidence of taste. Spotify's similarity endpoints (`/recommendations`, `/related-artists`, `/audio-features`) are all blocked for this app, so matching happens inside our own cache.
3. Explore / Search — by song, artist, and lyrics; filter chips
4. Song page — About / Beatie / Lyrics / Reviews sections
5. Rating & review system — 5-star scale + written reviews (the app's signature feature)
6. User profile (redesigned, Part A of 3) — a glowing header with the avatar in a gradient ring, name and @username, and one counts row (ratings · reviews · followers · following · artists; the last three open their lists in a sheet). Then an underlined, sticky tab bar: Reviews · Playlists · Stats · Likes, with the tab in the URL (`/profile/:id?tab=likes`).
   - **Reviews:** All / Written / Ratings only, sorted Recent / Highest rated / Most liked. Written reviews are feed-style cards; ratings with no text are compact rows. 20 at a time.
   - **Playlists:** square tiles (2 columns on phones, 4 on desktop); your own starts with "+ New playlist".
   - **Stats (Part B):** a time range (All time · This year · 30 days, pinned under the tabs on phones), Beatie's take (a sentence from about eight templates, no AI call), tiles (songs rated, average, artists), the ratings spread and ratings by decade as bar charts (tooltips, screen-reader tables), the five most rated artists (with See all), and Share my stats (copies `/profile/:id?tab=stats`). Under 5 ratings in a range it shows a warm-up state with progress. Data: `get_user_stats()`.
   - **Genres (Part C):** Top genres on the Stats tab (horizontal bars, songs rated 3★+, top 8 then Other, tap a row for its top 3 artists) and a Genres tile; Beatie's take can lead with them. The profile header shows the top three genres as chips once someone has 5+ ratings (tap opens Stats). Genres belong to artists (Wikidata, then MusicBrainz), shown as chips on the artist page; songs no longer show a genre anywhere. **Likes:** liked songs (unlike with Undo on your own) and liked reviews.
   - A private profile shows its header and counts to non-followers, with a lock card instead of the tabs. The genre chips under the name are gone for now (Part C works genres out from ratings); `favorite_genres` is kept.
7. Library — liked songs, playlists, followed artists
8. Playlist creation and detail view
9. Settings — theme, translation language, log out
10. Beatie — the music buddy, powered by Gemini through the `beatie` Edge Function (details in `docs/api-integrations.md`)
    - **Song page card:** "What's this song about?" (2–3 short paragraphs), then an Ask Beatie chat about that song. The chat is kept only for the current visit, never saved. Off-topic questions are steered back to the song.
    - **Explain this line:** tap a lyric line; a bottom sheet on phones, a popover beside the line on wider screens.
    - **Translate:** a "Translate to <language>" button at the top of the lyrics, shown only when the lyrics' language (detected without AI) differs from the user's Settings language. The whole song is translated in one request and shown line by line under the originals, labelled "Translated by Beatie · may not be exact". Translations appear only on the Song page — never in the feed, reviews or shared content.
    - **Home:** an Ask Beatie pill at the end of the For You / Following row (only Beatie's face under 370px wide) opens a sheet: pick a song (the review composer's picker), then the same chat. The first time a user sees it, a one-time bubble says "Hi, I'm Beatie! Ask me about any song." (remembered per user in the browser). **Now Playing:** its Ask Beatie button jumps to the Song page card.
    - **Character:** Beatie's art is in `src/assets/beatie/` (read its README): `beatie-mark` at small sizes (the pill, chat avatars, icons in buttons), `beatie-default` on the card and sheet, `thinking` while waiting, `happy` once an answer arrives, `sleepy` for "taking a break" and the daily limit, `sad` for other errors and no lyrics, `excited` for the hello bubble. All through `BeatieImage`, which keeps the README's minimum sizes.
    - **No lyrics:** Beatie says it doesn't have them and works from the title, artist and album only; it never invents lyrics.
    - Beatie answers in the user's Settings language (English if unset), or in whatever language the user writes to it in.

**Playback caveat:** build the Now Playing UI (artwork, scrubber, synced lyrics) against real track metadata. Full audio streaming needs Spotify's Web Playback SDK, which requires the *listening user* to have Spotify Premium and still counts against the 5-account Developer Mode cap — treat live playback as a limited-demo capability, not a feature every user gets.

## Stretch (only after MVP is fully working — cut these first under time pressure)

- Followers / following — one-way follows (Instagram-style: instant for public accounts, a request for private ones), "similar taste %"
- Notification center
- Import playlists from Spotify / Apple Music
- Genre-taste graph on profile
- Mood-based recommendations ("what are you in the mood for")
- Full multi-language UI translation (Arabic / Hindi / English) beyond lyric translation
- Live Spotify account linking for more than 5 test users

## Page inventory (from mockups + meeting notes)

Home · Explore/Search · Library · Profile · Other user's profile · Song page · Now Playing (artwork + lyrics tabs) · Beatie (Song page card + Home sheet) · Ratings & Reviews · Playlist detail · Followers / Following (requests + lists) · Notifications · Settings · Login / Create account.

## Onboarding (docs/mockups/onboarding)

- **Sign-up:** email and password (8+ characters), then "Check your email" with Resend and "Wrong email? Go back". The link signs them in on /welcome, on any device; logging in before confirming says so and offers Resend.
- **/welcome:** seven steps (username, display name with photo and bio, 3–8 music tags, follow people, follow artists, like songs, a first review), then "All set" with Show me around or Skip. The step is saved, so leaving halfway resumes; finished accounts never see it again, and the app sends an unfinished one back to it.
- **Profile:** the header shows only the tags the user chose ("Add your music tags" on your own profile without any). Genres worked out from reviews stay on the Stats tab. Edit profile has My music tags.
- **Beatie tour:** six steps on Home (feed, composer, Ask Beatie, Explore, Library, Profile), finding each real element by its `data-tour` attribute. Replay from Settings.
- **Existing users:** a one-time "Your music tags are back" card on Home.

## Conversations (docs/mockups/conversations)

- **Review card** (feed, profile Reviews and Likes tabs, song page): a soft glow from the song's cover, filled like and comment pills (the like pill turns pink), "Liked by" with small avatars. Collapsed, it shows the top comment, "View all N comments" and a quick "Add a comment… type @ to mention" box.
- **The thread:** chat bubbles under the name and time, Like (heart and count) and Reply under each; the review's author gets an "Author" label and a light purple bubble; "Loved by author" when they like a comment. Top (likes plus replies, then newest) or Newest. Replies are one level deep: Reply on a reply lands under the same comment starting with "@name"; two show, then "View N more replies" / "Hide replies". Comment text is `dir="auto"` inside a bubble only as wide as the words, so Arabic stays under the name.
- **Phone:** comments open in a bottom sheet with the composer pinned at the bottom ("Replying to @name" with an X). **Desktop:** the thread stays in the card; Reply opens an inline box (Enter sends, Shift+Enter new line, Esc cancels).
- **@mentions:** suggestions from people in the thread, then people you follow, then people who follow you, then anyone, at most 5, with why each appears; arrows and Enter or a tap pick one. A name typed in full works the same. Mentions show as purple chips that open the profile.
- **Notifications:** replies to your comment, mentions, likes on your comments and replies (grouped: "ory and 2 others"), replies in a thread you're in (at most hourly), alongside the existing types. Coloured badge on the avatar, the comment quoted, the song's cover, an unread dot, New and Earlier, filters All · Mentions · Replies · Likes · Follows · Artists · Beatboxed with unread counts, Mark all read. Reply and Like right on reply and mention rows; Reply opens the review with the comment highlighted and the box ready (`&reply=1`).
