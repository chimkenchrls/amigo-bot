import { describe, it, expect, vi } from "vitest";
import { createRegistry } from "../../src/game/registry.js";

const handle = (channelId: string) => ({ channelId, abort: vi.fn(async () => {}) });

describe("createRegistry", () => {
  it("tracks sessions by channel", () => {
    const r = createRegistry();
    expect(r.has("c1")).toBe(false);
    r.set(handle("c1"));
    expect(r.has("c1")).toBe(true);
    expect(r.get("c1")?.channelId).toBe("c1");
    r.remove("c1");
    expect(r.has("c1")).toBe(false);
  });

  it("abortAll aborts every session and clears the map", async () => {
    const r = createRegistry();
    const a = handle("c1");
    const b = handle("c2");
    r.set(a);
    r.set(b);
    await r.abortAll("restart");
    expect(a.abort).toHaveBeenCalledWith("restart");
    expect(b.abort).toHaveBeenCalledWith("restart");
    expect(r.size()).toBe(0);
  });

  it("abortAll tolerates an abort that throws", async () => {
    const r = createRegistry();
    r.set({ channelId: "c1", abort: vi.fn(async () => { throw new Error("boom"); }) });
    await expect(r.abortAll("restart")).resolves.toBeUndefined();
    expect(r.size()).toBe(0);
  });
});
