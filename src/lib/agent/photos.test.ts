import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { photoToImageUrl, sniffMime } from "./photos";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBPVP8 ")]);

describe("sniffMime", () => {
  it("reads the type from the bytes", () => {
    expect(sniffMime(JPEG)).toBe("image/jpeg");
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(WEBP)).toBe("image/webp");
    expect(sniffMime(Buffer.from("GIF89a"))).toBe("image/gif");
    expect(sniffMime(Buffer.from("<svg></svg>"))).toBeNull();
    expect(sniffMime(Buffer.alloc(0))).toBeNull();
  });
});

describe("photoToImageUrl", () => {
  let cwd: string;
  let runtime: string;
  beforeAll(async () => {
    cwd = await mkdtemp(path.join(os.tmpdir(), "dd-photos-cwd-"));
    runtime = await mkdtemp(path.join(os.tmpdir(), "dd-photos-runtime-"));
    await mkdir(path.join(cwd, "data", "photos"), { recursive: true });
    await mkdir(path.join(runtime, "uploads"), { recursive: true });
    // A WebP file named .jpg, like the stand-ins of the demo were.
    await writeFile(path.join(cwd, "data", "photos", "liar.jpg"), WEBP);
    await writeFile(path.join(cwd, "secret.txt"), "top secret");
    await writeFile(path.join(runtime, "uploads", "p.png"), PNG);
  });
  afterAll(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(runtime, { recursive: true, force: true });
  });

  it("sends the MIME type of the bytes, not the one the extension suggests", async () => {
    const url = await photoToImageUrl("data/photos/liar.jpg", cwd, runtime);
    expect(url.startsWith("data:image/webp;base64,")).toBe(true);
    expect(Buffer.from(url.split(",")[1], "base64").equals(WEBP)).toBe(true);
  });

  it("reads uploads from the runtime folder (the OS temp dir on Vercel)", async () => {
    const url = await photoToImageUrl(path.join(runtime, "uploads", "p.png"), cwd, runtime);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("refuses a path outside data/, public/ and the runtime folder", async () => {
    await expect(photoToImageUrl("secret.txt", cwd, runtime)).rejects.toThrow(/outside/);
    await expect(photoToImageUrl("../../etc/passwd", cwd, runtime)).rejects.toThrow(/outside/);
  });

  it("refuses a file that is not an image, even inside an allowed folder", async () => {
    await writeFile(path.join(cwd, "data", "photos", "notes.png"), "just text");
    await expect(photoToImageUrl("data/photos/notes.png", cwd, runtime)).rejects.toThrow(/unsupported/);
  });

  it("passes data URLs through and keeps the demo photo files readable", async () => {
    expect(await photoToImageUrl("data:image/png;base64,AAAA", cwd, runtime)).toBe("data:image/png;base64,AAAA");
    const real = await photoToImageUrl("data/photos/vase-broken.webp");
    expect(real.startsWith("data:image/webp;base64,")).toBe(true);
    expect((await readFile(path.join(process.cwd(), "data/photos/vase-broken.webp"))).length).toBeGreaterThan(1000);
  });
});
