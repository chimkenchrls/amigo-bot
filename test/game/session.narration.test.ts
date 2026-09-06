import { describe, it, expect, vi } from "vitest";
import { createGameSession } from "../../src/game/session.js";
import { fakeDeps } from "./session-helpers.js";
import { NARRATION_TIMEOUT_MS, NIGHT_MS } from "../../src/game/constants.js";

describe("session narration", () => {
  it("edits the night message with narration when it succeeds", async () => {
    const { deps, sent } = fakeDeps({
      gameMaster: {
        narrateNight: vi.fn(async () => ({
          ok: true,
          text: "Kumalat ang lamig sa nayon.",
        })),
        narrateDay: vi.fn(async () => ({ ok: false })),
        narrateReveal: vi.fn(async () => ({ ok: false })),
      },
    });
    const s = await createGameSession("h", deps);
    await s.join("a", "Ann");
    await s.join("b", "Bee");
    await s.start("h");

    const nightMsg = sent.find((x) => JSON.stringify(x.p).includes("Gabi"))!;
    await vi.waitFor(() => expect(nightMsg.m.edit).toHaveBeenCalled());
    expect(JSON.stringify(nightMsg.m.edit.mock.calls[0])).toContain(
      "Kumalat ang lamig sa nayon.",
    );
  });

  it("keeps the mechanical message and logs when narration throws", async () => {
    const { deps } = fakeDeps({
      gameMaster: {
        narrateNight: vi.fn(async () => {
          throw new Error("gemini down");
        }),
        narrateDay: vi.fn(async () => ({ ok: false })),
        narrateReveal: vi.fn(async () => ({ ok: false })),
      },
    });
    const s = await createGameSession("h", deps);
    await s.join("a", "Ann");
    await s.join("b", "Bee");
    await s.start("h");

    expect(s.phase).toBe("night");
    await vi.waitFor(() =>
      expect(deps.logger.warn).toHaveBeenCalledWith("game narration failed", {
        phase: "night",
        name: "Error",
      }),
    );
  });

  it("awaits the reveal narration and injects it into the reveal message", async () => {
    const { deps, sent, timers } = fakeDeps({
      rng: () => 0.01,
      gameMaster: {
        narrateNight: vi.fn(async () => ({ ok: false })),
        narrateDay: vi.fn(async () => ({ ok: false })),
        narrateReveal: vi.fn(async () => ({ ok: true, text: "AMEN, tapos na." })),
      },
    });
    const s = await createGameSession("h", deps);
    await s.join("a", "Ann");
    await s.join("b", "Bee");
    await s.start("h");

    timers.find((t) => t.ms === NIGHT_MS)!.fn();
    await Promise.resolve(); // -> day
    await s.skip("h"); // -> vote

    await s.vote("h", "a");
    await s.vote("a", "b");
    await s.vote("b", "a"); // all voted -> reveal -> done

    expect(s.phase).toBe("done");
    expect(deps.gameMaster.narrateReveal).toHaveBeenCalled();
    expect(JSON.stringify(sent.at(-1)!.p)).toContain("AMEN, tapos na.");
  });

  it("falls back silently when the narration cap fires (no edit, no warn)", async () => {
    const { deps, sent, timers } = fakeDeps({
      gameMaster: {
        narrateNight: vi.fn(() => new Promise<never>(() => {})),
        narrateDay: vi.fn(async () => ({ ok: false })),
        narrateReveal: vi.fn(async () => ({ ok: false })),
      },
    });
    const s = await createGameSession("h", deps);
    await s.join("a", "Ann");
    await s.join("b", "Bee");
    await s.start("h");

    const nightMsg = sent.find((x) => JSON.stringify(x.p).includes("Gabi"))!;
    timers.find((t) => t.ms === NARRATION_TIMEOUT_MS)!.fn();
    await Promise.resolve();
    await Promise.resolve();

    expect(nightMsg.m.edit).not.toHaveBeenCalled();
    expect(deps.logger.warn).not.toHaveBeenCalled();
  });

  it("does not edit the night message once the phase has moved on", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { deps, sent, timers } = fakeDeps({
      gameMaster: {
        narrateNight: vi.fn(async () => {
          await gate;
          return { ok: true, text: "late" };
        }),
        narrateDay: vi.fn(async () => ({ ok: false })),
        narrateReveal: vi.fn(async () => ({ ok: false })),
      },
    });
    const s = await createGameSession("h", deps);
    await s.join("a", "Ann");
    await s.join("b", "Bee");
    await s.start("h");

    const nightMsg = sent.find((x) => JSON.stringify(x.p).includes("Gabi"))!;
    timers.find((t) => t.ms === NIGHT_MS)!.fn(); // -> day before narration settles
    await vi.waitFor(() => expect(s.phase).toBe("day"));

    release(); // narration resolves now, but the phase is no longer "night"
    await Promise.resolve();
    await Promise.resolve();

    expect(
      nightMsg.m.edit.mock.calls.some((c) => JSON.stringify(c).includes("late")),
    ).toBe(false);
  });

  it("edits the day message with narration when it succeeds", async () => {
    const { deps, sent, timers } = fakeDeps({
      gameMaster: {
        narrateNight: vi.fn(async () => ({ ok: false })),
        narrateDay: vi.fn(async () => ({ ok: true, text: "araw na, mga bakla" })),
        narrateReveal: vi.fn(async () => ({ ok: false })),
      },
    });
    const s = await createGameSession("h", deps);
    await s.join("a", "Ann");
    await s.join("b", "Bee");
    await s.start("h");

    timers.find((t) => t.ms === NIGHT_MS)!.fn(); // -> day
    const dayMsg = await vi.waitFor(() => {
      const m = sent.find((x) => JSON.stringify(x.p).includes("minuto"));
      if (!m) throw new Error("no day message yet");
      return m;
    });
    await vi.waitFor(() =>
      expect(
        dayMsg.m.edit.mock.calls.some((c) =>
          JSON.stringify(c).includes("araw na, mga bakla"),
        ),
      ).toBe(true),
    );
  });
});
