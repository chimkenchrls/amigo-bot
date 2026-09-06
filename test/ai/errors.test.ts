import { describe, it, expect } from "vitest";
import {
  RateLimitError,
  AiUnavailableError,
  AiClientError,
  classifyAiError,
} from "../../src/ai/errors.js";

describe("classifyAiError", () => {
  it("maps 429 to rate_limit", () => {
    expect(classifyAiError({ status: 429 })).toBe("rate_limit");
  });
  it("maps 5xx to unavailable", () => {
    expect(classifyAiError({ status: 503 })).toBe("unavailable");
  });
  it("maps AbortError to unavailable", () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    expect(classifyAiError(e)).toBe("unavailable");
  });
  it("maps our own error classes", () => {
    expect(classifyAiError(new RateLimitError("x"))).toBe("rate_limit");
    expect(classifyAiError(new AiUnavailableError("x"))).toBe("unavailable");
    expect(classifyAiError(new AiClientError("x"))).toBe("client_error");
  });
  it("maps Node network-layer failures to unavailable", () => {
    expect(classifyAiError({ code: "ECONNRESET" })).toBe("unavailable");
    expect(classifyAiError({ code: "ETIMEDOUT" })).toBe("unavailable");
    expect(classifyAiError({ code: "EAI_AGAIN" })).toBe("unavailable");
    expect(classifyAiError({ code: "UND_ERR_CONNECT_TIMEOUT" })).toBe("unavailable");
  });
  it("maps a fetch-failed / socket-hang-up message to unavailable", () => {
    expect(classifyAiError(new TypeError("fetch failed"))).toBe("unavailable");
    expect(classifyAiError(new Error("socket hang up"))).toBe("unavailable");
  });
  it("maps a non-429 4xx to client_error (permanent, don't retry)", () => {
    expect(classifyAiError({ status: 400 })).toBe("client_error");
    expect(classifyAiError({ status: 401 })).toBe("client_error");
    expect(classifyAiError({ status: 403 })).toBe("client_error");
    expect(classifyAiError({ status: 404 })).toBe("client_error");
  });
  it("defaults to other for errors with no HTTP status", () => {
    expect(classifyAiError(new Error("weird"))).toBe("other");
    expect(classifyAiError("nope")).toBe("other");
  });
});
