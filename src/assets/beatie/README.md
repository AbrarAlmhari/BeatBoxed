# Beatie character assets

Beatie is BeatBoxed's music buddy: a small robot with a glowing visor, headphones and a star antenna.

Put this whole folder in the project at `src/assets/beatie/`.

## Files

- `svg/`: the master files. Use these in the app whenever possible; they stay sharp at any size.
- `png/`: the same files exported with transparent backgrounds, in several sizes (the number in the name is the size in pixels).

### Expressions

| File | Use it for |
|---|---|
| `beatie-default` | Beatie's normal look: song page card, sheet header |
| `beatie-happy` | an answer has arrived, success messages |
| `beatie-thinking` | loading ("Beatie is thinking…") |
| `beatie-excited` | first-time hello bubble, new features |
| `beatie-sleepy` | "Beatie is taking a break" and the daily-limit message |
| `beatie-sad` | general error messages, "no lyrics found" |

Files ending in `-sticker` add a little extra next to the head (a music note, a "?", "zz" or sparkles). Use them only in bigger spots like empty states, at 96px or larger.

### Special versions

| File | Use it for |
|---|---|
| `beatie-mark` | small sizes, 16–40px: the "Ask Beatie" pill, avatars next to chat replies. The head is cropped tighter so it stays readable. |
| `beatie-badge` / `beatie-badge-happy` | Beatie on a dark purple circle: app icon, share images, anywhere the character needs its own background |

## Rules

- Don't recolour, stretch or redraw the character.
- Use the SVGs as image files (`<img src={...}>` via an import), not pasted inline into the page. Each SVG uses the same internal names for its gradients, so several inline copies on one page would clash.
- Always give the image alt text, e.g. `alt="Beatie"`, or `alt=""` when the text next to it already says "Beatie".
- Minimum size: 16px for `beatie-mark`, 48px for everything else.
