import { describe, it, expect } from "vitest";
import { chunk } from "../../src/lib/chunk.js";

describe("chunk", () => {
  it("returns a single chunk for short text", () => {
    expect(chunk("hello", 2000)).toEqual(["hello"]);
  });

  it("returns [] for empty or whitespace input", () => {
    expect(chunk("", 2000)).toEqual([]);
    expect(chunk("   \n ", 2000)).toEqual([]);
  });

  it("splits on whitespace and keeps every chunk within max", () => {
    const word = "ab ";
    const text = word.repeat(50); // 150 chars
    const out = chunk(text, 20);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      expect(c.length).toBeLessThanOrEqual(20);
      expect(c.length).toBeGreaterThan(0);
    }
    expect(out.join(" ").replace(/\s+/g, " ").trim()).toBe(
      text.replace(/\s+/g, " ").trim(),
    );
  });

  it("hard-splits a run with no whitespace", () => {
    const out = chunk("x".repeat(45), 20);
    expect(out).toEqual(["x".repeat(20), "x".repeat(20), "x".repeat(5)]);
  });
});
