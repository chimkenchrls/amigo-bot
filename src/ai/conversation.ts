import type { GoogleGenAI } from "@google/genai";
import { AI_TIMEOUT_MS } from "../constants.js";
import { CHAT_PERSONA } from "./persona.js";
import { SAFETY_SETTINGS } from "./safety.js";
import {
  AiUnavailableError,
  RateLimitError,
  classifyAiError,
} from "./errors.js";

export interface HistoryTurn {
  role: "user" | "model";
  parts: [{ text: string }];
}

export function toGeminiHistory(
  rows: { role: "user" | "model"; content: string }[],
): HistoryTurn[] {
  let start = 0;
  while (start < rows.length && rows[start]!.role === "model") start++;
  return rows.slice(start).map((r) => ({
    role: r.role,
    parts: [{ text: r.content }],
  }));
}

export interface ReplyParams {
  history: HistoryTurn[];
  userTurn: string;
  model: string;
}

export type ChatResult =
  | { ok: true; text: string }
  | { ok: false; reason: "blocked" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function generateReply(
  genai: GoogleGenAI,
  params: ReplyParams,
): Promise<ChatResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const chat = genai.chats.create({
        model: params.model,
        history: params.history,
        config: {
          systemInstruction: CHAT_PERSONA,
          safetySettings: SAFETY_SETTINGS,
          temperature: 0.9,
          httpOptions: { timeout: AI_TIMEOUT_MS },
        },
      });
      const res = await chat.sendMessage({ message: params.userTurn });
      const text = (res.text ?? "").trim();
      return text ? { ok: true, text } : { ok: false, reason: "blocked" };
    } catch (err) {
      lastErr = err;
      const kind = classifyAiError(err);
      if (kind === "rate_limit") throw new RateLimitError();
      if (kind !== "unavailable")
        throw err instanceof Error ? err : new Error(String(err));
      if (attempt === 0) await sleep(500);
    }
  }
  throw new AiUnavailableError(
    lastErr instanceof Error ? lastErr.message : "ai unavailable",
  );
}
