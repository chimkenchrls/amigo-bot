import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleChat } from "../../src/chat/handler.js";
import {
  MAX_CHAT_INPUT_CHARS,
  TYPING_KEEPALIVE_MS,
  CHAT_COOLDOWN_MS,
  NAME_TRIGGER_COOLDOWN_MS,
  MAX_AUTO_FACTS,
} from "../../src/constants.js";
import {
  RateLimitError,
  AiUnavailableError,
  AiClientError,
} from "../../src/ai/errors.js";

vi.mock("../../src/ai/conversation.js", async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, generateReplyStream: vi.fn() };
});
import { generateReplyStream } from "../../src/ai/conversation.js";

async function* streamOf(parts: string[]): AsyncGenerator<string> {
  for (const p of parts) yield p;
}

async function* streamThenThrow(
  parts: string[],
  err: unknown,
): AsyncGenerator<string> {
  for (const p of parts) yield p;
  throw err;
}

async function* streamThrow(err: unknown): AsyncGenerator<string> {
  throw err;
  yield ""; // unreachable, satisfies the generator type
}

function deps(over: Partial<Parameters<typeof handleChat>[0]> = {}) {
  return {
    cooldown: { check: vi.fn(() => ({ ok: true, retryAfter: 0 })) },
    store: {
      recent: vi.fn(() => []),
      append: vi.fn(),
      trim: vi.fn(),
      purgeChannel: vi.fn(),
    },
    genai: {} as never,
    botMessages: { remember: vi.fn(), has: vi.fn(() => false) },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    model: "m",
    studyMode: { has: vi.fn(() => false), toggle: vi.fn(() => true), off: vi.fn() },
    facts: {
      forChat: vi.fn(() => ({ channel: [], guild: [] })),
      add: vi.fn(),
      list: vi.fn(() => []),
      remove: vi.fn(),
      count: vi.fn(() => 0),
      replaceAuto: vi.fn(),
    },
    ...over,
  };
}

function ctx(over: Partial<Parameters<ReturnType<typeof handleChat>>[0]> = {}) {
  const edit = vi.fn(async () => {});
  return {
    channelId: "c",
    userId: "u",
    displayName: "Dana",
    text: "hello",
    guildId: "g",
    directPing: true,
    sendTyping: vi.fn(async () => {}),
    reply: vi.fn(async () => ({ id: "r1", edit })),
    followUp: vi.fn(async () => ({ id: "r2", edit: vi.fn(async () => {}) })),
    react: vi.fn(async () => {}),
    edit,
    ...over,
  };
}

describe("handleChat", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reacts and does nothing else when a direct ping is on cooldown", async () => {
    const d = deps();
    d.cooldown.check = vi.fn(() => ({ ok: false, retryAfter: 3 }));
    const c = ctx();
    await handleChat(d)(c);
    expect(c.react).toHaveBeenCalledWith("🥱");
    expect(d.cooldown.check).toHaveBeenCalledWith("u", "chat", CHAT_COOLDOWN_MS);
    expect(generateReplyStream).not.toHaveBeenCalled();
    expect(c.reply).not.toHaveBeenCalled();
  });

  it("uses the longer name-trigger cooldown and stays silent (no 🥱) when it's a name-only hit", async () => {
    const d = deps();
    d.cooldown.check = vi.fn(() => ({ ok: false, retryAfter: 20 }));
    const c = ctx({ directPing: false });
    await handleChat(d)(c);
    expect(d.cooldown.check).toHaveBeenCalledWith("u", "chat-name", NAME_TRIGGER_COOLDOWN_MS);
    expect(c.react).not.toHaveBeenCalled();
    expect(generateReplyStream).not.toHaveBeenCalled();
  });

  it("posts the first delta, edits to the full text, and persists both turns", async () => {
    (generateReplyStream as any).mockReturnValue(streamOf(["ku", "musta"]));
    const d = deps();
    const c = ctx();
    await handleChat(d)(c);
    expect(d.store.recent).toHaveBeenCalledWith("c", 16);
    expect(c.reply).toHaveBeenCalledWith("ku");
    expect(c.edit).toHaveBeenLastCalledWith("kumusta");
    expect(d.botMessages.remember).toHaveBeenCalledWith("r1");
    expect(d.store.append).toHaveBeenNthCalledWith(1, "c", "user", "Dana: hello");
    expect(d.store.append).toHaveBeenNthCalledWith(2, "c", "model", "kumusta");
    expect(d.store.trim).toHaveBeenCalledWith("c", 30);
  });

  it("re-arms the typing indicator while the reply is still generating", async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      async function* slow(): AsyncGenerator<string> {
        await gate;
        yield "sup";
      }
      (generateReplyStream as any).mockReturnValue(slow());
      const d = deps();
      const c = ctx();
      const p = handleChat(d)(c);
      await vi.advanceTimersByTimeAsync(TYPING_KEEPALIVE_MS * 2 + 100);
      expect((c.sendTyping as any).mock.calls.length).toBeGreaterThanOrEqual(3);
      release();
      await p;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not persist when the stream yields nothing", async () => {
    (generateReplyStream as any).mockReturnValue(streamOf([]));
    const d = deps();
    const c = ctx();
    await handleChat(d)(c);
    expect(c.reply).toHaveBeenCalledTimes(1);
    expect(d.store.append).not.toHaveBeenCalled();
    expect(d.store.trim).not.toHaveBeenCalled();
  });

  it("sends an in-character line and does not persist on a pre-stream RateLimitError", async () => {
    (generateReplyStream as any).mockReturnValue(streamThrow(new RateLimitError()));
    const d = deps();
    const c = ctx();
    await handleChat(d)(c);
    expect(c.reply).toHaveBeenCalledTimes(1);
    expect(d.store.append).not.toHaveBeenCalled();
  });

  it("sends an in-character line and does not persist on a pre-stream AiUnavailableError", async () => {
    (generateReplyStream as any).mockReturnValue(
      streamThrow(new AiUnavailableError()),
    );
    const d = deps();
    const c = ctx();
    await handleChat(d)(c);
    expect(c.reply).toHaveBeenCalledTimes(1);
    expect(d.store.append).not.toHaveBeenCalled();
  });

  it("sends a distinct setup line and does not persist on a pre-stream AiClientError", async () => {
    (generateReplyStream as any).mockReturnValue(
      streamThrow(new AiClientError("404 model gone")),
    );
    const d = deps();
    const c = ctx();
    await handleChat(d)(c);
    expect(c.reply).toHaveBeenCalledTimes(1);
    expect(c.reply).toHaveBeenCalledWith(expect.stringContaining("setup"));
    expect(d.store.append).not.toHaveBeenCalled();
    expect(d.logger.error).toHaveBeenCalled();
  });

  it("sends a crash line and does not reject on a generic pre-stream error", async () => {
    (generateReplyStream as any).mockReturnValue(streamThrow(new Error("boom")));
    const d = deps();
    const c = ctx();
    await expect(handleChat(d)(c)).resolves.toBeUndefined();
    expect(c.reply).toHaveBeenCalledTimes(1);
    expect(d.store.append).not.toHaveBeenCalled();
  });

  it("logs a caught Error with its stack in the meta", async () => {
    (generateReplyStream as any).mockReturnValue(streamThrow(new Error("boom")));
    const d = deps();
    const c = ctx();
    await handleChat(d)(c);
    expect(d.logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        message: "boom",
        stack: expect.any(String),
      }),
    );
  });

  it("keeps and persists the partial text when the stream fails mid-reply", async () => {
    (generateReplyStream as any).mockReturnValue(
      streamThenThrow(["kal", "ahati"], new AiUnavailableError()),
    );
    const d = deps();
    const c = ctx();
    await handleChat(d)(c);
    expect(c.reply).toHaveBeenCalledWith("kal");
    expect(c.edit).toHaveBeenLastCalledWith("kalahati");
    expect(d.store.append).toHaveBeenNthCalledWith(2, "c", "model", "kalahati");
    expect(d.logger.warn).toHaveBeenCalled();
  });

  it("passes studyMode: true to the stream when the channel is in study mode", async () => {
    (generateReplyStream as any).mockReturnValue(streamOf(["sup"]));
    const d = deps();
    (d.studyMode.has as any).mockReturnValue(true);
    const c = ctx();
    await handleChat(d)(c);
    expect(d.studyMode.has).toHaveBeenCalledWith("c");
    expect((generateReplyStream as any).mock.calls[0][1].studyMode).toBe(true);
  });

  it("passes studyMode: false when the channel is not in study mode", async () => {
    (generateReplyStream as any).mockReturnValue(streamOf(["sup"]));
    const d = deps();
    const c = ctx();
    await handleChat(d)(c);
    expect((generateReplyStream as any).mock.calls[0][1].studyMode).toBe(false);
  });

  it("loads saved facts, user notes first then capped auto notes, and passes them to the stream", async () => {
    (generateReplyStream as any).mockReturnValue(streamOf(["sup"]));
    const d = deps();
    (d.facts.forChat as any).mockReturnValue({
      channel: [
        { content: "auto A", source: "auto" },
        { content: "Eli hates cilantro", source: "user" },
        { content: "auto B", source: "auto" },
      ],
      guild: [{ content: "timezone is PHT", source: "user" }],
    });
    const c = ctx();
    await handleChat(d)(c);
    expect(d.facts.forChat).toHaveBeenCalledWith("c", "g");
    expect((generateReplyStream as any).mock.calls[0][1].facts).toEqual({
      channel: ["Eli hates cilantro", "auto A", "auto B"],
      guild: ["timezone is PHT"],
    });
  });

  it("caps injected auto notes at MAX_AUTO_FACTS", async () => {
    (generateReplyStream as any).mockReturnValue(streamOf(["sup"]));
    const d = deps();
    (d.facts.forChat as any).mockReturnValue({
      channel: Array.from({ length: MAX_AUTO_FACTS + 4 }, (_, i) => ({
        content: `auto ${i}`,
        source: "auto",
      })),
      guild: [],
    });
    await handleChat(d)(ctx());
    expect((generateReplyStream as any).mock.calls[0][1].facts.channel.length).toBe(
      MAX_AUTO_FACTS,
    );
  });

  it("forwards ctx.image to the stream and marks the persisted turn", async () => {
    (generateReplyStream as any).mockReturnValue(streamOf(["sup"]));
    const d = deps();
    const c = ctx({ image: { data: "B64", mimeType: "image/png" } });
    await handleChat(d)(c);
    const params = (generateReplyStream as any).mock.calls[0][1];
    expect(params.image).toEqual({ data: "B64", mimeType: "image/png" });
    expect(params.userTurn).toBe("Dana: [nagpadala ng litrato] hello");
    expect(d.store.append).toHaveBeenNthCalledWith(
      1,
      "c",
      "user",
      "Dana: [nagpadala ng litrato] hello",
    );
  });

  it("marks an image-only turn (no caption) without a trailing space", async () => {
    (generateReplyStream as any).mockReturnValue(streamOf(["sup"]));
    const d = deps();
    const c = ctx({ text: "", image: { data: "B64", mimeType: "image/png" } });
    await handleChat(d)(c);
    expect((generateReplyStream as any).mock.calls[0][1].userTurn).toBe(
      "Dana: [nagpadala ng litrato]",
    );
  });

  it("does not mark the turn or pass an image when ctx.image is absent", async () => {
    (generateReplyStream as any).mockReturnValue(streamOf(["sup"]));
    const d = deps();
    const c = ctx();
    await handleChat(d)(c);
    const params = (generateReplyStream as any).mock.calls[0][1];
    expect(params.image).toBeUndefined();
    expect(params.userTurn).toBe("Dana: hello");
  });

  it("labels the owner's turn with [boss] in the AI call and the persisted history", async () => {
    (generateReplyStream as any).mockReturnValue(streamOf(["yo"]));
    const d = deps();
    await handleChat(d)(ctx({ isOwner: true }));
    expect((generateReplyStream as any).mock.calls[0][1].userTurn).toBe(
      "Dana [boss]: hello",
    );
    expect(d.store.append).toHaveBeenNthCalledWith(
      1,
      "c",
      "user",
      "Dana [boss]: hello",
    );
  });

  it("keeps a plain name label when the speaker is not the owner", async () => {
    (generateReplyStream as any).mockReturnValue(streamOf(["yo"]));
    const d = deps();
    await handleChat(d)(ctx({ isOwner: false }));
    expect((generateReplyStream as any).mock.calls[0][1].userTurn).toBe(
      "Dana: hello",
    );
  });

  it("collapses blank lines in a non-study reply before sending and persisting", async () => {
    (generateReplyStream as any).mockReturnValue(
      streamOf(["sagot una\n\nsagot dalawa"]),
    );
    const d = deps();
    const c = ctx();
    await handleChat(d)(c);
    expect(c.edit).toHaveBeenLastCalledWith("sagot una\nsagot dalawa");
    expect(d.store.append).toHaveBeenNthCalledWith(
      2,
      "c",
      "model",
      "sagot una\nsagot dalawa",
    );
  });

  it("keeps blank lines when the channel is in study mode", async () => {
    (generateReplyStream as any).mockReturnValue(streamOf(["para 1\n\npara 2"]));
    const d = deps();
    d.studyMode.has = vi.fn(() => true);
    await handleChat(d)(ctx());
    expect(d.store.append).toHaveBeenNthCalledWith(
      2,
      "c",
      "model",
      "para 1\n\npara 2",
    );
  });

  it("clamps oversized inbound text before the AI call and before persisting", async () => {
    (generateReplyStream as any).mockReturnValue(streamOf(["sup"]));
    const d = deps();
    const c = ctx({ text: "x".repeat(5000) });
    await handleChat(d)(c);
    const prefixLen = "Dana: ".length;
    const cap = MAX_CHAT_INPUT_CHARS + prefixLen;
    const sentTurn = (generateReplyStream as any).mock.calls[0][1]
      .userTurn as string;
    expect(sentTurn.length).toBeLessThanOrEqual(cap);
    const appended = (d.store.append as any).mock.calls.find(
      (call: unknown[]) => call[1] === "user",
    )!;
    expect((appended[2] as string).length).toBeLessThanOrEqual(cap);
  });
});
