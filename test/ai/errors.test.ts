import { describe, it, expect } from "vitest";
import {
  RateLimitError,
  AiUnavailableError,
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
  });
  it("defaults to other", () => {
    expect(classifyAiError({ status: 400 })).toBe("other");
    expect(classifyAiError(new Error("weird"))).toBe("other");
  });
});
