# Demo assets

Captured on 28 Oct 2026 at 1440x900 (the GIF at 960 px wide). Where each one comes from matters, so it is written here
and must stay on any caption that reuses it.

| File | Source | Label to keep |
|---|---|---|
| `screens/cases.png`, `screens/cases-list.png` | Deployed site https://gilmend.vercel.app (commit 71d8cf2), public pages | Includes recorded runs and a few live test cases |
| `screens/case-decision-and-sam.png` | Deployed site, `real_demo-1-vase-broken` | Recorded run of 27 Oct 2026 (real Muse Spark 1.3 + SAM 3.1) |
| `screens/case-round-2-blurry-lamp.png` | Deployed site, `real_demo-3-photo-blurry-followup-910ee059` | Real run of 28 Oct 2026; the customer reply is **simulated** (demo button, photo generated with Muse Image) |
| `screens/case-integrity-signal.png` | Deployed site, a case filed on 28 Oct 2026 with a demo photo for another order | Real run; a signal is a reason to look, not a verdict |
| `screens/impact.png` | Deployed site, `/impact` with its default example values | Example values, not statistics |
| `screens/eval.png` | Deployed site, `/eval` | Committed run of 27 Oct 2026 (commit 0eab783), 6 cases x 3 runs: a sanity check, not a benchmark; the page warns the deployed commit differs |
| `screens/live-run-demo-mode.png`, `live-run.gif` | **Local server in DEMO MODE** (the worktree's code, no model key, no access code), the "Broken vase" scenario | **DEMO MODE (scripted): not Muse, no SAM, no timings.** The live timeline is real code; the model's steps are a script. Not the production site: filing a report there needs the access code |
| `social-card.png` | Rendered from `src/app/opengraph-image.tsx` | The same picture as the `og:image` and `twitter:image` of the site |

The cases shown are fictitious (orders, customers, e-mails). No access code or key appears in any file. The
screens are plain captures: they are not edited, only quantised to keep each PNG under 400 KB.

Redo them with a browser driven at 1440x900 against the deployed site; the live-run GIF needs a local server
started with `npm run dev:demo` (or a real run with the access code, off camera).
