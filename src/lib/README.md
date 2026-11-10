API clients and shared utilities: Supabase client, Spotify Client Credentials helper, lrclib client, Beatie helper, formatting utilities. `config.ts` holds the app's limits, timeouts and page sizes in one place.

Logging goes through `log.ts` (`logError`, `logWarn`): `[tag] what happened` and one object of ids and the error, with emails replaced and long text cut short. Never log keys, tokens, lyrics or answers.
