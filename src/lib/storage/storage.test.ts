import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFauxObjectStore } from "./faux-object-store";
import { overrideSharedObjects, sharedObjects, storageIsEphemeral } from "./index";
import { assertSafeObjectKey, isSafeObjectKey } from "./object-store";
import { discardRuntimeFiles, persistRuntimeFile, restoreRuntimeFile, runtimeObjectKey } from "./runtime-files";

let scratch: string;
let root: string;

beforeEach(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "dd-storage-"));
  root = path.join(scratch, "runtime");
  await mkdir(path.join(root, "evidence"), { recursive: true });
});
afterEach(async () => {
  overrideSharedObjects(undefined);
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

describe("object keys", () => {
  it("accepts plain slash-separated paths and refuses anything that could escape or confuse a backend", () => {
    for (const ok of ["cases/case_1.json", "files/evidence/ab12-annotated.jpg", "files/uploads/0f3c-4/photo-1.png"]) {
      expect(isSafeObjectKey(ok), ok).toBe(true);
    }
    for (const bad of ["", "/abs", "a//b", "a/../b", "../a", "a/./b", ".hidden", "a/.hidden", "a b", "a\\b", "a?b", "a#b", "a\0b", "é", "a".repeat(201)]) {
      expect(isSafeObjectKey(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(() => assertSafeObjectKey("../x")).toThrow(/Unsafe object key/);
  });

  it("the in-memory test store applies the same rule", async () => {
    const objects = createFauxObjectStore();
    await expect(objects.get("../x")).rejects.toThrow(/Unsafe object key/);
    await expect(objects.put("a b", Buffer.from("x"), { contentType: "text/plain" })).rejects.toThrow(/Unsafe object key/);
  });
});

describe("which storage the app runs on", () => {
  it("uses local files by default and for DAMAGE_DESK_STORAGE=file", () => {
    expect(sharedObjects({})).toBeNull();
    expect(sharedObjects({ DAMAGE_DESK_STORAGE: "" })).toBeNull();
    expect(sharedObjects({ DAMAGE_DESK_STORAGE: " File " })).toBeNull();
  });

  it("picks Vercel Blob for DAMAGE_DESK_STORAGE=blob, once per process", () => {
    const store = sharedObjects({ DAMAGE_DESK_STORAGE: "blob" });
    expect(store?.name).toBe("blob");
    expect(store?.supportsConditionalWrites).toBe(true);
    expect(sharedObjects({ DAMAGE_DESK_STORAGE: " Blob " })).toBe(store);
  });

  it("fails loudly for a backend this build does not have, instead of silently keeping files", () => {
    expect(() => sharedObjects({ DAMAGE_DESK_STORAGE: "s3" })).toThrow(/Unknown DAMAGE_DESK_STORAGE "s3"/);
    expect(() => sharedObjects({ DAMAGE_DESK_STORAGE: "s3" })).toThrow(/docs\/storage\.md/);
  });

  it("can be overridden by a test, and goes back to the environment", () => {
    const objects = createFauxObjectStore();
    overrideSharedObjects(objects);
    expect(sharedObjects({})).toBe(objects);
    overrideSharedObjects(undefined);
    expect(sharedObjects({})).toBeNull();
  });

  it("flags a Vercel deployment with no shared store as ephemeral", () => {
    expect(storageIsEphemeral({})).toBe(false);
    expect(storageIsEphemeral({ VERCEL: "1" })).toBe(true);
    overrideSharedObjects(createFauxObjectStore());
    expect(storageIsEphemeral({ VERCEL: "1" })).toBe(false);
  });
});

describe("runtimeObjectKey", () => {
  it("is the path under the runtime folder, and null outside it", () => {
    expect(runtimeObjectKey(path.join(root, "evidence", "a-annotated.jpg"), root)).toBe("files/evidence/a-annotated.jpg");
    expect(runtimeObjectKey(path.join(root, "evidence", "..", "..", "x.jpg"), root)).toBeNull();
    expect(runtimeObjectKey(path.join(scratch, "other.jpg"), root)).toBeNull();
    expect(runtimeObjectKey(root, root)).toBeNull();
    expect(runtimeObjectKey(path.join(root, "evidence", "with space.jpg"), root)).toBeNull();
  });
});

describe("persistRuntimeFile and restoreRuntimeFile", () => {
  const file = () => path.join(root, "evidence", "a-annotated.jpg");

  it("do nothing without a shared store", async () => {
    await writeFile(file(), "bytes");
    await expect(persistRuntimeFile(file(), root)).resolves.toBeUndefined();
    expect(await restoreRuntimeFile(file(), root)).toBe(true);
    expect(await restoreRuntimeFile(path.join(root, "evidence", "missing.jpg"), root)).toBe(false);
  });

  it("copy a file to the store, and back into another instance's empty runtime folder", async () => {
    const objects = createFauxObjectStore();
    overrideSharedObjects(objects);
    await writeFile(file(), Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]));
    await persistRuntimeFile(file(), root);
    expect(objects.keys()).toEqual(["files/evidence/a-annotated.jpg"]);
    expect((await objects.get("files/evidence/a-annotated.jpg"))?.contentType).toBe("image/jpeg");

    const otherInstance = path.join(scratch, "other-runtime");
    const target = path.join(otherInstance, "evidence", "a-annotated.jpg");
    expect(await restoreRuntimeFile(target, otherInstance)).toBe(true);
    expect(Buffer.from(await readFile(target)).equals(Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]))).toBe(true);
    // No temp file is left behind, and a second restore does not ask the store again.
    expect((await readdir(path.join(otherInstance, "evidence"))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    objects.calls.length = 0;
    expect(await restoreRuntimeFile(target, otherInstance)).toBe(true);
    expect(objects.calls).toEqual([]);
  });

  it("restore is false when the store does not hold the file, and never writes outside the runtime folder", async () => {
    const objects = createFauxObjectStore();
    overrideSharedObjects(objects);
    expect(await restoreRuntimeFile(file(), root)).toBe(false);
    const escape = path.join(scratch, "escaped.jpg");
    expect(await restoreRuntimeFile(escape, root)).toBe(false);
    expect(objects.calls.filter((c) => c.key.includes("escaped"))).toEqual([]);
  });

  it("persist fails loudly when the backend does, and for a file outside the runtime folder", async () => {
    const objects = createFauxObjectStore();
    overrideSharedObjects(objects);
    await writeFile(file(), "bytes");
    objects.failNextPut(new Error("backend down"));
    await expect(persistRuntimeFile(file(), root)).rejects.toThrow("backend down");
    await writeFile(path.join(scratch, "outside.jpg"), "bytes");
    await expect(persistRuntimeFile(path.join(scratch, "outside.jpg"), root)).rejects.toThrow(/Not a runtime file/);
  });
});

describe("discardRuntimeFiles", () => {
  const photo = () => path.join(root, "uploads", "fu", "photo-1.png");

  it("removes the local copy and the shared object, and leaves the other files alone", async () => {
    const objects = createFauxObjectStore();
    overrideSharedObjects(objects);
    await mkdir(path.dirname(photo()), { recursive: true });
    await writeFile(photo(), "bytes");
    await persistRuntimeFile(photo(), root);
    const keep = path.join(root, "uploads", "fu", "photo-2.png");
    await writeFile(keep, "other");
    await persistRuntimeFile(keep, root);

    expect(await discardRuntimeFiles([photo()], root)).toBe(0);
    expect(objects.keys()).toEqual(["files/uploads/fu/photo-2.png"]);
    expect(await readdir(path.dirname(photo()))).toEqual(["photo-2.png"]);
  });

  it("works without a shared store, and for a file that is not there", async () => {
    await mkdir(path.dirname(photo()), { recursive: true });
    await writeFile(photo(), "bytes");
    expect(await discardRuntimeFiles([photo(), path.join(root, "uploads", "fu", "missing.png")], root)).toBe(0);
    expect(await readdir(path.dirname(photo()))).toEqual([]);
  });

  it("keeps going and counts the objects the backend would not remove", async () => {
    const objects = createFauxObjectStore();
    overrideSharedObjects({ ...objects, delete: async () => { throw new Error("backend down"); } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await mkdir(path.dirname(photo()), { recursive: true });
    await writeFile(photo(), "bytes");
    expect(await discardRuntimeFiles([photo()], root)).toBe(1);
    // The local copy is gone even so.
    expect(await readdir(path.dirname(photo()))).toEqual([]);
  });
});
