import { describe, expect, it } from "vitest";
import { sniffMime } from "@/lib/agent/photos";
import { GET } from "./route";

const get = (name: string) => GET(new Request(`http://x/api/demo-photo?name=${encodeURIComponent(name)}`));

describe("GET /api/demo-photo", () => {
  it("serves the sharp lamp photo of the 'simulate the customer's reply' demo, as the image it is", async () => {
    const res = await get("lamp-sharp");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(sniffMime(bytes)).toBe("image/webp");
    // It is a Muse Image output: its metadata says so and must stay (data/photos/README.md).
    expect(Buffer.from(bytes).toString("latin1")).toContain("trainedAlgorithmicMedia");
  });

  it("still serves the six demo photos, and nothing else", async () => {
    for (const name of ["vase-broken", "carton-crushed", "lamp-blurry", "parcel-open-missing", "headphones-cracked", "carafe-cracked"]) {
      expect((await get(name)).status, name).toBe(200);
    }
    for (const name of ["", "../package", "lamp-sharp.jpg", "lamp"]) expect((await get(name)).status, name).toBe(404);
  });
});
