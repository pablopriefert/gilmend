# Gilmend design system (27 Oct 2026)

**Name.** Gilmend = *gild* + *mend*. Kintsugi: a broken bowl repaired with gold, the crack kept
visible and made valuable. The product does the same with a broken parcel: it turns the damage
into a claim, money recovered. Tagline: **Broken parcels, mended in gold.**

**Logo.** `src/components/brand/logo.tsx` (`Logo`, `LogoMark`) and `src/app/icon.svg`: an ink tile
(the parcel seen from above, with a faint tape line) crossed by a gold seam with one branch.

## Principles

1. **Money is gold, everything else is ink.** Gold (`gold`, `gold-ink` for text) marks recovered
   or recoverable money, the brand seam and the primary action's shimmer. Nowhere else.
2. **The agent's work is the hero.** Every screen shows what the agent did and why (photo
   reading, SAM outline, rules, maths, decision), with the evidence next to the conclusion.
3. **Honest labels stay loud.** DEMO MODE, recorded runs, "needs a human", "photos not read":
   never softened by the redesign.
4. **Calm surfaces, one primary action per screen.** Warm paper background, white cards with a
   soft shadow, hairline borders, generous spacing (8 px rhythm).

## Tokens (src/app/globals.css, checked by src/app/contrast.test.ts)

| Role | Token | Use |
|---|---|---|
| Page | `background` (paper), class `.paper` | body background with faint grain |
| Card | `surface`, `surface-muted`, `border`, `border-strong`, `shadow-card`, `shadow-raised` | panels |
| Text | `foreground`/`ink`, `muted` | body, secondary |
| Accent | `accent` (lacquer ink-blue), `accent-soft` | links, secondary buttons, focus ring |
| Money | `gold` (decor only), `gold-bright`, `gold-ink` (text), `gold-soft` | amounts, seam |
| Status | `success`, `warning`, `danger` + `-soft` | pills with icon + text, never colour alone |

**Type.** One family, Geist (`font-sans`), chosen by Pablo on 27 Oct 2026. Page titles, the logo
and big money figures use `font-display`: the same Geist in semibold with tight tracking
(`-0.035em`). References (tracking numbers, order ids, model ids): Geist Mono (`font-mono`). Money and
dates in `.tabular`.

**Motion.** 150–300 ms, ease-out in; `animate-rise` for entrances (stagger 40 ms), the seam
draws itself once (`animate-seam`), Border Beam only while the agent works or on the hero total.
Everything off under `prefers-reduced-motion`.

## Components

- `src/components/arc/` (uiarc.dev, free tier, MIT): animated-counter, metric-card, badge,
  timeline, file-dropzone, segmented-control, toast. They read the Arc tokens mapped at the end
  of `:root` in globals.css.
- `src/components/ui/border-beam.tsx` (21st.dev, appica-dev) and `shimmer-button.tsx` (21st.dev,
  Magic UI / dillionverma).
- Icons: lucide-react only, 16/20 px, stroke 1.75–2. No emoji as icons.

## Live run (27 Oct 2026)

While a report is sent, the form's fields give way to the live timeline
(`src/components/report/live-run.tsx`, state in `live-run-state.ts`): one row per real event with the
server's clock (`+4.2 s`) and duration, an ink thread on a hairline track, a status circle (spinner,
check, cross, or a warning tone for guardrails and notices; never colour alone), and a side column
with the order card, the SAM image (fades in on load, `motion-reduce` off) and the claim amount in a
gold card under a Border Beam, rolled up with the Arc counter (gold is still only money). Below `xl`
the side column stacks under the timeline. A polite `role="status"` region announces each finished
step; the list itself is not live. DEMO MODE is a warning pill, "DEMO MODE (scripted)", with no
timings. The old five-step list (`agent-working.tsx`) stays only as the fallback when no stream
arrives, and says it is an illustration.
