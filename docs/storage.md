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
2. **A storage seam** for the cases people file themselves: `ObjectStore`
   (`src/lib/storage/object-store.ts`). With nothing configured the app runs exactly as before, on
   local files. A shared backend is one adapter.

## What ships

| Piece | File | Role |
|---|---|---|
| `ObjectStore` | `src/lib/storage/object-store.ts` | Bytes in, bytes out, safe keys, optional conditional write |
| Selection by environment | `src/lib/storage/index.ts` | `DAMAGE_DESK_STORAGE` unset or `file`: local files. Any other value: an error, never a silent fallback |
| Cases on an object store | `src/lib/store/object-case-store.ts` | One JSON object per case under `cases/` |
| Files on an object store | `src/lib/storage/runtime-files.ts` | Local disk stays the working copy; each file is copied out after it is written and copied back when another instance asks for it |
| Showcase under any store | `src/lib/store/layered-store.ts` | Recorded runs are listed with the stored cases; the first change to one stores a copy |
| In-memory test backend | `src/lib/storage/faux-object-store.ts` | Behaves like a bucket (atomic replace, ETags, conditional writes) |

`src/app/api/shared-storage.test.ts` runs the real routes against that fake: a report filed on one
instance, then the case, its photo and its claim PDF opened on a second instance with an empty disk.

## Why no vendor backend ships yet (Vercel Blob)

The plan was Vercel Blob through its REST API with `fetch`, no dependency. Checked on 27 Oct 2026:

| Operation | Documented as plain HTTP? | Source |
|---|---|---|
| Read a private blob | **Yes**: `GET https://<store-id>.private.blob.vercel-storage.com/<pathname>` with `Authorization: Bearer <token>` | https://vercel.com/docs/vercel-blob/private-storage ("Accessing without the SDK") |
| Write, overwrite, conditional write | **No.** Only through the SDK (`put`) or a presigned URL, and a presigned URL is made by `issueSignedToken` + `presignUrl` | https://vercel.com/docs/vercel-blob/using-blob-sdk, https://vercel.com/docs/vercel-blob/vercel-signed-urls |
| List by prefix | **No.** Only `list()` in the SDK | https://vercel.com/docs/vercel-blob/using-blob-sdk |

The wire protocol can be read in the SDK source: `PUT https://vercel.com/api/blob/?pathname=...` with
`x-api-version: 13`, `x-vercel-blob-store-id`, `x-vercel-blob-access`, `x-allow-overwrite`, `x-if-match`
headers, the store id parsed out of the token (`https://raw.githubusercontent.com/vercel/storage/main/packages/blob/src/api.ts`,
`.../helpers.ts`, `.../put-helpers.ts`, `.../put.ts`, all under `packages/blob/src/`). `helpers.ts` calls its raw commands "not meant to be used
directly", and `api.ts` says `x-api-version` lets the server change its behaviour, such as the response format. Calling it
from `fetch` would mean copying an internal, versioned protocol that the docs do not promise, against a
service we cannot try without creating a store. A wrong guess would break every request of the demo
the judges open, so the adapter is not written against it.

What would be safe, and what it needs: the official SDK `@vercel/blob` (documented, private storage
needs version 2.3 or later). That is **a new dependency**, so it is left as a decision for the
project owner (versions are pinned exactly in `package.json`; see the 14-day rule in `next.config.ts`).
Once it is installed:

1. Create the store **private** (the access mode cannot be changed afterwards):
   `vercel blob create-store damage-desk --access private --yes` from the linked project. Vercel then
   adds `BLOB_STORE_ID` and an OIDC token to the project; `BLOB_READ_WRITE_TOKEN` is only for code
   running outside Vercel.
2. Add `src/lib/storage/blob-object-store.ts`:

   ```ts
   import { BlobPreconditionFailedError, get, list, put } from "@vercel/blob";
   import { assertSafeObjectKey, PreconditionFailedError, type ObjectStore } from "./object-store";

   export function createBlobObjectStore(): ObjectStore {
     return {
       name: "blob",
       supportsConditionalWrites: true,
       async get(key) {
         // useCache:false = read the latest write, not the CDN copy (up to 60 s stale after an overwrite).
         const result = await get(assertSafeObjectKey(key), { access: "private", useCache: false });
         if (!result || result.statusCode !== 200) return null;
         return {
           bytes: Buffer.from(await new Response(result.stream).arrayBuffer()),
           contentType: result.blob.contentType,
           etag: result.blob.etag,
         };
       },
       async put(key, bytes, { contentType, ifMatch }) {
         try {
           const blob = await put(assertSafeObjectKey(key), bytes, {
             access: "private",
             allowOverwrite: true,
             addRandomSuffix: false,
             contentType,
             ...(ifMatch ? { ifMatch } : {}),
           });
           return { etag: blob.etag };
         } catch (error) {
           if (error instanceof BlobPreconditionFailedError) throw new PreconditionFailedError(key);
           throw error;
         }
       },
       async list(prefix) {
         const keys: string[] = [];
         let cursor: string | undefined;
         do {
           const page = await list({ prefix, cursor, limit: 1000 });
           keys.push(...page.blobs.map((blob) => blob.pathname));
           cursor = page.hasMore ? page.cursor : undefined;
         } while (cursor);
         return keys;
       },
     };
   }
   ```

   This snippet follows the SDK reference and has **not been run** against a real store. Check the
   return shapes of `get` and `list` against https://vercel.com/docs/vercel-blob/using-blob-sdk first.
3. In `src/lib/storage/index.ts` add `case "blob": return (blobStore ??= createBlobObjectStore());`
   (and a module-level `let blobStore`), then set `DAMAGE_DESK_STORAGE=blob` in Vercel.
4. Run the two-instance test against the real store once before relying on it.

## Guarantees, per backend

| | Local files (default) | Shared object store |
|---|---|---|
| Ids | `isSafeCaseId` before a path is built | `isSafeCaseId`, then `isSafeObjectKey` before a key is built (no `..`, no empty or dot-leading segment, 200 characters at most) |
| A write | temp file in the same folder, then `rename`: readers see the old or the new case | one `put`: the object is replaced atomically (a property each backend must have; true of S3-style stores) |
| Two writers, same case | last writer wins | last writer wins on `save`; on `update` see below |
| `update` inside one instance | per-case in-process lock | the same lock |
| `update` across instances | not applicable (one disk) | **no shared lock.** With conditional writes the `put` carries the ETag that was read; a conflict re-reads and re-applies the patch (5 attempts, then an error). Without them it is last-writer-wins |
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
  code when `DAMAGE_DESK_ACCESS_CODE` is set; so does a real (paid) run.
- **The store itself must be private.** Objects are only reachable through the app's own routes, which
  serve images and PDFs by path (`/api/files`, `/api/cases/[id]/pdf`). A public blob URL would make every
  case readable without going through the app, and its listing could be crawled. Use a private store.
- The showcase is committed to the public repository: only invented orders and `example.*` addresses
  (`src/lib/showcase/audit.ts` checks it on every test run).
