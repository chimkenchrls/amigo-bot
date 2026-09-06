import { describe, it, expect, vi } from "vitest";
import { forgetCommand } from "../../src/commands/forget.js";

describe("/forget", () => {
  it("is guild-only", () => {
    expect((forgetCommand.data.toJSON() as { dm_permission?: boolean }).dm_permission).toBe(false);
  });

  it("purges the channel's stored history and confirms", async () => {
    const purgeChannel = vi.fn();
    const ctx = {
      store: { append: vi.fn(), recent: vi.fn(() => []), trim: vi.fn(), purgeChannel },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const interaction = { channelId: "c1", user: { id: "u1" }, reply: vi.fn(async () => {}) };
    await forgetCommand.execute(interaction as never, ctx as never);
    expect(purgeChannel).toHaveBeenCalledWith("c1");
    expect(interaction.reply).toHaveBeenCalledTimes(1);
  });
});
