import { describe, it, expect } from "vitest";
import { createStudyMode } from "../../src/lib/studyMode.js";

describe("createStudyMode", () => {
  it("starts off and toggles per channel", () => {
    const s = createStudyMode();
    expect(s.has("c1")).toBe(false);
    expect(s.toggle("c1")).toBe(true);
    expect(s.has("c1")).toBe(true);
    expect(s.has("c2")).toBe(false);
    expect(s.toggle("c1")).toBe(false);
    expect(s.has("c1")).toBe(false);
  });

  it("off() clears a channel regardless of state", () => {
    const s = createStudyMode();
    s.toggle("c1");
    s.off("c1");
    s.off("c1");
    expect(s.has("c1")).toBe(false);
  });
});
