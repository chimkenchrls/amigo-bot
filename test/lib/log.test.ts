import { describe, it, expect, vi } from "vitest";
import { createLogger } from "../../src/lib/log.js";

describe("createLogger", () => {
  it("drops messages below the configured level", () => {
    const lines: string[] = [];
    const log = createLogger("warn", (l) => lines.push(l));
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("WARN");
    expect(lines[0]).toContain("w");
    expect(lines[1]).toContain("ERROR");
  });

  it("appends JSON meta when provided", () => {
    const lines: string[] = [];
    const log = createLogger("debug", (l) => lines.push(l));
    log.info("hello", { a: 1 });
    expect(lines[0]).toContain("hello");
    expect(lines[0]).toContain('{"a":1}');
  });

  it("emits a single line with no newline", () => {
    const lines: string[] = [];
    const log = createLogger("info", (l) => lines.push(l));
    log.info("x\ny");
    expect(lines[0].endsWith("\n")).toBe(false);
  });
});
