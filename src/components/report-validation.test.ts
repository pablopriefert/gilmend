import { describe, expect, it } from "vitest";
import {
  MAX_PHOTO_BYTES,
  sniffImageKind,
  validateFields,
  validateFollowUp,
  validatePhotos,
  validateReport,
} from "./report-validation";

const photo = (over: Partial<{ name: string; size: number; type: string }> = {}) => ({
  name: "p.jpg",
  size: 1000,
  type: "image/jpeg",
  ...over,
});
const ok = { orderNumber: "#1001", email: "ada@example.com", message: "My vase is broken" };

describe("validateFields", () => {
  it("accepts a normal report", () => {
    expect(validateFields(ok)).toEqual({});
  });

  it("asks for each missing field", () => {
    const errors = validateFields({ orderNumber: " ", email: "", message: "" });
    expect(Object.keys(errors).sort()).toEqual(["email", "message", "orderNumber"]);
  });

  it("rejects a malformed e-mail", () => {
    for (const email of ["ada", "ada@", "ada@example", "a b@example.com"]) {
      expect(validateFields({ ...ok, email }).email, email).toBeDefined();
    }
  });

  it("accepts an order number typed without the hash (the agent side normalises it)", () => {
    expect(validateFields({ ...ok, orderNumber: "1002" })).toEqual({});
  });

  it("rejects control characters and absurd lengths", () => {
    expect(validateFields({ ...ok, orderNumber: "12\n34" }).orderNumber).toBeDefined();
    expect(validateFields({ ...ok, orderNumber: "1".repeat(41) }).orderNumber).toBeDefined();
    expect(validateFields({ ...ok, message: "x".repeat(4001) }).message).toBeDefined();
  });
});

describe("validatePhotos", () => {
  it("needs 1 to 3 photos", () => {
    expect(validatePhotos([])).toMatch(/at least one/i);
    expect(validatePhotos([photo()])).toBeNull();
    expect(validatePhotos([photo(), photo(), photo()])).toBeNull();
    expect(validatePhotos([photo(), photo(), photo(), photo()])).toMatch(/up to 3/);
  });

  it("accepts JPEG, PNG and WebP only", () => {
    expect(validatePhotos([photo({ type: "image/png" })])).toBeNull();
    expect(validatePhotos([photo({ type: "image/webp" })])).toBeNull();
    expect(validatePhotos([photo({ type: "image/gif", name: "a.gif" })])).toMatch(/not a JPEG, PNG or WebP/);
    expect(validatePhotos([photo({ type: "application/pdf" })])).not.toBeNull();
  });

  it("rejects an empty file and a file over 8 MB", () => {
    expect(validatePhotos([photo({ size: 0 })])).toMatch(/empty/);
    expect(validatePhotos([photo({ size: MAX_PHOTO_BYTES })])).toBeNull();
    expect(validatePhotos([photo({ size: MAX_PHOTO_BYTES + 1 })])).toMatch(/8 MB/);
  });
});

describe("validateReport", () => {
  it("merges field and photo errors", () => {
    const errors = validateReport({ orderNumber: "", email: ok.email, message: ok.message }, []);
    expect(Object.keys(errors).sort()).toEqual(["orderNumber", "photos"]);
  });
});

describe("sniffImageKind", () => {
  it("recognises the real signatures, whatever the file claims to be", () => {
    expect(sniffImageKind(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffImageKind(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(sniffImageKind(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(sniffImageKind(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageKind(Buffer.from("hello world"))).toBeNull();
    expect(sniffImageKind(new Uint8Array())).toBeNull();
  });
});

describe("validateFollowUp (the customer's reply to a case)", () => {
  it("needs words or at least one photo, and asks for neither alone", () => {
    expect(validateFollowUp({ message: "", orderNumber: "" }, [])).toEqual({
      message: "Add what the customer wrote, or at least one photo.",
    });
    expect(validateFollowUp({ message: "  ", orderNumber: "" }, [])).toHaveProperty("message");
    expect(validateFollowUp({ message: "Here is a sharper photo.", orderNumber: "" }, [])).toEqual({});
    expect(validateFollowUp({ message: "", orderNumber: "" }, [photo()])).toEqual({});
  });

  it("caps the message at 2000 characters", () => {
    expect(validateFollowUp({ message: "x".repeat(2000), orderNumber: "" }, [])).toEqual({});
    expect(validateFollowUp({ message: "x".repeat(2001), orderNumber: "" }, [])).toEqual({
      message: "The message is too long (max 2000 characters).",
    });
  });

  it("takes up to 3 photos of a known type, not empty, at most 8 MB", () => {
    const reply = { message: "Here.", orderNumber: "" };
    expect(validateFollowUp(reply, [photo(), photo(), photo()])).toEqual({});
    expect(validateFollowUp(reply, [photo(), photo(), photo(), photo()]).photos).toBe("You can add up to 3 photos.");
    expect(validateFollowUp(reply, [photo({ name: "a.pdf", type: "application/pdf" })]).photos).toMatch(/not a JPEG, PNG or WebP/);
    expect(validateFollowUp(reply, [photo({ size: 0 })]).photos).toMatch(/is empty/);
    expect(validateFollowUp(reply, [photo({ size: 8 * 1024 * 1024 + 1 })]).photos).toMatch(/larger than 8 MB/);
  });

  it("checks the corrected order number only when there is one", () => {
    expect(validateFollowUp({ message: "Here.", orderNumber: "#1001" }, [])).toEqual({});
    expect(validateFollowUp({ message: "Here.", orderNumber: "#".repeat(41) }, []).orderNumber).toMatch(/too long/);
    expect(validateFollowUp({ message: "Here.", orderNumber: "#10\u0000" }, []).orderNumber).toMatch(/invalid characters/);
  });
});
