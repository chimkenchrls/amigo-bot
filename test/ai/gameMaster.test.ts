import { describe, it, expect, vi } from "vitest";
import { createGameMaster, GAME_PERSONA } from "../../src/ai/gameMaster.js";
import { RateLimitError, AiClientError } from "../../src/ai/errors.js";

function fakeGenAI(impl: () => unknown) {
  return { models: { generateContent: vi.fn(impl) } } as never;
}

describe("GAME_PERSONA", () => {
  it("is an English emcee and forbids leaking hidden info", () => {
    expect(GAME_PERSONA).toContain("English");
    expect(GAME_PERSONA.toLowerCase()).toMatch(/never reveal|huwag.*role|hidden/);
  });
});

describe("createGameMaster", () => {
  it("narrateNight returns ok text and sends only public facts", async () => {
    const genai = fakeGenAI(() => ({ text: "Bumaba ang gabi sa nayon..." }));
    const gm = createGameMaster(genai, "m");
    const res = await gm.narrateNight({ playerNames: ["Dana", "Eli"] });
    expect(res).toEqual({ ok: true, text: "Bumaba ang gabi sa nayon..." });
    const req = (genai as any).models.generateContent.mock.calls[0][0];
    expect(JSON.stringify(req)).not.toMatch(/werewolf|seer|robber/i);
    expect(req.config.systemInstruction).toBe(GAME_PERSONA);
  });

  it("returns { ok: false } when the model yields no text", async () => {
    const gm = createGameMaster(fakeGenAI(() => ({ text: "" })), "m");
    expect(await gm.narrateReveal({
      winningTeam: "village", deadNames: ["Eli"], playerNames: ["Dana", "Eli"],
    })).toEqual({ ok: false });
  });

  it("throws RateLimitError on 429", async () => {
    const gm = createGameMaster(fakeGenAI(() => { throw { status: 429 }; }), "m");
    await expect(gm.narrateDay({ playerNames: ["Dana"], minutes: 4 }))
      .rejects.toBeInstanceOf(RateLimitError);
  });

  it("throws AiClientError on 404", async () => {
    const gm = createGameMaster(fakeGenAI(() => { throw { status: 404 }; }), "m");
    await expect(gm.narrateNight({ playerNames: ["Dana"] }))
      .rejects.toBeInstanceOf(AiClientError);
  });
});
