import { describe, it, expect, vi } from "vitest";
import { handleChat } from "../../src/chat/handler.js";
import { MAX_CHAT_INPUT_CHARS } from "../../src/constants.js";
import { RateLimitError, AiUnavailableError } from "../../src/ai/errors.js";

vi.mock("../../src/ai/conversation.js", async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, generateReply: vi.fn() };
});
import { generateReply } from "../../src/ai/conversation.js";

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
    ...over,
  };
}

function ctx(over: Partial<Parameters<ReturnType<typeof handleChat>>[0]> = {}) {
  return {
    channelId: "c",
    userId: "u",
    displayName: "Dana",
    text: "hello",
    guildId: "g",
    sendTyping: vi.fn(async () => {}),
    reply: vi.fn(async () => ({ id: "r1" })),
    followUp: vi.fn(async () => ({ id: "r2" })),
    react: vi.fn(async () => {}),
    ...over,
  };
}

describe("handleChat", () => {
  it("reacts and does nothing else when on cooldown", async () => {
    const d = deps();
    d.cooldown.check = vi.fn(() => ({ ok: false, retryAfter: 3 }));
    const c = ctx();
    await handleChat(d)(c);
    expect(c.react).toHaveBeenCalledWith("🥱");
    expect(generateReply).not.toHaveBeenCalled();
    expect(c.reply).not.toHaveBeenCalled();
  });

  it("loads history, replies, and persists both turns on success", async () => {
    (generateReply as any).mockResolvedValue({ ok: true, text: "sup" });
    const d = deps();
    const c = ctx();
    await handleChat(d)(c);
    expect(d.store.recent).toHaveBeenCalledWith("c", 16);
    expect(c.reply).toHaveBeenCalledWith("sup");
    expect(d.store.append).toHaveBeenNthCalledWith(1, "c", "user", "Dana: hello");
    expect(d.store.append).toHaveBeenNthCalledWith(2, "c", "model", "sup");
    expect(d.store.trim).toHaveBeenCalledWith("c", 30);
    expect(d.botMessages.remember).toHaveBeenCalledWith("r1");
  });

  it("does not persist when the model is blocked", async () => {
    (generateReply as any).mockResolvedValue({ ok: false, reason: "blocked" });
    const d = deps();
    const c = ctx();
    await handleChat(d)(c);
    expect(c.reply).toHaveBeenCalledTimes(1);
    expect(d.store.append).not.toHaveBeenCalled();
    expect(d.store.trim).not.toHaveBeenCalled();
  });

  it("sends an in-character line and does not persist on RateLimitError", async () => {
    (generateReply as any).mockRejectedValue(new RateLimitError());
    const d = deps();
    const c = ctx();
    await handleChat(d)(c);
    expect(c.reply).toHaveBeenCalledTimes(1);
    expect(d.store.append).not.toHaveBeenCalled();
  });

  it("sends an in-character line and does not persist on AiUnavailableError", async () => {
    (generateReply as any).mockRejectedValue(new AiUnavailableError());
    const d = deps();
    const c = ctx();
    await handleChat(d)(c);
    expect(c.reply).toHaveBeenCalledTimes(1);
    expect(d.store.append).not.toHaveBeenCalled();
  });

  it("sends a crash line and does not reject on a generic error", async () => {
    (generateReply as any).mockRejectedValue(new Error("boom"));
    const d = deps();
    const c = ctx();
    await expect(handleChat(d)(c)).resolves.toBeUndefined();
    expect(c.reply).toHaveBeenCalledTimes(1);
    expect(d.store.append).not.toHaveBeenCalled();
  });

  it("logs a caught Error with its stack in the meta", async () => {
    (generateReply as any).mockRejectedValue(new Error("boom"));
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

  it("clamps oversized inbound text before the AI call and before persisting", async () => {
    (generateReply as any).mockResolvedValue({ ok: true, text: "sup" });
    const d = deps();
    const c = ctx({ text: "x".repeat(5000) });
    await handleChat(d)(c);
    const prefixLen = "Dana: ".length;
    const cap = MAX_CHAT_INPUT_CHARS + prefixLen;
    const sentTurn = (generateReply as any).mock.calls[0][1].userTurn as string;
    expect(sentTurn.length).toBeLessThanOrEqual(cap);
    const appended = (d.store.append as any).mock.calls.find(
      (call: unknown[]) => call[1] === "user",
    )!;
    expect((appended[2] as string).length).toBeLessThanOrEqual(cap);
  });
});
