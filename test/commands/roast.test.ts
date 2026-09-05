import { describe, it, expect, vi, beforeEach } from "vitest";
import { runRoast } from "../../src/commands/roast.js";
import { AiUnavailableError, RateLimitError } from "../../src/ai/errors.js";

vi.mock("../../src/ai/roast.js", async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, roastImage: vi.fn() };
});
vi.mock("../../src/lib/image.js", async (orig) => {
  const actual = (await orig()) as object;
  return {
    ...actual,
    fetchImageAsBase64: vi.fn(async () => ({ data: "B64", mimeType: "image/png" })),
  };
});
import { roastImage } from "../../src/ai/roast.js";
import { fetchImageAsBase64 } from "../../src/lib/image.js";

const ctx = () => ({
  cooldown: { check: vi.fn(() => ({ ok: true, retryAfter: 0 })) },
  genai: {} as never,
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  model: "m",
  rng: () => 0.1, // ROAST
});

const png = { contentType: "image/png", size: 100, url: "https://x/y.png" };

describe("runRoast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetchImageAsBase64 as any).mockImplementation(async () => ({
      data: "B64",
      mimeType: "image/png",
    }));
  });

  it("blocks on cooldown", async () => {
    const c = ctx();
    c.cooldown.check = vi.fn(() => ({ ok: false, retryAfter: 12 }));
    const r = await runRoast({ userId: "u", attachment: png }, c);
    expect(r.kind).toBe("cooldown");
    expect(r.content).toContain("12");
    expect(roastImage).not.toHaveBeenCalled();
  });

  it("rejects a non-image", async () => {
    const r = await runRoast(
      { userId: "u", attachment: { ...png, contentType: "application/pdf" } },
      ctx(),
    );
    expect(r.kind).toBe("bad-image");
  });

  it("rejects a missing attachment", async () => {
    const r = await runRoast({ userId: "u", attachment: null }, ctx());
    expect(r.kind).toBe("bad-image");
  });

  it("returns the roast text on success", async () => {
    (roastImage as any).mockResolvedValue({ ok: true, text: "gremlin energy" });
    const r = await runRoast({ userId: "u", attachment: png }, ctx());
    expect(r).toEqual({ kind: "ok", content: "gremlin energy" });
  });

  it("maps a blocked result", async () => {
    (roastImage as any).mockResolvedValue({ ok: false, reason: "blocked" });
    const r = await runRoast({ userId: "u", attachment: png }, ctx());
    expect(r.kind).toBe("blocked");
  });

  it("maps a RateLimitError to rate", async () => {
    (roastImage as any).mockRejectedValue(new RateLimitError());
    const r = await runRoast({ userId: "u", attachment: png }, ctx());
    expect(r.kind).toBe("rate");
  });

  it("maps an AiUnavailableError to down", async () => {
    (roastImage as any).mockRejectedValue(new AiUnavailableError());
    const r = await runRoast({ userId: "u", attachment: png }, ctx());
    expect(r.kind).toBe("down");
  });

  it("maps an image fetch failure to down", async () => {
    (roastImage as any).mockResolvedValue({ ok: true, text: "nope" });
    (fetchImageAsBase64 as any).mockRejectedValueOnce(new Error("boom"));
    const r = await runRoast({ userId: "u", attachment: png }, ctx());
    expect(r.kind).toBe("down");
    expect(roastImage).not.toHaveBeenCalled();
  });
});
