export class RateLimitError extends Error {
  constructor(message = "rate limited") {
    super(message);
    this.name = "RateLimitError";
  }
}

export class AiUnavailableError extends Error {
  constructor(message = "ai unavailable") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export type AiErrorKind = "rate_limit" | "unavailable" | "other";

export function classifyAiError(err: unknown): AiErrorKind {
  if (err instanceof RateLimitError) return "rate_limit";
  if (err instanceof AiUnavailableError) return "unavailable";
  if (err && typeof err === "object") {
    const e = err as { name?: string; status?: number };
    if (e.name === "AbortError" || e.name === "TimeoutError") return "unavailable";
    if (e.name === "TypeError") return "unavailable";
    if (typeof e.status === "number") {
      if (e.status === 429) return "rate_limit";
      if (e.status >= 500 && e.status <= 599) return "unavailable";
    }
  }
  return "other";
}
