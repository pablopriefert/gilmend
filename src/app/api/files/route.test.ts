import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);
let base: string;
let root: string;

const get = (p: string) => GET(new Request(`http://localhost/api/files?p=${encodeURIComponent(p)}`));

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), "dd-files-"));
  root = path.join(base, "runtime");
  await mkdir(path.join(root, "uploads", "r1"), { recursive: true });
  await writeFile(path.join(root, "uploads", "r1", "photo-1.png"), PNG);
  await writeFile(path.join(root, "uploads", "r1", "notes.txt"), "text");
  await writeFile(path.join(root, "uploads", "r1", "vector.svg"), "<svg/>");
  await writeFile(path.join(base, "outside.png"), PNG);
  vi.stubEnv("DAMAGE_DESK_RUNTIME_DIR", root);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(base, { recursive: true, force: true });
});

describe("GET /api/files", () => {
  it("serves an uploaded image with its real type", async () => {
    const res = await get("uploads/r1/photo-1.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("refuses anything that is not a JPEG, PNG or WebP (no text, no SVG)", async () => {
    expect((await get("uploads/r1/notes.txt")).status).toBe(404);
    expect((await get("uploads/r1/vector.svg")).status).toBe(404);
  });

  it("refuses to leave data/runtime, by traversal, absolute path or symlink", async () => {
    expect((await get("../outside.png")).status).toBe(404);
    expect((await get(path.join(base, "outside.png"))).status).toBe(404);
    await symlink(path.join(base, "outside.png"), path.join(root, "uploads", "link.png"));
    expect((await get("uploads/link.png")).status).toBe(404);
  });

  it("answers 404 for a missing file or an empty request", async () => {
    expect((await get("uploads/r1/missing.png")).status).toBe(404);
    expect((await GET(new Request("http://localhost/api/files"))).status).toBe(404);
  });
});
