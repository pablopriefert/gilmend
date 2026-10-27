# Showcase: six recorded real runs

These six cases are **real runs of Muse Spark 1.3 and SAM 3.1** on the Meta Model API,
recorded on **27 Oct 2026** (`npm run real`, standard mode, no Contributor model; the second
recording of the day, after SAM was changed to ask several concepts and merge the regions) and
committed with the code. They are why a fresh deployment, or a fresh clone, is not an empty
inbox: the app lists them next to the cases you file yourself, marked **Recorded run**.

| Case | What Muse decided |
|---|---|
| `real_demo-1-vase-broken` | Reship, **no carrier claim**: Muse read the box as inadequate packaging, so Colissimo excludes compensation (confidence 0.92). Not the expected claim of 52.90 EUR: the same case gave a claim in an earlier run, so this call is not stable |
| `real_demo-2-carton-crushed` | No action, no claim |
| `real_demo-3-photo-blurry` | Ask for sharper photos (confidence 0.90, not handed to a human) |
| `real_demo-4-opened-missing` | Reship, claim Mondial Relay (25 EUR maximum) |
| `real_demo-5-expensive-escalation` | Reship and claim Chronopost, handed to a human (349 EUR order) |
| `real_demo-6-late-report` | Refund, no claim (the 3-day window had passed) |

What is in here, and how the app treats it:

- `cases/*.json`: the case exactly as the agent produced it, plus `recorded: { recordedOn }`
  and the file paths rewritten to `data/showcase/...`. Nothing was edited by hand and nothing
  was re-run to make them look better (one case was run twice: the first run of the carafe asked SAM a
  garbled concept because of a bug fixed right after, so it was redone with the fixed code; both
  runs gave the same decision).
- `photos/`: the photos Muse was shown. They were **generated with Meta's Muse Image**
  (`muse-image-1.0`, see `data/photos/README.md`), not photographs taken by the team; the copy here is pinned so the
  recording keeps showing what Muse actually saw even after the team's own photos replace
  the stand-ins.
- `evidence/`: the photos annotated by SAM 3.1. `claims/`: the claim PDFs.
- **Read-only.** Nothing in the app writes here. Approving, editing or rejecting a recorded
  case stores a *copy* in the normal store (`src/lib/store/layered-store.ts`), and that copy
  shadows the recording; the committed files never change.
- Amounts and deadlines are those of the day of the run (the page shows deadlines "as of the
  recording"); the "recoverable this month" counter ignores recorded runs.
- Everything is **fictitious**: the orders are the invented ones of `data/fixtures/orders.json`,
  the e-mail addresses are `example.com/.org/.net` (and the demo merchant's `.example`).
  `src/lib/showcase/audit.ts` refuses a case or PDF holding anything else, a key-like string,
  or a path from a developer's machine, and a test runs it on this folder on every
  `npx vitest run`.

Rebuild it from new runs (does not call any model):

```bash
npm run real -- demo-1-vase-broken        # one real run per case, paid; see scripts/run-real.ts
npm run showcase:build -- --from data/runtime
```
