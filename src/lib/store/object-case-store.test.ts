import { afterEach, describe, expect, it, vi } from "vitest";
import { createFauxObjectStore } from "../storage/faux-object-store";
import { PreconditionFailedError } from "../storage/object-store";
import { fauxCase } from "./faux-cases";
import { createObjectCaseStore } from "./object-case-store";

afterEach(() => vi.restoreAllMocks());

describe("createObjectCaseStore (cases on a shared object store)", () => {
  it("round-trips a case as one JSON object under cases/", async () => {
    const objects = createFauxObjectStore();
    const store = createObjectCaseStore({ objects });
    const c = fauxCase({ id: "case-1" });
    await store.save(c);
    expect(objects.keys()).toEqual(["cases/case-1.json"]);
    expect(await store.get("case-1")).toEqual(c);
    const stored = await objects.get("cases/case-1.json");
    expect(stored?.contentType).toBe("application/json");
    expect(JSON.parse(stored!.bytes.toString("utf8")).id).toBe("case-1");
  });

  it("two instances sharing the object store see each other's cases", async () => {
    const objects = createFauxObjectStore();
    const a = createObjectCaseStore({ objects });
    const b = createObjectCaseStore({ objects });
    await a.save(fauxCase({ id: "from-a" }));
    expect((await b.get("from-a"))?.id).toBe("from-a");
    await b.update("from-a", { status: "approved" });
    expect((await a.get("from-a"))?.status).toBe("approved");
  });

  it("lists newest first, ties broken by id, ignoring foreign keys", async () => {
    const objects = createFauxObjectStore();
    const store = createObjectCaseStore({ objects });
    await store.save(fauxCase({ id: "old", createdAt: "2026-10-28T08:00:00.000Z" }));
    await store.save(fauxCase({ id: "new", createdAt: "2026-10-30T08:00:00.000Z" }));
    await store.save(fauxCase({ id: "mid-b", createdAt: "2026-10-29T08:00:00.000Z" }));
    await store.save(fauxCase({ id: "mid-a", createdAt: "2026-10-29T08:00:00.000Z" }));
    await objects.put("files/evidence/x.jpg", Buffer.from("x"), { contentType: "image/jpeg" });
    await objects.put("cases/notes.txt", Buffer.from("x"), { contentType: "text/plain" });
    expect((await store.list()).map((c) => c.id)).toEqual(["new", "mid-a", "mid-b", "old"]);
  });

  it("save replaces an existing case", async () => {
    const store = createObjectCaseStore({ objects: createFauxObjectStore() });
    await store.save(fauxCase({ id: "x", status: "new" }));
    await store.save(fauxCase({ id: "x", status: "approved" }));
    expect((await store.get("x"))?.status).toBe("approved");
    expect(await store.list()).toHaveLength(1);
  });

  it("refuses unsafe ids before any key is built", async () => {
    const objects = createFauxObjectStore();
    const store = createObjectCaseStore({ objects });
    expect(await store.get("../secret")).toBeNull();
    expect(await store.get("a/b")).toBeNull();
    await expect(store.save(fauxCase({ id: "../evil" }))).rejects.toThrow(/Invalid case id/);
    await expect(store.update("a/b", { status: "approved" })).rejects.toThrow(/Unknown case/);
    expect(objects.calls).toEqual([]);
  });

  it("get is null for an unknown id and throws for a corrupt object; list skips it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const objects = createFauxObjectStore();
    const store = createObjectCaseStore({ objects });
    await store.save(fauxCase({ id: "good" }));
    await objects.put("cases/broken.json", Buffer.from("{ not json"), { contentType: "application/json" });
    await objects.put("cases/other.json", Buffer.from(JSON.stringify({ id: "mismatch" })), { contentType: "application/json" });
    expect(await store.get("missing")).toBeNull();
    await expect(store.get("broken")).rejects.toThrow(/corrupt \(invalid JSON\)/);
    await expect(store.get("other")).rejects.toThrow(/corrupt \(id mismatch\)/);
    expect((await store.list()).map((c) => c.id)).toEqual(["good"]);
  });

  it("update merges the patch and bumps updatedAt, keeping the id", async () => {
    const store = createObjectCaseStore({ objects: createFauxObjectStore(), now: () => new Date("2026-11-01T09:00:00.000Z") });
    await store.save(fauxCase({ id: "u" }));
    const updated = await store.update("u", { status: "approved", id: "hijack", engine: undefined } as never);
    expect(updated).toMatchObject({ id: "u", status: "approved", updatedAt: "2026-11-01T09:00:00.000Z", engine: "demo-mock" });
    await expect(store.update("ghost", { status: "approved" })).rejects.toThrow(/Unknown case/);
  });

  it("concurrent updates inside one instance do not lose each other's changes", async () => {
    const store = createObjectCaseStore({ objects: createFauxObjectStore() });
    await store.save(fauxCase({ id: "race" }));
    await Promise.all([
      store.update("race", { status: "approved" }),
      store.update("race", { trace: [{ step: "Approved by merchant", at: "2026-10-30T10:00:00.000Z" }] }),
      store.update("race", { engine: "muse-spark-1.3" }),
    ]);
    const final = await store.get("race");
    expect(final).toMatchObject({ status: "approved", engine: "muse-spark-1.3" });
    expect(final?.trace).toHaveLength(1);
  });

  describe("across instances (no shared lock)", () => {
    it("a conditional write that loses the race re-reads and re-applies the patch", async () => {
      const objects = createFauxObjectStore({ conditional: true });
      const a = createObjectCaseStore({ objects });
      await a.save(fauxCase({ id: "c" }));

      // What instance B writes while instance A is between its read and its write.
      const current = JSON.parse((await objects.get("cases/c.json"))!.bytes.toString("utf8"));
      const fromB = Buffer.from(JSON.stringify({ ...current, trace: [{ step: "from B", at: "2026-10-30T10:00:00.000Z" }] }));
      objects.beforeNextPut(() => {
        void objects.put("cases/c.json", fromB, { contentType: "application/json" });
      });

      await a.update("c", { status: "approved" });

      const final = await a.get("c");
      expect(final?.status).toBe("approved");
      // B's write survived: A's first put was refused (stale ETag) and A applied its patch again.
      expect(final?.trace.map((t) => t.step)).toEqual(["from B"]);
      expect(objects.calls.filter((c) => c.op === "put")).toHaveLength(4);
    });

    it("gives up with a clear error after repeated conflicts", async () => {
      const objects = createFauxObjectStore({ conditional: true });
      const store = createObjectCaseStore({ objects });
      await store.save(fauxCase({ id: "c" }));
      const put = objects.put.bind(objects);
      vi.spyOn(objects, "put").mockImplementation(async (key, bytes, options) => {
        if (options.ifMatch !== undefined) throw new PreconditionFailedError(key);
        return put(key, bytes, options);
      });
      await expect(store.update("c", { status: "approved" })).rejects.toThrow(/being changed elsewhere/);
    });

    it("without conditional writes it is last-writer-wins, and says so by not sending an ETag", async () => {
      const objects = createFauxObjectStore({ conditional: false });
      const store = createObjectCaseStore({ objects });
      await store.save(fauxCase({ id: "c" }));
      const put = vi.spyOn(objects, "put");
      await store.update("c", { status: "approved" });
      expect(put.mock.calls[0][2]).toEqual({ contentType: "application/json" });
    });

    it("a backend failure is not swallowed", async () => {
      const objects = createFauxObjectStore();
      const store = createObjectCaseStore({ objects });
      await store.save(fauxCase({ id: "c" }));
      objects.failNextPut(new Error("503 from the backend"));
      await expect(store.update("c", { status: "approved" })).rejects.toThrow("503 from the backend");
      await expect(store.save(fauxCase({ id: "d" }))).resolves.toBeDefined();
    });
  });
});
