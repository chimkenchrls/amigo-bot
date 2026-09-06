import type { GoogleGenAI } from "@google/genai";
import { AI_TIMEOUT_MS, CHAT_THINKING_LEVEL } from "../constants.js";
import { CHAT_PERSONA } from "./persona.js";
import { SAFETY_SETTINGS } from "./safety.js";
import {
  AiClientError,
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

function newChat(genai: GoogleGenAI, params: ReplyParams) {
  return genai.chats.create({
    model: params.model,
    history: params.history,
    config: {
      systemInstruction: CHAT_PERSONA,
      safetySettings: SAFETY_SETTINGS,
      temperature: 0.9,
      thinkingConfig: { thinkingLevel: CHAT_THINKING_LEVEL },
      httpOptions: { timeout: AI_TIMEOUT_MS },
    },
  });
}

/** Non-streaming reply — used by the smoke script and as a fallback. */
export async function generateReply(
  genai: GoogleGenAI,
  params: ReplyParams,
): Promise<ChatResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await newChat(genai, params).sendMessage({
        message: params.userTurn,
      });
      const text = (res.text ?? "").trim();
      return text ? { ok: true, text } : { ok: false, reason: "blocked" };
    } catch (err) {
      lastErr = err;
      const kind = classifyAiError(err);
      if (kind === "rate_limit") throw new RateLimitError();
      if (kind === "client_error")
        throw new AiClientError(err instanceof Error ? err.message : String(err));
      if (kind !== "unavailable")
        throw err instanceof Error ? err : new Error(String(err));
      if (attempt === 0) await sleep(500);
    }
  }
  throw new AiUnavailableError(
    lastErr instanceof Error ? lastErr.message : "ai unavailable",
  );
}

/**
 * Streaming reply. Yields text deltas as they arrive so the caller can show
 * progress. Retries once on a pre-stream 5xx/timeout; a 429 throws
 * RateLimitError immediately. Once the first delta has been yielded there is no
 * retry — a mid-stream failure propagates to the consumer, which keeps whatever
 * partial text it already has.
 */
export async function* generateReplyStream(
  genai: GoogleGenAI,
  params: ReplyParams,
): AsyncGenerator<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    let yielded = false;
    try {
      const stream = await newChat(genai, params).sendMessageStream({
        message: params.userTurn,
      });
      for await (const chunk of stream) {
        const text = chunk.text ?? "";
        if (text) {
          yielded = true;
          yield text;
        }
      }
      return;
    } catch (err) {
      lastErr = err;
      if (yielded) {
        throw err instanceof Error ? err : new Error(String(err));
      }
      const kind = classifyAiError(err);
      if (kind === "rate_limit") throw new RateLimitError();
      if (kind === "client_error")
        throw new AiClientError(err instanceof Error ? err.message : String(err));
      if (kind !== "unavailable")
        throw err instanceof Error ? err : new Error(String(err));
      if (attempt === 0) await sleep(500);
    }
  }
  throw new AiUnavailableError(
    lastErr instanceof Error ? lastErr.message : "ai unavailable",
  );
}
