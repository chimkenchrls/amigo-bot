import { describe, it, expect, vi } from "vitest";
import { routeGameInteraction, encodeId } from "../../src/game/buttons.js";
import { createRegistry } from "../../src/game/registry.js";

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function iact(over: Partial<any> = {}) {
  return {
    customId: encodeId({ verb: "join" }),
    channelId: "c1", userId: "u1", displayName: "Uno",
    reply: vi.fn(async () => {}), deferUpdate: vi.fn(async () => {}), followUp: vi.fn(async () => {}),
    ...over,
  };
}

describe("routeGameInteraction", () => {
  it("ignores a non-wolf customId", async () => {
    const i = iact({ customId: "other:x" });
    await routeGameInteraction(i as any, createRegistry(), logger as any);
    expect(i.reply).not.toHaveBeenCalled();
    expect(i.deferUpdate).not.toHaveBeenCalled();
  });
  it("replies ephemerally when there is no game in the channel", async () => {
    const i = iact();
    await routeGameInteraction(i as any, createRegistry(), logger as any);
    expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("laro") }));
  });
  it("routes join to the channel's session", async () => {
    const r = createRegistry();
    const join = vi.fn(async () => {});
    r.set({ channelId: "c1", abort: vi.fn(async () => {}), join } as any);
    const i = iact();
    await routeGameInteraction(i as any, r, logger as any);
    expect(join).toHaveBeenCalledWith("u1", "Uno");
    expect(i.deferUpdate).toHaveBeenCalled();
  });
  it("surfaces a guard error as an ephemeral follow-up for a deferred verb", async () => {
    const r = createRegistry();
    r.set({ channelId: "c1", abort: vi.fn(async () => {}), start: vi.fn(async () => { throw new Error("kulang pa sa tatlo"); }) } as any);
    const i = iact({ customId: encodeId({ verb: "start" }) });
    await routeGameInteraction(i as any, r, logger as any);
    expect(i.deferUpdate).toHaveBeenCalled();
    expect(i.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("kulang") }));
  });

  it("submits a noop when the act prompt carries no interactive components", async () => {
    const r = createRegistry();
    const act = vi.fn(async () => {});
    const actPrompt = vi.fn(() => ({ content: "matulog ka na", flags: 64 }));
    r.set({ channelId: "c1", abort: vi.fn(async () => {}), act, actPrompt } as any);
    const i = iact({ customId: encodeId({ verb: "act" }) });
    await routeGameInteraction(i as any, r, logger as any);
    expect(act).toHaveBeenCalledWith("u1", { kind: "noop", playerId: "u1" });
    expect(i.deferUpdate).not.toHaveBeenCalled();
  });

  it("does NOT submit a noop when the act prompt has interactive components", async () => {
    const r = createRegistry();
    const act = vi.fn(async () => {});
    const actPrompt = vi.fn(() => ({ content: "pumili", flags: 64, components: [{ x: 1 }] }));
    r.set({ channelId: "c1", abort: vi.fn(async () => {}), act, actPrompt } as any);
    const i = iact({ customId: encodeId({ verb: "act" }) });
    await routeGameInteraction(i as any, r, logger as any);
    expect(act).not.toHaveBeenCalled();
  });
  it("records a seer center peek", async () => {
    const r = createRegistry();
    const act = vi.fn(async () => {});
    r.set({ channelId: "c1", abort: vi.fn(async () => {}), act } as any);
    const i = iact({ customId: encodeId({ verb: "seer", mode: "center" }) });
    await routeGameInteraction(i as any, r, logger as any);
    expect(act).toHaveBeenCalledWith("u1", { kind: "seer-center", playerId: "u1", centers: [0, 1] });
    expect(i.deferUpdate).toHaveBeenCalled();
  });
  it("routes a rob select to session.act with the chosen target", async () => {
    const r = createRegistry();
    const act = vi.fn(async () => {});
    r.set({ channelId: "c1", abort: vi.fn(async () => {}), act } as any);
    const i = iact({ customId: encodeId({ verb: "rob" }), values: ["p2"] });
    await routeGameInteraction(i as any, r, logger as any);
    expect(act).toHaveBeenCalledWith("u1", { kind: "robber", playerId: "u1", target: "p2" });
  });
  it("routes a vote select to session.vote", async () => {
    const r = createRegistry();
    const vote = vi.fn(async () => {});
    r.set({ channelId: "c1", abort: vi.fn(async () => {}), vote } as any);
    const i = iact({ customId: encodeId({ verb: "vote" }), values: ["p3"] });
    await routeGameInteraction(i as any, r, logger as any);
    expect(vote).toHaveBeenCalledWith("u1", "p3");
  });
  it("rejects a troublemaker pick with fewer than 2 targets", async () => {
    const r = createRegistry();
    const act = vi.fn(async () => {});
    r.set({ channelId: "c1", abort: vi.fn(async () => {}), act } as any);
    const i = iact({ customId: encodeId({ verb: "tm" }), values: ["p2"] });
    await routeGameInteraction(i as any, r, logger as any);
    expect(act).not.toHaveBeenCalled();
    expect(i.deferUpdate).toHaveBeenCalled();
    expect(i.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("napili") }));
  });
  it("blocks cancel from a non-host", async () => {
    const r = createRegistry();
    const abort = vi.fn(async () => {});
    r.set({ channelId: "c1", abort, hostId: "someone-else" } as any);
    const i = iact({ customId: encodeId({ verb: "cancel" }) });
    await routeGameInteraction(i as any, r, logger as any);
    expect(abort).not.toHaveBeenCalled();
    expect(i.deferUpdate).toHaveBeenCalled();
    expect(i.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("Host") }));
  });
});
