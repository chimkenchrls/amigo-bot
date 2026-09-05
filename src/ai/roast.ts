import type { GoogleGenAI } from "@google/genai";
import { AI_TIMEOUT_MS } from "../constants.js";
import { ROAST_PERSONA } from "./persona.js";
import { SAFETY_SETTINGS } from "./safety.js";
import {
  AiUnavailableError,
  RateLimitError,
  classifyAiError,
} from "./errors.js";

export type RoastMode = "ROAST" | "TOAST";

export function pickRoastMode(rng: () => number = Math.random): RoastMode {
  return rng() < 0.5 ? "ROAST" : "TOAST";
}

export function buildRoastPrompt(mode: RoastMode): string {
  if (mode === "ROAST") {
    return (
      "Roast what you see in this image. Savage, witty, roast-battle energy — " +
      "2-3 sentences, playful-mean not hateful. No slurs, no jabs at protected " +
      "characteristics. If the subject looks like a minor, refuse and say you " +
      "don't roast kids."
    );
  }
  return (
    "Hype up what you see in this image. Absurd, over-the-top hype-man praise — " +
    "treat it as the greatest thing ever photographed. 2-3 sentences of " +
    "unhinged enthusiasm. No slurs."
  );
}

export interface RoastParams {
  data: string;
  mimeType: string;
  mode: RoastMode;
  model: string;
}

export type RoastResult =
  | { ok: true; text: string }
  | { ok: false; reason: "blocked" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function roastImage(
  genai: GoogleGenAI,
  params: RoastParams,
): Promise<RoastResult> {
  const request = {
    model: params.model,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: params.mimeType, data: params.data } },
          { text: buildRoastPrompt(params.mode) },
        ],
      },
    ],
    config: {
      systemInstruction: ROAST_PERSONA,
      safetySettings: SAFETY_SETTINGS,
      temperature: 1.0,
      httpOptions: { timeout: AI_TIMEOUT_MS },
    },
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await genai.models.generateContent(request);
      const text = (res.text ?? "").trim();
      return text ? { ok: true, text } : { ok: false, reason: "blocked" };
    } catch (err) {
      lastErr = err;
      const kind = classifyAiError(err);
      if (kind === "rate_limit") throw new RateLimitError();
      if (kind !== "unavailable") throw err instanceof Error ? err : new Error(String(err));
      if (attempt === 0) await sleep(500);
    }
  }
  throw new AiUnavailableError(
    lastErr instanceof Error ? lastErr.message : "ai unavailable",
  );
}
