import { describe, it, expect } from "vitest";
import { validateImage } from "../../src/lib/image.js";

const base = { url: "https://x/y.png" };

describe("validateImage", () => {
  it("accepts allowed image types", () => {
    for (const t of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      expect(validateImage({ ...base, contentType: t, size: 100 })).toEqual({
        ok: true,
        mimeType: t,
      });
    }
  });

  it("rejects non-images", () => {
    expect(
      validateImage({ ...base, contentType: "application/pdf", size: 100 }),
    ).toEqual({ ok: false, reason: "not-an-image" });
    expect(validateImage({ ...base, contentType: null, size: 100 })).toEqual({
      ok: false,
      reason: "not-an-image",
    });
  });

  it("rejects oversize files", () => {
    expect(
      validateImage({ ...base, contentType: "image/png", size: 5_000_000 }),
    ).toEqual({ ok: false, reason: "too-large" });
  });
});
