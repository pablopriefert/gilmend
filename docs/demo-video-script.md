# Gilmend demo video script (3 minutes, voice-over in English)

Story: **a broken vase becomes a claim ready to recover the money.** The vase is told in full (the
customer's report, the LIVE run, the evidence, the claim, the click), then three things a judge
may doubt: the agent that keeps working on a case when the photo is bad (round 2 on the blurry
lamp), the agent that checks the photos before it believes them (the integrity signal), and
the proof that it holds up (`/impact`, `/eval`). Closing on the money still recoverable.

Target length: at most 3:00. The spoken text below is 386 words with the optional voice shot and
362 without it (counted on the one-piece text, each bracketed figure as one word), at about 105
to 145 words a minute depending on the shot, which leaves room for the screen-only beats (the
timeline filling, the PDF, the click). Subtitles on. If the voice shot is cut the video is 10 seconds
shorter: never pad it.

Open weights ("Run privately") were in the previous cut of this script. They are **out** of this one: no run
of Muse Spark Open or Muse Glimmer has been seen live (README, "Open weights"), and the three minutes are full.
Say nothing about open weights in the video. Put them back only after a real run, with the host named.

## Before recording: what must be true

The voice-over only claims what the code does. Check these before pressing record, and change the
lines that no longer hold.

1. **Real mode, and say so on screen.** The script is written for a recording made with a real
   `MODEL_API_KEY` (plain `npm run dev`, or the deployed site with the access code; engine
   "Muse Spark 1.3"). The six demo cases ran end to end on the real Muse Spark 1.3 and SAM 3.1 on
   27 Oct 2026, so a live run works. The committed evaluation (`data/eval/`, 18 runs) took 16.7 to 32.5 s a
   run, 28.2 s at the median, so the wait is cut with a visible "sped up" caption, never silently.
   The live run (shot 3) and the case it opens (shot 4 and 5) are **one run**. The six recorded
   runs were typed and never dictated, so a recorded run can never stand in for the dictated case; if the
   microphone fails (item 3), type the message, cut the voice shot, and either file a live run or open
   the recorded run of case 1 (caption "Recorded real run", and say it is one).
   **Case 1 is not stable.** Muse read the same vase photo four times on 27 Oct: packaging adequate with the
   52.90 EUR claim on two runs, inadequate on the other two. A packaging reading of "inadequate" no longer
   cancels the claim (it stays, the merchant is warned and the case is handed to a human), but that path has not
   been seen on a live run. The scripted decision is "reship and claim, confidence [confidence]" only if the take
   shows it: if the take gives no claim, or hands the case to a human, say what the screen says, re-file once, or
   film case 4 (the parcel opened at the relay, 25 EUR) and change the lines that name the vase. (The committed
   evaluation gave the reship and the 52.90 EUR claim in 3 runs of 3 on 27 Oct: that is a measurement of 27 Oct,
   not a promise for the take.)
   **Never film demo mode as if it were real.** If the whole video is recorded in demo mode
   (`npm run dev:demo`), the "DEMO MODE" badge stays on screen, the narrator never says Muse read the photo,
   and no confidence, amount or outline is read out as Muse's.
   **Numbers.** The narrator quotes only figures that are on screen in the take, or in the committed
   evaluation. Every figure in square brackets below is read from the screen of the take, and the sentence is
   changed if the decision is not the one scripted. Do not rehearse a figure from an earlier run.
2. **Photos.** `data/photos/` holds seven images **generated with Muse Image** (`muse-image-1.0`), not photographs
   taken by the team (the six cases and the sharp lamp of the demo reply). They may appear in the video, with the
   on-screen caption "Demo photos generated with Muse Image" and the voice-over line of shot 3. Never present them
   as real photos.
3. **Voice shot (shot 2) only if the microphone works.** The recorder has been tested with a fake `MediaRecorder`
   only, and Muse Voice Transcribe with real API calls from a script, never with a microphone in a real browser.
   Try it in the browser you will film (HTTPS or localhost, microphone allowed), in real mode, before recording.
   If it fails, type the message and cut shot 2. The shot is a **live dictation**: speak a short sentence ("My vase
   arrived broken. Order 1001." came back correctly in about 2 s from a script) and show the transcript filling the
   box. Digits can come back as words ("Order one thousand one"): check the transcript on screen and correct the
   order number if needed (the case records that it was edited). Voice is off in "Run privately" mode, and in demo
   mode the endpoint returns a labelled canned transcript that must not be called Muse's.
4. **The lamp (shot 6).** Open the **recorded run** of the blurry lamp (badge "Recorded run"): decision "Ask for more
   photos", no claim. On "The customer replied" press **Demo: simulate the customer's reply**, then **Run the agent
   again (round 2)**; cut the wait ("sped up"). The browser opens a NEW case (the recording is forked, never
   changed, so the take can be repeated). The page shows **Rounds of this case** and "What changed since round 1":
   read the figures from it. A real round took 37 s on 27 Oct 2026 and gave "reship, claim up to 102.30 EUR,
   confidence 0.92"; a fork run on the deployed site on 28 Oct gave the same figures (case
   `real_demo-3-photo-blurry-followup-910ee059`, which can stand in as a recorded take of this shot, with the
   caption "Real run, 28 Oct 2026, simulated reply"). Muse is not deterministic: if the take says something else,
   say what the screen says. The reply is **simulated**, and the page says so; say it.
5. **The integrity signal (shot 7).** Needs a real run (the check is code and works in demo mode, but its effect on
   the decision is only the guardrail). File the broken vase photo for **another order**: order `#1002`,
   `hugo.bernard@example.com`, the "Broken vase" photo. On 27 and 28 Oct 2026 Muse called the tool in its first
   turn, saw the signal, handed the case to a human (confidence 0.25 on the 28 Oct run; the case lists three guardrail
   reasons: low confidence, fraud or manipulation suspected, and the photo integrity signal) and wrote a neutral reply. The case page shows
   the **Integrity** row: "1 signal: a person must look". The 28 Oct run is on the deployed site
   (`case_1038d17b-4303-4d0e-bcbc-8320f5b7c64b`), a live case and not a recorded run: it may stand in, with the
   caption "Real run, 28 Oct 2026". Say "flagged" and "a person must look", never "fraud" or "fake".
6. **`/eval` and the commit.** The page warns when the agent deployed is not the one that was measured (it reads
   "Measured on commit 0eab783; the agent deployed here (71d8cf2) is not that one" on 28 Oct 2026). Re-run
   `npm run eval -- --runs 3` on the final `main` (about 1.20 USD, ask Pablo first) and commit the file; the
   figures in the script are then re-read from the page. Until then, film the warning banner and say the figures
   are the committed ones. Do not read the cost out as a bound: it is an estimate at Meta's starting price.
7. **The counter.** Read the number on screen; do not rehearse a figure. Recorded runs are left out of the live
   counter by design (it reads zero on a deployment with only recordings); a second tile gives their figure (327.90
   EUR across three claims, as of 27 Oct 2026, when this was written). Re-run `npm run demo` shortly before filming
   a local take so the deadlines are fresh.
8. Fictitious customers and orders only. No real tracking labels, addresses or people anywhere.

### Before filming locally

Film either on the deployed URL (https://gilmend.vercel.app, with the access code typed off camera), or on a clean
local runtime: `data/runtime/` must not hold old runs. Every `npm run real` writes a `real_demo-*` case there with
the same id as a recorded run, and a stored case shadows the recording (`layered-store.ts`): the list then shows
your own run without the "Recorded run" badge and the counter counts it. So, before recording locally: stop the dev
server, move the folder away (`mv data/runtime data/runtime.away`), run `npm run demo`, start the app in real mode,
and check that the six recorded runs show the "Recorded run" badge. Put the folder back afterwards. The access code
never appears on screen: type it before the take, and keep the field out of the frame.

### B-roll and fallbacks already in the repository (`docs/assets/`)

Captured on 28 Oct 2026 at 1440x900. Use them for thumbnails, X posts and as a **fallback** when a take fails,
with their label on screen; never as the live shot.

| File | What it is | Source |
|---|---|---|
| `screens/cases.png`, `cases-list.png` | Cases: counter, recorded-run tile, the list | Deployed site (71d8cf2) |
| `screens/case-decision-and-sam.png` | Recorded run of the vase: decision card and SAM outline | Deployed site, recorded run |
| `screens/case-round-2-blurry-lamp.png` | Rounds of the lamp, "What changed since round 1", "Simulated reply" | Deployed site, real run of 28 Oct, simulated reply |
| `screens/case-integrity-signal.png` | Integrity row with one signal | Deployed site, real run of 28 Oct |
| `screens/impact.png`, `screens/eval.png` | `/impact`, `/eval` | Deployed site |
| `screens/live-run-demo-mode.png`, `live-run.gif` | The live timeline of one **DEMO MODE** run: no model, no SAM, steps labelled "scripted" | Local server, demo mode: not Muse, not production |
| `social-card.png` | The 1200x630 link-preview card | Rendered from `src/app/opengraph-image.tsx` |

## Shot list

| Time | On screen | Voice-over |
|---|---|---|
| 0:00 – 0:17 | **New report**, the "Broken vase" scenario: the customer's message, order #1001. Cut to the carrier rules card of a case; highlight "72 hours" (Mondial Relay) and "3 days" (Chronopost). | "A customer writes: my vase arrived broken. For a small shop, that is two jobs. Make her whole, then chase the carrier for the money, before the deadline kills the claim. Mondial Relay gives you 72 hours. Chronopost, three days." |
| 0:17 – 0:27 | **Only if the microphone works.** Click the microphone in the message box, speak ("My vase arrived broken. Order 1001."), the transcript fills the box (check the order number on screen). | "She can just say it. Muse Voice Transcribe turns the clip into the message, still editable, and the case records that it was dictated." |
| 0:27 – 0:51 | Engine **Muse Spark 1.3 (Model API)**; attach the photo; caption "Demo photos generated with Muse Image". Send. The **live timeline**: one row per real step with the server's clock (`+4.2 s`), the order card, the photo check, the SAM image fading in, the claim amount rolling up in gold. Caption "sped up" over the wait. | "This is Gilmend: an agent on Muse Spark 1.3, through the Meta Model API. Watch the run, live. Every row is a real step with the server's clock: the order, the photo check, the reading of the photo, the SAM outline, the carrier's rules. The photos are generated with Muse Image, so no real customer appears." |
| 0:51 – 1:16 | **Case view** (the case the live run opened): "What the agent saw", the **annotated photo** (what SAM outlined) next to the raw one, then the **Decision card**: reship, carrier claim yes, the confidence. Zoom on the maximum compensation and its source. If the trace shows "Evidence fallback", the code asked SAM, not Muse: skip the line or say so. | "Here is the case. SAM 3.1 outlined [what it matched] on the photo, as evidence for the claim: context, not a verdict. Decision: reship, and claim the carrier, confidence [confidence]. The maximum compensation is [amount] euros, from the carrier's published terms, with the source and its date next to it. The model never writes an amount or a deadline." |
| 1:16 – 1:32 | **Claim document**: the PDF preview, the e-mail to the carrier, the drafted reply. End on **Approve**; click it. Banner: "Approved: ready to send. Gilmend sends nothing by itself." | "Gilmend builds the claim PDF and the e-mail to the carrier, and drafts the reply in the customer's language. Guardrails in code can only make a decision stricter. It sends nothing: the merchant clicks Approve." |
| 1:32 – 1:59 | **The blurry lamp**, recorded run: "Ask for more photos", no claim. **Demo: simulate the customer's reply**, **Run the agent again (round 2)** ("sped up"). The new case: **Rounds of this case**, "Simulated reply" badge, "What changed since round 1" (decision, damage read, photo quality, carrier claim). | "A blurry photo is not a dead end. On this lamp, the agent asks for a sharper one. The customer replies, here a simulated reply with a photo generated for the demo, and the agent runs again on the same case, with everything it knew: [round 2 decision and claim]. The deadline still counts from the delivery date, not from the reply." |
| 1:59 – 2:16 | The case filed with the vase photo for order #1002: the **Integrity** row, "1 signal: a person must look", the photo found "like a demo photo filed for another order". Then the Decision card marked "Needs your judgement". | "And it checks the evidence before it believes it. The same demo photo, filed for a different order, is flagged: not rejected, not accusing anyone. The case goes to a human, with the reason in plain words." |
| 2:16 – 2:40 | **/impact**: change one input, the two bars move; the "Your figure" and "Assumption" badges. Then **/eval**: the four tiles, the warning banner, the "Case by case" list, with the one miss (the blurry lamp, run 1). | "Impact: type your shop's numbers and see what a missed deadline costs; every assumption wears a label. Eval: six cases, three runs each, [17 of 18] runs met what we expected, and the page says it is a sanity check, not a benchmark." |
| 2:40 – 3:00 | **Cases** header, full width: "Recoverable this month", "Claims due this week", the recorded-runs tile. Hold, then the title card: "Gilmend. Broken parcels, mended in gold. Built during the Meta Global AI Developer Hackathon." | "At the top, the money still recoverable, and the claims about to expire. All six demo cases ran on the real models. A broken vase, turned into a claim ready to file. Gilmend. Broken parcels, mended in gold." |

## Spoken text, in one piece (for the recording take)

Real mode, with the voice shot (the second paragraph); cut it if the microphone fails. Replace each `[bracket]`
with the figure or the words read from the screen of the take.

> A customer writes: my vase arrived broken. For a small shop, that is two jobs. Make her whole,
> then chase the carrier for the money, before the deadline kills the claim. Mondial Relay gives you
> 72 hours. Chronopost, three days.
>
> She can just say it. Muse Voice Transcribe turns the clip into the message, still editable, and
> the case records that it was dictated.
>
> This is Gilmend: an agent on Muse Spark 1.3, through the Meta Model API. Watch the run, live.
> Every row is a real step with the server's clock: the order, the photo check, the reading of the
> photo, the SAM outline, the carrier's rules. The photos are generated with Muse Image, so no real
> customer appears.
>
> Here is the case. SAM 3.1 outlined [what it matched] on the photo, as evidence for the claim:
> context, not a verdict. Decision: reship, and claim the carrier, confidence [confidence]. The
> maximum compensation is [amount] euros, from the carrier's published terms, with the source and
> its date next to it. The model never writes an amount or a deadline.
>
> Gilmend builds the claim PDF and the e-mail to the carrier, and drafts the reply in the customer's
> language. Guardrails in code can only make a decision stricter. It sends nothing: the merchant
> clicks Approve.
>
> A blurry photo is not a dead end. On this lamp, the agent asks for a sharper one. The customer
> replies, here a simulated reply with a photo generated for the demo, and the agent runs again on
> the same case, with everything it knew: [round 2 decision and claim]. The deadline still counts
> from the delivery date, not from the reply.
>
> And it checks the evidence before it believes it. The same demo photo, filed for a different
> order, is flagged: not rejected, not accusing anyone. The case goes to a human, with the reason in
> plain words.
>
> Impact: type your shop's numbers and see what a missed deadline costs; every assumption wears a
> label. Eval: six cases, three runs each, [17 of 18] runs met what we expected, and the page says
> it is a sanity check, not a benchmark.
>
> At the top, the money still recoverable, and the claims about to expire. All six demo cases ran on
> the real models. A broken vase, turned into a claim ready to file. Gilmend. Broken parcels, mended
> in gold.

## Claims checklist (each line of the voice-over, and where the code does it)

| Claim in the voice-over | Where it is true |
|---|---|
| Two jobs: make the customer whole, chase the carrier | `src/lib/agent/` (decision plus claim); README "The problem" |
| 72 hours Mondial Relay, three days Chronopost | `data/carriers.json` (both marked verified) |
| Muse Voice Transcribe turns the clip into the message; the case records it was dictated | `src/lib/voice/`, `src/app/api/transcribe/route.ts`, `src/components/voice-recorder.tsx`; verified with real API calls, **not yet with a real microphone in a browser** (item 3) |
| An agent on Muse Spark 1.3, through the Meta Model API (Standard mode) | `src/lib/config.ts` (`muse-spark-1.3`, `assertStandardModel`) |
| Live run: every row is a real step with the server's clock | `src/lib/agent/events.ts`, `src/components/report/live-run.tsx`; NDJSON stream of `POST /api/reports`. In DEMO MODE the rows say "scripted" and show no clock: only the real-mode take may use this line |
| Order, photo check, reading of the photo, SAM outline, carrier's rules (the rows) | `run-agent.ts` events: `get_order`, `check_photo_integrity`, `assess_photos`, `mark_damage`, `get_carrier_rules`, `compute_claim` |
| The photos are generated with Muse Image | `data/photos/README.md`, `scripts/generate-demo-photo.mjs`, README "About the demo photos" |
| SAM 3.1 outlined `[what it matched]`, context not a verdict; the claim carries the annotated photo | `src/lib/evidence/` (`mark_damage`, evidence fallback in `run-agent.ts`); raw photo when SAM fails or is skipped; README "SAM 3.1 segments things, not states". Read what was outlined from the take (recorded run of case 1: five shards, "broken pottery") |
| Decision, confidence `[confidence]` | Read from the Decision card of the take. In the recorded run of case 1 it is 0.95, in the committed evaluation 0.95 on three runs; a live take can differ |
| `[amount]` EUR = 23 EUR/kg x 2.3 kg (52.90 for case 1) from the carrier's published terms, source and date shown | `data/carriers.json` (Colissimo, dated source), `data/fixtures/orders.json` (#1001, 2.3 kg); `computeClaim` in `src/lib/rules/carriers.ts` |
| The model never writes an amount or a deadline | `src/lib/rules/carriers.ts` (`computeClaim`), `src/lib/agent/guardrails.ts` |
| Claim PDF, carrier e-mail, reply in the customer's language | `src/lib/documents/`, `draft_claim_document`, reply language from the report |
| Guardrails in code can only make a decision stricter | `src/lib/agent/guardrails.ts` (`CONFIDENCE_THRESHOLD` 0.7, `HIGH_VALUE_EUR` 300, fraud and integrity signals) |
| It sends nothing; the merchant clicks Approve | `src/components/case-review-panel.tsx` (Approve/Edit/Reject, no sending code) |
| A blurry photo: the agent asks for a sharper one; the customer replies; the agent runs again on the same case | `resumeAgent` in `src/lib/agent/run-agent.ts`, `POST /api/cases/[id]/follow-up`, `src/components/follow-up-panel.tsx`; README "The follow-up loop" (a real round on 27 Oct: 37 s, reship, up to 102.30 EUR, confidence 0.92) |
| The reply is simulated, with a photo generated for the demo | `data/photos/lamp-sharp.webp` recognised byte for byte by the route; the case shows "Simulated reply", and the counters leave its claim out |
| The deadline still counts from the delivery date, not from the reply | `resumeAgent` (order of round 1 reused, deadlines from the delivery and the ORIGINAL report date), tested with the real claim maths |
| The same demo photo filed for a different order is flagged, not rejected; the case goes to a human with the reason | `src/lib/integrity/` (`check_photo_integrity`, real code even in demo mode); a signal only forces `needsHuman` (`guardrails.ts`); README "Evidence integrity" (live run of 27 Oct, and a deployed run on 28 Oct) |
| Impact: your numbers, every assumption labelled, the cost of a missed deadline | `src/lib/impact/roi.ts`, `src/components/impact/`; every input carries "Your figure" or "Assumption" (`docs/design.md`) |
| Eval: six cases, three runs each, `[17 of 18]` met what we expected, a sanity check not a benchmark | `data/eval/2026-10-27-muse-spark-1.3.json` (17 of 18 runs met every expectation, 5 of 6 cases gave the same answer each time, median 28.2 s), `/eval` page; re-run on the final `main` (item 6) |
| All six demo cases ran on the real models | README "Measured on the real models" (27 Oct 2026); `data/showcase/` |
| Counter: recoverable this month, claims due this week | `src/lib/store/summary.ts`, `src/components/cases-header.tsx` |

## Things the narrator must not say

- "Muse analysed the image" in any take recorded in demo mode, and never call `docs/assets/live-run.gif` or
  `screens/live-run-demo-mode.png` a Muse run: they are a scripted DEMO MODE run on a local server.
- That Gilmend files, sends or submits anything on its own.
- Any amount or percentage that is not on screen or in the committed evaluation (no "recovers X percent", no market
  figures, no figure from the `/impact` defaults as if it were a statistic: they are examples the visitor replaces).
- That Colissimo's figures are current: they come from the 2020 terms, the 2026 terms are not public.
- That the open-weights run exists or was tested (it was not run live; it is out of this cut).
- That the demo photos are real photographs: they are generated with Muse Image.
- That the voice report was tested with real customers or accents, or that a recorded run is live. The six recorded
  runs were typed; only the live run of the voice shot was dictated.
- That the SAM outline marks the damage: it shows what SAM matched (the item, its pieces or the box). On the recorded
  headphones it covers the whole pair, not the cracked shell alone; on the opened parcel, the whole carton.
- That the customer replied in round 2: the reply is **simulated** with a generated photo, and the page says so. Say
  "a simulated reply" every time.
- That the integrity check proves a photo genuine or catches a forger, or that it "found fraud" or "a fake": a clean
  result proves nothing, a signal is a reason to look and not a verdict, and a cropped, mirrored or edited photo gets
  through. A photo without EXIF is not a signal.
- That the eval is a benchmark, an accuracy or a success rate ("94 percent"): it is 6 cases x 3 runs on the cases the
  agent was tuned on, against expectations we wrote, on generated photos. The "expectations" are ours. Say it was
  measured on an earlier commit when the page's warning shows. The cost is an estimate, not a bound.
- That the live-run timings are the whole story: they are the server's clock on one run, and the committed
  evaluation's median is 28.2 s. No run time is quoted unless it is on screen.
- That the app is deployed at scale or that the judges' URL stores cases reliably over time: it is a public demo
  protected by an access code, and the shared store was checked only as far as README "Deploy to Vercel" says.
