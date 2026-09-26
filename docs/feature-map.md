# Feature Map — MVP vs. Stretch

## MVP (build first, in roughly this order)

1. Auth — login / create account (Supabase Auth)
2. Home — continue listening, trending, for-you rails
3. Explore / Search — by song, artist, and lyrics; filter chips
4. Song page — About / Lyrics / Reviews tabs
5. Rating & review system — 5-star scale + written reviews (the app's signature feature)
6. User profile — customization, stats (reviews/followers/following), reviews tab, playlists tab
7. Library — liked songs, playlists, followed artists
8. Playlist creation and detail view
9. Settings — theme, translation language, log out
10. Beatie chatbot — lyrics explanation/translation, as a contextual bottom-sheet on Now Playing (not a separate tab)

**Playback caveat:** build the Now Playing UI (artwork, scrubber, synced lyrics) against real track metadata. Full audio streaming needs Spotify's Web Playback SDK, which requires the *listening user* to have Spotify Premium and still counts against the 5-account Developer Mode cap — treat live playback as a limited-demo capability, not a feature every user gets.

## Stretch (only after MVP is fully working — cut these first under time pressure)

- Friends page — mutual follows, requests, "similar taste %"
- Notification center
- Import playlists from Spotify / Apple Music
- Genre-taste graph on profile
- Mood-based recommendations ("what are you in the mood for")
- Full multi-language UI translation (Arabic / Hindi / English) beyond lyric translation
- Live Spotify account linking for more than 5 test users

## Page inventory (from mockups + meeting notes)

Home · Explore/Search · Library · Profile · Other user's profile · Song page · Now Playing (artwork + lyrics tabs) · Beatie chat sheet · Ratings & Reviews · Playlist detail · Friends (requests + list) · Notifications · Settings · Login / Create account.
