# Design System — Dark Atmospheric Music

Source: team's theme spec + mockups. Apply this consistently to every screen and component — no per-screen style deviations.

**Feel:** premium, modern, minimal, immersive, music-focused, emotional/atmospheric. Like listening to music late at night with headphones on. Not cyberpunk, not neon, not a generic SaaS dashboard.

## Colors

| Token | Hex | Use |
|---|---|---|
| Background | `#0D0D12` | Page background, deepest surfaces |
| Surface | `#181820` | Cards, panels, elevated sections |
| Surface 2 | `#20202A` | Secondary elevation (e.g. chat bubbles) |
| Primary | `#8B5CF6` | Buttons, active states, selected elements, progress |
| Accent | `#C084FC` | Highlights, gradients, hover states — never body text |
| Text primary | `#FFFFFF` | Headings, high-priority content |
| Text secondary | `#A1A1AA` | Descriptions, metadata, timestamps, inactive nav |
| Success / online | `#34D399` | Online status, success toasts |
| Danger | `#F87171` | Errors, validation |
| Stars | `#F5B94A` | Rating stars |
| Border (subtle) | white at 6% | Card edges, list dividers (`border-line`) |
| Border (strong) | white at 10% | Tab bars, inputs, secondary buttons (`border-line-strong`) |
| Glow 1 / Glow 2 | `#8B5CF6` / `#EC4899` | PageGlow's hero pair (the soft glow uses Glow 1 with Accent). Pink appears nowhere else. |

All colours live as tokens in `src/styles/index.css` (`@theme`). Components use the Tailwind names (`bg-surface`, `text-muted-foreground`, `border-line`); no hex or rgb values in components.

Purple is an accent, used strategically (currently-playing state, active nav, AI elements, primary CTA, progress) — never a dominant fill color. Gradient: `#8B5CF6 → #C084FC`, soft and atmospheric, never a strong neon glow.

## Typography

Inter throughout.

| Role | Weight / size |
|---|---|
| Page titles | Bold, 28–32px |
| Section titles | Semi-Bold, 20–24px |
| Card titles | Semi-Bold, 15–17px |
| Body | Regular, 14–16px |
| Secondary text | Regular, 13–14px |
| Metadata | Medium, 12–13px |
| Buttons | Semi-Bold, 14–15px |

## Components

- **Cards:** `#181820` on `#0D0D12`, 18px radius (`rounded-card`), generous padding, subtle shadow, a 1px subtle border (`border-line`).
- **Buttons:** primary = `#8B5CF6` fill + white text, 8–10px radius; secondary = `#181820` fill; ghost = transparent + white/secondary text. Not every button should be pill-shaped.
- **Navigation:** inactive = `#A1A1AA`; active = white text/icon + `#8B5CF6` accent, optional low-opacity purple background. Bottom nav: Home / Explore / Library / Profile (per mockup — no search icon in the bottom nav, search lives inside Explore).
- **Icons:** one consistent stroke-based icon set throughout.
- **Animations:** subtle only — fades, slight scale, smooth card/album-artwork transitions. No bouncing, no particle effects, no constant motion. One deliberate exception: Beatie's thinking face bobs 2px while a request is running (`animate-beatie-bob`), only then, and not at all when the user has reduced motion on.

## Shape and depth tokens

| Token | Value | Use |
|---|---|---|
| `rounded-card` | 18px | Cards, empty states, tiles |
| `rounded-sheet` | 20px | Top corners of bottom sheets; dialogs |
| `rounded-inset` | 12px | A panel inside a card (the song strip on a feed card) |
| `rounded-cover` | 10px | Artwork and playlist covers |
| `rounded-thumb` | 8px | Small thumbnails, 44px and under |
| `rounded-button` | 9px | Buttons |
| `rounded-chip` | full | Chips |
| `shadow-card` | | Cards |
| `shadow-raised` | | Sheets, dialogs, popovers |
| `glass-bar` | | Sticky bars: the page shows through, dark and blurred (top bar, tab bars, mini player, bottom nav) |
| `animate-page-in`, `animate-fade-in`, `animate-glow-in` | 260 / 200 / 600ms | Entrances and the glow's colour cross-fade. Always paired with `motion-reduce:animate-none`. |

## Shared components

All in `src/components/ui/`. Use these rather than building the look again.

- **`PageGlow`** — the soft light behind the top of a page. Two layered radial gradients with a fade-out mask; no blur filters, so scrolling stays smooth on cheaper phones. `strength`: `hero` (fills a page header, as on the profile), `soft` (a fainter wash over the top 420px) or `none`. `colors` is a pair of opaque colours (defaults to Glow 1 and 2 for hero; Glow 1 and Accent for soft, since pink reads as a red smudge when faint); when they change the new glow cross-fades in (instant with reduced motion). Decorative: `aria-hidden`, no pointer events, absolutely positioned, so the parent needs `relative isolate`.
- **`useCoverColors(url)`** (`src/lib/coverColors.ts`) — the two main colours of a cover or artist photo, read in the browser, darkened so text over the glow keeps at least 4.5:1, and cached per URL for the session. Returns `null` until known or when the image can't be read; pass the result to `PageGlow` and let it fall back to purple.
- **`Card`** / **`cardClass()`** — surface, 1px subtle border, 18px corners, shadow. `padding`: `none`, `sm` (list rows), `md` (content), `lg` (empty and lock states). `as` keeps the right element (`article`, `li`, `section`); `cardClass()` is the same look for a `Link` or a `button`.
- **`Tabs`** + **`TabPanel`** + **`useTabParam`** — underlined tabs, 48px tall, a real tablist (arrow keys, Home and End). `sticky` puts the bar on `glass-bar` under the top bar. `useTabParam` keeps the tab in `?tab=` so links and Back work. Use tabs to switch between views of a page.
- **`Segmented`** — a two- or three-way switch inside one view (Songs / Reviews, Artwork / Lyrics).
- **`Chip`** — filters within one list (Explore's result types, a review filter). 44px tap area by default without looking bigger. Not for switching pages; that's Tabs.
- **`SectionHeader`** — a section title, an optional muted subtitle, an optional "See all" (link or button, 44px target).
- **`EmptyState`** — Beatie, one line, an optional detail and at most one action (`emptyActionClass`, or `emptySecondaryActionClass` for Retry). Stickers at 96px, faces at 64px; `compact` for small spaces; `tone="error"` for a failed load.
- **`Skeleton`**, **`SkeletonRow`**, **`SkeletonList`**, **`SkeletonTile`**, **`SkeletonCard`** — loading shapes in the layout's place, pulsing (still with reduced motion). No spinners for page content; spinners are only for a button that's working.
- **`Modal`** (dialog on desktop, bottom sheet on phones) and **`Sheet`** (popover on desktop, bottom sheet on phones) share one surface, 20px corners, the raised shadow and the drag handle.

Every control is at least 44px tall, or has a 44px tap area.

## How to build a new page

1. **Root:** `<div className="relative isolate flex flex-col gap-6 animate-page-in motion-reduce:animate-none">`. `isolate` keeps the glow behind the page and in front of the app background.
2. **Glow:** pick one.
   - A page about one thing with a picture (a song, album, artist, playlist): a header with `<PageGlow strength="hero" colors={useCoverColors(url) ?? undefined} />`.
   - A browsing page (Home, Explore, Library, sign-in): `<PageGlow strength="soft" />` as the root's first child.
   - Admin and lists (Settings, Notifications): no glow.
3. **Title:** an `h1` in `text-page-title`, or the hero for a picture page.
4. **Views:** more than one view of the page → `Tabs` with `useTabParam`, `sticky` if the content is long. Filters on one list → `Chip`s in a `role="group"`.
5. **Sections:** each starts with a `SectionHeader`; the content sits on `Card`s. Lists go on one card with rows inside, not a card per row.
6. **States:** loading → the matching `Skeleton` shapes; nothing to show → `EmptyState`; failed → `EmptyState` with `tone="error"` and a Retry action.
7. **Sheets and dialogs:** `Modal` or `Sheet`, never a hand-made overlay.
8. **Check:** phone (360px and Pixel 7) and desktop; every tap target 44px; reduced motion on; white text over any glow reads at 4.5:1.

## Layout principles

Dark background dominates; use generous spacing between sections/cards; don't fill every empty space — whitespace is part of the design. Music content (artwork, song info, lyrics, reviews) gets more visual weight than decorative UI chrome.

## RTL support

The app supports RTL (Arabic) per-line, including mixed-direction lyric translation blocks (original line one direction, translation the other) — see the mockup's RTL "Now Playing" screen as the reference implementation.
