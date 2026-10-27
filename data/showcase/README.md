# Showcase: six recorded real runs

These six cases are **real runs of Muse Spark 1.3 and SAM 3.1** on the Meta Model API,
recorded on **27 Oct 2026** (`npm run real`, standard mode, no Contributor model) and committed
with the code. They are why a fresh deployment, or a fresh clone, is not an empty inbox: the app
lists them next to the cases you file yourself, marked **Recorded run**.

Which run each case is:

- Cases 3 to 6: the second recording of the afternoon (16:02 to 16:04 UTC), made after SAM was
  changed to ask several concepts and merge the regions.
- Cases 1 and 2: **re-run once each at 16:21 and 16:22 UTC** and replaced, after two changes of the
  agent code that the afternoon runs had shown to be needed. Case 1: a packaging reading of
  "inadequate" used to cancel the claim (the 16:01 recording had no claim for that reason); it now
  keeps the claim and warns the merchant. Case 2: Muse had skipped `mark_damage` and the case had no
  outline; the code now asks SAM once. Neither re-run was repeated to look better: the first
  re-run of each is what is committed. Case 1 gave the claim again, with the packaging read as
  adequate, so the new packaging rule is covered by tests, **not by a recorded run**. In case 2 the
  trace says the code, not Muse, asked SAM for the outline.

| Case | What Muse decided in the recorded run |
|---|---|
| `real_demo-1-vase-broken` | Reship, claim Colissimo, 52.90 EUR maximum (confidence 0.95, not handed to a human). The same case was read four times that day: packaging adequate with the claim at 15:05 and 16:21, packaging inadequate at 16:01 and 16:06 (no claim under the rule of the time) |
| `real_demo-2-carton-crushed` | No action, no claim (confidence 0.95) |
| `real_demo-3-photo-blurry` | Ask for sharper photos (confidence 0.90, not handed to a human; the 15:07 run gave 0.35 and handed it to a human) |
| `real_demo-4-opened-missing` | Reship, claim Mondial Relay (25 EUR maximum), reply in French (confidence 0.92) |
| `real_demo-5-expensive-escalation` | Reship and claim Chronopost (250 EUR maximum), handed to a human (349 EUR order, confidence 0.85) |
| `real_demo-6-late-report` | Refund, no claim (the 3-day window had passed, confidence 0.85) |

What the SAM outlines are (viewed on 27 Oct 2026): **what SAM matched, not the damage.** Case 1:
five loose shards ("broken pottery"). Case 2: the whole carton. Case 4: the open box, its empty
insert tray and three scraps of cardboard, not the missing saucers. Case 5: the two ear cushions,
not the cracked shell. Case 6: the whole carafe, the crack lies inside the outline. Case 3 has no
outline (blurry photo). The recordings of cases 3 to 6 were made before the wording was fixed, so
the notes of cases 4 to 6 say "marks where the damage appears to be" and the PDFs of cases 4 and 5
caption the photo "damaged area outlined (SAM 3.1)". Read them as "outlined by SAM 3.1": they are
left as recorded, because nothing here is edited by hand. Case 1 and 2 carry the corrected text.

What is in here, and how the app treats it:

- `cases/*.json`: the case exactly as the agent produced it, plus `recorded: { recordedOn }`
  and the file paths rewritten to `data/showcase/...`. Nothing was edited by hand. Re-runs are
  listed above (cases 1 and 2); the carafe had also been run twice earlier that day, the first time
  with a garbled SAM concept because of a bug fixed right after, and both gave the same decision.
- `photos/`: the photos Muse was shown. They were **generated with Meta's Muse Image**
  (`muse-image-1.0`, see `data/photos/README.md`), not photographs taken by the team; the copy here is pinned so the
  recording keeps showing what Muse actually saw even after the team's own photos replace
  the stand-ins.
- `evidence/`: the photos annotated by SAM 3.1. `claims/`: the claim PDFs. The annotated JPEGs do
  **not** carry the XMP `DigitalSourceType = trainedAlgorithmicMedia` tag that the generated photos
  in `photos/` have (the annotation is a re-encode that drops the metadata), yet they derive from
  those generated photos and are AI-generated images too: say so wherever one is shown.
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

To record in a folder outside the project (so `data/runtime/` stays empty and does not shadow the
showcase locally), set `DAMAGE_DESK_RUNTIME_DIR=<folder>` for `npm run real` and pass the same folder
to `--from`: the build reads the absolute paths that such a run stores. Keep the cases you do not
re-run in that folder: the build replaces the whole showcase with what the folder holds.
