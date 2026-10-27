# Demo video script (3 minutes, voice-over in English)

Story: **a broken vase becomes a claim ready to recover the money.** One case told in full (the
customer dictates it live, the agent investigates, the merchant approves), the others in a montage,
then, only if it ran for real, the open-weights switch, ending on the recoverable counter.

Target length: at most 3:00. The spoken text below is 383 words with the optional open-weights
shot and 333 without it (counted on the one-piece text, each bracketed figure as one word), which
leaves room for the screen-only beats (the microphone, the trace, the PDF). Subtitles on. If the open-weights shot is cut, the video is shorter: never pad.

## Before recording: what must be true

The voice-over only claims what the code does. Check these before pressing record, and change the
lines that no longer hold.

1. **Real mode, and say so on screen.** The script is written for a recording made with a real
   `MODEL_API_KEY` (plain `npm run dev`, engine "Muse Spark 1.3"). The six demo cases did run end
   to end on the real Muse Spark 1.3 and SAM 3.1 on 27 Oct 2026, so a live run works; it took
   16 to 35 s in the recorded runs. The voice shot (shot 3) and the case that follows it (shots 4 to 7) are **one
   live run**: dictate, submit in real mode, cut the wait with a visible "sped up" caption. The six
   recorded runs were typed, never dictated, so a recorded run can never stand in for the dictated
   case. Recorded runs appear only in the Cases list shot, badge "Recorded run". If the
   microphone fails (item 3), type the message, cut the voice sentences, and either file a live
   run or open the recorded run of case 1 (caption "Recorded real run", and say it is a recorded
   real run).
   **Case 1 is not stable.** Muse read the same vase photo four times on 27 Oct: packaging adequate
   with the 52.90 EUR claim on two runs, packaging inadequate on the other two. A packaging reading
   of "inadequate" no longer cancels the claim (it stays, the merchant is warned and the case is
   handed to a human), but that path has not been seen on a live run. So the scripted decision is
   "reship and claim, confidence [confidence]" only if the take shows it: if the take gives no
   claim, or hands the case to a human, say what the screen says, re-file once, or film case 4 (the
   parcel opened at the relay, 25 EUR) instead, and change the lines that name the vase.
   Never film demo mode as if it were real. If the whole video is recorded in demo mode
   (`npm run dev:demo`), the "DEMO MODE" badge stays on screen, the narrator never says that Muse
   read the photo, and no confidence, amount or outline is read out as Muse's.
   **Numbers.** The narrator quotes only figures that are on screen in the take. Every figure in
   square brackets below (`[confidence]`, `[amount]`) is read from the case view of the take, and
   the sentence is changed if the decision is not the one scripted. Do not rehearse a figure from
   an earlier run: the case is re-recorded and the values can differ.
2. **Photos.** `data/photos/` holds six images **generated with Muse Image** (`muse-image-1.0`),
   not photographs taken by the team. They may appear in the video, with the on-screen caption
   "Demo photos generated with Muse Image" and the voice-over line in shot 3. Never present them
   as real photos. If the team shoots real photos before filming (`data/photos/README.md`), use
   them, test one real run first (a real photo may read differently) and change that line.
3. **Voice shot (shot 3) only if the microphone works.** The recorder has been tested with a fake
   `MediaRecorder` only, and Muse Voice Transcribe with real API calls from a script, never with a
   microphone in a real browser. Try it in the browser you will film (HTTPS or localhost,
   microphone allowed), in real mode, before recording. If it fails, type the message, cut the
   voice sentences of shot 3 and keep the Muse Image line. The shot must be a **live dictation**:
   speak a short sentence, for example "My vase arrived broken. Order 1001." (that exact sentence
   came back correctly in about 2 s from a script), and show the transcript filling the box. Digits
   can come back as words ("Order one thousand one"): check the transcript on screen before
   submitting, and correct the order number if needed (the case records that it was edited). Voice
   is off in "Run privately" mode, and in demo mode the endpoint returns a labelled canned
   transcript that must not be called Muse's.
4. **Open-weights shot (shot 9) only if it ran for real.** It needs a real run of "Run privately"
   on Muse Spark Open (Baseten: `OPEN_WEIGHTS_PROVIDER=baseten`, `npm run probe -- open-weights
   --models --chat` first) or on Muse Glimmer (Modal, `deploy/README.md`). Neither has been run
   live as of this writing. If it did not run, cut shot 9 and say nothing about open weights. Do
   not film the demo-mode fallback and call it open weights. Say the real host (the badge on the
   case names it), and never "on our own hardware" for Baseten.
5. **The counter.** Read the number on screen; do not rehearse a figure. With the six demo cases
   stored by `npm run demo`, the code computes 327.90 EUR across three claims (52.90 + 25.00 +
   250.00), and the number of claims due this week depends on the clock because the demo reports
   are timed relative to "now". Re-run `npm run demo` shortly before filming so the deadlines are
   fresh. The recorded runs are left out of the counter by design: on a deployment with only
   recorded runs it reads zero, and a second, labelled line under it ("Recorded runs: ... recoverable
   (as of 27 Oct 2026)") gives their figure, computed from the recordings (327.90 EUR when this was
   written: 52.90 + 25.00 + 250.00). Read it on screen.
6. Fictitious customers and orders only. No real tracking labels, addresses or people anywhere.

### Before filming locally

Film either on the deployed URL (once it is deployed and checked), or on a clean local runtime:
`data/runtime/` must not hold old runs. Every `npm run real` writes a `real_demo-*` case there with
the same id as a recorded run, and a stored case shadows the recording (`layered-store.ts`): the
Cases list then shows your own run without the "Recorded run" badge instead of the recording, and
the header counter counts it (recorded runs are excluded from the counter, stored copies are not),
so the number on screen is inflated. So, before recording locally: stop the dev server, move the
folder away (`mv data/runtime data/runtime.away`), run `npm run demo` for fresh demo cases, start
the app in real mode, and check that the six recorded runs show the "Recorded run" badge and that
the counter reads what the three demo claims add up to. Put the folder back afterwards.

## Shot list

| Time | On screen | Voice-over |
|---|---|---|
| 0:00 – 0:12 | **New report** screen, the "Broken vase" scenario: the customer's message, order #1001. | "A customer writes: my vase arrived broken. For a small shop, that is two jobs: make the customer whole, then chase the carrier for the money." |
| 0:12 – 0:25 | Cut to the **carrier rules** card of a case, then the three carrier names. Highlight "72 hours" (Mondial Relay), "3 days" (Chronopost), "12 months" (Colissimo). | "Every carrier has its own proof, its own cap, and its own deadline. Mondial Relay gives you 72 hours. Chronopost, three days. Miss it, and the claim is lost." |
| 0:25 – 0:43 | **Voice report, live**: click the microphone in the message box, speak ("My vase arrived broken. Order 1001."), the transcript fills the box (check the order number on screen). Caption: "Demo photos generated with Muse Image". The one photo is attached. | "She doesn't type, she talks. Muse Voice Transcribe turns the clip into the message, still editable, and the case records that it was dictated. The demo photos are generated with Muse Image, so no real customer appears here." |
| 0:43 – 0:50 | Engine selector: **Muse Spark 1.3 (Model API)**. Click submit on the dictated report and cut the wait (caption "sped up"). The case that opens is this live run. | "Damage Desk is an agent on Muse Spark 1.3 through the Meta Model API, Standard mode." |
| 0:50 – 1:18 | Open **Agent reasoning trace** and scroll: order lookup, photo reading, damage marking, carrier rules, claim computation, decision. Pause on the SAM step (if the trace shows a line "Evidence fallback", the code asked SAM, not Muse: say "the code asks SAM" or skip the line). | "It looks up the order, reads the photo, and calls tools. It asks SAM 3.1 to outline the broken item, so the claim carries a marked photo. Plain code reads the carrier's rules and computes the claim. The model never writes an amount or a deadline." |
| 1:18 | **[DEMO MODE]** variant of the two lines above | "In demo mode a scripted mock plays the same steps. It does not look at the image, and the screen says so." |
| 1:18 – 1:45 | **Case view**: "What the agent saw", the **annotated photo** (what SAM outlined: say "the broken pieces" only if that is what is outlined in the take) next to the raw one, then **Decision**: reship, carrier claim yes, and the confidence. Zoom on the maximum compensation and the deadline. | "Decision: reship the vase, and claim Colissimo, confidence [confidence]. SAM marks the broken pieces on the photo, as context, not as a verdict. The maximum compensation is [amount] euros: 23 euros a kilo, 2.3 kilos, from Colissimo's published terms, with the source and its date shown next to it." |
| 1:45 – 2:07 | **Claim document**: the PDF preview, the e-mail to the carrier, the drafted reply to the customer. End on **Approve**; click it. Banner: "Approved: ready to send. Damage Desk sends nothing by itself." | "It builds the claim PDF and the e-mail to the carrier, and drafts the reply in the customer's language. Guardrails in code can only make a decision stricter. Nothing leaves without a click, and this app sends nothing: the merchant files the claim." |
| 2:07 – 2:35 | **Cases** list (badge "Recorded run" on the six real runs), then quick cuts on four cases: crushed carton (no action), blurry photo (asks for another one), Mondial Relay case with the French reply, headphones (handed to a human: the value is above 300 euros). | "All six demo cases ran on the real models, and not every case is a claim. A crushed box with the product intact: no action. A blurry photo: it asks for another one. A parcel opened at the relay: a reply in French, inside the 72 hours. Headphones worth 349 euros: it prepares everything, then hands the decision to a human." |
| 2:35 – 2:50 | **Only if it ran for real.** **New report**, same scenario. Select **Run privately (open weights)**; the line under the selector names the engine and host. Submit; the case opens with the badge naming the model and host. | "Some merchants will not send customer photos to a cloud API. The same agent, with the same tools and output, runs on open weights: Muse Spark Open, served by Baseten. A private run never calls the Meta Model API, so SAM is skipped and the claim carries the raw photo." |
| 2:50 – 3:00 | **Cases** header, full width: the counter "€… recoverable this month · … claims due this week". Hold on it, then the title card: "Damage Desk. Built during the Meta Global AI Developer Hackathon." | "At the top, the money still recoverable, and the claims about to expire. A broken vase, turned into a claim ready to file. Damage Desk." |

## Spoken text, in one piece (for the recording take)

Real mode, with the voice shot. Cut the paragraph marked *(only if it ran for real)* if it did not.
Replace each `[bracket]` with the figure read from the screen of the take.

> A customer writes: my vase arrived broken. For a small shop, that is two jobs: make the customer
> whole, then chase the carrier for the money.
>
> Every carrier has its own proof, its own cap, and its own deadline. Mondial Relay gives you 72
> hours. Chronopost, three days. Miss it, and the claim is lost.
>
> She doesn't type, she talks. Muse Voice Transcribe turns the clip into the message, still
> editable, and the case records that it was dictated. The demo photos are generated with Muse
> Image, so no real customer appears here.
>
> Damage Desk is an agent on Muse Spark 1.3 through the Meta Model API, Standard mode.
>
> It looks up the order, reads the photo, and calls tools. It asks SAM 3.1 to outline the broken
> item, so the claim carries a marked photo. Plain code reads the carrier's rules and computes the
> claim. The model never writes an amount or a deadline.
>
> Decision: reship the vase, and claim Colissimo, confidence [confidence]. SAM marks the broken
> pieces on the photo, as context, not as a verdict. The maximum compensation is [amount] euros: 23
> euros a kilo, 2.3 kilos, from Colissimo's published terms, with the source and its date shown
> next to it.
>
> It builds the claim PDF and the e-mail to the carrier, and drafts the reply in the customer's
> language. Guardrails in code can only make a decision stricter. Nothing leaves without a click,
> and this app sends nothing: the merchant files the claim.
>
> All six demo cases ran on the real models, and not every case is a claim. A crushed box with the
> product intact: no action. A blurry photo: it asks for another one. A parcel opened at the relay:
> a reply in French, inside the 72 hours. Headphones worth 349 euros: it prepares everything, then
> hands the decision to a human.
>
> *(only if it ran for real)* Some merchants will not send customer photos to a cloud API. The same
> agent, with the same tools and output, runs on open weights: Muse Spark Open, served by Baseten.
> A private run never calls the Meta Model API, so SAM is skipped and the claim carries the raw
> photo.
>
> At the top, the money still recoverable, and the claims about to expire. A broken vase, turned
> into a claim ready to file. Damage Desk.

## Claims checklist (each line of the voice-over, and where the code does it)

| Claim in the voice-over | Where it is true |
|---|---|
| Muse Spark 1.3, Standard mode, Meta Model API | `src/lib/config.ts` (`muse-spark-1.3`, `assertStandardModel`) |
| Reads the photo, calls tools | `src/lib/agent/run-agent.ts`, `tools.ts` (`assess_photos`, `get_order`, ...) |
| Muse Voice Transcribe turns the clip into the message; the case records it was dictated | `src/lib/voice/`, `src/app/api/transcribe/route.ts`, `src/components/voice-recorder.tsx`; verified with real API calls, **not yet with a real microphone in a browser** (checklist item 3) |
| The demo photos are generated with Muse Image | `data/photos/README.md`, `scripts/generate-demo-photo.mjs`, README "About the demo photos" |
| SAM 3.1 outlines the broken item or its pieces (not the damage itself); claim carries the annotated photo | `src/lib/evidence/` (`mark_damage`, and the evidence fallback in `run-agent.ts`); raw photo when SAM fails or is skipped; README "SAM 3.1 segments things, not states" |
| The model never writes an amount or a deadline | `src/lib/rules/carriers.ts` (`computeClaim`), guardrails in `src/lib/agent/guardrails.ts` |
| Confidence `[confidence]`, SAM marks the broken pieces | Read from the case view of the take (the decision card and the annotated photo). No figure is rehearsed. In the recorded run of case 1 the confidence is 0.95 and five shards are outlined; a live take can differ. No run time is quoted, because none is on screen |
| `[amount]` EUR = 23 EUR/kg x 2.3 kg (52.90 for case 1 in the current fixtures and in its recorded run) | `data/carriers.json` (Colissimo, dated source) and `data/fixtures/orders.json` (#1001, 2.3 kg, 58 EUR item) |
| 72 hours Mondial Relay, three days Chronopost | `data/carriers.json` (both marked verified) |
| Claim PDF, carrier e-mail, customer reply in her language | `src/lib/documents/`, `draft_claim_document`, reply language from the report |
| Guardrails in code can only make a decision stricter | `src/lib/agent/guardrails.ts` (`CONFIDENCE_THRESHOLD` 0.7, `HIGH_VALUE_EUR` 300, fraud signals) |
| Nothing leaves without a click; the app sends nothing | `src/components/case-review-panel.tsx` (Approve/Edit/Reject, no sending code) |
| All six demo cases ran on the real models | README "Measured on the real models" (27 Oct 2026); `data/showcase/` |
| Headphones handed to a human above 300 EUR | `HIGH_VALUE_EUR` in `guardrails.ts` |
| Open weights: Muse Spark Open served by Baseten, same agent, no Meta Model API, SAM skipped (**only if it ran for real**) | `src/lib/config.ts` (`resolveEngine`), `src/lib/evidence/mark-damage.ts`, `deploy/README.md`; **not run live as of this writing** |
| Counter: recoverable this month, claims due this week | `src/lib/store/summary.ts`, `src/components/cases-header.tsx` |

## Things the narrator must not say

- "Muse analysed the image" in any take recorded in demo mode.
- That Damage Desk files, sends or submits anything on its own.
- Any amount or percentage that is not on screen (no "recovers X percent", no market figures).
- That Colissimo's figures are current: they come from the 2020 terms, the 2026 terms are not public.
- That the open-weights run was tested, unless it was, and "on our own hardware" for a Baseten run.
- That "private" means nothing leaves the merchant: on Baseten the photos go to Baseten.
- That the demo photos are real photographs: they are generated with Muse Image.
- That the voice report was tested with real customers or accents, or that the recorded run is
  live.
- That the SAM outline marks the damage: it shows what SAM matched (the item, its pieces or the box).
  On the recorded headphones it covers the whole pair, not the cracked shell alone; on the opened
  parcel, the whole carton, not the missing saucers.
- That a recorded run was dictated: the six recorded runs were typed. Only the live run of the
  voice shot was dictated.
- That the app is deployed or that the judges' URL stores cases reliably, unless the Vercel
  deployment and its storage check are done.
