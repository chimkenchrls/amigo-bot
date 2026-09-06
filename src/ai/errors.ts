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
    const e = err as {
      name?: string;
      code?: string;
      status?: number;
      message?: string;
    };
    if (
      e.name === "AbortError" ||
      e.name === "TimeoutError" ||
      e.name === "FetchError" ||
      e.name === "TypeError"
    ) {
      return "unavailable";
    }
    // Node network-layer failures — the request never got a real HTTP response.
    const NET_CODES = [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "ENOTFOUND",
      "EPIPE",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_SOCKET",
    ];
    if (typeof e.code === "string" && NET_CODES.includes(e.code)) {
      return "unavailable";
    }
    if (
      typeof e.message === "string" &&
      /fetch failed|network error|socket hang up|other side closed/i.test(e.message)
    ) {
      return "unavailable";
    }
    if (typeof e.status === "number") {
      if (e.status === 429) return "rate_limit";
      if (e.status >= 500 && e.status <= 599) return "unavailable";
      if (e.status >= 400 && e.status <= 499) return "client_error";
    }
  }
  return "other";
}
