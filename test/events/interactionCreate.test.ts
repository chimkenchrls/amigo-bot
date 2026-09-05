import { describe, it, expect, vi } from "vitest";
import { MessageFlags } from "discord.js";
import { routeInteraction } from "../../src/events/interactionCreate.js";

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function interaction(over: Record<string, unknown> = {}) {
  return {
    isChatInputCommand: () => true,
    commandName: "roast",
    deferred: false,
    replied: false,
    reply: vi.fn(async () => {}),
    editReply: vi.fn(async () => {}),
    ...over,
  };
}

function cmd(execute: () => Promise<void>) {
  return new Map([
    ["roast", { data: { name: "roast", toJSON: () => ({}) }, execute }],
  ]);
}

describe("routeInteraction", () => {
  it("a. runs the matching command once with (interaction, ctx)", async () => {
    const execute = vi.fn(async () => {});
    const ctx = { marker: true } as never;
    const i = interaction();
    await routeInteraction({ commands: cmd(execute), ctx, logger })(i as never);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(i, ctx);
  });

  it("b. replies ephemerally for an unknown command and does not execute", async () => {
    const execute = vi.fn(async () => {});
    const i = interaction({ commandName: "nope" });
    await routeInteraction({
      commands: cmd(execute),
      ctx: {} as never,
      logger,
    })(i as never);
    expect(execute).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.Ephemeral,
        content: expect.stringContaining("i don't know"),
      }),
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it("c. sends an in-character error via editReply when execute throws (deferred)", async () => {
    const execute = vi.fn(async () => {
      throw new Error("boom");
    });
    const i = interaction({ deferred: true });
    await expect(
      routeInteraction({ commands: cmd(execute), ctx: {} as never, logger })(
        i as never,
      ),
    ).resolves.toBeUndefined();
    expect(i.editReply).toHaveBeenCalled();
    expect(i.reply).not.toHaveBeenCalled();
  });

  it("d. replies ephemerally when execute throws and not deferred/replied", async () => {
    const execute = vi.fn(async () => {
      throw new Error("boom");
    });
    const i = interaction();
    await routeInteraction({
      commands: cmd(execute),
      ctx: {} as never,
      logger,
    })(i as never);
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  });

  it("e. ignores non-chat-input interactions", async () => {
    const execute = vi.fn(async () => {});
    const i = interaction({ isChatInputCommand: () => false });
    await routeInteraction({
      commands: cmd(execute),
      ctx: {} as never,
      logger,
    })(i as never);
    expect(i.reply).not.toHaveBeenCalled();
    expect(i.editReply).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
