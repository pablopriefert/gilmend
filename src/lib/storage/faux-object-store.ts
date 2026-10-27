import { createHash } from "node:crypto";
import {
  PreconditionFailedError,
  assertSafeObjectKey,
  type ObjectStore,
  type PutOptions,
  type StoredObject,
} from "./object-store";

// Test helper only: an in-memory ObjectStore that behaves like an S3-style bucket (atomic
// replace, ETags, conditional writes). Imported by tests, never by the app. Two "serverless
// instances" in a test share one of these and keep their own runtime folders.

export interface FauxObjectStore extends ObjectStore {
  /** Every call, in order, so a test can assert what was (not) sent to the backend. */
  readonly calls: { op: "get" | "put" | "list"; key: string }[];
  /** Make the next `put` fail with this error (once). */
  failNextPut(error: Error): void;
  /** Run `hook` right before the next `put` is applied (to simulate a concurrent writer). */
  beforeNextPut(hook: () => void): void;
  keys(): string[];
}

export function createFauxObjectStore(options: { conditional?: boolean } = {}): FauxObjectStore {
  const conditional = options.conditional ?? true;
  const objects = new Map<string, { bytes: Buffer; contentType: string; etag: string }>();
  const calls: FauxObjectStore["calls"] = [];
  let failure: Error | null = null;
  let hook: (() => void) | null = null;
  let version = 0;

  return {
    name: "faux",
    supportsConditionalWrites: conditional,
    calls,
    failNextPut(error) {
      failure = error;
    },
    beforeNextPut(fn) {
      hook = fn;
    },
    keys: () => [...objects.keys()].sort(),

    async get(key): Promise<StoredObject | null> {
      assertSafeObjectKey(key);
      calls.push({ op: "get", key });
      const found = objects.get(key);
      if (!found) return null;
      return {
        bytes: Buffer.from(found.bytes),
        contentType: found.contentType,
        ...(conditional ? { etag: found.etag } : {}),
      };
    },

    async put(key, bytes, put: PutOptions) {
      assertSafeObjectKey(key);
      calls.push({ op: "put", key });
      if (hook) {
        const run = hook;
        hook = null;
        run();
      }
      if (failure) {
        const error = failure;
        failure = null;
        throw error;
      }
      if (conditional && put.ifMatch !== undefined && objects.get(key)?.etag !== put.ifMatch) {
        throw new PreconditionFailedError(key);
      }
      version += 1;
      const etag = `"${createHash("sha1").update(bytes).update(String(version)).digest("hex").slice(0, 12)}"`;
      objects.set(key, { bytes: Buffer.from(bytes), contentType: put.contentType, etag });
      return conditional ? { etag } : {};
    },

    async list(prefix) {
      calls.push({ op: "list", key: prefix });
      return [...objects.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}
