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

  it("aborts the freshly built session if another game claimed the channel during setup", async () => {
    const has = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const c = ctx({ registry: { has, set: vi.fn(), get: vi.fn(), remove: vi.fn() } });
    const i = interaction();
    await werewolfCommand.execute(i as never, c as never);
    expect(c.registry.set).not.toHaveBeenCalled();
    // the message the session posted during createGameSession gets an abort notice
    const sent = (i.channel.send as ReturnType<typeof vi.fn>).mock.calls;
    expect(JSON.stringify(sent)).toMatch(/nauna ang ibang laro/);
  });

  it("does not consume the cooldown when the channel is unusable or occupied", async () => {
    const c1 = ctx();
    await werewolfCommand.execute(interaction({ channel: null }) as never, c1 as never);
    expect(c1.cooldown.check).not.toHaveBeenCalled();

    const c2 = ctx({ registry: { has: vi.fn(() => true), set: vi.fn(), get: vi.fn(), remove: vi.fn() } });
    await werewolfCommand.execute(interaction() as never, c2 as never);
    expect(c2.cooldown.check).not.toHaveBeenCalled();
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
