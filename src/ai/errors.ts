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

/**
 * A non-429 4xx from the AI provider: bad key, wrong permissions, model gone,
 * malformed request. Permanent — retrying won't help, and the operator needs to
 * see it, so it's surfaced as its own kind rather than a generic crash.
 */
export class AiClientError extends Error {
  constructor(message = "ai client error") {
    super(message);
    this.name = "AiClientError";
  }
}

export type AiErrorKind = "rate_limit" | "unavailable" | "client_error" | "other";

export function classifyAiError(err: unknown): AiErrorKind {
  if (err instanceof RateLimitError) return "rate_limit";
  if (err instanceof AiUnavailableError) return "unavailable";
  if (err instanceof AiClientError) return "client_error";
  if (err && typeof err === "object") {
    const e = err as { name?: string; status?: number };
    if (e.name === "AbortError" || e.name === "TimeoutError") return "unavailable";
    if (e.name === "TypeError") return "unavailable";
    if (typeof e.status === "number") {
      if (e.status === 429) return "rate_limit";
      if (e.status >= 500 && e.status <= 599) return "unavailable";
      if (e.status >= 400 && e.status <= 499) return "client_error";
    }
  }
  return "other";
}
