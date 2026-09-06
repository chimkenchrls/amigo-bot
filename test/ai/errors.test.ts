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
