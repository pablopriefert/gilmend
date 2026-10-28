import { describe, expect, it, vi } from "vitest";
import { makeCase } from "@/components/fixtures";
import type { CaseRecord, PhotoIntegrity } from "../types";
import {
  EXIF_TOLERANCE_HOURS,
  MAX_COMPARED_CASES,
  MAX_STORED_MATCHES,
  checkPhotoIntegrity,
  integrityForModel,
  type IntegrityCache,
  type IntegrityDeps,
  type IntegrityInput,
} from "./check";
import { loadDemoPhotoHashes } from "./demo-photo-hashes";
import { hashImage } from "./image-hash";
import { demoPhotoBytes, flatPhoto, noisyDarkPhoto, recompress, syntheticPhoto } from "./test-helpers";

const DELIVERED = "2026-10-25T14:00:00.000Z";

/** Photos by reference, so a test says which bytes a report's photo is. */
function deps(
  photos: Record<string, Buffer>,
  cases: CaseRecord[] = [],
  over: Partial<IntegrityDeps> = {},
): IntegrityDeps & { readPhoto: ReturnType<typeof vi.fn>; listCases: ReturnType<typeof vi.fn> } {
  return {
    listCases: vi.fn(async () => cases),
    readPhoto: vi.fn(async (ref: string) => {
      const bytes = photos[ref];
      if (!bytes) throw new Error(`photo not found: ${ref}`);
      return bytes;
    }),
    demoPhotos: () => loadDemoPhotoHashes(),
    ...over,
  } as never;
}

function input(over: Partial<IntegrityInput> = {}): IntegrityInput {
  return {
    report: { photos: ["p1"], orderNumber: "#1001", customerEmail: "camille.laurent@example.com" },
    caseId: "case_new",
    deliveredAt: DELIVERED,
    calledBy: "model",
    now: new Date("2026-10-27T10:00:00.000Z"),
    ...over,
  };
}

/** A stored case that carries the hashes of its photos, as runAgent saves them. */
async function storedCase(
  id: string,
  photo: Buffer,
  who: { order: string; email: string } = { order: "#1002", email: "hugo.bernard@example.com" },
): Promise<CaseRecord> {
  const hash = await hashImage(photo);
  const base = makeCase({ id });
  return {
    ...base,
    report: { ...base.report, orderNumber: who.order, customerEmail: who.email },
    integrity: {
      checkedAt: "2026-10-26T10:00:00.000Z",
      calledBy: "model",
      photos: [{ index: 0, hash, hasExif: false, capturedAt: null, matches: [] }],
      comparedCases: 0,
      comparedPhotos: 0,
      comparedDemoPhotos: 0,
      deliveredAt: null,
      signals: [],
      notes: [],
    },
  };
}

describe("reused photo", () => {
  it("flags a photo that looks like one filed for another order, even after a resize and a re-save", async () => {
    const original = await syntheticPhoto(7);
    const other = await storedCase("case_other", original);
    const result = await checkPhotoIntegrity(input(), deps({ p1: await recompress(original) }, [other]));

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({ kind: "reused_photo", photoIndex: 0 });
    expect(result.signals[0].message).toMatch(/Photo 1 looks like a photo already filed in 1 other case for a different order or customer/);
    expect(result.photos[0].matches).toEqual([
      expect.objectContaining({ source: "case", caseId: "case_other", sameOrderAndCustomer: false }),
    ]);
    expect(result.comparedCases).toBe(1);
    expect(result.comparedPhotos).toBe(1);
  });

  it("does not flag a different picture", async () => {
    const other = await storedCase("case_other", await syntheticPhoto(7));
    const result = await checkPhotoIntegrity(input(), deps({ p1: await syntheticPhoto(20) }, [other]));
    expect(result.signals).toEqual([]);
    expect(result.photos[0].matches).toEqual([]);
  });

  it("does not flag the same customer filing the same photo again for the same order, and says so", async () => {
    const photo = await syntheticPhoto(7);
    const earlier = await storedCase("case_earlier", photo, { order: "1001", email: "Camille.Laurent@Example.com" });
    const result = await checkPhotoIntegrity(input(), deps({ p1: photo }, [earlier]));
    expect(result.signals).toEqual([]);
    expect(result.photos[0].matches[0]).toMatchObject({ caseId: "case_earlier", sameOrderAndCustomer: true });
    expect(result.notes.join(" ")).toMatch(/same order and customer/);
  });

  it("flags the same customer using one photo for two different orders", async () => {
    const photo = await syntheticPhoto(7);
    const earlier = await storedCase("case_earlier", photo, { order: "#0999", email: "camille.laurent@example.com" });
    const result = await checkPhotoIntegrity(input(), deps({ p1: photo }, [earlier]));
    expect(result.signals.map((s) => s.kind)).toEqual(["reused_photo"]);
  });

  it("flags the same order number quoted by another e-mail address", async () => {
    const photo = await syntheticPhoto(7);
    const earlier = await storedCase("case_earlier", photo, { order: "#1001", email: "someone.else@example.com" });
    const result = await checkPhotoIntegrity(input(), deps({ p1: photo }, [earlier]));
    expect(result.signals.map((s) => s.kind)).toEqual(["reused_photo"]);
  });

  it("never compares a case with itself (the run's own pending case is in the store)", async () => {
    const photo = await syntheticPhoto(7);
    const itself = await storedCase("case_new", photo, { order: "#9", email: "x@example.com" });
    const result = await checkPhotoIntegrity(input(), deps({ p1: photo }, [itself]));
    expect(result.signals).toEqual([]);
    expect(result.comparedCases).toBe(0);
  });

  it("counts only the cases that carry hashes, and says how many photos were compared", async () => {
    const withoutHashes = makeCase({ id: "case_old" }); // filed before the check existed
    const a = await storedCase("case_a", await syntheticPhoto(1));
    const b = await storedCase("case_b", await syntheticPhoto(2));
    const result = await checkPhotoIntegrity(input(), deps({ p1: await syntheticPhoto(3) }, [withoutHashes, a, b]));
    expect(result.comparedCases).toBe(2);
    expect(result.comparedPhotos).toBe(2);
    expect(result.comparedDemoPhotos).toBe(6);
  });

  it("ignores a stored hash that is not a hash (a case file is data read back)", async () => {
    const broken = makeCase({ id: "case_broken" });
    broken.integrity = {
      ...(await storedCase("x", await syntheticPhoto(1))).integrity!,
      photos: [{ index: 0, hash: { dhash: "zz", ahash: "yy" } as never, hasExif: false, capturedAt: null, matches: [] }],
    };
    const result = await checkPhotoIntegrity(input(), deps({ p1: await syntheticPhoto(1) }, [broken]));
    expect(result.signals).toEqual([]);
    expect(result.comparedCases).toBe(0);
  });

  it("checks every photo of the report and names the one that matched", async () => {
    const reused = await syntheticPhoto(7);
    const other = await storedCase("case_other", reused);
    const result = await checkPhotoIntegrity(
      input({ report: { photos: ["p1", "p2"], orderNumber: "#1001", customerEmail: "camille.laurent@example.com" } }),
      deps({ p1: await syntheticPhoto(30), p2: reused }, [other]),
    );
    expect(result.signals.map((s) => s.photoIndex)).toEqual([1]);
    expect(result.signals[0].message).toMatch(/^Photo 2 /);
  });
});

describe("photos too uniform to compare (27 Oct 2026)", () => {
  const OTHER = { order: "#1002", email: "hugo.bernard@example.com" };

  it("gives no signal for two different flat photos filed for two orders, and says why", async () => {
    // Black for the earlier case, white now: both hashed to all zeros, and used to match at distance 0.
    const black = await storedCase("case_black", await flatPhoto(0, 0, 0), OTHER);
    const result = await checkPhotoIntegrity(input(), deps({ p1: await flatPhoto(255, 255, 255) }, [black]));
    expect(result.signals).toEqual([]);
    expect(result.photos[0]).toMatchObject({ uniform: true, matches: [] });
    expect(result.notes.join(" ")).toMatch(/Photo 1 is too uniform \(dark, blank or over-exposed\) to compare/);
    // The stored flat photo does not count as something this report was compared with.
    expect(result.comparedCases).toBe(0);
    expect(result.comparedPhotos).toBe(0);
  });

  it("gives no signal for two different near-black noisy photos", async () => {
    const earlier = await storedCase("case_dark", await noisyDarkPhoto(1), OTHER);
    const result = await checkPhotoIntegrity(input(), deps({ p1: await noisyDarkPhoto(2) }, [earlier]));
    expect(result.signals).toEqual([]);
    expect(result.photos[0].uniform).toBe(true);
    expect(result.notes.join(" ")).toMatch(/too uniform/);
  });

  it("still compares the other photos of the same report", async () => {
    const picture = await syntheticPhoto(7);
    const earlier = await storedCase("case_other", picture, OTHER);
    const result = await checkPhotoIntegrity(
      input({ report: { photos: ["p1", "p2"], orderNumber: "#1001", customerEmail: "camille.laurent@example.com" } }),
      deps({ p1: await flatPhoto(0, 0, 0), p2: await recompress(picture) }, [earlier]),
    );
    expect(result.signals.map((s) => [s.kind, s.photoIndex])).toEqual([["reused_photo", 1]]);
    expect(result.notes.join(" ")).toMatch(/Photo 1 is too uniform/);
    expect(result.photos[1].uniform).toBeUndefined();
  });

  it("tells the model the photo could not be compared", async () => {
    const result = await checkPhotoIntegrity(input(), deps({ p1: await flatPhoto(0, 0, 0) }));
    expect(integrityForModel(result)).toMatchObject({ photos: [{ photo: 1, hashed: true, comparable: false }] });
  });
});

describe("bounds on the comparison (review of 27 Oct 2026)", () => {
  /** The same stored case under another id, without hashing the photo again. */
  const copyOf = (c: CaseRecord, id: string): CaseRecord => ({ ...c, id });

  it(`compares only the ${MAX_COMPARED_CASES} most recent cases, and says so`, async () => {
    const picture = await syntheticPhoto(7);
    const matching = await storedCase("case_old_match", picture);
    const filler = await storedCase("case_filler", await syntheticPhoto(20));
    // Newest first, as listCases returns them: the matching case is the 201st.
    const cases = [
      ...Array.from({ length: MAX_COMPARED_CASES }, (_, i) => copyOf(filler, `case_f${i}`)),
      matching,
    ];
    const result = await checkPhotoIntegrity(input(), deps({ p1: picture }, cases));
    expect(result.signals).toEqual([]);
    expect(result.comparedCases).toBe(MAX_COMPARED_CASES);
    expect(result.casesNotCompared).toBe(1);
    expect(result.notes.join(" ")).toMatch(new RegExp(`${MAX_COMPARED_CASES} most recent cases only: 1 older case was left out`));
  });

  it("still catches a match inside the most recent cases", async () => {
    const picture = await syntheticPhoto(7);
    const matching = await storedCase("case_new_match", picture);
    const filler = await storedCase("case_filler", await syntheticPhoto(20));
    const cases = [matching, ...Array.from({ length: MAX_COMPARED_CASES + 5 }, (_, i) => copyOf(filler, `case_f${i}`))];
    const result = await checkPhotoIntegrity(input(), deps({ p1: picture }, cases));
    expect(result.signals.map((s) => s.kind)).toEqual(["reused_photo"]);
    expect(result.casesNotCompared).toBe(6);
  });

  it("does not count the run's own case against the limit, and says nothing when nothing was left out", async () => {
    const filler = await storedCase("case_filler", await syntheticPhoto(20));
    const cases = [copyOf(filler, "case_new"), ...Array.from({ length: MAX_COMPARED_CASES }, (_, i) => copyOf(filler, `case_f${i}`))];
    const result = await checkPhotoIntegrity(input(), deps({ p1: await syntheticPhoto(1) }, cases));
    expect(result.casesNotCompared).toBeUndefined();
    expect(result.notes.join(" ")).not.toMatch(/most recent cases only/);
  });

  it(`keeps the ${MAX_STORED_MATCHES} closest matches of a photo filed again and again, with the true count, in under 2 KB`, async () => {
    const picture = await syntheticPhoto(7);
    const base = await storedCase("case_m0", picture);
    // 20 earlier cases of 20 other customers with the very same picture; the 20th is a slightly different file.
    const cases = Array.from({ length: 20 }, (_, i) => copyOf(base, `case_m${i}`));
    cases[19] = await storedCase("case_m19", await recompress(picture));
    const result = await checkPhotoIntegrity(input(), deps({ p1: picture }, cases));

    const photo = result.photos[0];
    expect(photo.matches).toHaveLength(MAX_STORED_MATCHES);
    expect(photo.matchCount).toBe(20);
    expect(photo.otherMatchCount).toBe(20);
    // Closest first: the copy at distance 0 is kept, the re-save is not.
    expect(photo.matches.every((m) => m.dhashDistance === 0 && m.ahashDistance === 0)).toBe(true);
    // The signal keeps the true number.
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].message).toMatch(/already filed in 20 other cases/);
    // The record stays small however often the picture was filed.
    expect(JSON.stringify(result).length).toBeLessThan(2048);
    // The model sees the true count too.
    expect(integrityForModel(result)).toMatchObject({ photos: [{ otherOrderOrCustomerMatches: 20, sameOrderAndCustomerMatches: 0 }] });
  });

  it("keeps the same-customer note when the cap drops the matches that showed it", async () => {
    const picture = await syntheticPhoto(7);
    const base = await storedCase("case_m0", picture);
    const cases = [
      ...Array.from({ length: 8 }, (_, i) => copyOf(base, `case_m${i}`)),
      await storedCase("case_same", await recompress(picture), { order: "#1001", email: "camille.laurent@example.com" }),
    ];
    const result = await checkPhotoIntegrity(input(), deps({ p1: picture }, cases));
    expect(result.photos[0].matches).toHaveLength(MAX_STORED_MATCHES);
    expect(result.photos[0].matchCount).toBe(9);
    expect(result.photos[0].otherMatchCount).toBe(8);
    expect(result.notes.join(" ")).toMatch(/same order and customer/);
    expect(integrityForModel(result)).toMatchObject({ photos: [{ otherOrderOrCustomerMatches: 8, sameOrderAndCustomerMatches: 1 }] });
  });
});

describe("demo photos", () => {
  const demo1 = { orderNumber: "#1001", customerEmail: "camille.laurent@example.com" };

  it("lets a demo photo be used by its own demo case, even if it was filed before", async () => {
    const vase = demoPhotoBytes("vase-broken");
    const earlier = await storedCase("case_earlier", vase, { order: "#1001", email: "camille.laurent@example.com" });
    const result = await checkPhotoIntegrity(
      input({ report: { photos: ["p1"], ...demo1 } }),
      deps({ p1: await recompress(vase) }, [earlier]),
    );
    expect(result.signals).toEqual([]);
    expect(result.photos[0].matches).toEqual([
      expect.objectContaining({ source: "demo", caseId: "demo-1-vase-broken", sameOrderAndCustomer: true }),
    ]);
  });

  it("accepts the order typed without # and the e-mail typed with capitals (the demo's own habits)", async () => {
    const result = await checkPhotoIntegrity(
      input({ report: { photos: ["p1"], orderNumber: "1001", customerEmail: "Camille.Laurent@Example.com" } }),
      deps({ p1: demoPhotoBytes("vase-broken") }),
    );
    expect(result.signals).toEqual([]);
  });

  it("flags a demo photo filed for another order or customer", async () => {
    const result = await checkPhotoIntegrity(
      input({ report: { photos: ["p1"], orderNumber: "#1002", customerEmail: "hugo.bernard@example.com" } }),
      deps({ p1: demoPhotoBytes("vase-broken") }),
    );
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({ kind: "demo_photo_reused", photoIndex: 0 });
    expect(result.signals[0].message).toMatch(/demo photos shipped with Gilmend/);
    expect(result.photos[0].matches[0]).toMatchObject({ source: "demo", sameOrderAndCustomer: false });
  });

  it("flags the right order with the wrong customer", async () => {
    const result = await checkPhotoIntegrity(
      input({ report: { photos: ["p1"], orderNumber: "#1001", customerEmail: "intruder@example.com" } }),
      deps({ p1: demoPhotoBytes("vase-broken") }),
    );
    expect(result.signals.map((s) => s.kind)).toEqual(["demo_photo_reused"]);
  });

  it("does not compare a demo photo with other cases (it is public: that would flag the demo itself)", async () => {
    const vase = demoPhotoBytes("vase-broken");
    const earlier = await storedCase("case_earlier", vase, { order: "#1005", email: "someone@example.com" });
    const result = await checkPhotoIntegrity(input({ report: { photos: ["p1"], ...demo1 } }), deps({ p1: vase }, [earlier]));
    expect(result.signals).toEqual([]);
    expect(result.photos[0].matches.every((m) => m.source === "demo")).toBe(true);
  });

  describe("a demo photo shared by two demo cases (the German carafe reuses the late-report carafe, 28 Oct 2026)", () => {
    const carafe = () => demoPhotoBytes("carafe-cracked");
    const lateReport = { orderNumber: "#1006", customerEmail: "thomas.garnier@example.org" };
    const german = { orderNumber: "#1011", customerEmail: "jonas.weber@example.org" };

    it.each([
      ["the late-report case", lateReport],
      ["the German case", german],
    ])("shows only %s as the match when it is the one filed, never the other as another customer", async (_label, own) => {
      const result = await checkPhotoIntegrity(input({ report: { photos: ["p1"], ...own } }), deps({ p1: carafe() }));
      expect(result.signals).toEqual([]);
      expect(result.photos[0].matches).toHaveLength(1);
      expect(result.photos[0].matches[0]).toMatchObject({ source: "demo", sameOrderAndCustomer: true });
      // The model is told nothing about "another order or customer" on the demo's own photo.
      expect(integrityForModel(result).photos).toEqual([expect.objectContaining({ otherOrderOrCustomerMatches: 0 })]);
    });

    it("still flags the shared photo filed for a third order, and lists both demo cases", async () => {
      const result = await checkPhotoIntegrity(
        input({ report: { photos: ["p1"], orderNumber: "#1002", customerEmail: "hugo.bernard@example.com" } }),
        deps({ p1: carafe() }),
      );
      expect(result.signals.map((x) => x.kind)).toEqual(["demo_photo_reused"]);
      expect(result.photos[0].matches.map((m) => m.caseId).sort()).toEqual(["demo-6-late-report", "demo-7-german-carafe"]);
    });

    it("counts the demo pictures, not the demo cases that use them", async () => {
      const result = await checkPhotoIntegrity(input({ report: { photos: ["p1"], ...german } }), deps({ p1: carafe() }));
      expect(result.comparedDemoPhotos).toBe(6);
    });
  });

  it("still catches an ordinary photo that matches no demo photo", async () => {
    const result = await checkPhotoIntegrity(input(), deps({ p1: await syntheticPhoto(5) }));
    expect(result.signals).toEqual([]);
    expect(result.photos[0].matches).toEqual([]);
  });
});

describe("capture date against delivery", () => {
  const taken = (date: string) => syntheticPhoto(11, date);

  it("flags a photo taken before the parcel was delivered", async () => {
    const result = await checkPhotoIntegrity(input(), deps({ p1: await taken("2026:10:10 09:30:00") }));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({ kind: "captured_before_delivery", photoIndex: 0 });
    expect(result.signals[0].message).toMatch(/Photo 1 says it was taken on 2026-10-10 09:30, 15 days before the parcel was delivered/);
    expect(result.photos[0]).toMatchObject({ hasExif: true, capturedAt: "2026-10-10T09:30:00" });
  });

  it("says hours, not days, for a recent gap", async () => {
    const result = await checkPhotoIntegrity(input(), deps({ p1: await taken("2026:10:24 14:00:00") }));
    expect(result.signals[0].message).toMatch(/24 hours before/);
  });

  it(`tolerates up to ${EXIF_TOLERANCE_HOURS} h before the delivery (EXIF has no time zone)`, async () => {
    const eleven = await checkPhotoIntegrity(input(), deps({ p1: await taken("2026:10:25 03:00:00") })); // 11 h earlier
    expect(eleven.signals).toEqual([]);
    const thirteen = await checkPhotoIntegrity(input(), deps({ p1: await taken("2026:10:25 01:00:00") })); // 13 h earlier
    expect(thirteen.signals.map((s) => s.kind)).toEqual(["captured_before_delivery"]);
  });

  it("is consistent when the photo was taken after the delivery", async () => {
    const result = await checkPhotoIntegrity(input(), deps({ p1: await taken("2026:10:26 08:00:00") }));
    expect(result.signals).toEqual([]);
    expect(result.notes.join(" ")).toMatch(/consistent with the delivery date/);
  });

  it("a photo with no EXIF is NOT a signal, and the result says why", async () => {
    const result = await checkPhotoIntegrity(input(), deps({ p1: await syntheticPhoto(11) }));
    expect(result.signals).toEqual([]);
    expect(result.photos[0]).toMatchObject({ hasExif: false, capturedAt: null });
    expect(result.notes.join(" ")).toMatch(/No capture date .* Most apps and messengers strip it .* not treated as a signal/);
  });

  it("cannot compare without a delivery date, and says so instead of guessing", async () => {
    const result = await checkPhotoIntegrity(input({ deliveredAt: null }), deps({ p1: await taken("2026:10:10 09:30:00") }));
    expect(result.signals).toEqual([]);
    expect(result.deliveredAt).toBeNull();
    expect(result.notes.join(" ")).toMatch(/no delivery date to compare it with/);
  });
});

describe("unreadable photos and failures", () => {
  it("reports a photo that cannot be read, without a signal", async () => {
    const result = await checkPhotoIntegrity(input(), deps({}));
    expect(result.signals).toEqual([]);
    expect(result.photos[0]).toMatchObject({ hash: null, unreadable: expect.stringMatching(/not found/) });
    expect(result.notes.join(" ")).toMatch(/Photo 1 could not be read or decoded/);
  });

  it("reports a file that is not an image", async () => {
    const result = await checkPhotoIntegrity(input(), deps({ p1: Buffer.from("definitely not an image") }));
    expect(result.photos[0].hash).toBeNull();
    expect(result.photos[0].unreadable).toMatch(/could not be decoded/);
    expect(result.signals).toEqual([]);
  });

  it("rejects when the case store cannot be listed (the loop turns that into a tool error)", async () => {
    const failing = deps({ p1: await syntheticPhoto(1) }, [], {
      listCases: async () => {
        throw new Error("store unreachable");
      },
    });
    await expect(checkPhotoIntegrity(input(), failing)).rejects.toThrow("store unreachable");
  });
});

describe("one run, two calls", () => {
  it("reads the photos and lists the cases once, and sees the delivery date of the second call", async () => {
    const d = deps({ p1: await syntheticPhoto(11, "2026:10:10 09:30:00") });
    const cache: IntegrityCache = {};
    const early = await checkPhotoIntegrity(input({ deliveredAt: null, cache }), d);
    const late = await checkPhotoIntegrity(input({ deliveredAt: DELIVERED, cache }), d);
    expect(early.signals).toEqual([]);
    expect(late.signals.map((s) => s.kind)).toEqual(["captured_before_delivery"]);
    expect(d.readPhoto).toHaveBeenCalledTimes(1);
    expect(d.listCases).toHaveBeenCalledTimes(1);
  });
});

describe("integrityForModel", () => {
  it("shows the model the counts, the signals and what to do, and nothing about another customer", async () => {
    const original = await syntheticPhoto(7);
    const other = await storedCase("case_other_customer_secret", original, {
      order: "#4242",
      email: "secret.customer@example.com",
    });
    const result = await checkPhotoIntegrity(input(), deps({ p1: await recompress(original) }, [other]));
    const shown = integrityForModel(result);
    const text = JSON.stringify(shown);

    expect(shown).toMatchObject({
      checked: true,
      comparedWith: { earlierCases: 1, photos: 1, demoPhotos: 6 },
      photos: [{ photo: 1, hashed: true, otherOrderOrCustomerMatches: 1, sameOrderAndCustomerMatches: 0 }],
    });
    expect(text).toMatch(/Do not accuse the customer/);
    expect(text).not.toMatch(/case_other_customer_secret|secret\.customer|#4242|dhash|ahash/);
  });

  it("tells the model a clean result proves nothing", async () => {
    const result: PhotoIntegrity = await checkPhotoIntegrity(input(), deps({ p1: await syntheticPhoto(1) }));
    expect(JSON.stringify(integrityForModel(result))).toMatch(/not proof that the photos are genuine/);
  });
});

describe("a follow-up round (resumed case)", () => {
  it("does not read again the photos an earlier round already hashed, and keeps their hash and capture date", async () => {
    const first = await syntheticPhoto(31, "2026:10:26 09:00:00");
    const second = await syntheticPhoto(32);
    const d = deps({ p1: first, p2: second });
    const earlier = await checkPhotoIntegrity(input({ report: { photos: ["p1"], orderNumber: "#1001", customerEmail: "a@example.com" } }), d);
    d.readPhoto.mockClear();

    const result = await checkPhotoIntegrity(
      input({
        report: { photos: ["p1", "p2"], orderNumber: "#1001", customerEmail: "a@example.com" },
        knownPhotos: earlier.photos,
      }),
      d,
    );

    // Only the new photo's file was opened; the first one comes from the record of round 1.
    expect(d.readPhoto.mock.calls.map((c) => c[0])).toEqual(["p2"]);
    expect(result.photos.map((p) => p.index)).toEqual([0, 1]);
    expect(result.photos[0].hash).toEqual(earlier.photos[0].hash);
    expect(result.photos[0].capturedAt).toBe(earlier.photos[0].capturedAt);
    expect(result.photos[1].hash).not.toBeNull();
  });

  it("reads a photo again when the earlier round could not hash it", async () => {
    const photo = await syntheticPhoto(33);
    const d = deps({ p1: photo });
    const result = await checkPhotoIntegrity(
      input({
        report: { photos: ["p1"], orderNumber: "#1001", customerEmail: "a@example.com" },
        knownPhotos: [{ index: 0, hash: null, unreadable: "file missing", hasExif: false, capturedAt: null, matches: [] }],
      }),
      d,
    );
    expect(d.readPhoto).toHaveBeenCalledTimes(1);
    expect(result.photos[0].hash).not.toBeNull();
    expect(result.photos[0].unreadable).toBeUndefined();
  });

  it("still compares the earlier photos with other cases, and ignores the cases it was told to ignore", async () => {
    const photo = await syntheticPhoto(34);
    const continued = await storedCase("case_continued", photo, { order: "#9999", email: "a@example.com" });
    const elsewhere = await storedCase("case_elsewhere", photo);
    const report = { photos: ["p1"], orderNumber: "#1001", customerEmail: "a@example.com" };

    const withBoth = await checkPhotoIntegrity(input({ report }), deps({ p1: photo }, [continued, elsewhere]));
    expect(withBoth.signals).toHaveLength(1);
    expect(withBoth.photos[0].matches.map((m) => m.caseId).sort()).toEqual(["case_continued", "case_elsewhere"]);

    // The case a recorded run was forked from holds the same photo: it is not "another case".
    const ignoring = await checkPhotoIntegrity(
      input({ report, ignoreCaseIds: ["case_continued"] }),
      deps({ p1: photo }, [continued, elsewhere]),
    );
    expect(ignoring.photos[0].matches.map((m) => m.caseId)).toEqual(["case_elsewhere"]);
    expect(ignoring.comparedCases).toBe(1);

    // And when it is the only one, nothing is flagged.
    const alone = await checkPhotoIntegrity(input({ report, ignoreCaseIds: ["case_continued"] }), deps({ p1: photo }, [continued]));
    expect(alone.signals).toEqual([]);
  });
});
