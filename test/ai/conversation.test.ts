import { describe, it, expect, vi } from "vitest";
import type { HistoryTurn } from "../../src/ai/conversation.js";
import {
  toGeminiHistory,
  generateReply,
  generateReplyStream,
} from "../../src/ai/conversation.js";
import {
  RateLimitError,
  AiUnavailableError,
  AiClientError,
} from "../../src/ai/errors.js";

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
    const sysInstruction = (createArgs.config as Record<string, unknown>)
      .systemInstruction as string;
    expect(sysInstruction).toContain("AmIgo");
    expect(sysInstruction).toContain("Taglish");
    expect(sysInstruction).not.toMatch(/deep|hindi Taglish/i);
    expect(Array.isArray((createArgs.config as Record<string, unknown>).safetySettings)).toBe(true);
    expect(
      (createArgs.config as { thinkingConfig?: { thinkingLevel?: string } })
        .thinkingConfig?.thinkingLevel,
    ).toBe("LOW");
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

  it("rethrows other errors without retry", async () => {
    const boom = new Error("boom");
    const { genai, create } = fakeGenAI(() => {
      throw boom;
    });
    await expect(
      generateReply(genai, { history: [], userTurn: "x", model: "m" }),
    ).rejects.toBe(boom);
    expect(create.mock.calls).toHaveLength(1);
  });

  it("throws AiClientError on a 404 without retrying", async () => {
    const { genai, create } = fakeGenAI(() => {
      throw { status: 404, message: "model gone" };
    });
    await expect(
      generateReply(genai, { history: [], userTurn: "x", model: "m" }),
    ).rejects.toBeInstanceOf(AiClientError);
    expect(create.mock.calls).toHaveLength(1);
  });

  it("retries once on unavailable (503) then throws AiUnavailableError", async () => {
    const { genai, create } = fakeGenAI(() => {
      throw { status: 503 };
    });
    await expect(
      generateReply(genai, { history: [], userTurn: "x", model: "m" }),
    ).rejects.toBeInstanceOf(AiUnavailableError);
    expect(create.mock.calls).toHaveLength(2);
  });
});

function fakeStreamGenAI(streamImpl: () => AsyncIterable<{ text?: string }>) {
  const sendMessageStream = vi.fn(async () => streamImpl());
  const create = vi.fn(() => ({ sendMessageStream }));
  return { genai: { chats: { create } } as never, create, sendMessageStream };
}

async function* chunks(parts: string[]): AsyncIterable<{ text?: string }> {
  for (const p of parts) yield { text: p };
}

async function drain(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

describe("generateReplyStream", () => {
  it("yields text deltas and passes history + persona + thinking config", async () => {
    const { genai, create } = fakeStreamGenAI(() => chunks(["ku", "mus", "ta"]));
    const got = await drain(
      generateReplyStream(genai, {
        history: [{ role: "user", parts: [{ text: "hi" }] }],
        userTurn: "Dana: hoy",
        model: "m",
      }),
    );
    expect(got).toEqual(["ku", "mus", "ta"]);
    const createArgs = (create.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(createArgs.model).toBe("m");
    const config = createArgs.config as {
      systemInstruction: string;
      thinkingConfig?: { thinkingLevel?: string };
    };
    expect(config.systemInstruction).toContain("AmIgo");
    expect(config.systemInstruction).toContain("Taglish");
    expect(config.systemInstruction).not.toMatch(/deep|hindi Taglish/i);
    expect(config.thinkingConfig?.thinkingLevel).toBe("LOW");
  });

  it("skips empty deltas", async () => {
    const { genai } = fakeStreamGenAI(() => chunks(["a", "", "b"]));
    expect(
      await drain(generateReplyStream(genai, { history: [], userTurn: "x", model: "m" })),
    ).toEqual(["a", "b"]);
  });

  it("throws RateLimitError on a pre-stream 429 without retrying", async () => {
    const { genai, create } = fakeStreamGenAI(() => {
      throw { status: 429 };
    });
    await expect(
      drain(generateReplyStream(genai, { history: [], userTurn: "x", model: "m" })),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(create.mock.calls).toHaveLength(1);
  });

  it("retries once on a pre-stream 503 then throws AiUnavailableError", async () => {
    const { genai, create } = fakeStreamGenAI(() => {
      throw { status: 503 };
    });
    await expect(
      drain(generateReplyStream(genai, { history: [], userTurn: "x", model: "m" })),
    ).rejects.toBeInstanceOf(AiUnavailableError);
    expect(create.mock.calls).toHaveLength(2);
  });

  it("throws AiClientError on a pre-stream 404 without retrying", async () => {
    const { genai, create } = fakeStreamGenAI(() => {
      throw { status: 404 };
    });
    await expect(
      drain(generateReplyStream(genai, { history: [], userTurn: "x", model: "m" })),
    ).rejects.toBeInstanceOf(AiClientError);
    expect(create.mock.calls).toHaveLength(1);
  });

  it("propagates a mid-stream error after yielding the partial, without retrying", async () => {
    async function* boom(): AsyncIterable<{ text?: string }> {
      yield { text: "kal" };
      yield { text: "ahati" };
      throw { status: 503 };
    }
    const { genai, create } = fakeStreamGenAI(() => boom());
    const gen = generateReplyStream(genai, { history: [], userTurn: "x", model: "m" });
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const c of gen) seen.push(c);
      })(),
    ).rejects.toBeTruthy();
    expect(seen).toEqual(["kal", "ahati"]);
    expect(create.mock.calls).toHaveLength(1);
  });
});
