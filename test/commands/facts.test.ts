import { describe, it, expect, vi } from "vitest";
import { factsCommand } from "../../src/commands/facts.js";

const fact = (id: number, content: string) => ({
  id,
  scope: "channel" as const,
  scopeId: "c1",
  content,
  createdBy: "u1",
  createdAt: 0,
});

function ctx(list: ReturnType<typeof fact>[], over: Record<string, unknown> = {}) {
  return {
    facts: {
      list: vi.fn(() => list),
      remove: vi.fn(() => true),
      add: vi.fn(),
      forChat: vi.fn(),
      count: vi.fn(),
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...over,
  };
}
function interaction(opts: Record<string, unknown> = {}) {
  return {
    channelId: "c1",
    guildId: "g1",
    options: {
      getBoolean: (n: string) => (opts[n] as boolean) ?? null,
      getInteger: (n: string) => (opts[n] as number) ?? null,
    },
    reply: vi.fn(async () => {}),
  };
}

describe("/facts", () => {
  it("lists the channel's notes, numbered and ephemeral", async () => {
    const c = ctx([fact(3, "movie night is Fridays"), fact(7, "Eli hates cilantro")]);
    const i = interaction();
    await factsCommand.execute(i as never, c as never);
    expect(c.facts.list).toHaveBeenCalledWith("channel", "c1");
    const arg = (i.reply as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.flags).toBeDefined();
    expect(arg.content).toContain("1. movie night is Fridays");
    expect(arg.content).toContain("2. Eli hates cilantro");
  });

  it("reads the server scope with server:true", async () => {
    const c = ctx([]);
    await factsCommand.execute(interaction({ server: true }) as never, c as never);
    expect(c.facts.list).toHaveBeenCalledWith("guild", "g1");
  });

  it("forget:N removes the Nth listed fact by its id", async () => {
    const c = ctx([fact(3, "a"), fact(7, "b"), fact(9, "c")]);
    await factsCommand.execute(interaction({ forget: 2 }) as never, c as never);
    expect(c.facts.remove).toHaveBeenCalledWith(7);
  });

  it("forget with an out-of-range number removes nothing", async () => {
    const c = ctx([fact(3, "a")]);
    const i = interaction({ forget: 5 });
    await factsCommand.execute(i as never, c as never);
    expect(c.facts.remove).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("5") }),
    );
  });
});
