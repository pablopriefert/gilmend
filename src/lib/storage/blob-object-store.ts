import { BlobNotFoundError, BlobPreconditionFailedError, del, get, list, put } from "@vercel/blob";
import { assertSafeObjectKey, PreconditionFailedError, type ObjectStore } from "./object-store";

// Vercel Blob backend (DAMAGE_DESK_STORAGE=blob). The store MUST be created private: case files
// hold what visitors typed, and a public blob URL would make them readable without the app
// (docs/storage.md, "What is public"). Credentials come from the environment the SDK reads:
// BLOB_READ_WRITE_TOKEN, or BLOB_STORE_ID with the OIDC token Vercel injects.
// Pinned to @vercel/blob 2.8.1 (6 Oct 2026, the 14-day dependency rule); the shapes below
// follow its type definitions.

/** The SDK calls this adapter uses, injectable so tests never touch the network. */
export interface BlobSdk {
  get: typeof get;
  put: typeof put;
  list: typeof list;
  del: typeof del;
}

export function createBlobObjectStore(sdk: BlobSdk = { get, put, list, del }): ObjectStore {
  return {
    name: "blob",
    supportsConditionalWrites: true,
    async get(key) {
      // useCache false: read the latest write from origin, not a CDN copy that can lag up to
      // 60 s behind an overwrite (an approved case would look unapproved on reload).
      const result = await sdk.get(assertSafeObjectKey(key), { access: "private", useCache: false });
      if (!result || result.statusCode !== 200) return null;
      return {
        bytes: Buffer.from(await new Response(result.stream).arrayBuffer()),
        contentType: result.blob.contentType,
        etag: result.blob.etag,
      };
    },
    async put(key, bytes, { contentType, ifMatch }) {
      try {
        const blob = await sdk.put(assertSafeObjectKey(key), bytes, {
          access: "private",
          allowOverwrite: true,
          // Keys are already unique (case id, content hash): a random suffix would make the
          // object unreachable by the key the app stored.
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
        const page = await sdk.list({ prefix, cursor, limit: 1000 });
        keys.push(...page.blobs.map((blob) => blob.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return keys;
    },
    async delete(key) {
      try {
        await sdk.del(assertSafeObjectKey(key));
      } catch (error) {
        if (error instanceof BlobNotFoundError) return;
        throw error;
      }
    },
  };
}
