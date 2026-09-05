import { describe, it, expect } from "vitest";
import { createBotMessageCache } from "../../src/lib/botMessages.js";

describe("createBotMessageCache", () => {
  it("remembers and recalls ids", () => {
    const c = createBotMessageCache(3);
    c.remember("a");
    expect(c.has("a")).toBe(true);
    expect(c.has("z")).toBe(false);
  });

  it("evicts oldest past capacity", () => {
    const c = createBotMessageCache(2);
    c.remember("a");
    c.remember("b");
    c.remember("c");
    expect(c.has("a")).toBe(false);
    expect(c.has("b")).toBe(true);
    expect(c.has("c")).toBe(true);
  });
});
