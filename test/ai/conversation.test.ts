import { describe, it, expect, vi } from "vitest";
import type { HistoryTurn } from "../../src/ai/conversation.js";
import { toGeminiHistory, generateReply } from "../../src/ai/conversation.js";
import { RateLimitError } from "../../src/ai/errors.js";

describe("toGeminiHistory", () => {
  it("maps roles and preserves order", () => {
    expect(
      toGeminiHistory([
        { role: "user", content: "hi" },
        { role: "model", content: "yo" },
      ]),
    ).toEqual([
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ text: "yo" }] },
    ]);
  });

  it("drops leading model turns", () => {
    expect(
      toGeminiHistory([
        { role: "model", content: "stale" },
        { role: "user", content: "hi" },
      ]),
    ).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
  });

  it("returns [] for empty input", () => {
    expect(toGeminiHistory([])).toEqual([]);
  });
});

function fakeGenAI(sendImpl: () => unknown) {
  const sendMessage = vi.fn(sendImpl);
  const create = vi.fn(() => ({ sendMessage }));
  return { genai: { chats: { create } } as never, create, sendMessage };
}

describe("generateReply", () => {
  it("passes history + persona + safety and returns text", async () => {
    const { genai, create, sendMessage } = fakeGenAI(() => ({ text: "sup" }));
    const history: HistoryTurn[] = [{ role: "user", parts: [{ text: "hi" }] }];
    const res = await generateReply(genai, {
      history,
      userTurn: "Dana: hello",
      model: "m",
    });
    expect(res).toEqual({ ok: true, text: "sup" });
    const createCall = create.mock.calls[0];
    const sendCall = sendMessage.mock.calls[0];
    expect(createCall).toBeDefined();
    expect(sendCall).toBeDefined();
    expect((createCall as unknown[])[0]).toBeDefined();
    expect((sendCall as unknown[])[0]).toBeDefined();
    const createArgs = (createCall as unknown[])[0] as Record<string, unknown>;
    const sendArgs = (sendCall as unknown[])[0] as Record<string, unknown>;
    expect(createArgs.model).toBe("m");
    expect(createArgs.history).toBe(history);
    expect((createArgs.config as Record<string, unknown>).systemInstruction).toContain("AmIgo");
    expect(Array.isArray((createArgs.config as Record<string, unknown>).safetySettings)).toBe(true);
    expect(sendArgs).toEqual({ message: "Dana: hello" });
  });

  it("returns blocked on empty text", async () => {
    const { genai } = fakeGenAI(() => ({ text: "" }));
    expect(
      await generateReply(genai, { history: [], userTurn: "x", model: "m" }),
    ).toEqual({ ok: false, reason: "blocked" });
  });

  it("throws RateLimitError on 429", async () => {
    const { genai } = fakeGenAI(() => {
      throw { status: 429 };
    });
    await expect(
      generateReply(genai, { history: [], userTurn: "x", model: "m" }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});
