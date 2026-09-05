import { describe, it, expect } from "vitest";
import { createCooldown } from "../../src/lib/cooldown.js";

describe("createCooldown", () => {
  it("allows the first call and blocks an immediate repeat", () => {
    let t = 1000;
    const cd = createCooldown(() => t);
    expect(cd.check("u", "roast", 30_000)).toEqual({ ok: true, retryAfter: 0 });
    t = 1000;
    const r = cd.check("u", "roast", 30_000);
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBe(30);
  });

  it("rounds retryAfter up to whole seconds", () => {
    let t = 0;
    const cd = createCooldown(() => t);
    cd.check("u", "k", 30_000);
    t = 29_100;
    expect(cd.check("u", "k", 30_000).retryAfter).toBe(1);
  });

  it("allows again after the window elapses", () => {
    let t = 0;
    const cd = createCooldown(() => t);
    cd.check("u", "k", 5_000);
    t = 5_000;
    expect(cd.check("u", "k", 5_000).ok).toBe(true);
  });

  it("tracks (user,key) pairs independently", () => {
    let t = 0;
    const cd = createCooldown(() => t);
    cd.check("u", "roast", 30_000);
    expect(cd.check("u", "chat", 5_000).ok).toBe(true);
    expect(cd.check("v", "roast", 30_000).ok).toBe(true);
  });
});
