import { describe, it, expect, vi } from "vitest";
import { createAutoMemory } from "../../src/memory/autoMemory.js";
import { DISTILL_TRANSCRIPT_TURNS } from "../../src/constants.js";

const flush = () => new Promise((r) => setImmediate(r));

function autoFact(content: string, id = 1) {
  return { id, scope: "channel", scopeId: "c1", content, source: "auto", createdBy: "amigo", createdAt: 0 };
}

function makeDeps(over: Record<string, unknown> = {}) {
  const activity = {
    note: vi.fn(),
    settled: vi.fn(() => [{ channelId: "c1", msgCount: 12 }]),
    markDistilled: vi.fn(),
  };
  const store = {
    recent: vi.fn(() => [
      { id: 1, channelId: "c1", role: "user", content: "Dana: hi", createdAt: 0 },
      { id: 2, channelId: "c1", role: "model", content: "yo", createdAt: 0 },
    ]),
    append: vi.fn(), trim: vi.fn(), purgeChannel: vi.fn(),
  };
  const facts = {
    list: vi.fn(() => [autoFact("existing auto note")]),
    replaceAuto: vi.fn(),
    add: vi.fn(), forChat: vi.fn(), remove: vi.fn(), count: vi.fn(() => 0),
  };
  const distiller = { distill: vi.fn(async () => ({ ok: true, notes: ["fresh note"] })) };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    activity, store, facts, distiller, logger,
    setInterval: vi.fn((_fn: () => void, _ms: number) => "timer-1"),
    clearInterval: vi.fn((_t: unknown) => {}),
    ...over,
  };
}

describe("createAutoMemory", () => {
  it("distils each settled channel with its transcript and existing auto notes", async () => {
    const d = makeDeps();
    await createAutoMemory(d as never).tick();
    await flush();
    expect(d.store.recent).toHaveBeenCalledWith("c1", DISTILL_TRANSCRIPT_TURNS);
    expect(d.distiller.distill).toHaveBeenCalledWith({
      existing: ["existing auto note"],
      transcript: "Dana: hi\nAmIgo: yo",
    });
    expect(d.facts.replaceAuto).toHaveBeenCalledWith("channel", "c1", ["fresh note"]);
  });

  it("does not write when the distiller returns { ok: false }", async () => {
    const d = makeDeps({ distiller: { distill: vi.fn(async () => ({ ok: false })) } });
    await createAutoMemory(d as never).tick();
    await flush();
    expect(d.facts.replaceAuto).not.toHaveBeenCalled();
  });

  it("logs a warning and does not write when the distiller throws", async () => {
    const d = makeDeps({
      distiller: { distill: vi.fn(async () => { throw new Error("boom"); }) },
    });
    await createAutoMemory(d as never).tick();
    await flush();
    expect(d.logger.warn).toHaveBeenCalledWith("auto-memory distill failed", {
      channelId: "c1",
      name: "Error",
    });
    expect(d.facts.replaceAuto).not.toHaveBeenCalled();
  });

  it("skips a re-distill when the transcript is unchanged since the last pass", async () => {
    const d = makeDeps();
    const am = createAutoMemory(d as never);
    await am.tick();
    await flush();
    await am.tick();
    await flush();
    expect(d.distiller.distill).toHaveBeenCalledTimes(1);
  });

  it("distils again once new messages have landed since the last pass", async () => {
    const d = makeDeps();
    const am = createAutoMemory(d as never);
    await am.tick();
    await flush();
    (d.store.recent as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: 1, channelId: "c1", role: "user", content: "Dana: hi", createdAt: 0 },
      { id: 2, channelId: "c1", role: "model", content: "yo", createdAt: 0 },
      { id: 5, channelId: "c1", role: "user", content: "Dana: back", createdAt: 0 },
    ]);
    await am.tick();
    await flush();
    expect(d.distiller.distill).toHaveBeenCalledTimes(2);
  });

  it("releases the in-flight lock on the empty-transcript path", async () => {
    const d = makeDeps({
      store: { recent: vi.fn(() => []), append: vi.fn(), trim: vi.fn(), purgeChannel: vi.fn() },
    });
    const am = createAutoMemory(d as never);
    await am.tick();
    await flush();
    expect(d.distiller.distill).not.toHaveBeenCalled();
    (d.store.recent as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: 1, channelId: "c1", role: "user", content: "Dana: hi", createdAt: 0 },
      { id: 2, channelId: "c1", role: "model", content: "yo", createdAt: 0 },
    ]);
    await am.tick();
    await flush();
    expect(d.distiller.distill).toHaveBeenCalledTimes(1);
  });

  it("marks the channel distilled synchronously, before the async work finishes", async () => {
    let release: (v: unknown) => void = () => {};
    const d = makeDeps({
      distiller: { distill: vi.fn(() => new Promise((r) => { release = r; })) },
    });
    await createAutoMemory(d as never).tick();
    expect(d.activity.markDistilled).toHaveBeenCalledWith("c1");
    expect(d.activity.markDistilled).toHaveBeenCalledTimes(1);
    expect(d.facts.replaceAuto).not.toHaveBeenCalled();
    release({ ok: true, notes: [] });
    await flush();
  });

  it("does not double-dispatch a channel that is still in flight", async () => {
    const d = makeDeps({
      distiller: { distill: vi.fn(() => new Promise(() => {})) },
    });
    const am = createAutoMemory(d as never);
    await am.tick();
    await am.tick();
    expect(d.distiller.distill).toHaveBeenCalledTimes(1);
  });

  it("skips the distiller when there is no transcript", async () => {
    const d = makeDeps({
      store: { recent: vi.fn(() => []), append: vi.fn(), trim: vi.fn(), purgeChannel: vi.fn() },
    });
    await createAutoMemory(d as never).tick();
    await flush();
    expect(d.distiller.distill).not.toHaveBeenCalled();
  });

  it("start arms one interval; stop clears it; note delegates to the tracker", () => {
    const d = makeDeps();
    const am = createAutoMemory(d as never);
    am.start();
    expect(d.setInterval).toHaveBeenCalledTimes(1);
    expect(d.setInterval.mock.calls[0]![1]).toBeGreaterThan(0);
    am.stop();
    expect(d.clearInterval).toHaveBeenCalledWith("timer-1");
    am.note("c9");
    expect(d.activity.note).toHaveBeenCalledWith("c9");
  });
});
