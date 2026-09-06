import { describe, it, expect, vi } from "vitest";
import { rememberCommand } from "../../src/commands/remember.js";
import { MAX_FACT_CHARS } from "../../src/constants.js";

function ctx(over: Record<string, unknown> = {}) {
  return {
    facts: {
      add: vi.fn(() => ({ id: 1, scope: "channel", scopeId: "c1", content: "x", createdBy: "u1", createdAt: 0 })),
      list: vi.fn(() => []),
      forChat: vi.fn(),
      remove: vi.fn(),
      count: vi.fn(() => 0),
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...over,
  };
}
function interaction(opts: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return {
    channelId: "c1",
    guildId: "g1",
    user: { id: "u1" },
    options: {
      getString: (n: string, _req?: boolean) => (opts[n] as string) ?? null,
      getBoolean: (n: string) => (opts[n] as boolean) ?? null,
    },
    reply: vi.fn(async () => {}),
    ...over,
  };
}

describe("/remember", () => {
  it("is guild-only", () => {
    expect((rememberCommand.data.toJSON() as { dm_permission?: boolean }).dm_permission).toBe(false);
  });

  it("saves a channel fact and confirms publicly", async () => {
    const c = ctx();
    const i = interaction({ text: "Dana is studying for the bar" });
    await rememberCommand.execute(i as never, c as never);
    expect(c.facts.add).toHaveBeenCalledWith(
      "channel",
      "c1",
      "Dana is studying for the bar",
      "u1",
    );
    const arg = (i.reply as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.flags).toBeUndefined(); // public
  });

  it("saves a server-wide fact when server:true", async () => {
    const c = ctx();
    const i = interaction({ text: "timezone is PHT", server: true });
    await rememberCommand.execute(i as never, c as never);
    expect(c.facts.add).toHaveBeenCalledWith("guild", "g1", "timezone is PHT", "u1");
  });

  it("rejects blank and over-long text without touching the store", async () => {
    const c = ctx();
    await rememberCommand.execute(interaction({ text: "   " }) as never, c as never);
    await rememberCommand.execute(
      interaction({ text: "x".repeat(MAX_FACT_CHARS + 1) }) as never,
      c as never,
    );
    expect(c.facts.add).not.toHaveBeenCalled();
  });

  it("tells the user when the scope is full", async () => {
    const c = ctx({ facts: { add: vi.fn(() => null), list: vi.fn(), forChat: vi.fn(), remove: vi.fn(), count: vi.fn() } });
    const i = interaction({ text: "one more" });
    await rememberCommand.execute(i as never, c as never);
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("puno") }),
    );
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("notes mo") }),
    );
  });
});
