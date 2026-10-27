// The one seam between Gilmend and any shared storage (a bucket, a blob store...).
//
// Why it exists: on Vercel every serverless instance has its own /tmp, so a case written by
// one instance can answer 404 on another (README, "Limitations"). Cases and their files
// (photos, annotated evidence, claim PDFs) therefore need a store that all instances see.
// This interface is deliberately tiny so that a backend is one small file:
//
//   - bytes in, bytes out, keyed by a safe relative path ("cases/case_x.json");
//   - `put` replaces the object atomically: a concurrent `get` returns the old or the new
//     version, never a mix (true for S3-style object stores, to be checked for each backend);
//   - `put` accepts an optional `ifMatch` ETag for a conditional write. A backend that cannot
//     do that leaves `supportsConditionalWrites` false and writes are last-writer-wins;
//   - objects MUST be private: nothing here is meant to be reachable by a public URL. The
//     app serves them through its own routes only (see docs/storage.md, "What is public").
//
// Nothing in this file talks to the network. The Vercel Blob backend is blob-object-store.ts;
// docs/storage.md says how to switch it on.

export interface StoredObject {
  bytes: Buffer;
  contentType: string;
  /** Opaque version tag, when the backend provides one. */
  etag?: string;
}

export interface PutOptions {
  contentType: string;
  /** Write only if the stored object still has this ETag, else throw PreconditionFailedError. */
  ifMatch?: string;
}

export interface ObjectStore {
  /** Human-readable backend name, for logs only ("memory", "blob"...). */
  readonly name: string;
  /** True when `put` honours `ifMatch` and `get` returns an `etag`. */
  readonly supportsConditionalWrites: boolean;
  /** null when the key does not exist. */
  get(key: string): Promise<StoredObject | null>;
  /** Insert or replace. Returns the new ETag when the backend has one. */
  put(key: string, bytes: Buffer, options: PutOptions): Promise<{ etag?: string }>;
  /** Every key that starts with `prefix`, in any order. Follows pagination internally. */
  list(prefix: string): Promise<string[]>;
  /** Remove an object. Resolves quietly when the key does not exist. */
  delete(key: string): Promise<void>;
}

/** A conditional `put` found a different ETag: someone else wrote in between. */
export class PreconditionFailedError extends Error {
  constructor(key: string) {
    super(`Object "${key}" changed since it was read`);
    this.name = "PreconditionFailedError";
  }
}

// Keys end up in a backend's namespace and in logs: a plain slash-separated path, no ".."
// segment, no empty or dot-leading segment, no characters that need escaping.
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const MAX_KEY_LENGTH = 200;

export function isSafeObjectKey(key: string): boolean {
  return key.length <= MAX_KEY_LENGTH && KEY_PATTERN.test(key);
}

/** Throws unless `key` is safe. Every backend call goes through this first. */
export function assertSafeObjectKey(key: string): string {
  if (!isSafeObjectKey(key)) throw new Error(`Unsafe object key "${key.slice(0, 60)}"`);
  return key;
}
