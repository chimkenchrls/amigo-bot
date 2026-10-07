import { describe, it, expect, vi } from "vitest";
import type { ChatContext } from "../../src/chat/handler.js";
import { onMessageCreate } from "../../src/events/messageCreate.js";

vi.mock("../../src/chat/handler.js", async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, handleChat: vi.fn(() => vi.fn(async () => {})) };
});
import { handleChat } from "../../src/chat/handler.js";

vi.mock("../../src/lib/image.js", async (orig) => {
  const actual = (await orig()) as object;
  return {
    ...actual,
    fetchImageAsBase64: vi.fn(async () => ({ data: "B64", mimeType: "image/png" })),
  };
});
import { fetchImageAsBase64 } from "../../src/lib/image.js";

const imageAttachment = (over: Record<string, unknown> = {}) => ({
  contentType: "image/png",
  size: 1000,
  url: "https://cdn/pic.png",
  ...over,
});

function baseDeps() {
  return {
    cooldown: { check: vi.fn(() => ({ ok: true, retryAfter: 0 })) },
    store: { recent: vi.fn(() => []), append: vi.fn(), trim: vi.fn(), purgeChannel: vi.fn() },
    genai: {} as never,
    botMessages: { remember: vi.fn(), has: vi.fn(() => false) },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    model: "m",
    getBotUserId: () => "BOT",
    studyMode: { has: vi.fn(() => false), toggle: vi.fn(() => true), off: vi.fn() },
    facts: { forChat: vi.fn(() => ({ channel: [], guild: [] })), add: vi.fn(() => null), list: vi.fn(() => []), remove: vi.fn(() => false), count: vi.fn(() => 0), replaceAuto: vi.fn() },
    autoMemory: { note: vi.fn(), start: vi.fn(), stop: vi.fn(), tick: vi.fn(async () => {}) },
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

  it("invokes the chat handler when the message just says the name, no @mention", async () => {
    const inner = vi.fn(async (_ctx: ChatContext) => {});
    (handleChat as any).mockReturnValue(inner);
    const fetch = vi.fn();
    const m = msg({
      content: "amigo you around?",
      mentions: { users: new Map() },
      reference: { messageId: "ref1" },
      channel: { sendTyping: vi.fn(async () => {}), messages: { fetch } },
    });
    await onMessageCreate(baseDeps())(m as never);
    expect(inner).toHaveBeenCalledOnce();
    expect(inner.mock.calls[0]![0].text).toBe("amigo you around?");
    expect(inner.mock.calls[0]![0].directPing).toBe(false);
    expect(fetch).not.toHaveBeenCalled(); // name trigger skips the reply-chain fetch
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

  it("records channel activity for a human message even when a game is running", async () => {
    const deps = baseDeps();
    (deps.registry.has as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const m = msg({ content: "just chatting" });
    await onMessageCreate(deps as never)(m as never);
    expect(deps.autoMemory.note).toHaveBeenCalledWith("c");
  });

  it("does not record activity for a bot message", async () => {
    const deps = baseDeps();
    const m = msg({ author: { bot: true, id: "u1" } });
    await onMessageCreate(deps as never)(m as never);
    expect(deps.autoMemory.note).not.toHaveBeenCalled();
  });

  it("fetches the first valid image attachment and passes it on the ctx", async () => {
    const inner = vi.fn(async (_ctx: ChatContext) => {});
    (handleChat as any).mockReturnValue(inner);
    (fetchImageAsBase64 as any).mockResolvedValueOnce({
      data: "B64",
      mimeType: "image/png",
    });
    const m = msg({
      mentions: { users: new Map([["BOT", {}]]) },
      attachments: new Map([["a1", imageAttachment()]]),
    });
    await onMessageCreate(baseDeps())(m as never);
    expect(fetchImageAsBase64).toHaveBeenCalledWith("https://cdn/pic.png", "image/png");
    expect(inner.mock.calls[0]![0].image).toEqual({ data: "B64", mimeType: "image/png" });
  });

  it("ignores a non-image attachment and still replies text-only", async () => {
    const inner = vi.fn(async (_ctx: ChatContext) => {});
    (handleChat as any).mockReturnValue(inner);
    const m = msg({
      mentions: { users: new Map([["BOT", {}]]) },
      attachments: new Map([
        ["a1", imageAttachment({ contentType: "application/pdf" })],
      ]),
    });
    await onMessageCreate(baseDeps())(m as never);
    expect(fetchImageAsBase64).not.toHaveBeenCalled();
    expect(inner).toHaveBeenCalledOnce();
    expect(inner.mock.calls[0]![0].image).toBeUndefined();
  });

  it("ignores an oversized image attachment", async () => {
    const inner = vi.fn(async (_ctx: ChatContext) => {});
    (handleChat as any).mockReturnValue(inner);
    const m = msg({
      mentions: { users: new Map([["BOT", {}]]) },
      attachments: new Map([
        ["a1", imageAttachment({ size: 99 * 1024 * 1024 })],
      ]),
    });
    await onMessageCreate(baseDeps())(m as never);
    expect(fetchImageAsBase64).not.toHaveBeenCalled();
    expect(inner.mock.calls[0]![0].image).toBeUndefined();
  });

  it("falls back to text-only and warns when the image fetch fails", async () => {
    const inner = vi.fn(async (_ctx: ChatContext) => {});
    (handleChat as any).mockReturnValue(inner);
    (fetchImageAsBase64 as any).mockRejectedValueOnce(new Error("boom"));
    const deps = baseDeps();
    const m = msg({
      mentions: { users: new Map([["BOT", {}]]) },
      attachments: new Map([["a1", imageAttachment()]]),
    });
    await onMessageCreate(deps)(m as never);
    expect(inner).toHaveBeenCalledOnce();
    expect(inner.mock.calls[0]![0].image).toBeUndefined();
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it("uses only the first valid image when several are attached", async () => {
    const inner = vi.fn(async (_ctx: ChatContext) => {});
    (handleChat as any).mockReturnValue(inner);
    const m = msg({
      mentions: { users: new Map([["BOT", {}]]) },
      attachments: new Map([
        ["a1", imageAttachment({ url: "https://cdn/first.png" })],
        ["a2", imageAttachment({ url: "https://cdn/second.png" })],
      ]),
    });
    await onMessageCreate(baseDeps())(m as never);
    expect(fetchImageAsBase64).toHaveBeenCalledTimes(1);
    expect(fetchImageAsBase64).toHaveBeenCalledWith("https://cdn/first.png", "image/png");
  });

  it("marks ctx.isOwner true when the author id matches the configured ownerId", async () => {
    const inner = vi.fn(async (_ctx: ChatContext) => {});
    (handleChat as any).mockReturnValue(inner);
    const deps = { ...baseDeps(), ownerId: "u1" };
    const m = msg({ mentions: { users: new Map([["BOT", {}]]) } });
    await onMessageCreate(deps)(m as never);
    expect(inner.mock.calls[0]![0].isOwner).toBe(true);
  });

  it("marks ctx.isOwner false for a non-owner author", async () => {
    const inner = vi.fn(async (_ctx: ChatContext) => {});
    (handleChat as any).mockReturnValue(inner);
    const deps = { ...baseDeps(), ownerId: "someone-else" };
    const m = msg({ mentions: { users: new Map([["BOT", {}]]) } });
    await onMessageCreate(deps)(m as never);
    expect(inner.mock.calls[0]![0].isOwner).toBe(false);
  });

  it("marks ctx.isOwner false when no ownerId is configured", async () => {
    const inner = vi.fn(async (_ctx: ChatContext) => {});
    (handleChat as any).mockReturnValue(inner);
    const m = msg({ mentions: { users: new Map([["BOT", {}]]) } });
    await onMessageCreate(baseDeps())(m as never);
    expect(inner.mock.calls[0]![0].isOwner).toBe(false);
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
