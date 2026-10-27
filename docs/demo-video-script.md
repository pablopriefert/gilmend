# Demo video script (3 minutes, voice-over in English)

Story: **a broken vase becomes recovered money.** One case told in full, the others in a
montage, then the open-weights switch, ending on the recoverable counter.

Target length: 3:00 (about 430 spoken words at a calm pace). Subtitles on.

## Before recording: what must be true

The voice-over only claims what the code does. Check these before pressing record, and change the
lines that no longer hold.

1. **Real mode or demo mode, say which.** The script below is written for a recording made with a
   real `MODEL_API_KEY` (plain `npm run dev`, engine "Muse Spark 1.3"). No call to the real Meta
   APIs had been made when this script was written, so confirm that a real run works end to end
   first. If the video is recorded in demo mode (`npm run dev:demo`), the "DEMO MODE" badge stays
   on screen, shots 2 and 3 use the alternative lines marked **[DEMO MODE]**, and the narrator must
   never say that Muse read the photo.
2. **Photos.** `data/photos/` currently holds provisional AI-generated stand-ins. Shoot the six real
   photos (`data/photos/README.md`) and use them. Never present a stand-in as a photo taken by the
   team.
3. **Open-weights shot (shot 7) only if it ran for real.** It needs the Glimmer server deployed on
   Modal (`deploy/README.md`, never run so far) and the `OPEN_WEIGHTS_*` variables set. If it did
   not run, cut shot 7 and say nothing about open weights beyond what is true. Do not film the
   demo-mode fallback and call it open weights.
4. **The counter.** Read the number on screen; do not rehearse a figure. With the six demo cases
   stored, the code computes 327.90 EUR across three claims (52.90 + 25.00 + 250.00) and the number
   of claims due this week depends on the clock, because the demo reports are timed relative to
   "now". Re-run `npm run demo` shortly before filming so the deadlines are fresh.
5. Fictitious customers and orders only. No real tracking labels, addresses or people in any photo.

## Shot list

| Time | On screen | Voice-over |
|---|---|---|
| 0:00 – 0:12 | **New report** screen, the "Broken vase" scenario loaded: the customer's message ("my vase arrived broken"), order #1001, one photo. | "A customer writes: my vase arrived broken. For a small shop, that is two jobs: make the customer whole, then chase the carrier for the money." |
| 0:12 – 0:28 | Cut to the **carrier rules** card of a case, then the three carrier names. Highlight "72 hours" (Mondial Relay), "3 days" (Chronopost) and "12 months" (Colissimo). | "Every carrier has its own proof, its own cap, and its own deadline. Mondial Relay gives you 72 hours. Chronopost, three days. Miss it, and the claim is lost." |
| 0:28 – 0:40 | Back on the form. Engine selector: **Muse Spark 1.3 (Model API)** selected. Click submit. | "This is Damage Desk. It runs on Muse Spark 1.3 through the Meta Model API, Standard mode. One click." |
| 0:40 – 1:10 | Open **Agent reasoning trace** and scroll through the steps: order lookup, photo reading, damage marking, carrier rules, claim computation, decision. | "Muse Spark looks up the order, reads the photo, then calls tools. It asks SAM 3.1 to outline the broken area so the claim has proof. It fetches the carrier's rules, then asks plain code to compute the claim. The model never writes an amount or a deadline. Code does." |
| 1:10 | **[DEMO MODE]** variant of the line above | "In demo mode a scripted mock plays the same steps. It does not look at the image, and the screen says so." |
| 1:10 – 1:35 | **Case view**: "What the agent saw", the **annotated photo** (SAM outline) next to the raw one, then **Decision**: reship, carrier claim yes, confidence, reasons. Zoom on the maximum compensation, 52.90 EUR, and the deadline. | "Decision: reship the vase, and claim the carrier. The outline on the photo is the evidence. The maximum compensation is 52.90 euros: 23 euros a kilo, 2.3 kilos, from Colissimo's published terms, with the source and its date shown next to it." |
| 1:35 – 2:00 | **Claim document**: the PDF preview, then the e-mail to the carrier's claims department, then the drafted reply to the customer. End on the **Approve** button; click it. The banner reads "Approved: ready to send. Damage Desk sends nothing by itself." | "It builds the claim: tracking number, weight, value, annotated photos, the basis for the compensation, the deadline. It drafts the e-mail to the carrier and the reply to the customer, in her language. Nothing leaves without a click, and this app sends nothing: the merchant files the claim." |
| 2:00 – 2:22 | **Cases** list, then quick cuts on four cases: crushed carton (no action), blurry photo (asks for another one), Mondial Relay case with the French reply, headphones (handed to a human). | "Not every case is a claim. A crushed box with the product intact: no action. A blurry photo: it asks for another one. A parcel opened at the relay: a reply in French, inside the 72 hours. Headphones worth 349 euros: it prepares everything, then hands the decision to a human." |
| 2:22 – 2:45 | **New report** again, same broken-vase scenario. Select **Run privately (open weights)**. The line below the selector shows the engine. Submit; the case opens with the badge "Open weights (private run)". | "Some merchants cannot send customer photos to a cloud API. So the same agent, with the same tools and the same output, runs on open weights, on Muse Glimmer served on our own Modal endpoint. In a private run nothing goes to the Model API. SAM is skipped, so the claim carries the raw photo." |
| 2:45 – 3:00 | **Cases** header, full width: the counter "€… recoverable this month · … claims due this week". Hold on it, then the title card: "Damage Desk. Built during the Meta Global AI Developer Hackathon." | "And this is what the merchant sees at the top: the money still recoverable, and the claims about to expire. A broken vase, turned into a claim that gets filed. Damage Desk." |

## Spoken text, in one piece (for the recording take)

> A customer writes: my vase arrived broken. For a small shop, that is two jobs: make the customer
> whole, then chase the carrier for the money.
>
> Every carrier has its own proof, its own cap, and its own deadline. Mondial Relay gives you 72
> hours. Chronopost, three days. Miss it, and the claim is lost.
>
> This is Damage Desk. It runs on Muse Spark 1.3 through the Meta Model API, Standard mode. One
> click.
>
> Muse Spark looks up the order, reads the photo, then calls tools. It asks SAM 3.1 to outline the
> broken area so the claim has proof. It fetches the carrier's rules, then asks plain code to
> compute the claim. The model never writes an amount or a deadline. Code does.
>
> Decision: reship the vase, and claim the carrier. The outline on the photo is the evidence. The
> maximum compensation is 52.90 euros: 23 euros a kilo, 2.3 kilos, from Colissimo's published
> terms, with the source and its date shown next to it.
>
> It builds the claim: tracking number, weight, value, annotated photos, the basis for the
> compensation, the deadline. It drafts the e-mail to the carrier and the reply to the customer, in
> her language. Nothing leaves without a click, and this app sends nothing: the merchant files the
> claim.
>
> Not every case is a claim. A crushed box with the product intact: no action. A blurry photo: it
> asks for another one. A parcel opened at the relay: a reply in French, inside the 72 hours.
> Headphones worth 349 euros: it prepares everything, then hands the decision to a human.
>
> Some merchants cannot send customer photos to a cloud API. So the same agent, with the same tools
> and the same output, runs on open weights, on Muse Glimmer served on our own Modal endpoint. In a
> private run nothing goes to the Model API. SAM is skipped, so the claim carries the raw photo.
>
> And this is what the merchant sees at the top: the money still recoverable, and the claims about
> to expire. A broken vase, turned into a claim that gets filed. Damage Desk.

## Claims checklist (each line of the voice-over, and where the code does it)

| Claim in the voice-over | Where it is true |
|---|---|
| Muse Spark 1.3, Standard mode, Meta Model API | `src/lib/config.ts` (`muse-spark-1.3`, `assertStandardModel`) |
| Reads the photo, calls tools | `src/lib/agent/run-agent.ts`, `tools.ts` (`assess_photos`, `get_order`, ...) |
| SAM 3.1 outlines the damage; claim carries the annotated photo | `src/lib/evidence/` (`mark_damage`); raw photo when SAM fails or is skipped |
| The model never writes an amount or a deadline | `src/lib/rules/carriers.ts` (`computeClaim`), guardrails in `src/lib/agent/guardrails.ts` |
| 52.90 EUR = 23 EUR/kg x 2.3 kg | `data/carriers.json` (Colissimo, dated source) and `data/fixtures/orders.json` (#1001, 2.3 kg, 58 EUR item) |
| 72 hours Mondial Relay, three days Chronopost | `data/carriers.json` (both marked verified) |
| Claim PDF, carrier e-mail, customer reply in her language | `src/lib/documents/`, `draft_claim_document`, reply language from the report |
| Nothing leaves without a click; the app sends nothing | `src/components/case-review-panel.tsx` (Approve/Edit/Reject, no sending code) |
| Headphones handed to a human above 300 EUR | `HIGH_VALUE_EUR` in `guardrails.ts` |
| "Run privately": same agent on open weights, no Model API, SAM skipped | `src/lib/config.ts` (`resolveEngine`), `src/lib/evidence/mark-damage.ts`, `deploy/` |
| Counter: recoverable this month, claims due this week | `src/lib/store/summary.ts`, `src/components/cases-header.tsx` |

## Things the narrator must not say

- "Muse analysed the image" in any take recorded in demo mode.
- That Damage Desk files, sends or submits anything on its own.
- Any amount or percentage that is not on screen (no "recovers X percent", no market figures).
- That Colissimo's figures are current: they come from the 2020 terms, the 2026 terms are not public.
- That the open-weights run was tested, unless it was.
- That the demo photos are real photographs, while they are the stand-ins.
