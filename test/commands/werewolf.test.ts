import { describe, it, expect, vi } from "vitest";
import { werewolfCommand } from "../../src/commands/werewolf.js";

function ctx(over: Record<string, unknown> = {}) {
  return {
    cooldown: { check: vi.fn(() => ({ ok: true, retryAfter: 0 })) },
    registry: { has: vi.fn(() => false), set: vi.fn(), get: vi.fn(), remove: vi.fn() },
    genai: {} as never,
    model: "m",
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...over,
  };
}
function interaction(over: Record<string, unknown> = {}) {
  return {
    user: { id: "u1" },
    channelId: "c1",
    guildId: "g1",
    member: null,
    channel: { id: "c1", send: vi.fn(async () => ({ id: "m1", edit: vi.fn() })) },
    reply: vi.fn(async () => {}),
    ...over,
  };
}

describe("/werewolf", () => {
  it("is guild-only", () => {
    expect((werewolfCommand.data.toJSON() as { dm_permission?: boolean }).dm_permission).toBe(false);
  });

  it("refuses when a game already exists in the channel", async () => {
    const c = ctx({ registry: { has: vi.fn(() => true), set: vi.fn() } });
    const i = interaction();
    await werewolfCommand.execute(i as never, c as never);
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("laro na dito") }),
    );
    expect((c.registry.set as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("registers a new session and acknowledges", async () => {
    const c = ctx();
    const i = interaction();
    await werewolfCommand.execute(i as never, c as never);
    expect(c.registry.set).toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalled();
  });

  it("respects the per-user cooldown", async () => {
    const c = ctx({ cooldown: { check: vi.fn(() => ({ ok: false, retryAfter: 30 })) } });
    const i = interaction();
    await werewolfCommand.execute(i as never, c as never);
    expect(c.registry.set).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("30") }),
    );
  });
});
