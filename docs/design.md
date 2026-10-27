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

## Data visualisation (27 Oct 2026, Insights band and /impact)

No chart library: bars and strips are HTML/CSS, drawn from the same numbers the text prints.

1. **Gold only for money.** A bar that shows euros (money still claimable per carrier, recovered
   money on /impact) is `gold` with a `gold-soft` track, and its figure is `gold-ink`. Anything
   that counts things (decisions, cases) is ink (`ink-soft` on a faint ink track). What a deadline
   took is hatched with `border-strong`, never a red or a second hue.
2. **A text alternative that is visible.** A chart is `aria-hidden` only when the same facts sit next
   to it as text (a row per bar with its label, count and amount; an ordered list under the timeline
   with every window, its date and its countdown). Nothing exists only in a picture.
3. **Shape, ring and words before colour.** The timeline marks a claim deadline with a circle and a
   reserve window with a diamond, a recorded run with a hollow ring, and anything closing within 3
   days with the `warning` token plus a clock icon and the words "under 3 days". Urgency is about
   the clock on the wall: a recorded run, counted from its own recording day, never wears it (day 0
   reads "Recording" when only recorded runs are drawn, "Now" otherwise).
4. **Honest scope in the chart.** Recorded runs are counted only when the switch says so, are
   labelled in the list and the legend, and are read as of their recording day. A chart with nothing
   to show says so in a sentence instead of drawing empty bars (`DecisionMix`: "No decision yet",
   `CarrierBreakdown`: "No claim open"). A panel names its scope when a figure nearby counts
   something else (every open claim of any month, against the counter's current month).
5. **Estimates say they are estimates.** On /impact every input carries a badge: *Your figure* (an
   example the merchant replaces) or *Assumption*. A number nobody measured never wears a source's
   authority; the one measured number (the agent's time) comes from the recorded runs and links
   back to them (each run in the table is a link to its case, with whether it drew a SAM outline).
   An assumption sits in the form with its badge and in the "Assumed" list, never hard-coded in the
   maths (the share of Mondial Relay parcels refused at delivery was, once). A negative result is
   said in words ("Less recovered…", "Extra time per case…"), not printed with a minus sign.

## Live run (27 Oct 2026)

While a report is sent, the form's fields give way to the live timeline
(`src/components/report/live-run.tsx`, state in `live-run-state.ts`): one row per real event with the
server's clock (`+4.2 s`) and duration, an ink thread on a hairline track, a status circle (spinner,
check, cross, or a warning tone for guardrails and notices; never colour alone), and a side column
with the order card, the SAM image (fades in on load, `motion-reduce` off) and the claim amount in a
gold card under a Border Beam, rolled up with the Arc counter (gold is still only money).
Layout, measured in a browser on 28 Oct 2026 at 375, 768, 1024 and 1280 px (the real component under the
real Tailwind build, in a harness that copies the page's container and grid; the Arc counter's CSS module
was not loaded there): one column below `md` (card 343 px at 375); two columns from `md` to `lg`, where the
page is still one column and the card is full width (768 px: timeline 374, side column 256); ONE column
from `lg` to `xl`, because at `lg` the page puts the demo cases beside the form, the card shrinks to ~600 px
and a second column would leave the timeline ~270 px (1024 px: timeline 534, side column stacked under it);
two columns again from `xl` (1280 px: card 720, timeline 350, side column 280). Not checked: widths
between those four, and the real page with the real photo and the real counter. A polite `role="status"` region
announces each finished step, what the page is doing at the start ("Sending the report."), and at the end that
the case opens by itself in 5 seconds unless the person stays (WCAG 2.2.1); the list itself is not live.
The footer follows the timeline, not the form: no "Investigating..." button or "can take a little while"
line once the run is over, "File another report" instead (it empties the form). If the connection drops after
the case was stored, the timeline stays with its own alert and a link to the case, and no "send again" hint.
The header clock is labelled by whose it is: "N s since you sent it" (the browser's, upload included) while
the run goes on, "N s on the server" at the end, and none at all in DEMO MODE. DEMO MODE is a warning pill,
"DEMO MODE (scripted)", with no timings. The first model turn says what the model was really shown ("the
report and the photos", "the report and some of the photos", or "the report (photos not shown to it)").
Guardrail rows are plain sentences ("Sent to a human: ...", "No carrier claim: ..."), never field names. The old five-step list (`agent-working.tsx`) stays only as the fallback when no stream
arrives, and says it is an illustration.
