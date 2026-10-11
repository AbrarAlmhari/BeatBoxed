import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { getAccountSettings, LANGUAGES, type LanguageCode } from './settings'

/**
 * Beatie, the music buddy. Every request goes through the `beatie` Edge
 * Function, which holds the AI key, fetches the lyrics itself, caches what
 * can be shared, and enforces the daily limits. The browser only ever sends
 * a song id and, for chat, the conversation.
 */

export type BeatieMessage = { role: 'user' | 'assistant'; text: string }

export type BeatieRequest =
  | { action: 'explain'; songId: string }
  | { action: 'line'; songId: string; line: string }
  | { action: 'translate'; songId: string }
  | { action: 'chat'; songId: string; messages: BeatieMessage[] }

/**
 * pending: the answer is still being written on the server and will be in
 * the cache shortly. Asking again then loads it, at no cost.
 */
export type BeatieErrorCode =
  | 'limit'
  | 'global'
  | 'busy'
  | 'pending'
  | 'error'
  | 'bad_request'
  | 'auth'

export type BeatieResponse =
  | {
      ok: true
      /** The language Beatie wrote in: the user's Settings language. */
      language: string
      text?: string
      lines?: string[]
      /** False when Beatie answered without lyrics. */
      hasLyrics: boolean
      cached: boolean
    }
  | { ok: false; code: BeatieErrorCode }

/** The most recent messages sent with each chat question. */
export const CHAT_HISTORY = 10
/** Longest question Beatie accepts; the server enforces it too. */
export const QUESTION_MAX = 500

export async function askBeatie(request: BeatieRequest): Promise<BeatieResponse> {
  if (!supabase) return { ok: false, code: 'error' }
  try {
    const { data, error } = await supabase.functions.invoke('beatie', { body: request })
    if (error || !data) {
      console.error('[beatboxed] beatie request failed:', error)
      return { ok: false, code: 'error' }
    }
    return data as BeatieResponse
  } catch (err) {
    console.error('[beatboxed] beatie unreachable:', err)
    return { ok: false, code: 'error' }
  }
}

/** What the user sees for each failure. Never the raw error. */
export function beatieErrorMessage(code: BeatieErrorCode) {
  switch (code) {
    case 'limit':
      return "You've used today's 30 Beatie requests. They reset at midnight UTC. Answers Beatie has already given still load."
    case 'global':
      return 'Beatie is taking a break, try again later.'
    case 'busy':
      return 'Beatie is taking a break, try again in a minute.'
    case 'pending':
      return "Beatie's still writing this one, check back in a moment."
    default:
      return "Beatie couldn't answer that right now. Try again in a moment."
  }
}

/* ------------------------------------------------------------- language */

export function languageLabel(code: string) {
  return LANGUAGES.find((l) => l.code === code)?.label ?? 'English'
}

/** English-language name, for "Translate to …" next to a native label. */
const ENGLISH_NAMES: Record<string, string> = { en: 'English', ar: 'Arabic', hi: 'Hindi' }
export function languageName(code: string) {
  return ENGLISH_NAMES[code] ?? 'English'
}

/** The user's language from Settings; English when it isn't set. */
export function useBeatieLanguage(): LanguageCode {
  const { user } = useAuth()
  const [language, setLanguage] = useState<LanguageCode>('en')
  useEffect(() => {
    if (!user) return
    let cancelled = false
    getAccountSettings(user.id)
      .then((s) => {
        if (!cancelled) setLanguage(s.translationLanguage || 'en')
      })
      .catch((err: unknown) => console.warn('[beatboxed] language lookup failed:', err))
    return () => {
      cancelled = true
    }
  }, [user])
  return language
}

const ENGLISH_WORDS = new Set(
  (
    'the and you i to a of in my me it is that on your for with be we all love ' +
    "this what so but just no don't i'm can it's was are when like know got now " +
    'up down out baby oh yeah go get will never time one there they she he her his'
  ).split(' ')
)

/**
 * The lyrics' language, worked out without asking the AI: by alphabet for
 * Arabic and Hindi (Devanagari), and by how many very common English words a
 * Latin-script text has. 'other' is anything else — Spanish, French, Korean…
 * — which is never the user's language, since Settings offers en, ar and hi.
 * null when there's nothing to judge.
 */
export function detectLyricsLanguage(lines: string[]): 'en' | 'ar' | 'hi' | 'other' | null {
  const text = lines.join(' ')
  let arabic = 0
  let devanagari = 0
  let latin = 0
  let otherLetters = 0
  for (const ch of text) {
    if (/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(ch)) arabic++
    else if (/[ऀ-ॿ]/.test(ch)) devanagari++
    else if (/[A-Za-zÀ-ɏ]/.test(ch)) latin++
    else if (/\p{L}/u.test(ch)) otherLetters++
  }
  const letters = arabic + devanagari + latin + otherLetters
  if (letters < 10) return null
  if (arabic / letters > 0.4) return 'ar'
  if (devanagari / letters > 0.4) return 'hi'
  if (latin / letters < 0.6) return 'other'

  const words = text.toLowerCase().match(/[a-z']+/g) ?? []
  if (words.length === 0) return 'other'
  const common = words.filter((w) => ENGLISH_WORDS.has(w)).length
  return common / words.length >= 0.15 ? 'en' : 'other'
}
