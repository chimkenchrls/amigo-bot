import { describe, it, expect, vi } from "vitest";
import type { ChatContext } from "../../src/chat/handler.js";
import { onMessageCreate } from "../../src/events/messageCreate.js";

vi.mock("../../src/chat/handler.js", async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, handleChat: vi.fn(() => vi.fn(async () => {})) };
});
import { handleChat } from "../../src/chat/handler.js";

function baseDeps() {
  return {
    cooldown: { check: vi.fn(() => ({ ok: true, retryAfter: 0 })) },
    store: { recent: vi.fn(() => []), append: vi.fn(), trim: vi.fn(), purgeChannel: vi.fn() },
    genai: {} as never,
    botMessages: { remember: vi.fn(), has: vi.fn(() => false) },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    model: "m",
    getBotUserId: () => "BOT",
    registry: {
      has: vi.fn(() => false),
      get: vi.fn(() => undefined),
      set: vi.fn(),
      remove: vi.fn(),
      abortAll: vi.fn(async () => {}),
      size: vi.fn(() => 0),
    },
  };
}

function msg(over: Record<string, unknown> = {}) {
  return {
    author: { bot: false, id: "u1" },
    system: false,
    content: "<@BOT> hey",
    mentions: { users: new Map() },
    reference: null,
    guildId: "g",
    channelId: "c",
    member: { displayName: "Dana" },
    channel: { sendTyping: vi.fn(async () => {}) },
    reply: vi.fn(async () => ({ id: "x" })),
    ...over,
  };
}

describe("onMessageCreate", () => {
  it("invokes the chat handler for a mention", async () => {
    const inner = vi.fn(async (_ctx: ChatContext) => {});
    (handleChat as any).mockReturnValue(inner);
    const m = msg({ mentions: { users: new Map([["BOT", {}]]) } });
    await onMessageCreate(baseDeps())(m as never);
    expect(inner).toHaveBeenCalledOnce();
    const ctx = inner.mock.calls[0]![0];
    expect(ctx.text).toBe("hey");
    expect(ctx.displayName).toBe("Dana");
    expect(ctx.channelId).toBe("c");
  });

  it("does nothing for a message that neither mentions nor replies to the bot", async () => {
    const inner = vi.fn(async (_ctx: ChatContext) => {});
    (handleChat as any).mockReturnValue(inner);
    const m = msg({ content: "just talking", mentions: { users: new Map() } });
    await onMessageCreate(baseDeps())(m as never);
    expect(inner).not.toHaveBeenCalled();
  });

  it("ignores bot authors", async () => {
    const inner = vi.fn(async (_ctx: ChatContext) => {});
    (handleChat as any).mockReturnValue(inner);
    const m = msg({ author: { bot: true, id: "u1" }, mentions: { users: new Map([["BOT", {}]]) } });
    await onMessageCreate(baseDeps())(m as never);
    expect(inner).not.toHaveBeenCalled();
  });

  it("returns early when the bot user id is not yet known", async () => {
    const inner = vi.fn(async (_ctx: ChatContext) => {});
    (handleChat as any).mockReturnValue(inner);
    const deps = { ...baseDeps(), getBotUserId: () => "" };
    const m = msg({ mentions: { users: new Map([["BOT", {}]]) } });
    await onMessageCreate(deps)(m as never);
    expect(inner).not.toHaveBeenCalled();
  });

  it("skips the reply-chain fetch for a bot-authored message with a reference", async () => {
    const inner = vi.fn(async (_ctx: ChatContext) => {});
    (handleChat as any).mockReturnValue(inner);
    const fetch = vi.fn(async () => ({ author: { id: "BOT" } }));
    const m = msg({
      author: { bot: true, id: "u1" },
      mentions: { users: new Map() },
      reference: { messageId: "ref1" },
      channel: { sendTyping: vi.fn(async () => {}), messages: { fetch } },
    });
    await onMessageCreate(baseDeps())(m as never);
    expect(inner).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips the reply-chain fetch when the message already @mentions the bot", async () => {
    const inner = vi.fn(async (_ctx: ChatContext) => {});
    (handleChat as any).mockReturnValue(inner);
    const fetch = vi.fn(async () => ({ author: { id: "someone" } }));
    const m = msg({
      content: "<@BOT> and a reply",
      mentions: { users: new Map([["BOT", {}]]) },
      reference: { messageId: "ref1" },
      channel: { sendTyping: vi.fn(async () => {}), messages: { fetch } },
    });
    await onMessageCreate(baseDeps())(m as never);
    expect(inner).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("responds to a reply whose referenced id is in the bot-message cache", async () => {
    const inner = vi.fn(async (_ctx: ChatContext) => {});
    (handleChat as any).mockReturnValue(inner);
    const deps = {
      ...baseDeps(),
      botMessages: { remember: vi.fn(), has: vi.fn(() => true) },
    };
    const m = msg({
      content: "still there?",
      mentions: { users: new Map() },
      reference: { messageId: "ref1" },
    });
    await onMessageCreate(deps)(m as never);
    expect(inner).toHaveBeenCalledOnce();
    expect(inner.mock.calls[0]![0].text).toBe("still there?");
  });

  it("hands the handler a reply() whose result can be edited in place", async () => {
    const inner = vi.fn(async (_ctx: ChatContext) => {});
    (handleChat as any).mockReturnValue(inner);
    const sentEdit = vi.fn(async () => {});
    const m = msg({
      mentions: { users: new Map([["BOT", {}]]) },
      reply: vi.fn(async () => ({ id: "m1", edit: sentEdit })),
    });
    await onMessageCreate(baseDeps())(m as never);
    const passedCtx = inner.mock.calls[0]![0];
    const handle = await passedCtx.reply("hoy");
    expect(handle.id).toBe("m1");
    await handle.edit("hoy, edited");
    expect(sentEdit).toHaveBeenCalledWith("hoy, edited");
  });

  it("does not invoke the chat handler when a game is active in the channel", async () => {
    const inner = vi.fn(async () => {});
    (handleChat as any).mockReturnValue(inner);
    const deps = {
      ...baseDeps(),
      registry: {
        has: vi.fn(() => true),
        get: vi.fn(() => undefined),
        set: vi.fn(),
        remove: vi.fn(),
        abortAll: vi.fn(async () => {}),
        size: vi.fn(() => 0),
      },
    };
    const m = msg({ mentions: { users: new Map([["BOT", {}]]) } });
    await onMessageCreate(deps as never)(m as never);
    expect(inner).not.toHaveBeenCalled();
  });

  it("invokes the chat handler normally when no game is active", async () => {
    const inner = vi.fn(async () => {});
    (handleChat as any).mockReturnValue(inner);
    const deps = {
      ...baseDeps(),
      registry: {
        has: vi.fn(() => false),
        get: vi.fn(() => undefined),
        set: vi.fn(),
        remove: vi.fn(),
        abortAll: vi.fn(async () => {}),
        size: vi.fn(() => 0),
      },
    };
    const m = msg({ mentions: { users: new Map([["BOT", {}]]) } });
    await onMessageCreate(deps as never)(m as never);
    expect(inner).toHaveBeenCalledOnce();
  });
});
