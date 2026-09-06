import { describe, it, expect, vi } from "vitest";
import { studyCommand } from "../../src/commands/study.js";

function ctx(over: Record<string, unknown> = {}) {
  return {
    registry: { has: vi.fn(() => false) },
    studyMode: { has: vi.fn(() => false), toggle: vi.fn(() => true), off: vi.fn() },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...over,
  };
}
const interaction = (over: Record<string, unknown> = {}) => ({
  channelId: "c1",
  reply: vi.fn(async () => {}),
  ...over,
});

describe("/study", () => {
  it("is guild-only", () => {
    expect((studyCommand.data.toJSON() as { dm_permission?: boolean }).dm_permission).toBe(false);
  });

  it("toggles study mode on and announces it in the channel (not ephemeral)", async () => {
    const c = ctx();
    const i = interaction();
    await studyCommand.execute(i as never, c as never);
    expect(c.studyMode.toggle).toHaveBeenCalledWith("c1");
    const arg = (i.reply as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      content: string;
      flags?: number;
    };
    expect(arg.content).toMatch(/study mode on/i);
    expect(arg.flags).toBeUndefined();
  });

  it("announces off when toggled off", async () => {
    const c = ctx({
      studyMode: { has: vi.fn(), toggle: vi.fn(() => false), off: vi.fn() },
    });
    const i = interaction();
    await studyCommand.execute(i as never, c as never);
    expect((i.reply as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      content: expect.stringMatching(/study mode off/i),
    });
  });

  it("refuses (and does not toggle) while a game is running in the channel", async () => {
    const c = ctx({ registry: { has: vi.fn(() => true) } });
    const i = interaction();
    await studyCommand.execute(i as never, c as never);
    expect(c.studyMode.toggle).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: expect.any(Number) }),
    );
  });
});
