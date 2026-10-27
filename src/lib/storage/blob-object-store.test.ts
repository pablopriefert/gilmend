import { BlobPreconditionFailedError } from "@vercel/blob";
import { describe, expect, it, vi } from "vitest";
import { createBlobObjectStore, type BlobSdk } from "./blob-object-store";
import { PreconditionFailedError } from "./object-store";

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new Response(text).body!;
}

function fakeSdk(overrides: Partial<Record<keyof BlobSdk, unknown>> = {}): BlobSdk {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async (pathname: string) => ({ pathname, etag: "\"e2\"" })),
    list: vi.fn(async () => ({ blobs: [], hasMore: false })),
    ...overrides,
  } as unknown as BlobSdk;
}

describe("Vercel Blob object store", () => {
  it("reads a private blob from origin and returns its bytes, type and ETag", async () => {
    const get = vi.fn(async () => ({
      statusCode: 200,
      stream: streamOf("{\"id\":\"case_1\"}"),
      headers: new Headers(),
      blob: { contentType: "application/json", etag: "\"e1\"", pathname: "cases/case_1.json" },
    }));
    const store = createBlobObjectStore(fakeSdk({ get }));
    const found = await store.get("cases/case_1.json");
    expect(found?.bytes.toString()).toBe("{\"id\":\"case_1\"}");
    expect(found?.contentType).toBe("application/json");
    expect(found?.etag).toBe("\"e1\"");
    expect(get).toHaveBeenCalledWith("cases/case_1.json", { access: "private", useCache: false });
  });

  it("answers null for a missing blob or a 304", async () => {
    expect(await createBlobObjectStore(fakeSdk()).get("cases/x.json")).toBeNull();
    const notModified = vi.fn(async () => ({ statusCode: 304, stream: null, headers: new Headers(), blob: {} }));
    expect(await createBlobObjectStore(fakeSdk({ get: notModified })).get("cases/x.json")).toBeNull();
  });

  it("writes privately under the exact key, with the ETag condition when given", async () => {
    const put = vi.fn(async () => ({ etag: "\"e2\"" }));
    const store = createBlobObjectStore(fakeSdk({ put }));
    expect(await store.put("cases/c.json", Buffer.from("{}"), { contentType: "application/json", ifMatch: "\"e1\"" })).toEqual({
      etag: "\"e2\"",
    });
    expect(put).toHaveBeenCalledWith("cases/c.json", Buffer.from("{}"), {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json",
      ifMatch: "\"e1\"",
    });
    await store.put("claims/c.pdf", Buffer.from("%PDF"), { contentType: "application/pdf" });
    expect((put.mock.calls[1] as unknown[])[2]).not.toHaveProperty("ifMatch");
  });

  it("turns the SDK's precondition failure into the store's own error", async () => {
    const put = vi.fn(async () => {
      throw new BlobPreconditionFailedError();
    });
    await expect(
      createBlobObjectStore(fakeSdk({ put })).put("cases/c.json", Buffer.from("{}"), { contentType: "application/json", ifMatch: "x" }),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it("follows the list pagination", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ blobs: [{ pathname: "cases/a.json" }], hasMore: true, cursor: "c1" })
      .mockResolvedValueOnce({ blobs: [{ pathname: "cases/b.json" }], hasMore: false });
    expect(await createBlobObjectStore(fakeSdk({ list })).list("cases/")).toEqual(["cases/a.json", "cases/b.json"]);
    expect(list).toHaveBeenLastCalledWith({ prefix: "cases/", cursor: "c1", limit: 1000 });
  });

  it("refuses an unsafe key before any network call", async () => {
    const sdk = fakeSdk();
    const store = createBlobObjectStore(sdk);
    await expect(store.get("../secrets")).rejects.toThrow(/Unsafe object key/);
    expect(sdk.get).not.toHaveBeenCalled();
  });
});
