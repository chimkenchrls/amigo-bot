import { describe, it, expect, vi } from "vitest";
import {
  pickRoastMode,
  buildRoastPrompt,
  roastImage,
} from "../../src/ai/roast.js";
import {
  RateLimitError,
  AiUnavailableError,
  AiClientError,
} from "../../src/ai/errors.js";

function fakeGenAI(impl: () => unknown) {
  return { models: { generateContent: vi.fn(impl) } } as never;
}

const params = {
  data: "BASE64",
  mimeType: "image/png",
  mode: "ROAST" as const,
  model: "m",
};

describe("pickRoastMode", () => {
  it("splits on 0.5", () => {
    expect(pickRoastMode(() => 0.1)).toBe("ROAST");
    expect(pickRoastMode(() => 0.5)).toBe("TOAST");
    expect(pickRoastMode(() => 0.9)).toBe("TOAST");
  });
});

describe("buildRoastPrompt", () => {
  it("differs by mode and always carries the safety clause", () => {
    const r = buildRoastPrompt("ROAST");
    const t = buildRoastPrompt("TOAST");
    expect(r).not.toBe(t);
    expect(r.toLowerCase()).toContain("minor");
    expect(r.toLowerCase()).toContain("slur");
    expect(r.toLowerCase()).toContain("taglish");
    expect(t.toLowerCase()).toContain("taglish");
    expect(r.toLowerCase()).not.toContain("deep");
  });
});

describe("roastImage", () => {
  it("sends inlineData + prompt with persona and safety settings", async () => {
    const genai = fakeGenAI(() => ({ text: "you look like a discount gargoyle" }));
    const res = await roastImage(genai, params);
    expect(res).toEqual({ ok: true, text: "you look like a discount gargoyle" });
    const call = (genai as never as { models: { generateContent: any } }).models
      .generateContent.mock.calls[0][0];
    expect(call.model).toBe("m");
    expect(call.contents[0].parts[0].inlineData).toEqual({
      mimeType: "image/png",
      data: "BASE64",
    });
    expect(call.config.systemInstruction).toContain("roast");
    expect(call.config.systemInstruction).toContain("Taglish");
    expect(call.config.systemInstruction).not.toMatch(/deep|hindi Taglish/i);
    expect(Array.isArray(call.config.safetySettings)).toBe(true);
    expect(call.config.thinkingConfig.thinkingLevel).toBe("LOW");
  });

  it("returns blocked when the model yields no text", async () => {
    const genai = fakeGenAI(() => ({ text: "" }));
    expect(await roastImage(genai, params)).toEqual({
      ok: false,
      reason: "blocked",
    });
  });

  it("throws RateLimitError on 429", async () => {
    const genai = fakeGenAI(() => {
      throw { status: 429, name: "ApiError" };
    });
    await expect(roastImage(genai, params)).rejects.toBeInstanceOf(RateLimitError);
    expect((genai as never as { models: { generateContent: any } }).models.generateContent).toHaveBeenCalledTimes(1);
  });

  it("retries once then throws AiUnavailableError on 5xx", async () => {
    let calls = 0;
    const genai = fakeGenAI(() => {
      calls++;
      throw { status: 503, name: "ApiError" };
    });
    await expect(roastImage(genai, params)).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
    expect(calls).toBe(2);
  });

  it("throws AiClientError on a 4xx (e.g. 404 model gone) without retry", async () => {
    const genai = fakeGenAI(() => {
      throw { status: 404, name: "ApiError", message: "model gone" };
    });
    await expect(roastImage(genai, params)).rejects.toBeInstanceOf(AiClientError);
    expect((genai as never as { models: { generateContent: any } }).models.generateContent).toHaveBeenCalledTimes(1);
  });

  it("rethrows an error with no HTTP status (no retry)", async () => {
    const originalError = new Error("weird");
    const genai = fakeGenAI(() => {
      throw originalError;
    });
    await expect(roastImage(genai, params)).rejects.toBe(originalError);
    expect((genai as never as { models: { generateContent: any } }).models.generateContent).toHaveBeenCalledTimes(1);
  });
});
