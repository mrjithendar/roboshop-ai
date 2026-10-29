# Design system

One source: `src/app/globals.css` (Tailwind 4 `@theme`). Components use semantic tokens, so light and dark
need no duplicated `dark:` pairs.

## Colour

| Token (class) | Light | Dark | Use |
|---|---|---|---|
| `canvas` (`bg-canvas`) | white | near-black `oklch(.165 .006 255)` | page |
| `surface`, `surface-muted`, `surface-sunken` | white / slate-50 / slate-100 | raised greys | cards, bands, wells, hovers |
| `fg`, `fg-muted`, `fg-subtle` | ink / slate-600 / slate-500 | near-white / slate-300 / slate-400 | text (all ≥ 4.5:1) |
| `line`, `line-strong` | slate-200 / slate-300 | white 10% / 18% | borders, dividers |
| `accent`, `accent-hover`, `accent-text`, `accent-soft`, `on-accent` | brand-600/700 | brand-400/300 | the only accent: actions, links, current state |

- `slate-*` is retuned to a near-neutral grey; `brand-*` is one muted blue (hue 255–259). `accent-400/500`
  alias brand so no second hue can reappear.
- Semantic colours stay Tailwind's: red (errors, destructive), amber (warnings, corrections, preview),
  emerald (success), yellow (sponsored disclosure).
- Category identity is a tinted glyph on a neutral tile (`categoryStyle.ts`); content types are neutral
  pills with a coloured dot. No gradients, glass or glow.

## Type

Inter (variable, self-hosted by `next/font`, preloaded) and JetBrains Mono (code only, not preloaded).

| Token | Size | Use |
|---|---|---|
| `text-display` | 32 → 48px fluid, 1.1 | homepage intro |
| `text-title` | 28 → 40px fluid, 1.15 | page and article titles |
| `text-heading` | 22 → 28px fluid | section headings |
| `text-xl` / `text-lg` | 20 / 18px | card leads, descriptions |
| `text-base` | 16px | body UI, **all form inputs** (no iOS zoom) |
| `text-sm` | 14px | secondary text, labels, meta |
| `.article-body` | 17px (phones) / 18px, line height 1.75–1.78 | article and page prose |

Weights 400/500/600/700 only. The reading column (`max-w-reading`, 43rem) is about 70 characters at 18px.

## Space and layout

- Containers: `Container` = page shell 76rem (1216px content, ≈1280 with gutters) or `narrow` reading width;
  gutters 16 / 24 / 32px (`px-4 sm:px-6 lg:px-8`).
- Section rhythm `--spacing-section` (48 → 80px fluid): `py-section`, `space-y-section`, `mt-section`.
- Header height `--spacing-header` (64px); `scroll-padding-top` keeps anchors clear of the sticky header.
- Breakpoints: Tailwind defaults (640, 768, 1024, 1280). Article TOC sits in the right margin from 1280px,
  a disclosure below.
- Radii: controls 8px (`rounded-lg`), cards/panels 12px (`rounded-xl`; `2xl`/`3xl` collapse to it).
- Shadows: hairline only (`shadow-xs/sm`), `shadow-lg` for menus and dialogs.

## Components and states

- `components/ui/form.tsx`: `Button` (primary, secondary, ghost, danger × sm 36 / md 44 / lg 48px, `loading`
  with spinner + `aria-busy`), `buttonClass()` for links, `Input`/`Select`/`Textarea` (44px, 16px text,
  `aria-invalid` red state), `Field` (label, optional marker, hint, error with icon and `-error` id), `Alert`.
- States: hover = surface/line shift; focus = 2px accent outline (`:focus-visible`, global); active/current =
  `accent-soft` + `accent-text` or an accent underline; disabled = 55% opacity + `not-allowed`; loading =
  spinner; skeleton = `.skeleton` utility (pulse, off under reduced motion).
- Icons: `components/icons.tsx` (1.75 stroke, 16/20px). No emoji as icons.
- Code blocks: framed, language label from Shiki (`data-language`), labelled copy button with live
  announcement; tables and code scroll inside their own focusable region.

## Theme

System preference by default; the header toggle (light ↔ dark) and the footer System/Light/Dark control store
an explicit choice in `localStorage.theme`. An inline script in `<head>` sets `data-theme` before first paint,
so there is no flash; without JavaScript the CSS follows `prefers-color-scheme`. Reduced motion disables
transitions and animations globally.
