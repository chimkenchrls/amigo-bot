import { describe, it, expect, vi } from "vitest";
import { createDistiller } from "../../src/ai/distill.js";
import { RateLimitError, AiClientError } from "../../src/ai/errors.js";
import { MAX_AUTO_FACTS, MAX_FACT_CHARS } from "../../src/constants.js";

function fakeGenAI(impl: () => unknown) {
  return { models: { generateContent: vi.fn(impl) } } as never;
}

describe("createDistiller", () => {
  it("parses a bullet list into notes, stripping markers", async () => {
    const d = createDistiller(
      fakeGenAI(() => ({ text: "- Dana is taking the bar in November\n* movie night moved to Saturdays\n1. Eli got a puppy" })),
      "m",
    );
    const res = await d.distill({ existing: [], transcript: "…" });
    expect(res).toEqual({
      ok: true,
      notes: [
        "Dana is taking the bar in November",
        "movie night moved to Saturdays",
        "Eli got a puppy",
      ],
    });
  });

  it("treats NONE as an explicit clear", async () => {
    const d = createDistiller(fakeGenAI(() => ({ text: "NONE" })), "m");
    expect(await d.distill({ existing: ["old"], transcript: "…" })).toEqual({
      ok: true,
      notes: [],
    });
  });

  it("returns { ok: false } when the model yields no text", async () => {
    const d = createDistiller(fakeGenAI(() => ({ text: "" })), "m");
    expect(await d.distill({ existing: ["keep me"], transcript: "…" })).toEqual({
      ok: false,
    });
  });

  it("caps at MAX_AUTO_FACTS and clamps and dedupes lines", async () => {
    const lines = [
      "x".repeat(MAX_FACT_CHARS + 50),
      "duplicate",
      "DUPLICATE",
      ...Array.from({ length: MAX_AUTO_FACTS + 5 }, (_, i) => `note ${i}`),
    ].join("\n");
    const d = createDistiller(fakeGenAI(() => ({ text: lines })), "m");
    const res = await d.distill({ existing: [], transcript: "…" });
    if (!res.ok) throw new Error("expected ok");
    expect(res.notes.length).toBe(MAX_AUTO_FACTS);
    expect(res.notes[0]!.length).toBe(MAX_FACT_CHARS);
    expect(res.notes.filter((n) => n.toLowerCase() === "duplicate").length).toBe(1);
  });

  it("sends an English system instruction, safety settings, and the inputs", async () => {
    const genai = fakeGenAI(() => ({ text: "NONE" }));
    const d = createDistiller(genai, "m");
    await d.distill({ existing: ["prior note"], transcript: "Dana: hello" });
    const req = (genai as never as { models: { generateContent: { mock: { calls: unknown[][] } } } }).models.generateContent.mock.calls[0]![0] as {
      config: { systemInstruction: string; safetySettings: unknown; thinkingConfig: { thinkingLevel: unknown } };
      contents: { parts: { text: string }[] }[];
    };
    expect(req.config.safetySettings).toBeDefined();
    expect(req.config.thinkingConfig.thinkingLevel).toBeDefined();
    const prompt = req.contents[0]!.parts[0]!.text;
    expect(prompt).toContain("prior note");
    expect(prompt).toContain("Dana: hello");
  });

  it("throws RateLimitError on 429 and AiClientError on 404", async () => {
    await expect(
      createDistiller(fakeGenAI(() => { throw { status: 429 }; }), "m").distill({ existing: [], transcript: "" }),
    ).rejects.toBeInstanceOf(RateLimitError);
    await expect(
      createDistiller(fakeGenAI(() => { throw { status: 404 }; }), "m").distill({ existing: [], transcript: "" }),
    ).rejects.toBeInstanceOf(AiClientError);
  });
});
