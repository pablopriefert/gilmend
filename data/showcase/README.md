# Showcase: six recorded real runs

These six cases are **real runs of Muse Spark 1.3 and SAM 3.1** on the Meta Model API,
recorded once on **27 Oct 2026** (`npm run real`, standard mode, no Contributor model) and
committed with the code. They are why a fresh deployment, or a fresh clone, is not an empty
inbox: the app lists them next to the cases you file yourself, marked **Recorded run**.

| Case | What Muse decided |
|---|---|
| `real_demo-1-vase-broken` | Reship, claim Colissimo (52.90 EUR maximum), confidence 0.95 |
| `real_demo-2-carton-crushed` | No action, no claim |
| `real_demo-3-photo-blurry` | Ask for sharper photos, handed to a human (confidence 0.35) |
| `real_demo-4-opened-missing` | Reship, claim Mondial Relay (25 EUR maximum) |
| `real_demo-5-expensive-escalation` | Reship and claim Chronopost, handed to a human (349 EUR order) |
| `real_demo-6-late-report` | Refund, no claim (the 3-day window had passed) |

What is in here, and how the app treats it:

- `cases/*.json`: the case exactly as the agent produced it, plus `recorded: { recordedOn }`
  and the file paths rewritten to `data/showcase/...`. Nothing was edited by hand and nothing
  was re-run to make them look better.
- `photos/`: the photos Muse was shown. They were **generated with Meta's Muse Image**
  (`muse-image-1.0`, see `data/photos/README.md`), not photographs taken by the team; the copy here is pinned so the
  recording keeps showing what Muse actually saw even after the team's own photos replace
  the stand-ins.
- `evidence/`: the photos annotated by SAM 3.1. `claims/`: the claim PDFs.
- **Read-only.** Nothing in the app writes here. Approving, editing or rejecting a recorded
  case stores a *copy* in the normal store (`src/lib/store/layered-store.ts`), and that copy
  shadows the recording; the committed files never change.
- Amounts and deadlines are those of the day of the run (the page shows deadlines "as of the
  recording"); the "recoverable this month" counter ignores recorded runs (the header shows their own figure on a second line, "Recorded
  runs: ... recoverable (as of <recording day>)", computed from the recordings).
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
