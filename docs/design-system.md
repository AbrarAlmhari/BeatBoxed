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

- **Cards:** `#181820` on `#0D0D12`, 12–16px radius, generous padding, subtle shadow, minimal/no border.
- **Buttons:** primary = `#8B5CF6` fill + white text, 8–10px radius; secondary = `#181820` fill; ghost = transparent + white/secondary text. Not every button should be pill-shaped.
- **Navigation:** inactive = `#A1A1AA`; active = white text/icon + `#8B5CF6` accent, optional low-opacity purple background. Bottom nav: Home / Explore / Library / Profile (per mockup — no search icon in the bottom nav, search lives inside Explore).
- **Icons:** one consistent stroke-based icon set throughout.
- **Animations:** subtle only — fades, slight scale, smooth card/album-artwork transitions. No bouncing, no particle effects, no constant motion.

## Layout principles

Dark background dominates; use generous spacing between sections/cards; don't fill every empty space — whitespace is part of the design. Music content (artwork, song info, lyrics, reviews) gets more visual weight than decorative UI chrome.

## RTL support

The app supports RTL (Arabic) per-line, including mixed-direction lyric translation blocks (original line one direction, translation the other) — see the mockup's RTL "Now Playing" screen as the reference implementation.
