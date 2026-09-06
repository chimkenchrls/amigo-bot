import { describe, it, expect, vi } from "vitest";
import { factsCommand } from "../../src/commands/facts.js";

const fact = (id: number, content: string, source: "user" | "auto" = "user") => ({
  id,
  scope: "channel" as const,
  scopeId: "c1",
  content,
  source,
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
      count: vi.fn(() => 0),
      replaceAuto: vi.fn(),
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

  it("tags auto-picked-up notes in the listing", async () => {
    const c = ctx([fact(3, "movie night is Fridays", "user"), fact(7, "Dana's taking the bar", "auto")]);
    const i = interaction();
    await factsCommand.execute(i as never, c as never);
    const body = (i.reply as ReturnType<typeof vi.fn>).mock.calls[0]![0].content;
    expect(body).toContain("1. movie night is Fridays");
    expect(body).toContain("2. Dana's taking the bar  ·picked up");
  });

  it("wipe:true clears only the auto notes", async () => {
    const c = ctx([fact(3, "user note", "user"), fact(7, "auto note", "auto")]);
    (c.facts.count as ReturnType<typeof vi.fn>).mockReturnValue(1);
    const i = interaction({ wipe: true });
    await factsCommand.execute(i as never, c as never);
    expect(c.facts.replaceAuto).toHaveBeenCalledWith("channel", "c1", []);
    expect(c.facts.remove).not.toHaveBeenCalled();
    const msg = (i.reply as ReturnType<typeof vi.fn>).mock.calls[0]![0].content;
    expect(msg).toContain("binura ko");
    expect(msg).toContain("mapulot ko ulit");
    expect(msg).toContain("/forget");
  });

  it("wipe:true with no auto notes reports nothing to wipe", async () => {
    const c = ctx([fact(3, "user note", "user")]);
    (c.facts.count as ReturnType<typeof vi.fn>).mockReturnValue(0);
    const i = interaction({ wipe: true });
    await factsCommand.execute(i as never, c as never);
    expect(c.facts.replaceAuto).not.toHaveBeenCalled();
    const msg = (i.reply as ReturnType<typeof vi.fn>).mock.calls[0]![0].content;
    expect(msg).toContain("buburahin");
    expect(msg).not.toContain("bubura-hin");
  });

  it("the listing footer points at both forget and wipe", async () => {
    const c = ctx([fact(3, "movie night", "user"), fact(7, "auto note", "auto")]);
    const i = interaction();
    await factsCommand.execute(i as never, c as never);
    const body = (i.reply as ReturnType<typeof vi.fn>).mock.calls[0]![0].content;
    expect(body).toContain("/facts forget:<number>");
    expect(body).toContain("/facts wipe:true");
  });

  it("forget wins when combined with wipe", async () => {
    const c = ctx([fact(3, "a", "user"), fact(7, "b", "auto")]);
    await factsCommand.execute(interaction({ forget: 2, wipe: true }) as never, c as never);
    expect(c.facts.remove).toHaveBeenCalledWith(7);
    expect(c.facts.replaceAuto).not.toHaveBeenCalled();
  });
});
