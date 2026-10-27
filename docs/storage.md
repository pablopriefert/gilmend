# Storage: where cases and files live, and what a shared store needs

Written 27 Oct 2026 for the public Vercel deployment.

## The problem

Every Vercel serverless instance has its own `/tmp`. The app used to keep cases and their files
(photos, annotated evidence, claim PDFs) in the runtime folder, which on Vercel is `/tmp/damage-desk`
(`src/lib/runtime-dir.ts`). A case filed on one instance can therefore answer 404 on another.
Two things address it:

1. **The showcase** (`data/showcase/`, committed): six real Muse Spark 1.3 + SAM 3.1 runs recorded
   on 27 Oct 2026, always present on every instance. This is what a judge sees first, and it never
   depends on temporary storage. See `data/showcase/README.md`.
2. **A shared store** for the cases people file themselves: `ObjectStore`
   (`src/lib/storage/object-store.ts`). With nothing configured the app runs exactly as before, on
   local files. A shared backend is one adapter.

## What ships

| Piece | File | Role |
|---|---|---|
| `ObjectStore` | `src/lib/storage/object-store.ts` | Bytes in, bytes out, safe keys, optional conditional write |
| Selection by environment | `src/lib/storage/index.ts` | `DAMAGE_DESK_STORAGE` unset or `file`: local files; `blob`: Vercel Blob. Any other value: an error, never a silent fallback |
| Cases on an object store | `src/lib/store/object-case-store.ts` | One JSON object per case under `cases/` |
| Files on an object store | `src/lib/storage/runtime-files.ts` | Local disk stays the working copy; each file is copied out after it is written and copied back when another instance asks for it |
| Showcase under any store | `src/lib/store/layered-store.ts` | Recorded runs are listed with the stored cases; the first change to one stores a copy |
| In-memory test backend | `src/lib/storage/faux-object-store.ts` | Behaves like a bucket (atomic replace, ETags, conditional writes) |

`src/app/api/shared-storage.test.ts` runs the real routes against that fake: a report filed on one
instance, then the case, its photo and its claim PDF opened on a second instance with an empty disk.

## Vercel Blob (`DAMAGE_DESK_STORAGE=blob`)

**On a public deployment that accepts reports, Blob is required, not optional.** Without it a case lives
on one serverless instance, and `GET /api/cases/[id]/pdf` rebuilds a claim PDF that is not found where the
request lands. Rebuilding needs the access code (`requireAccessCode`), and the `<iframe>` on the case page
cannot send a header, so the preview fails with a 401 for the very person who filed the case. With Blob the
PDF is copied out when it is written and copied back when another instance asks for it, so it is never
rebuilt. Only a deployment that shows the six recorded runs and takes no new report can run on the default.

`src/lib/storage/blob-object-store.ts` implements the store with the official SDK, `@vercel/blob`
pinned to 2.8.1 (published 6 Oct 2026, so it passes the 14-day dependency rule; installed with
`--before=2026-10-13` so its own dependencies do too). The raw REST protocol was not used: Vercel
documents writes and listing only through the SDK (https://vercel.com/docs/vercel-blob/using-blob-sdk),
and the SDK source calls its raw commands internal.

To switch it on for the deployment:

1. Create the store **private** (the access mode cannot be changed afterwards), from the linked
   project: `vercel blob create-store damage-desk --access private --yes`. Vercel adds
   `BLOB_STORE_ID` and an OIDC token to the project; `BLOB_READ_WRITE_TOKEN` is only needed for
   code running outside Vercel.
2. Set `DAMAGE_DESK_STORAGE=blob` in the Vercel project.
3. Before relying on it, file one report on the deployed URL and open its case, photo and PDF from
   a second browser (a different instance may answer): the adapter is tested against a fake SDK
   only (`blob-object-store.test.ts`) and has **not run against a real store yet**.

## Guarantees, per backend

| | Local files (default) | Shared object store |
|---|---|---|
| Ids | `isSafeCaseId` before a path is built | `isSafeCaseId`, then `isSafeObjectKey` before a key is built (no `..`, no empty or dot-leading segment, 200 characters at most) |
| A write | temp file in the same folder, then `rename`: readers see the old or the new case | one `put`: the object is replaced atomically (a property each backend must have; true of S3-style stores) |
| Two writers, same case | last writer wins | last writer wins on `save`; on `update` see below |
| `update` inside one instance | per-case in-process lock | the same lock |
| `update` across instances | not applicable (one disk) | **no shared lock.** With conditional writes the `put` carries the ETag that was read; a conflict re-reads and re-applies the patch (5 attempts, then an error). A backend that declares conditional writes but returns no ETag makes `update` throw (a wrong adapter shape fails on its first use). Without conditional writes it is last-writer-wins |
| Trace lines of a human action | `update(id, patch, { appendTrace })` appends them to the trace read under the lock, so two concurrent PATCHes keep both lines | the same, re-read on a retry |
| Listing | `readdir`, skips unreadable files | one `list` plus one `get` per case, skips unreadable objects. Fine for dozens of cases |
| Files (photos, PDFs) | written once under a name that cannot clash (upload id, content hash, case id) | the same, copied out after writing. A failed copy-out is reported (the upload answers 500, the evidence note says the call failed), not ignored |

The showcase is read-only in both: the first approve, edit or reject on a recorded run stores a copy
in the active store, and that copy is the case from then on. With no shared store that copy lives on
one instance only.

## What is public

The deployed app has no accounts. Everything the pages show is readable by anyone with the URL:

- **Public:** the case list, every case page (customer name and e-mail as typed or as found in the
  fictitious orders, message, reply draft, trace), the photos, the annotated evidence, the claim PDFs,
  the carrier rules. `GET /api/cases` returns all of it as JSON. Whatever a visitor types in the report
  form is visible to every other visitor: **never type real customer data on the public URL** (the form
  says so).
- **Not public:** the Meta key, the access code, the storage token, `.env.local`. They are only read on
  the server and never sent to the browser. Approving, editing or rejecting a case needs the access
  code when `DAMAGE_DESK_ACCESS_CODE` is set; so does every new report (demo mode included, so that a
  stranger cannot put text and photos on the page the judges look at) and every dictation. Wrong codes
  are counted per client (10 per 10 minutes, then 429). The client is the first hop of `x-forwarded-for`:
  **Vercel only**, because the platform sets that header itself; on any other host a client can forge it
  and the count (like the other per-client limits) protects nothing. The six recorded runs stay readable
  by anyone.
- **Not capped:** the number of cases stored by people who have the code. Each client is limited to 30
  reports per 10 minutes and real runs to `DAMAGE_DESK_REAL_RUNS_PER_DAY`, but nothing deletes or hides
  old cases: after a public round, empty the Blob store by hand.
- **The store itself must be private.** Objects are only reachable through the app's own routes, which
  serve images and PDFs by path (`/api/files`, `/api/cases/[id]/pdf`). A public blob URL would make every
  case readable without going through the app, and its listing could be crawled. Use a private store.
- The showcase is committed to the public repository: only invented orders and `example.*` addresses
  (`src/lib/showcase/audit.ts` checks it on every test run).
