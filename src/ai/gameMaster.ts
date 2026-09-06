import { ThinkingLevel } from "@google/genai";
import type { GoogleGenAI } from "@google/genai";
import { AI_TIMEOUT_MS } from "../constants.js";
import { SAFETY_SETTINGS } from "./safety.js";
import {
  AiClientError,
  AiUnavailableError,
  RateLimitError,
  classifyAiError,
} from "./errors.js";

export const GAME_PERSONA = [
  "You are AmIgo, hosting a one-night hidden-role party game for this Discord server.",
  "Narrate in casual Taglish (mostly Tagalog, some English) — dramatic emcee energy,",
  "2-4 sentences, funny but tense. You are the game master, not a player.",
  "Narrate ONLY the facts you are given. Never reveal, guess, or invent any player's",
  "hidden role, never accuse anyone, never mention hidden information. No slurs, never punch down.",
].join(" ");

export type Narration = { ok: true; text: string } | { ok: false };

export interface NightFacts {
  playerNames: string[];
}
export interface DayFacts {
  playerNames: string[];
  minutes: number;
}
export interface RevealFacts {
  winningTeam: "village" | "werewolf" | "tanner";
  deadNames: string[];
  playerNames: string[];
}

export interface GameMaster {
  narrateNight(f: NightFacts): Promise<Narration>;
  narrateDay(f: DayFacts): Promise<Narration>;
  narrateReveal(f: RevealFacts): Promise<Narration>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createGameMaster(genai: GoogleGenAI, model: string): GameMaster {
  async function run(prompt: string): Promise<Narration> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await genai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            systemInstruction: GAME_PERSONA,
            safetySettings: SAFETY_SETTINGS,
            temperature: 1.0,
            maxOutputTokens: 200,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            httpOptions: { timeout: AI_TIMEOUT_MS },
          },
        });
        const text = (res.text ?? "").trim();
        return text ? { ok: true, text } : { ok: false };
      } catch (err) {
        lastErr = err;
        const kind = classifyAiError(err);
        if (kind === "rate_limit") throw new RateLimitError();
        if (kind === "client_error") {
          throw new AiClientError(
            err instanceof Error ? err.message : String(err),
          );
        }
        if (kind !== "unavailable") {
          throw err instanceof Error ? err : new Error(String(err));
        }
        if (attempt === 0) await sleep(500);
      }
    }
    throw new AiUnavailableError(
      lastErr instanceof Error ? lastErr.message : "ai unavailable",
    );
  }

  return {
    narrateNight: (f) =>
      run(
        `Night falls. Players: ${f.playerNames.join(", ")}. Set the scene as everyone closes their eyes.`,
      ),
    narrateDay: (f) =>
      run(
        `Morning. Players: ${f.playerNames.join(", ")}. They have ${f.minutes} minutes to argue before the vote. Kick off the day.`,
      ),
    narrateReveal: (f) =>
      run(
        `The vote is in. ${
          f.deadNames.length
            ? `Voted out: ${f.deadNames.join(", ")}.`
            : "Nobody was voted out."
        } Winner: ${f.winningTeam} team. Give a dramatic wrap-up.`,
      ),
  };
}
